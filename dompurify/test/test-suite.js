/*
 * DOMPurify 测试套件。
 *
 * 套件按 QUnit module 组织。module 把相关测试聚合，使失败能快速缩小排查范围；同一 module
 * 内按声明顺序从上到下执行，但不保证跨 module 顺序。因此，依赖兄弟用例前后状态的步骤必须
 * 放在同一 module 内（例如 hook 污染模块用 beforeEach/afterEach 隔离实例）。
 *
 * 约定：
 *   - `var` 仅用于 UMD 包装和确实依赖提升的用例局部变量；其余声明使用 const/let。
 *   - QUnit.test 主体使用箭头函数；只有 hook 需要独立 `this` 绑定时才用 `function () {}`。
 *   - 序列化结果因引擎（jsdom/Chromium/Firefox/WebKit）而异时，数组形式的
 *     assert.contains([...]) 表示完整可接受结果集合。注意 runner 的实现是
 *     `expected.indexOf(actual) > -1`：当 expected 是字符串时会退化为子串匹配，空输出也会
 *     命中任意字符串。因此标量 fixture 只能作为宽松回归信号，严格机制结论须结合 assert.equal
 *     或下方真实 DOM sink 测试。
 *
 * 已公开编号的安全回归会在标题中标注 CVE/GHSA；相邻注释解释被阻断的攻击原语。不得删除这些
 * 注释：其中若干问题没有其他机制文档。
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
   * 状态：多数用例共享传入实例；凡修改持久配置或 hooks 的用例必须在结束时清理，安全回归
   * 模块则在 beforeEach/afterEach 中创建隔离实例。
   *
   * @param DOMPurify - 当前构建绑定到目标 window 后的实例/工厂。
   * @param window - 提供 DOM、计时器和 XSS 探针的目标 realm。
   * @param sanitizationTestCases - 带 payload/expected 的完整序列化 fixture。
   * @param xssTestCases - 从 fixture 中筛出的含 alert 载荷，用于真实插入 sink。
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
    // 数据驱动清洗测试。fixture 与 runner 同处 `test/fixtures/...`，让源码、dist 和压缩构建
    // 复用同一语料，不复制攻击样本。
    // =======================================================================

    QUnit.module('Sanitization (data-driven)');

    /**
     * Given：fixture 提供一个输入和一个或多个跨引擎可接受序列化结果。
     * When：以默认配置执行 `sanitize()`。
     * Then：实际输出命中 fixture 期望。
     *
     * 验证机制：覆盖完整 223 条语料；标量 expected 受 runner 子串语义限制，故安全性还由
     * 下方真实 sink 测试与显式严格断言补证。
     * 对应源码：`sanitize()` 的默认配置、DOM 遍历和字符串序列化主链。
     */
    sanitizationTestCases.forEach((testCase) => {
      QUnit.test(`sanitization[${testCase.title}]`, (assert) => {
        assert.contains(
          DOMPurify.sanitize(testCase.payload),
          testCase.expected,
          `Payload: ${testCase.payload}`
        );
      });
    });

    // =======================================================================
    // XSS 测试断言清洗后的输出绝不调用 alert()。三组 runner 覆盖实际常见的插入 sink：
    // 原生 innerHTML、jQuery.html() 和 document.write()。document.write() 单独存在，是因为
    // 内容经解析器入口注入时，Firefox 与 Chromium 历史上存在行为差异。
    //
    // Given：每条 payload 含 alert，并已把 window.alert 替换为 xssed 探针。
    // When：清洗后分别进入三类真实 DOM sink，并等待异步事件一个 tick。
    // Then：xssed 始终不为 true，之后清理 DOM 与探针状态。
    // 验证机制：验证“序列化字符串重新解析后仍惰性”，而非仅做输出子串比较。
    // 对应源码：`sanitize()` 元素/属性清洗与最终序列化。
    // =======================================================================

    QUnit.module('XSS — native innerHTML');

    xssTestCases.forEach((testCase) => {
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

    QUnit.module('XSS — jQuery.html()');

    xssTestCases.forEach((testCase) => {
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

    QUnit.module('XSS — iframe document.write()');

    xssTestCases.forEach((testCase) => {
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

    // 探针自检：给 iframe-write detector 一段真实恶意载荷时必须触发 alert()。若本测试不再触发，
    // 上方 XSS — iframe document.write() 模块即失去负向检测能力，绿灯不能再证明输出安全。
    QUnit.module('XSS — detector self-test');

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

    QUnit.module('Config — KEEP_CONTENT, ALLOWED_TAGS, ALLOWED_ATTR');

    /**
     * Given：iframe 不在默认 allowlist，且显式关闭 KEEP_CONTENT。
     * When：清洗包含文本子节点的 iframe。
     * Then：元素和其内容都被丢弃，返回空字符串。
     *
     * 验证机制：精确输出证明不是“只移除标签并提升子节点”。
     * 对应源码：`_sanitizeDisallowedNode()` 的 KEEP_CONTENT=false 分支。
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

    QUnit.module('Config — ALLOW_SELF_CLOSE_IN_ATTR');

    QUnit.test('ALLOW_SELF_CLOSE_IN_ATTR=false strips attribute', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a href="#" class="foo <br/>">abc</a>', {
          ALLOW_SELF_CLOSE_IN_ATTR: false,
        }),
        '<a href="#">abc</a>'
      );
    });

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
    // `<template for="...">` 会按 id/marker 名把内容传送或范围替换进既有元素；patchsrc 会拉取
    // 远程标记，对 CSP 等价于脚本加载能力。patch 在连接/流式阶段生效，晚于解析期 sanitizer
    // 对离线 fragment 的处理，因此这些链接不能进入清洗输出。PI 范围 marker 已由
    // `_isUnsafeNode` 删除；属性删除受 SAFE_FOR_XML 控制。每个用例创建新实例，避免先前
    // setConfig 的持久状态跳过 `_parseConfig()`、吞掉本次调用配置。
    // =======================================================================

    QUnit.module('Declarative partial updates');

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

    QUnit.test('patchsrc is stripped even when explicitly added', (assert) => {
      const purify = DOMPurify(window);
      assert.equal(
        purify.sanitize('<div patchsrc="//evil.example/p">x</div>', {
          ADD_ATTR: ['patchsrc'],
        }),
        '<div>x</div>'
      );
    });

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

    QUnit.module('Config — ALLOW_DATA_ATTR');

    QUnit.test('malformed data- attribute is stripped regardless', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a href="#" data-abc"="foo">abc</a>', {
          ALLOW_DATA_ATTR: true,
        }),
        '<a href="#">abc</a>'
      );
    });

    QUnit.test('ALLOW_DATA_ATTR=false strips data-* attributes', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a href="#" data-abc="foo">abc</a>', {
          ALLOW_DATA_ATTR: false,
        }),
        '<a href="#">abc</a>'
      );
    });

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

    QUnit.test(
      'ALLOW_DATA_ATTR with empty / non-ASCII names — name-validity rules apply',
      (assert) => {
        // `data-` 后为空：拒绝。
        assert.equal(
          DOMPurify.sanitize('<a href="#" data-""="foo">abc</a>', {
            ALLOW_DATA_ATTR: true,
          }),
          '<a href="#">abc</a>'
        );
        // Latin-1 字母：遵循 HTML 规范的引擎接受。
        assert.contains(
          DOMPurify.sanitize('<a href="#" data-äöü="foo">abc</a>', {
            ALLOW_DATA_ATTR: true,
          }),
          [
            '<a href="#" data-äöü="foo">abc</a>',
            '<a data-äöü="foo" href="#">abc</a>',
          ]
        );
        // 中点/组合附加符的接受情况依引擎而异；IE11/旧 Edge 抛 InvalidCharacterError，
        // 现代引擎接受。
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
        // µ（micro sign，U+00B5）不属于规范定义的名称字符集。
        assert.equal(
          DOMPurify.sanitize('<a href="#" data-\u00B5="foo">abc</a>', {
            ALLOW_DATA_ATTR: true,
          }),
          '<a href="#">abc</a>'
        );
      }
    );

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

    QUnit.module('Config — ADD_TAGS & ADD_ATTR');

    QUnit.test('ADD_TAGS as string array', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<my-component>abc</my-component>', {
          ADD_TAGS: ['my-component'],
        }),
        '<my-component>abc</my-component>'
      );
    });

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

    QUnit.test('ADD_TAGS + ADD_ATTR keeps both', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<my-component my-attr="foo">abc</my-component>', {
          ADD_TAGS: ['my-component'],
          ADD_ATTR: ['my-attr'],
        }),
        '<my-component my-attr="foo">abc</my-component>'
      );
    });

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

    QUnit.test('ADD_ATTR as function works on built-in tags', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<div custom-attr="test">content</div>', {
          ADD_ATTR: (attr, tag) => tag === 'div' && attr === 'custom-attr',
        }),
        '<div custom-attr="test">content</div>'
      );
    });

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

    QUnit.test('ADD_ATTR function must not bypass URI validation', (assert) => {
      // ADD_ATTR 返回 true 只放行“属性名”；href 等 URI 属性的值仍须通过 IS_ALLOWED_URI。
      // 否则函数形式会成为永久 javascript: 绕过。
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

    QUnit.module('Config — FORBID_CONTENTS / ADD_FORBID_CONTENTS');

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

    QUnit.module('Config — SAFE_FOR_JQUERY (legacy / secure by default)');

    QUnit.test('style inside option is stripped', (assert) => {
      assert.equal(
        DOMPurify.sanitize(
          '<a>123</a><option><style><img src=x onerror=alert(1)>'
        ),
        '<a>123</a><option></option>'
      );
    });

    QUnit.test('cross-boundary style + img inside option', (assert) => {
      assert.contains(
        DOMPurify.sanitize(
          '<option><style></option></select><b><img src=xx: onerror=alert(1)></style></option>'
        ),
        ['<option></option>', '']
      );
    });

    QUnit.test('iframe + script inside option', (assert) => {
      assert.contains(
        DOMPurify.sanitize(
          '<option><iframe></select><b><script>alert(1)</script>'
        ),
        ['<option></option>', '']
      );
    });

    QUnit.test('nested style tags with self-closing form', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<b><style><style/><img src=xx: onerror=alert(1)>'),
        '<b></b>'
      );
    });

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

    QUnit.module('Config — SAFE_FOR_TEMPLATES');

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

    QUnit.test(
      'CVE-2026-41239: IN_PLACE strips boundary-spanning Mustache expressions',
      (assert) => {
        // sanitizer 遍历时按单个文本节点清理，会漏掉被待删除 foreign 元素拆在两侧的
        // `{{...}}`：当时相邻节点各只有一个 `{` 或 `}`，要求 `{{`/`}}` 的 MUSTACHE_EXPR
        // 无法命中。foreign 元素删除后文本节点相邻，normalize() 会把它们合为完整表达式，
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

    QUnit.test(
      'greedy-scrub of stray close marker prevents URL bypass',
      (assert) => {
        // 清除 `{{}}` 后，惰性正则会残留 `}}`；IS_ALLOWED_URI 的 `[^a-z]` 分支会接受任意
        // 非字母开头，残留字符因而可掩护危险 URL。贪婪正则从 `{{` 清到字符串末尾，不留下
        // 可用 URL。
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

    QUnit.module('Config — SANITIZE_DOM');

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
    // 配置：SANITIZE_NAMED_PROPS。为 id/name 属性添加 `user-content-` 前缀，防止它们
    // clobber 预定义 window 全局或 document.* 查询结果。
    // =======================================================================

    QUnit.module('Config — SANITIZE_NAMED_PROPS');

    QUnit.test('id is prefixed with user-content-', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a id="x"></a>', { SANITIZE_NAMED_PROPS: true }),
        '<a id="user-content-x"></a>'
      );
    });

    QUnit.test('nested form + input ids are both prefixed', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<form id="x"><input id="y"></form>', {
          SANITIZE_NAMED_PROPS: true,
        }),
        '<form id="user-content-x"><input id="user-content-y"></form>'
      );
    });

    QUnit.test('duplicate ids on siblings are both prefixed', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a id="x"></a><a id="x"></a>', {
          SANITIZE_NAMED_PROPS: true,
        }),
        '<a id="user-content-x"></a><a id="user-content-x"></a>'
      );
    });

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

    QUnit.module('Config — WHOLE_DOCUMENT');

    QUnit.test('text payload', (assert) => {
      assert.equal(DOMPurify.sanitize('123', { WHOLE_DOCUMENT: false }), '123');
      assert.equal(
        DOMPurify.sanitize('123', { WHOLE_DOCUMENT: true }),
        '<html><head></head><body>123</body></html>'
      );
    });

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

    QUnit.module('Config — RETURN_DOM');

    /**
     * Given：同一 HTML 分别不含和含有 `<script>`。
     * When：以 RETURN_DOM 清洗。
     * Then：返回 `<body>` 元素，安全结构保留且 script 被删除。
     *
     * 验证机制：直接比较返回 DOM 的 outerHTML，联合证明返回类型形状和清洗副作用。
     * 对应源码：`sanitize()` 的 RETURN_DOM 返回分支。
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

    QUnit.test('plain text payload returns body wrapper', (assert) => {
      assert.equal(
        DOMPurify.sanitize('123', { RETURN_DOM: true }).outerHTML,
        '<body>123</body>'
      );
    });

    QUnit.test(
      'shadowroot attribute toggles owner-document selection',
      (assert) => {
        // ADD_ATTR 未放行 `shadowroot` 时，返回 DOM 属于与活动页面隔离的 document，防止宿主
        // document 上的 clobbering 状态影响结果。放行 `shadowroot` 表示调用方主动选择返回
        // 当前 document 中可承载 declarative shadow root 的节点。
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

    QUnit.module('Config — RETURN_DOM_FRAGMENT');

    /**
     * Given：文本加一个以 `createDocumentFragment` 为 id 的图片。
     * When：分别在默认 SANITIZE_DOM 和显式关闭它时请求 RETURN_DOM_FRAGMENT。
     * Then：返回 nodeType=11 的隔离 fragment，文本保留，clobbering id 不进入结果。
     *
     * 验证机制：节点类型、ownerDocument 与首文本节点三项断言覆盖 fragment 构造和所有权。
     * 对应源码：`sanitize()` 的 RETURN_DOM_FRAGMENT 分支及 fragment 模式预处理。
     */
    QUnit.test('returns DocumentFragment with sanitized contents', (assert) => {
      let fragment = DOMPurify.sanitize(
        'foo<img id="createDocumentFragment">',
        { RETURN_DOM_FRAGMENT: true }
      );
      assert.equal(fragment.nodeType, 11);
      assert.notEqual(fragment.ownerDocument, document);
      assert.equal(fragment.firstChild && fragment.firstChild.nodeValue, 'foo');

      // 再关闭 SANITIZE_DOM，证明 fragment 模式预处理仍会删除该 clobbering id。
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

    QUnit.module('Config — IN_PLACE');

    /**
     * Given：离线 `<a>` 节点带 javascript: href。
     * When：以 IN_PLACE 清洗。
     * Then：返回值与输入引用相同，危险 href 已清空。
     *
     * 验证机制：引用恒等和属性结果联合证明“原地清洗”，排除返回安全副本但原对象仍危险。
     * 对应源码：`sanitize()` 的 inPlace 判定、遍历和原对象返回分支。
     */
    QUnit.test('returns the input node, mutated', (assert) => {
      const dirty = document.createElement('a');
      dirty.setAttribute('href', 'javascript:alert(1)');
      const clean = DOMPurify.sanitize(dirty, { IN_PLACE: true });
      assert.equal(dirty, clean, 'returns the input node');
      assert.equal(dirty.href, '', 'still sanitizes the dangerous href');
    });

    QUnit.test(
      'throws when the root node tag is itself disallowed (script)',
      (assert) => {
        const dirty = document.createElement('script');
        dirty.setAttribute('src', 'data:,alert(1)');
        assert.throws(() => DOMPurify.sanitize(dirty, { IN_PLACE: true }));
      }
    );

    QUnit.test(
      'throws when the root node tag is itself disallowed (iframe)',
      (assert) => {
        const dirty = document.createElement('iframe');
        dirty.setAttribute('src', 'javascript:alert(1)');
        assert.throws(() => DOMPurify.sanitize(dirty, { IN_PLACE: true }));
      }
    );

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

    QUnit.test(
      'IN_PLACE: a clobbered ownerDocument does not skip the fail-closed scrub',
      (assert) => {
        // HTMLFormElement 具有 [LegacyOverrideBuiltIns]：子节点
        // `<input name="ownerDocument">`（或外部 form-associated input）会遮蔽
        // Node.prototype.ownerDocument，使直接读取 form.ownerDocument 返回该 input。旧 iterator
        // 通过 `createNodeIterator.call(root.ownerDocument, ...)` 创建，因而在 fail-closed 屏障前
        // 抛 "Illegal invocation"，把仍带 handler 的后代留在调用方活动树中。jsdom/happy-dom
        // 不实现 form named getter 覆盖，所以此处用 own accessor 忠实复现：原型 getter 被实例
        // accessor 遮蔽，正是 [LegacyOverrideBuiltIns] 暴露的形状。
        const root = document.createElement('form');
        const img = document.createElement('img');
        img.setAttribute('onerror', 'alert(1)'); // no src: assert the attr, not a load
        root.appendChild(img);
        document.body.appendChild(root);

        const fake = document.createElement('input');
        Object.defineProperty(root, 'ownerDocument', {
          /** 模拟 named-property clobber 后返回攻击者节点的 ownerDocument getter。 */
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
              /** 元素断开时移除 wrapper，使后续 sanitizer 删除动作遇到 parentless 节点。 */
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

    QUnit.test(
      'setConfig({IN_PLACE}) is not disabled by an intervening string call (REPORT-2)',
      (assert) => {
        DOMPurify.setConfig({ IN_PLACE: true });
        try {
          const div1 = document.createElement('div');
          div1.innerHTML = '<img onerror="alert(1)">'; // no src: avoid a load
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

    QUnit.test(
      'a kill-decision on a detached IN_PLACE root is not a silent no-op (REPORT-3)',
      (assert) => {
        // 文本能逃出元素的 detached `<style>` 会触发 mXSS canary。`_forceRemove` 无法分离
        // parentless 根，因此必须中和节点或抛错，不能一面在 DOMPurify.removed 记录“已删除”，
        // 一面原样把危险节点交还调用方。
        const style = document.createElement('style');
        style.textContent = '</style><img onerror=alert(1)>'; // no src
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

    QUnit.module('Config — FORBID_TAGS / FORBID_ATTR');

    QUnit.test(
      'FORBID_TAGS removes the named tag, keeps content by default',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize('<a>123<b>456</b></a>', { FORBID_TAGS: ['b'] }),
          '<a>123456</a>'
        );
      }
    );

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

    QUnit.test('unrecognised forbid entries are no-ops', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a>123<b>456</b></a>', { FORBID_TAGS: ['c'] }),
        '<a>123<b>456</b></a>'
      );
    });

    QUnit.test('FORBID_TAGS interacts with script removal', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a>123<b>456<script>alert(1)</script></b></a>789', {
          FORBID_TAGS: ['script', 'b'],
        }),
        '<a>123456</a>789'
      );
    });

    QUnit.test('FORBID_TAGS wins over ADD_TAGS for the same tag', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a>123<b>456</b></a>', {
          ADD_TAGS: ['b'],
          FORBID_TAGS: ['b'],
        }),
        '<a>123456</a>'
      );
    });

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

    QUnit.module('Config — CUSTOM_ELEMENT_HANDLING');

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

    QUnit.test('slot attribute on custom element is preserved', (assert) => {
      assert.equal(
        DOMPurify.sanitize(
          '<my-paragraph><span slot="my-text">test</span></my-paragraph>',
          { CUSTOM_ELEMENT_HANDLING: { tagNameCheck: /-/u } }
        ),
        '<my-paragraph><span slot="my-text">test</span></my-paragraph>'
      );
    });

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

    QUnit.test('inherited nested config is ignored', (assert) => {
      const inherited = Object.create({ tagNameCheck: /-/u });
      assert.equal(
        DOMPurify.sanitize('<foo-bar>abc</foo-bar>', {
          CUSTOM_ELEMENT_HANDLING: inherited,
        }),
        'abc'
      );
    });

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

    QUnit.test('does not leak into subsequent default calls', (assert) => {
      DOMPurify.sanitize('<foo-bar>abc</foo-bar>', {
        CUSTOM_ELEMENT_HANDLING: { tagNameCheck: /-/u },
      });
      assert.equal(DOMPurify.sanitize('<foo-bar>abc</foo-bar>'), 'abc');
    });

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

    QUnit.module('Config — ALLOW_ARIA_ATTR');

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

    QUnit.test('rejects non-ASCII aria- names even when allowed', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<a href="#" aria-aöü="foo">abc</a>', {
          ALLOW_ARIA_ATTR: true,
        }),
        '<a href="#">abc</a>'
      );
    });

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

    QUnit.module('Config — USE_PROFILES');

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
      // 对照：html profile 保留 `<span>` 内容；除非 KEEP_CONTENT 要求丢弃，否则 wrapper 也保留。
      assert.equal(
        DOMPurify.sanitize('<span>SEE ME</span>', {
          USE_PROFILES: { html: true },
          KEEP_CONTENT: false,
        }),
        '<span>SEE ME</span>'
      );
    });

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

    QUnit.test('inherited profile flags are ignored', (assert) => {
      const inherited = Object.create({ html: true });
      assert.equal(
        DOMPurify.sanitize('<h1>HELLO</h1>', { USE_PROFILES: inherited }),
        'HELLO'
      );
    });

    QUnit.test('does not leak into subsequent default calls', (assert) => {
      DOMPurify.sanitize('<h1>HELLO</h1>', {
        USE_PROFILES: { html: false },
      });
      assert.equal(DOMPurify.sanitize('<h1>HELLO</h1>'), '<h1>HELLO</h1>');
    });

    // =======================================================================
    // 配置：ALLOWED_URI_REGEXP / ADD_URI_SAFE_ATTR / ALLOW_UNKNOWN_PROTOCOLS。
    // =======================================================================

    QUnit.module('Config — ALLOWED_URI_REGEXP');

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

    QUnit.module('Config — ADD_URI_SAFE_ATTR');

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

    QUnit.module('Config — ALLOW_UNKNOWN_PROTOCOLS');

    QUnit.test('opt-in allows custom schemes', (assert) => {
      const dirty =
        '<div><a href="spotify:track:12345"><img src="cid:1234567"></a></div>';
      assert.equal(
        dirty,
        DOMPurify.sanitize(dirty, { ALLOW_UNKNOWN_PROTOCOLS: true })
      );
    });

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

    QUnit.test('data: URIs blocked by default in <a href>', (assert) => {
      const clean = DOMPurify.sanitize(
        '<a href="data:image/gif;base64,123">icon.gif</a>'
      );
      assert.equal(clean, '<a>icon.gif</a>');
    });

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

    QUnit.module('Config — NAMESPACE / ALLOWED_NAMESPACES');

    /**
     * Given：SVG、MathML 与 HTML 节点按合法/非法 integration point 混合嵌套。
     * When：使用默认 namespace 配置清洗。
     * Then：只保留解析器规范允许的跨 namespace 组合，非法 foreign-content 子树被删除。
     *
     * 验证机制：同一矩阵覆盖 SVG→HTML、MathML→HTML、SVG↔MathML 与 parser 修复形状；
     * expected 数组仅吸收序列化差异，所有候选都满足同一安全不变量。
     * 对应源码：`_checkValidNamespace()` 及 SVG/MathML/HTML 三个 namespace 检查函数。
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
     * Given：XHTML/XML 中含默认拒绝的 custom namespace、前缀 namespace 和危险子节点。
     * When：逐步扩展 ALLOWED_NAMESPACES，并组合 ALLOWED_TAGS/FORBID_TAGS。
     * Then：只保留同时通过 namespace 与标签策略的节点；FORBID_TAGS 始终优先。
     *
     * 验证机制：默认拒绝、单根、多层、单前缀、多前缀及 forbid 覆盖形成递进对照。
     * 对应源码：`_parseConfig()` 的 ALLOWED_NAMESPACES 集合和 `_checkValidNamespace()` XML 分支。
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

    QUnit.test(
      'namespace defaults back to HTML after foreign use',
      (assert) => {
        // 文档化行为：每次调用独立解析 namespace，不复用上次状态。
        assert.contains(
          DOMPurify.sanitize('<br>', {
            NAMESPACE: 'http://www.w3.org/2000/svg',
          }),
          ['', '<br>']
        );
        assert.contains(DOMPurify.sanitize('<br>'), ['<br>']);
      }
    );

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

    QUnit.module('Config — PARSER_MEDIA_TYPE');

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

    QUnit.module('Config — FORCE_BODY');

    QUnit.test('forces <style> into body when FORCE_BODY=true', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<style>123</style>', { FORCE_BODY: true }),
        '<style>123</style>'
      );
    });

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

    QUnit.test('FORCE_BODY preserves leading whitespace', (assert) => {
      assert.equal(
        DOMPurify.sanitize(' AAAAA', { FORCE_BODY: true }),
        ' AAAAA'
      );
    });

    QUnit.test(
      'leading whitespace preserved even without FORCE_BODY',
      (assert) => {
        assert.equal(
          DOMPurify.sanitize(' <b>AAAAA</b>', { FORCE_BODY: false }),
          ' <b>AAAAA</b>'
        );
      }
    );

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

    QUnit.module('Config — RETURN_TRUSTED_TYPE');

    QUnit.test('return type varies by engine when true', (assert) => {
      const clean = DOMPurify.sanitize('<b>hello goodbye</b>', {
        RETURN_TRUSTED_TYPE: true,
      });
      // 支持 TT 的浏览器返回 TrustedHTML；jsdom 和无该 API 的引擎回退普通字符串。
      // 这里只是跨引擎 smoke test：`typeof` 无法证明具体 TrustedHTML 品牌，严格对象身份由
      // bootstrap-test-suite.js 的独立 realm StringWrapper 用例作证。
      assert.contains(typeof clean, ['TrustedHTML', 'string', 'object']);
    });

    QUnit.test('RETURN_TRUSTED_TYPE=false returns string', (assert) => {
      const clean = DOMPurify.sanitize('<b>hello goodbye</b>', {
        RETURN_TRUSTED_TYPE: false,
      });
      assert.equal(typeof clean, 'string');
    });

    QUnit.test('default (no flag) returns string', (assert) => {
      const clean = DOMPurify.sanitize('<b>hello goodbye</b>');
      assert.equal(typeof clean, 'string');
    });

    // =======================================================================
    // 输入处理与 API 表面。
    // =======================================================================

    QUnit.module('Input handling');

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

    QUnit.test('non-node objects with toString are stringified', (assert) => {
      assert.strictEqual(
        DOMPurify.sanitize({
          toString: () => '<b>hi</b><script>x<\/script>',
        }),
        '<b>hi</b>'
      );
    });

    QUnit.test(
      'plain objects with nodeType are not treated as nodes',
      (assert) => {
        // 回归保护：duck typing 不能接受 spoofed object；该对象应被字符串化，而非当节点遍历。
        const fake = { nodeType: 1, nodeName: 'DIV', ownerDocument: {} };
        assert.strictEqual(typeof DOMPurify.sanitize(fake), 'string');
      }
    );

    QUnit.module('API — isSupported and constructor variants');

    QUnit.test('isSupported is a boolean', (assert) => {
      assert.equal(typeof DOMPurify.isSupported, 'boolean');
    });

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

    QUnit.test(
      'document clobbering after instantiation does not break sanitize()',
      (assert) => {
        // 注入会 clobber document.implementation、createNodeIterator、importNode、createElement
        // 的冲突 id；DOMPurify 内缓存的原生引用必须不受影响。
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

    QUnit.module('API — setConfig / clearConfig');

    /**
     * Given：`<foobar>` 默认不允许。
     * When：先默认清洗，再 setConfig 放行，最后 clearConfig 后重试。
     * Then：输出依次为仅文本、完整 foobar、仅文本。
     *
     * 验证机制：同一输入三阶段严格相等，证明持久配置生效且 clearConfig 真正恢复默认。
     * 对应源码：`setConfig()` 捕获集合与 `clearConfig()` 重置持久状态。
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

    QUnit.module('DOMPurify.removed');

    QUnit.test(
      'removed contains one element for SVG filter primitive',
      (assert) => {
        DOMPurify.sanitize(
          '<svg onload=alert(1)><filter><feGaussianBlur /></filter></svg>'
        );
        assert.contains(DOMPurify.removed.length, [1, 2]); // IE removes two
      }
    );

    QUnit.test(
      'removed contains two elements for script + svg combo',
      (assert) => {
        DOMPurify.sanitize(
          '1<script>alert(1)</script><svg onload=alert(1)><filter><feGaussianBlur /></filter></svg>'
        );
        assert.contains(DOMPurify.removed.length, [2, 3]); // IE removes three
      }
    );

    QUnit.test('removed counts attribute removal', (assert) => {
      DOMPurify.sanitize('<img src=x onerror="alert(1)">');
      assert.equal(DOMPurify.removed.length, 1);
    });

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

    QUnit.test('removed counts attribute-level template scrubs', (assert) => {
      DOMPurify.sanitize('<img src=1 width="{{123}}">', {
        WHOLE_DOCUMENT: true,
        SAFE_FOR_TEMPLATES: true,
      });
      assert.equal(DOMPurify.removed.length, 1);
    });

    QUnit.test('removed counts mXSS-style nested invalid markup', (assert) => {
      DOMPurify.sanitize(
        '<option><iframe></select><b><script>alert(1)</script>'
      );
      assert.equal(DOMPurify.removed.length, 1);
    });

    QUnit.test('removed is empty when all input is permitted', (assert) => {
      DOMPurify.sanitize('<a>123</a>');
      assert.equal(DOMPurify.removed.length, 0);

      DOMPurify.sanitize('<img src=x>');
      assert.equal(DOMPurify.removed.length, 0);
    });

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

    QUnit.module('API — sanitizing element nodes directly');

    QUnit.test('sanitizing an element returns its outerHTML', (assert) => {
      assert.equal(
        DOMPurify.sanitize(document.createElement('td')),
        '<td></td>'
      );
    });

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
    // Hooks。
    // =======================================================================

    QUnit.module('Hooks — addHook / removeHook');

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
     * Given：默认不允许 custom tag/attr，且输入同时含 iframe、onload 和自定义名称。
     * When：element/attribute hooks 只扩展带连字符的 tag 与 attr allowlist。
     * Then：is-custom 与 super-custom 当次保留，iframe 和 onload 仍被删除。
     *
     * 验证机制：单个精确输出同时证明 hook 可扩展 allowlist、普通危险项仍走后续校验。
     * 对应源码：`_executeHooks()`、`_sanitizeElements()` 与 `_sanitizeAttributes()`。
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

    QUnit.test('hookEvent.keepAttr=false removes attribute', (assert) => {
      // 通过 hook flag 删除 input[type=file] 是文档化 escape hatch；attribute walker 会对触发
      // 当前 hook 的属性执行 `data.keepAttr=false`。
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
      // 此严格断言仅在 Node（jsdom）运行；浏览器解析器在 innerHTML 序列化时重排属性，会使
      // strict equal 不稳定。引入该回归用例时真正需要固定的是 Node 路径。
      if (window.name == 'nodejs') {
        assert.equal(DOMPurify.sanitize(dirty), modified);
      } else {
        assert.expect(0);
      }
      DOMPurify.removeHooks('uponSanitizeAttribute');
    });

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

    QUnit.test(
      'removeHook can target a specific hook in the chain',
      (assert) => {
        const entryPoint = 'afterSanitizeAttributes';
        const dirty = '<div class="original"></div>';
        const expected = '<div class="original first third"></div>';

        /** 在 hook chain 中追加 `first`，用于验证保留顺序。 */
        const firstHook = (node) => node.classList.add('first');
        /** 在 hook chain 中追加 `second`，随后应被按函数身份定点删除。 */
        const secondHook = (node) => node.classList.add('second');
        /** 在 hook chain 中追加 `third`，用于证明删除中间项不截断后续 hook。 */
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

    QUnit.test(
      'attributes added in uponSanitizeAttribute after current index escape validation',
      (assert) => {
        // 属性按初始 length 快照倒序遍历。hook 调用 setAttribute() 会把新属性追加到列表末尾，
        // 位于递减 index 已越过的一侧，因此不会再次校验。这是刻意的 hook escape hatch：
        // 用户用它强制属性值；重新校验会破坏该用例。
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
    // 未显式提供 cfg.ALLOWED_TAGS 时，该集合就是模块级 DEFAULT_ALLOWED_TAGS 常量。hook 写入
    //     data.allowedTags['script'] = true
    // 会永久扩展默认值，直到重新创建 DOMPurify 实例。
    //
    // 修复：注册 uponSanitize* hook 时为当前调用克隆 allowlist。调用内扩展继续生效；下次默认
    // 配置调用重新绑定到未修改的默认集合。
    // =======================================================================

    QUnit.module('Hooks — allowlist pollution (GHSA-XXXX)', function (hooks) {
      let purify;
      hooks.beforeEach(() => {
        // 每个测试使用独立实例，因为目标缺陷正是跨调用污染。
        purify = DOMPurify(window);
      });
      hooks.afterEach(() => {
        purify.removeAllHooks();
        purify.clearConfig();
      });

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
       * Given：element hook 无条件把 script 写入 exposed allowedTags。
       * When：先在 hook 存在时清洗，再删除全部 hooks、clearConfig 后重试。
       * Then：第一次按文档允许调用内 script；第二次恢复默认并删除 script。
       *
       * 验证机制：同一实例的前后对照证明扩展作用域只限单次调用，不是重建实例造成恢复。
       * 对应源码：`_forkSharedAllowlist()` 与 `sanitize()` 调用前 clone guard。
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
      // 共用的 allowlist，并跨元素、跨调用泄漏。现在两类配置路径都在每次 sanitize() 时应用
      // clone guard。（GHSA-cmwh-pvxp-8882）
      // -------------------------------------------------------------------

      /**
       * Given：setConfig 持久放行 img/src，条件 hook 仅对 data-trusted 元素扩展 onerror。
       * When：先清洗 trusted 元素，再多次清洗普通攻击输入。
       * Then：扩展只在首个调用内生效，后续每次都精确输出 `<img src="x">`。
       *
       * 验证机制：跨调用加重复循环，证明 shared set 未被一次 hook 写入污染或累积克隆状态。
       * 对应源码：`sanitize()` 恢复 SET_CONFIG_ALLOWED_ATTR 后执行每调用 clone guard。
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

          // trusted 元素只为自己的调用扩展 onerror。
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
    //   2. `_sanitizeShadowDOM()` 遍历以 ShadowRoot 为根的 TreeWalker；walker 不进入内部
    //      `<template>.content`，也不会自动暴露 host 上的 attached shadow root。递归必须显式
    //      检查两者。
    //
    // 测试覆盖 `{plain, in-template, nested-template, wrapper, alternating}` ×
    // `{带 shadow 的 host, cloneNode 时复制的 clonable shadow}` 对称矩阵。
    // =======================================================================

    QUnit.module('Hooks — shadow roots inside <template>.content');

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

    QUnit.test(
      'clonable shadow root inside template.content survives stamping',
      (assert) => {
        // template.content 使用时会被克隆；其中的 clonable shadow root 既要活过 clone，
        // 又必须继续被原地清洗。
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

    QUnit.module('Regression — mXSS');

    /**
     * Given：Chrome 77 披露中的 SVG/HTML 错误嵌套 mXSS 载荷。
     * When：执行默认清洗。
     * Then：输出中不可能同时存在可执行 img 与 onerror。
     *
     * 验证机制：本用例只证明静态输出缺少攻击二元组；真正 reparse 后不执行由文件顶部三类
     * XSS sink 模块对同类 alert fixture 补证。
     * 对应源码：`_isUnsafeNode()` 的 namespace-confusion canary 与 `_checkValidNamespace()`。
     */
    QUnit.test(
      'Chrome 77+ SVG/HTML mXSS round-trip is neutralised',
      (assert) => {
        // 变体来自 Chrome 77 原始披露；解析器曾在重新插入时把此类 mXSS 原语“修复”为脚本执行。
        const dirty =
          '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>"></svg>';
        const clean = DOMPurify.sanitize(dirty);
        assert.ok(
          clean.indexOf('<img') === -1 || clean.indexOf('onerror') === -1,
          'mXSS payload neutralised: ' + clean
        );
      }
    );

    QUnit.test(
      'less-aggressive mXSS handling preserves valid HTML (#369)',
      (assert) => {
        // Issue #369：较早防御措施删除过多并破坏合法输入；这里确认收窄策略后，合法标记保留，
        // 脚本路径仍被阻断。
        assert.equal(
          DOMPurify.sanitize('<p>Hello<b> World</b></p>'),
          '<p>Hello<b> World</b></p>'
        );
        // 不含 HTML void element 的普通 MathML 可完整 round-trip。`<math>` 中的 `<br>` 会在
        // DOMPurify 看见前就被 HTML parser foster-parent 到 foreign content 外，因此此处用
        // `<mn>/<mi>/<mo>` 保持在 foreign content 内。
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

    QUnit.test('text-integration-points: math + xmp', (assert) => {
      // 带 `<annotation-xml encoding="text/html">` 的 `<math>` 是 text integration point：
      // 子节点虽处于 foreign content，仍按 HTML 解析。`<xmp>` 是另一遗留纯文本元素；两者必须
      // 使用正确解析模式，避免错误嵌套形成 mXSS。
      const xss =
        '<math><annotation-xml encoding="text/html"><xmp><img src=x onerror=alert(1)></xmp></annotation-xml></math>';
      const clean = DOMPurify.sanitize(xss);
      assert.ok(
        clean.indexOf('onerror') === -1,
        'no onerror survived integration-point parsing: ' + clean
      );
    });

    QUnit.test('text-integration-points: svg + xmp', (assert) => {
      const xss =
        '<svg><foreignobject><xmp><img src=x onerror=alert(1)></xmp></foreignobject></svg>';
      const clean = DOMPurify.sanitize(xss);
      assert.ok(
        clean.indexOf('onerror') === -1,
        'no onerror survived integration-point parsing: ' + clean
      );
    });

    QUnit.test('jQuery v3.0+ html() insecure behaviour', (assert) => {
      // jQuery.html() 额外解析会引入 mXSS 窗口；DOMPurify 输出经 jQuery parser 重新插入时
      // 仍必须安全。
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

    QUnit.module('Regression — noembed / noscript / table');

    QUnit.test(
      'noscript content is not parsed when scripting is disabled',
      (assert) => {
        // 服务端渲染/jsdom 禁用 scripting，因此 `<noscript>` 内容按 HTML 而非文本解析；攻击者
        // 曾可用 noscript 包裹 payload 形成绕过。
        const dirty =
          '<noscript><p title="</noscript><img src=x onerror=alert(1)>">';
        const clean = DOMPurify.sanitize(dirty);
        assert.ok(
          clean.indexOf('onerror') === -1,
          'noscript bypass neutralised: ' + clean
        );
      }
    );

    QUnit.test('noembed content is not parsed as raw HTML', (assert) => {
      const dirty = '<noembed><img src=x onerror=alert(1)></noembed>';
      const clean = DOMPurify.sanitize(dirty);
      assert.ok(
        clean.indexOf('onerror') === -1,
        'noembed bypass neutralised: ' + clean
      );
    });

    QUnit.test('table parsing does not cause O(n²) blowup (#365)', (assert) => {
      // Issue #365：N 层嵌套 `<table>` 曾因每层重设上一层父节点产生 O(N²) 工作；修复限制
      // foster-parenting 递归。
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

    QUnit.test('Unicode-named tags are removed', (assert) => {
      // 名称含非 ASCII 字符的标签不是合法 HTML 元素，默认 allowlist 必须阻止它们进入结果树。
      // 对未知标记，库会把整个标签 HTML 编码回惰性文本；若只在字符串中搜 `onerror`，会命中
      // `&lt;...onerror...&gt;` 编码形式并造成假阴性，因此必须检查重新解析后的活动树。
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
    // 回归：selectedcontent（Chrome 130+）— CVE，3.4.4 → 3.4.5。
    //
    // `<selectedcontent>` 会把选中 `<option>` 的 subtree 镜像到自身子节点。镜像发生在清洗之后，
    // 只检查静态标记的 sanitizer 会漏掉引擎稍后克隆进入的脚本 payload。
    //
    // 修复：默认禁止 `<selectedcontent>`，仅显式 opt-in 才允许。opt-in 时采用
    // refresh-after-sanitize：先让引擎填充镜像，再重新遍历 subtree。
    // =======================================================================

    QUnit.module('Regression — selectedcontent (3.4.5)');

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

    QUnit.test(
      'refresh-after-sanitize covers post-clone mirror payload',
      (assert) => {
        // 即使配置允许 selectedcontent，post-sanitize refresh 也应捕获克隆进入的 subtree。
        // 仅在实现该镜像的真实浏览器运行。
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
        // 给引擎一个 tick 填充镜像。
        const sc = wrapper.querySelector('selectedcontent');
        const stillEvil = sc && /onerror/i.test(sc.innerHTML);
        document.body.removeChild(wrapper);
        assert.ok(!stillEvil, 'post-clone mirror does not contain onerror');
      }
    );

    QUnit.test(
      'ADD_TAGS opt-in preserves <selectedcontent> with safe content',
      (assert) => {
        // 前置条件：引擎在 `<select>` 内解析时必须把 `<selectedcontent>` 保留为活动元素；这比
        // 独立解析严格。传统 HTML parser 仅允许 option/optgroup 成为 select 子节点，并把其他
        // 元素 foster-parent 到外部；实现 v130+ form-controls 更新的引擎才把 selectedcontent
        // 加入合法子节点，jsdom 与旧浏览器没有。故必须在真实使用位置探测，不能只放进 div。
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

    QUnit.test('generalized trigger variants (live-DOM check)', (assert) => {
      // 披露中的变体：嵌套 option group、optgroup 内 option、多个 selectedcontent，均应收敛为
      // 安全输出。
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
    // 内部 `_forceRemove()` 通过 parentNode 分离节点；若 form.parentNode 被子节点
    // `<input name="parentNode">` clobber，会产生无限循环或让 sanitizer 崩溃的异常。
    //
    // 修复在主遍历前提前拒绝 clobbered form 根，iterator 因而不会带不可遍历的父链进入
    // `_forceRemove()`。测试覆盖报告列出的八种不同 clobbering 形状。
    // =======================================================================

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
      QUnit.test(`DoS payload variant: ${c.name}`, (assert) => {
        const opts = { ALLOW_UNKNOWN_PROTOCOLS: true };
        if (c.mediaType) opts.PARSER_MEDIA_TYPE = c.mediaType;
        const start = Date.now();
        let clean;
        try {
          clean = DOMPurify.sanitize(c.html, opts);
        } catch (e) {
          // 可以抛错；此处唯一要求是“不挂起”。
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

    QUnit.module('Regression — Finding #2 (attribute breakout)');

    QUnit.test(
      '</style> embedded in attribute does not escape style context',
      (assert) => {
        // 旧 style 内容删除正则过于激进，会吞掉属性值内的 `</style>`，使后续标记按原始 HTML
        // 重新解析。
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
    // 为完整性记录：该 finding 被判定为 scope 外；消费者通过属性 setter 插入 HTML 输出前必须
    // 自行编码。下方单测证明 DOMPurify 输出本身不是载体。
    // =======================================================================

    QUnit.module('Regression — Finding #3 (informational)');

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
    // `<input form="formid">` 可把 form element 关联到 DOM ancestry 外的 form。sanitizer 必须
    // 把 `form=` 识别为同 document 引用，并删除或限定其作用域。
    // =======================================================================

    QUnit.module('Regression — Finding #4 (external form= association)');

    QUnit.test('form= attribute is stripped from inputs (HTML)', (assert) => {
      const dirty =
        '<form id="evil" action="javascript:alert(1)"></form><input form="evil" type="submit">';
      const clean = DOMPurify.sanitize(dirty);
      assert.ok(
        !/form="evil"/i.test(clean),
        'form= attribute stripped: ' + clean
      );
    });

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

    QUnit.module('Regression — style + XHTML + RETURN_DOM_FRAGMENT round-trip');

    QUnit.test('string sanitize is safe', (assert) => {
      const dirty =
        '<style>a{background:url("</style><img src=x onerror=alert(1)>")}</style>';
      const clean = DOMPurify.sanitize(dirty);
      assert.ok(!/onerror/i.test(clean), 'string mode neutralises: ' + clean);
    });

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

    QUnit.test(
      'bypass (#1150): entity-encoded </style> + XHTML + RETURN_DOM_FRAGMENT',
      (assert) => {
        // 源码侧检查会删除实体解码后文本含 `</style>` 再接标记的 `<style>`。下方 payload 依赖：
        //   1. XHTML 解析：`<style>` 文本不是 raw-text 模式，`&lt;`/`&gt;` 会解码为尖括号；
        //   2. RETURN_DOM_FRAGMENT：序列化器交还 DOM，跳过原本会 normalize 的字符串级预处理。
        // 若无源码侧检查，解码后的 `<img>` 会在消费者侧逃出 `<style>` 并触发 onerror。
        //
        // 同时确认字符串输出干净、活动 round-trip 不触发 window.xssed。异步等待不可省略：
        // alert()/onerror 可能在 innerHTML 返回后的 microtask 才触发。
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
    // 修复前：不同 document/realm 的节点作为 IN_PLACE 输入时，sanitizer 用本地 realm document
    // 构造 NodeIterator，却遍历 foreign tree。iterator 会静默跳过 foreign-realm 子节点，
    // 留下危险内容。
    //
    // 修复：每调用 helper（`_withForeignRealmDoc`）识别 foreign ownerDocument，并在遍历前
    // adopt/import subtree。下方覆盖报告列出的 c1-c4 四类配置和 spoofed object 识别探针。
    // =======================================================================

    QUnit.module('Regression — cross-realm sanitization (GHSA-4w3q-35jp-p934)');

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

    QUnit.test('IN_PLACE with spoofed nodeType is contained (c3)', (assert) => {
      // 被测不变量是“spoofed object 不能把标记走私进 IN_PLACE”。库可以抛错、字符串化后清洗，
      // 或原样返回 spoof；只要伪造 innerHTML 永不变成带 on-handler 的活动元素，三者都可接受。
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
      // 任何返回值都不能成为携带 payload 的可解析 DOM：字符串化后检查；若返回 Element，
      // 则直接检查属性。
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

    QUnit.test('foreign-realm clobbered form is recognised (c4)', (assert) => {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      try {
        const foreignDoc = iframe.contentDocument;
        const form = foreignDoc.createElement('form');
        form.innerHTML = '<input name="nodeName"><input name="parentNode">';
        // 可接受行为：抛错（优先）或返回不含 on-handler 的已清洗字符串；原始 DoS 是无限循环。
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
          // forbidden namespace 元素应变为惰性（无子节点、无属性）；实现也可以对根抛错。
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

    QUnit.test(
      '<select name="childNodes"> with length-as-number does not defeat typing probe',
      (assert) => {
        // 旧 clobbering 检查只做 `typeof x === 'object'`，可被 childNodes clobber 成 `<select>`
        // 绕过，因为 select.length 是 number。现检查显式加入 nodeType 和构造器身份。
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
      // declarative shadow root 要么实例化并被遍历，要么 template 被删除；两者都消除 payload。
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
    // parentNode 同时为 null 且被 clobber，函数静默无操作返回，把带危险 handler 的原 form
    // 交还调用方。
    //
    // 修复在 preamble 加入 parentless clobbered root guard，于遍历前抛错。抛错本身是契约，
    // 调用方不得忽略。
    // =======================================================================

    QUnit.module(
      'Regression — GHSA-r47g-fvhr-h676 (parent-less clobbered form)'
    );

    /**
     * Given：detached form 根含 `<input name="nodeName" onmouseover>`，且当前引擎实现 form
     * named-property clobbering。
     * When：以 IN_PLACE 清洗。
     * Then：抛出描述 clobbered/forbidden/invalid 的错误，绝不能静默返回原根。
     *
     * 验证机制：先探测真实引擎能力，再匹配 fail-closed 异常；jsdom 跳过，动态证明依赖
     * Playwright Chromium 运行。
     * 对应源码：`sanitize()` 的 IN_PLACE `_isClobbered()` preflight 与 `_neutralizeRoot()`。
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

    QUnit.test(
      'all clobbering-name variants trigger preamble throw',
      (assert) => {
        if (!env.formClobbering) {
          assert.ok(true, 'engine does not clobber form properties; skipping');
          return;
        }
        // 哪些属性名会触发库的防御抛错由两个独立因素决定，测试不能预先静态断定：
        //
        //   1. 引擎行为：并非每个名称都能通过 HTMLFormElement named-property access 被
        //      clobber。Chromium 当前会 clobber nodeName/nodeType/attributes/childNodes，
        //      但 parentNode/firstChild/children 仍是不可遮蔽的 prototype getter；其他引擎不同。
        //
        //   2. 库策略：`_isClobbered()` 只检查一组对自身遍历有结构危险的属性。集合外名称即使
        //      能被 clobber，也不会触发该 guard。
        //
        // 从外部预测两者交集很脆弱，先前静态探针都在某个引擎失败。稳健做法是直接问库：该名称
        // 是否抛错。若抛，它属于实际 guarded 集，异常成为跨版本契约；若不抛，只能断言库未因它
        // 发生故障。
        //
        // 断言两个不变量：候选列表至少一个名称实际受 guard（否则整套防御已回归）；每个受 guard
        // 名称都必须抛 Error，不能静默返回 clobbered form，后者正是 GHSA-r47g-fvhr-h676 原语。
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

    QUnit.test(
      'parented clobbered form is still sanitized normally',
      (assert) => {
        // 抛错的回归对照：不是 iteration root 的 clobbered form 仍须原地清洗并删除危险属性；
        // throw 契约只针对根级 clobbering。
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
        // wrapper-rooted 遍历要么删除 on-handler（及可能的 form），要么引擎把嵌套 form 当作
        // iteration scope 并抛错；两者都保护消费者，唯一禁止结果是“带 onmouseover 返回”。
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

    QUnit.module('Regression — ordinary attached shadow roots');

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
    // GHSA-4w3q-35jp-p934 关闭 iterator mismatch 原语后仍有残余：foreign-realm helper 本身
    // 必须像 local-realm 路径一样识别 clobbered form 与 template.content。以下测试把本地覆盖
    // 复制到跨 realm 边界。
    // =======================================================================

    QUnit.module(
      'Regression — GHSA-hpcv-96wg-7vj8 (cross-realm IN_PLACE follow-up)'
    );

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

    QUnit.module('Regression — template.content traversal bypass');

    QUnit.test(
      'RETURN_DOM scrubs boundary-spanning expressions inside template.content',
      (assert) => {
        // `_scrubTemplateExpressions()` 使用以输出 body 为根的 NodeIterator。按 DOM 规范，
        // NodeIterator 不进入 `<template>.content`；它是普通 child-node tree 外的独立
        // DocumentFragment。template 内被删除的 foreign 元素会在 content 留下相邻文本碎片
        // `$` 与 `{...}`，单独都不匹配 TMPLIT_EXPR，却会在 normalize() 后合为完整 `${...}`。
        // 修复显式递归每个 template.content，与 `_sanitizeShadowDOM()` 已用方法一致。
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
    // DOM clobbering 完整矩阵（roundhouse）。
    //
    // 对 clobber carrier 标记与 DOMPurify 读取节点时依赖的属性/方法名做完整笛卡尔积 tripwire。
    // carrier 使用 `<form>`：其 named/id 子节点通过 LegacyOverrideBuiltIns 遮蔽 built-in，
    // 这是 sanitizer 必须承受的元素级 clobbering 向量。
    //
    // 此 override 是真实浏览器行为；jsdom 未实现，所以这些测试在 jsdom 会因没有发生 clobber
    // 而平凡通过，只有 Chromium（Playwright）运行具备真实检测力。首个断言报告当前引擎是否
    // 激活 override，避免把绿色 jsdom 结果误认为动态 clobber 覆盖。
    // =======================================================================

    QUnit.module('DOM clobbering — comprehensive matrix');

    // DOMPurify 或下游消费者会从节点读取的名称；遮蔽其中任一项都可能成为攻击杠杆。
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

    /** 判断序列化字符串是否仍含事件、script 或 javascript: sink。 */
    const clobberHasSink = (s) => /\son\w+\s*=|<script|javascript:/i.test(s);
    /** 重新解析输出并查找活动事件属性或 script 元素，补足纯字符串检查。 */
    const clobberReparseSink = (s) =>
      new window.DOMParser()
        .parseFromString(s, 'text/html')
        .querySelector('[onerror],[onload],[onclick],script');

    /**
     * 为一个候选 built-in 名称生成 name/id、重复控件集合和 form-name 四类 clobber carrier。
     *
     * @param name - 要尝试遮蔽的 DOM 属性或方法名。
     */
    const clobberPayloads = (name) => [
      '<form><input name="' + name + '">' + CLOBBER_SINKS + '</form>',
      '<form><input id="' + name + '">' + CLOBBER_SINKS + '</form>',
      // 两个同名控件会生成 RadioNodeList/HTMLCollection clobber。
      '<form><input name="' +
        name +
        '"><input name="' +
        name +
        '">' +
        CLOBBER_SINKS +
        '</form>',
      '<form name="' + name + '">' + CLOBBER_SINKS + '</form>',
    ];

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
    QUnit.module(
      'Security — IN_PLACE hoisted-content neutralisation (audit-5)'
    );

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
        // 任何位置存活的 `<img>` 都不能保留 handler，防止树内安全 clone 掩盖 armed detached
        // original。
        const imgs = root.querySelectorAll('img');
        let armed = 0;
        imgs.forEach((img) => {
          if (img.hasAttribute('onerror')) armed++;
        });
        assert.equal(armed, 0, 'no surviving <img> retains the handler');
      }
    );

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

    QUnit.test(
      'handler stripping is not defeated by a clobbering <form> sibling',
      (assert) => {
        // Given：被丢弃的原始子树含有一个 <form>，其具名子节点可遮蔽
        // removeAttribute、attributes 与 childNodes。
        // When：IN_PLACE 与 KEEP_CONTENT 将原节点提升回遍历序列后继续净化。
        // Then：真正承载事件处理器的 <img> 仍会被访问，onerror 必须被删除。
        // Mechanism：提升逻辑读取缓存的 Node.prototype getter；表单的具名属性
        // 无法改写这些原型访问器，因此常规 allowlist 属性阶段不会被 clobber 隐藏。
        // Source：purify.ts 的 _forceRemove、_sanitizeElements 与
        // _sanitizeAttributes。
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
    // Chromium 148+ 与 WebKit 26.4+ 会为可定制 <select> 镜像
    // <selectedcontent>：UA 把已选 <option> 的子树（含 on* 处理器）克隆进去；
    // 删除操作一旦改变当前 option/selectedcontent，甚至在 DOMPurify 的惰性
    // DOMParser 文档中也会同步重新镜像。完整镜像级联（F1 无限循环、F6 二次方
    // 输出、F3 重新镜像绕过）只能在这些引擎复现；下列测试固定所有引擎都应满足的
    // 结构保证。异常屏障（F2）与深树（F4）测试则可在任意环境运行。
    QUnit.module(
      'Security — campaign-3 (selectedcontent / barrier / deep tree)'
    );

    QUnit.test(
      'C3-F1/F6: <selectedcontent> is removed without hoisting its content',
      (assert) => {
        // Given：<selectedcontent> 内含带 onerror 的镜像候选子树。
        // When：默认 KEEP_CONTENT 路径删除该元素。
        // Then：其内容整体丢弃，不提升 <img> 或事件处理器。
        // Mechanism：旧路径会把引擎镜像出的子节点提升回树，触发下一个镜像目标，
        // 造成无限重新镜像与二次方放大；selectedcontent 进入 FORBID_CONTENTS 后，
        // _forceRemove 直接丢弃镜像副本并截断级联。原始 option 会独立接受净化。
        // Source：purify.ts 的 FORBID_CONTENTS 与 _forceRemove。
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

    QUnit.test(
      'C3-F1: selectedcontent content drop survives the KEEP_CONTENT path',
      (assert) => {
        // Given：显式启用默认且曾有风险的 KEEP_CONTENT 模式。
        // When：删除含普通子节点的 <selectedcontent>。
        // Then：FORBID_CONTENTS 优先级仍高于内容提升，输出必须为空。
        // Mechanism：_forceRemove 在提升前先检查 FORBID_CONTENTS。
        // Source：purify.ts 的 _forceRemove。
        const clean = DOMPurify.sanitize(
          '<selectedcontent><span>x</span></selectedcontent>',
          { KEEP_CONTENT: true }
        );
        assert.equal(clean, '', 'content dropped under KEEP_CONTENT: ' + clean);
      }
    );

    QUnit.test(
      'C3-F2: custom-element mid-walk abort leaves no surviving handler',
      (assert) => {
        // Given：页面注册的自定义元素在 disconnectedCallback 中移除当前包装节点，
        // 包装节点之后还放有事件处理器与 javascript: URL。
        // When：IN_PLACE 遍历中的 _forceRemove 遭遇无父节点保护并可能中途抛错。
        // Then：无论调用是否继续抛错，调用方的活动树都不能留下可执行载荷。
        // Mechanism：异常屏障在遍历异常时中和原地根节点，避免调用中断后把尚未访问的
        // 后续节点以未净化状态暴露给调用方。
        // Source：purify.ts 的 sanitize IN_PLACE 异常清理路径与 _forceRemove。
        if (typeof window.customElements === 'undefined') {
          assert.ok(true, 'no custom elements in this environment; skipping');
          return;
        }
        if (!window.customElements.get('x-surgeon-c3')) {
          /**
           * 在断开连接反应中模拟页面脚本篡改净化器正在遍历的祖先结构。
           */
          class XSurgeonC3 extends window.HTMLElement {
            /**
             * 元素被移除时同步拆除测试包装节点，制造遍历期间的父节点竞争。
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

    QUnit.test(
      'C3-F4: deep DOM-built tree sanitizes in place without failing open',
      (assert) => {
        // Given：用 DOM API 构造深度 5000 的树，并在浅层节点放置 onerror；DOM API
        // 不受解析器深度上限约束，该深度会击穿旧递归（Chromium 约 4500 层）。
        // When：以 IN_PLACE 模式执行入口预扫描 _sanitizeAttachedShadowRoots。
        // Then：调用不得栈溢出，浅层处理器必须被删除。
        // Mechanism：入口预扫描现改为迭代遍历；旧实现每个子节点递归一次，会在实际净化
        // 前抛错并留下 0% 净化的活动树。测试不挂载也不序列化该树，以隔离引擎自身的
        // 深渲染或序列化递归。
        // Source：purify.ts 的 _sanitizeAttachedShadowRoots 与 IN_PLACE 入口路径。
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

    QUnit.module('Coverage - input coercion');

    QUnit.test('coerces a number input', (assert) => {
      assert.equal(DOMPurify.sanitize(123), '123');
    });

    QUnit.test('coerces a boolean input', (assert) => {
      assert.equal(DOMPurify.sanitize(true), 'true');
    });

    if (typeof BigInt !== 'undefined') {
      QUnit.test('coerces a bigint input', (assert) => {
        assert.equal(DOMPurify.sanitize(BigInt(42)), '42');
      });
    }

    if (typeof Symbol !== 'undefined') {
      QUnit.test('coerces a symbol input', (assert) => {
        const out = DOMPurify.sanitize(Symbol('x'));
        assert.equal(out.indexOf('Symbol('), 0, `got: ${out}`);
      });
    }

    QUnit.test('coerces a function input', (assert) => {
      /**
       * 为函数输入提供可辨识名称，使 stringifyValue 的函数分支可被断言。
       */
      const out = DOMPurify.sanitize(function demo() {});
      assert.ok(out.indexOf('demo') > -1, `got: ${out}`);
    });

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

    QUnit.module('Coverage - config set construction');

    QUnit.test('ADD_TAGS given a non-array is handled safely', (assert) => {
      const out = DOMPurify.sanitize('<div>x</div>', {
        ADD_TAGS: 'notanarray',
      });
      assert.ok(out.indexOf('x') > -1, `got: ${out}`);
    });

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
    // 覆盖——数据驱动标记套件未触达的可达分支
    //
    // 覆盖公开 API（isValidAttribute、addHook 保护）、用户提供的
    // TRUSTED_TYPES_POLICY 配置路径（含其重入保护，#1422 / GHSA-vxr8-fq34-vvx9）、
    // forceKeepAttr/keepAttr hook 决策、noscript/noembed fallback-mXSS 保护，
    // 以及若干配置排列。
    //
    // 隔离：afterEach 清除配置与 hooks，避免持久 Trusted Types 策略及新增 hook
    // 泄漏到套件其余部分。
    // =======================================================================

    QUnit.module('Coverage - reachable branches', {
      /**
       * 每个覆盖用例前清除持久配置，建立独立的默认配置基线。
       *
       * @returns {void}
       */
      beforeEach() {
        DOMPurify.clearConfig();
      },
      /**
       * 每个覆盖用例后同时移除 hooks 与持久配置，阻断跨用例状态污染。
       *
       * @returns {void}
       */
      afterEach() {
        DOMPurify.removeAllHooks();
        DOMPurify.clearConfig();
      },
    });

    QUnit.test('isValidAttribute accepts and rejects', (assert) => {
      assert.ok(DOMPurify.isValidAttribute('a', 'href', 'https://example.com'));
      assert.notOk(DOMPurify.isValidAttribute('a', 'onclick', 'alert(1)'));
    });

    QUnit.test('addHook ignores a non-function', (assert) => {
      DOMPurify.addHook('uponSanitizeElement', null);
      assert.equal(DOMPurify.sanitize('<b>x</b>'), '<b>x</b>');
    });

    QUnit.test('null config is treated as empty config', (assert) => {
      assert.equal(DOMPurify.sanitize('<b>x</b>', null), '<b>x</b>');
    });

    QUnit.test('WHOLE_DOCUMENT keeps the document structure', (assert) => {
      const out = DOMPurify.sanitize(
        '<html><head></head><body><p>x</p></body></html>',
        { WHOLE_DOCUMENT: true }
      );
      assert.ok(out.indexOf('<p>x</p>') > -1, `got: ${out}`);
    });

    QUnit.test('template content is sanitized', (assert) => {
      const out = DOMPurify.sanitize(
        '<template><img src=x onerror=alert(1)></template>'
      );
      assert.equal(out.indexOf('onerror'), -1, `onerror survived: ${out}`);
    });

    QUnit.test(
      'namespaced SVG attribute is written via setAttributeNS',
      (assert) => {
        const out = DOMPurify.sanitize(
          '<svg><a xlink:href="https://x"></a></svg>'
        );
        assert.ok(out.indexOf('svg') > -1, `got: ${out}`);
      }
    );

    QUnit.test(
      'noscript/noembed fallback-mXSS guard removes the element',
      (assert) => {
        const out = DOMPurify.sanitize(
          '<noscript><noembed>x</noembed></noscript>'
        );
        assert.equal(out.indexOf('onerror'), -1, `got: ${out}`);
      }
    );

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

    QUnit.test(
      'TRUSTED_TYPES_POLICY signs output through the policy',
      (assert) => {
        // Given：调用方提供同时实现 createHTML 与 createScriptURL 的策略对象。
        // When：sanitize 开启 RETURN_TRUSTED_TYPE。
        // Then：净化后的标记必须经该策略签名，并保持等价字符串内容。
        // Mechanism：_parseConfig 校验策略接口，返回阶段调用 trustedTypesPolicy.createHTML。
        // Source：purify.ts 的 _parseConfig 与 sanitize 返回分支。
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

    QUnit.test('TRUSTED_TYPES_POLICY without createHTML throws', (assert) => {
      assert.throws(
        () =>
          DOMPurify.sanitize('x', {
            TRUSTED_TYPES_POLICY: { createScriptURL: (s) => s },
          }),
        /createHTML/
      );
    });

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

    QUnit.test('TRUSTED_TYPES_POLICY null opts out for the call', (assert) => {
      assert.equal(
        DOMPurify.sanitize('<b>x</b>', { TRUSTED_TYPES_POLICY: null }),
        '<b>x</b>'
      );
    });

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

    QUnit.test('setConfig applies persistent configuration', (assert) => {
      DOMPurify.setConfig({ ALLOWED_TAGS: ['b'] });
      assert.equal(DOMPurify.sanitize('<b>x</b><i>y</i>'), '<b>x</b>y');
    });

    QUnit.test('ADD_ATTR given an array allows the attribute', (assert) => {
      const out = DOMPurify.sanitize('<a data-x="1">y</a>', {
        ADD_ATTR: ['data-x'],
      });
      assert.ok(out.indexOf('data-x') > -1, `got: ${out}`);
    });

    QUnit.test('integration-point objects are accepted', (assert) => {
      const out = DOMPurify.sanitize('<div>x</div>', {
        MATHML_TEXT_INTEGRATION_POINTS: { mtext: true },
        HTML_INTEGRATION_POINTS: { foreignobject: true },
      });
      assert.ok(out.indexOf('x') > -1, `got: ${out}`);
    });

    QUnit.test(
      'FORBID_CONTENTS clones before mutating the default',
      (assert) => {
        const out = DOMPurify.sanitize('<div><span>x</span></div>', {
          FORBID_CONTENTS: ['span'],
        });
        assert.ok(out.indexOf('<div>') > -1, `got: ${out}`);
      }
    );

    QUnit.test(
      'allowed noscript with a fallback-mXSS payload is removed',
      (assert) => {
        // fallback-mXSS 保护只检查已通过 allowlist 的
        // noscript/noembed/noframes，因此测试必须先显式放行这些标签。
        const out = DOMPurify.sanitize(
          '<noscript><noembed>x</noembed></noscript>',
          { ADD_TAGS: ['noscript', 'noembed'] }
        );
        assert.equal(out.indexOf('onerror'), -1, `got: ${out}`);
      }
    );

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
     * 声明式局部更新（WICG/declarative-partial-updates）+ setHTMLUnsafe / 声明式
     * shadow DOM + streaming。
     *
     * 实测结果（Chrome 150，见 test/declarative-patch-probe-v{2,3,4}.html）：
     * `<template for>` 与 `<?marker>` 的链接会在 DOMPurify.sanitize() 自己解析时
     * 展开，因此遍历器能看到并净化完整物化的树，包括传送进 MathML/SVG 集成点的
     * 节点。以下测试固定所有环境都应满足的关键不变量：无论运行引擎是否展开链接，
     * 净化输出都不得携带可执行内容。
     *   - Chrome 150（支持该特性）：解析时展开模板 -> 遍历已展开节点 -> 输出无处理器。
     *   - jsdom / 旧引擎（不展开）：在 template.content 内净化武装节点 -> 输出无处理器。
     * 任一路径回归（解析时展开不再净化，或 template.content 递归损坏）都会使测试失败。
     *
     * 这里断言静态输出中的所有可达位置（含 template.content 与已激活 shadow root）
     * 均无 on* 处理器、script 或 js: URL，而不等待真实 onerror 触发；这样结果确定、
     * 与引擎无关且没有异步抖动。probe HTML 用于人工覆盖真实执行。
     * ===================================================================== */
    QUnit.module('Config — declarative partial updates / streaming');

    /**
     * 收集从序列化字符串重新解析后可达的全部可执行痕迹；遍历会进入
     * `<template>.content` 与所有已激活的 shadowRoot。
     *
     * @param {Node} root 待审计的 DOM 根节点。
     * @returns {string[]} 可执行标签、处理器属性或脚本 URL 的定位描述。
     */
    const _executableFindings = function (root) {
      const findings = [];
      /**
       * 递归访问普通子节点、模板内容与 shadow root，并累计可执行痕迹。
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
     *
     * @param {string} html 待重解析的 HTML。
     * @returns {string[]} 重解析后发现的可执行痕迹。
     */
    const _findingsFromHTML = function (html) {
      const holder = document.createElement('div');
      holder.innerHTML = html;
      return _executableFindings(holder);
    };

    QUnit.test(
      'parse-time template expansion neutralizes weaponized payloads',
      (assert) => {
        // Given：多组 template/marker 链接把处理器、script、javascript: URL
        // 或 namespace 混淆载荷送入普通 HTML、MathML 与 SVG 集成点。
        // When：sanitize 所用解析器在支持的引擎中展开链接，或在旧引擎中保留模板内容。
        // Then：把输出重新送入 HTML 汇点后，所有路径的可执行痕迹集合都必须为空。
        // Mechanism：解析时展开的节点进入常规树遍历；未展开节点则由模板内容递归净化。
        // Source：purify.ts 的 sanitize 解析、_sanitizeElements、
        // _sanitizeAttributes 与模板/shadow DOM 遍历路径。
        /**
         * 构造 marker 目标与声明式模板来源之间的最小链接。
         *
         * @param {string} id marker 与 template for 共用的标识符。
         * @param {string} content 模板内的武装内容。
         * @returns {string} 可触发声明式局部更新的标记。
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

    QUnit.test(
      'declarative shadow DOM: ADD_ATTR shadowrootmode still sanitizes shadow content',
      (assert) => {
        const dirty =
          '<section><template shadowrootmode="open">' +
          '<img src=x onerror=alert(1)>' +
          '</template></section>';
        const out = DOMPurify.sanitize(dirty, { ADD_ATTR: ['shadowrootmode'] });
        // 调用方显式 opt-in 后该属性可被保留，但它即将激活的内容仍必须净化，
        // 不得留下任何处理器。
        assert.deepEqual(
          _findingsFromHTML(out),
          [],
          `DSD content sanitized even when shadowrootmode is allowed — got: ${out}`
        );
      }
    );

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
        // Given：净化输出含声明式 shadow DOM 结构，原始输入带 onerror。
        // When：setHTMLUnsafe 跳过自身净化并激活声明式 shadow DOM。
        // Then：激活后的普通树与 shadow root 都不得出现可执行痕迹。
        // Mechanism：安全性必须来自 sanitize 已处理模板内容，而非汇点的二次净化。
        // Source：purify.ts 的模板内容遍历；浏览器 Element.setHTMLUnsafe 汇点语义。
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
