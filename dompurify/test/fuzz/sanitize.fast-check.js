'use strict';

/** 使用严格相等语义验证属性测试的不变量。 */
const assert = require('node:assert/strict');
/** 生成随机输入、缩减失败样本并重复执行属性。 */
const fc = require('fast-check');
/** 为每次属性检查提供可释放的隔离 DOM realm。 */
const { JSDOM } = require('jsdom');
/** 待测 CommonJS 构建的实例工厂。 */
const createDOMPurify = require('../../dist/purify.cjs.js');

/** 每条属性的执行次数；允许 CI 或本地审计通过环境变量提高强度。 */
const FUZZ_RUNS = Number(process.env.FUZZ_RUNS || 300);

/**
 * 为一次检查创建 DOMPurify 实例，并在回调结束后无条件关闭 JSDOM window。
 *
 * @param fn - 接收隔离 DOMPurify 实例并执行单个属性样本的函数。
 * @returns 回调返回值。
 */
function withDOMPurify(fn) {
  const window = new JSDOM('').window;
  try {
    const DOMPurify = createDOMPurify(window);
    return fn(DOMPurify);
  } finally {
    window.close();
  }
}

/**
 * 确定性攻击与边界种子；和随机字符串混合，保证低概率结构也能稳定进入语料。
 *
 * 覆盖普通 HTML、事件处理器、SVG/MathML、mXSS、命名属性和 URI 混淆。
 */
const seedPayloads = [
  '',
  'hello',
  '<b>hello</b>',
  '<img src=x onerror=alert(1)>',
  '<svg><g/onload=alert(2)//<p>',
  '<math><mi//xlink:href="data:x,<script>alert(4)</script>">',
  '<TABLE><tr><td>HELLO</tr></TABL>',
  '<a href="javascript:alert(1)">x</a>',
  '<p>abc<iframe//src=jAva&Tab;script:alert(3)>def</p>',
  // id/name 属性种子：驱动 SANITIZE_NAMED_PROPS 转换路径。
  '<div id="foo">hi</div>',
  '<a name="bar">hi</a>',
  '<div id="user-content-foo">hi</div>',
  '<a name="user-content-bar">hi</a>',
  '<form id="x"><input id="y"></form>',
  '<div id="">hi</div>',
  // HTML 规范保留的自定义元素名称：不能被宽松 custom-element 规则放行。
  '<annotation-xml encoding="text/html" onclick="alert(1)">x</annotation-xml>',
  '<font-face onclick="alert(1)">x</font-face>',
  '<color-profile onclick="alert(1)">x</color-profile>',
  '<missing-glyph onclick="alert(1)">x</missing-glyph>',
  // 经典 mXSS / 解析差异载荷：覆盖 HTML 与 SVG/MathML 集成点。
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p>',
  '<style><style><img src=x onerror=alert(1)></style></style>',
  '<template><img src=x onerror=alert(1)></template>',
  '<svg><a><text>x</text><animate attributeName=href values=javascript:alert(1) begin=0s /></a></svg>',
  '<math><mtext><mglyph><style><!--</style><img src onerror=alert(1)>',
  '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
  // URL scheme 混淆：覆盖前导空白、制表符、NUL 和字符实体。
  '<a href=" javascript:alert(1)">x</a>',
  '<a href="java\tscript:alert(1)">x</a>',
  '<a href="\0javascript:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
];

/** 生成会经过字符串化或空输入分支的原始 dirty 值。 */
const primitiveDirtyArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: false, noDefaultInfinity: false }),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined)
);

/** 生成数组和字典，覆盖对象输入的字符串化与异常边界。 */
const objectDirtyArb = fc.oneof(
  fc.array(
    fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    {
      maxLength: 10,
    }
  ),
  fc.dictionary(
    fc.string(),
    fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    {
      maxKeys: 10,
    }
  )
);

/** 属性 1/3 的完整 dirty 输入生成器：确定性安全语料加任意 JS 值。 */
const dirtyArb = fc.oneof(
  fc.constantFrom(...seedPayloads),
  primitiveDirtyArb,
  objectDirtyArb
);

/** 只生成字符串，保证幂等性与输出正则不变量比较的是字符串返回模式。 */
const dirtyForInvariantArb = fc.oneof(
  fc.constantFrom(...seedPayloads),
  fc.string()
);

/**
 * 生成类型正确但字段可缺失的公开配置对象。
 *
 * RETURN_DOM 系列也被纳入，用于“正常返回或抛标准异常”属性；幂等属性使用更窄生成器。
 */
const configObjectArb = fc.record(
  {
    SAFE_FOR_TEMPLATES: fc.boolean(),
    SAFE_FOR_XML: fc.boolean(),
    ALLOW_ARIA_ATTR: fc.boolean(),
    ALLOW_DATA_ATTR: fc.boolean(),
    ALLOW_UNKNOWN_PROTOCOLS: fc.boolean(),
    WHOLE_DOCUMENT: fc.boolean(),
    FORCE_BODY: fc.boolean(),
    KEEP_CONTENT: fc.boolean(),
    SANITIZE_DOM: fc.boolean(),
    SANITIZE_NAMED_PROPS: fc.boolean(),
    RETURN_TRUSTED_TYPE: fc.boolean(),
    RETURN_DOM: fc.boolean(),
    RETURN_DOM_FRAGMENT: fc.boolean(),
    PARSER_MEDIA_TYPE: fc.constantFrom('text/html', 'application/xhtml+xml'),
    ALLOWED_TAGS: fc.array(fc.string(), { maxLength: 8 }),
    ALLOWED_ATTR: fc.array(fc.string(), { maxLength: 8 }),
    FORBID_TAGS: fc.array(fc.string(), { maxLength: 8 }),
    FORBID_ATTR: fc.array(fc.string(), { maxLength: 8 }),
    ADD_TAGS: fc.array(fc.string(), { maxLength: 8 }),
    ADD_ATTR: fc.array(fc.string(), { maxLength: 8 }),
    ADD_DATA_URI_TAGS: fc.array(fc.string(), { maxLength: 8 }),
    ADD_URI_SAFE_ATTR: fc.array(fc.string(), { maxLength: 8 }),
  },
  { withDeletedKeys: true }
);

/**
 * 生成保持普通 fragment 字符串返回模式的配置，供两次清洗幂等性比较。
 *
 * 排除 WHOLE_DOCUMENT、RETURN_DOM、RETURN_DOM_FRAGMENT 和 RETURN_TRUSTED_TYPE，
 * 避免不同所有权或返回类型把“无法直接比较”误报为不幂等。
 */
const idempotentConfigArb = fc.record(
  {
    SAFE_FOR_TEMPLATES: fc.boolean(),
    SAFE_FOR_XML: fc.boolean(),
    ALLOW_ARIA_ATTR: fc.boolean(),
    ALLOW_DATA_ATTR: fc.boolean(),
    ALLOW_UNKNOWN_PROTOCOLS: fc.boolean(),
    FORCE_BODY: fc.boolean(),
    KEEP_CONTENT: fc.boolean(),
    SANITIZE_DOM: fc.boolean(),
    SANITIZE_NAMED_PROPS: fc.boolean(),
    ALLOWED_TAGS: fc.array(fc.string(), { maxLength: 8 }),
    ALLOWED_ATTR: fc.array(fc.string(), { maxLength: 8 }),
    FORBID_TAGS: fc.array(fc.string(), { maxLength: 8 }),
    FORBID_ATTR: fc.array(fc.string(), { maxLength: 8 }),
    ADD_TAGS: fc.array(fc.string(), { maxLength: 8 }),
    ADD_ATTR: fc.array(fc.string(), { maxLength: 8 }),
    ADD_DATA_URI_TAGS: fc.array(fc.string(), { maxLength: 8 }),
    ADD_URI_SAFE_ATTR: fc.array(fc.string(), { maxLength: 8 }),
  },
  { withDeletedKeys: true }
);

/** 为真实配置键生成错误类型、特殊数值、容器和无原型对象。 */
const weirdValueArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.boolean(),
  fc.integer(),
  fc.double({ noNaN: false, noDefaultInfinity: false }),
  fc.bigInt(),
  fc.string(),
  fc.array(
    fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    {
      maxLength: 8,
    }
  ),
  fc.dictionary(
    fc.string(),
    fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    { maxKeys: 8 }
  ),
  fc.constant(new Date(0)),
  fc.constant(new Date('invalid')),
  fc.constant(/x/i),
  fc.constant(/javascript:/i),
  fc.constant([]),
  fc.constant({}),
  fc.constant(Object.create(null))
);

/** 把异常值分配给真实配置键，覆盖 `_parseConfig()` 的类型收窄与默认回退。 */
const weirdTypedConfigArb = fc.record(
  {
    SAFE_FOR_TEMPLATES: weirdValueArb,
    SAFE_FOR_XML: weirdValueArb,
    ALLOW_ARIA_ATTR: weirdValueArb,
    ALLOW_DATA_ATTR: weirdValueArb,
    ALLOW_UNKNOWN_PROTOCOLS: weirdValueArb,
    WHOLE_DOCUMENT: weirdValueArb,
    FORCE_BODY: weirdValueArb,
    KEEP_CONTENT: weirdValueArb,
    SANITIZE_DOM: weirdValueArb,
    SANITIZE_NAMED_PROPS: weirdValueArb,
    RETURN_TRUSTED_TYPE: weirdValueArb,
    RETURN_DOM: weirdValueArb,
    RETURN_DOM_FRAGMENT: weirdValueArb,
    PARSER_MEDIA_TYPE: weirdValueArb,
    ALLOWED_TAGS: weirdValueArb,
    ALLOWED_ATTR: weirdValueArb,
    FORBID_TAGS: weirdValueArb,
    FORBID_ATTR: weirdValueArb,
    ADD_TAGS: weirdValueArb,
    ADD_ATTR: weirdValueArb,
    ADD_DATA_URI_TAGS: weirdValueArb,
    ADD_URI_SAFE_ATTR: weirdValueArb,
    ALLOWED_URI_REGEXP: weirdValueArb,
  },
  { withDeletedKeys: true }
);

/** 组合非对象配置、任意字典和类型正确配置，用于顶层配置防御属性。 */
const configArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.double({ noNaN: false, noDefaultInfinity: false }),
  fc.string(),
  fc.array(
    fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    {
      maxLength: 10,
    }
  ),
  fc.dictionary(
    fc.string(),
    fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    {
      maxKeys: 10,
    }
  ),
  configObjectArb
);

console.log(
  `Property 1: random dirty + random config should either return or throw a normal exception.`
);
/**
 * Given：任意 dirty 值与任意形状配置。
 * When：在隔离 realm 中调用一次 `sanitize()`。
 * Then：要么正常返回，要么只抛出 Error/DOMException，不得抛 primitive 或使进程崩溃。
 *
 * 验证机制：fast-check 负责生成和缩减；catch 分支限定可接受异常类型。
 * 对应源码：`sanitize()` 输入字符串化及 `_parseConfig()` 配置防御入口。
 */
fc.assert(
  fc.property(dirtyArb, configArb, (dirty, config) => {
    withDOMPurify((DOMPurify) => {
      try {
        DOMPurify.sanitize(dirty, config);
      } catch (err) {
        assert.ok(
          err instanceof Error ||
            Object.prototype.toString.call(err) === '[object DOMException]',
          `Unexpected thrown value: ${String(err)}`
        );
      }
    });
  }),
  {
    numRuns: FUZZ_RUNS,
    verbose: true,
  }
);

console.log(
  `Property 2: for ordinary fragment-style string-output configs, sanitization should be idempotent.`
);
/**
 * Given：字符串 dirty 值和保持普通 fragment 字符串返回模式的配置。
 * When：把第一次清洗结果用同一配置再次清洗。
 * Then：两次结果均为字符串且完全相等。
 *
 * 验证机制：显式排除改变返回所有权/类型的配置，确保相等失败只指向清洗不幂等。
 * 对应源码：`sanitize()` 的 DOM 解析、遍历和字符串序列化主链。
 */
fc.assert(
  fc.property(dirtyForInvariantArb, idempotentConfigArb, (dirty, config) => {
    withDOMPurify((DOMPurify) => {
      const once = DOMPurify.sanitize(dirty, config);
      const twice = DOMPurify.sanitize(once, config);

      assert.equal(typeof once, 'string');
      assert.equal(once, twice);
    });
  }),
  {
    numRuns: FUZZ_RUNS,
    verbose: true,
  }
);

console.log(
  `Property 3: weirdly typed values for real config keys should not crash the process.`
);
/**
 * Given：真实配置键承载 null、数值、容器、RegExp 等异常类型。
 * When：以任意 dirty 输入调用 `sanitize()`。
 * Then：调用正常返回或抛标准异常，不能产生不可控抛值或进程级崩溃。
 *
 * 验证机制：键名真实、值类型系统变化，直接覆盖各配置分支的类型检查。
 * 对应源码：`_parseConfig()` 和各 `_resolveSetOption()` 配置解析分支。
 */
fc.assert(
  fc.property(dirtyArb, weirdTypedConfigArb, (dirty, config) => {
    withDOMPurify((DOMPurify) => {
      try {
        DOMPurify.sanitize(dirty, config);
      } catch (err) {
        assert.ok(
          err instanceof Error ||
            Object.prototype.toString.call(err) === '[object DOMException]',
          `Unexpected thrown value: ${String(err)}`
        );
      }
    });
  }),
  {
    numRuns: FUZZ_RUNS,
    verbose: true,
  }
);

/**
 * 默认配置输出中不得出现的可执行语法标记。
 *
 * 正则只匹配原始输出语法：实际 `<script>`、`on*` 事件属性，以及属性位置中的
 * javascript:/vbscript:/data:text/html URL。它们不会命中 `&lt;script` 等实体编码文本，
 * 也不会把文本节点中的普通“javascript:”字样当成可执行属性。
 *
 * 此不变量故意只用于默认安全配置（2026 年 4 月审查的 Option A）。ADD_TAGS/ADD_ATTR
 * 等合法配置可以显式放行这些标记；若为任意配置另写安全分类器，分类器本身也会成为
 * 需要持续证明正确的新安全逻辑。
 */
const XSS_INVARIANTS = [
  { name: 'script-open-tag', re: /<script[\s>\/]/i },
  { name: 'script-close-tag', re: /<\/script/i },
  { name: 'onhandler-attribute', re: /\son[a-z]+\s*=/i },
  { name: 'javascript-url-attr', re: /=\s*["']?\s*javascript:/i },
  { name: 'vbscript-url-attr', re: /=\s*["']?\s*vbscript:/i },
  { name: 'data-html-url-attr', re: /=\s*["']?\s*data:text\/html/i },
];

/**
 * 检查字符串输出未违反任何默认配置 XSS 语法不变量。
 *
 * @param output - `sanitize()` 的返回值；非字符串模式由本检查跳过。
 * @param dirty - 原始输入，仅用于失败时生成可缩减、可复现的诊断。
 */
function assertXssInvariants(output, dirty) {
  if (typeof output !== 'string') return;
  for (const inv of XSS_INVARIANTS) {
    assert.ok(
      !inv.re.test(output),
      `XSS invariant "${inv.name}" violated.\n  input:  ${JSON.stringify(dirty)}\n  output: ${JSON.stringify(output)}`
    );
  }
}

console.log(
  `Property 4: default-config output must satisfy XSS invariants (no <script>, no on*=, no javascript: URLs).`
);
/**
 * Given：确定性攻击种子或任意字符串，且使用默认配置。
 * When：清洗后运行所有原始语法不变量。
 * Then：输出不含 script 标签、事件属性或脚本型 URL 属性。
 *
 * 验证机制：正则检查序列化结果的可执行语法；下方负对照证明检查器能命中已知危险输出。
 * 对应源码：默认 allowlist、`_sanitizeElements()` 与 `_sanitizeAttributes()`。
 */
fc.assert(
  fc.property(dirtyForInvariantArb, (dirty) => {
    withDOMPurify((DOMPurify) => {
      const output = DOMPurify.sanitize(dirty);
      assertXssInvariants(output, dirty);
    });
  }),
  {
    numRuns: FUZZ_RUNS,
    verbose: true,
  }
);

// 属性 5 使用更丰富语料验证幂等性。属性 2 的随机生成器很少产出带 id/name 的 HTML，
// 难以稳定覆盖 SANITIZE_NAMED_PROPS 等属性转换。本属性改用包含 id/name/保留名称的
// 扩展种子并显式启用该配置，让转换路径的回归成为确定性样本。
console.log(
  `Property 5: idempotence holds with SANITIZE_NAMED_PROPS enabled on id/name-bearing inputs.`
);
/**
 * Given：每条确定性种子和启用 SANITIZE_NAMED_PROPS 的配置。
 * When：连续清洗两次。
 * Then：第一次返回字符串，第二次与第一次严格相等。
 *
 * 验证机制：id/name 种子稳定触发前缀转换，二次相等证明不会重复追加前缀。
 * 对应源码：`_sanitizeAttributes()` 的 SANITIZE_NAMED_PROPS 分支。
 */
fc.assert(
  fc.property(fc.constantFrom(...seedPayloads), (dirty) => {
    withDOMPurify((DOMPurify) => {
      const cfg = { SANITIZE_NAMED_PROPS: true };
      const once = DOMPurify.sanitize(dirty, cfg);
      const twice = DOMPurify.sanitize(once, cfg);
      assert.equal(typeof once, 'string');
      assert.equal(
        once,
        twice,
        `non-idempotent for input ${JSON.stringify(dirty)}`
      );
    });
  }),
  {
    numRuns: FUZZ_RUNS,
    verbose: true,
  }
);

// 负对照证明 XSS 不变量确实会触发。这里故意用不安全配置放行已知可执行标记，并要求
// 检查器抛出 AssertionError。若它不再抛错，要么正则被削弱，要么输出编码方式已使检查失真；
// 两种情况都表示属性 4 已失去信号，而非 sanitizer 安全性得到证明。
console.log(
  `Negative Control: XSS invariant must detect a deliberately-unsafe output.`
);
/**
 * 运行 XSS 不变量的负对照，防止属性检查器静默失效。
 *
 * Given：显式放行 `onerror` 的不安全配置。
 * When：清洗已知危险 `<img>` 并执行 `assertXssInvariants()`。
 * Then：必须捕获 AssertionError；未捕获即测试失败。
 */
(function assertNegativeControl() {
  const obviouslyBad = '<img src=x onerror=alert(1)>';
  let caught = false;
  try {
    // ADD_ATTR 故意放行 onerror；这正是属性 4 在正常默认配置下必须捕获的输出形状。
    withDOMPurify((DOMPurify) => {
      const output = DOMPurify.sanitize(obviouslyBad, {
        ADD_ATTR: ['onerror'],
      });
      assertXssInvariants(output, obviouslyBad);
    });
  } catch (err) {
    caught = err instanceof assert.AssertionError;
  }
  assert.ok(
    caught,
    'Negative control failed: XSS invariant did not fire for onerror-in-output. ' +
      'Either the regexes are broken or sanitizer output is now escaped in a way that defeats them.'
  );
})();

console.log(`\nsanitize() fuzzing passed with ${FUZZ_RUNS} runs per property`);
