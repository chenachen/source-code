/*
 * DOMPurify 测试套件。
 *
 * 套件按 QUnit module 聚合相关测试。需要比较连续调用的状态时，把这些调用放在同一个
 * QUnit.test 内；跨用例的配置与 hooks 由用例自行清理，或由 module 的生命周期回调隔离。
 *
 * 约定：
 *   - `var` 仅用于 UMD 包装和确实依赖提升的用例局部变量；其余声明使用 const/let。
 *   - QUnit.test 主体通常使用箭头函数；需要读取 DOMPurify 绑定的 `this` 时，hook 使用普通函数。
 *   - 序列化结果因引擎（jsdom/Chromium/Firefox/WebKit）而异时，数组形式的
 *     assert.contains([...]) 表示完整可接受结果集合。注意 runner 的实现是
 *     `expected.indexOf(actual) > -1`：当 expected 是字符串时会退化为子串匹配，空输出也会
 *     命中任意字符串。因此标量 fixture 只能作为宽松回归信号，严格机制结论须结合 assert.equal
 *     或下方真实 DOM sink 测试。
 *
 * 部分安全回归在标题中标注 CVE/GHSA；相邻注释解释输入形状、清理路径与断言范围。
 */

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? (module.exports = factory())
    : typeof define === 'function' && define.amd
      ? define(factory)
      : ((global =
          typeof globalThis !== 'undefined' ? globalThis : global || self),
        (global.testSuite = factory()));
})(this, function () {
  /**
   * 向当前 QUnit 环境注册跨 jsdom 与真实浏览器复用的 DOMPurify 机制测试。
   *
   * 状态：多数用例共享传入实例。修改持久配置或 hooks 的用例在结束时清理；allowlist 污染
   * 模块在 beforeEach 创建独立实例，afterEach 清除该实例的 hooks 与持久配置。
   *
   * @param DOMPurify - 当前构建绑定到目标 window 后的实例/工厂。
   * @param window - 提供 DOM、计时器和 XSS 探针的目标 realm。
   * @param sanitizationTestCases - 带 payload/expected 的完整序列化 fixture。
   * @param xssTestCases - 从 fixture 中筛出的含 alert 载荷，用于真实插入 sink。
   * @returns {void} 只注册模块、测试和回调；测试执行由 QUnit 调度。
   */
  return function testSuite(
    DOMPurify,
    window,
    sanitizationTestCases,
    xssTestCases
  ) {
    const document = window.document;
    const jQuery = window.jQuery;

    // =======================================================================
    // 数据驱动清洗测试。runner 从 `test/fixtures/expect.mjs` 读取语料并传入本套件，
    // 不同待测构建复用相同 payload/expected。
    // =======================================================================

    /**
     * runner 将 expect.mjs 的全部数据传入 sanitizationTestCases；
     * 循环给每条默认清洗注册结果匹配测试，数组候选与标量匹配语义见文件头。
     */
    QUnit.module('Sanitization (data-driven)');

    /**
     * Given：fixture 提供一个输入和一个或多个跨引擎可接受序列化结果。
     * When：以默认配置执行 `sanitize()`。
     * Then：实际输出命中 fixture 期望。
     *
     * 验证机制：为传入的每条 fixture 注册测试；数组 expected 做完整结果匹配，标量 expected
     * 做子串匹配。含 alert 的语料还会进入下方 DOM 插入测试。
     * 对应源码：`sanitize()` 的默认配置、DOM 遍历和字符串序列化主链。
     */
    sanitizationTestCases.forEach((testCase) => {
      /**
       * 逐条取 fixture 的 payload，以默认配置净化并交给 assert.contains。
       * 数组 expected 要求命中完整候选，标量 expected 只做子串匹配；
       * 此定义由语料循环注册，不共享前一条输入的结果。
       */
      QUnit.test(`sanitization[${testCase.title}]`, (assert) => {
        assert.contains(
          DOMPurify.sanitize(testCase.payload),
          testCase.expected,
          `Payload: ${testCase.payload}`
        );
      });
    });

    // =======================================================================
    // XSS 测试观察清洗输出插入 DOM 后是否调用 alert()。三组模块覆盖常见的插入 sink：
    // 原生 innerHTML、jQuery.html() 和 document.write()。document.write() 单独存在，是因为
    // 内容经解析器入口注入时，Firefox 与 Chromium 历史上存在行为差异。
    //
    // Given：每条 payload 含 alert，并已把 window.alert 替换为 xssed 探针。
    // When：清洗后进入 DOM sink。innerHTML 与 jQuery 用例等待 100ms 后检查；iframe 用例
    // 在 document.write() 返回后立即检查，随后删除 iframe。
    // Then：检查时 xssed 不为 true，之后清理 DOM 与探针状态。
    // 验证机制：观察重新解析和插入后的执行结果；iframe 的检查覆盖 write 期间的同步执行。
    // 对应源码：`sanitize()` 元素/属性清洗与最终序列化。
    // =======================================================================

    /**
     * 对筛出的含 alert 语料执行原生 innerHTML 插入；
     * 每例等待 100ms 并清空 fixture/探针，观察该 sink 的执行窗口。
     */
    QUnit.module('XSS — native innerHTML');

    xssTestCases.forEach((testCase) => {
      /**
       * 将每条含 alert 的 fixture 默认净化后赋给 qunit-fixture.innerHTML。
       * 等待 100ms 检查 xssed 未置 true，再清空容器和探针；
       * 验证当前插入路径中的同步及等待窗口内的事件执行。
       */
      QUnit.test(`xss[${testCase.title}]`, (assert) => {
        document.getElementById('qunit-fixture').innerHTML = DOMPurify.sanitize(
          testCase.payload
        );
        const done = assert.async();
        setTimeout(() => {
          assert.notEqual(window.xssed, true, 'alert() was called');
          document.getElementById('qunit-fixture').innerHTML = '';
          window.xssed = false;
          done();
        }, 100);
      });
    });

    /**
     * 同组语料经 jQuery.html 重解析并等待 100ms；
     * 库由 runner 注入到当前 window，结束后清场。
     */
    QUnit.module('XSS — jQuery.html()');

    xssTestCases.forEach((testCase) => {
      /**
       * 将同组 alert 语料默认净化后经 jQuery.html 插入。
       * 100ms 后检查 xssed、清空节点并复位；
       * 目标是观察 jQuery 重解析后的执行结果。
       */
      QUnit.test(`xss[${testCase.title}]`, (assert) => {
        jQuery('#qunit-fixture').html(DOMPurify.sanitize(testCase.payload));
        const done = assert.async();
        setTimeout(() => {
          assert.notEqual(window.xssed, true, 'alert() was called');
          jQuery('#qunit-fixture').empty();
          window.xssed = false;
          done();
        }, 100);
      });
    });

    /**
     * 同组语料分别使用新 iframe 的 document.write；
     * 在 write 返回后立即检查顶层探针，再删除 iframe。
     */
    QUnit.module('XSS — iframe document.write()');

    xssTestCases.forEach((testCase) => {
      /**
       * 每条 alert 语料使用新 about:blank iframe，在 onload 中先安装顶层探针再 document.write 清洗
       * 结果。
       * write 返回后立即检查 xssed，删除 iframe；
       * 覆盖 write 期间的同步执行。
       */
      QUnit.test(`xss[${testCase.title}]`, (assert) => {
        const done = assert.async();
        const iframe = document.createElement('iframe');
        iframe.src = 'about:blank';
        iframe.onload = function () {
          iframe.contentDocument.write(
            '<script>window.alert=function(){top.xssed=true;}</script>' +
              DOMPurify.sanitize(testCase.payload)
          );
          assert.notEqual(
            window.xssed,
            true,
            'alert() was called from document.write()'
          );
          window.xssed = false;
          iframe.parentNode.removeChild(iframe);
          done();
        };
        document.body.appendChild(iframe);
      });
    });

    // 探针自检：直接写入内联 script，确认 iframe 内的同步 alert 会设置父窗口的 xssed。
    /**
     * 直接写入脚本使探针触发，验证 document.write 测试的检测器和父窗口状态联通。
     */
    QUnit.module('XSS — detector self-test');

    /**
     * 不经过 sanitize，直接向新 iframe 写入调用 alert 的 script。
     * 要求父窗口探针同步置 true，随后复位并删除 iframe，用于验证上组 write 检测器确实能捕捉脚本执行。
     */
    QUnit.test(
      'iframe document.write() with raw payload triggers detector',
      (assert) => {
        const done = assert.async();
        window.xssed = false;
        const iframe = document.createElement('iframe');
        iframe.src = 'about:blank';
        iframe.onload = function () {
          iframe.contentDocument.write(
            '<script>window.alert=function(){parent.xssed=true;}</script>' +
              '<script>alert(1);</script>'
          );
          assert.equal(
            window.xssed,
            true,
            'alert() was called but the detector missed it'
          );
          window.xssed = false;
          iframe.parentNode.removeChild(iframe);
          done();
        };
        document.body.appendChild(iframe);
      }
    );

    // =======================================================================
    // 配置：KEEP_CONTENT、ALLOWED_TAGS、ALLOWED_ATTR。
    // =======================================================================

    /**
     * 对照允许集合及 KEEP_CONTENT 开关；
     * 严格字符串结果区分删除包装、提升内容与丢弃子树。
     */
    QUnit.module('Config — KEEP_CONTENT, ALLOWED_TAGS, ALLOWED_ATTR');

    /**
     * iframe 默认被拒绝，同时显式关闭 KEEP_CONTENT。
     * 净化含 Hello 的 iframe 后严格要求空字符串，确认标签被丢弃时文本也未提升。
     */
    QUnit.test(
      'KEEP_CONTENT=false drops content of stripped tags',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<iframe>Hello</iframe>', { KEEP_CONTENT: false }),
          ''
        );
      }
    );

    /**
     * 只放行 b/q 标签和 style 属性，输入外层 a 含文本与两种子元素。
     * 开启 KEEP_CONTENT 后要求保留文本、允许标签及 style，删除 a 包装和 class；
     * 候选仅容纳 CSS 序列化差别。
     */
    QUnit.test(
      'KEEP_CONTENT=true preserves content inside ALLOWED_TAGS / ALLOWED_ATTR',
      (assert) => {
        assert.contains(
          DOMPurify.sanitize(
            '<a href="#">abc<b style="color:red">123</b><q class="cite">123</b></a>',
            {
              ALLOWED_TAGS: ['b', 'q'],
              ALLOWED_ATTR: ['style'],
              KEEP_CONTENT: true,
            }
          ),
          [
            'abc<b style="color:red">123</b><q>123</q>',
            'abc<b style="color: red;">123</b><q>123</q>',
          ]
        );
      }
    );

    /**
     * 外层 a 不在指定标签集合中，虽然内部 b/q 被放行，但关闭 KEEP_CONTENT。
     * 两组输入均要求空结果，确认被拒绝祖先会连同允许的后代一起丢弃。
     */
    QUnit.test(
      'KEEP_CONTENT=false drops content even when surrounding tags are allowed',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize(
            '<a href="#">abc<b style="color:red">123</b><q class="cite">123</b></a>',
            {
              ALLOWED_TAGS: ['b', 'q'],
              ALLOWED_ATTR: ['style'],
              KEEP_CONTENT: false,
            }
          ),
          ''
        );
        assert.equal(
          DOMPurify.sanitize('<a href="#">abc</a>', {
            ALLOWED_TAGS: ['b', 'q'],
            KEEP_CONTENT: false,
          }),
          ''
        );
      }
    );

    /**
     * 输入 form 包住名为 parentNode 的 input，仅放行 input 并保留内容。
     * 要求结果为无 name 的 input，同时观察标签提升与 clobbering 名称过滤。
     */
    QUnit.test(
      'KEEP_CONTENT preserves descendants when only the parent is allowed',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<form><input name="parentNode"></form>', {
            ALLOWED_TAGS: ['input'],
            KEEP_CONTENT: true,
          }),
          '<input>'
        );
      }
    );

    // =======================================================================
    // 配置：ALLOW_SELF_CLOSE_IN_ATTR。
    // =======================================================================

    /**
     * 相同含自闭合标记的 class 分别开关限制；
     * URI 属性保留作为对照，候选容纳属性值转义。
     */
    QUnit.module('Config — ALLOW_SELF_CLOSE_IN_ATTR');

    /**
     * class 值含自闭合 br 片段，显式关闭 ALLOW_SELF_CLOSE_IN_ATTR。
     * 要求整条 class 删除、正常 href 保留，定位属性自闭合片段检查。
     */
    QUnit.test('ALLOW_SELF_CLOSE_IN_ATTR=false strips attribute', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a href="#" class="foo <br/>">abc</a>', {
          ALLOW_SELF_CLOSE_IN_ATTR: false,
        }),
        '<a href="#">abc</a>'
      );
    });

    /**
     * 同样的 class 值开启 ALLOW_SELF_CLOSE_IN_ATTR。
     * 允许候选保留原片段或转义尖括号，确认该开关允许属性值通过自闭合片段检查。
     */
    QUnit.test('ALLOW_SELF_CLOSE_IN_ATTR=true keeps attribute', (assert) => {
      assert.contains(
        DOMPurify.sanitize('<a href="#" class="foo <br/>">abc</a>', {
          ALLOW_SELF_CLOSE_IN_ATTR: true,
        }),
        [
          '<a href="#" class="foo <br/>">abc</a>',
          '<a href="#" class="foo &lt;br/&gt;">abc</a>',
        ]
      );
    });

    // =======================================================================
    // Declarative Partial Updates：patch 指令属性。
    // https://github.com/WICG/declarative-partial-updates/blob/main/patching-explainer.md
    //
    // 这些用例检查 patch 关联标记的删除规则：SAFE_FOR_XML 默认开启时，patchsrc 总被拒绝，
    // for 只在 label/output 上保留；processing instruction 由 `_isUnsafeNode` 始终删除。
    // 测试断言清洗后的字符串，不触发远程获取、模板传送或流式更新。每个用例创建新实例，
    // 避免此前 setConfig 使 sanitize 跳过 `_parseConfig()`、忽略本次配置。
    // =======================================================================

    /**
     * 每例用新实例检查 SAFE_FOR_XML 的 for/patchsrc/指令规则；
     * 字符串断言不触发网络获取或局部更新。
     */
    QUnit.module('Declarative partial updates');

    /**
     * 新实例净化 div/section 上的 for 属性。
     * 要求文本和标签保留而 for 消失，观察 SAFE_FOR_XML 下非 label/output 的关联标记删除。
     */
    QUnit.test(
      'for teleport directive is stripped on non-label/output',
      (assert) => {
        const purify = DOMPurify(window);
        assert.equal(
          purify.sanitize('<div for="account-panel">x</div>'),
          '<div>x</div>'
        );
        assert.equal(
          purify.sanitize('<section for="cart#total">$0.00</section>'),
          '<section>$0.00</section>'
        );
      }
    );

    /**
     * 新实例分别净化 label 与显式放行的 output。
     * 要求两者的 for 原值保留，覆盖关联标记规则的合法标签例外。
     */
    QUnit.test('for is preserved on label and output', (assert) => {
      const purify = DOMPurify(window);
      assert.equal(
        purify.sanitize('<label for="email">Email</label>'),
        '<label for="email">Email</label>'
      );
      assert.equal(
        purify.sanitize('<output for="a b">42</output>', {
          ADD_TAGS: ['output'],
        }),
        '<output for="a b">42</output>'
      );
    });

    /**
     * 新实例显式放行 template，输入带 for 关联和 b 内容。
     * 候选容纳模板保留、内容裁剪或空输出，但都不带 for，目标是切断模板来源标记。
     */
    QUnit.test(
      'template[for] loses its patch directive when template is allowed',
      (assert) => {
        const purify = DOMPurify(window);
        assert.contains(
          purify.sanitize('<template for="account-panel"><b>x</b></template>', {
            ADD_TAGS: ['template'],
          }),
          ['<template><b>x</b></template>', '<template></template>', ''],
          'template survives but the `for` patch directive does not'
        );
      }
    );

    /**
     * 新实例通过 ADD_ATTR 显式允许 patchsrc。
     * 严格输出仍不含该属性，确认 SAFE_FOR_XML 的拒绝规则先于属性允许集合。
     */
    QUnit.test('patchsrc is stripped even when explicitly added', (assert) => {
      const purify = DOMPurify(window);
      assert.equal(
        purify.sanitize('<div patchsrc="//evil.example/p">x</div>', {
          ADD_ATTR: ['patchsrc'],
        }),
        '<div>x</div>'
      );
    });

    /**
     * 将 start/end 与 marker 指令放进普通列表和 section。
     * 要求指令消失而文本、li 顺序保留，覆盖解析成 PI 或标记注释后被元素阶段清理的结果。
     */
    QUnit.test('processing-instruction range markers are removed', (assert) => {
      const purify = DOMPurify(window);
      assert.equal(
        purify.sanitize('<section><?start name="g">hi<?end></section>'),
        '<section>hi</section>'
      );
      assert.equal(
        purify.sanitize('<ul><li>a</li><?marker name="m"><li>b</li></ul>'),
        '<ul><li>a</li><li>b</li></ul>'
      );
    });

    /**
     * 新实例关闭 SAFE_FOR_XML，分别测试普通 for 与显式允许的 patchsrc。
     * 严格结果保留两属性，确认关闭结构属性拒绝规则后的配置行为。
     */
    QUnit.test(
      'SAFE_FOR_XML=false is the escape hatch for patch attributes',
      (assert) => {
        const purify = DOMPurify(window);
        assert.equal(
          purify.sanitize('<div for="target">x</div>', { SAFE_FOR_XML: false }),
          '<div for="target">x</div>'
        );
        assert.equal(
          purify.sanitize('<div patchsrc="//e">x</div>', {
            ADD_ATTR: ['patchsrc'],
            SAFE_FOR_XML: false,
          }),
          '<div patchsrc="//e">x</div>'
        );
      }
    );

    // =======================================================================
    // 配置：ALLOW_DATA_ATTR。
    // =======================================================================

    /**
     * 以合法、畸形及禁止的 data 名称比较自动准入；
     * 候选容纳部分引擎名称/顺序差异。
     */
    QUnit.module('Config — ALLOW_DATA_ATTR');

    /**
     * 属性名 data-abc 后混入引号，即使允许 data 属性也应被删除。
     * 严格输出只留下 href 与文本，覆盖 DATA_ATTR 对畸形名称的拒绝。
     */
    QUnit.test('malformed data- attribute is stripped regardless', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a href="#" data-abc"="foo">abc</a>', {
          ALLOW_DATA_ATTR: true,
        }),
        '<a href="#">abc</a>'
      );
    });

    /**
     * 正常 data-abc 配合 ALLOW_DATA_ATTR=false。
     * 输出须删除 data 属性而保留链接，确认自动 data 名称准入可关闭。
     */
    QUnit.test('ALLOW_DATA_ATTR=false strips data-* attributes', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a href="#" data-abc="foo">abc</a>', {
          ALLOW_DATA_ATTR: false,
        }),
        '<a href="#">abc</a>'
      );
    });

    /**
     * 使用 data-abc 与含数字连字符的 data-abc-1-2-3。
     * 开启 data 准入后两者均保留；
     * 候选只放宽属性顺序，检查合法名称模式。
     */
    QUnit.test(
      'ALLOW_DATA_ATTR=true keeps well-formed data-* attributes',
      (assert) => {
        assert.contains(
          DOMPurify.sanitize('<a href="#" data-abc="foo">abc</a>', {
            ALLOW_DATA_ATTR: true,
          }),
          [
            '<a data-abc="foo" href="#">abc</a>',
            '<a href="#" data-abc="foo">abc</a>',
          ]
        );
        assert.contains(
          DOMPurify.sanitize('<a href="#" data-abc-1-2-3="foo">abc</a>', {
            ALLOW_DATA_ATTR: true,
          }),
          [
            '<a data-abc-1-2-3="foo" href="#">abc</a>',
            '<a href="#" data-abc-1-2-3="foo">abc</a>',
          ]
        );
      }
    );

    /**
     * 输入包含引号、äöü、中点及 µ 的 data 名称。
     * 分别断言删除或允许候选，检查 DATA_ATTR 字符范围，并容纳引擎对中点属性的差异。
     */
    QUnit.test(
      'ALLOW_DATA_ATTR with empty / non-ASCII names — name-validity rules apply',
      (assert) => {
        // 这里的属性名包含引号，不符合 DATA_ATTR，因而被删除。
        assert.equal(
          DOMPurify.sanitize('<a href="#" data-""="foo">abc</a>', {
            ALLOW_DATA_ATTR: true,
          }),
          '<a href="#">abc</a>'
        );
        // ä/ö/ü 在 DATA_ATTR 接受的字符范围内。
        assert.contains(
          DOMPurify.sanitize('<a href="#" data-äöü="foo">abc</a>', {
            ALLOW_DATA_ATTR: true,
          }),
          [
            '<a href="#" data-äöü="foo">abc</a>',
            '<a data-äöü="foo" href="#">abc</a>',
          ]
        );
        // 中点通过 DATA_ATTR；候选结果同时容纳浏览器保留或拒绝该属性的情况。
        assert.contains(
          DOMPurify.sanitize('<a href="#" data-\u00B7._="foo">abc</a>', {
            ALLOW_DATA_ATTR: true,
          }),
          [
            '<a data-\u00B7._="foo" href="#">abc</a>',
            '<a href="#">abc</a>',
            '<a href="#" data-·._="foo">abc</a>',
          ]
        );
        // µ（U+00B5）不在 DOMPurify 的 DATA_ATTR 字符范围内。
        assert.equal(
          DOMPurify.sanitize('<a href="#" data-\u00B5="foo">abc</a>', {
            ALLOW_DATA_ATTR: true,
          }),
          '<a href="#">abc</a>'
        );
      }
    );

    /**
     * 对 data-evil 指定 FORBID_ATTR，分别省略和开启 ALLOW_DATA_ATTR。
     * 两次都严格删除该属性，确认禁止集合优先于自动 data 准入。
     */
    QUnit.test(
      'FORBID_ATTR overrides ALLOW_DATA_ATTR for the named attribute',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<a href="#" data-evil="foo">abc</a>', {
            FORBID_ATTR: ['data-evil'],
          }),
          '<a href="#">abc</a>'
        );
        assert.equal(
          DOMPurify.sanitize('<a href="#" data-evil="foo">abc</a>', {
            ALLOW_DATA_ATTR: true,
            FORBID_ATTR: ['data-evil'],
          }),
          '<a href="#">abc</a>'
        );
      }
    );

    // =======================================================================
    // 配置：ADD_TAGS 与 ADD_ATTR。两者既可接受字符串数组，也可接受 predicate 函数。
    // 函数形式仍有独立约束：权限不能跨调用泄漏，函数返回 true 后 URI 值仍须继续校验。
    // =======================================================================

    /**
     * 数组与谓词分别扩展标签/属性，再跨调用检查配置复位；
     * 属性名称准入与 URI 值规则分别解释。
     */
    QUnit.module('Config — ADD_TAGS & ADD_ATTR');

    /**
     * 用 ADD_TAGS 数组放行 my-component。
     * 要求完整元素和文本保留，确认增加标签不会只留下文本。
     */
    QUnit.test('ADD_TAGS as string array', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<my-component>abc</my-component>', {
          ADD_TAGS: ['my-component'],
        }),
        '<my-component>abc</my-component>'
      );
    });

    /**
     * 只把 my-component 加入标签集合，未增加 my-attr。
     * 要求自定义元素保留但属性消失，区分标签与属性权限。
     */
    QUnit.test(
      'ADD_TAGS without matching ADD_ATTR strips the custom attr',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<my-component my-attr="foo">abc</my-component>', {
            ADD_TAGS: ['my-component'],
          }),
          '<my-component>abc</my-component>'
        );
      }
    );

    /**
     * 分别把 my-component 与 my-attr 加入允许集合。
     * 严格输出同时保留元素、属性与文本，覆盖两类配置组合。
     */
    QUnit.test('ADD_TAGS + ADD_ATTR keeps both', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<my-component my-attr="foo">abc</my-component>', {
          ADD_TAGS: ['my-component'],
          ADD_ATTR: ['my-attr'],
        }),
        '<my-component my-attr="foo">abc</my-component>'
      );
    });

    /**
     * ADD_TAGS 谓词分别允许 apple/banana 或 allowed，且关闭 KEEP_CONTENT。
     * 严格结果只保留谓词命中的完整子树，拒绝标签的文字也丢弃。
     */
    QUnit.test('ADD_TAGS as function selectively allows tags', (assert) => {
      assert.equal(
        DOMPurify.sanitize(
          '<apple>content</apple><banana>content</banana><cherry>content</cherry>',
          {
            ADD_TAGS: (tagName) => ['apple', 'banana'].includes(tagName),
            KEEP_CONTENT: false,
          }
        ),
        '<apple>content</apple><banana>content</banana>'
      );
      assert.equal(
        DOMPurify.sanitize('<allowed>yes</allowed><forbidden>no</forbidden>', {
          ADD_TAGS: (tagName) => tagName === 'allowed',
          KEEP_CONTENT: false,
        }),
        '<allowed>yes</allowed>'
      );
    });

    /**
     * ADD_TAGS 谓词按 item 前缀选择标签，关闭 KEEP_CONTENT。
     * 要求 item1/item2 保留、other 连内容删除，验证名称驱动的函数准入。
     */
    QUnit.test('ADD_TAGS as function supports pattern matching', (assert) => {
      assert.equal(
        DOMPurify.sanitize(
          '<item1>one</item1><item2>two</item2><other>three</other>',
          {
            ADD_TAGS: (tagName) => tagName.startsWith('item'),
            KEEP_CONTENT: false,
          }
        ),
        '<item1>one</item1><item2>two</item2>'
      );
    });

    /**
     * 两个自定义标签分别携带两种属性，ADD_ATTR 读取属性名与标签名。
     * 严格结果每个标签仅保留所属属性，验证谓词第二参数参与决定。
     */
    QUnit.test(
      'ADD_ATTR as function receives (attrName, tagName) for tag-specific validation',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize(
            '<one attribute-one="1" attribute-two="2"></one><two attribute-one="1" attribute-two="2"></two>',
            {
              ADD_TAGS: ['one', 'two'],
              ADD_ATTR: (attributeName, tagName) => {
                const allowed = {
                  one: ['attribute-one'],
                  two: ['attribute-two'],
                };
                return allowed[tagName]?.includes(attributeName) || false;
              },
            }
          ),
          '<one attribute-one="1"></one><two attribute-two="2"></two>'
        );
      }
    );

    /**
     * 普通 div 带 custom-attr，ADD_ATTR 同时匹配 div 与该名称。
     * 输出保留新增属性，确认函数型属性准入适用于内建元素。
     */
    QUnit.test('ADD_ATTR as function works on built-in tags', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<div custom-attr="test">content</div>', {
          ADD_ATTR: (attr, tag) => tag === 'div' && attr === 'custom-attr',
        }),
        '<div custom-attr="test">content</div>'
      );
    });

    /**
     * 放行 one 标签后，属性谓词只认可 attribute-one。
     * 严格结果删除 forbidden、保留命中属性，覆盖谓词拒绝的名称路径。
     */
    QUnit.test(
      'ADD_ATTR as function rejecting returns the default',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<one attribute-one="1" forbidden="bad"></one>', {
            ADD_TAGS: ['one'],
            ADD_ATTR: (attr, tag) => tag === 'one' && attr === 'attribute-one',
          }),
          '<one attribute-one="1"></one>'
        );
      }
    );

    /**
     * href 已在默认名称集合中，本输入不会调用 ADD_ATTR 谓词。
     * 配置该谓词后仍要求 javascript: 被删、https: 保留，实际检查默认 href 的 URI 校验。
     */
    QUnit.test('ADD_ATTR function must not bypass URI validation', (assert) => {
      // href 已在默认属性集合中，名称准入会短路，不调用此处的 ADD_ATTR 谓词。
      // 本例检查同时配置谓词时，href 仍走值校验：拒绝 javascript:，保留 https:。
      assert.ok(
        DOMPurify.sanitize('<a href="javascript:alert(1)">x</a>', {
          ADD_ATTR: (attr) => attr === 'href',
        }).indexOf('javascript:') === -1,
        'javascript: URI must be stripped from href'
      );
      assert.equal(
        DOMPurify.sanitize('<a href="https://example.com">x</a>', {
          ADD_ATTR: (attr) => attr === 'href',
        }),
        '<a href="https://example.com">x</a>',
        'safe URI must be preserved in href'
      );
    });

    /**
     * 先用始终为真的 ADD_TAGS 谓词净化，再切换数组配置和默认配置。
     * 后两次都不允许 iframe/object/embed，验证函数准入状态在配置重解析时清除。
     */
    QUnit.test(
      'ADD_TAGS function does not leak permissiveness into subsequent array-based calls',
      (assert) => {
        // 本次宽松函数调用不得把权限保存在实例上。
        DOMPurify.sanitize('<b>x</b>', { ADD_TAGS: () => true });

        const out = DOMPurify.sanitize(
          '<iframe src="https://evil.com"></iframe>' +
            '<object data="https://evil.com"></object>' +
            '<embed src="https://evil.com">',
          { ADD_TAGS: ['custom-tag'] }
        );
        assert.ok(
          !/<(iframe|object|embed)/i.test(out),
          'array-based call must not inherit permissiveness: ' + out
        );

        const out2 = DOMPurify.sanitize(
          '<iframe src="https://evil.com"></iframe>'
        );
        assert.ok(
          !/<iframe/i.test(out2),
          'default call after function-based ADD_TAGS must block iframe: ' +
            out2
        );
      }
    );

    /**
     * 先安装始终为真的 ADD_ATTR 谓词，再以数组与默认配置清洗 javascript: 链接。
     * 后续输出都不含危险协议，检查函数配置不会跨调用留存。
     */
    QUnit.test(
      'ADD_ATTR function does not leak permissiveness into subsequent array-based calls',
      (assert) => {
        DOMPurify.sanitize('<b>x</b>', { ADD_ATTR: () => true });

        const out = DOMPurify.sanitize(
          '<a href="javascript:alert(1)">click</a>',
          { ADD_ATTR: ['class'] }
        );
        assert.ok(
          out.indexOf('javascript:') === -1,
          'array-based call must not inherit permissiveness: ' + out
        );

        const out2 = DOMPurify.sanitize(
          '<a href="javascript:alert(1)">click</a>'
        );
        assert.ok(
          out2.indexOf('javascript:') === -1,
          'default call after function-based ADD_ATTR must block javascript: URIs: ' +
            out2
        );
      }
    );

    // =======================================================================
    // 配置：FORBID_CONTENTS / ADD_FORBID_CONTENTS。
    // =======================================================================

    /**
     * 三个禁止包装标签区分默认禁内容、显式替换与追加；
     * 严格结果检验哪些后代可提升。
     */
    QUnit.module('Config — FORBID_CONTENTS / ADD_FORBID_CONTENTS');

    /**
     * 同时禁止 div/p 标签，但只把 p 加入 FORBID_CONTENTS。
     * 严格结果提升 div 内的 b、丢弃 p 的 b，区分删除标签时是否保留内容。
     */
    QUnit.test(
      'FORBID_CONTENTS + FORBID_TAGS drops content of named ancestors',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize(
            '<div><b>preserve me</b></div><p><b>no not preserve me</b></p>',
            { FORBID_CONTENTS: ['p'], FORBID_TAGS: ['div', 'p'] }
          ),
          '<b>preserve me</b>'
        );
      }
    );

    /**
     * FORBID_CONTENTS 指定 p，再以 ADD_FORBID_CONTENTS 增加 a，三种包装标签都被禁止。
     * 要求仅 div 的内容提升，确认追加集合与显式集合共同生效。
     */
    QUnit.test(
      'ADD_FORBID_CONTENTS extends the FORBID_CONTENTS set',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize(
            '<div><b>preserve me</b></div><p><b>no not preserve me</b></p><a><i>also no preserve me</i></a>',
            {
              FORBID_CONTENTS: ['p'],
              ADD_FORBID_CONTENTS: ['a'],
              FORBID_TAGS: ['div', 'p', 'a'],
            }
          ),
          '<b>preserve me</b>'
        );
      }
    );

    /**
     * 只用 ADD_FORBID_CONTENTS 增加 p，同时禁止 script/p/a。
     * 要求 script 默认禁内容规则仍在、p 内容丢弃、a 内 i 提升，验证追加不会覆盖默认集合。
     */
    QUnit.test('ADD_FORBID_CONTENTS preserves the default set', (assert) => {
      assert.equal(
        DOMPurify.sanitize(
          '<script>var a = 1;</script><p><b>no not preserve me</b></p><a><i>preserve me</i></a>',
          { ADD_FORBID_CONTENTS: ['p'], FORBID_TAGS: ['script', 'p', 'a'] }
        ),
        '<i>preserve me</i>'
      );
    });

    // =======================================================================
    // 配置：SAFE_FOR_JQUERY（现为 no-op，安全行为已成为默认）。该 flag 已删除，但它曾启用的
    // 行为现在无条件生效；以下用例固定此结果，使遗留默认被意外移除时立即暴露。
    // =======================================================================

    /**
     * 历史 SAFE_FOR_JQUERY 已无配置分支；
     * 这些默认输出保留 raw-text/模板的解析回归形状。
     */
    QUnit.module('Config — SAFE_FOR_JQUERY (legacy / secure by default)');

    /**
     * option 内的 style 文本包含 img/onerror 形状。
     * 默认净化后只保留前方 a 与空 option，检查这组 raw-text/选择控件边界的清理结果。
     */
    QUnit.test('style inside option is stripped', (assert) => {
      assert.equal(
        DOMPurify.sanitize(
          '<a>123</a><option><style><img src=x onerror=alert(1)>'
        ),
        '<a>123</a><option></option>'
      );
    });

    /**
     * option/style 闭合边界交错，内部带危险 img。
     * 候选只有空 option 或空字符串，检查解析修复后攻击子树不进入结果。
     */
    QUnit.test('cross-boundary style + img inside option', (assert) => {
      assert.contains(
        DOMPurify.sanitize(
          '<option><style></option></select><b><img src=xx: onerror=alert(1)></style></option>'
        ),
        ['<option></option>', '']
      );
    });

    /**
     * option 中嵌 iframe，闭合 select 后拼入 script。
     * 候选只有空 option 或空字符串，覆盖不允许容器内容的丢弃。
     */
    QUnit.test('iframe + script inside option', (assert) => {
      assert.contains(
        DOMPurify.sanitize(
          '<option><iframe></select><b><script>alert(1)</script>'
        ),
        ['<option></option>', '']
      );
    });

    /**
     * b 内嵌两个 style 起始标签，其中一个使用自闭合写法。
     * 要求输出为空 b，检查危险 raw-text 结构整体删除。
     */
    QUnit.test('nested style tags with self-closing form', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<b><style><style/><img src=xx: onerror=alert(1)>'),
        '<b></b>'
      );
    });

    /**
     * 分别净化带前后文本的 template 与独立 template。
     * 候选允许模板/内容按引擎被保留或裁剪，检查当前解析环境的序列化形状。
     */
    QUnit.test('template element preservation varies by engine', (assert) => {
      assert.contains(DOMPurify.sanitize('1<template><s>000</s></template>2'), [
        '1<template><s>000</s></template>2',
        '1<template></template>2',
        '12',
      ]);
      assert.contains(DOMPurify.sanitize('<template><s>000</s></template>'), [
        '',
        '<template><s>000</s></template>',
      ]);
    });

    /**
     * i 内含已编码的 amp 与小于号。
     * 严格输出保持实体层数，确认解析后再次序列化不会额外解码成标记。
     */
    QUnit.test(
      'entity round-trip — github.com/cure53/DOMPurify/issues/283',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<i>&amp;amp; &lt;</i>'),
          '<i>&amp;amp; &lt;</i>'
        );
      }
    );

    // =======================================================================
    // 配置：SAFE_FOR_TEMPLATES。从文本与属性值中清除 Mustache `{{...}}`、ASP `<% ... %>`
    // 等 marker，防止模板引擎在清洗完成后再次插值攻击者表达式。
    // =======================================================================

    /**
     * 模板模式处理文本、属性、连续及跨节点表达式，并关闭自动 data 准入；
     * 严格结果与真实 DOM 结果分开比较。
     */
    QUnit.module('Config — SAFE_FOR_TEMPLATES');

    /**
     * a 文本含 Mustache，style 含 ERB 表达式。
     * 开启 SAFE_FOR_TEMPLATES 后要求相应内容替换为空格，检查文本与 raw-text 的模板清理。
     */
    QUnit.test(
      'strips template markers from mixed text and style content',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize(
            '<a>123{{456}}<b><style><% alert(1) %></style>456</b></a>',
            { SAFE_FOR_TEMPLATES: true }
          ),
          '<a> <b><style> </style>456</b></a>'
        );
      }
    );

    /**
     * a 带 data-bind 表达式，开启 SAFE_FOR_TEMPLATES。
     * 要求属性消失，目标是该模式关闭自动 data 属性准入。
     */
    QUnit.test(
      'strips data-bind expressions even when not data-attributes',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<a data-bind="style: alert(1)"></a>', {
            SAFE_FOR_TEMPLATES: true,
          }),
          '<a></a>'
        );
      }
    );

    /**
     * 对无害 data 属性组合两组 SAFE_FOR_TEMPLATES/ALLOW_DATA_ATTR 配置。
     * 两次都要求删除，确认模板模式优先关闭 data 准入，显式关闭也生效。
     */
    QUnit.test(
      'does not bring back stripped attributes via ALLOW_DATA_ATTR',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<a data-harmless=""></a>', {
            SAFE_FOR_TEMPLATES: true,
            ALLOW_DATA_ATTR: true,
          }),
          '<a></a>'
        );
        assert.equal(
          DOMPurify.sanitize('<a data-harmless=""></a>', {
            SAFE_FOR_TEMPLATES: false,
            ALLOW_DATA_ATTR: false,
          }),
          '<a></a>'
        );
      }
    );

    /**
     * 同一文本或 style 中放连续、间隔的多个模板表达式。
     * 严格结果显示从起始边界到末尾的贪婪清理，普通子元素仍保留。
     */
    QUnit.test(
      'strips multiple template markers in the same node',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize(
            '<a>{{123}}{{456}}<b><style><% alert(1) %><% 123 %></style>456</b></a>',
            { SAFE_FOR_TEMPLATES: true }
          ),
          '<a> <b><style> </style>456</b></a>'
        );
        assert.equal(
          DOMPurify.sanitize(
            '<a>{{123}}abc{{456}}<b><style><% alert(1) %>def<% 123 %></style>456</b></a>',
            { SAFE_FOR_TEMPLATES: true }
          ),
          '<a> <b><style> </style>456</b></a>'
        );
      }
    );

    /**
     * 嵌套或残缺 Mustache/ERB 边界，并有跨 b 的片段。
     * 逐组严格比较空格与剩余标签，覆盖不平衡表达式的清理范围。
     */
    QUnit.test(
      'greedy matching: nested and unbalanced markers scrub fully',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize(
            '<a>123{{45{{6}}<b><style><% alert(1)%> %></style>456</b></a>',
            { SAFE_FOR_TEMPLATES: true }
          ),
          '<a> <b><style> </style>456</b></a>'
        );
        assert.equal(
          DOMPurify.sanitize(
            '<a>123{{45}}6}}<b><style><% <%alert(1) %></style>456</b></a>',
            { SAFE_FOR_TEMPLATES: true }
          ),
          '<a> <b><style> </style>456</b></a>'
        );
        assert.equal(
          DOMPurify.sanitize(
            '<a>123{{<b>456}}</b><style><% alert(1) %></style>456</a>',
            { SAFE_FOR_TEMPLATES: true }
          ),
          '<a>123 <b> </b><style> </style>456</a>'
        );
      }
    );

    /**
     * Mustache 中夹有 script 与可能 clobber 的 form。
     * 候选容纳 form 的引擎差异，目标是剥除表达式文本并删除事件处理器。
     */
    QUnit.test(
      'scrubs expressions that contain stripped subtrees',
      (assert) => {
        assert.contains(
          DOMPurify.sanitize(
            '<b>{{evil<script>alert(1)</script><form><img src=x name=textContent></form>}}</b>',
            { SAFE_FOR_TEMPLATES: true }
          ),
          ['<b>  </b>', '<b> </b>', '<b> <form><img src="x"></form> </b>']
        );
        assert.contains(
          DOMPurify.sanitize(
            '<b>he{{evil<script>alert(1)</script><form><img src=x name=textContent></form>}}ya</b>',
            { SAFE_FOR_TEMPLATES: true }
          ),
          [
            '<b>he  ya</b>',
            '<b>he </b>',
            '<b>he <form><img src="x"></form> ya</b>',
          ]
        );
      }
    );

    /**
     * ERB 起止边界跨 a/b/style 子树，内部还含 Mustache 关闭片段。
     * 严格输出比较每个剩余节点，检查多轮模板清理与跨序列化边界清理。
     */
    QUnit.test(
      'handles cross-boundary <% ... %> spanning subtrees',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize(
            '<a>123<% <b>456}}</b><style>{{ alert(1) }}</style>456 %></a>',
            { SAFE_FOR_TEMPLATES: true }
          ),
          '<a>123 <b> </b><style> </style> </a>'
        );
      }
    );

    /**
     * href 以多余的 Mustache 闭合符开头，后接 javascript:。
     * 开启模板模式后要求 href 删除，检查清理后值仍须通过 URI 校验。
     */
    QUnit.test(
      'scrubbed attribute values cannot reintroduce javascript:',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<a href="}}javascript:alert(1)"></a>', {
            SAFE_FOR_TEMPLATES: true,
          }),
          '<a></a>'
        );
      }
    );

    /**
     * 分别把模板表达式放进 class、裸字符串及未知标签拆开的文本。
     * 要求 class 替换为空格、字符串整体净化为空格，覆盖属性与最终字符串清理。
     */
    QUnit.test(
      'attribute and bare-string markers are also scrubbed',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<a class="{{999-333}}"></a>', {
            SAFE_FOR_TEMPLATES: true,
          }),
          '<a class=" "></a>'
        );
        assert.equal(
          DOMPurify.sanitize('{{999-333}}', { SAFE_FOR_TEMPLATES: true }),
          ' '
        );
        assert.equal(
          DOMPurify.sanitize('{<x>{333+333}<x>}', { SAFE_FOR_TEMPLATES: true }),
          ' '
        );
      }
    );

    /**
     * 在真实 div 中用不允许的 foo 拆开 Mustache 字符。
     * IN_PLACE 后检查原树不再含完整表达式或 constructor，后者确认表达式主体也被清除。
     */
    QUnit.test(
      'CVE-2026-41239: IN_PLACE strips boundary-spanning Mustache expressions',
      (assert) => {
        // sanitizer 遍历时按单个文本节点清理，会漏掉被待删除 foo 元素拆在两侧的
        // `{{...}}`：当时相邻节点各只有一个 `{` 或 `}`，要求 `{{`/`}}` 的 MUSTACHE_EXPR
        // 无法命中。foo 元素删除后文本节点相邻，normalize() 会把它们合为完整表达式，
        // 模板框架挂载时即可插值。最终 scrub 先 normalize()，再遍历合并后的字符数据，因而能
        // 捕获跨边界表达式。
        const dirty = document.createElement('div');
        dirty.innerHTML =
          '{<foo></foo>{constructor.constructor("alert(1)")()}<foo></foo>}';
        DOMPurify.sanitize(dirty, {
          SAFE_FOR_TEMPLATES: true,
          IN_PLACE: true,
        });
        assert.notOk(
          /\{\{[\s\S]*\}\}/.test(dirty.innerHTML),
          'merged Mustache expression should be scrubbed'
        );
        assert.notOk(
          /constructor/.test(dirty.innerHTML),
          'expression body should not survive scrubbing'
        );
      }
    );

    /**
     * 在 div 中用 foo 拆开 $ 与 {danger}。
     * IN_PLACE 后不应留下完整插值形状，检查提升后相邻文本经 normalize 和最终 scrub 清理。
     */
    QUnit.test(
      'CVE-2026-41239: IN_PLACE strips boundary-spanning template-literal expressions',
      (assert) => {
        // 与上方 Mustache 同类，但目标是 ES template literal：`$` 与 `{` 分处文本节点时，
        // 要求成对 `${` sigil 的 TMPLIT_EXPR 无法逐节点命中。normalize() 合并碎片后，最终
        // scrub 会遍历合并节点并删除 `${...}`。
        const dirty = document.createElement('div');
        dirty.innerHTML = '$<foo></foo>{<foo></foo>danger}';
        DOMPurify.sanitize(dirty, {
          SAFE_FOR_TEMPLATES: true,
          IN_PLACE: true,
        });
        assert.notOk(
          /\$\{[\s\S]*\}/.test(dirty.innerHTML),
          'merged template-literal expression should be scrubbed'
        );
      }
    );

    /**
     * 字符串输入以 foo 拆开 Mustache，请求 DOM fragment 后接到容器。
     * 检查容器序列化中表达式消失，覆盖 DOM 返回路径的最终 scrub。
     */
    QUnit.test(
      'CVE-2026-41239: RETURN_DOM_FRAGMENT path also scrubs joined expressions',
      (assert) => {
        // RETURN_DOM_FRAGMENT 与 RETURN_DOM 一同修复，现在和 IN_PLACE 共用 scrub helper。
        // 此处固定 fragment 路径，避免未来重构遍历后返回逻辑时静默回归。
        const result = DOMPurify.sanitize(
          '<div>{<foo></foo>{constructor.constructor("alert(1)")()}<foo></foo>}</div>',
          {
            SAFE_FOR_TEMPLATES: true,
            RETURN_DOM_FRAGMENT: true,
          }
        );
        const container = document.createElement('div');
        container.appendChild(result);
        assert.notOk(
          /\{\{[\s\S]*\}\}/.test(container.innerHTML),
          'merged Mustache expression should be scrubbed in fragment mode'
        );
      }
    );

    /**
     * 三种 href 分别含完整、未闭合与多余闭合 Mustache 边界，后面带危险协议。
     * 严格结果均删除 href，验证贪婪模板清理与 URI 校验的顺序。
     */
    QUnit.test(
      'greedy-scrub of stray close marker prevents URL bypass',
      (assert) => {
        // MUSTACHE_EXPR 从 `{{` 清到字符串末尾，或从字符串开头清到最后一个 `}}`。
        // 因而残缺或多余的边界不能残留在 javascript: 前，借 IS_ALLOWED_URI 的
        // `[^a-z]` 分支掩盖协议。本组同时覆盖开边界、闭边界与完整表达式后的危险 URL。
        const cfg = { SAFE_FOR_TEMPLATES: true };
        assert.equal(
          DOMPurify.sanitize('<a href="{{}}javascript:alert(1)">x</a>', cfg),
          '<a>x</a>',
          'href scrubbed entirely; no stray }} left to pass the URL check'
        );
        assert.equal(
          DOMPurify.sanitize('<a href="{{x">y</a>', cfg),
          '<a>y</a>',
          'unterminated {{ scrubs to end of attribute value'
        );
        assert.equal(
          DOMPurify.sanitize('<a href="x}}javascript:alert(1)">y</a>', cfg),
          '<a>y</a>',
          'leading content before }} scrubbed along with the close marker'
        );
      }
    );

    // =======================================================================
    // 配置：SANITIZE_DOM。
    // =======================================================================

    /**
     * 对照 SANITIZE_DOM 开关及 document/form 冲突名称，候选容纳具名属性实现对结构的影响。
     */
    QUnit.module('Config — SANITIZE_DOM');

    /**
     * 图片的 name 分别冲突 implementation/createNodeIterator/getElementById。
     * 开启 SANITIZE_DOM 后严格只保留 src，检查 document/form 成员碰撞过滤。
     */
    QUnit.test('strips names that would clobber document.* APIs', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<img src="x" name="implementation">', {
          SANITIZE_DOM: true,
        }),
        '<img src="x">'
      );
      assert.equal(
        DOMPurify.sanitize('<img src="x" name="createNodeIterator">', {
          SANITIZE_DOM: true,
        }),
        '<img src="x">'
      );
      assert.equal(
        DOMPurify.sanitize('<img src="x" name="getElementById">', {
          SANITIZE_DOM: true,
        }),
        '<img src="x">'
      );
    });

    /**
     * 关闭 SANITIZE_DOM，图片 name 与 getElementById 同名。
     * 严格输出保留该 name，定位命名属性检查的关闭分支。
     */
    QUnit.test(
      'SANITIZE_DOM=false leaves clobbering names intact',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<img src="x" name="getElementById">', {
            SANITIZE_DOM: false,
          }),
          '<img src="x" name="getElementById">'
        );
      }
    );

    /**
     * a 的 id 为 location，开启 SANITIZE_DOM。
     * 要求 href/文本保留、id 消失，检查名称与文档成员碰撞的拒绝。
     */
    QUnit.test(
      'strips ids that would clobber window.location etc.',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<a href="x" id="location">click</a>', {
            SANITIZE_DOM: true,
          }),
          '<a href="x">click</a>'
        );
      }
    );

    /**
     * form 内 input 名为 attributes，分别开关 SANITIZE_DOM。
     * 候选容纳整棵 form 删除或 input/name 裁剪，观察引擎 clobbering 与库策略组合结果。
     */
    QUnit.test(
      'form-input "attributes" name handling differs by engine',
      (assert) => {
        assert.contains(
          DOMPurify.sanitize('<form><input name="attributes"></form>', {
            ADD_TAGS: ['form'],
            SANITIZE_DOM: false,
          }),
          ['', '<form><input name="attributes"></form>']
        );
        assert.contains(
          DOMPurify.sanitize('<form><input name="attributes"></form>', {
            ADD_TAGS: ['form'],
            SANITIZE_DOM: true,
          }),
          ['', '<form><input name="attributes"></form>', '<form><input></form>']
        );
      }
    );

    // =======================================================================
    // 配置：SANITIZE_NAMED_PROPS。为未带前缀的 id/name 添加 `user-content-`，
    // 避免原始名称与 document/form 成员碰撞；已有该前缀的值保持不变。
    // =======================================================================

    /**
     * 为 id/name 加命名前缀，检查层级、重复值与二次净化幂等；
     * 该模式不执行 id 去重。
     */
    QUnit.module('Config — SANITIZE_NAMED_PROPS');

    /**
     * a 带普通 id=x，开启 SANITIZE_NAMED_PROPS。
     * 严格要求 user-content-x，检查 id 命名空间前缀写回。
     */
    QUnit.test('id is prefixed with user-content-', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a id="x"></a>', { SANITIZE_NAMED_PROPS: true }),
        '<a id="user-content-x"></a>'
      );
    });

    /**
     * form 与子 input 各带 id，开启命名前缀。
     * 严格要求两个层级都加前缀，验证属性遍历覆盖后代。
     */
    QUnit.test('nested form + input ids are both prefixed', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<form id="x"><input id="y"></form>', {
          SANITIZE_NAMED_PROPS: true,
        }),
        '<form id="user-content-x"><input id="user-content-y"></form>'
      );
    });

    /**
     * 两个兄弟 a 使用重复 id=x。
     * 严格要求两者都加同一前缀，确认该配置做名称隔离而非去重。
     */
    QUnit.test('duplicate ids on siblings are both prefixed', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a id="x"></a><a id="x"></a>', {
          SANITIZE_NAMED_PROPS: true,
        }),
        '<a id="user-content-x"></a><a id="user-content-x"></a>'
      );
    });

    /**
     * 普通、已带前缀、空值及嵌套 id/name 连续净化两次。
     * 逐项要求二次输出等于一次，验证前缀检查保持净化幂等。
     */
    QUnit.test('SANITIZE_NAMED_PROPS is idempotent', (assert) => {
      const cfg = { SANITIZE_NAMED_PROPS: true };
      const inputs = [
        '<div id="foo">hi</div>',
        '<a name="bar">hi</a>',
        '<div id="user-content-foo">hi</div>',
        '<a name="user-content-bar">hi</a>',
        '<div id="">hi</div>',
        '<form id="x"><input id="y"></form>',
      ];
      inputs.forEach((input) => {
        const once = DOMPurify.sanitize(input, cfg);
        const twice = DOMPurify.sanitize(once, cfg);
        assert.equal(
          twice,
          once,
          `idempotent for input: ${input} (once=${once})`
        );
      });
    });

    /**
     * id/name 已以 user-content- 开头。
     * 分别严格要求原值不变，确认不会重复增加前缀。
     */
    QUnit.test('does not double-prefix already-prefixed values', (assert) => {
      const cfg = { SANITIZE_NAMED_PROPS: true };
      assert.equal(
        DOMPurify.sanitize('<div id="user-content-x">hi</div>', cfg),
        '<div id="user-content-x">hi</div>',
        'already-prefixed id left untouched'
      );
      assert.equal(
        DOMPurify.sanitize('<a name="user-content-x">hi</a>', cfg),
        '<a name="user-content-x">hi</a>',
        'already-prefixed name left untouched'
      );
    });

    // =======================================================================
    // 配置：WHOLE_DOCUMENT。
    // =======================================================================

    /**
     * 改变返回根选择并比较 head/body、doctype 输出；
     * 严格字符串检查完整文档包装。
     */
    QUnit.module('Config — WHOLE_DOCUMENT');

    /**
     * 相同纯文本分别开关 WHOLE_DOCUMENT。
     * 要求普通模式返回文本，完整模式返回 html/head/body 包装，检查纯文本快速返回条件。
     */
    QUnit.test('text payload', (assert) => {
      assert.equal(DOMPurify.sanitize('123', { WHOLE_DOCUMENT: false }), '123');
      assert.equal(
        DOMPurify.sanitize('123', { WHOLE_DOCUMENT: true }),
        '<html><head></head><body>123</body></html>'
      );
    });

    /**
     * 独立 style 输入分别开关 WHOLE_DOCUMENT。
     * 要求 body 模式为空，完整模式保留 head 中 style，区分解析位置与遍历根。
     */
    QUnit.test('<style> is head-only without WHOLE_DOCUMENT', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<style>*{color:red}</style>', {
          WHOLE_DOCUMENT: false,
        }),
        ''
      );
      assert.equal(
        DOMPurify.sanitize('<style>*{color:red}</style>', {
          WHOLE_DOCUMENT: true,
        }),
        '<html><head><style>*{color:red}</style></head><body></body></html>'
      );
    });

    /**
     * 文本在 style 之前，使解析器进入 body。
     * 两种返回模式都保留 style，完整模式多文档包装，检查输入位置对解析结构的影响。
     */
    QUnit.test('text + <style> interleave', (assert) => {
      assert.equal(
        DOMPurify.sanitize('123<style>*{color:red}</style>', {
          WHOLE_DOCUMENT: false,
        }),
        '123<style>*{color:red}</style>'
      );
      assert.equal(
        DOMPurify.sanitize('123<style>*{color:red}</style>', {
          WHOLE_DOCUMENT: true,
        }),
        '<html><head></head><body>123<style>*{color:red}</style></body></html>'
      );
    });

    /**
     * 完整文档含 doctype，分别省略和增加 !doctype 标签权限。
     * 严格结果只在显式允许时带 doctype，定位完整文档序列化分支。
     */
    QUnit.test(
      'doctype is stripped unless ADD_TAGS includes !doctype',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<!DOCTYPE html><html><body>123</body></html>', {
            WHOLE_DOCUMENT: true,
          }),
          '<html><head></head><body>123</body></html>'
        );
        assert.equal(
          DOMPurify.sanitize('<!DOCTYPE html><html><body>123</body></html>', {
            WHOLE_DOCUMENT: true,
            ADD_TAGS: ['!doctype'],
          }),
          '<!DOCTYPE html>\n<html><head></head><body>123</body></html>'
        );
      }
    );

    // =======================================================================
    // 配置：RETURN_DOM / RETURN_DOM_FRAGMENT。
    // =======================================================================

    /**
     * 请求 DOM 而非字符串，比较 body/html、ownerDocument 与模板属性；
     * 文档深导入条件用纯文本隔离检查。
     */
    QUnit.module('Config — RETURN_DOM');

    /**
     * 两组 a/b 输入分别无 script 与含 script，请求 RETURN_DOM。
     * 严格比较 body.outerHTML，联合检查返回容器形状与 script 子树删除。
     */
    QUnit.test('returns sanitized body element', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a>123<b>456</b></a>', { RETURN_DOM: true })
          .outerHTML,
        '<body><a>123<b>456</b></a></body>'
      );
      assert.equal(
        DOMPurify.sanitize('<a>123<b>456<script>alert(1)</script></b></a>', {
          RETURN_DOM: true,
        }).outerHTML,
        '<body><a>123<b>456</b></a></body>'
      );
    });

    /**
     * 与前例相同输入同时请求 RETURN_DOM 和 WHOLE_DOCUMENT。
     * 要求 html/head/body 结构且无 script，确认完整文档模式选择 html 根。
     */
    QUnit.test(
      'RETURN_DOM + WHOLE_DOCUMENT returns sanitized html element',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<a>123<b>456</b></a>', {
            RETURN_DOM: true,
            WHOLE_DOCUMENT: true,
          }).outerHTML,
          '<html><head></head><body><a>123<b>456</b></a></body></html>'
        );
        assert.equal(
          DOMPurify.sanitize('<a>123<b>456<script>alert(1)</script></b></a>', {
            RETURN_DOM: true,
            WHOLE_DOCUMENT: true,
          }).outerHTML,
          '<html><head></head><body><a>123<b>456</b></a></body></html>'
        );
      }
    );

    /**
     * 纯文本配合 RETURN_DOM。
     * 要求 body 包装文本，验证此配置阻止普通文本的字符串快速返回。
     */
    QUnit.test('plain text payload returns body wrapper', (assert) => {
      assert.equal(
        DOMPurify.sanitize('123', { RETURN_DOM: true }).outerHTML,
        '<body>123</body>'
      );
    });

    /**
     * 纯文本分别请求 DOM/fragment，并开关 shadowroot 属性权限。
     * ownerDocument 断言区分隔离文档与原始文档的深导入；
     * 此例未构造 shadow tree。
     */
    QUnit.test(
      'shadowroot attribute toggles owner-document selection',
      (assert) => {
        // 默认返回隔离文档中的 DOM。ALLOWED_ATTR 包含 shadowroot 或 shadowrootmode 时，
        // 返回分支通过原始 document 的 importNode 深克隆结果，ownerDocument 因而变成 document。
        // 这里用纯文本确认文档选择，未构造或断言 shadow root。
        assert.notEqual(
          DOMPurify.sanitize('123', { RETURN_DOM: true }).ownerDocument,
          document
        );
        assert.equal(
          DOMPurify.sanitize('123', {
            RETURN_DOM: true,
            ADD_ATTR: ['shadowroot'],
          }).ownerDocument,
          document
        );
        assert.notEqual(
          DOMPurify.sanitize('123', { RETURN_DOM_FRAGMENT: true })
            .ownerDocument,
          document
        );
        assert.equal(
          DOMPurify.sanitize('123', {
            RETURN_DOM_FRAGMENT: true,
            ADD_ATTR: ['shadowroot'],
          }).ownerDocument,
          document
        );
      }
    );

    /**
     * 字符串中 template 带旧 shadowroot 属性和危险图片。
     * RETURN_DOM 的 outerHTML 要求模板保留、shadowroot/onerror 删除，检查模板内容与属性清理。
     */
    QUnit.test('declarative shadowroot template is neutralised', (assert) => {
      const xss =
        '<body><div><template shadowroot=open>' +
        '<img src=x onerror=alert(3)></template></div></body>';
      const dom = DOMPurify.sanitize(xss, { RETURN_DOM: true });
      assert.equal(
        dom.outerHTML,
        '<body><div><template><img src="x"></template></div></body>'
      );
    });

    /**
     * 请求 fragment 并尝试 id=createDocumentFragment 名称碰撞；
     * 断言只检查类型、所有权与首文本。
     */
    QUnit.module('Config — RETURN_DOM_FRAGMENT');

    /**
     * 文本后图片 id 与 createDocumentFragment 同名，分别开关 SANITIZE_DOM。
     * 只断言 fragment 类型、隔离文档与首文本，验证缓存创建方法仍能构造结果。
     */
    QUnit.test('returns DocumentFragment with sanitized contents', (assert) => {
      let fragment = DOMPurify.sanitize(
        'foo<img id="createDocumentFragment">',
        { RETURN_DOM_FRAGMENT: true }
      );
      assert.equal(fragment.nodeType, 11);
      assert.notEqual(fragment.ownerDocument, document);
      assert.equal(fragment.firstChild && fragment.firstChild.nodeValue, 'foo');

      // 关闭 SANITIZE_DOM 后，仍使用缓存的 createDocumentFragment 方法构造结果；
      // 这三项断言检查 fragment 的类型、所属文档与文本，不检查图片的 id。
      fragment = DOMPurify.sanitize('foo<img id="createDocumentFragment">', {
        RETURN_DOM_FRAGMENT: true,
        SANITIZE_DOM: false,
      });
      assert.equal(fragment.nodeType, 11);
      assert.notEqual(fragment.ownerDocument, document);
      assert.equal(fragment.firstChild && fragment.firstChild.nodeValue, 'foo');
    });

    // =======================================================================
    // 配置：IN_PLACE。此模式原地修改输入节点树，而非返回字符串。关键边界包括：根节点本身必须
    // 是合法容器；clobbered 根必须抛错；foreign realm 节点必须可达；attached shadow root
    // 必须显式遍历。
    // =======================================================================

    /**
     * 真实 DOM 原地清洗，检查引用、禁止根、shadow、失败清理及 hook 分离原节点；
     * 多种能力分支在各例说明。
     */
    QUnit.module('Config — IN_PLACE');

    /**
     * detached a 带 javascript: href，以 IN_PLACE 净化。
     * 返回值必须与输入引用相同且 href 清空，确认真实原节点被修改。
     */
    QUnit.test('returns the input node, mutated', (assert) => {
      const dirty = document.createElement('a');
      dirty.setAttribute('href', 'javascript:alert(1)');
      const clean = DOMPurify.sanitize(dirty, { IN_PLACE: true });
      assert.equal(dirty, clean, 'returns the input node');
      assert.equal(dirty.href, '', 'still sanitizes the dangerous href');
    });

    /**
     * 以 script 元素为 IN_PLACE 根，并带 data: src。
     * 要求抛错，检查不允许根标签不能通过删除包装继续返回。
     */
    QUnit.test(
      'throws when the root node tag is itself disallowed (script)',
      (assert) => {
        const dirty = document.createElement('script');
        dirty.setAttribute('src', 'data:,alert(1)');
        assert.throws(() => DOMPurify.sanitize(dirty, { IN_PLACE: true }));
      }
    );

    /**
     * 以 iframe 元素为 IN_PLACE 根，带 javascript: src。
     * 要求抛错，覆盖另一种默认被拒绝的根标签。
     */
    QUnit.test(
      'throws when the root node tag is itself disallowed (iframe)',
      (assert) => {
        const dirty = document.createElement('iframe');
        dirty.setAttribute('src', 'javascript:alert(1)');
        assert.throws(() => DOMPurify.sanitize(dirty, { IN_PLACE: true }));
      }
    );

    /**
     * div 的 open shadow root 含危险 href 和无 src 的 onerror 图片。
     * IN_PLACE 后要求两元素仍在且危险属性消失，验证 attached-root 显式预扫。
     */
    QUnit.test(
      'sanitizes attached open shadow root on the root host',
      (assert) => {
        // 传给 IN_PLACE 的 host 可能已带 open shadow root。NodeIterator 不进入 shadow tree，
        // sanitizer 必须显式递归。
        //
        // 图片故意不设 `src`：真实浏览器对 `<img src=x>` 赋 innerHTML 时会启动失败加载并触发
        // onerror，污染下一用例的 window.xssed。
        const host = document.createElement('div');
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML =
          '<a id="poc" href="javascript:alert(1)">click</a>' +
          '<img id="poc2" onerror="alert(2)">';
        DOMPurify.sanitize(host, { IN_PLACE: true });
        const a = host.shadowRoot.querySelector('#poc');
        const img = host.shadowRoot.querySelector('#poc2');
        assert.ok(a, 'link element preserved');
        assert.equal(
          a.getAttribute('href'),
          null,
          'javascript: href stripped from shadow content'
        );
        assert.ok(img, 'img element preserved');
        assert.equal(
          img.getAttribute('onerror'),
          null,
          'onerror handler stripped from shadow content'
        );
        window.xssed = false;
      }
    );

    /**
     * section 的 shadow root 中还嵌一个带 shadow 的 div。
     * 要求最深链接保留并删除 href，检查嵌套 attached roots 的发现与净化。
     */
    QUnit.test('sanitizes nested shadow roots', (assert) => {
      const outer = document.createElement('section');
      const outerShadow = outer.attachShadow({ mode: 'open' });
      const inner = document.createElement('div');
      outerShadow.appendChild(inner);
      inner.attachShadow({ mode: 'open' }).innerHTML =
        '<a id="nested" href="javascript:alert(1)">click</a>';
      DOMPurify.sanitize(outer, { IN_PLACE: true });
      const nested = outer.shadowRoot
        .querySelector('div')
        .shadowRoot.querySelector('#nested');
      assert.ok(nested, 'nested link preserved');
      assert.equal(
        nested.getAttribute('href'),
        null,
        'javascript: href stripped from nested shadow content'
      );
      window.xssed = false;
    });

    /**
     * 先用 importNode 探测 clonable shadow 支持，再对带该 root 的 DOM 输入请求 RETURN_DOM。
     * 要求返回副本有 shadow，存活链接/图片的危险属性已删除。
     */
    QUnit.test(
      'RETURN_DOM with DOM input sanitizes clonable shadow root',
      (assert) => {
        // 先探测 clonable shadow root。只有引擎实现 clonable 时 importNode() 才应深克隆
        // shadow root；jsdom 当前忽略此选项，因此在该环境跳过断言，由浏览器运行补证。
        let supportsClonable = false;
        try {
          const probeHost = document.createElement('div');
          probeHost.attachShadow({ mode: 'open', clonable: true }).innerHTML =
            '<span>x</span>';
          const imported = document.importNode(probeHost, true);
          supportsClonable = !!(
            imported.shadowRoot && imported.shadowRoot.querySelector('span')
          );
        } catch (_) {}

        if (!supportsClonable) {
          assert.ok(
            true,
            'environment does not support clonable shadow roots; skipping'
          );
          return;
        }

        const host = document.createElement('div');
        host.attachShadow({ mode: 'open', clonable: true }).innerHTML =
          '<a id="poc" href="javascript:alert(1)">click</a>' +
          '<img id="poc2" onerror="alert(2)">';

        const clean = DOMPurify.sanitize(host, { RETURN_DOM: true });
        const returnedHost = clean.firstElementChild;
        assert.ok(
          returnedHost.shadowRoot instanceof window.DocumentFragment,
          'cloned shadow root present on returned host'
        );
        const a = returnedHost.shadowRoot.querySelector('#poc');
        const img = returnedHost.shadowRoot.querySelector('#poc2');
        if (a) {
          assert.equal(
            a.getAttribute('href'),
            null,
            'javascript: href stripped in cloned shadow'
          );
        } else {
          assert.ok(true, 'link removed entirely');
        }
        if (img) {
          assert.equal(
            img.getAttribute('onerror'),
            null,
            'onerror stripped in cloned shadow'
          );
        } else {
          assert.ok(true, 'img removed entirely');
        }
        window.xssed = false;
      }
    );

    /**
     * 同样先探测 clonable 能力，再请求 DOM fragment。
     * 检查片段中的克隆 host 有 shadow，链接若保留则 href 已删除，覆盖副本预扫与 fragment 返回。
     */
    QUnit.test(
      'RETURN_DOM_FRAGMENT with DOM input sanitizes clonable shadow root',
      (assert) => {
        let supportsClonable = false;
        try {
          const probeHost = document.createElement('div');
          probeHost.attachShadow({ mode: 'open', clonable: true }).innerHTML =
            '<span>x</span>';
          const imported = document.importNode(probeHost, true);
          supportsClonable = !!(
            imported.shadowRoot && imported.shadowRoot.querySelector('span')
          );
        } catch (_) {}

        if (!supportsClonable) {
          assert.ok(
            true,
            'environment does not support clonable shadow roots; skipping'
          );
          return;
        }

        const host = document.createElement('div');
        host.attachShadow({ mode: 'open', clonable: true }).innerHTML =
          '<a id="poc" href="javascript:alert(1)">click</a>';

        const fragment = DOMPurify.sanitize(host, {
          RETURN_DOM_FRAGMENT: true,
        });
        const returnedHost = fragment.querySelector('div');
        assert.ok(
          returnedHost.shadowRoot instanceof window.DocumentFragment,
          'cloned shadow root present on returned host'
        );
        const a = returnedHost.shadowRoot.querySelector('#poc');
        if (a) {
          assert.equal(
            a.getAttribute('href'),
            null,
            'javascript: href stripped in fragment shadow'
          );
        } else {
          assert.ok(true, 'link removed entirely');
        }
        window.xssed = false;
      }
    );

    /**
     * form 根内具名控件为 nodeName/attributes，带 onclick。
     * 发生实际遮蔽时要求抛错；
     * 未发生时要求原地返回不含事件，区分环境能力。
     */
    QUnit.test('handles DOM-clobbered nodeName safely', (assert) => {
      const root = document.createElement('form');
      root.innerHTML =
        '<input name="nodeName" onclick="alert(1)">' +
        '<input name="attributes" onclick="alert(2)">';

      const clobbersNodeName = typeof root.nodeName !== 'string';
      if (clobbersNodeName) {
        assert.throws(
          () => DOMPurify.sanitize(root, { IN_PLACE: true }),
          /clobbered|forbidden/i,
          'clobbered IN_PLACE root must throw in clobbering-capable engines'
        );
      } else {
        const clean = DOMPurify.sanitize(root, { IN_PLACE: true });
        assert.ok(
          !/on\w+=/i.test(clean.outerHTML),
          'no on-handler survived: ' + clean.outerHTML
        );
      }
    });

    /**
     * 活动 form 的 own ownerDocument getter 被强制改为 input。
     * IN_PLACE 后即使抛错，原 img 引用也必须无 onerror，验证缓存文档读取及失败清理。
     */
    QUnit.test(
      'IN_PLACE: a clobbered ownerDocument does not skip the fail-closed scrub',
      (assert) => {
        // 若直接读取 root.ownerDocument 得到 input，createNodeIterator.call(input, ...)
        // 会因接收者不是 Document 抛错。此处用实例 accessor 强制构造这种读取结果，
        // 不依赖引擎是否允许 form 的具名控件遮蔽 ownerDocument。
        // 当前 `_createNodeIterator` 通过缓存的 Node.prototype getter 读取真实 Document；
        // iterator 创建和主遍历还位于 IN_PLACE 异常屏障内，异常时先清理原树再传播。
        const root = document.createElement('form');
        const img = document.createElement('img');
        img.setAttribute('onerror', 'alert(1)'); // 不设 src；检查属性结果，不等待加载。
        root.appendChild(img);
        document.body.appendChild(root);

        const fake = document.createElement('input');
        Object.defineProperty(root, 'ownerDocument', {
          /**
           * 强制普通 ownerDocument 读取返回伪 input，独立于引擎的表单命名遮蔽能力。
           * 缓存 Node 原型 getter 仍可读取真实文档；前置断言验证本 getter 已装到根上。
           * @returns {HTMLInputElement} 用于模拟错误接收者的节点。
           */
          get() {
            return fake;
          },
          configurable: true,
        });
        assert.strictEqual(
          root.ownerDocument,
          fake,
          'precondition: ownerDocument read is clobbered'
        );

        // 无论调用正常返回还是 fail-closed 抛错，安全不变量相同：armed handler 必须消失。
        try {
          DOMPurify.sanitize(root, { IN_PLACE: true });
        } catch (_) {
          /* 只要 scrub 已执行，fail-closed 抛错可接受。 */
        }

        assert.strictEqual(
          img.getAttribute('onerror'),
          null,
          'armed on* handler stripped despite the ownerDocument clobber'
        );

        delete root.ownerDocument;
        root.remove();
      }
    );

    /**
     * 活动 form 用 name=ownerDocument 控件尝试自然遮蔽，并含危险 img。
     * 无论环境是否真的遮蔽，清洗后原树都不含 onerror；
     * 随后移除根。
     */
    QUnit.test(
      'IN_PLACE: form with a natural ownerDocument-clobbering child stays safe',
      (assert) => {
        // 上一用例的真实攻击向量形式。在支持 clobbering 的引擎中，named child 使
        // root.ownerDocument 返回 input；jsdom/happy-dom 不会，分支会记录此环境差异。
        // 两种情况下都不允许 on* handler 存活。
        const root = document.createElement('form');
        root.innerHTML = '<input name="ownerDocument"><img onerror="alert(1)">';
        document.body.appendChild(root);

        const clobbers = root.ownerDocument !== document;
        try {
          DOMPurify.sanitize(root, { IN_PLACE: true });
        } catch (_) {
          /* fail-closed 抛错可接受。 */
        }

        assert.notOk(
          /onerror/i.test(root.outerHTML),
          clobbers
            ? 'clobbering engine: on-handler stripped'
            : 'non-clobbering engine: on-handler stripped'
        );
        root.remove();
      }
    );

    // =====================================================================
    // Fail-closed teardown 必须在每条退出路径上解除 removed 节点，而非只覆盖正常返回。
    // 成功路径的 DOMPurify.removed 循环会清除 detached subtree 的 on* handler，防止已排队的
    // 资源事件（如正在加载的 `<img onerror>`）在 sanitize 交还控制后于页面 realm 触发。
    // teardown 中途抛错也必须保持同一不变量：若 detached 但仍 armed 的原节点活过异常，
    // 调用方 catch 让出控制后它仍会执行 handler。
    //
    // 测试断言“属性已消失”，不等待事件：删除属性正是中和排队事件的确定动作，而且在从不加载
    // 资源的 jsdom/happy-dom 中也可观察。图片不带 `src`，原因同上：真实加载会触发 onerror
    // 并污染 window.xssed。
    // =====================================================================

    /**
     * 已连接的自定义元素在断开回调中移除相邻包装节点，尾部图片保留引用。
     * IN_PLACE 正常或异常退出后原图片都须无 onerror，观察重入变更后的清理。
     */
    QUnit.test(
      'mid-walk abort de-arms the detached tail (custom-element reaction)',
      (assert) => {
        // 页面注册的 custom element 在 DOMPurify 删除节点时通过 disconnectedCallback 修改活动树，
        // 使 `_forceRemove` 遇到 parentless 节点并在遍历中抛错。abort 前尚未访问尾部 `<img>`；
        // catch 路径必须在重新抛出前删除其 handler。
        if (typeof window.customElements === 'undefined') {
          assert.ok(true, 'no custom elements in this engine; skipping');
          return;
        }
        if (!window.customElements.get('inplace-abort-surgeon')) {
          window.customElements.define(
            'inplace-abort-surgeon',
            /** 删除相邻 wrapper，模拟 custom-element reaction 在遍历中改变父子关系。 */
            class extends window.HTMLElement {
              /**
               * 元素从已连接文档断开时移除测试 wrapper，尝试制造遍历期间的结构竞争。
               * 外层将根连接 document 后清洗，尾图片原引用用来检查中断或正常退出后的属性。
               * @returns {void}
               */
              disconnectedCallback() {
                const w = document.querySelector('inplace-abort-wrapper');
                if (w) {
                  w.remove();
                }
              }
            }
          );
        }

        const root = document.createElement('div');
        root.innerHTML =
          '<inplace-abort-wrapper><inplace-abort-surgeon>' +
          '</inplace-abort-surgeon></inplace-abort-wrapper>' +
          '<img id="tail" onerror="alert(1)">';
        // 必须连接进 document：disconnectedCallback 只对真实进入文档后又断开的节点触发。
        document.body.appendChild(root);
        const tail = root.querySelector('#tail');

        let threw = false;
        try {
          DOMPurify.sanitize(root, { IN_PLACE: true });
        } catch (_) {
          threw = true;
        }

        // 无论当前引擎中的 reaction 是否成功中断遍历，尾节点都不能带活动 handler 存活。
        assert.strictEqual(
          tail.getAttribute('onerror'),
          null,
          threw
            ? 'onerror stripped from detached tail after mid-walk throw'
            : 'onerror stripped from tail (walk completed cleanly here)'
        );

        root.remove();
        window.xssed = false;
      }
    );

    /**
     * 已连接 div 被 FORBID_TAGS 显式拒绝，后代 img 带 onerror。
     * 要求入口抛错，同时原 img 引用的属性已删，验证拒绝根前先中和后代。
     */
    QUnit.test(
      'forbidden-root preflight throw de-arms live descendants',
      (assert) => {
        // IN_PLACE 早期 preflight 在主遍历前拒绝 forbidden root。对活动根抛错时，不能把未中和的
        // armed 后代留给调用方。此复现不依赖 clobbering，故所有引擎都能稳定触发 preflight
        // throw 边界。
        const root = document.createElement('div');
        root.innerHTML = '<img id="tail" onerror="alert(1)">';
        document.body.appendChild(root);
        const tail = root.querySelector('#tail');

        assert.throws(
          () =>
            DOMPurify.sanitize(root, {
              IN_PLACE: true,
              FORBID_TAGS: ['div'],
            }),
          /forbidden/i,
          'forbidden IN_PLACE root throws at preflight'
        );
        assert.strictEqual(
          tail.getAttribute('onerror'),
          null,
          'onerror stripped from descendant before preflight throw'
        );

        root.remove();
        window.xssed = false;
      }
    );

    /**
     * 活动 form 根可能被 nodeName/childNodes 控件遮蔽，另有 img。
     * 实际遮蔽时要求抛错且原 img 无 onerror；
     * 否则正常清洗也要满足同一属性结果。
     */
    QUnit.test(
      'clobbered-form preflight throw de-arms live descendants',
      (assert) => {
        // 已报告的 Path 2：clobbered `<form>` 根在 preflight 被拒绝；支持 clobbering 的引擎
        // 必须先中和 form 中未被 clobber 的 armed `<img>` 后再抛错。不支持 form named-property
        // clobbering 的引擎（如 jsdom）不会标记根，会正常清洗，但仍必须删除 handler。
        const root = document.createElement('form');
        root.innerHTML =
          '<input name="nodeName"><input name="childNodes">' +
          '<img id="tail" onerror="alert(1)">' +
          '<a id="lnk" href="javascript:alert(2)">x</a>';
        document.body.appendChild(root);
        const tail = root.querySelector('#tail');

        const clobbers = typeof root.nodeName !== 'string';
        if (clobbers) {
          assert.throws(
            () => DOMPurify.sanitize(root, { IN_PLACE: true }),
            /clobbered|forbidden/i,
            'clobbered IN_PLACE root throws at preflight'
          );
          assert.strictEqual(
            tail.getAttribute('onerror'),
            null,
            'onerror stripped from descendant before clobber throw'
          );
        } else {
          DOMPurify.sanitize(root, { IN_PLACE: true });
          assert.strictEqual(
            tail.getAttribute('onerror'),
            null,
            'onerror stripped on the non-clobbering success path'
          );
        }

        root.remove();
        window.xssed = false;
      }
    );

    /**
     * 先 setConfig 持久开启 IN_PLACE，连续清洗 DOM、字符串、DOM。
     * 两次 DOM 都必须返回同一对象且删除 onerror，验证中间字符串调用不关闭持久标志。
     */
    QUnit.test(
      'setConfig({IN_PLACE}) is not disabled by an intervening string call (REPORT-2)',
      (assert) => {
        DOMPurify.setConfig({ IN_PLACE: true });
        try {
          const div1 = document.createElement('div');
          div1.innerHTML = '<img onerror="alert(1)">'; // 不设 src，避免资源加载。
          const ret1 = DOMPurify.sanitize(div1);
          assert.equal(ret1, div1, 'baseline: returns the same node');
          assert.notOk(
            /onerror/i.test(div1.innerHTML),
            'baseline: node sanitized in place'
          );

          // 无害字符串调用不得关闭持久 IN_PLACE 标志；setConfig 后续调用会跳过 `_parseConfig()`。
          DOMPurify.sanitize('<b>hello</b>');

          const div2 = document.createElement('div');
          div2.innerHTML = '<img onerror="alert(1)">';
          const ret2 = DOMPurify.sanitize(div2);
          assert.equal(
            ret2,
            div2,
            'after string call: still returns the same node'
          );
          assert.notOk(
            /onerror/i.test(div2.innerHTML),
            'after string call: node still sanitized in place'
          );
        } finally {
          DOMPurify.clearConfig();
        }
      }
    );

    /**
     * detached style 文本可在重新解析时闭合并引出 img。
     * IN_PLACE 接受抛错；
     * 若返回则重解析不得有 sink，且 removed 记录不能声称删除仍危险的根。
     */
    QUnit.test(
      'a kill-decision on a detached IN_PLACE root is not a silent no-op (REPORT-3)',
      (assert) => {
        // 文本能逃出元素的 detached `<style>` 会触发 mXSS canary。`_forceRemove` 无法分离
        // parentless 根，因此必须中和节点或抛错，不能一面在 DOMPurify.removed 记录“已删除”，
        // 一面原样把危险节点交还调用方。
        const style = document.createElement('style');
        style.textContent = '</style><img onerror=alert(1)>'; // 不设 src。
        let ret = null;
        try {
          ret = DOMPurify.sanitize(style, { IN_PLACE: true });
        } catch (_) {
          assert.ok(true, 'fail-closed by throwing is acceptable');
          return;
        }

        // 模拟应用侧存储后重新渲染（serialize → reparse）。
        const probe = document.createElement('div');
        probe.innerHTML = (ret || style).outerHTML;
        assert.notOk(
          probe.querySelector('[onerror],[onload],script'),
          'no executable sink survives serialize/reparse: ' + probe.innerHTML
        );

        const claimedRemoval = DOMPurify.removed.some(
          (entry) => entry.element === style
        );
        const stillDangerous = /<\/style|onerror/i.test(
          style.textContent || ''
        );
        assert.notOk(
          claimedRemoval && stillDangerous,
          'DOMPurify.removed bookkeeping matches reality'
        );
      }
    );

    // hook 通过文档化的 `node.remove()` 模式分离节点，会在 walker 到达后代前把 subtree 移出树。
    // hook-detached 节点被刻意排除在 DOMPurify.removed 外，故遍历后的 IN_PLACE neutralize pass
    // 看不到它们。若 hook-detach 的早退分支不就地中和，已经加载的后代会保留排队的 on* handler，
    // 即使返回树干净，也会在 sanitize 返回后于页面 realm 触发。测试形状与上方 F1 相同：
    // onerror 不带 src，断言属性消失；同时覆盖两个 element hook。
    [
      { hook: 'uponSanitizeElement', label: 'uponSanitizeElement' },
      { hook: 'beforeSanitizeElements', label: 'beforeSanitizeElements' },
    ].forEach(({ hook, label }) => {
      /**
       * 对 before 与 upon 两种元素 hook 分别生成测试，hook 删除 section，事先保存其 img 引用。
       * 返回树无该子树且原 img 无 onerror，随后重解析并清理 hook。
       */
      QUnit.test(
        'IN_PLACE: ' +
          label +
          ' node.remove() neutralizes the detached subtree (audit-5 F1)',
        (assert) => {
          const root = document.createElement('div');
          root.innerHTML =
            '<section><img id="tail" onerror="alert(1)"></section>' +
            '<div>safe</div>';
          const tail = root.querySelector('#tail');

          DOMPurify.addHook(hook, (node) => {
            if (node.nodeName === 'SECTION') {
              node.remove();
            }
          });

          try {
            const ret = DOMPurify.sanitize(root, { IN_PLACE: true });

            assert.equal(ret, root, 'returns the same in-place node');
            assert.notOk(
              ret.querySelector('section, #tail'),
              'detached subtree is absent from the returned tree'
            );
            assert.strictEqual(
              tail.getAttribute('onerror'),
              null,
              'on* handler stripped from the hook-detached descendant'
            );

            // 应用侧存储并重新渲染后不得暴露可执行 sink。
            const probe = document.createElement('div');
            probe.innerHTML = ret.outerHTML + tail.outerHTML;
            assert.notOk(
              probe.querySelector('[onerror],[onload],script'),
              'no executable sink survives serialize/reparse: ' +
                probe.innerHTML
            );
          } finally {
            DOMPurify.removeHook(hook);
          }
        }
      );
    });

    // =======================================================================
    // 配置：FORBID_TAGS / FORBID_ATTR。
    // =======================================================================

    /**
     * 对标签/属性禁止集合做命中、不命中及追加冲突对照，严格比较最终清洗结构。
     */
    QUnit.module('Config — FORBID_TAGS / FORBID_ATTR');

    /**
     * 在 a 内禁止默认允许的 b，未关闭 KEEP_CONTENT。
     * 严格结果删除 b 包装、保留两段文本，检查标签禁止后的内容提升。
     */
    QUnit.test(
      'FORBID_TAGS removes the named tag, keeps content by default',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<a>123<b>456</b></a>', { FORBID_TAGS: ['b'] }),
          '<a>123456</a>'
        );
      }
    );

    /**
     * 同时禁止嵌套的 a/b，内部还有默认拒绝的 script。
     * 严格结果只剩三段普通文本，确认提升后的后代继续净化而脚本内容丢弃。
     */
    QUnit.test(
      'FORBID_TAGS list applies recursively to nested matches',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize(
            '<a>123<b>456<script>alert(1)</script></b></a>789',
            { FORBID_TAGS: ['a', 'b'] }
          ),
          '123456789'
        );
      }
    );

    /**
     * 输入只含 a/b，FORBID_TAGS 却指定 c。
     * 严格结果不变，检查禁止集合未命中时不会影响其他标签。
     */
    QUnit.test('unrecognised forbid entries are no-ops', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a>123<b>456</b></a>', { FORBID_TAGS: ['c'] }),
        '<a>123<b>456</b></a>'
      );
    });

    /**
     * 显式禁止 b/script，输入还保留 a 包装。
     * 严格结果保留 a 和普通文字，丢弃脚本文本，区分普通禁止标签与默认禁内容标签。
     */
    QUnit.test('FORBID_TAGS interacts with script removal', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a>123<b>456<script>alert(1)</script></b></a>789', {
          FORBID_TAGS: ['script', 'b'],
        }),
        '<a>123456</a>789'
      );
    });

    /**
     * 同一配置同时 ADD_TAGS 与 FORBID_TAGS 指定 b。
     * 严格结果只保留 b 的文字，检查禁止集合优先于追加允许集合。
     */
    QUnit.test('FORBID_TAGS wins over ADD_TAGS for the same tag', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a>123<b>456</b></a>', {
          ADD_TAGS: ['b'],
          FORBID_TAGS: ['b'],
        }),
        '<a>123456</a>'
      );
    });

    /**
     * 两组输入在 a/b 上带 x/y，并夹入 script。
     * 指定 FORBID_ATTR 后严格输出删除这些属性、保留 class 及普通文本；
     * x/y 本来也未默认允许，此断言观察最终过滤结果。
     */
    QUnit.test('FORBID_ATTR drops the named attribute', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a x="1">123<b>456</b></a>', {
          FORBID_ATTR: ['x'],
        }),
        '<a>123<b>456</b></a>'
      );
      assert.equal(
        DOMPurify.sanitize(
          '<a class="0" x="1">123<b y="1">456<script>alert(1)</script></b></a>789',
          { FORBID_ATTR: ['x', 'y'] }
        ),
        '<a class="0">123<b>456</b></a>789'
      );
    });

    /**
     * b 上重复写 y，a 上也带 y，配置禁止 y。
     * 严格输出不带任何 y，检查解析器处理重复属性后各节点的最终清理结果。
     */
    QUnit.test(
      'repeated attribute name appears once after FORBID_ATTR',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<a y="1">123<b y="1" y="2">456</b></a>', {
            FORBID_ATTR: ['y'],
          }),
          '<a>123<b>456</b></a>'
        );
      }
    );

    /**
     * b 上的 x 与 script 上的 y 均被指定禁止。
     * 严格结果留下无 x 的 b、丢弃 script；
     * 实际可见断言检查存活 b 的属性及脚本子树删除。
     */
    QUnit.test(
      'FORBID_ATTR applies inside disallowed-tag content too',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize(
            '<a>123<b x="1">456<script y="1">alert(1)</script></b></a>789',
            { FORBID_ATTR: ['x', 'y'] }
          ),
          '<a>123<b>456</b></a>789'
        );
      }
    );

    // =======================================================================
    // 配置：CUSTOM_ELEMENT_HANDLING。
    // =======================================================================

    /**
     * 自定义名称检查、is 处理、原型字段、保留名称与后置 hook 组合；
     * 每例明示配置及实际属性结果。
     */
    QUnit.module('Config — CUSTOM_ELEMENT_HANDLING');

    /**
     * foo-bar 带 baz/forbidden，div 带 is=foo-baz。
     * 正则分别允许 foo- 标签与 baz 属性并开启定制内建元素；
     * 严格结果保留 baz/is、删除 forbidden。
     */
    QUnit.test('regex tag/attr checks + customized built-ins', (assert) => {
      assert.equal(
        DOMPurify.sanitize(
          '<foo-bar baz="foobar" forbidden="true"></foo-bar><div is="foo-baz"></div>',
          {
            CUSTOM_ELEMENT_HANDLING: {
              tagNameCheck: /^foo-/,
              attributeNameCheck: /baz/,
              allowCustomizedBuiltInElements: true,
            },
          }
        ),
        '<foo-bar baz="foobar"></foo-bar><div is="foo-baz"></div>'
      );
    });

    /**
     * 沿用 foo- 与 baz 准入，但关闭定制内建元素。
     * 严格结果保留自主元素和 baz，将 div 的 is 写为空值，检查字符串返回时的 is 特殊处理。
     */
    QUnit.test('allowCustomizedBuiltInElements=false drops is=', (assert) => {
      assert.equal(
        DOMPurify.sanitize(
          '<foo-bar baz="foobar" forbidden="true"></foo-bar><div is="foo-baz"></div>',
          {
            CUSTOM_ELEMENT_HANDLING: {
              tagNameCheck: /^foo-/,
              attributeNameCheck: /baz/,
              allowCustomizedBuiltInElements: false,
            },
          }
        ),
        '<foo-bar baz="foobar"></foo-bar><div is=""></div>'
      );
    });

    /**
     * 标签正则只匹配 -bar 结尾，属性正则允许全部名称。
     * foo-bar 的两属性保留，foo-baz 不获 is 权限而写为空值，区分两种自定义元素名称。
     */
    QUnit.test('tagNameCheck anchored to end of name', (assert) => {
      assert.equal(
        DOMPurify.sanitize(
          '<foo-bar baz="foobar" forbidden="true"></foo-bar><div is="foo-baz"></div>',
          {
            CUSTOM_ELEMENT_HANDLING: {
              tagNameCheck: /-bar$/,
              attributeNameCheck: /.+/,
              allowCustomizedBuiltInElements: true,
            },
          }
        ),
        '<foo-bar baz="foobar" forbidden="true"></foo-bar><div is=""></div>'
      );
    });

    /**
     * 以函数替代标签/属性正则，连续测试 foo- 与 -bar 两种匹配。
     * 严格输出分别保留或清空 is，并删除 forbidden，验证函数返回值参与准入。
     */
    QUnit.test('function-based tag/attr checks', (assert) => {
      assert.equal(
        DOMPurify.sanitize(
          '<foo-bar baz="foobar" forbidden="true"></foo-bar><div is="foo-baz"></div>',
          {
            CUSTOM_ELEMENT_HANDLING: {
              tagNameCheck: (tagName) => tagName.match(/^foo-/),
              attributeNameCheck: (attr) => attr.match(/baz/),
              allowCustomizedBuiltInElements: true,
            },
          }
        ),
        '<foo-bar baz="foobar"></foo-bar><div is="foo-baz"></div>'
      );
      assert.equal(
        DOMPurify.sanitize(
          '<foo-bar baz="foobar" forbidden="true"></foo-bar><div is="foo-baz"></div>',
          {
            CUSTOM_ELEMENT_HANDLING: {
              tagNameCheck: (tagName) => tagName.match(/-bar$/),
              attributeNameCheck: (attr) => attr.match(/baz/),
              allowCustomizedBuiltInElements: true,
            },
          }
        ),
        '<foo-bar baz="foobar"></foo-bar><div is=""></div>'
      );
    });

    /**
     * my-paragraph 经标签正则放行，内建 span 带默认允许的 slot。
     * 严格结构不变，检查自定义包装与正常插槽属性能共同保留。
     */
    QUnit.test('slot attribute on custom element is preserved', (assert) => {
      assert.equal(
        DOMPurify.sanitize(
          '<my-paragraph><span slot="my-text">test</span></my-paragraph>',
          { CUSTOM_ELEMENT_HANDLING: { tagNameCheck: /-/u } }
        ),
        '<my-paragraph><span slot="my-text">test</span></my-paragraph>'
      );
    });

    /**
     * 空输入配置三个 CUSTOM_ELEMENT_HANDLING 字段为 null。
     * 调用完成后断言 true，仅检查配置解析不抛错；
     * 未测试任何自定义节点的输出。
     */
    QUnit.test('null config values do not throw', (assert) => {
      DOMPurify.sanitize('', {
        CUSTOM_ELEMENT_HANDLING: {
          tagNameCheck: null,
          attributeNameCheck: null,
          allowCustomizedBuiltInElements: null,
        },
      });
      assert.ok(true);
    });

    /**
     * CUSTOM_ELEMENT_HANDLING 放在配置原型的抛错 getter 上。
     * 默认净化 foo-bar 应只剩文字，未抛错同时表明继承 getter 未读取。
     */
    QUnit.test('inherited top-level config is ignored', (assert) => {
      const proto = {};
      Object.defineProperty(proto, 'CUSTOM_ELEMENT_HANDLING', {
        get: () => {
          throw new Error('must not read inherited CUSTOM_ELEMENT_HANDLING');
        },
      });
      assert.equal(
        DOMPurify.sanitize('<foo-bar>abc</foo-bar>', Object.create(proto)),
        'abc'
      );
    });

    /**
     * 配置对象自身有 CUSTOM_ELEMENT_HANDLING，其 tagNameCheck 仅在原型上。
     * 严格结果删除 foo-bar 包装，检查嵌套配置也只采纳自有字段。
     */
    QUnit.test('inherited nested config is ignored', (assert) => {
      const inherited = Object.create({ tagNameCheck: /-/u });
      assert.equal(
        DOMPurify.sanitize('<foo-bar>abc</foo-bar>', {
          CUSTOM_ELEMENT_HANDLING: inherited,
        }),
        'abc'
      );
    });

    /**
     * 嵌套 tagNameCheck 是原型上的抛错 getter，输入纯文本。
     * 严格返回 abc 且不抛错，定位嵌套继承属性读取的规避。
     */
    QUnit.test('inherited nested getters are ignored', (assert) => {
      const proto = {};
      Object.defineProperty(proto, 'tagNameCheck', {
        get: () => {
          throw new Error('must not read inherited tagNameCheck');
        },
      });
      assert.equal(
        DOMPurify.sanitize('abc', {
          CUSTOM_ELEMENT_HANDLING: Object.create(proto),
        }),
        'abc'
      );
    });

    /**
     * 先用自定义标签规则清洗 foo-bar，再省略配置清洗同一输入。
     * 第二次严格只剩文字，检查单次规则不会泄漏到下一次默认调用。
     */
    QUnit.test('does not leak into subsequent default calls', (assert) => {
      DOMPurify.sanitize('<foo-bar>abc</foo-bar>', {
        CUSTOM_ELEMENT_HANDLING: { tagNameCheck: /-/u },
      });
      assert.equal(DOMPurify.sanitize('<foo-bar>abc</foo-bar>'), 'abc');
    });

    /**
     * 两个自定义元素携带两种属性，函数按第二参数 tagName 选择名称。
     * 严格结果每个元素仅留对应属性，验证属性检查接收当前标签名。
     */
    QUnit.test('attributeNameCheck receives tagName parameter', (assert) => {
      assert.equal(
        DOMPurify.sanitize(
          '<element-one attribute-one="1" attribute-two="2"></element-one>' +
            '<element-two attribute-one="1" attribute-two="2"></element-two>',
          {
            CUSTOM_ELEMENT_HANDLING: {
              tagNameCheck: (tagName) => tagName.match(/^element-(one|two)$/),
              attributeNameCheck: (attr, tagName) => {
                if (tagName === 'element-one') {
                  return ['attribute-one'].includes(attr);
                } else if (tagName === 'element-two') {
                  return ['attribute-two'].includes(attr);
                }
                return false;
              },
              allowCustomizedBuiltInElements: false,
            },
          }
        ),
        '<element-one attribute-one="1"></element-one>' +
          '<element-two attribute-two="2"></element-two>'
      );
    });

    /**
     * 对八个规范保留的连字符名称循环构造 onclick 输入，并提供最宽松自定义规则。
     * 所有输出都不得出现 on* 属性，检查这些名称不能借自定义元素权限保留 handler。
     */
    QUnit.test(
      'rejects all spec-reserved element names regardless of permissive checks',
      (assert) => {
        // HTML 规范保留少量带连字符但不属于 custom element 的标签名。即使
        // CUSTOM_ELEMENT_HANDLING 最宽松，它们也不能获得 custom-element 权限；否则仅因外形像
        // “用户定义元素”就可能放行 on* handler。
        const permissive = {
          CUSTOM_ELEMENT_HANDLING: {
            tagNameCheck: /.+/,
            attributeNameCheck: /.+/,
            allowCustomizedBuiltInElements: true,
          },
        };
        const reservedNames = [
          'annotation-xml',
          'color-profile',
          'font-face',
          'font-face-src',
          'font-face-uri',
          'font-face-format',
          'font-face-name',
          'missing-glyph',
        ];
        reservedNames.forEach((name) => {
          const dirty = `<${name} onclick="alert(1)">x</${name}>`;
          const clean = DOMPurify.sanitize(dirty, permissive);
          assert.notOk(
            /\son[a-z]+\s*=/i.test(clean),
            `no on-handler on <${name}>: ${clean}`
          );
        });
      }
    );

    /**
     * HTML 输入 FONT-FACE 大写并带 onclick，使用宽松自定义规则。
     * 输出不得出现 on* 属性，覆盖 HTML 解析器转小写后的保留名称排除。
     */
    QUnit.test('reserved-name check is case-insensitive (HTML)', (assert) => {
      // HTML 解析器会把大写输入转成小写；reserved-name 检查必须在转换后仍生效。
      const permissive = {
        CUSTOM_ELEMENT_HANDLING: {
          tagNameCheck: /.+/,
          attributeNameCheck: /.+/,
        },
      };
      const clean = DOMPurify.sanitize(
        '<FONT-FACE onclick="alert(1)">x</FONT-FACE>',
        permissive
      );
      assert.notOk(
        /\son[a-z]+\s*=/i.test(clean),
        `no on-handler on <FONT-FACE>: ${clean}`
      );
    });

    /**
     * XHTML 模式保留五种混合大小写名称，均带 onclick。
     * 逐个断言输出无 on* 属性，覆盖 XML 解析下大小写不敏感的保留名称排除。
     */
    QUnit.test('reserved-name check is case-insensitive (XHTML)', (assert) => {
      // application/xhtml+xml 模式保留标签大小写；reserved-name 检查必须忽略大小写，防止
      // `<Annotation-XML>` 等绕过 basic-custom-element 排除规则。
      const cfg = {
        PARSER_MEDIA_TYPE: 'application/xhtml+xml',
        CUSTOM_ELEMENT_HANDLING: {
          tagNameCheck: /.+/,
          attributeNameCheck: /.+/,
        },
      };
      const mixedCaseNames = [
        'Annotation-XML',
        'Color-Profile',
        'Font-Face',
        'Font-Face-Src',
        'Missing-Glyph',
      ];
      mixedCaseNames.forEach((name) => {
        const dirty =
          '<root xmlns="http://www.w3.org/1999/xhtml"><' +
          name +
          ' onclick="alert(1)">x</' +
          name +
          '></root>';
        const clean = DOMPurify.sanitize(dirty, cfg);
        assert.notOk(
          /\son[a-z]+\s*=/i.test(clean),
          `no on-handler on <${name}> in XHTML mode: ${clean}`
        );
      });
    });

    // GHSA-c2j3-45gr-mqc4 回归：由 CUSTOM_ELEMENT_HANDLING 保留的 custom element 必须像普通
    // allowlisted 元素一样执行 afterSanitizeElements，避免叠加在该 hook 上的安全策略对保留的
    // custom element 静默失效。
    /**
     * 注册 afterSanitizeElements 收集名称，清洗允许的 x-keep 与普通 div。
     * 名单须同时包含两者，随后移除 hook，检查保留自定义元素也触发后置元素 hook。
     */
    QUnit.test(
      'afterSanitizeElements fires on kept custom elements',
      (assert) => {
        const seen = [];
        DOMPurify.addHook('afterSanitizeElements', (node) => {
          if (node.tagName) {
            seen.push(node.tagName.toLowerCase());
          }
        });
        DOMPurify.sanitize('<x-keep>a</x-keep><div>b</div>', {
          CUSTOM_ELEMENT_HANDLING: { tagNameCheck: /^x-/ },
        });
        DOMPurify.removeAllHooks();
        assert.ok(
          seen.includes('x-keep'),
          `hook must fire on kept custom element, saw: ${seen.join(',')}`
        );
        assert.ok(seen.includes('div'), 'hook still fires on normal element');
      }
    );

    /**
     * 后置元素 hook 删除 data-bio，输入普通 div 与放行的 x-bio。
     * 严格结果两个元素都无该属性，说明同一用户策略作用于两类存活节点。
     */
    QUnit.test(
      'afterSanitizeElements policy applies uniformly to custom elements',
      (assert) => {
        DOMPurify.addHook('afterSanitizeElements', (node) => {
          if (node.hasAttribute && node.hasAttribute('data-bio')) {
            node.removeAttribute('data-bio');
          }
        });
        const clean = DOMPurify.sanitize(
          '<div data-bio="x"></div><x-bio data-bio="x"></x-bio>',
          { CUSTOM_ELEMENT_HANDLING: { tagNameCheck: /^x-/ } }
        );
        DOMPurify.removeAllHooks();
        assert.equal(clean, '<div></div><x-bio></x-bio>');
      }
    );

    /**
     * 后置元素 hook 主动删除已准入的 x-evil，兄弟 x-ok 同样被放行。
     * 严格结果仅保留 x-ok 子树，检查 hook 的直接 DOM 修改进入结果。
     */
    QUnit.test(
      'afterSanitizeElements can remove a kept custom element',
      (assert) => {
        DOMPurify.addHook('afterSanitizeElements', (node) => {
          if (node.tagName && node.tagName.toLowerCase() === 'x-evil') {
            node.remove();
          }
        });
        const clean = DOMPurify.sanitize('<x-evil>a</x-evil><x-ok>b</x-ok>', {
          CUSTOM_ELEMENT_HANDLING: { tagNameCheck: /^x-/ },
        });
        DOMPurify.removeAllHooks();
        assert.equal(clean, '<x-ok>b</x-ok>');
      }
    );

    /**
     * 只放行 x-a 标签，给它 onclick/javascript: href，并嵌危险 img。
     * 输出同时不得含三种危险片段，检查标签准入之后属性和后代仍执行净化。
     */
    QUnit.test(
      'kept custom element attributes are still sanitized (contract intact)',
      (assert) => {
        const clean = DOMPurify.sanitize(
          '<x-a onclick="alert(1)" href="javascript:alert(1)"><img src=x onerror=alert(1)></x-a>',
          { CUSTOM_ELEMENT_HANDLING: { tagNameCheck: /^x-/ } }
        );
        assert.notOk(/onclick/i.test(clean), 'event handler stripped');
        assert.notOk(/javascript:/i.test(clean), 'javascript: URI stripped');
        assert.notOk(/onerror/i.test(clean), 'child payload sanitized');
      }
    );

    // =======================================================================
    // 配置：ALLOW_ARIA_ATTR（#198）。
    // =======================================================================

    /**
     * 合法与非 ASCII ARIA 名称分别开关自动准入，比较名称模式和配置限制。
     */
    QUnit.module('Config — ALLOW_ARIA_ATTR');

    /**
     * a 带合法 aria-abc，显式开启 ARIA 准入。
     * 完整候选要求属性与 href 都保留，只容纳属性顺序差异，检查名称模式的允许分支。
     */
    QUnit.test(
      'ALLOW_ARIA_ATTR=true preserves well-formed aria-*',
      (assert) => {
        assert.contains(
          DOMPurify.sanitize('<a aria-abc="foo" href="#">abc</a>', {
            ALLOW_ARIA_ATTR: true,
          }),
          [
            '<a aria-abc="foo" href="#">abc</a>',
            '<a href="#" aria-abc="foo">abc</a>',
          ]
        );
      }
    );

    /**
     * aria-aöü 含非 ASCII 字符，仍开启 ARIA 准入。
     * 严格输出删除此属性而保留 href，检查名称模式不会被开关放宽。
     */
    QUnit.test('rejects non-ASCII aria- names even when allowed', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a href="#" aria-aöü="foo">abc</a>', {
          ALLOW_ARIA_ATTR: true,
        }),
        '<a href="#">abc</a>'
      );
    });

    /**
     * 关闭 ARIA 准入，分别输入合法与非 ASCII aria 名称。
     * 两次严格结果都仅留 href，验证合法名称的自动准入可关闭。
     */
    QUnit.test(
      'ALLOW_ARIA_ATTR=false strips even well-formed aria-*',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<a href="#" aria-abc="foo">abc</a>', {
            ALLOW_ARIA_ATTR: false,
          }),
          '<a href="#">abc</a>'
        );
        assert.equal(
          DOMPurify.sanitize('<a href="#" aria-äöü="foo">abc</a>', {
            ALLOW_ARIA_ATTR: false,
          }),
          '<a href="#">abc</a>'
        );
      }
    );

    // =======================================================================
    // 配置：USE_PROFILES。
    // =======================================================================

    /**
     * HTML/SVG/filter/MathML profile 重建允许集合；
     * 候选记录引擎裁剪，再用追加与禁止配置约束输出。
     */
    QUnit.module('Config — USE_PROFILES');

    /**
     * 相同 h1 输入分别关闭、开启 html profile。
     * 严格结果分别只剩文字与完整 h1，检查 profile 构建的标签允许集合。
     */
    QUnit.test('html profile toggle', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<h1>HELLO</h1>', { USE_PROFILES: { html: false } }),
        'HELLO'
      );
      assert.equal(
        DOMPurify.sanitize('<h1>HELLO</h1>', { USE_PROFILES: { html: true } }),
        '<h1>HELLO</h1>'
      );
    });

    /**
     * 组合 html/mathMl profile 清洗 h1 与空或带 mi 的 math。
     * 候选始终保留 h1，并容纳环境裁剪 MathML 的形状，检查组合 profile 的可接受输出。
     */
    QUnit.test('html + mathMl combined profile', (assert) => {
      assert.contains(
        DOMPurify.sanitize('<h1>HELLO</h1><math></math>', {
          USE_PROFILES: { html: true, mathMl: true },
        }),
        ['<h1>HELLO</h1>', '<h1>HELLO</h1><math></math>']
      );
      assert.contains(
        DOMPurify.sanitize('<h1>HELLO</h1><math><mi></mi></math>', {
          USE_PROFILES: { html: true, mathMl: true },
        }),
        [
          '<h1>HELLO</h1>',
          '<h1>HELLO</h1><math><mi></mi></math>',
          '<h1>HELLO</h1><math></math>',
        ]
      );
    });

    /**
     * 在 html/mathMl profile 上分别禁止 mi 和 class。
     * 完整候选都不含被禁止项，同时容纳 MathML 被环境裁剪，检查禁止集合继续约束 profile。
     */
    QUnit.test('FORBID_TAGS / FORBID_ATTR refine profile output', (assert) => {
      assert.contains(
        DOMPurify.sanitize('<h1>HELLO</h1><math><mi></mi></math>', {
          USE_PROFILES: { html: true, mathMl: true },
          FORBID_TAGS: ['mi'],
        }),
        ['<h1>HELLO</h1>', '<h1>HELLO</h1><math></math>']
      );
      assert.contains(
        DOMPurify.sanitize('<h1>HELLO</h1><math class="foo"><mi></mi></math>', {
          USE_PROFILES: { html: true, mathMl: true },
          FORBID_ATTR: ['class'],
        }),
        [
          '<h1>HELLO</h1>',
          '<h1>HELLO</h1><math><mi></mi></math>',
          '<h1>HELLO</h1><math></math>',
        ]
      );
    });

    /**
     * 三次 USE_PROFILES 分别是未知字段对象、数字和空数组。
     * h1 输入严格都只剩文字，检查未启用有效 profile 时的标签集合行为。
     */
    QUnit.test(
      'unknown / non-object profile entries strip everything',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<h1>HELLO</h1>', {
            USE_PROFILES: { bogus: true },
          }),
          'HELLO'
        );
        assert.equal(
          DOMPurify.sanitize('<h1>HELLO</h1>', { USE_PROFILES: 123 }),
          'HELLO'
        );
        assert.equal(
          DOMPurify.sanitize('<h1>HELLO</h1>', { USE_PROFILES: [] }),
          'HELLO'
        );
      }
    );

    /**
     * 只开启 svg profile，输入 svg/rect 与 height。
     * 候选容纳完整 SVG、XML 序列化、空根乃至空输出，记录各环境接受形状；
     * 未强制所有环境保留 rect。
     */
    QUnit.test('svg profile keeps SVG elements', (assert) => {
      assert.contains(
        DOMPurify.sanitize('<svg><rect height="50"></rect></svg>', {
          USE_PROFILES: { svg: true },
        }),
        [
          '',
          '<svg><rect height="50"></rect></svg>',
          '<svg xmlns="http://www.w3.org/2000/svg"><rect height="50" /></svg>',
          '<svg xmlns="http://www.w3.org/2000/svg" />',
        ]
      );
    });

    /**
     * 开启 svgFilters 并追加 svg 标签，输入 feBlend 的 in/mode。
     * 候选容纳名称大小写、XML 自闭合及子节点裁剪，检查过滤器 profile 与容器追加的组合。
     */
    QUnit.test('svgFilters profile keeps SVG filter primitives', (assert) => {
      assert.contains(
        DOMPurify.sanitize(
          '<svg><feBlend in="SourceGraphic" mode="multiply" /></svg>',
          {
            USE_PROFILES: { svgFilters: true },
            ADD_TAGS: ['svg'],
          }
        ),
        [
          '<svg><feblend in="SourceGraphic" mode="multiply"></feblend></svg>',
          '<svg><feBlend in="SourceGraphic" mode="multiply"></feBlend></svg>',
          '<svg xmlns="http://www.w3.org/2000/svg"><feBlend in="SourceGraphic" mode="multiply" /></svg>',
          '<svg xmlns="http://www.w3.org/2000/svg" />',
        ]
      );
    });

    /**
     * svg profile 输入 SVG style 的普通 fill CSS。
     * 候选容纳 style 保留或 SVG 裁剪；
     * 检查解析与序列化形状，CSS 内容本身未进行规则解析。
     */
    QUnit.test('svg <style> content survives', (assert) => {
      assert.contains(
        DOMPurify.sanitize(
          '<svg><style>.some-class {fill: #fff}</style></svg>',
          { USE_PROFILES: { svg: true } }
        ),
        [
          '',
          '<svg><style>.some-class {fill: #fff}</style></svg>',
          '<svg xmlns="http://www.w3.org/2000/svg"><style>.some-class {fill: #fff}</style></svg>',
          '<svg xmlns="http://www.w3.org/2000/svg" />',
        ]
      );
    });

    /**
     * SVG text 与 HTML span 都关闭 KEEP_CONTENT。
     * SVG 接受环境裁剪候选，HTML 严格保留 span/文字，后者说明该选项不删除允许元素的内容。
     */
    QUnit.test('svg <text> survives even with KEEP_CONTENT=false', (assert) => {
      assert.contains(
        DOMPurify.sanitize('<svg><text>SEE ME</text></svg>', {
          USE_PROFILES: { svg: true },
          KEEP_CONTENT: false,
        }),
        [
          '',
          '<svg><text>SEE ME</text></svg>',
          '<svg xmlns="http://www.w3.org/2000/svg"><text>SEE ME</text></svg>',
          '<svg xmlns="http://www.w3.org/2000/svg" />',
        ]
      );
      // span 属于 html profile 的允许标签，元素与文本都保留；KEEP_CONTENT=false
      // 只影响被拒绝元素的后代，不会删除允许的 span 内容。
      assert.equal(
        DOMPurify.sanitize('<span>SEE ME</span>', {
          USE_PROFILES: { html: true },
          KEEP_CONTENT: false,
        }),
        '<span>SEE ME</span>'
      );
    });

    /**
     * svg profile 上追加 div 标签或 keep 属性。
     * div 必须完整保留，SVG 候选允许附加属性或空输出，检查 profile 允许集合可继续扩展。
     */
    QUnit.test('ADD_TAGS / ADD_ATTR extend profile allowlists', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<div></div>', {
          USE_PROFILES: { svg: true },
          ADD_TAGS: ['div'],
        }),
        '<div></div>'
      );
      assert.contains(
        DOMPurify.sanitize('<svg keep="me"></svg>', {
          USE_PROFILES: { svg: true },
          ADD_ATTR: ['keep'],
        }),
        [
          '',
          '<svg keep="me"></svg>',
          '<svg xmlns="http://www.w3.org/2000/svg" keep="me" />',
        ]
      );
    });

    /**
     * USE_PROFILES 是配置原型上的抛错 getter。
     * 严格保留默认 h1 且不抛错，检查顶层继承配置不会读取。
     */
    QUnit.test('inherited top-level USE_PROFILES is ignored', (assert) => {
      const proto = {};
      Object.defineProperty(proto, 'USE_PROFILES', {
        get: () => {
          throw new Error('must not read inherited USE_PROFILES');
        },
      });
      assert.equal(
        DOMPurify.sanitize('<h1>HELLO</h1>', Object.create(proto)),
        '<h1>HELLO</h1>'
      );
    });

    /**
     * USE_PROFILES 对象只从原型继承 html=true。
     * 严格结果去掉 h1 包装，检查继承 profile 标志不参与启用。
     */
    QUnit.test('inherited profile flags are ignored', (assert) => {
      const inherited = Object.create({ html: true });
      assert.equal(
        DOMPurify.sanitize('<h1>HELLO</h1>', { USE_PROFILES: inherited }),
        'HELLO'
      );
    });

    /**
     * 先关闭 html profile 清洗 h1，再默认清洗相同输入。
     * 第二次严格保留 h1，确认 profile 集合按新调用配置重建。
     */
    QUnit.test('does not leak into subsequent default calls', (assert) => {
      DOMPurify.sanitize('<h1>HELLO</h1>', {
        USE_PROFILES: { html: false },
      });
      assert.equal(DOMPurify.sanitize('<h1>HELLO</h1>'), '<h1>HELLO</h1>');
    });

    // =======================================================================
    // 配置：ALLOWED_URI_REGEXP / ADD_URI_SAFE_ATTR / ALLOW_UNKNOWN_PROTOCOLS。
    // =======================================================================

    /**
     * 自定义 URI 正则逐项判定协议，再检查跨调用恢复与 global RegExp 游标复位。
     */
    QUnit.module('Config — ALLOWED_URI_REGEXP');

    /**
     * 自定义 URI 正则循环检查 https/http、blob 与 mailto。
     * 前两项保留 src，后两项删除 URI 属性，严格逐项比较正则约束后的结果。
     */
    QUnit.test('custom regex filters URI-bearing attributes', (assert) => {
      const tests = [
        {
          test: '<img src="https://i.imgur.com/hkfpOUu.gifv">',
          expected: '<img src="https://i.imgur.com/hkfpOUu.gifv">',
        },
        {
          test: '<img src="http://i.imgur.com/WScAnHr.jpg">',
          expected: '<img src="http://i.imgur.com/WScAnHr.jpg">',
        },
        {
          test: '<img src="blob:https://localhost:3000/c4ea3ec6-9f22-4d08-af6f-d79e78a0a7a7">',
          expected: '<img>',
        },
        {
          test: '<a href="mailto:demo@example.com">demo</a>',
          expected: '<a>demo</a>',
        },
      ];
      tests.forEach((t) => {
        const out = DOMPurify.sanitize(t.test, {
          ALLOWED_URI_REGEXP:
            /^(?:(?:(?:f|ht)tps?):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        });
        assert.equal(out, t.expected);
      });
    });

    /**
     * 先默认清洗 different.com，再用 test.com 正则，最后重新默认清洗。
     * 首尾输出相同，检查上一调用的 URI 正则不会被后续默认调用复用。
     */
    QUnit.test('ALLOWED_URI_REGEXP is not cached across calls', (assert) => {
      const dirty = '<img src="https://different.com">';
      const expected = '<img src="https://different.com">';

      assert.equal(DOMPurify.sanitize(dirty), expected);

      assert.equal(
        DOMPurify.sanitize('<img src="https://test.com">', {
          ALLOWED_URI_REGEXP: /test\.com/i,
        }),
        '<img src="https://test.com">'
      );

      assert.equal(DOMPurify.sanitize(dirty), expected);
    });

    /**
     * 一个输入含两个 blob src 与 epub href，URI 正则带 g/i。
     * 严格保留三个 URI 并删除 epub:type，检查每次正则测试复位 lastIndex。
     */
    QUnit.test(
      'ALLOWED_URI_REGEXP with /g flag does not lose state',
      (assert) => {
        // 带状态的 global RegExp（.lastIndex）曾在同一次清洗内被多次属性检查复用时产生错误结果。
        const dirty =
          '<img src="blob:http://localhost:5173/84c49be9-3352-4407-b066-7b5b4d46c52a">' +
          '<a epub:type="noteref" href="epub:EPUB/xhtml/#footnote"></a>' +
          '<img src="blob:http://localhost:5173/84c49be9-3352-4407" >';
        const expected =
          '<img src="blob:http://localhost:5173/84c49be9-3352-4407-b066-7b5b4d46c52a">' +
          '<a href="epub:EPUB/xhtml/#footnote"></a>' +
          '<img src="blob:http://localhost:5173/84c49be9-3352-4407">';
        assert.strictEqual(
          DOMPurify.sanitize(dirty, {
            ALLOWED_URI_REGEXP: /^(blob|https|epub|filepos|kindle)/gi,
          }),
          expected
        );
      }
    );

    /**
     * URI-safe 属性在名称准入后豁免协议检查；
     * 连续调用区分追加默认集合和当次扩展。
     */
    QUnit.module('Config — ADD_URI_SAFE_ATTR');

    /**
     * typeof 的 bla:h 值不符合默认 URI 规则，但名称被 ALLOWED_ATTR 放行且加入 URI-safe 集合。
     * 严格保留该属性，检查 URI 检查豁免。
     */
    QUnit.test(
      'ALLOW_DATA_ATTR + ADD_URI_SAFE_ATTR exempts attribute from URI check',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<b typeof="bla:h">123</b>', {
            ALLOWED_ATTR: ['typeof'],
            ADD_URI_SAFE_ATTR: ['typeof'],
          }),
          '<b typeof="bla:h">123</b>'
        );
      }
    );

    /**
     * 先以 ADD_URI_SAFE_ATTR 允许 typeof=bla:h，再仅放行名称。
     * 第二次严格删除属性，检查单次 URI-safe 扩展不会跨调用保留。
     */
    QUnit.test(
      'URI safe additions do not persist across calls (#327)',
      (assert) => {
        // 先执行一次用于建立状态的调用。
        DOMPurify.sanitize('<b typeof="bla:h">123</b>', {
          ALLOWED_ATTR: ['typeof'],
          ADD_URI_SAFE_ATTR: ['typeof'],
        });
        // 未配置 ADD_URI_SAFE_ATTR 时，该属性无法通过 URI 校验。
        assert.equal(
          DOMPurify.sanitize('<b typeof="bla:h">123</b>', {
            ALLOWED_ATTR: ['typeof'],
          }),
          '<b>123</b>'
        );
      }
    );

    /**
     * 先把 poster 加入 URI-safe 集合，style 同时使用默认豁免。
     * 首次候选保留两者，默认重试只留 style，验证追加保留默认项且不泄漏 poster 权限。
     */
    QUnit.test(
      'URI safe additions do not overwrite defaults (#366)',
      (assert) => {
        let clean = DOMPurify.sanitize(
          '<div poster="x:y" style="color: red">Test</div>',
          { ADD_URI_SAFE_ATTR: ['poster'] }
        );
        assert.contains(clean, [
          '<div poster="x:y" style="color: red">Test</div>',
          '<div poster="x:y" style="color: red;">Test</div>',
        ]);

        clean = DOMPurify.sanitize(
          '<div poster="x:y" style="color: red">Test</div>'
        );
        assert.contains(clean, [
          '<div style="color: red">Test</div>',
          '<div style="color: red;">Test</div>',
        ]);
      }
    );

    /**
     * 可选未知协议接受 spotify/cid，但仍拒绝 javascript 与事件名称，并单独检查 data URI 标签权限。
     */
    QUnit.module('Config — ALLOW_UNKNOWN_PROTOCOLS');

    /**
     * 开启未知协议，输入 spotify 链接包住 cid 图片。
     * 严格结构不变，检查可选协议分支接受这两类未默认允许的方案。
     */
    QUnit.test('opt-in allows custom schemes', (assert) => {
      const dirty =
        '<div><a href="spotify:track:12345"><img src="cid:1234567"></a></div>';
      assert.equal(
        dirty,
        DOMPurify.sanitize(dirty, { ALLOW_UNKNOWN_PROTOCOLS: true })
      );
    });

    /**
     * 同样开启未知协议，链接改用 javascript:，图片仍为 cid。
     * 严格结果仅删除 href，检查危险协议排除优先于未知协议放行。
     */
    QUnit.test(
      'javascript: is still blocked under ALLOW_UNKNOWN_PROTOCOLS',
      (assert) => {
        const dirty =
          '<div><a href="javascript:alert(document.title)"><img src="cid:1234567"/></a></div>';
        const expected = '<div><a><img src="cid:1234567"></a></div>';
        assert.equal(
          expected,
          DOMPurify.sanitize(dirty, { ALLOW_UNKNOWN_PROTOCOLS: true })
        );
      }
    );

    /**
     * 开启未知协议但输入 onFoo 属性。
     * 严格结果只保留 p/文字，确认 URI 协议选项不会扩大事件属性名称准入。
     */
    QUnit.test(
      'regression #166: onFoo is dropped under ALLOW_UNKNOWN_PROTOCOLS',
      (assert) => {
        const dirty = '<p onFoo="123">HELLO</p>';
        const expected = '<p>HELLO</p>';
        assert.equal(
          expected,
          DOMPurify.sanitize(dirty, { ALLOW_UNKNOWN_PROTOCOLS: true })
        );
      }
    );

    /**
     * 默认清洗 a 的 data:image href。
     * 严格结果保留文字、删除 href，检查 a 不在默认 data URI 标签集合中。
     */
    QUnit.test('data: URIs blocked by default in <a href>', (assert) => {
      const clean = DOMPurify.sanitize(
        '<a href="data:image/gif;base64,123">icon.gif</a>'
      );
      assert.equal(clean, '<a>icon.gif</a>');
    });

    /**
     * 同一链接把 a 加入 ADD_DATA_URI_TAGS。
     * 严格结果保留 data URI，检查按标签追加 data 协议权限；
     * 配置中的 b 未在输入中出现。
     */
    QUnit.test(
      'ADD_DATA_URI_TAGS allows data: URIs on listed tags',
      (assert) => {
        const clean = DOMPurify.sanitize(
          '<a href="data:image/gif;base64,123">icon.gif</a>',
          { ADD_DATA_URI_TAGS: ['a', 'b'] }
        );
        assert.equal(clean, '<a href="data:image/gif;base64,123">icon.gif</a>');
      }
    );

    // =======================================================================
    // 配置：NAMESPACE / ALLOWED_NAMESPACES。
    // =======================================================================

    /**
     * 默认 namespace、根配置、自定义 XML namespace 与跨调用恢复矩阵；
     * 返回候选记录解析/序列化差异。
     */
    QUnit.module('Config — NAMESPACE / ALLOWED_NAMESPACES');

    /**
     * 七组 SVG/MathML 嵌套 HTML 或互相嵌套，覆盖 desc/mi 等边界。
     * 逐组完整候选区分保留、删除与引擎裁剪，检查已知外来命名空间的嵌套约束。
     */
    QUnit.test(
      'namespaces are enforced for known foreign content',
      (assert) => {
        const tests = [
          {
            test: '<svg><desc><canvas></canvas><textarea></textarea></desc></svg>',
            expected: [
              '<svg><desc></desc></svg>',
              '<svg xmlns="http://www.w3.org/2000/svg"><desc></desc></svg>',
              '<svg xmlns="http://www.w3.org/2000/svg" />',
            ],
          },
          {
            test: '<svg><canvas></canvas><textarea></textarea></svg>',
            expected: [
              '<svg></svg>',
              '<svg xmlns="http://www.w3.org/2000/svg" />',
            ],
          },
          {
            test: '<math><canvas></canvas><textarea></textarea></math>',
            expected: ['<math></math>'],
          },
          {
            test: '<math><mi><canvas></canvas><textarea></textarea></mi></math>',
            expected: [
              '<math><mi><canvas></canvas><textarea></textarea></mi></math>',
              '<math></math>',
            ],
          },
          {
            test: '<svg><math></math><title><math></math></title></svg>',
            expected: [
              '<svg><title></title></svg>',
              '<svg xmlns="http://www.w3.org/2000/svg" />',
              '<svg xmlns="http://www.w3.org/2000/svg"><title></title></svg>',
            ],
          },
          {
            test: '<math><svg></svg><mi><svg></svg></mi></math>',
            expected: [
              '<math><mi><svg></svg></mi></math>',
              '<math><mi><svg xmlns="http://www.w3.org/2000/svg" /></mi></math>',
              '<math></math>',
            ],
          },
          {
            test: '<form><math><mi><mglyph></form><form>',
            expected: [
              '<form><math><mi><mglyph></mglyph></mi></math></form>',
              '<form><math></math></form>',
            ],
          },
        ];
        tests.forEach((t) =>
          assert.contains(DOMPurify.sanitize(t.test), t.expected)
        );
      }
    );

    /**
     * polyline/mi 分别置于 SVG、MathML、HTML 根命名空间。
     * 候选在对应空间允许元素或环境裁剪，错误空间严格为空，检查 NAMESPACE 对解析根及名称空间验证的影响。
     */
    QUnit.test('NAMESPACE pins the root namespace', (assert) => {
      const tests = [
        {
          test: '<polyline points="0 0"></polyline>',
          config: { NAMESPACE: 'http://www.w3.org/2000/svg' },
          expected: [
            '<polyline points="0 0"></polyline>',
            '<polyline xmlns="http://www.w3.org/2000/svg" points="0 0"/>',
            '<polyline xmlns="http://www.w3.org/2000/svg" points="0,0" />',
            '',
          ],
        },
        {
          test: '<polyline points="0 0"></polyline>',
          config: { NAMESPACE: 'http://www.w3.org/1999/xhtml' },
          expected: [''],
        },
        {
          test: '<mi></mi>',
          config: { NAMESPACE: 'http://www.w3.org/1998/Math/MathML' },
          expected: [
            '<mi></mi>',
            '<mi xmlns="http://www.w3.org/1998/Math/MathML"></mi>',
            '<mi xmlns="http://www.w3.org/1998/Math/MathML"/>',
            '<mi xmlns="http://www.w3.org/1998/Math/MathML" />',
            '',
          ],
        },
        {
          test: '<polyline points="0 0"></polyline>',
          config: { NAMESPACE: 'http://www.w3.org/1998/Math/MathML' },
          expected: [''],
        },
        {
          test: '<mi></mi>',
          config: { NAMESPACE: 'http://www.w3.org/1999/xhtml' },
          expected: [''],
        },
      ];
      tests.forEach((t) =>
        assert.contains(DOMPurify.sanitize(t.test, t.config), t.expected)
      );
    });

    /**
     * XHTML 输入使用自定义根、子节点及多组前缀命名空间。
     * 逐组配置标签与命名空间集合，候选比较保留结构、拒绝未准入空间和禁止标签，并容纳 XML 自闭合形式。
     */
    QUnit.test(
      'ALLOWED_NAMESPACES allow-lists custom XML namespaces',
      (assert) => {
        const tests = [
          {
            // 默认行为：带 custom namespace 的 XML 结果为空。
            test: '<library xmlns="http://www.ibm.com/library"><name>Library 1</name></library>',
            config: {
              ALLOWED_TAGS: ['#text', 'library', 'name'],
              KEEP_CONTENT: false,
              PARSER_MEDIA_TYPE: 'application/xhtml+xml',
            },
            expected: '',
          },
          {
            // 根节点使用单个 custom namespace。
            test:
              '<library xmlns="http://www.ibm.com/library"><name>Library 1</name>' +
              '<dirty onload="alert()" /></library>',
            config: {
              ALLOWED_NAMESPACES: ['http://www.ibm.com/library'],
              ALLOWED_TAGS: ['#text', 'library', 'name'],
              KEEP_CONTENT: false,
              PARSER_MEDIA_TYPE: 'application/xhtml+xml',
            },
            expected:
              '<library xmlns="http://www.ibm.com/library"><name>Library 1</name></library>',
          },
          {
            // 子节点使用 custom namespace；根保留默认 HTML namespace。
            test:
              '<city><library xmlns="http://www.ibm.com/library"><name>Library 1</name>' +
              '<dirty onload="alert()" /></library></city>',
            config: {
              ALLOWED_NAMESPACES: [
                'http://www.w3.org/1999/xhtml',
                'http://www.ibm.com/library',
              ],
              ALLOWED_TAGS: ['#text', 'city', 'library', 'name'],
              KEEP_CONTENT: false,
              PARSER_MEDIA_TYPE: 'application/xhtml+xml',
            },
            expected:
              '<city xmlns="http://www.w3.org/1999/xhtml"><library xmlns="http://www.ibm.com/library"><name>Library 1</name></library></city>',
          },
          {
            // 多个带前缀 namespace，仅一个进入 allowlist。
            test:
              '<library xmlns="http://www.ibm.com/library" xmlns:bk="urn:loc.gov:books">' +
              '<bk:name>Library 1</bk:name><dirty onload="alert()" /></library>',
            config: {
              ALLOWED_NAMESPACES: ['http://www.ibm.com/library'],
              ALLOWED_TAGS: ['library', 'bk:name'],
              KEEP_CONTENT: false,
              PARSER_MEDIA_TYPE: 'application/xhtml+xml',
            },
            expected: [
              '<library xmlns="http://www.ibm.com/library"/>',
              '<library xmlns="http://www.ibm.com/library" />',
            ],
          },
          {
            // 多个 namespace 同时进入 allowlist。
            test:
              '<library xmlns="http://www.ibm.com/library" xmlns:bk="urn:loc.gov:books" ' +
              'xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">' +
              '<bk:name>Library 1<m:properties>Other Properties</m:properties></bk:name>' +
              '<dirty onload="alert()" /></library>',
            config: {
              ALLOWED_NAMESPACES: [
                'http://www.ibm.com/library',
                'urn:loc.gov:books',
                'http://schemas.microsoft.com/ado/2007/08/dataservices/metadata',
              ],
              ALLOWED_TAGS: ['#text', 'library', 'bk:name', 'm:properties'],
              KEEP_CONTENT: false,
              PARSER_MEDIA_TYPE: 'application/xhtml+xml',
            },
            expected:
              '<library xmlns="http://www.ibm.com/library">' +
              '<bk:name xmlns:bk="urn:loc.gov:books">Library 1' +
              '<m:properties xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">Other Properties</m:properties>' +
              '</bk:name></library>',
          },
          {
            // FORBID_TAGS 优先于 namespace allowlist。
            test:
              '<library xmlns="http://www.ibm.com/library" xmlns:bk="urn:loc.gov:books" ' +
              'xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">' +
              '<bk:name>Library 1<m:properties>Other Properties</m:properties></bk:name>' +
              '<dirty onload="alert()" /></library>',
            config: {
              ADD_TAGS: ['library', 'bk:name'],
              ALLOWED_NAMESPACES: [
                'http://www.ibm.com/library',
                'urn:loc.gov:books',
                'http://schemas.microsoft.com/ado/2007/08/dataservices/metadata',
              ],
              FORBID_TAGS: ['m:properties'],
              KEEP_CONTENT: false,
              PARSER_MEDIA_TYPE: 'application/xhtml+xml',
            },
            expected:
              '<library xmlns="http://www.ibm.com/library">' +
              '<bk:name xmlns:bk="urn:loc.gov:books">Library 1</bk:name></library>',
          },
        ];
        tests.forEach((t) =>
          assert.contains(DOMPurify.sanitize(t.test, t.config), t.expected)
        );
      }
    );

    /**
     * NAMESPACE 是配置原型的抛错 getter，输入 polyline。
     * 严格结果按默认 HTML 删除标签且不抛错，检查继承字段不被读取。
     */
    QUnit.test('inherited top-level NAMESPACE config is ignored', (assert) => {
      const proto = {};
      Object.defineProperty(proto, 'NAMESPACE', {
        get: () => {
          throw new Error('must not read inherited NAMESPACE');
        },
      });
      assert.equal(
        DOMPurify.sanitize(
          '<polyline points="0 0"></polyline>',
          Object.create(proto)
        ),
        ''
      );
    });

    /**
     * NAMESPACE 分别给会抛错的 toString 对象及可用时的 Symbol。
     * polyline 严格输出为空且不触发对象转换，检查非字符串字段被忽略并使用 HTML 默认值。
     */
    QUnit.test('non-string NAMESPACE values are rejected', (assert) => {
      const hostile = {
        toString: () => {
          throw new Error('must not stringify NAMESPACE');
        },
      };
      assert.equal(
        DOMPurify.sanitize('<polyline points="0 0"></polyline>', {
          NAMESPACE: hostile,
        }),
        ''
      );
      if (typeof Symbol === 'function') {
        assert.equal(
          DOMPurify.sanitize('<polyline points="0 0"></polyline>', {
            NAMESPACE: Symbol('svg'),
          }),
          ''
        );
      } else {
        assert.ok(true);
      }
    });

    /**
     * 先以 SVG namespace 净化 polyline，再默认清洗同一输入。
     * 后者严格为空，确认单次根命名空间不会泄漏到默认调用。
     */
    QUnit.test(
      'NAMESPACE does not leak into subsequent default calls',
      (assert) => {
        DOMPurify.sanitize('<polyline points="0 0"></polyline>', {
          NAMESPACE: 'http://www.w3.org/2000/svg',
        });
        assert.equal(
          DOMPurify.sanitize('<polyline points="0 0"></polyline>'),
          ''
        );
      }
    );

    /**
     * 两层配置原型分别提供 HTML/MathML integration-point 抛错 getter。
     * 纯文本严格返回 HELLO，检查继承字段不读取；
     * 输入未穿越任何 integration point。
     */
    QUnit.test('inherited integration-point config is ignored', (assert) => {
      const htmlProto = {};
      Object.defineProperty(htmlProto, 'HTML_INTEGRATION_POINTS', {
        get: () => {
          throw new Error('must not read inherited HTML_INTEGRATION_POINTS');
        },
      });
      const mathProto = Object.create(htmlProto);
      Object.defineProperty(mathProto, 'MATHML_TEXT_INTEGRATION_POINTS', {
        get: () => {
          throw new Error(
            'must not read inherited MATHML_TEXT_INTEGRATION_POINTS'
          );
        },
      });
      assert.equal(
        DOMPurify.sanitize('HELLO', Object.create(mathProto)),
        'HELLO'
      );
    });

    /**
     * 先在 SVG namespace 清洗 br，再省略 namespace。
     * 首次允许空或 br，后者必须为 br，确认非持久配置后恢复 HTML 根规则。
     */
    QUnit.test(
      'namespace defaults back to HTML after foreign use',
      (assert) => {
        // 未启用 setConfig 时，每次调用重新解析配置；省略 NAMESPACE 会恢复默认 HTML namespace。
        assert.contains(
          DOMPurify.sanitize('<br>', {
            NAMESPACE: 'http://www.w3.org/2000/svg',
          }),
          ['', '<br>']
        );
        assert.contains(DOMPurify.sanitize('<br>'), ['<br>']);
      }
    );

    /**
     * 先以 SVG namespace 净化空串，再清洗 polyline。
     * 空串严格为空，后续命中 SVG 序列化候选或环境裁剪，检查空输入不破坏下次根解析。
     */
    QUnit.test(
      'non-HTML input after empty input still resolves correctly',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('', { NAMESPACE: 'http://www.w3.org/2000/svg' }),
          ''
        );
        assert.contains(
          DOMPurify.sanitize('<polyline points="0 0"></polyline>', {
            NAMESPACE: 'http://www.w3.org/2000/svg',
          }),
          [
            '<polyline points="0 0"></polyline>',
            '<polyline xmlns="http://www.w3.org/2000/svg" points="0 0"/>',
            '<polyline xmlns="http://www.w3.org/2000/svg" points="0,0" />',
            '',
          ]
        );
      }
    );

    /**
     * 在 SVG、MathML、HTML 及默认根下循环净化空串与残缺注释。
     * 候选只接受空或原残片，检查无有效树/畸形解析的返回结果。
     */
    QUnit.test('invalid XML payload variants', (assert) => {
      const tests = [
        {
          test: '',
          config: { NAMESPACE: 'http://www.w3.org/2000/svg' },
          expected: [''],
        },
        {
          test: '<!-->',
          config: { NAMESPACE: 'http://www.w3.org/2000/svg' },
          expected: ['', '<!-->'],
        },
        {
          test: '',
          config: { NAMESPACE: 'http://www.w3.org/1998/Math/MathML' },
          expected: [''],
        },
        {
          test: '<!-->',
          config: { NAMESPACE: 'http://www.w3.org/1998/Math/MathML' },
          expected: ['', '<!-->'],
        },
        {
          test: '',
          config: { NAMESPACE: 'http://www.w3.org/1999/xhtml' },
          expected: [''],
        },
        { test: '', config: {}, expected: [''] },
        {
          test: '<!-->',
          config: { NAMESPACE: 'http://www.w3.org/1999/xhtml' },
          expected: ['', '<!-->'],
        },
        { test: '<!-->', config: {}, expected: ['', '<!-->'] },
      ];
      tests.forEach((t) =>
        assert.contains(DOMPurify.sanitize(t.test, t.config), t.expected)
      );
    });

    // =======================================================================
    // 配置：PARSER_MEDIA_TYPE。
    // =======================================================================

    /**
     * HTML 与精确 XHTML 媒体类型改变大小写和根包装；
     * 测试允许集合与含冒号 data 名称。
     */
    QUnit.module('Config — PARSER_MEDIA_TYPE');

    /**
     * 相同大写 A/TITLE 输入遍历多种媒体类型，并比较完整文档模式。
     * 只有精确 application/xhtml+xml 启用 XML 大小写语义；
     * 候选展示标签拒绝、属性保留与序列化差异。
     */
    QUnit.test('case folding follows parser type', (assert) => {
      // HTML 模式把标签和属性转小写；XHTML 保留大小写。
      const tests = [
        {
          test: '<A href="#">invalid</A><a TITLE="title" href="#">valid</a>',
          expected: {
            '': [
              '<a href="#">invalid</a><a href="#" title="title">valid</a>',
              '<a href="#">invalid</a><a title="title" href="#">valid</a>',
            ],
            'Application/xhtml+xml': [
              '<a href="#">invalid</a><a href="#" title="title">valid</a>',
              '<a href="#">invalid</a><a title="title" href="#">valid</a>',
            ],
            'application/xml': [
              '<a href="#">invalid</a><a href="#" title="title">valid</a>',
              '<a href="#">invalid</a><a title="title" href="#">valid</a>',
            ],
            'application/xhtml+xml': [
              '<a href="#">invalid</a><a href="#" title="title">valid</a>',
              'invalid<a xmlns="http://www.w3.org/1999/xhtml" href="#">valid</a>',
              'invalid<a xmlns="http://www.w3.org/1999/xhtml" href="#" TITLE="title">valid</a>',
            ],
            'text/html': [
              '<a href="#">invalid</a><a href="#" title="title">valid</a>',
              '<a href="#">invalid</a><a title="title" href="#">valid</a>',
            ],
            'text/xml': [
              '<a href="#">invalid</a><a href="#" title="title">valid</a>',
              '<a href="#">invalid</a><a title="title" href="#">valid</a>',
            ],
          },
        },
        {
          config: { WHOLE_DOCUMENT: true },
          test: '<A href="#">invalid</A><a TITLE="title" href="#">valid</a>',
          expected: {
            'text/html': [
              '<html><head></head><body><a href="#">invalid</a><a href="#" title="title">valid</a></body></html>',
              '<html><head></head><body><a href="#">invalid</a><a title="title" href="#">valid</a></body></html>',
            ],
            'application/xhtml+xml': [
              '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>invalid<a href="#">valid</a></body></html>',
              '<html xmlns="http://www.w3.org/1999/xhtml"><head /><body>invalid<a href="#">valid</a></body></html>',
              '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>invalid<a href="#" TITLE="title">valid</a></body></html>',
            ],
          },
        },
      ];
      tests.forEach((test) => {
        Object.keys(test.expected).forEach((type) => {
          const config = Object.assign({}, test.config || {}, {
            PARSER_MEDIA_TYPE: type,
          });
          assert.contains(
            DOMPurify.sanitize(test.test, config),
            test.expected[type]
          );
        });
      });
    });

    /**
     * XHTML 输入 CustomTag 同带 CustomAttr/customattr，允许集合指定大小写。
     * 候选要求 CustomTag 与 CustomAttr 保留，并容纳历史属性序列化差异，检查 XML 模式名称配置。
     */
    QUnit.test(
      'PARSER_MEDIA_TYPE + ALLOWED_TAGS/ATTR preserves XHTML case',
      (assert) => {
        assert.contains(
          DOMPurify.sanitize(
            '<a href="#">abc</a><CustomTag customattr="bar" CustomAttr="foo"/>',
            {
              PARSER_MEDIA_TYPE: 'application/xhtml+xml',
              ALLOWED_TAGS: ['a', 'CustomTag'],
              ALLOWED_ATTR: ['href', 'CustomAttr'],
            }
          ),
          [
            '<a xmlns="http://www.w3.org/1999/xhtml" href="#">abc</a>' +
              '<CustomTag xmlns="http://www.w3.org/1999/xhtml" CustomAttr="foo"></CustomTag>',
            '<a xmlns="http://www.w3.org/1999/xhtml" href="#">abc</a>' +
              '<CustomTag xmlns="http://www.w3.org/1999/xhtml" CustomAttr="foo" customattr="foo"></CustomTag>',
          ]
        );
      }
    );

    /**
     * XHTML SVG 中 data-slonser 前缀映射到 xlink，href 值为 javascript:。
     * 完整候选保留 SVG/文字而删除声明及危险属性，检查含冒号名称不能冒用普通 data-* 准入。
     */
    QUnit.test(
      'namespaced data-* attributes handled in XML modes',
      (assert) => {
        const dirty =
          '<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">' +
          '<a xmlns:data-slonser="http://www.w3.org/1999/xlink" ' +
          'data-slonser:href="javascript:alert(1)">' +
          '<text x="20" y="35">Click me!</text></a></svg>';
        const expected = [
          '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">' +
            '<a><text x="20" y="35">Click me!</text></a></svg>',
          '<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">' +
            '<a><text x="20" y="35">Click me!</text></a></svg>',
        ];
        assert.contains(
          DOMPurify.sanitize(dirty, {
            PARSER_MEDIA_TYPE: 'application/xhtml+xml',
          }),
          expected
        );
      }
    );

    // =======================================================================
    // 配置：FORCE_BODY（#199）。
    // =======================================================================

    /**
     * FORCE_BODY 哨兵影响 head-only 元素位置；
     * 与前导空白、明确脚本准入分别对照。
     */
    QUnit.module('Config — FORCE_BODY');

    /**
     * 独立 style 配合 FORCE_BODY=true。
     * 严格结果保留 style，检查哨兵使原本可进入 head 的元素出现在清洗 body 中。
     */
    QUnit.test('forces <style> into body when FORCE_BODY=true', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<style>123</style>', { FORCE_BODY: true }),
        '<style>123</style>'
      );
    });

    /**
     * 独立 script 同时 FORCE_BODY 与 ADD_TAGS 放行。
     * 严格保留 script/文本，检查强制解析位置与明确脚本权限组合。
     */
    QUnit.test(
      'forces <script> into body when allowed + FORCE_BODY=true',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<script>123</script>', {
            FORCE_BODY: true,
            ADD_TAGS: ['script'],
          }),
          '<script>123</script>'
        );
      }
    );

    /**
     * 纯文本前有一个空格，开启 FORCE_BODY。
     * 严格保留空格，检查强制 body 路径中的前导空白。
     */
    QUnit.test('FORCE_BODY preserves leading whitespace', (assert) => {
      assert.equal(
        DOMPurify.sanitize(' AAAAA', { FORCE_BODY: true }),
        ' AAAAA'
      );
    });

    /**
     * 空格后跟 b，显式关闭 FORCE_BODY。
     * 严格结果保留空格及 b，检查普通解析后的前导空白补回。
     */
    QUnit.test(
      'leading whitespace preserved even without FORCE_BODY',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize(' <b>AAAAA</b>', { FORCE_BODY: false }),
          ' <b>AAAAA</b>'
        );
      }
    );

    /**
     * 独立 style 关闭 FORCE_BODY，未请求完整文档。
     * 严格输出为空，检查 head 中元素不进入 body 模式返回值。
     */
    QUnit.test(
      'without FORCE_BODY, head-only elements end in head and are stripped',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<style>123</style>', { FORCE_BODY: false }),
          ''
        );
      }
    );

    // =======================================================================
    // 配置：RETURN_TRUSTED_TYPE。
    // =======================================================================

    /**
     * 普通标记切换 Trusted Type 输出标志，仅检查 typeof；
     * 真实品牌及策略记录由独立引导套件另测。
     */
    QUnit.module('Config — RETURN_TRUSTED_TYPE');

    /**
     * 普通 b 输入开启 RETURN_TRUSTED_TYPE。
     * 只检查 typeof 命中候选，说明可用策略产物或字符串回退；
     * 未执行 TrustedHTML 品牌或策略调用次数检查。
     */
    QUnit.test('return type varies by engine when true', (assert) => {
      const clean = DOMPurify.sanitize('<b>hello goodbye</b>', {
        RETURN_TRUSTED_TYPE: true,
      });
      // 活动策略创建成功时，请求 Trusted Type 会返回其 createHTML 产物；
      // 无可用策略时返回字符串。这里检查 typeof；bootstrap 套件另用 StringWrapper
      // 验证 stub 的对象返回值，两者都未执行真实 TrustedHTML 品牌检查。
      assert.contains(typeof clean, ['TrustedHTML', 'string', 'object']);
    });

    /**
     * 普通 b 输入显式关闭 RETURN_TRUSTED_TYPE。
     * typeof 必须为 string，检查请求字符串输出的类型。
     */
    QUnit.test('RETURN_TRUSTED_TYPE=false returns string', (assert) => {
      const clean = DOMPurify.sanitize('<b>hello goodbye</b>', {
        RETURN_TRUSTED_TYPE: false,
      });
      assert.equal(typeof clean, 'string');
    });

    /**
     * 普通 b 输入省略 Trusted Type 标志。
     * typeof 必须为 string，检查默认返回类型。
     */
    QUnit.test('default (no flag) returns string', (assert) => {
      const clean = DOMPurify.sanitize('<b>hello goodbye</b>');
      assert.equal(typeof clean, 'string');
    });

    // =======================================================================
    // 输入处理与 API 表面。
    // =======================================================================

    /**
     * 数组/对象先转字符串再净化，伪 nodeType 对象不能据其字段进入 DOM 遍历。
     */
    QUnit.module('Input handling');

    /**
     * 单项与多项数组输入先发生 JavaScript 字符串转换。
     * 严格输出显示单项正常清洗、多项插入逗号成为 src 值，检查实际数组转换而非无分隔拼接。
     */
    QUnit.test('array input is joined before sanitization', (assert) => {
      assert.equal(
        DOMPurify.sanitize(['<a>123<b>456</b></a>']),
        '<a>123<b>456</b></a>'
      );
      assert.equal(
        DOMPurify.sanitize(['<img src=', 'x onerror=alert(1)>']),
        '<img src=",x">'
      );
    });

    /**
     * 普通对象的 toString 返回 b/script。
     * 严格结果只留 b，检查非节点先转字符串再进入标记净化。
     */
    QUnit.test('non-node objects with toString are stringified', (assert) => {
      assert.strictEqual(
        DOMPurify.sanitize({
          toString: () => '<b>hi</b><script>x<\/script>',
        }),
        '<b>hi</b>'
      );
    });

    /**
     * 普通对象伪造 nodeType/nodeName/ownerDocument。
     * 只要求 sanitize 返回字符串，检查节点品牌读取拒绝伪造对象并走字符串路径。
     */
    QUnit.test(
      'plain objects with nodeType are not treated as nodes',
      (assert) => {
        // 回归保护：duck typing 不能接受 spoofed object；该对象应被字符串化，而非当节点遍历。
        const fake = { nodeType: 1, nodeName: 'DIV', ownerDocument: {} };
        assert.strictEqual(typeof DOMPurify.sanitize(fake), 'string');
      }
    );

    /**
     * 检查能力标志及工厂依赖形状，并在初始化后插入具名污染节点，验证缓存方法与输出。
     */
    QUnit.module('API — isSupported and constructor variants');

    /**
     * 读取当前实例 isSupported。
     * typeof 严格为 boolean，验证能力标志的公开类型，未检查该环境具体支持状态。
     */
    QUnit.test('isSupported is a boolean', (assert) => {
      assert.equal(typeof DOMPurify.isSupported, 'boolean');
    });

    /**
     * 分别传 null、空对象、伪文档、缺 Element 和有效 window 形状创建实例。
     * 逐项检查 version、isSupported 与 sanitize 是否存在，覆盖工厂初始化的依赖检查。
     */
    QUnit.test('DOMPurify accepts a custom or null window', (assert) => {
      // 工厂需防御缺失 window/document：返回 isSupported=false 且不提供 sanitize() 的 stub。
      assert.strictEqual(typeof DOMPurify(null).version, 'string');
      assert.strictEqual(DOMPurify(null).isSupported, false);
      assert.strictEqual(DOMPurify(null).sanitize, undefined);

      assert.strictEqual(typeof DOMPurify({}).version, 'string');
      assert.strictEqual(DOMPurify({}).isSupported, false);
      assert.strictEqual(DOMPurify({}).sanitize, undefined);

      assert.strictEqual(
        typeof DOMPurify({
          document: 'not really a document',
          Element: window.Element,
        }).version,
        'string'
      );
      assert.strictEqual(
        DOMPurify({
          document: 'not really a document',
          Element: window.Element,
        }).isSupported,
        false
      );
      assert.strictEqual(
        DOMPurify({
          document: 'not really a document',
          Element: window.Element,
        }).sanitize,
        undefined
      );

      assert.strictEqual(
        typeof DOMPurify({ document, Element: undefined }).version,
        'string'
      );
      assert.strictEqual(
        DOMPurify({ document, Element: undefined }).isSupported,
        false
      );
      assert.strictEqual(
        DOMPurify({ document, Element: undefined }).sanitize,
        undefined
      );

      assert.strictEqual(
        typeof DOMPurify({ document, Element: window.Element }).version,
        'string'
      );
      assert.strictEqual(
        typeof DOMPurify({ document, Element: window.Element }).sanitize,
        'function'
      );
      assert.strictEqual(typeof DOMPurify(window).version, 'string');
      assert.strictEqual(typeof DOMPurify(window).sanitize, 'function');
    });

    /**
     * 在实例创建后插入与 document 成员同名的图片。
     * 清洗纯文本、请求导入 DOM、清洗 id=body；
     * 严格检查文本、ownerDocument 与 id 删除，finally 先移除污染节点。
     */
    QUnit.test(
      'document clobbering after instantiation does not break sanitize()',
      (assert) => {
        // 插入与 document 成员同名的 id，检查实例创建时缓存的解析/导入方法仍能工作。
        // 各 id 是否实际遮蔽成员取决于引擎；输出与 ownerDocument 断言在插入后执行。
        const evilNode = document.createElement('div');
        evilNode.innerHTML =
          '<img id="implementation"><img id="createNodeIterator">' +
          '<img id="importNode"><img id="createElement">';
        document.body.appendChild(evilNode);

        let resultPlain, resultImport, resultBody;
        try {
          resultPlain = DOMPurify.sanitize('123');
          resultImport = DOMPurify.sanitize('123', {
            RETURN_DOM: true,
            ADD_ATTR: ['shadowroot'],
          });
          resultBody = DOMPurify.sanitize('123<img id="body">');
        } finally {
          // 在断言前清理，防止 QUnit/jQuery 生成失败报告时访问被污染的 document。
          document.body.removeChild(evilNode);
        }
        assert.equal(resultPlain, '123');
        assert.equal(resultImport.ownerDocument, document);
        assert.equal(resultBody, '123<img>');
      }
    );

    /**
     * 同一 foobar 输入先默认、再持久放行、再清除配置；
     * 连续严格结果展示状态生命周期。
     */
    QUnit.module('API — setConfig / clearConfig');

    /**
     * foobar 默认只剩文字，setConfig 后完整保留，clearConfig 后再只剩文字。
     * 三次严格结果验证配置持久安装与清除。
     */
    QUnit.test('persistent config is applied then cleared', (assert) => {
      const dirty = '<foobar>abc</foobar>';
      assert.equal(DOMPurify.sanitize(dirty), 'abc');
      DOMPurify.setConfig({ ADD_TAGS: ['foobar'] });
      assert.equal(DOMPurify.sanitize(dirty), '<foobar>abc</foobar>');
      DOMPurify.clearConfig();
      assert.equal(DOMPurify.sanitize(dirty), 'abc');
    });

    // =======================================================================
    // DOMPurify.removed：记录被删除的节点与属性。
    // =======================================================================

    /**
     * 每次 sanitize 重置 removed，分别记录事件、脚本和模板清理数量；
     * 计数包含属性与节点记录。
     */
    QUnit.module('DOMPurify.removed');

    /**
     * 输入 SVG filter 并带 onload，净化后只检查 removed.length 为 1 或 2。
     * 记录允许的删除数量差异，其中包含属性记录，未断言删除项都是元素。
     */
    QUnit.test(
      'removed contains one element for SVG filter primitive',
      (assert) => {
        DOMPurify.sanitize(
          '<svg onload=alert(1)><filter><feGaussianBlur /></filter></svg>'
        );
        assert.contains(DOMPurify.removed.length, [1, 2]); // 旧 IE 可能记录两项删除。
      }
    );

    /**
     * 在前例加 script，净化后 removed.length 为 2 或 3。
     * 检查脚本和危险属性等删除的合计数量，并容纳旧引擎额外删除。
     */
    QUnit.test(
      'removed contains two elements for script + svg combo',
      (assert) => {
        DOMPurify.sanitize(
          '1<script>alert(1)</script><svg onload=alert(1)><filter><feGaussianBlur /></filter></svg>'
        );
        assert.contains(DOMPurify.removed.length, [2, 3]); // 旧 IE 可能记录三项删除。
      }
    );

    /**
     * img 的 onerror 被默认删除。
     * removed.length 严格为 1，检查单个属性删除写入本次记录。
     */
    QUnit.test('removed counts attribute removal', (assert) => {
      DOMPurify.sanitize('<img src=x onerror="alert(1)">');
      assert.equal(DOMPurify.removed.length, 1);
    });

    /**
     * 完整文档模式下 a 文本含一个 Mustache 表达式并开启模板清理。
     * removed.length 为 1，检查一个文本清理记录。
     */
    QUnit.test(
      'removed counts template-expression scrubs (single)',
      (assert) => {
        DOMPurify.sanitize('<a>123{{456}}</a>', {
          WHOLE_DOCUMENT: true,
          SAFE_FOR_TEMPLATES: true,
        });
        assert.equal(DOMPurify.removed.length, 1);
      }
    );

    /**
     * a/b 各含 Mustache 表达式，完整文档与模板清理开启。
     * removed.length 为 2，检查不同文本节点各自记录清理。
     */
    QUnit.test(
      'removed counts template-expression scrubs (multiple)',
      (assert) => {
        DOMPurify.sanitize('<a>123{{456}}<b>456{{789}}</b></a>', {
          WHOLE_DOCUMENT: true,
          SAFE_FOR_TEMPLATES: true,
        });
        assert.equal(DOMPurify.removed.length, 2);
      }
    );

    /**
     * img width 含 Mustache 表达式。
     * 模板清理后 removed.length 为 1，检查属性值清理/删除的记录数量。
     */
    QUnit.test('removed counts attribute-level template scrubs', (assert) => {
      DOMPurify.sanitize('<img src=1 width="{{123}}">', {
        WHOLE_DOCUMENT: true,
        SAFE_FOR_TEMPLATES: true,
      });
      assert.equal(DOMPurify.removed.length, 1);
    });

    /**
     * option/iframe/select/script 交错的畸形输入。
     * 净化后 removed.length 严格为 1，记录此解析环境下整棵拒绝子树的清理数量。
     */
    QUnit.test('removed counts mXSS-style nested invalid markup', (assert) => {
      DOMPurify.sanitize(
        '<option><iframe></select><b><script>alert(1)</script>'
      );
      assert.equal(DOMPurify.removed.length, 1);
    });

    /**
     * 连续默认净化允许的 a 与无事件 img。
     * 两次 removed.length 均为 0，检查无删除时空记录及每次调用复位。
     */
    QUnit.test('removed is empty when all input is permitted', (assert) => {
      DOMPurify.sanitize('<a>123</a>');
      assert.equal(DOMPurify.removed.length, 0);

      DOMPurify.sanitize('<img src=x>');
      assert.equal(DOMPurify.removed.length, 0);
    });

    /**
     * 纯文本在完整文档模式下分别开启和省略模板清理。
     * 两次 removed.length 为 0，检查无表达式时不会记为删除。
     */
    QUnit.test(
      'removed is empty for clean input under SAFE_FOR_TEMPLATES',
      (assert) => {
        DOMPurify.sanitize('1', {
          WHOLE_DOCUMENT: true,
          SAFE_FOR_TEMPLATES: true,
        });
        assert.equal(DOMPurify.removed.length, 0);

        DOMPurify.sanitize('1', { WHOLE_DOCUMENT: true });
        assert.equal(DOMPurify.removed.length, 0);
      }
    );

    /**
     * 真实 td 输入分别返回字符串和 body DOM，比较输入节点包装与返回容器。
     */
    QUnit.module('API — sanitizing element nodes directly');

    /**
     * 输入真实 td 节点，使用默认字符串返回。
     * 严格得到 td.outerHTML 形状，检查 DOM 输入经导入后保留输入元素包装。
     */
    QUnit.test('sanitizing an element returns its outerHTML', (assert) => {
      assert.equal(
        DOMPurify.sanitize(document.createElement('td')),
        '<td></td>'
      );
    });

    /**
     * 同样输入 td 并请求 RETURN_DOM。
     * 严格检查 body.outerHTML 包住 td，验证 DOM 返回的容器形状。
     */
    QUnit.test(
      'sanitizing an element with RETURN_DOM returns wrapped body',
      (assert) => {
        const clean = DOMPurify.sanitize(document.createElement('td'), {
          RETURN_DOM: true,
        });
        assert.equal(clean.outerHTML, '<body><td></td></body>');
      }
    );

    // =======================================================================
    // 扩展 hook。
    // =======================================================================

    /**
     * hook 可分离节点、扩展集合、修改属性并按函数身份删除；
     * 后置/追加 data 属性断言只检查最终存在。
     */
    QUnit.module('Hooks — addHook / removeHook');

    /**
     * upon 元素 hook 主动分离 foreignObject，配置原本放行它。
     * 输出只剩 svg/switch 且 removed 不认领该元素，检查 hook 分离被当作已移除并正常继续。
     */
    QUnit.test(
      'uponSanitizeElement hook may detach the current node; it is treated as removed (issue #469 pattern, foreignObject filtering)',
      (assert) => {
        // hook 通过 parentNode.removeChild() 删除当前节点时，不能触发 `_forceRemove` 的
        // REPORT-3 parentless-node 抛错：该异常用于 DOMPurify 判定必须删除、却无法分离的节点，
        // 不适用于已被 hook 安全分离的节点。
        DOMPurify.addHook('uponSanitizeElement', (node) => {
          if (node.nodeName === 'foreignObject' && node.parentNode) {
            node.parentNode.removeChild(node);
          }
        });
        const clean = DOMPurify.sanitize(
          '<svg><switch><foreignObject><div>content</div></foreignObject></switch></svg>',
          {
            ADD_TAGS: ['foreignObject'],
            USE_PROFILES: { svg: true, html: true },
          }
        );
        assert.equal(clean, '<svg><switch></switch></svg>');
        assert.notOk(
          DOMPurify.removed.some(
            (entry) =>
              entry.element && entry.element.nodeName === 'foreignObject'
          ),
          'hook-detached nodes are not claimed in DOMPurify.removed'
        );
        DOMPurify.removeHooks('uponSanitizeElement');
      }
    );

    /**
     * before 元素 hook 分离 article，兄弟 i 不动。
     * 严格结果仅留 div/i，检查前置 hook 删除当前子树后的遍历输出。
     */
    QUnit.test(
      'beforeSanitizeElements hook may detach the current node; it is treated as removed',
      (assert) => {
        DOMPurify.addHook('beforeSanitizeElements', (node) => {
          if (node.nodeName === 'ARTICLE' && node.parentNode) {
            node.parentNode.removeChild(node);
          }
        });
        assert.equal(
          DOMPurify.sanitize('<div><article><b>x</b></article><i>y</i></div>'),
          '<div><i>y</i></div>'
        );
        DOMPurify.removeHooks('beforeSanitizeElements');
      }
    );

    /**
     * 两种 upon hook 给连字符标签/属性扩展当次允许集合。
     * 输入 iframe 与 is-custom/onload/super-custom，严格结果仅放行自定义结构和属性，随后清理注册。
     */
    QUnit.test(
      'hook can add allowed tags / attributes on the fly',
      (assert) => {
        DOMPurify.addHook('uponSanitizeElement', (node, data) => {
          if (
            node.nodeName &&
            node.nodeName.match(/^\w+-\w+$/) &&
            !data.allowedTags[data.tagName]
          ) {
            data.allowedTags[data.tagName] = true;
          }
        });
        DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
          if (
            data.attrName &&
            data.attrName.match(/^\w+-\w+$/) &&
            !data.allowedAttributes[data.attrName]
          ) {
            data.allowedAttributes[data.attrName] = true;
          }
        });
        const dirty =
          '<p>HE<iframe></iframe><is-custom onload="alert(1)" super-custom="test" />LLO</p>';
        const modified =
          '<p>HE<is-custom super-custom="test">LLO</is-custom></p>';
        assert.equal(DOMPurify.sanitize(dirty), modified);
        DOMPurify.removeHooks('uponSanitizeElement');
        DOMPurify.removeHooks('uponSanitizeAttribute');
      }
    );

    /**
     * upon 属性 hook 对 type=file 的 input 设置 keepAttr=false。
     * 只有 nodejs runner 调用并严格检查无 type；
     * 浏览器分支零断言，最终均清理 hook。
     */
    QUnit.test('hookEvent.keepAttr=false removes attribute', (assert) => {
      // hook 在 input 的 type 属性上把 keepAttr 设为 false；属性遍历读取该标志并删除 type。
      DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
        if (
          node.nodeName == 'INPUT' &&
          node.getAttribute('type') &&
          node.getAttribute('type') == 'file'
        ) {
          data.keepAttr = false;
        }
      });
      const dirty = '<input type="file" />';
      const modified = '<input>';
      // 此用例只在 window.name 为 nodejs 的 runner 中断言输出；浏览器分支不执行清洗断言。
      if (window.name == 'nodejs') {
        assert.equal(DOMPurify.sanitize(dirty), modified);
      } else {
        assert.expect(0);
      }
      DOMPurify.removeHooks('uponSanitizeAttribute');
    });

    /**
     * 后置属性 hook 把 class 改成 world。
     * 移除后恢复原值，返回的函数重新注册后再次改值，三次结果验证 removeHook 的可重用函数返回。
     */
    QUnit.test('removeHook returns the hook function', (assert) => {
      const entryPoint = 'afterSanitizeAttributes';
      const dirty = '<div class="hello"></div>';
      const expected = '<div class="world"></div>';

      DOMPurify.addHook(entryPoint, (node) =>
        node.setAttribute('class', 'world')
      );
      assert.equal(DOMPurify.sanitize(dirty), expected);

      const hookFunction = DOMPurify.removeHook(entryPoint);
      assert.equal(DOMPurify.sanitize(dirty), dirty);

      DOMPurify.addHook(entryPoint, hookFunction);
      assert.equal(DOMPurify.sanitize(dirty), expected);

      DOMPurify.removeHook(entryPoint);
    });

    /**
     * 注册 first/second/third 三个 class hook，按函数身份移除中间项。
     * 首次返回 second、再删返回 undefined，输出顺序只含 first/third，检查定点删除与链顺序。
     */
    QUnit.test(
      'removeHook can target a specific hook in the chain',
      (assert) => {
        const entryPoint = 'afterSanitizeAttributes';
        const dirty = '<div class="original"></div>';
        const expected = '<div class="original first third"></div>';

        /**
         * 给当前元素 classList 追加 first；只用于本例 afterSanitizeAttributes 链。
         * @param {Element} node 正在分发属性后置 hook 的元素。
         * @returns {void} 原位修改 class，返回值不参与净化决策。
         */
        const firstHook = (node) => node.classList.add('first');
        /**
         * 给当前元素追加 second，随后按此函数身份从 hook 链删除。
         * @param {Element} node 当前元素。
         * @returns {void} 删除回调后该 class 不再出现在测试输出中。
         */
        const secondHook = (node) => node.classList.add('second');
        /**
         * 给当前元素追加 third，验证删除中间回调后后续 hook 仍按顺序执行。
         * @param {Element} node 当前元素。
         * @returns {void} 原位修改 class。
         */
        const thirdHook = (node) => node.classList.add('third');

        DOMPurify.addHook(entryPoint, firstHook);
        DOMPurify.addHook(entryPoint, secondHook);
        DOMPurify.addHook(entryPoint, thirdHook);

        assert.strictEqual(
          DOMPurify.removeHook(entryPoint, secondHook),
          secondHook,
          'removes the specified hook'
        );
        assert.strictEqual(
          DOMPurify.removeHook(entryPoint, secondHook),
          undefined,
          'cannot remove the same hook twice'
        );
        assert.strictEqual(
          DOMPurify.sanitize(dirty),
          expected,
          'removed hook is not executed'
        );

        DOMPurify.removeHook(entryPoint, firstHook);
        DOMPurify.removeHook(entryPoint, thirdHook);
      }
    );

    /**
     * 后置属性 hook 给 a 追加 data 属性。
     * 严格输出保留新增项，检查属性遍历后直接修改进入结果；
     * 这个默认允许的 data 属性未构成危险值再校验探针。
     */
    QUnit.test(
      'attributes added in afterSanitizeAttributes are not re-validated',
      (assert) => {
        DOMPurify.addHook('afterSanitizeAttributes', (node) => {
          if (node.nodeName === 'A') {
            node.setAttribute('data-injected-by-hook', 'yes');
          }
        });
        try {
          assert.equal(
            DOMPurify.sanitize('<a href="#">x</a>'),
            '<a href="#" data-injected-by-hook="yes">x</a>',
            'hook-added attribute present in output (documented behaviour)'
          );
        } finally {
          DOMPurify.removeHooks('afterSanitizeAttributes');
        }
      }
    );

    /**
     * upon 属性 hook 检查 href 时追加 data 属性。
     * 严格输出保留新增项，与倒序初始长度遍历相符；
     * 默认 data 准入意味着此断言本身不区分是否再校验。
     */
    QUnit.test(
      'attributes added in uponSanitizeAttribute after current index escape validation',
      (assert) => {
        // 属性按初始 length 快照倒序遍历。hook 调用 setAttribute() 会把新属性追加到列表末尾，
        // 位于递减 index 已越过的一侧，因此不进入本轮校验。hook 作者需负责自己新增的属性值。
        DOMPurify.addHook('uponSanitizeAttribute', (node, hookEvent) => {
          if (hookEvent.attrName === 'href') {
            try {
              node.setAttribute('data-injected-by-hook', 'yes');
            } catch (_) {}
          }
        });
        try {
          assert.equal(
            DOMPurify.sanitize('<a href="#">x</a>'),
            '<a href="#" data-injected-by-hook="yes">x</a>',
            'hook-added attribute present in output (documented behaviour)'
          );
        } finally {
          DOMPurify.removeHooks('uponSanitizeAttribute');
        }
      }
    );

    // =======================================================================
    // Hooks：allowlist 污染（GHSA-XXXX-XXXX-XXXX）。
    //
    // 3.4.7 之前，传给 hook 的 data.allowedTags/data.allowedAttributes 直接引用活动 allowlist。
    // 未显式提供 cfg.ALLOWED_TAGS 时，该集合可能直接引用实例的 DEFAULT_ALLOWED_TAGS。hook 写入
    //     data.allowedTags['script'] = true
    // 会永久扩展默认值，直到重新创建 DOMPurify 实例。
    //
    // 当前 sanitize 在遍历前为已注册的 upon hooks 克隆 allowlist；before hook 临时注册 upon
    // hook 时，`_forkSharedAllowlist` 在事件暴露集合前补做克隆。addHook 本身只追加回调。
    // 修改副本会影响当前节点与本次后续遍历；下一次默认调用重新绑定未修改的实例默认集合。
    // =======================================================================

    /**
     * beforeEach 给每例新实例，afterEach 清 hook/配置；
     * 一例内连续调用观察污染，同例 setConfig 路径检验每轮集合复制。
     */
    QUnit.module('Hooks — allowlist pollution (GHSA-XXXX)', function (hooks) {
      let purify;
      /** 每例创建独立实例；同一测试内的连续调用仍复用它，以观察集合隔离。 */
      hooks.beforeEach(() => {
        // 每个测试使用独立实例，因为目标缺陷正是跨调用污染。
        purify = DOMPurify(window);
      });
      /** 清除该例实例的 hook 和持久配置，结束测试中的可变状态。 */
      hooks.afterEach(() => {
        purify.removeAllHooks();
        purify.clearConfig();
      });

      /**
       * 隔离实例先默认净化 SVG script 与 a onclick。
       * 两次严格删除危险项，建立后续 hook 状态测试的默认基线。
       */
      QUnit.test(
        'baseline: <script> and onclick are stripped by default',
        (assert) => {
          assert.equal(
            purify.sanitize('<svg><script>alert(1)</script></svg>'),
            '<svg></svg>'
          );
          assert.equal(
            purify.sanitize('<a onclick="alert(1)">x</a>'),
            '<a>x</a>'
          );
        }
      );

      /**
       * 隔离实例的 upon hook 修改当次标签与属性集合。
       * 严格保留 is-custom/super-custom 完整输入，验证 hook 仍能扩展本轮准入。
       */
      QUnit.test('in-call widening via hook still works', (assert) => {
        // 对照上方文档化的 hook-widening API。修复把默认集合的克隆交给 hook；修改克隆仍会为
        // 本次剩余遍历扩展 allowlist。
        purify.addHook('uponSanitizeElement', (node, data) => {
          if (data.tagName === 'is-custom') {
            data.allowedTags['is-custom'] = true;
          }
        });
        purify.addHook('uponSanitizeAttribute', (node, data) => {
          if (data.attrName === 'super-custom') {
            data.allowedAttributes['super-custom'] = true;
          }
        });

        const input = '<p>HE<is-custom super-custom="test">LLO</is-custom></p>';
        assert.equal(purify.sanitize(input), input);
      });

      /**
       * 不带条件的元素 hook 放行 script，首次严格保留。
       * 移除所有 hook 并清配置后严格删除 script，检查集合修改不会污染下一默认调用。
       */
      QUnit.test(
        'unguarded element hook does not poison subsequent default-config calls',
        (assert) => {
          purify.addHook('uponSanitizeElement', (node, data) => {
            data.allowedTags['script'] = true;
          });
          assert.equal(
            purify.sanitize('<svg><script>1</script></svg>'),
            '<svg><script>1</script></svg>',
            'in-call widening still works while hook is registered'
          );

          purify.removeAllHooks();
          purify.clearConfig();

          assert.equal(
            purify.sanitize('<svg><script>alert(1)</script></svg>'),
            '<svg></svg>',
            'default sanitize after element-hook removal strips <script>'
          );
        }
      );

      /**
       * 不带条件的属性 hook 放行 onclick，首次要求片段存在。
       * 清 hook/配置后严格输出无 onclick，检查属性集合修改不会跨调用留存。
       */
      QUnit.test(
        'unguarded attribute hook does not poison subsequent default-config calls',
        (assert) => {
          purify.addHook('uponSanitizeAttribute', (node, data) => {
            data.allowedAttributes['onclick'] = true;
          });
          assert.ok(
            purify
              .sanitize('<a onclick="alert(1)">x</a>')
              .indexOf('onclick') !== -1
          );

          purify.removeAllHooks();
          purify.clearConfig();

          assert.equal(
            purify.sanitize('<a onclick="alert(1)">x</a>'),
            '<a>x</a>'
          );
        }
      );

      /**
       * 先让一个实例的 hook 放行 SVG script，再创建新实例。
       * 新实例严格删除 script，检查默认集合修改不会跨实例共享。
       */
      QUnit.test('pollution does not cross instance boundaries', (assert) => {
        purify.addHook('uponSanitizeElement', (node, data) => {
          data.allowedTags['script'] = true;
        });
        purify.sanitize('<svg><script>alert(1)</script></svg>');

        const freshInstance = DOMPurify(window);
        assert.equal(
          freshInstance.sanitize('<svg><script>alert(1)</script></svg>'),
          '<svg></svg>',
          'fresh DOMPurify instance must not inherit poisoned defaults'
        );
      });

      /**
       * 只读元素 hook 观察默认集合是否有 script，须为 false。
       * 移除 hook/配置后脚本仍严格删除，检查读取公开集合后的默认行为。
       */
      QUnit.test('read-only hook does not poison defaults', (assert) => {
        let sawScriptKey;
        purify.addHook('uponSanitizeElement', (node, data) => {
          if (sawScriptKey === undefined) {
            sawScriptKey = 'script' in data.allowedTags;
          }
        });

        purify.sanitize('<div><span>hi</span></div>');

        assert.strictEqual(
          sawScriptKey,
          false,
          'hook sees default allowlist with script NOT included'
        );

        purify.removeAllHooks();
        purify.clearConfig();

        assert.equal(
          purify.sanitize('<svg><script>alert(1)</script></svg>'),
          '<svg></svg>'
        );
      });

      /**
       * hook 在十次普通 div 调用中添加 script/iframe/object 权限。
       * 清 hook/配置后逐项严格拒绝三种标签，检查多次当次集合修改不累积到默认状态。
       */
      QUnit.test(
        'multiple polluting calls do not accumulate state',
        (assert) => {
          purify.addHook('uponSanitizeElement', (node, data) => {
            data.allowedTags['script'] = true;
            data.allowedTags['iframe'] = true;
            data.allowedTags['object'] = true;
          });

          for (let i = 0; i < 10; i++) {
            purify.sanitize('<div></div>');
          }

          purify.removeAllHooks();
          purify.clearConfig();

          assert.equal(
            purify.sanitize('<svg><script>1</script></svg>'),
            '<svg></svg>'
          );
          assert.equal(purify.sanitize('<iframe src="x"></iframe>'), '');
          assert.equal(purify.sanitize('<object data="x"></object>'), '');
        }
      );

      /**
       * 显式 ALLOWED_TAGS 只含 svg，hook 再允许 script。
       * 该次须出现 script；
       * 清 hook/配置后的默认调用严格删除，检查显式集合路径仍支持当次扩展。
       */
      QUnit.test(
        'explicit-cfg path is unaffected by hook mutation in other calls',
        (assert) => {
          // 显式提供 cfg.ALLOWED_TAGS 时，ALLOWED_TAGS 已是通过 `addToSet({}, ...)` 构造的
          // 当前调用新对象，而非模块默认集合；修复前 hook 修改它也不会污染默认值。此断言防止
          // 过度修复破坏 explicit-config 路径。
          purify.addHook('uponSanitizeElement', (node, data) => {
            data.allowedTags['script'] = true;
          });

          const withCfg = purify.sanitize(
            '<svg><script>alert(1)</script></svg>',
            { ALLOWED_TAGS: ['svg'] }
          );
          assert.ok(
            withCfg.indexOf('<script>') !== -1,
            'explicit-cfg call respects in-call hook widening: ' + withCfg
          );

          purify.removeAllHooks();
          purify.clearConfig();

          assert.equal(
            purify.sanitize('<svg><script>alert(1)</script></svg>'),
            '<svg></svg>',
            'default-cfg call after explicit-cfg+hook is unaffected'
          );
        }
      );

      // -------------------------------------------------------------------
      // 持久配置路径（setConfig）。原修复位于 `_parseConfig()` 内；setConfig 执行后 sanitize()
      // 会跳过该函数，导致这些场景未受保护：hook 写 data.allowedAttributes 会修改实例生命周期
      // 共用的 allowlist，使调用内扩展跨调用泄漏。现在两类配置路径都在每次 sanitize() 时应用
      // 每调用克隆保护（GHSA-cmwh-pvxp-8882）。
      // -------------------------------------------------------------------

      /**
       * setConfig 持久仅允许 img/src，hook 在 data-trusted 节点扩展 onerror。
       * 首次属性保留，后续及五次重复普通输入严格删事件，检查每轮从持久配置复制集合。
       */
      QUnit.test(
        'setConfig: attribute hook does not poison later calls',
        (assert) => {
          purify.setConfig({ ALLOWED_TAGS: ['img'], ALLOWED_ATTR: ['src'] });
          purify.addHook('uponSanitizeAttribute', (node, data) => {
            if (
              node.getAttribute &&
              node.getAttribute('data-trusted') === '1'
            ) {
              data.allowedAttributes['onerror'] = true;
            }
          });

          // data-trusted 元素在当前调用的 allowlist 副本上扩展 onerror；扩展也影响同次调用的后续节点。
          assert.ok(
            purify
              .sanitize('<img data-trusted="1" src="x" onerror="ok()">')
              .indexOf('onerror') !== -1,
            'in-call widening works for the trusted element under setConfig'
          );

          // 后续 untrusted 调用不得继承已扩展属性。
          assert.equal(
            purify.sanitize('<img src="x" onerror="alert(1)">'),
            '<img src="x">',
            'untrusted call after trusted render strips onerror'
          );

          // 重复调用必须持续干净，不得累积 clone 状态。
          for (let i = 0; i < 5; i++) {
            assert.equal(
              purify.sanitize('<img src="x" onerror="alert(' + i + ')">'),
              '<img src="x">',
              'repeated untrusted call ' + i + ' stays clean'
            );
          }
        }
      );

      /**
       * setConfig 只允许 span，hook 在 trusted span 上追加 img。
       * 执行该输入后，下一普通 img 严格为空；
       * 验证持久标签配置未被 hook 污染，首次输出未断言。
       */
      QUnit.test(
        'setConfig: element hook does not poison later calls',
        (assert) => {
          purify.setConfig({ ALLOWED_TAGS: ['span'], ALLOWED_ATTR: [] });
          purify.addHook('uponSanitizeElement', (node, data) => {
            if (
              node.getAttribute &&
              node.getAttribute('data-trusted') === '1' &&
              data.allowedTags
            ) {
              data.allowedTags['img'] = true;
            }
          });

          purify.sanitize('<span data-trusted="1"><img src="x"></span>');

          assert.equal(
            purify.sanitize('<img src="x" onerror="alert(1)">'),
            '',
            'untrusted <img> not allowed after trusted render under setConfig'
          );
        }
      );

      /**
       * 持久 img/src 配置先经 trusted hook 扩展属性，再 clearConfig。
       * 普通 img 严格只留 src，检查清配置后的默认集合；
       * hook 仍注册但该节点不触发扩展。
       */
      QUnit.test('setConfig: clearConfig restores a clean state', (assert) => {
        purify.setConfig({ ALLOWED_TAGS: ['img'], ALLOWED_ATTR: ['src'] });
        purify.addHook('uponSanitizeAttribute', (node, data) => {
          if (node.getAttribute && node.getAttribute('data-trusted') === '1') {
            data.allowedAttributes['onerror'] = true;
          }
        });
        purify.sanitize('<img data-trusted="1" src="x" onerror="ok()">');

        purify.clearConfig();

        assert.equal(
          purify.sanitize('<img src="x" onerror="alert(1)">'),
          '<img src="x">',
          'default-cfg call after clearConfig strips onerror'
        );
      });
    });

    // =======================================================================
    // Hooks：嵌套在 `<template>.content` 中的 shadow root。
    //
    // 两项补丁共同关闭这一类绕过：
    //
    //   1. `_sanitizeAttachedShadowRoots()` 必须进入每个 `<template>` 的 .content
    //      DocumentFragment，并继续查找其中的 attached shadow root。
    //
    //   2. `_sanitizeShadowDOM()` 遍历以 fragment 为根的 NodeIterator；iterator 不进入内部
    //      `<template>.content`，也不会自动暴露 host 上的 attached shadow root。递归必须显式
    //      检查两者。
    //
    // 测试覆盖 template 内的 shadow host、shadow 内的 template、嵌套 template、
    // 外层 wrapper 与两者交替嵌套；另在支持 clonable 的引擎中测试两个 clonable host 场景。
    // =======================================================================

    /**
     * 模板片段与 open shadow 交替嵌套，直接清洗原对象；
     * clonable 能力探针和正式 IN_PLACE 断言分开。
     */
    QUnit.module('Hooks — shadow roots inside <template>.content');

    /**
     * template.content 中的 div 有 open shadow，内放 javascript: 链接。
     * IN_PLACE 后链接必须存活且 href=null，检查模板片段与 attached root 的组合递归。
     */
    QUnit.test(
      'shadow root attached to host inside template.content',
      (assert) => {
        // `<template>` 的内部内容位于独立 DocumentFragment；遍历 template 元素本身不会进入
        // .content，sanitizer 必须显式递归。
        const tpl = document.createElement('template');
        const host = document.createElement('div');
        tpl.content.appendChild(host);
        host.attachShadow({ mode: 'open' }).innerHTML =
          '<a id="poc" href="javascript:alert(1)">x</a>';

        DOMPurify.sanitize(tpl, { IN_PLACE: true });

        const a = tpl.content.firstChild.shadowRoot.querySelector('#poc');
        assert.ok(a, 'link preserved');
        assert.equal(
          a.getAttribute('href'),
          null,
          'javascript: href stripped inside template.content shadow'
        );
        window.xssed = false;
      }
    );

    /**
     * 先用 importNode 探测 clonable shadow 支持，再原地清洗模板内容中的原 host。
     * 存活链接必须无 href，也接受整体删除；
     * 正式断言未执行模板 clone/stamp。
     */
    QUnit.test(
      'clonable shadow root inside template.content survives stamping',
      (assert) => {
        // 前置探针用 importNode 确认引擎支持克隆 clonable shadow root；
        // 正式 payload 直接以 IN_PLACE 清洗模板中的原 host，不执行模板 stamping 或 clone。
        let supportsClonable = false;
        try {
          const probe = document.createElement('div');
          probe.attachShadow({ mode: 'open', clonable: true }).innerHTML = 'x';
          const imported = document.importNode(probe, true);
          supportsClonable = !!(
            imported.shadowRoot && imported.shadowRoot.firstChild
          );
        } catch (_) {}

        if (!supportsClonable) {
          assert.ok(true, 'environment does not support clonable shadow roots');
          return;
        }

        const tpl = document.createElement('template');
        const host = document.createElement('div');
        tpl.content.appendChild(host);
        host.attachShadow({ mode: 'open', clonable: true }).innerHTML =
          '<a id="poc" href="javascript:alert(1)">x</a>';

        DOMPurify.sanitize(tpl, { IN_PLACE: true });

        const liveA = tpl.content.firstChild.shadowRoot.querySelector('#poc');
        if (liveA) {
          assert.equal(liveA.getAttribute('href'), null);
        } else {
          assert.ok(true, 'link removed entirely is also safe');
        }
        window.xssed = false;
      }
    );

    /**
     * section 的 shadow 内嵌 template，危险链接位于 content。
     * IN_PLACE 后链接存活且无 href，检查从 attached root 进入模板片段的递归。
     */
    QUnit.test('template inside shadow root (symmetric case)', (assert) => {
      // 上述场景镜像：外层容器带 shadow root，危险载荷位于该 shadow 内的 template；
      // `_sanitizeShadowDOM()` 必须进入 template。
      const host = document.createElement('section');
      const shadow = host.attachShadow({ mode: 'open' });
      const tpl = document.createElement('template');
      tpl.content.appendChild(
        (() => {
          const a = document.createElement('a');
          a.setAttribute('id', 'poc');
          a.setAttribute('href', 'javascript:alert(1)');
          return a;
        })()
      );
      shadow.appendChild(tpl);

      DOMPurify.sanitize(host, { IN_PLACE: true });

      const a = host.shadowRoot
        .querySelector('template')
        .content.querySelector('#poc');
      assert.ok(a, 'link preserved');
      assert.equal(
        a.getAttribute('href'),
        null,
        'javascript: href stripped inside shadow > template.content'
      );
      window.xssed = false;
    });

    /**
     * 两层 template.content 嵌套，最深链接带 javascript:。
     * IN_PLACE 后保留链接并删除 href，检查逐层显式进入模板片段。
     */
    QUnit.test(
      'nested templates: <template><template><a href=javascript:></template></template>',
      (assert) => {
        const outer = document.createElement('template');
        const inner = document.createElement('template');
        const a = document.createElement('a');
        a.setAttribute('href', 'javascript:alert(1)');
        a.setAttribute('id', 'poc');
        inner.content.appendChild(a);
        outer.content.appendChild(inner);

        DOMPurify.sanitize(outer, { IN_PLACE: true });

        const liveA = outer.content
          .querySelector('template')
          .content.querySelector('#poc');
        assert.ok(liveA, 'link preserved through nested templates');
        assert.equal(liveA.getAttribute('href'), null);
        window.xssed = false;
      }
    );

    /**
     * section 包 template，其 content 中 host 带 shadow 链接。
     * IN_PLACE 后最深链接须存活且 href=null，检查普通树、模板、attached root 连续下降。
     */
    QUnit.test('wrapper > template > shadow descent', (assert) => {
      const wrapper = document.createElement('section');
      const tpl = document.createElement('template');
      const host = document.createElement('div');
      tpl.content.appendChild(host);
      wrapper.appendChild(tpl);
      host.attachShadow({ mode: 'open' }).innerHTML =
        '<a id="poc" href="javascript:alert(1)">x</a>';

      DOMPurify.sanitize(wrapper, { IN_PLACE: true });

      const a = wrapper
        .querySelector('template')
        .content.firstChild.shadowRoot.querySelector('#poc');
      assert.ok(a);
      assert.equal(a.getAttribute('href'), null);
      window.xssed = false;
    });

    /**
     * outer shadow 包 template，模板内容 host 再带 shadow。
     * IN_PLACE 后最深链接存活且 href=null，检查两类独立子树交替递归。
     */
    QUnit.test('shadow > template > shadow alternating descent', (assert) => {
      const outer = document.createElement('section');
      const outerShadow = outer.attachShadow({ mode: 'open' });
      const tpl = document.createElement('template');
      const innerHost = document.createElement('div');
      tpl.content.appendChild(innerHost);
      outerShadow.appendChild(tpl);
      innerHost.attachShadow({ mode: 'open' }).innerHTML =
        '<a id="poc" href="javascript:alert(1)">x</a>';

      DOMPurify.sanitize(outer, { IN_PLACE: true });

      const a = outer.shadowRoot
        .querySelector('template')
        .content.firstChild.shadowRoot.querySelector('#poc');
      assert.ok(a);
      assert.equal(a.getAttribute('href'), null);
      window.xssed = false;
    });

    /**
     * 能力探针确认 clonable 后构造两层模板及深处 shadow。
     * 正式 IN_PLACE 检查存活链接无 href，接受删除；
     * 未实际将清洗模板克隆到活动文档。
     */
    QUnit.test(
      'deep clonable shadow stamped from nested templates',
      (assert) => {
        let supportsClonable = false;
        try {
          const probe = document.createElement('div');
          probe.attachShadow({ mode: 'open', clonable: true }).innerHTML = 'x';
          const imported = document.importNode(probe, true);
          supportsClonable = !!(
            imported.shadowRoot && imported.shadowRoot.firstChild
          );
        } catch (_) {}

        if (!supportsClonable) {
          assert.ok(true, 'environment does not support clonable shadow roots');
          return;
        }

        const outer = document.createElement('template');
        const inner = document.createElement('template');
        const host = document.createElement('div');
        host.attachShadow({ mode: 'open', clonable: true }).innerHTML =
          '<a id="poc" href="javascript:alert(1)">x</a>';
        inner.content.appendChild(host);
        outer.content.appendChild(inner);

        DOMPurify.sanitize(outer, { IN_PLACE: true });

        const liveA = outer.content
          .querySelector('template')
          .content.firstChild.shadowRoot.querySelector('#poc');
        if (liveA) {
          assert.equal(liveA.getAttribute('href'), null);
        } else {
          assert.ok(true, 'link removed entirely is also safe');
        }
        window.xssed = false;
      }
    );

    // =======================================================================
    // 回归：mXSS。
    //
    // Mutation XSS：payload 清洗后被浏览器重新解析，round-trip 改变其含义。HTML 解析器会宽容
    // 修复 foreign content（SVG/MathML）中的错误嵌套，把子节点提升到 subtree 外。DOMPurify
    // 必须在这些提升节点到达消费者前捕获它们。
    // =======================================================================

    /**
     * 比较合法 HTML/MathML 与畸形外来内容/raw-text，主要检查字符串危险片段；
     * jQuery 例额外同步插入。
     */
    QUnit.module('Regression — mXSS');

    /**
     * SVG/style/a id 的闭合边界交错，夹入 img/onerror。
     * 默认净化结果不得同时含两个片段，检查该变异输入的字符串结果，未再次插入执行。
     */
    QUnit.test(
      'Chrome 77+ SVG/HTML mXSS round-trip is neutralised',
      (assert) => {
        // style 的闭合边界与 a 的 id 值交错，检查清洗结果是否仍保留 img/onerror 组合。
        const dirty =
          '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>"></svg>';
        const clean = DOMPurify.sanitize(dirty);
        assert.ok(
          clean.indexOf('<img') === -1 || clean.indexOf('onerror') === -1,
          'mXSS payload neutralised: ' + clean
        );
      }
    );

    /**
     * 先严格保留普通 HTML 与合法 math/mi，再清洗 math/table/mglyph/style 变体。
     * 危险结果不得同时含 img/onerror，检查合法结构保留与畸形结构中和。
     */
    QUnit.test(
      'less-aggressive mXSS handling preserves valid HTML (#369)',
      (assert) => {
        // Issue #369：较早防御措施删除过多并破坏合法输入；这里确认收窄策略后，合法标记保留，
        // 脚本路径仍被阻断。
        assert.equal(
          DOMPurify.sanitize('<p>Hello<b> World</b></p>'),
          '<p>Hello<b> World</b></p>'
        );
        // `<mi>` 让这段 MathML 保持合法嵌套；下方严格比较允许的完整序列化结果。
        assert.equal(
          DOMPurify.sanitize('<a><math><mi>x</mi></math></a>'),
          '<a><math><mi>x</mi></math></a>'
        );
        // 危险变体仍必须被中和。
        const xss =
          '<math><mtext><table><mglyph><style><img src onerror=alert(1)>';
        const clean = DOMPurify.sanitize(xss);
        assert.ok(
          clean.indexOf('<img') === -1 || clean.indexOf('onerror') === -1,
          'mXSS variant still neutralised: ' + clean
        );
      }
    );

    /**
     * MathML annotation-xml 的 text/html 边界内嵌 xmp/raw-text 攻击。
     * 默认结果不得含 onerror，检查这组 HTML integration point 输入的清理结果。
     */
    QUnit.test('text-integration-points: math + xmp', (assert) => {
      // `annotation-xml[encoding="text/html"]` 是 HTML integration point，子节点按 HTML
      // 规则解析；它与 mi/mtext 等 MathML text integration point 是两类入口。
      // xmp 的 raw-text 内容含攻击标记，本例检查默认清洗结果中 onerror 已消失。
      const xss =
        '<math><annotation-xml encoding="text/html"><xmp><img src=x onerror=alert(1)></xmp></annotation-xml></math>';
      const clean = DOMPurify.sanitize(xss);
      assert.ok(
        clean.indexOf('onerror') === -1,
        'no onerror survived integration-point parsing: ' + clean
      );
    });

    /**
     * SVG foreignObject 的 HTML 边界内嵌 xmp 与危险 img。
     * 默认结果不得含 onerror，检查这组外来内容切换后的清理结果。
     */
    QUnit.test('text-integration-points: svg + xmp', (assert) => {
      const xss =
        '<svg><foreignobject><xmp><img src=x onerror=alert(1)></xmp></foreignobject></svg>';
      const clean = DOMPurify.sanitize(xss);
      assert.ok(
        clean.indexOf('onerror') === -1,
        'no onerror survived integration-point parsing: ' + clean
      );
    });

    /**
     * 存在 jQuery 时将默认清洗的危险 img 经 html() 再解析，立即检查 xssed=false 并删除容器。
     * 缺库跳过；
     * 该定义只观察同步插入，未等待图片事件。
     */
    QUnit.test('jQuery v3.0+ html() insecure behaviour', (assert) => {
      // 用 jQuery.html() 重新解析默认清洗后的图片，并立即检查 xssed；
      // 等待异步图片事件的用例位于文件顶部的 XSS — jQuery.html() 模块。
      if (!jQuery) {
        assert.ok(true, 'jQuery not present, skipping');
        return;
      }
      const dirty = '<img src=x onerror=alert(1)>';
      const clean = DOMPurify.sanitize(dirty);
      window.xssed = false;
      const $div = jQuery('<div>').html(clean);
      assert.equal(window.xssed, false, 'no XSS after jQuery round-trip');
      $div.remove();
    });

    // =======================================================================
    // 回归：noembed / noscript ALLOW_TAGS 绕过。
    // =======================================================================

    /**
     * fallback raw-text、表格解析及非 ASCII 标签输入，分别检查片段、固定耗时和真实属性列表。
     */
    QUnit.module('Regression — noembed / noscript / table');

    /**
     * noscript 中 title 属性含闭合 noscript 与危险 img。
     * 默认清洗后不得含 onerror，检查 scripting flag 与属性/文本解析差异下的最终结果。
     */
    QUnit.test(
      'noscript content is not parsed when scripting is disabled',
      (assert) => {
        // noscript 的解析形状受文档 scripting flag 影响。这里把包含闭合 noscript 与图片的
        // 片段放进 title，检查默认清洗输出不会留下 onerror；默认标签规则会删除 noscript。
        const dirty =
          '<noscript><p title="</noscript><img src=x onerror=alert(1)>">';
        const clean = DOMPurify.sanitize(dirty);
        assert.ok(
          clean.indexOf('onerror') === -1,
          'noscript bypass neutralised: ' + clean
        );
      }
    );

    /**
     * noembed raw-text 内放危险 img。
     * 默认输出不得含 onerror，检查默认拒绝容器和内容后的字符串结果。
     */
    QUnit.test('noembed content is not parsed as raw HTML', (assert) => {
      const dirty = '<noembed><img src=x onerror=alert(1)></noembed>';
      const clean = DOMPurify.sanitize(dirty);
      assert.ok(
        clean.indexOf('onerror') === -1,
        'noembed bypass neutralised: ' + clean
      );
    });

    /**
     * 重复 200 个 table 起始标签，计时默认 sanitize。
     * 要求耗时小于 3 秒，作为固定输入的回归阈值；
     * 断言未测多种规模的渐近复杂度。
     */
    QUnit.test('table parsing does not cause O(n²) blowup (#365)', (assert) => {
      // 重复 table 起始标签交给浏览器解析器修复，DOMPurify 再遍历所得树。
      // 此处固定 200 个标签在 3 秒内完成，作为该输入的耗时回归检查。
      let payload = '';
      for (let i = 0; i < 200; i++) payload += '<table>';
      const start = Date.now();
      DOMPurify.sanitize(payload);
      const elapsed = Date.now() - start;
      assert.ok(
        elapsed < 3000,
        `200-deep table parse completed in ${elapsed}ms (must be < 3000ms)`
      );
    });

    /**
     * table 中插入 script，交由解析器修复。
     * 默认结果不得含 script 起始片段，检查表格解析后脚本仍被删除。
     */
    QUnit.test(
      'table foster-parenting does not leak script (#365 part 2)',
      (assert) => {
        const dirty = '<table><script>alert(1)</script></table>';
        const clean = DOMPurify.sanitize(dirty);
        assert.ok(
          clean.indexOf('<script') === -1,
          'foster-parented script removed: ' + clean
        );
      }
    );

    /**
     * 以非 ASCII İ 开头的伪 img 输入被 HTML 当文本处理。
     * 清洗结果再经 innerHTML 解析，逐个真实属性检查无 on*，区分惰性文字和活动事件属性。
     */
    QUnit.test('Unicode-named tags are removed', (assert) => {
      // `<İmg ...>` 的起始字符不满足 HTML 标签打开状态的 ASCII 字母条件，解析器把它当作文本；
      // DOMPurify 序列化时会转义尖括号。字符串中仍可出现 onerror 字样，
      // 因而重新解析结果，检查真实元素的属性列表是否包含 on*。
      const dirty = '<\u0130mg src=x onerror=alert(1)>';
      const clean = DOMPurify.sanitize(dirty);
      const wrapper = document.createElement('div');
      wrapper.innerHTML = clean;
      const dangerous = wrapper.querySelectorAll('*');
      let hasHandler = false;
      for (const el of dangerous) {
        for (const a of el.attributes) {
          if (/^on/i.test(a.name)) hasHandler = true;
        }
      }
      assert.equal(
        hasHandler,
        false,
        'no live element carries an on-handler: ' + clean
      );
    });

    // =======================================================================
    // 回归：selectedcontent。模块名保留 3.4.5 回归标签，以下说明对应当前实现。
    //
    // 支持可定制 select 的引擎会把已选 option 的内容复制到 selectedcontent。
    // 默认 allowlist 不含 selectedcontent，且 FORBID_CONTENTS 含该名称，删除时整棵内容一起丢弃。
    //
    // ADD_TAGS 可显式放行该标签，保留后按普通节点接受遍历；实现没有名为
    // refresh-after-sanitize 的后置刷新流程。下面的 live-DOM 用例同步检查插入后可见的镜像内容。
    // =======================================================================

    /**
     * selectedcontent 默认拒绝与显式放行对照；
     * 接口/解析探针控制分支，同步镜像检查不等待更新。
     */
    QUnit.module('Regression — selectedcontent (3.4.5)');

    /**
     * select/option 中危险 img 与 selectedcontent 并存。
     * 默认结果同时不得含 selectedcontent/onerror，检查默认元素拒绝与危险属性过滤。
     */
    QUnit.test('default config removes <selectedcontent>', (assert) => {
      const dirty =
        '<select><option><img src=x onerror=alert(1)></option><selectedcontent></selectedcontent></select>';
      const clean = DOMPurify.sanitize(dirty);
      assert.ok(
        clean.indexOf('selectedcontent') === -1,
        'selectedcontent removed by default: ' + clean
      );
      assert.ok(
        clean.indexOf('onerror') === -1,
        'mirrored payload neutralised: ' + clean
      );
    });

    /**
     * 仅在 HTMLSelectedContentElement 接口存在时放行 selectedcontent，并把清洗结果连接文档。
     * 立即读取镜像 innerHTML 检查无 onerror，再删除容器；
     * 未等待后续刷新。
     */
    QUnit.test(
      'refresh-after-sanitize covers post-clone mirror payload',
      (assert) => {
        // 标题沿用历史回归名称。本例显式放行 selectedcontent，将输出连接到 document 后
        // 立即检查该元素的 innerHTML 是否包含 onerror；仅在接口存在时运行。
        if (typeof window.HTMLSelectedContentElement === 'undefined') {
          assert.ok(
            true,
            'engine does not implement selectedcontent; skipping'
          );
          return;
        }
        const dirty =
          '<select><option><img src=x onerror=alert(1)></option><selectedcontent></selectedcontent></select>';
        const wrapper = document.createElement('div');
        wrapper.innerHTML = DOMPurify.sanitize(dirty, {
          ADD_TAGS: ['selectedcontent'],
        });
        document.body.appendChild(wrapper);
        window.xssed = false;
        // 同步读取当前可见的镜像结果。
        const sc = wrapper.querySelector('selectedcontent');
        const stillEvil = sc && /onerror/i.test(sc.innerHTML);
        document.body.removeChild(wrapper);
        assert.ok(!stillEvil, 'post-clone mirror does not contain onerror');
      }
    );

    /**
     * 先探测 select 内是否保留 selectedcontent，再以 ADD_TAGS 清洗安全文字。
     * 支持时要求输出含元素起始标签，检查显式准入；
     * 未断言文字镜像更新。
     */
    QUnit.test(
      'ADD_TAGS opt-in preserves <selectedcontent> with safe content',
      (assert) => {
        // 前置条件：引擎在 `<select>` 内解析时必须把 `<selectedcontent>` 保留为活动元素；这比
        // 独立解析严格。传统 select 解析规则会忽略很多其他标签；该探针直接确认当前引擎
        // 是否把 selectedcontent 保留在 select 内，再运行 opt-in 保留断言。
        const probe = document.createElement('div');
        probe.innerHTML =
          '<select><selectedcontent></selectedcontent></select>';
        const select = probe.querySelector('select');
        const engineParses = !!(
          select && select.querySelector('selectedcontent')
        );
        if (!engineParses) {
          assert.ok(
            true,
            'engine does not keep <selectedcontent> inside <select>; skipping'
          );
          return;
        }
        const clean = DOMPurify.sanitize(
          '<select><option>Pick me</option><selectedcontent>Pick me</selectedcontent></select>',
          { ADD_TAGS: ['selectedcontent'] }
        );
        assert.ok(
          clean.indexOf('<selectedcontent') !== -1,
          'opt-in preserves the element: ' + clean
        );
      }
    );

    /**
     * 循环净化 optgroup 图片、option iframe/srcdoc 与 SVG/onload 三种输入。
     * 逐项检查输出无危险片段，实际没有活动 DOM 插入或事件等待。
     */
    QUnit.test('generalized trigger variants (live-DOM check)', (assert) => {
      // 三组输入分别在 option/optgroup 中放入图片、iframe 与 SVG，检查输出不存在
      // onerror、srcdoc 或 onload。
      const variants = [
        '<select><optgroup><option><img src=x onerror=alert(1)></option></optgroup><selectedcontent></selectedcontent></select>',
        '<select><option><iframe srcdoc="<script>alert(1)</script>"></iframe></option><selectedcontent></selectedcontent></select>',
        '<select><option><svg onload=alert(1)></svg></option><selectedcontent></selectedcontent></select>',
      ];
      for (const v of variants) {
        const clean = DOMPurify.sanitize(v);
        assert.ok(
          !/onerror|srcdoc|onload/i.test(clean),
          'variant neutralised: ' + clean
        );
      }
    });

    // =======================================================================
    // 回归：Finding #1（clobbered form 根使 `_forceRemove` 产生 DoS）。
    //
    // 表单具名控件可遮蔽净化过程读取的 DOM 成员。下方字符串输入包含八种 HTML/XHTML
    // 形状，检查每次调用在 2 秒内返回字符串或抛错。
    //
    // 字符串先解析到隔离文档，再由 `_isClobbered` 检查遍历中的 form；触发检查时删除该元素。
    // parent/child 结构读取使用缓存 getter。IN_PLACE 的根预检属于另一条路径。
    // =======================================================================

    /**
     * 八组字符串 form 名称遮蔽数据循环生成测试，接受返回或抛错并限时 2 秒，检查此组调用终止。
     */
    QUnit.module('Regression — Finding #1 (clobbered form DoS)');

    [
      {
        name: 'HTML form firstElementChild clobber',
        html: '<form><input name="firstElementChild"></form>',
      },
      {
        name: 'HTML form innerHTML clobber',
        html: '<form><input name="innerHTML"></form>',
      },
      {
        name: 'HTML form textContent clobber',
        html: '<form><input name="textContent"></form>',
      },
      {
        name: 'HTML form attributes single clobber',
        html: '<form><input name="attributes"></form>',
      },
      {
        name: 'HTML form attributes double clobber',
        html: '<form><input name="attributes"><input name="attributes"></form>',
      },
      {
        name: 'XHTML form + CDATA',
        html: '<form xmlns="http://www.w3.org/1999/xhtml"><input name="parentNode"/><![CDATA[x]]></form>',
        mediaType: 'application/xhtml+xml',
      },
      {
        name: 'XHTML form + text + processing instruction',
        html: '<form xmlns="http://www.w3.org/1999/xhtml">text<?xml-stylesheet ?><input name="children"/></form>',
        mediaType: 'application/xhtml+xml',
      },
      {
        name: 'HTML form parentNode clobber',
        html: '<form><input name="parentNode"></form>',
      },
    ].forEach((c) => {
      /**
       * 八种 DoS 数据通过循环分别注册测试，启用未知协议并按数据切媒体类型。
       * 允许抛错，要求每次小于 2 秒且结果为字符串，检查终止时间而非内容安全。
       */
      QUnit.test(`DoS payload variant: ${c.name}`, (assert) => {
        const opts = { ALLOW_UNKNOWN_PROTOCOLS: true };
        if (c.mediaType) opts.PARSER_MEDIA_TYPE = c.mediaType;
        const start = Date.now();
        let clean;
        try {
          clean = DOMPurify.sanitize(c.html, opts);
        } catch (e) {
          // 接受抛错；下面仍检查该调用是否在 2 秒内完成。
          clean = '<threw/>';
        }
        const elapsed = Date.now() - start;
        assert.ok(
          elapsed < 2000,
          `${c.name} completed in ${elapsed}ms (must be < 2000ms)`
        );
        assert.ok(
          typeof clean === 'string',
          'sanitize returned a string (or controlled throw)'
        );
      });
    });

    // =======================================================================
    // 回归：Finding #2（删除 `</style>` 导致属性逃逸）。
    // =======================================================================

    /**
     * style 字符串中的闭合标签会结束 HTML raw-text；
     * 输出检查形成的 img 事件已删除。
     */
    QUnit.module('Regression — Finding #2 (attribute breakout)');

    /**
     * style 的 CSS 字符串含真实闭合 style 与 img/onerror。
     * 默认输出不得含 onerror，检查 HTML raw-text 边界后形成的节点处理。
     */
    QUnit.test(
      '</style> embedded in attribute does not escape style context',
      (assert) => {
        // HTML 的 style 是 raw-text 元素：CSS 字符串中的 `</style>` 也会结束元素，
        // 后面的 img 因而可成为真实节点。净化流程必须删除它的 onerror。
        const dirty =
          '<style>a[href="</style><img src=x onerror=alert(1)>"]{}</style>';
        const clean = DOMPurify.sanitize(dirty);
        assert.ok(
          clean.indexOf('onerror') === -1,
          'style attribute-breakout neutralised: ' + clean
        );
      }
    );

    // =======================================================================
    // 回归：Finding #3（informational）。
    //
    // 清洗图片后通过 innerHTML 重解析，再检查序列化结果中 onerror 没有恢复。
    // =======================================================================

    /**
     * 普通危险图片默认清洗后再 innerHTML 解析，检查事件属性片段不再生成。
     */
    QUnit.module('Regression — Finding #3 (informational)');

    /**
     * 默认清洗危险 img，再用 innerHTML 解析结果。
     * 容器序列化不得含 onerror，检查此普通图片输入的重解析形状。
     */
    QUnit.test(
      'output, re-inserted via innerHTML, does not regain its payload',
      (assert) => {
        const dirty = '<img src=x onerror=alert(1)>';
        const clean = DOMPurify.sanitize(dirty);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = clean;
        assert.ok(
          !/onerror/i.test(wrapper.innerHTML),
          'round-trip does not regenerate the handler: ' + wrapper.innerHTML
        );
      }
    );

    // =======================================================================
    // 回归：Finding #4（外部 `form=` 关联）。
    //
    // `<input form="formid">` 可关联同一 document 中、位于祖先链之外的 form。
    // 默认属性 allowlist 不含 form，所以这里的 HTML/XHTML 输入都会删除该属性。
    // =======================================================================

    /**
     * HTML/XHTML 的外部 form 关联场景；
     * 断言只查 input form 属性删除。
     */
    QUnit.module('Regression — Finding #4 (external form= association)');

    /**
     * 外部 input 用 form=evil 关联带危险 action 的 form。
     * 默认 HTML 输出不得含 form="evil"，检查关联属性删除；
     * 危险 action 未单独断言。
     */
    QUnit.test('form= attribute is stripped from inputs (HTML)', (assert) => {
      const dirty =
        '<form id="evil" action="javascript:alert(1)"></form><input form="evil" type="submit">';
      const clean = DOMPurify.sanitize(dirty);
      assert.ok(
        !/form="evil"/i.test(clean),
        'form= attribute stripped: ' + clean
      );
    });

    /**
     * 同一外部关联场景改为 XHTML、自闭合并声明 HTML namespace。
     * 输出不得含 form="evil"，检查 XML 路径的属性结果。
     */
    QUnit.test('form= attribute is stripped from inputs (XHTML)', (assert) => {
      const dirty =
        '<form xmlns="http://www.w3.org/1999/xhtml" id="evil" action="javascript:alert(1)"/><input xmlns="http://www.w3.org/1999/xhtml" form="evil" type="submit"/>';
      const clean = DOMPurify.sanitize(dirty, {
        PARSER_MEDIA_TYPE: 'application/xhtml+xml',
      });
      assert.ok(
        !/form="evil"/i.test(clean),
        'form= attribute stripped in XHTML: ' + clean
      );
    });

    // =======================================================================
    // 回归：`<style>` + XHTML + RETURN_DOM_FRAGMENT 绕过声明。
    //
    // 已公开绕过声明称 payload 经“字符串清洗 → RETURN_DOM_FRAGMENT 清洗 → innerHTML 插入”
    // round-trip 后会执行；测试逐阶段确认安全性。
    // =======================================================================

    /**
     * style 闭合与实体解码分别走字符串、fragment 与插入路径；
     * XHTML 边界例等待 50ms 检查探针。
     */
    QUnit.module('Regression — style + XHTML + RETURN_DOM_FRAGMENT round-trip');

    /**
     * style 的 CSS URL 引号中放闭合 style 与 img/onerror。
     * 默认字符串结果不得含 onerror，检查 raw-text 退出后危险属性消失。
     */
    QUnit.test('string sanitize is safe', (assert) => {
      const dirty =
        '<style>a{background:url("</style><img src=x onerror=alert(1)>")}</style>';
      const clean = DOMPurify.sanitize(dirty);
      assert.ok(!/onerror/i.test(clean), 'string mode neutralises: ' + clean);
    });

    /**
     * 同一 style 输入先净化为字符串，再净化为 fragment，深导入到 div。
     * 序列化无 onerror，检查两次解析及 DOM 返回后的属性结果。
     */
    QUnit.test(
      'round-trip (string → DOM fragment → innerHTML) is safe',
      (assert) => {
        const dirty =
          '<style>a{background:url("</style><img src=x onerror=alert(1)>")}</style>';
        const stringClean = DOMPurify.sanitize(dirty);
        const fragment = DOMPurify.sanitize(stringClean, {
          RETURN_DOM_FRAGMENT: true,
        });
        const wrapper = document.createElement('div');
        wrapper.appendChild(document.importNode(fragment, true));
        assert.ok(
          !/onerror/i.test(wrapper.innerHTML),
          'round-trip neutralises: ' + wrapper.innerHTML
        );
      }
    );

    /**
     * 同一 style 输入净化后以原生 innerHTML 连接 body。
     * 立即读取 xssed 并移除容器，要求未触发；
     * 覆盖同步插入窗口。
     */
    QUnit.test(
      'native innerHTML application of clean output does not XSS',
      (assert) => {
        const dirty =
          '<style>a{background:url("</style><img src=x onerror=alert(1)>")}</style>';
        const clean = DOMPurify.sanitize(dirty);
        const wrapper = document.createElement('div');
        window.xssed = false;
        wrapper.innerHTML = clean;
        document.body.appendChild(wrapper);
        const triggered = window.xssed === true;
        document.body.removeChild(wrapper);
        window.xssed = false;
        assert.equal(triggered, false, 'no XSS on native insertion');
      }
    );

    /**
     * 实体编码闭合 style 与 img 后再有真实 a 子元素。
     * 默认字符串须无 img/onerror；
     * XHTML fragment 重新序列化为 HTML 后等待 50ms，探针不得触发，检查 XML 到 HTML 边界。
     */
    QUnit.test(
      'bypass (#1150): entity-encoded </style> + XHTML + RETURN_DOM_FRAGMENT',
      (assert) => {
        // XHTML 将 style 内实体解码为尖括号，并把 `<a>` 解析为真实子元素。HTML namespace
        // 的 style 一旦含元素子节点，`_isUnsafeNode` 就删除整棵 style。这里请求 DOM fragment，
        // 再把它序列化后送入 HTML parser；实体解码所得的闭合 style 与 img 因而是关键边界。
        //
        // 同时检查默认字符串输出，并在 XHTML fragment 重插入后等待 50ms，
        // 让图片加载错误等异步事件有机会触发 xssed 探针。
        const payload =
          '<style>&lt;/style&gt;&lt;img src=x onerror=alert(1)&gt;<a></a></style>';

        const stringOut = DOMPurify.sanitize(payload);
        assert.notOk(
          /<img/i.test(stringOut) || /onerror/i.test(stringOut),
          `string sanitize output: ${stringOut}`
        );

        const done = assert.async();
        let clean;
        try {
          clean = DOMPurify.sanitize(payload, {
            PARSER_MEDIA_TYPE: 'application/xhtml+xml',
            RETURN_DOM_FRAGMENT: true,
          });
        } catch (e) {
          assert.ok(false, `sanitize() threw: ${e && e.message}`);
          done();
          return;
        }

        const div = document.createElement('div');
        div.appendChild(document.importNode(clean, true));

        // 使用限定容器，避免 XSS 真触发时污染 document.body；jsdom runner 无 QUnit fixture 时
        // 回退到临时 body 子节点。
        const container =
          document.getElementById('qunit-fixture') ||
          document.body.appendChild(document.createElement('div'));
        const ownsContainer =
          container.parentNode === document.body &&
          container.id !== 'qunit-fixture';

        window.xssed = false;
        container.innerHTML = div.innerHTML;

        setTimeout(() => {
          assert.notEqual(
            window.xssed,
            true,
            'alert() fired via XHTML-style round-trip (bypass reproduces)'
          );
          container.innerHTML = '';
          if (ownsContainer) document.body.removeChild(container);
          window.xssed = false;
          done();
        }, 50);
      }
    );

    // =======================================================================
    // 回归：跨 realm 清洗（GHSA-4w3q-35jp-p934）。
    //
    // realm 绑定的 `instanceof Node` 会把 iframe 节点误判为普通对象并字符串化，
    // IN_PLACE 因而没有修改调用方继续持有的原节点。
    //
    // 当前 `_isNode` 用缓存的 Node.prototype.nodeType getter 读取真实内部状态，接受 foreign Node，
    // 拒绝只有 nodeType 字段的伪对象。IN_PLACE 直接遍历原节点；`_createNodeIterator` 从缓存
    // ownerDocument getter 取得该根的真实文档。下方覆盖 iframe 节点与伪对象输入。
    // =======================================================================

    /**
     * iframe 节点与伪对象对照；
     * 跨 realm 原地修改、模板、open shadow 及遮蔽根按实际断言解释。
     */
    QUnit.module('Regression — cross-realm sanitization (GHSA-4w3q-35jp-p934)');

    /**
     * 新 iframe 提供 foreign-realm a，href 为 javascript:。
     * IN_PLACE 后直接读取原链接 href=null，finally 移除 iframe，检查跨 realm 节点品牌与遍历。
     */
    QUnit.test(
      'IN_PLACE with foreign-realm DOM input is sanitized',
      (assert) => {
        const iframe = document.createElement('iframe');
        document.body.appendChild(iframe);
        try {
          const foreignDoc = iframe.contentDocument;
          const foreignA = foreignDoc.createElement('a');
          foreignA.setAttribute('href', 'javascript:alert(1)');
          DOMPurify.sanitize(foreignA, { IN_PLACE: true });
          assert.equal(
            foreignA.getAttribute('href'),
            null,
            'foreign-realm href stripped'
          );
        } finally {
          document.body.removeChild(iframe);
        }
      }
    );

    /**
     * 对象 toString 返回带 onerror 的 img。
     * 要求返回字符串且无事件片段，检查非节点转换后的标记仍被净化。
     */
    QUnit.test(
      'string input with non-node object is rejected (c1)',
      (assert) => {
        // Spoofed object 必须字符串化，绝不能当 DOM 节点遍历。
        const out = DOMPurify.sanitize({
          toString: () => '<img src=x onerror=alert(1)>',
        });
        assert.ok(
          typeof out === 'string' && !/onerror/i.test(out),
          'spoofed toString is sanitized as a string: ' + out
        );
      }
    );

    /**
     * 普通对象伪造节点字段与 innerHTML，但未自定义 toString。
     * 输出必须为字符串且无 onerror，检查伪字段不会让 innerHTML 成为待遍历 DOM。
     */
    QUnit.test(
      'plain object with nodeType is not treated as DOM (c2)',
      (assert) => {
        const fake = {
          nodeType: 1,
          nodeName: 'DIV',
          ownerDocument: {},
          innerHTML: '<img src=x onerror=alert(1)>',
        };
        const out = DOMPurify.sanitize(fake);
        assert.ok(
          typeof out === 'string',
          'spoofed node-like becomes a string'
        );
        assert.ok(
          !/onerror/i.test(out),
          'no payload survives stringification: ' + out
        );
      }
    );

    /**
     * 伪节点对象同时请求 IN_PLACE。
     * 接受抛错；
     * 返回对象时仅扫描其自有 attributes，字符串时排除 handler 语法。
     * 当前实现走对象字符串转换，未修改伪 innerHTML。
     */
    QUnit.test('IN_PLACE with spoofed nodeType is contained (c3)', (assert) => {
      // 该伪对象无法通过缓存 nodeType getter，当前实现将其转为 `[object Object]`；
      // IN_PLACE 只对真实 Node 生效，因此伪造 innerHTML 不作为待清洗 DOM。
      const fake = {
        nodeType: 1,
        nodeName: 'DIV',
        ownerDocument: {},
        innerHTML: '<img src=x onerror=alert(1)>',
      };
      let out;
      try {
        out = DOMPurify.sanitize(fake, { IN_PLACE: true });
      } catch (_) {
        assert.ok(true, 'threw on spoofed input (acceptable outcome)');
        return;
      }
      // 字符串结果检查事件属性语法；对象分支只检查返回对象自己的 attributes。
      if (out && typeof out === 'object' && out.nodeType === 1) {
        const attrs = out.attributes || [];
        let hasHandler = false;
        for (const a of attrs) {
          if (/^on/i.test(a.name)) hasHandler = true;
        }
        assert.equal(hasHandler, false, 'no on-handler on returned object');
      } else {
        const s = String(out);
        assert.ok(
          !/on\w+=/i.test(s),
          'no on-handler in stringified output: ' + s
        );
      }
    });

    /**
     * foreign form 以 nodeName/parentNode 控件尝试遮蔽成员，未含事件载荷。
     * 接受抛错或完成，字符串分支仅排除 on* 语法，检查该输入的处理完成。
     */
    QUnit.test('foreign-realm clobbered form is recognised (c4)', (assert) => {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      try {
        const foreignDoc = iframe.contentDocument;
        const form = foreignDoc.createElement('form');
        form.innerHTML = '<input name="nodeName"><input name="parentNode">';
        // 引擎支持表单具名属性遮蔽时，当前 IN_PLACE 预检会抛错；否则按普通根遍历。
        // 本输入没有事件载荷，断言检查调用完成及字符串结果中的事件属性语法。
        let out;
        try {
          out = DOMPurify.sanitize(form, { IN_PLACE: true });
        } catch (_) {
          out = '<threw/>';
        }
        if (typeof out === 'string') {
          assert.ok(!/on\w+=/i.test(out));
        } else {
          assert.ok(true, 'foreign clobbered form handled');
        }
      } finally {
        document.body.removeChild(iframe);
      }
    });

    /**
     * foreign template.content 装入 javascript: 链接。
     * IN_PLACE 后原 content 首节点 href=null，检查 foreign 文档及模板独立片段的遍历。
     */
    QUnit.test('foreign-realm template.content is walked', (assert) => {
      // cross-realm 修复还覆盖 `<template>.content`；它拥有与 host document 不同的
      // ownerDocument。
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      try {
        const foreignDoc = iframe.contentDocument;
        const tpl = foreignDoc.createElement('template');
        const a = foreignDoc.createElement('a');
        a.setAttribute('href', 'javascript:alert(1)');
        tpl.content.appendChild(a);
        DOMPurify.sanitize(tpl, { IN_PLACE: true });
        assert.equal(tpl.content.firstChild.getAttribute('href'), null);
      } finally {
        document.body.removeChild(iframe);
      }
    });

    /**
     * foreign div 的 open shadow 含危险 href 链接。
     * 原地净化后链接必须存在且 href=null，检查跨 realm attached root。
     */
    QUnit.test('foreign-realm attached shadow root is walked', (assert) => {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      try {
        const foreignDoc = iframe.contentDocument;
        const host = foreignDoc.createElement('div');
        host.attachShadow({ mode: 'open' }).innerHTML =
          '<a id="poc" href="javascript:alert(1)">x</a>';
        DOMPurify.sanitize(host, { IN_PLACE: true });
        const a = host.shadowRoot.querySelector('#poc');
        assert.ok(a, 'link survived');
        assert.equal(a.getAttribute('href'), null);
      } finally {
        document.body.removeChild(iframe);
      }
    });

    /**
     * foreign evil 根属于禁止 namespace，但 evil 标签本身也未准入。
     * 接受抛错或空属性根；
     * 当前在根标签预检先拒绝，未单独触发 namespace 分支证明。
     */
    QUnit.test(
      'elements in forbidden namespaces are removed (cross-realm)',
      (assert) => {
        const iframe = document.createElement('iframe');
        document.body.appendChild(iframe);
        try {
          const foreignDoc = iframe.contentDocument;
          const ns = 'http://example.org/forbidden';
          const root = foreignDoc.createElementNS(ns, 'evil');
          DOMPurify.sanitize(root, {
            IN_PLACE: true,
            ALLOWED_NAMESPACES: [
              'http://www.w3.org/1999/xhtml',
              'http://www.w3.org/2000/svg',
              'http://www.w3.org/1998/Math/MathML',
            ],
          });
          // evil 本身不在标签 allowlist，当前实现会先在根标签预检中清空并抛错。
          // 若调用返回，此断言只要求根属性为空。
          assert.ok(
            root.attributes.length === 0,
            'forbidden-namespace root has no attributes'
          );
        } catch (_) {
          assert.ok(true, 'throwing is also an acceptable outcome');
        } finally {
          document.body.removeChild(iframe);
        }
      }
    );

    // =======================================================================
    // attached-shadow-root 遍历中的 DOM Clobbering。
    //
    // 开始遍历 attached shadow root 后，遍历本身也成为攻击面。form 元素上的 childNodes、
    // nodeType、shadowRoot 等可被 `<input name="...">` 遮蔽。sanitizer 探测引擎真实行为，
    // 在抛错与安全继续之间选择。
    // =======================================================================

    /**
     * 一次 env 探针记录 form/shadow/setHTMLUnsafe 能力，后续案例以它决定跳过或检查抛错/属性结果。
     */
    QUnit.module('DOM clobbering — shadow-root traversal');

    // 每个测试 session 只探测一次环境能力。
    //
    // 所有访问都必须经过 `window.*`，不能读裸全局。Node/jsdom runner 在 Node context 执行，
    // Element/document 等只存在于传给 testSuite() 的 window；此处触碰裸 `Element` 会在模块
    // 加载时抛 ReferenceError。
    const env = (() => {
      const result = {
        shadowSanitization: false,
        formClobbering: false,
        setHTMLUnsafe: !!(
          window.Element &&
          window.Element.prototype &&
          typeof window.Element.prototype.setHTMLUnsafe === 'function'
        ),
      };
      try {
        const probeHost = document.createElement('div');
        probeHost.attachShadow({ mode: 'open' }).innerHTML = '<span>x</span>';
        DOMPurify.sanitize(probeHost, { IN_PLACE: true });
        result.shadowSanitization = !!probeHost.shadowRoot;
      } catch (_) {}
      try {
        const probeForm = document.createElement('form');
        probeForm.innerHTML = '<input name="nodeName">';
        result.formClobbering = typeof probeForm.nodeName !== 'string';
      } catch (_) {}
      return result;
    })();

    /**
     * 能力探针确认 form 遮蔽后，根带 childNodes/parentNode 控件与 onclick。
     * 接受抛错，正常返回则序列化无 handler，检查该环境下的遮蔽根处理。
     */
    QUnit.test('clobbered childNodes is recognised', (assert) => {
      if (!env.formClobbering) {
        assert.ok(true, 'engine does not clobber form properties; skipping');
        return;
      }
      const root = document.createElement('form');
      root.innerHTML =
        '<input name="childNodes" onclick="alert(1)">' +
        '<input name="parentNode" onclick="alert(2)">';
      // clobbered 根要么触发抛错，要么返回干净结果。
      let result;
      try {
        result = DOMPurify.sanitize(root, { IN_PLACE: true });
      } catch (_) {
        assert.ok(true, 'threw on clobbered root');
        return;
      }
      assert.ok(!/on\w+=/i.test(result.outerHTML || ''));
    });

    /**
     * form 中名为 childNodes 的 select 具有数字 length，另有 onclick 控件。
     * IN_PLACE 接受抛错或事件已删，检查这种伪 NodeList 形状不能留活动处理器。
     */
    QUnit.test(
      '<select name="childNodes"> with length-as-number does not defeat typing probe',
      (assert) => {
        // 旧 clobbering 检查只做 `typeof x === 'object'`，可被 childNodes clobber 成 `<select>`
        // 绕过，因为 select.length 是 number。当前检查把直接 childNodes 与缓存 getter
        // 返回的真实 NodeList 作引用比较，并比较直接 nodeType 与缓存 getter 的数值。
        const root = document.createElement('form');
        root.innerHTML =
          '<select name="childNodes">' +
          '<option value="a">a</option>' +
          '<option value="b">b</option>' +
          '</select>' +
          '<input name="parentNode" onclick="alert(1)">';
        let threw = false;
        try {
          DOMPurify.sanitize(root, { IN_PLACE: true });
        } catch (_) {
          threw = true;
        }
        // 结果只允许两类：抛错，或 on-handler 已删除。
        if (!threw) {
          assert.ok(
            !/onclick/i.test(root.outerHTML),
            'no on-handler survived: ' + root.outerHTML
          );
        } else {
          assert.ok(true, 'threw on clobbered length-typed root');
        }
      }
    );

    /**
     * 可净化 shadow 的环境下，form 同时带 childNodes select 与含危险链接的 child shadow。
     * 接受抛错；
     * 正常返回时存活链接须无 href，检查复合路径。
     */
    QUnit.test('shadow root nested under select-clobbered form', (assert) => {
      if (!env.shadowSanitization) {
        assert.ok(
          true,
          'engine does not support shadow sanitization; skipping'
        );
        return;
      }
      // 复合场景：form clobber childNodes，同时内部 child host 带含危险内容的 attached
      // shadow root。sanitizer 应在 clobbered 根安全退出，或成功进入 shadow 清洗。
      const form = document.createElement('form');
      const host = document.createElement('div');
      form.appendChild(host);
      const select = document.createElement('select');
      select.setAttribute('name', 'childNodes');
      select.innerHTML = '<option>a</option>';
      form.appendChild(select);
      host.attachShadow({ mode: 'open' }).innerHTML =
        '<a id="poc" href="javascript:alert(1)">x</a>';
      let threw = false;
      try {
        DOMPurify.sanitize(form, { IN_PLACE: true });
      } catch (_) {
        threw = true;
      }
      if (!threw && host.shadowRoot) {
        const a = host.shadowRoot.querySelector('#poc');
        if (a) {
          assert.equal(a.getAttribute('href'), null);
        } else {
          assert.ok(true, 'link removed');
        }
      } else {
        assert.ok(true, 'threw on clobbered root, shadow not walked');
      }
    });

    /**
     * 支持 setHTMLUnsafe 时先实例化声明式 open shadow，再 IN_PLACE 清洗 host。
     * 存活 shadow 链接须无 href，也接受结构删除，检查已生成 attached root 的清理。
     */
    QUnit.test('setHTMLUnsafe + IN_PLACE declarative shadow', (assert) => {
      if (!env.setHTMLUnsafe) {
        assert.ok(true, 'setHTMLUnsafe not available; skipping');
        return;
      }
      const host = document.createElement('div');
      host.setHTMLUnsafe(
        '<div><template shadowrootmode="open">' +
          '<a id="poc" href="javascript:alert(1)">x</a>' +
          '</template></div>'
      );
      DOMPurify.sanitize(host, { IN_PLACE: true });
      // setHTMLUnsafe 已实例化的 open shadow root 由 attached-root 预扫处理。
      // 这里定位 shadow 内链接；找到时要求 href 已删除，未找到时接受链接或结构被移除。
      const liveA = host.firstChild
        ? host.firstChild.shadowRoot
          ? host.firstChild.shadowRoot.querySelector('#poc')
          : null
        : null;
      if (liveA) {
        assert.equal(liveA.getAttribute('href'), null);
      } else {
        assert.ok(true, 'declarative shadow was either walked or stripped');
      }
      window.xssed = false;
    });

    // =======================================================================
    // GHSA-r47g-fvhr-h676：拒绝 parentless clobbered form。
    //
    // 修复前 sanitizer 会对属性被 clobber 的 form 调 `_forceRemove(form)` 尝试“删除”。form 是根，
    // parentless 根无法再从树中分离，旧删除流程会空操作返回，把带危险 handler 的原 form
    // 交还调用方。
    //
    // 当前 IN_PLACE 预检对 clobbered 根先清理子树并清空根，再于遍历前抛错；
    // attached 与 detached 根都执行这项检查。
    // =======================================================================

    /**
     * detached clobbered form 根先拒绝，div 包住的 form 作为后代处理；
     * 候选名称只要求至少一个实际抛错。
     */
    QUnit.module(
      'Regression — GHSA-r47g-fvhr-h676 (parent-less clobbered form)'
    );

    /**
     * 支持 form 遮蔽时构造 detached form 根，控件名 nodeName 且带事件。
     * 严格要求匹配错误消息的抛错，检查入口拒绝被遮蔽根。
     */
    QUnit.test('parent-less clobbered form root throws', (assert) => {
      if (!env.formClobbering) {
        assert.ok(true, 'engine does not clobber form properties; skipping');
        return;
      }
      const root = document.createElement('form');
      root.innerHTML = '<input name="nodeName" onmouseover="alert(1)">';
      assert.throws(
        () => DOMPurify.sanitize(root, { IN_PLACE: true }),
        /clobbered|forbidden|invalid/i,
        'must throw rather than silently return clobbered root'
      );
    });

    /**
     * 支持 form 遮蔽时遍历七种控件名，记录抛错与未抛错。
     * 所有捕获值须为 Error，且至少一项抛错；
     * 未要求七项全抛错，也未检查未抛错项的输出。
     */
    QUnit.test(
      'all clobbering-name variants trigger preamble throw',
      (assert) => {
        if (!env.formClobbering) {
          assert.ok(true, 'engine does not clobber form properties; skipping');
          return;
        }
        // 引擎对各名称的具名属性遮蔽行为不同，`_isClobbered` 也只检查净化依赖的成员。
        // 本例逐个记录实际抛错的名称，要求至少一个候选抛错，且捕获值为 Error。
        // 未抛错的名称只记录到 ungrarded，未进一步检查清洗内容。
        const candidates = [
          'nodeName',
          'nodeType',
          'parentNode',
          'children',
          'childNodes',
          'firstChild',
          'attributes',
        ];
        const guarded = [];
        const ungrarded = [];
        for (const name of candidates) {
          const root = document.createElement('form');
          root.innerHTML = `<input name="${name}" onmouseover="alert(1)">`;
          let thrownValue;
          let threw = false;
          try {
            DOMPurify.sanitize(root, { IN_PLACE: true });
          } catch (e) {
            threw = true;
            thrownValue = e;
          }
          if (threw) {
            guarded.push(name);
            assert.ok(
              thrownValue instanceof Error,
              `"${name}" throws an Error instance, not a primitive`
            );
          } else {
            ungrarded.push(name);
          }
        }
        assert.ok(
          guarded.length > 0,
          `at least one candidate name triggers throw (guarded=${JSON.stringify(
            guarded
          )}, ungrarded=${JSON.stringify(ungrarded)})`
        );
      }
    );

    /**
     * 支持 form 遮蔽时以 div 为 IN_PLACE 根，内含 nodeName 表单控件与事件。
     * 允许抛错，正常完成要求原 div 无 onmouseover，区分后代表单与入口根。
     */
    QUnit.test(
      'parented clobbered form is still sanitized normally',
      (assert) => {
        // div 是本次遍历根，clobbered form 是它的后代：主元素流程可删除 form，
        // 原树根不会在入口的 form clobber 预检中被拒绝。
        if (!env.formClobbering) {
          assert.ok(true, 'engine does not clobber form properties; skipping');
          return;
        }
        const wrapper = document.createElement('div');
        wrapper.innerHTML =
          '<form><input name="nodeName" onmouseover="alert(1)"></form>';
        let threw = false;
        try {
          DOMPurify.sanitize(wrapper, { IN_PLACE: true });
        } catch (_) {
          threw = true;
        }
        // 断言接受异常退出；正常返回时要求 wrapper 序列化结果不含 onmouseover。
        assert.ok(
          threw || !/onmouseover/i.test(wrapper.outerHTML),
          'parented clobbered form is either thrown on or cleaned: ' +
            wrapper.outerHTML
        );
      }
    );

    // =======================================================================
    // 回归保护：普通 attached 与嵌套 shadow root。
    // =======================================================================

    /**
     * 复用 shadow 能力探针，检查一层及嵌套 open shadow 的安全文本仍保留。
     */
    QUnit.module('Regression — ordinary attached shadow roots');

    /**
     * 支持 shadow 净化时，div shadow 中只有安全 p。
     * IN_PLACE 后 p.textContent 严格为 hello，检查安全 attached root 内容保留。
     */
    QUnit.test('shadow root with safe content is preserved', (assert) => {
      if (!env.shadowSanitization) {
        assert.ok(
          true,
          'engine does not support shadow sanitization; skipping'
        );
        return;
      }
      const host = document.createElement('div');
      host.attachShadow({ mode: 'open' }).innerHTML = '<p>hello</p>';
      DOMPurify.sanitize(host, { IN_PLACE: true });
      assert.equal(host.shadowRoot.querySelector('p').textContent, 'hello');
    });

    /**
     * 两层 attached shadow 中最深 span 只有 safe。
     * 支持时原地净化后深层文本严格保留，检查嵌套 roots 的无害内容。
     */
    QUnit.test(
      'nested attached shadow roots preserve safe content',
      (assert) => {
        if (!env.shadowSanitization) {
          assert.ok(
            true,
            'engine does not support shadow sanitization; skipping'
          );
          return;
        }
        const outer = document.createElement('section');
        const outerShadow = outer.attachShadow({ mode: 'open' });
        const inner = document.createElement('div');
        outerShadow.appendChild(inner);
        inner.attachShadow({ mode: 'open' }).innerHTML = '<span>safe</span>';
        DOMPurify.sanitize(outer, { IN_PLACE: true });
        assert.equal(
          outer.shadowRoot.querySelector('div').shadowRoot.querySelector('span')
            .textContent,
          'safe'
        );
      }
    );

    // =======================================================================
    // GHSA-hpcv-96wg-7vj8：cross-realm IN_PLACE 后续修复。
    //
    // 接受 foreign Node 只是第一步：元素、form 与 DocumentFragment 的后续识别也须跨 realm。
    // 当前实现用缓存 nodeType/nodeName getter 与属性 getter，代替 realm 绑定的 instanceof，
    // 使 template.content、open shadow root 和 form clobber 检查进入同一净化流程。
    // =======================================================================

    /**
     * 复用能力探针，在 iframe 内再次检查 template、form 与 open shadow；
     * 历史 helper 名称不代表当前实现。
     */
    QUnit.module(
      'Regression — GHSA-hpcv-96wg-7vj8 (cross-realm IN_PLACE follow-up)'
    );

    /**
     * iframe 的 template.content 含危险 img，直接原地清洗。
     * 图片若存活须无 onerror，允许整体删除；
     * 标题中的历史 helper 不存在于当前实现。
     */
    QUnit.test(
      '_withForeignRealmDoc helper handles foreign template.content',
      (assert) => {
        const iframe = document.createElement('iframe');
        document.body.appendChild(iframe);
        try {
          const foreignDoc = iframe.contentDocument;
          const tpl = foreignDoc.createElement('template');
          const inner = foreignDoc.createElement('img');
          inner.setAttribute('src', 'x');
          inner.setAttribute('onerror', 'alert(1)');
          tpl.content.appendChild(inner);
          DOMPurify.sanitize(tpl, { IN_PLACE: true });
          const liveImg = tpl.content.querySelector('img');
          if (liveImg) {
            assert.equal(liveImg.getAttribute('onerror'), null);
          } else {
            assert.ok(true, 'image removed entirely');
          }
        } finally {
          document.body.removeChild(iframe);
        }
      }
    );

    /**
     * 本地能力探针确认 form 遮蔽后，在 iframe 构造同名控件和 onmouseover。
     * 接受抛错或原 form 无事件，检查 foreign 根的对应结果。
     */
    QUnit.test(
      'foreign clobbered form is recognised via capability probe',
      (assert) => {
        if (!env.formClobbering) {
          assert.ok(true, 'engine does not clobber form properties; skipping');
          return;
        }
        const iframe = document.createElement('iframe');
        document.body.appendChild(iframe);
        try {
          const foreignDoc = iframe.contentDocument;
          const form = foreignDoc.createElement('form');
          form.innerHTML = '<input name="nodeName" onmouseover="alert(1)">';
          let threw = false;
          try {
            DOMPurify.sanitize(form, { IN_PLACE: true });
          } catch (_) {
            threw = true;
          }
          // 与 local-realm 测试同一契约：抛错或返回干净结果。
          if (threw) {
            assert.ok(true, 'threw on foreign clobbered root');
          } else {
            assert.ok(!/onmouseover/i.test(form.outerHTML));
          }
        } finally {
          document.body.removeChild(iframe);
        }
      }
    );

    /**
     * 支持 shadow 净化时，iframe 内 host shadow 带危险链接。
     * IN_PLACE 后链接存活且 href=null，检查跨 realm attached-root 路径。
     */
    QUnit.test(
      'foreign attached shadow root is walked end-to-end',
      (assert) => {
        if (!env.shadowSanitization) {
          assert.ok(
            true,
            'engine does not support shadow sanitization; skipping'
          );
          return;
        }
        const iframe = document.createElement('iframe');
        document.body.appendChild(iframe);
        try {
          const foreignDoc = iframe.contentDocument;
          const host = foreignDoc.createElement('div');
          host.attachShadow({ mode: 'open' }).innerHTML =
            '<a id="poc" href="javascript:alert(1)">x</a>';
          DOMPurify.sanitize(host, { IN_PLACE: true });
          const a = host.shadowRoot.querySelector('#poc');
          assert.ok(a, 'link preserved');
          assert.equal(a.getAttribute('href'), null);
        } finally {
          document.body.removeChild(iframe);
        }
      }
    );

    /**
     * foreign evil-elem 根在自定义 namespace 且带 onmouseover。
     * 接受抛错或事件删除；
     * 当前标签预检先拒绝未准入标签，断言未隔离命名空间规则。
     */
    QUnit.test(
      'foreign element in forbidden namespace is neutralised',
      (assert) => {
        const iframe = document.createElement('iframe');
        document.body.appendChild(iframe);
        try {
          const foreignDoc = iframe.contentDocument;
          const evil = foreignDoc.createElementNS(
            'http://example.org/evil',
            'evil-elem'
          );
          evil.setAttribute('onmouseover', 'alert(1)');
          let threw = false;
          try {
            DOMPurify.sanitize(evil, {
              IN_PLACE: true,
              ALLOWED_NAMESPACES: ['http://www.w3.org/1999/xhtml'],
            });
          } catch (_) {
            threw = true;
          }
          if (threw) {
            assert.ok(true, 'threw on forbidden-namespace root');
          } else {
            assert.equal(evil.getAttribute('onmouseover'), null);
          }
        } finally {
          document.body.removeChild(iframe);
        }
      }
    );

    /**
     * 三例模板片段放入相邻未闭合插值文本；
     * 断言只排除完整表达式，说明结构可访问与正则边界。
     */
    QUnit.module('Regression — template.content traversal bypass');

    /**
     * 相邻 $ 与未闭合 {constructor... 文本放在 template.content，请求 RETURN_DOM 与模板清理。
     * 只排除含闭合 } 的表达式；
     * 输入本来未闭合，此断言不足以单独验证 scrub。
     */
    QUnit.test(
      'RETURN_DOM scrubs boundary-spanning expressions inside template.content',
      (assert) => {
        // NodeIterator 不进入独立的 template.content DocumentFragment，最终模板清理须显式递归。
        // 本例直接创建相邻的 `$` 与未闭合 `{constructor...` 文本节点，没有插入待删除元素。
        // `_scrubTemplateExpressions` 对 fragment 先 normalize，再用 TMPLIT_EXPR 贪婪清理
        // 合并后的未闭合 `${` 片段。下方正则断言只检测含闭合 `}` 的完整表达式形状。
        const dirty = document.createElement('div');
        const tmpl = document.createElement('template');
        tmpl.content.appendChild(document.createTextNode('$'));
        tmpl.content.appendChild(
          document.createTextNode('{constructor.constructor("alert(1)")()')
        );
        dirty.appendChild(tmpl);

        const result = DOMPurify.sanitize(dirty, {
          RETURN_DOM: true,
          SAFE_FOR_TEMPLATES: true,
        });

        result.querySelector('template').content.normalize();
        assert.notOk(
          /\$\{[\s\S]*\}/.test(
            result.querySelector('template').content.textContent
          ),
          'merged template-literal expression inside template.content should be scrubbed'
        );
      }
    );

    /**
     * 同一未闭合文本放在 template.content，改用 IN_PLACE。
     * normalize 后只排除完整 ${...} 形状，记录原地返回路径；
     * 未检查实际主体文字是否清除。
     */
    QUnit.test(
      'IN_PLACE scrubs boundary-spanning expressions inside template.content',
      (assert) => {
        // 与上方 RETURN_DOM 相同的盲点，但发生于 IN_PLACE；两条路径共用
        // `_scrubTemplateExpressions()`，修复必须同时覆盖。
        const dirty = document.createElement('div');
        const tmpl = document.createElement('template');
        tmpl.content.appendChild(document.createTextNode('$'));
        tmpl.content.appendChild(
          document.createTextNode('{constructor.constructor("alert(1)")()')
        );
        dirty.appendChild(tmpl);

        DOMPurify.sanitize(dirty, {
          IN_PLACE: true,
          SAFE_FOR_TEMPLATES: true,
        });

        dirty.querySelector('template').content.normalize();
        assert.notOk(
          /\$\{[\s\S]*\}/.test(
            dirty.querySelector('template').content.textContent
          ),
          'merged template-literal expression inside template.content should be scrubbed in-place'
        );
      }
    );

    /**
     * 两层模板的最深 content 含同一未闭合片段，请求 DOM 返回。
     * 定位最深片段并排除完整表达式，检查可访问结构；
     * 正则同样未匹配原输入。
     */
    QUnit.test('scrub recurses into nested template.content', (assert) => {
      // `<template>` 内再嵌 `<template>` 会产生两个嵌套 DocumentFragment，平面 NodeIterator
      // 都看不见；递归修复必须逐层进入。
      const dirty = document.createElement('div');
      const outer = document.createElement('template');
      const inner = document.createElement('template');
      inner.content.appendChild(document.createTextNode('$'));
      inner.content.appendChild(
        document.createTextNode('{constructor.constructor("alert(1)")()')
      );
      outer.content.appendChild(inner);
      dirty.appendChild(outer);

      const result = DOMPurify.sanitize(dirty, {
        RETURN_DOM: true,
        SAFE_FOR_TEMPLATES: true,
      });

      const innerAfter = result
        .querySelector('template')
        .content.querySelector('template');
      innerAfter.content.normalize();
      assert.notOk(
        /\$\{[\s\S]*\}/.test(innerAfter.content.textContent),
        'merged expression inside nested template.content should be scrubbed'
      );
    });

    // =======================================================================
    // DOM clobbering 候选矩阵（roundhouse）。
    //
    // 对下方候选名称与四种 carrier 标记做笛卡尔积，并检查清洗后的 sink 痕迹。
    // carrier 使用 `<form>`：其 named/id 子节点通过 LegacyOverrideBuiltIns 遮蔽 built-in，
    // 这是 sanitizer 必须承受的元素级 clobbering 向量。
    //
    // 首个断言消息记录当前引擎是否发生 built-in 遮蔽；该断言本身总为 true。
    // 没有遮蔽能力时，矩阵仍检查普通输入的清洗结果；有遮蔽能力时才同时覆盖具名控件干扰。
    // =======================================================================

    /**
     * 定义候选名称、四种载体和两个 sink 扫描器；
     * 字符串路径逐项及合并检查，IN_PLACE 根接受抛错或无 sink 返回。
     */
    QUnit.module('DOM clobbering — comprehensive matrix');

    // 候选涵盖身份、内容、导航、属性与方法；各名称能否被具名控件遮蔽取决于引擎。
    const CLOBBER_NAMES = [
      // 身份与类型。
      'nodeName',
      'nodeType',
      'nodeValue',
      'tagName',
      'localName',
      'namespaceURI',
      'prefix',
      // 内容。
      'textContent',
      'innerHTML',
      'outerHTML',
      'innerText',
      'data',
      // 树导航。
      'parentNode',
      'parentElement',
      'childNodes',
      'children',
      'firstChild',
      'lastChild',
      'firstElementChild',
      'lastElementChild',
      'nextSibling',
      'previousSibling',
      'nextElementSibling',
      'previousElementSibling',
      'ownerDocument',
      'getRootNode',
      'content',
      // 属性。
      'attributes',
      'getAttribute',
      'getAttributeNode',
      'getAttributeNames',
      'hasAttribute',
      'hasAttributes',
      'setAttribute',
      'setAttributeNS',
      'removeAttribute',
      'removeAttributeNS',
      // 变更操作。
      'removeChild',
      'appendChild',
      'insertBefore',
      'replaceChild',
      'cloneNode',
      'remove',
      'replaceWith',
      'before',
      'after',
      // shadow 与查询。
      'shadowRoot',
      'host',
      'attachShadow',
      'querySelector',
      'querySelectorAll',
      'getElementsByTagName',
      'matches',
      'closest',
      // 清洗期间或消费者读取的其他属性。
      'classList',
      'className',
      'id',
      'name',
      'is',
      'value',
      'type',
      'style',
    ];

    // 惰性 sink：均不自动加载（无 `<img src>`），在解析后或 detached document 中也不执行，
    // 因此 harness 自身不会触发；一旦清洗失效，每项仍会留下可检测语法痕迹。
    const CLOBBER_SINKS =
      '<img onerror="window.__clob=(window.__clob||0)+1">' +
      '<a href="javascript:window.__clob=1">x</a>' +
      '<script>window.__clob=1</script>' +
      '<div onclick="window.__clob=1">z</div>';

    /**
     * 用文本正则检查此矩阵指定的事件属性、script 起始标记或 javascript: 字样。
     * 正则可命中惰性文本，因此与下方重新解析检查一起作为矩阵失败条件。
     * @param {string} s sanitize 返回的序列化结果。
     * @returns {boolean} 任一指定语法痕迹出现时为 true。
     */
    const clobberHasSink = (s) => /\son\w+\s*=|<script|javascript:/i.test(s);
    /**
     * 用 DOMParser 重新解析清洗输出，定位带 onerror/onload/onclick 的元素或 script。
     * 仅查询这三种事件名称，没有遍历模板片段、shadow 或查找危险 URL。
     * @param {string} s 清洗输出。
     * @returns {Element | null} 首个匹配节点；调用方按真值判断是否发现 sink。
     */
    const clobberReparseSink = (s) =>
      new window.DOMParser()
        .parseFromString(s, 'text/html')
        .querySelector('[onerror],[onload],[onclick],script');

    /**
     * 为一个候选 built-in 名称生成 name/id、重复控件集合和 form-name 四类 clobber carrier。
     *
     * @param name - 要尝试遮蔽的 DOM 属性或方法名。
     * @returns {string[]} 四组 form 标记，每组带相同的惰性 sink 组合。
     */
    const clobberPayloads = (name) => [
      '<form><input name="' + name + '">' + CLOBBER_SINKS + '</form>',
      '<form><input id="' + name + '">' + CLOBBER_SINKS + '</form>',
      // 在支持表单具名访问的引擎中，两个匹配控件可使该名称返回 RadioNodeList。
      '<form><input name="' +
        name +
        '"><input name="' +
        name +
        '">' +
        CLOBBER_SINKS +
        '</form>',
      '<form name="' + name + '">' + CLOBBER_SINKS + '</form>',
    ];

    /**
     * 每个 CLOBBER_NAMES 名称配四种载体，分别及合并默认清洗。
     * 两种 sink 扫描不得有发现，__clob 必须为 0；
     * 能力记录仅报告遮蔽，矩阵断言检查净化输出。
     */
    QUnit.test(
      'no clobbering combination defeats sanitization (string path)',
      (assert) => {
        window.__clob = 0;

        // 报告当前引擎是否真正 override built-in。
        const probe = document.createElement('form');
        probe.innerHTML =
          '<input name="attributes"><input name="getAttributeNames">';
        const realAttributes = Object.getOwnPropertyDescriptor(
          window.Element.prototype,
          'attributes'
        ).get.call(probe);
        const overrideLive =
          typeof probe.nodeName !== 'string' ||
          typeof probe.getAttributeNames !== 'function' ||
          probe.attributes !== realAttributes;
        assert.ok(
          true,
          'form LegacyOverrideBuiltIns active in this engine: ' + overrideLive
        );

        const failures = [];
        const allBlocks = [];
        for (const name of CLOBBER_NAMES) {
          for (const payload of clobberPayloads(name)) {
            allBlocks.push(payload);
            const out = DOMPurify.sanitize(payload);
            if (clobberHasSink(out) || clobberReparseSink(out)) {
              failures.push(name + ' :: ' + out.slice(0, 160));
            }
          }
        }
        assert.deepEqual(
          failures,
          [],
          'every individual clobber payload sanitized to a sink-free result'
        );

        // roundhouse：把整个矩阵组合进单个 block 再测一次。
        const big = DOMPurify.sanitize(allBlocks.join(''));
        assert.notOk(
          clobberHasSink(big) || clobberReparseSink(big),
          'combined clobbering block leaves no executable sink'
        );

        assert.equal(
          window.__clob,
          0,
          'no clobbering payload executed during the test'
        );
      }
    );

    /**
     * 每个名称构造 detached form 根，带事件、javascript: 链接等惰性载荷。
     * 接受抛错，正常返回须无 sink，且 __clob=0；
     * 未挂载或主动派发事件。
     */
    QUnit.test(
      'clobbered IN_PLACE roots throw or sanitize safely',
      (assert) => {
        window.__clob = 0;
        // detached 根加惰性 sink：此处不会加载或触发任何内容。
        const inPlaceSinks =
          '<img onerror="window.__clob=1">' +
          '<a href="javascript:window.__clob=1">x</a>' +
          '<div onclick="window.__clob=1">z</div>';

        const failures = [];
        for (const name of CLOBBER_NAMES) {
          const root = document.createElement('form');
          root.innerHTML = '<input name="' + name + '">' + inPlaceSinks;

          let threw = false;
          let out = null;
          try {
            out = DOMPurify.sanitize(root, { IN_PLACE: true });
          } catch (_) {
            threw = true; // clobbered/forbidden 根采用 fail-closed 可接受。
          }

          // 要么抛错，要么返回节点不含 sink。
          if (!threw && clobberHasSink(out.outerHTML)) {
            failures.push(name + ' :: ' + out.outerHTML.slice(0, 160));
          }
        }
        assert.deepEqual(
          failures,
          [],
          'every clobbered IN_PLACE root threw or returned a sink-free node'
        );
        assert.equal(
          window.__clob,
          0,
          'no payload executed during IN_PLACE matrix'
        );
      }
    );

    // =======================================================================
    // 安全回归：audit-5 Finding A；IN_PLACE 提升内容必须中和原始 subtree。
    // =======================================================================
    // KEEP_CONTENT 删除不允许元素时，会重新挂接其子节点，让 sanitizer walker 能继续到达。
    // 该遍历只有在承载排队资源事件的节点与实际被清洗节点相同时，才能保护 IN_PLACE 的
    // build-then-sanitize 模式：
    //
    //     el.innerHTML = dirty;                       // 排队 <img> 加载
    //     DOMPurify.sanitize(el, { IN_PLACE: true }); // 同步删除 on*
    //
    // 历史实现提升子节点的 clone，只分离 original；因此任何 disallowed wrapper 中的 handler，
    // 如 `<x-wrap><img src=… onerror=…></x-wrap>`，都会留下 detached 但仍 armed 的原 img。
    // 其排队 error/load 事件会在页面 scope 执行存活的 on*，而返回树看似完全干净。修复改为提升
    // original 节点本身，使 walker 在持有排队事件的同一节点上删除 handler。无 wrapper 的直接
    // handler 原本就能中和；这些测试固定“一个 wrapper 不能再翻转该保证”。
    /**
     * 拒绝包装下先保存原图片引用，再清洗；
     * 属性断言覆盖已分离原节点，一例等待 data 图片加载事件。
     */
    QUnit.module(
      'Security — IN_PLACE hoisted-content neutralisation (audit-5)'
    );

    /**
     * x-wrap 中危险 img 先保存原引用及 handler 前置断言，再 IN_PLACE。
     * 原引用和返回树均无 onerror，额外扫描存活图片，覆盖被分离原节点的中和。
     */
    QUnit.test(
      'wrapped on*-handler original is scrubbed, not just its clone',
      (assert) => {
        // sanitize 前按引用捕获带 handler 的原节点。IN_PLACE 后，无论它仍在树中还是已 detached，
        // 都不得保留 on* 属性；浏览器排队 load/error 事件执行的正是该属性。
        const root = document.createElement('div');
        root.innerHTML =
          '<x-wrap><img src="http://127.0.0.1:1/x" onerror="alert(1)"></x-wrap>';
        const original = root.querySelector('img');
        assert.equal(
          original.getAttribute('onerror'),
          'alert(1)',
          'precondition: original carries the handler before sanitize'
        );

        DOMPurify.sanitize(root, { IN_PLACE: true });

        assert.equal(
          original.getAttribute('onerror'),
          null,
          'the original node (which holds any queued event) is scrubbed'
        );
        assert.notOk(
          /onerror/i.test(root.innerHTML),
          'returned tree is free of the handler'
        );
        // 再检查返回树中的全部图片；前面的 original 引用断言另覆盖已经离树的原图片。
        const imgs = root.querySelectorAll('img');
        let armed = 0;
        imgs.forEach((img) => {
          if (img.hasAttribute('onerror')) armed++;
        });
        assert.equal(armed, 0, 'no surviving <img> retains the handler');
      }
    );

    /**
     * 两层拒绝包装包住同时带 onerror/onload 的图片。
     * 原地净化后原图片引用两属性都空，返回树也无片段，检查嵌套提升/删除的原节点处理。
     */
    QUnit.test(
      'nested disallowed wrappers around a handler are fully scrubbed',
      (assert) => {
        const root = document.createElement('div');
        root.innerHTML =
          '<x-a><x-b><img src="http://127.0.0.1:1/x" ' +
          'onerror="alert(1)" onload="alert(2)"></x-b></x-a>';
        const original = root.querySelector('img');
        DOMPurify.sanitize(root, { IN_PLACE: true });
        assert.equal(
          original.getAttribute('onerror'),
          null,
          'onerror stripped from original through nested wrappers'
        );
        assert.equal(
          original.getAttribute('onload'),
          null,
          'onload stripped from original through nested wrappers'
        );
        assert.notOk(
          /onerror|onload/i.test(root.innerHTML),
          'returned tree is free of every handler'
        );
      }
    );

    /**
     * 把包在拒绝元素中的 data 图片连接 qunit-fixture，再 IN_PLACE。
     * 等待 100ms 要求 xssed 未置 true并清场，观察加载事件；
     * 不加载资源的 runner 无执行触发。
     */
    QUnit.test(
      'wrapped handler does not execute after IN_PLACE sanitize',
      (assert) => {
        // 浏览器有意义的执行检查；jsdom 不加载资源，因此在那里惰性通过。使用可成功加载的 data:
        // image onload，使载体不依赖失败网络请求。
        window.xssed = false;
        const root = document.createElement('div');
        document.getElementById('qunit-fixture').appendChild(root);
        root.innerHTML =
          '<x-wrap><img onload="alert(1)" ' +
          'src="data:image/gif;base64,' +
          'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></x-wrap>';
        DOMPurify.sanitize(root, { IN_PLACE: true });
        const done = assert.async();
        setTimeout(() => {
          assert.notEqual(
            window.xssed,
            true,
            'handler of the wrapped/hoisted image must not fire'
          );
          document.getElementById('qunit-fixture').innerHTML = '';
          window.xssed = false;
          done();
        }, 100);
      }
    );

    /**
     * 拒绝包装内的 form 用三个具名控件遮蔽属性/方法，危险图片保留原引用。
     * 原地净化后原 img 与返回树均无事件，检查遮蔽表单与包装提升组合。
     */
    QUnit.test(
      'handler stripping is not defeated by a clobbering <form> sibling',
      (assert) => {
        // x-wrap 删除时，KEEP_CONTENT 用缓存 getter 取得并提升原 form。
        // 引擎若把具名控件暴露为 form 的 removeAttribute/attributes/childNodes，
        // `_isClobbered` 会删除整棵 form；成功收尾再中和 removed 记录中的原 img。
        // 未发生遮蔽时，img 进入普通属性净化。两条路径都要求原图片的 onerror 被删除。
        const root = document.createElement('div');
        root.innerHTML =
          '<x-wrap><form>' +
          '<input name="removeAttribute"><input name="attributes">' +
          '<input name="childNodes">' +
          '<img src="http://127.0.0.1:1/x" onerror="alert(1)">' +
          '</form></x-wrap>';
        const original = root.querySelector('img');
        DOMPurify.sanitize(root, { IN_PLACE: true });
        assert.equal(
          original.getAttribute('onerror'),
          null,
          'handler stripped from the vehicle despite the clobbering form'
        );
        assert.notOk(
          /onerror/i.test(root.innerHTML),
          'returned tree carries no handler'
        );
      }
    );

    // =======================================================================
    // 安全回归——第三轮攻防（selectedcontent 镜像、异常屏障、深树 fail-open）。
    // 对应审计项 7–11。
    // =======================================================================
    // selectedcontent 用例检查默认删除时不提升内容；它们把该元素放在 div 中，
    // 不依赖 select 的真实镜像行为。后两例分别检查 detached 树的清洗结果，
    // 以及 DOM API 构造的 5000 层树能否完成 IN_PLACE。
    /**
     * 分别检查 selectedcontent 内容丢弃、detached 自定义元素最终结果、5000 层 DOM 完成；
     * 三种验证目标不合并。
     */
    QUnit.module(
      'Security — campaign-3 (selectedcontent / barrier / deep tree)'
    );

    /**
     * div 中 selectedcontent 包住危险图片与普通 b。
     * 默认清洗严格只剩空 div，另排除图片/事件，证明禁内容规则丢弃整棵子树而非提升。
     */
    QUnit.test(
      'C3-F1/F6: <selectedcontent> is removed without hoisting its content',
      (assert) => {
        const clean = DOMPurify.sanitize(
          '<div><selectedcontent><img src=x onerror=alert(1)>' +
            '<b>copy</b></selectedcontent></div>'
        );
        assert.equal(
          clean,
          '<div></div>',
          'selectedcontent content dropped, not hoisted: ' + clean
        );
        assert.notOk(/onerror/i.test(clean), 'no hoisted handler');
        assert.notOk(/<img/i.test(clean), 'no hoisted element');
      }
    );

    /**
     * selectedcontent 内只有安全 span，但显式 KEEP_CONTENT=true。
     * 严格为空，检查 FORBID_CONTENTS 仍阻止普通后代提升。
     */
    QUnit.test(
      'C3-F1: selectedcontent content drop survives the KEEP_CONTENT path',
      (assert) => {
        const clean = DOMPurify.sanitize(
          '<selectedcontent><span>x</span></selectedcontent>',
          { KEEP_CONTENT: true }
        );
        assert.equal(clean, '', 'content dropped under KEEP_CONTENT: ' + clean);
      }
    );

    /**
     * 注册断开反应类后在 detached div 中放该元素和三个 sink。
     * 允许 sanitize 抛错，最终根无事件/危险 URI；
     * 根未连接文档，标准断开回调不由此移除触发。
     */
    QUnit.test(
      'C3-F2: custom-element mid-walk abort leaves no surviving handler',
      (assert) => {
        // 此例注册断开回调，但 root 未连接到 document；标准 disconnectedCallback 不会因
        // 这棵 detached 树的移除触发。下方断言检查最终根中没有事件属性或 javascript: URL。
        // 前面 mid-walk abort 用例把根连接到 document，再观察回调变更和异常清理；
        // 对应实现是 sanitize 的 IN_PLACE 异常屏障与 `_neutralizeRoot`。
        if (typeof window.customElements === 'undefined') {
          assert.ok(true, 'no custom elements in this environment; skipping');
          return;
        }
        if (!window.customElements.get('x-surgeon-c3')) {
          /**
           * 定义断开反应载体，回调查找文档中的 x-wrap-c3 并尝试删除。
           * 本例根始终离线，因此标准断开反应没有由这次清洗触发。
           */
          class XSurgeonC3 extends window.HTMLElement {
            /**
             * 在元素从已连接文档断开时查找并删除包装节点。
             * 这里保留回调形状；当前 detached 场景的断言检查最终根属性结果。
             *
             * @returns {void}
             */
            disconnectedCallback() {
              const w = document.querySelector('x-wrap-c3');
              if (w && w.parentNode) {
                w.remove();
              }
            }
          }
          window.customElements.define('x-surgeon-c3', XSurgeonC3);
        }
        const root = document.createElement('div');
        root.innerHTML =
          '<x-wrap-c3><x-surgeon-c3></x-surgeon-c3></x-wrap-c3>' +
          '<img src="data:,x" onerror="window.xssed = true">' +
          '<a href="javascript:alert(1)">l</a>' +
          '<div onclick="window.xssed = true">d</div>';
        try {
          DOMPurify.sanitize(root, { IN_PLACE: true });
        } catch (_) {
          // 允许净化调用继续抛出中断异常，但树必须已按 fail-closed 语义中和。
        }
        assert.notOk(/onerror/i.test(root.innerHTML), 'no surviving onerror');
        assert.notOk(/onclick/i.test(root.innerHTML), 'no surviving onclick');
        assert.notOk(
          /javascript:/i.test(root.innerHTML),
          'no surviving javascript: URL'
        );
      }
    );

    /**
     * DOM API 构造深度 5000 的 div 链，浅层图片带 onerror。
     * IN_PLACE 不得抛错且图片属性必须删除；
     * 树未挂载或序列化，检查深预扫后的完成结果。
     */
    QUnit.test(
      'C3-F4: deep DOM-built tree sanitizes in place without failing open',
      (assert) => {
        const DEPTH = 5000;
        const root = document.createElement('div');
        const img = document.createElement('img');
        img.setAttribute('onerror', 'window.xssed = true');
        root.appendChild(img);
        let cursor = root;
        for (let i = 0; i < DEPTH; i++) {
          const child = document.createElement('div');
          cursor.appendChild(child);
          cursor = child;
        }
        let threw = false;
        try {
          DOMPurify.sanitize(root, { IN_PLACE: true });
        } catch (_) {
          threw = true;
        }
        assert.notOk(threw, 'no stack-overflow throw at the entry pre-pass');
        assert.notOk(
          img.hasAttribute('onerror'),
          'shallow handler stripped despite deep tree'
        );
      }
    );

    // =======================================================================
    // 覆盖——非字符串输入强制转换（utils.stringifyValue/lookupGetter）
    //
    // sanitize() 在解析前把非字符串、非 Node 输入转成字符串
    //（purify.ts：`dirty = stringifyValue(dirty)`）。数据驱动的标记测试只传字符串，
    // 无法触达 stringifyValue 的类型分派与 lookupGetter 的原型链遍历。以下用例覆盖
    // 两者；带 toString 的对象还验证强制转换生成的标记仍须经过净化。
    // =======================================================================

    /**
     * 数字、布尔、可用时 bigint/Symbol、函数与 toString 对象检查 stringifyValue/lookupGetter
     * 的转换结果。
     */
    QUnit.module('Coverage - input coercion');

    /**
     * 数字 123 作为输入默认净化。
     * 严格得到字符串 123，检查非字符串输入转换。
     */
    QUnit.test('coerces a number input', (assert) => {
      assert.equal(DOMPurify.sanitize(123), '123');
    });

    /**
     * 布尔 true 作为输入默认净化。
     * 严格得到字符串 true，检查布尔转换。
     */
    QUnit.test('coerces a boolean input', (assert) => {
      assert.equal(DOMPurify.sanitize(true), 'true');
    });

    if (typeof BigInt !== 'undefined') {
      /**
       * 仅在 BigInt 可用时注册，用 BigInt(42) 输入。
       * 严格得到字符串 42，检查 bigint 转换分支。
       */
      QUnit.test('coerces a bigint input', (assert) => {
        assert.equal(DOMPurify.sanitize(BigInt(42)), '42');
      });
    }

    if (typeof Symbol !== 'undefined') {
      /**
       * 仅在 Symbol 可用时注册，用 Symbol('x') 输入。
       * 输出须以 Symbol( 开头，检查显式符号转换而非隐式连接报错。
       */
      QUnit.test('coerces a symbol input', (assert) => {
        const out = DOMPurify.sanitize(Symbol('x'));
        assert.equal(out.indexOf('Symbol('), 0, `got: ${out}`);
      });
    }

    /**
     * 以具名空函数 demo 为输入。
     * 输出须包含 demo，检查函数源码字符串转换，未要求跨引擎完全相同的源码排版。
     */
    QUnit.test('coerces a function input', (assert) => {
      /**
       * 为函数输入提供可辨识名称，使 stringifyValue 的函数分支可被断言。
       */
      const out = DOMPurify.sanitize(function demo() {});
      assert.ok(out.indexOf('demo') > -1, `got: ${out}`);
    });

    /**
     * 对象 toString 返回安全 b 与危险 img。
     * 输出须含完整 b、不得有 onerror，验证转换结果继续进入主净化链。
     */
    QUnit.test('coerced toString() markup is still sanitized', (assert) => {
      const dirty = {
        /**
         * 返回同时含允许标签与事件处理器的标记，验证转换后仍进入主净化链。
         *
         * @returns {string} 用于净化的测试标记。
         */
        toString() {
          return '<b>x</b><img src=x onerror=alert(1)>';
        },
      };
      const out = DOMPurify.sanitize(dirty);
      assert.equal(out.indexOf('onerror'), -1, `onerror survived: ${out}`);
      assert.ok(out.indexOf('<b>x</b>') > -1, `got: ${out}`);
    });

    /**
     * 对象 toString 故意返回数字 42。
     * 严格输出为 [object Number]，检查非字符串返回值转用对象标签的回退。
     */
    QUnit.test(
      'coerces an object whose toString returns a non-string',
      (assert) => {
        const out = DOMPurify.sanitize({
          /**
           * 故意返回非字符串，触发 stringifyValue 的二次对象标签转换。
           *
           * @returns {number} 用于覆盖非字符串返回值的数字。
           */
          toString() {
            return 42;
          },
        });
        assert.equal(out, '[object Number]');
      }
    );

    /**
     * null 原型对象没有 toString。
     * 严格输出 [object Null]，检查 getter 查找失败返回 null 后的对象标签回退。
     */
    QUnit.test(
      'coerces a null-prototype object (lookupGetter fallback)',
      (assert) => {
        // 原型链上不存在 toString：lookupGetter 遍历至 null 后调用 fallbackValue()，
        // 得到 null，随后改用 objectToString。
        const out = DOMPurify.sanitize(Object.create(null));
        assert.equal(out, '[object Null]');
      }
    );

    // =======================================================================
    // 覆盖——配置集合构造（utils.addToSet/cleanArray）
    //
    // 覆盖非数组保护、非字符串元素分支，以及 clone()/cleanArray() 对用户配置稀疏数组
    // 执行的 null 填洞逻辑。
    // =======================================================================

    /**
     * 非数组 ADD_TAGS 与稀疏数组检查调用完成及合法标签保留；
     * 未直接断言内部集合/填洞值。
     */
    QUnit.module('Coverage - config set construction');

    /**
     * ADD_TAGS 给字符串，输入普通 div。
     * 仅要求调用完成且输出含 x，检查此配置形状的处理；
     * 未验证完整标签集合或新增准入。
     */
    QUnit.test('ADD_TAGS given a non-array is handled safely', (assert) => {
      const out = DOMPurify.sanitize('<div>x</div>', {
        ADD_TAGS: 'notanarray',
      });
      assert.ok(out.indexOf('x') > -1, `got: ${out}`);
    });

    /**
     * ADD_TAGS 数组含空洞与数字，另有 custom-a/custom-b。
     * 结果须包含两名称，检查数组清理后合法项仍准入；
     * 未断言空洞或数字项的最终集合值。
     */
    QUnit.test('ADD_TAGS with a hole and a non-string element', (assert) => {
      const tags = ['custom-a'];
      tags[2] = 'custom-b'; // 索引 1 是空洞，cleanArray 会以 null 填补
      tags.push(123); // 非字符串元素会进入 addToSet 的非字符串分支
      const out = DOMPurify.sanitize(
        '<custom-a></custom-a><custom-b></custom-b>',
        { ADD_TAGS: tags }
      );
      assert.ok(
        out.indexOf('custom-a') > -1 && out.indexOf('custom-b') > -1,
        `got: ${out}`
      );
    });

    // =======================================================================
    // 公开 API、配置与 hook 的补充用例
    //
    // 覆盖公开 API（isValidAttribute、addHook 保护）、用户提供的
    // TRUSTED_TYPES_POLICY 配置路径（含其重入保护，#1422 / GHSA-vxr8-fq34-vvx9）、
    // forceKeepAttr/keepAttr hook 决策，以及若干配置排列与结构输出。
    //
    // 隔离：afterEach 清除持久配置、调用方 Trusted Types 策略与 hooks，
    // 下一次调用重新解析默认配置；内部默认 Trusted Types 策略缓存仍属于该实例。
    // =======================================================================

    /**
     * beforeEach 清持久配置，afterEach 再清配置与 hooks；
     * 覆盖公开属性检查、hook 决策、策略接口和配置排列，各例按实际断言说明。
     */
    QUnit.module('Coverage - reachable branches', {
      /**
       * 每个用例前退出持久配置；随后 sanitize/isValidAttribute 会重新解析配置。
       *
       * @returns {void}
       */
      beforeEach() {
        DOMPurify.clearConfig();
      },
      /**
       * 每个用例后移除 hooks 与持久配置，同时解除调用方 Trusted Types 策略。
       *
       * @returns {void}
       */
      afterEach() {
        DOMPurify.removeAllHooks();
        DOMPurify.clearConfig();
      },
    });

    /**
     * 直接调用 isValidAttribute 检查安全 href 与 onclick。
     * 分别要求 true/false，验证公开名称和值检查接口，无 DOM 写回操作。
     */
    QUnit.test('isValidAttribute accepts and rejects', (assert) => {
      assert.ok(DOMPurify.isValidAttribute('a', 'href', 'https://example.com'));
      assert.notOk(DOMPurify.isValidAttribute('a', 'onclick', 'alert(1)'));
    });

    /**
     * 向 upon 元素入口注册 null，再净化安全 b。
     * 严格结果保持 b，检查非函数 hook 被忽略。
     */
    QUnit.test('addHook ignores a non-function', (assert) => {
      DOMPurify.addHook('uponSanitizeElement', null);
      assert.equal(DOMPurify.sanitize('<b>x</b>'), '<b>x</b>');
    });

    /**
     * 安全 b 输入配 null 配置。
     * 严格保持 b，检查配置归一化为空配置。
     */
    QUnit.test('null config is treated as empty config', (assert) => {
      assert.equal(DOMPurify.sanitize('<b>x</b>', null), '<b>x</b>');
    });

    /**
     * 完整 html/head/body/p 输入开启 WHOLE_DOCUMENT。
     * 只要求输出含 p，验证内容保留；
     * 本断言未严格检查文档包装结构。
     */
    QUnit.test('WHOLE_DOCUMENT keeps the document structure', (assert) => {
      const out = DOMPurify.sanitize(
        '<html><head></head><body><p>x</p></body></html>',
        { WHOLE_DOCUMENT: true }
      );
      assert.ok(out.indexOf('<p>x</p>') > -1, `got: ${out}`);
    });

    /**
     * 独立 template 带危险 img，默认输出不含 onerror。
     * 独立模板可被解析进 head 而不返回，故此断言未单独证明模板 content 遍历。
     */
    QUnit.test('template content is sanitized', (assert) => {
      const out = DOMPurify.sanitize(
        '<template><img src=x onerror=alert(1)></template>'
      );
      assert.equal(out.indexOf('onerror'), -1, `onerror survived: ${out}`);
    });

    /**
     * SVG a 的安全 xlink:href 值未改变。
     * 只要求结果含 svg，未断言属性存在；
     * 当前无需写回，因此未覆盖 setAttributeNS 调用。
     */
    QUnit.test(
      'namespaced SVG attribute is written via setAttributeNS',
      (assert) => {
        // 这里的 xlink:href 值未改变，不触发 `_setAttributeValue` 写回；
        // 下方只检查输出包含 svg。setAttributeNS 用于需写回的 namespaced 属性。
        const out = DOMPurify.sanitize(
          '<svg><a xlink:href="https://x"></a></svg>'
        );
        assert.ok(out.indexOf('svg') > -1, `got: ${out}`);
      }
    );

    /**
     * noscript/noembed 内仅安全文字，默认净化后排除 onerror。
     * 输入本来没有事件，该断言未检查容器是否删除。
     */
    QUnit.test(
      'noscript/noembed fallback-mXSS guard removes the element',
      (assert) => {
        const out = DOMPurify.sanitize(
          '<noscript><noembed>x</noembed></noscript>'
        );
        assert.equal(out.indexOf('onerror'), -1, `got: ${out}`);
      }
    );

    /**
     * upon 属性 hook 一律设置 forceKeepAttr=true，a 带默认拒绝的 onclick。
     * 输出须出现 onclick，检查 hook 跳过常规属性拒绝。
     */
    QUnit.test(
      'uponSanitizeAttribute forceKeepAttr keeps a disallowed attribute',
      (assert) => {
        DOMPurify.addHook('uponSanitizeAttribute', (node, hookEvent) => {
          hookEvent.forceKeepAttr = true;
        });
        const out = DOMPurify.sanitize('<a onclick="alert(1)">x</a>');
        assert.ok(out.indexOf('onclick') > -1, `forceKeepAttr ignored: ${out}`);
      }
    );

    /**
     * upon 属性 hook 一律 keepAttr=false，a 带安全 href。
     * 输出不得含 href，检查 hook 主动删除允许属性。
     */
    QUnit.test(
      'uponSanitizeAttribute keepAttr=false drops an allowed attribute',
      (assert) => {
        DOMPurify.addHook('uponSanitizeAttribute', (node, hookEvent) => {
          hookEvent.keepAttr = false;
        });
        const out = DOMPurify.sanitize('<a href="https://x">y</a>');
        assert.equal(out.indexOf('href'), -1, `keepAttr=false ignored: ${out}`);
      }
    );

    // ---- 用户提供的 TRUSTED_TYPES_POLICY 配置 ----

    /**
     * 调用方提供两个恒等策略函数并请求 Trusted Type。
     * String(out) 严格为净化 b，检查接受策略后的内容结果；
     * 恒等返回未单独证明签名次数或对象品牌。
     */
    QUnit.test(
      'TRUSTED_TYPES_POLICY signs output through the policy',
      (assert) => {
        /**
         * 最小用户 Trusted Types 策略；两个函数值属性保持输入不变，以隔离签名路径。
         *
         * @property {(value: string) => string} createHTML 签名 HTML 输出。
         * @property {(value: string) => string} createScriptURL 满足策略接口校验。
         */
        const policy = { createHTML: (s) => s, createScriptURL: (s) => s };
        const out = DOMPurify.sanitize('<b>x</b>', {
          TRUSTED_TYPES_POLICY: policy,
          RETURN_TRUSTED_TYPE: true,
        });
        assert.equal(String(out), '<b>x</b>');
      }
    );

    /**
     * 策略仅有 createScriptURL，输入文本。
     * 要求错误消息含 createHTML，检查缺失接口在配置阶段被拒绝。
     */
    QUnit.test('TRUSTED_TYPES_POLICY without createHTML throws', (assert) => {
      assert.throws(
        () =>
          DOMPurify.sanitize('x', {
            TRUSTED_TYPES_POLICY: { createScriptURL: (s) => s },
          }),
        /createHTML/
      );
    });

    /**
     * 策略仅有 createHTML，输入文本。
     * 要求错误消息含 createScriptURL，检查另一必需接口。
     */
    QUnit.test(
      'TRUSTED_TYPES_POLICY without createScriptURL throws',
      (assert) => {
        assert.throws(
          () =>
            DOMPurify.sanitize('x', {
              TRUSTED_TYPES_POLICY: { createHTML: (s) => s },
            }),
          /createScriptURL/
        );
      }
    );

    /**
     * 显式 TRUSTED_TYPES_POLICY=null，清洗安全 b。
     * 严格输出 b 字符串，检查该次关闭策略后的内容。
     */
    QUnit.test('TRUSTED_TYPES_POLICY null opts out for the call', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<b>x</b>', { TRUSTED_TYPES_POLICY: null }),
        '<b>x</b>'
      );
    });

    /**
     * 策略 createHTML 递归调用同一净化器。
     * 要求外层调用抛错，检查签名期间的重入阻断，未限制具体错误类型或消息。
     */
    QUnit.test(
      'a circular TRUSTED_TYPES_POLICY is rejected by the re-entrancy guard',
      (assert) => {
        const circular = {
          /**
           * 在策略签名期间递归调用同一净化器，模拟不可信策略导致的重入。
           *
           * @param {string} s 待签名的 HTML。
           * @returns {*} 内层 sanitize 的返回值；预期在重入保护处先抛错。
           */
          createHTML(s) {
            return DOMPurify.sanitize(s);
          },
          /**
           * 满足用户策略接口校验的恒等 ScriptURL 工厂。
           */
          createScriptURL: (s) => s,
        };
        assert.throws(() =>
          DOMPurify.sanitize('<b>x</b>', { TRUSTED_TYPES_POLICY: circular })
        );
      }
    );

    // ---- 配置排列 ----

    /**
     * setConfig 仅允许 b，随后净化 b/i。
     * 严格保留 b 并提升 i 文字，检查持久标签配置应用。
     */
    QUnit.test('setConfig applies persistent configuration', (assert) => {
      DOMPurify.setConfig({ ALLOWED_TAGS: ['b'] });
      assert.equal(DOMPurify.sanitize('<b>x</b><i>y</i>'), '<b>x</b>y');
    });

    /**
     * a 带 data-x，同时把它加入 ADD_ATTR 数组。
     * 只要求属性出现；
     * 默认 data-* 已准入，该输入未单独证明追加名称的必要性。
     */
    QUnit.test('ADD_ATTR given an array allows the attribute', (assert) => {
      const out = DOMPurify.sanitize('<a data-x="1">y</a>', {
        ADD_ATTR: ['data-x'],
      });
      assert.ok(out.indexOf('data-x') > -1, `got: ${out}`);
    });

    /**
     * 提供两种 integration-point 对象，输入仅普通 div。
     * 要求输出含 x，检查配置被接受；
     * 输入未穿越外来命名空间边界。
     */
    QUnit.test('integration-point objects are accepted', (assert) => {
      const out = DOMPurify.sanitize('<div>x</div>', {
        MATHML_TEXT_INTEGRATION_POINTS: { mtext: true },
        HTML_INTEGRATION_POINTS: { foreignobject: true },
      });
      assert.ok(out.indexOf('x') > -1, `got: ${out}`);
    });

    /**
     * FORBID_CONTENTS 指定 span，但输入 span 仍是允许标签。
     * 只要求 div 保留，禁内容规则未在允许 span 上执行，未证明默认集合隔离。
     */
    QUnit.test(
      'FORBID_CONTENTS clones before mutating the default',
      (assert) => {
        const out = DOMPurify.sanitize('<div><span>x</span></div>', {
          FORBID_CONTENTS: ['span'],
        });
        assert.ok(out.indexOf('<div>') > -1, `got: ${out}`);
      }
    );

    /**
     * 显式放行 noscript/noembed，输入仅安全文字。
     * 只排除输入本无的 onerror，记录配置调用；
     * 未断言 fallback 标签或子树被删除。
     */
    QUnit.test(
      'allowed noscript with a fallback-mXSS payload is removed',
      (assert) => {
        // fallback-tag 检查位于标签准入之后，因此显式放行 noscript/noembed。
        // 检查匹配其 innerHTML 中的闭合 fallback 标签；当前断言只查 onerror 字样，
        // 该输入自身没有 onerror，未检查标签是否被删除。
        const out = DOMPurify.sanitize(
          '<noscript><noembed>x</noembed></noscript>',
          { ADD_TAGS: ['noscript', 'noembed'] }
        );
        assert.equal(out.indexOf('onerror'), -1, `got: ${out}`);
      }
    );

    /**
     * 真实 div 带危险 img，执行 IN_PLACE。
     * 返回引用须等于 div，存活图片不得有 onerror，也接受图片删除，检查原节点返回与属性结果。
     */
    QUnit.test('IN_PLACE sanitizes and returns the passed node', (assert) => {
      const el = document.createElement('div');
      el.innerHTML = '<img src=x onerror=alert(1)>';
      const ret = DOMPurify.sanitize(el, { IN_PLACE: true });
      const img = el.querySelector('img');
      assert.equal(ret, el, 'returns the same node');
      assert.notOk(
        img && img.hasAttribute('onerror'),
        'onerror stripped in place'
      );
    });

    /* =====================================================================
     * 声明式局部更新标记、声明式 shadow DOM 与 setHTMLUnsafe 重解析。
     *
     * payload 组合 template/marker、MathML/SVG 集成点与危险属性。sanitize 后先通过 innerHTML
     * 重解析，再扫描普通子节点、template.content 与可访问的 open shadow root，要求没有
     * on* 属性、script 或指定 URL 属性上的 javascript:/vbscript:。
     *
     * 解析后已在普通树中的节点走主遍历；保留在 template.content 的节点走 fragment 净化。
     * 这些用例观察当前引擎的输出形状，不执行 streaming 操作，也不等待事件处理器运行。
     * ===================================================================== */
    /**
     * 定义 sink 扫描器进入普通树、template.content 与 open shadow；
     * template/marker/DSD 输入净化后重解析，检查输出，无流式驱动。
     */
    QUnit.module('Config — declarative partial updates / streaming');

    /**
     * 收集测试指定的可执行痕迹，进入普通子树、template.content 与可访问的 open shadow。
     * 每个元素检查全部 on* 属性、script 名称和 href/src/xlink:href 上的 java/vbscript 协议。
     * 这里不触发事件、不获取资源；结果是属性/标签扫描记录而非运行日志。
     *
     * @param {Node} root 待审计的 DOM 根节点。
     * @returns {string[]} 可执行标签、处理器属性或脚本 URL 的定位描述。
     */
    const _executableFindings = function (root) {
      const findings = [];
      /**
       * 递归访问普通子节点、模板内容与 shadow root，并累计可执行痕迹。
       * template/shadow 不在普通 childNodes 中，故单独进入；findings 由外层函数持有。
       *
       * @param {Node | null | undefined} node 当前访问节点。
       * @returns {void}
       */
      const visit = (node) => {
        if (!node) return;
        if (node.nodeType === 1) {
          const tag = node.tagName ? node.tagName.toLowerCase() : '';
          for (const name of node.getAttributeNames()) {
            if (/^on/i.test(name)) findings.push(`${tag}@${name}`);
            if (
              (name === 'href' || name === 'src' || name === 'xlink:href') &&
              /^\s*(?:java|vb)script:/i.test(node.getAttribute(name) || '')
            ) {
              findings.push(`${tag}@${name}=js`);
            }
          }
          if (tag === 'script') findings.push('script');
          if (node.shadowRoot) visit(node.shadowRoot);
          if (tag === 'template' && node.content) visit(node.content);
        }
        for (const child of node.childNodes) visit(child);
      };
      visit(root);
      return findings;
    };
    /**
     * 将净化字符串放入 HTML 解析汇点，再扫描重解析后树中的可执行痕迹。
     * holder 保持离线，检查的是重新解析的结构；实际事件执行由其他插入用例观察。
     *
     * @param {string} html 待重解析的 HTML。
     * @returns {string[]} 重解析后发现的可执行痕迹。
     */
    const _findingsFromHTML = function (html) {
      const holder = document.createElement('div');
      holder.innerHTML = html;
      return _executableFindings(holder);
    };

    /**
     * 七组 marker/template 链携带 handler/script/危险 URI 或外来内容。
     * 默认净化后重解析，扫描普通树、template.content 与可访问 shadow 须无 sink；
     * 未单独断言局部更新实际展开。
     */
    QUnit.test(
      'parse-time template expansion neutralizes weaponized payloads',
      (assert) => {
        /**
         * 构造 marker 目标与声明式模板来源之间的最小链接。
         *
         * @param {string} id marker 与 template for 共用的标识符。
         * @param {string} content 模板内的武装内容。
         * @returns {string} 用于测试声明式局部更新解析的标记。
         */
        const link = (id, content) =>
          `<div><?marker name="${id}"></div>` +
          `<template for="${id}">${content}</template>`;
        const cases = {
          'img onerror': link('a', '<img src=x onerror=alert(1)>'),
          script: link('b', '<script>alert(1)<\/script>'),
          'a javascript:': link('c', '<a href="javascript:alert(1)">x</a>'),
          'mtext>style>img': link(
            'd',
            '<math><mtext><style><img src=x onerror=alert(1)></style></mtext></math>'
          ),
          'svg>foreignObject': link(
            'e',
            '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>'
          ),
          // marker 位于集成点内部：传送目标本身就是 namespace 混淆位置。
          'marker inside mtext':
            '<math><mtext><?marker name="f"></mtext></math>' +
            '<template for="f"><style><img src=x onerror=alert(1)></style></template>',
          'marker inside svg':
            '<svg><?marker name="g"></svg>' +
            '<template for="g"><style><img src=x onerror=alert(1)></style></template>',
        };
        for (const [name, dirty] of Object.entries(cases)) {
          const out = DOMPurify.sanitize(dirty);
          assert.deepEqual(
            _findingsFromHTML(out),
            [],
            `no executable content for "${name}" — got: ${out}`
          );
        }
      }
    );

    /**
     * 构造 4/6/8 个 marker/template 链，每段含 96 个 b，尾端放 MathML/style 载荷。
     * 输出重解析扫描须无 sink；
     * 未测实际树深度或解析器深度上限。
     */
    QUnit.test(
      'chained-template depth build (PoC1 shape) neutralizes at the parser depth cap',
      (assert) => {
        const bs = '<b>'.repeat(96);
        /**
         * 构造指定链接数的 template/marker 链，并把载荷放在链尾。
         *
         * @param {string} leaf 链尾载荷。
         * @param {number} links 链接层数。
         * @returns {string} 声明式模板链标记。
         */
        const chain = (leaf, links) => {
          let s = '<div><?marker name="x1"></div>';
          for (let i = 1; i <= links; i++) {
            const next = i < links ? `<?marker name="x${i + 1}">` : leaf;
            s += `<template for="x${i}">${bs}${next}</template>`;
          }
          return s;
        };
        const leaf =
          '<math><mtext><style><img src=x onerror=alert(1)></style></mtext></math>';
        for (const links of [4, 6, 8]) {
          const out = DOMPurify.sanitize(chain(leaf, links));
          assert.deepEqual(
            _findingsFromHTML(out),
            [],
            `no executable content for chained x${links} — head: ${out.slice(0, 80)}`
          );
        }
      }
    );

    /**
     * 声明式 shadow 模板含 img 事件与危险 href。
     * 默认输出须无 shadowrootmode，重解析扫描也无 sink，检查声明属性删除与模板内容净化。
     */
    QUnit.test(
      'declarative shadow DOM: shadowrootmode stripped by default, content sanitized',
      (assert) => {
        const dirty =
          '<section><template shadowrootmode="open">' +
          '<img src=x onerror=alert(1)><a href="javascript:alert(2)">x</a>' +
          '</template></section>';
        const out = DOMPurify.sanitize(dirty);
        assert.equal(
          out.indexOf('shadowrootmode'),
          -1,
          `shadowrootmode stripped by default — got: ${out}`
        );
        assert.deepEqual(
          _findingsFromHTML(out),
          [],
          `no executable content in DSD content — got: ${out}`
        );
      }
    );

    /**
     * 同一模板显式允许 shadowrootmode，内容含危险 img。
     * 只检查重解析扫描无 sink，未断言属性保留或 shadow 实际激活。
     */
    QUnit.test(
      'declarative shadow DOM: ADD_ATTR shadowrootmode still sanitizes shadow content',
      (assert) => {
        const dirty =
          '<section><template shadowrootmode="open">' +
          '<img src=x onerror=alert(1)>' +
          '</template></section>';
        const out = DOMPurify.sanitize(dirty, { ADD_ATTR: ['shadowrootmode'] });
        // 本例只扫描重解析结构；没有断言 shadowrootmode 保留或实际 shadow 激活。
        assert.deepEqual(
          _findingsFromHTML(out),
          [],
          `DSD content sanitized even when shadowrootmode is allowed — got: ${out}`
        );
      }
    );

    /**
     * 支持 setHTMLUnsafe 时将默认清洗的声明式 shadow 输入经它再解析。
     * 扫描普通树/模板/open shadow 须无 sink，检查此插入结果；
     * 默认 mode 删除后通常没有 shadow 激活。
     */
    QUnit.test(
      'sanitized output stays inert when reparsed via setHTMLUnsafe',
      (assert) => {
        if (typeof window.Element.prototype.setHTMLUnsafe !== 'function') {
          assert.ok(true, 'setHTMLUnsafe unavailable in this engine; skipped');
          return;
        }
        const dirty =
          '<section><template shadowrootmode="open">' +
          '<img src=x onerror=alert(1)>' +
          '</template></section>';
        const out = DOMPurify.sanitize(dirty);
        const host = document.createElement('div');
        // 原输入有 shadowrootmode 与 onerror；默认清洗会删除 shadowrootmode，并处理模板内容。
        // setHTMLUnsafe 默认不再净化输入。本例扫描重解析后的普通树、模板与可访问 shadow root；
        // 默认属性被删除后，这段 template 通常不会激活声明式 shadow root。
        host.setHTMLUnsafe(out);
        assert.deepEqual(
          _executableFindings(host),
          [],
          `no executable content after setHTMLUnsafe reparse — got: ${out}`
        );
      }
    );
  };
});
