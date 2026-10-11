/** 读取待测 UMD 构建产物，使每个用例都能在独立 JSDOM realm 中重新加载 DOMPurify。 */
const fs = require('fs');

/**
 * 为 Trusted Types 引导测试注册一组需要独立 realm 的 QUnit 用例。
 *
 * @param JSDOM - 由 runner 注入的 JSDOM 构造器；每次加载都会据此创建全新 window。
 */
module.exports = function (JSDOM) {
  /**
   * 模拟 TrustedHTML/TrustedScriptURL：保留原字符串，同时提供可观察的对象身份。
   */
  class StringWrapper {
    /** @param s - policy 回调签名后的字符串。 */
    constructor(s) {
      this.s = s;
    }

    /** 返回包装值，供字符串比较和 DOMPurify 后续解析使用。 */
    toString() {
      return this.s;
    }
  }

  /**
   * 在全新 JSDOM realm 中加载浏览器构建，并依次执行环境注入、加载前检查和最终断言。
   *
   * 新 window 让每个用例从独立的 DOMPurify 实例及默认 policy 缓存开始。
   * 在此 JSDOM 配置中，appendChild 会同步执行内联 script；之后依次运行两个断言回调，
   * 最后调用 QUnit 的完成信号。没有等待 script load 事件。
   *
   * @param assert - 当前 QUnit 断言上下文。
   * @param addScriptAttribute - 是否在加载脚本上设置 policy 名称后缀。
   * @param setup - DOMPurify 加载前的 window 环境注入函数。
   * @param beforeOnLoad - 构建加载后、主断言前执行的检查函数。
   * @param onload - 当前用例的最终断言函数。
   */
  function loadDOMPurify(
    assert,
    addScriptAttribute,
    setup,
    beforeOnLoad,
    onload
  ) {
    const testDone = assert.async();
    const { window } = new JSDOM('<head></head>', {
      runScripts: 'dangerously',
    });
    require('jquery')(window);
    if (setup) {
      setup(window);
    }

    const myLibrary = fs.readFileSync('dist/purify.js', { encoding: 'utf-8' });
    const scriptEl = window.document.createElement('script');
    if (addScriptAttribute)
      scriptEl.setAttribute('data-tt-policy-suffix', 'suffix');

    scriptEl.textContent = myLibrary;
    window.document.body.appendChild(scriptEl);

    assert.ok(window.DOMPurify.sanitize);

    if (beforeOnLoad) {
      beforeOnLoad(window);
    }

    if (onload) {
      onload(window);
    }
    testDone();
  }

  /**
   * 在 `loadDOMPurify()` 基础上先验证默认 XSS 清洗，再执行用例专属断言。
   *
   * 该前置断言把“policy 行为正确”与“构建本身未成功加载或基本清洗已失效”区分开。
   */
  function loadDOMPurifyWithSanityCheck(
    assert,
    addScriptAttribute,
    setup,
    onload
  ) {
    /** 验证新 realm 中的 DOMPurify 已加载，且默认配置会移除事件处理器。 */
    const beforeOnLoadSanityCheck = function (window) {
      assert.equal(
        window.DOMPurify.sanitize('<img src=x onerror=alert(1)>'),
        '<img src="x">'
      );
    };
    loadDOMPurify(
      assert,
      addScriptAttribute,
      setup,
      beforeOnLoadSanityCheck,
      onload
    );
  }

  /**
   * Given：window 不提供 Trusted Types API。
   * When：加载 DOMPurify 并使用默认配置清洗 `<img>`。
   * Then：基本 XSS 清洗仍生效，返回值为普通字符串。
   *
   * 验证机制：同时经过公共安全性前置断言与返回类型断言。
   * 对应源码：`_getDefaultTrustedTypesPolicy()` 的“不支持 API”分支和 `sanitize()` 字符串返回分支。
   */
  QUnit.test(
    'sanity check: works in a non-Trusted Type environment',
    function (assert) {
      let policyCreated;

      loadDOMPurifyWithSanityCheck(
        assert,
        false,
        /** 移除 Trusted Types API，构造明确的不支持环境。 */
        function setup(window) {
          delete window.trustedTypes;
        },
        /** 断言无 policy 时 `sanitize()` 不会把字符串包装成对象。 */
        function onload(window) {
          const output = window.DOMPurify.sanitize('<img>');
          assert.ok(typeof output === 'string');
        }
      );
    }
  );

  /**
   * Given：window 提供记录 policy 名称并包装 `createHTML` 结果的 Trusted Types stub。
   * When：加载 DOMPurify，并以 `RETURN_TRUSTED_TYPE` 清洗 `<img>`。
   * Then：内部 policy 名为 `dompurify`，输出字符串内容为 `<img>`，并属于 StringWrapper。
   *
   * 验证机制：名称、字符串值与 stub 包装类型三项断言；StringWrapper 模拟对象返回值。
   * 对应源码：`_getDefaultTrustedTypesPolicy()`、`_createTrustedHTML()` 与 `sanitize()` TrustedHTML 返回分支。
   */
  QUnit.test(
    'sanity check: works in a Trusted Type environment',
    function (assert) {
      let policyCreated;

      loadDOMPurifyWithSanityCheck(
        assert,
        false,
        /** 注入最小 Trusted Types stub，并记录 DOMPurify 请求的 policy 名称。 */
        function setup(window) {
          window.trustedTypes = {
            /** 创建测试 policy，并把 `createHTML` 结果包装为可识别对象。 */
            createPolicy(name, rules) {
              policyCreated = name;
              return {
                /** 转发 DOMPurify 的签名规则，同时保留 TrustedHTML 式对象身份。 */
                createHTML(s) {
                  return new StringWrapper(rules.createHTML(s));
                },
              };
            },
          };
        },
        /** 验证内部 policy 命名、清洗结果与 stub 包装身份。 */
        function onload(window) {
          assert.equal(policyCreated, 'dompurify');
          const output = window.DOMPurify.sanitize('<img>', {
            RETURN_TRUSTED_TYPE: true,
          });
          assert.equal(output, '<img>');
          assert.ok(output instanceof StringWrapper);
        }
      );
    }
  );

  /** 验证 script 的 `data-tt-policy-suffix` 会追加到内部 policy 名称。 */
  QUnit.test(
    'sanity check: supports configuring the policy suffix via an attribute',
    function (assert) {
      let policyCreated;

      loadDOMPurifyWithSanityCheck(
        assert,
        true,
        /** 注入只记录名称的 Trusted Types stub。 */
        function setup(window) {
          window.trustedTypes = {
            /** 返回原规则对象，使测试只观测 policy 命名，不改变签名语义。 */
            createPolicy(name, rules) {
              policyCreated = name;
              return rules;
            },
          };
        },
        /** 断言 policy 名称采用 `dompurify#suffix` 格式。 */
        function onload(window) {
          assert.equal(policyCreated, 'dompurify#suffix');
        }
      );
    }
  );

  /**
   * Given：分别提供缺失必需回调和实现完整的调用方 policy。
   * When：通过单次 `sanitize()` 配置安装 policy。
   * Then：缺失 `createHTML`/`createScriptURL` 时给出精确错误；完整 policy 被用于空值和解析输入两次签名。
   *
   * 验证机制：错误消息覆盖配置校验分支，调用计数覆盖 policy 实际接管清洗路径。
   * 对应源码：`_parseConfig()` 校验接口并包装空值，`_initDocument()` 包装解析输入。
   * 本次未开启 RETURN_TRUSTED_TYPE，净化后输出直接返回字符串。
   */
  QUnit.test('supports TRUSTED_TYPES_POLICY via sanitize()', function (assert) {
    /** `onload` 回调逐项验证调用方 policy 的接口校验和实际 HTML 签名次数。 */
    loadDOMPurify(assert, false, undefined, undefined, function onload(window) {
      let validationError;
      try {
        window.DOMPurify.sanitize('<img>', {
          TRUSTED_TYPES_POLICY: {
            /** 故意提供无效回调名，证明它不能替代必需的 `createHTML`。 */
            createScript(s) {
              return s;
            },
          },
        });
      } catch (e) {
        validationError = e;
      }
      assert.equal(
        validationError.message,
        'TRUSTED_TYPES_POLICY configuration option must provide a "createHTML" hook.'
      );

      try {
        window.DOMPurify.sanitize('<img>', {
          TRUSTED_TYPES_POLICY: {
            /** 只满足首个校验，用于触发缺失 `createScriptURL` 的第二个错误。 */
            createHTML(s) {
              return s;
            },
          },
        });
      } catch (e) {
        validationError = e;
      }
      assert.equal(
        validationError.message,
        'TRUSTED_TYPES_POLICY configuration option must provide a "createScriptURL" hook.'
      );

      let suppliedPolicyCallCount = 0;
      window.DOMPurify.sanitize('<img>', {
        TRUSTED_TYPES_POLICY: {
          /** 记录 HTML 签名次数，并返回可观测包装值。 */
          createHTML(s) {
            suppliedPolicyCallCount += 1;
            return new StringWrapper(s);
          },
            /** 补齐必需的 ScriptURL 接口；本输入不会调用它。 */
          createScriptURL(s) {
            return new StringWrapper(s);
          },
        },
      });
      assert.equal(suppliedPolicyCallCount, 2);
    });
  });

  /** 验证新实例通过 `setConfig()` 安装的调用方 policy 会进入后续清洗。 */
  QUnit.test(
    'supports TRUSTED_TYPES_POLICY via setConfig() on a new instance',
    function (assert) {
      loadDOMPurify(
        assert,
        false,
        undefined,
        undefined,
        /** 创建独立实例；setConfig 包装空值，后续 sanitize 包装解析输入，共调用两次 createHTML。 */
        function onload(window) {
          let purify = window.DOMPurify();
          assert.notEqual(purify, window.DOMPurify);

          let suppliedPolicyCallCount = 0;
          purify.setConfig({
            TRUSTED_TYPES_POLICY: {
              /** 记录持久配置对 HTML 签名路径的接管。 */
              createHTML(s) {
                suppliedPolicyCallCount += 1;
                return new StringWrapper(s);
              },
              /** 补齐持久 Trusted Types policy 的必需接口。 */
              createScriptURL(s) {
                return new StringWrapper(s);
              },
            },
          });

          purify.sanitize('<img>');
          assert.equal(suppliedPolicyCallCount, 2);
        }
      );
    }
  );

  /**
   * Given：调用方先自行创建名为 `test` 的完整 policy。
   * When：把该 policy 传给 `sanitize()`，随后再做一次无配置清洗。
   * Then：DOMPurify 不创建内部 `dompurify` policy，且后续调用沿用已配置 policy。
   *
   * 验证机制：连续检查 createPolicy 记录只有 test，没有 dompurify 创建记录。
   * 对应源码：`_parseConfig()` 选择调用方 policy 的分支。
   */
  QUnit.test(
    'internal TrustedTypes policy is not created when TRUSTED_TYPES_POLICY option is provided',
    function (assert) {
      const createdPolicies = [];
      loadDOMPurify(
        assert,
        false,
        /** 注入会记录每次 policy 创建的 Trusted Types stub。 */
        function setup(window) {
          window.trustedTypes = {
            /** 记录名称，并返回同时支持 HTML 与 ScriptURL 的包装 policy。 */
            createPolicy(name, rules) {
              createdPolicies.push(name);
              return {
                /** 按传入规则签名 HTML，并保留包装对象身份。 */
                createHTML(s) {
                  return new StringWrapper(rules.createHTML(s));
                },
                /** 按传入规则签名 ScriptURL，并保留包装对象身份。 */
                createScriptURL(s) {
                  return new StringWrapper(rules.createScriptURL(s));
                },
              };
            },
          };
        },
        undefined,
        /** 创建调用方 policy，验证 DOMPurify 不再创建同 realm 的内部 policy。 */
        function onload(window) {
          assert.equal(createdPolicies.length, 0);
          const testPolicy = window.trustedTypes.createPolicy('test', {
            /** 测试 policy 的 HTML 恒等签名。 */
            createHTML(s) {
              return s;
            },
            /** 测试 policy 的 ScriptURL 恒等签名。 */
            createScriptURL(s) {
              return s;
            },
          });
          window.DOMPurify.sanitize('<img />', {
            TRUSTED_TYPES_POLICY: testPolicy,
          });
          assert.equal(createdPolicies.length, 1);
          assert.equal(createdPolicies[0], 'test');
          // 后续 `sanitize()` 即使不再传配置，也应识别此前设置的 Trusted Types policy。
          window.DOMPurify.sanitize('<img />');
          assert.equal(createdPolicies.length, 1);
          assert.equal(createdPolicies[0], 'test');
        }
      );
    }
  );

  /**
   * Given：Trusted Types API 可用，但调用明确传入 `TRUSTED_TYPES_POLICY: null`。
   * When：连续清洗含 `onerror` 的输入和普通 `<img>`。
   * Then：事件处理器仍被移除，且整个过程不创建任何 policy。
   *
   * 验证机制：检查安全输出与 policy 创建计数；这里的 stub 不模拟真实 CSP 的 sink 拒绝。
   * 对应源码：`_parseConfig()` 的 null policy 分支。
   */
  QUnit.test(
    'internal TrustedTypes policy is not created when TRUSTED_TYPES_POLICY is null',
    function (assert) {
      const createdPolicies = [];
      loadDOMPurify(
        assert,
        false,
        /** 注入可记录意外 policy 创建的 Trusted Types stub。 */
        function setup(window) {
          window.trustedTypes = {
            /** 记录所有创建尝试，便于证明 null 分支没有隐式回退。 */
            createPolicy(name, rules) {
              createdPolicies.push(name);
              return {
                /** 按规则包装 HTML；若被调用即说明测试发现错误回退。 */
                createHTML(s) {
                  return new StringWrapper(rules.createHTML(s));
                },
                /** 按规则包装 ScriptURL；补齐 stub 的 policy 接口。 */
                createScriptURL(s) {
                  return new StringWrapper(rules.createScriptURL(s));
                },
              };
            },
          };
        },
        undefined,
        /** 验证 null policy 不创建内部 policy，同时保留普通清洗能力。 */
        function onload(window) {
          // 显式 null 使活动策略变为 undefined，且本次配置不请求内部 dompurify policy。
          // 它可用于外层 policy 的 createHTML 回调中调用 sanitize，避免再创建内部策略（#1422）；
          // 本例检查创建记录与字符串内容。
          const out = window.DOMPurify.sanitize(
            '<img src=x onerror=alert(1)>',
            { TRUSTED_TYPES_POLICY: null }
          );
          assert.equal(out, '<img src="x">');
          assert.equal(createdPolicies.length, 0);

          // 后续 null 调用同样不得创建任何 policy。
          window.DOMPurify.sanitize('<img />', { TRUSTED_TYPES_POLICY: null });
          assert.equal(createdPolicies.length, 0);
        }
      );
    }
  );

  /**
   * Given：调用方 policy 的 `createHTML` 回调重新进入同一 DOMPurify 实例。
   * When：通过 `setConfig()` 安装该自引用 policy。
   * Then：安装时包装空值触发重入错误；随后默认清洗仍能删除 onerror。
   *
   * 验证机制：先匹配错误，再检查下一次清洗输出；源码在策略初始化失败时恢复旧活动策略，
   * `_createTrustedHTML()` 的 finally 还会恢复共享重入计数器。
   * 对应源码：`_assertNotInTrustedTypesPolicy()` 及 `_parseConfig()` 的失败回滚分支。
   */
  QUnit.test(
    'a self-referential TRUSTED_TYPES_POLICY throws a clear error instead of recursing',
    function (assert) {
      loadDOMPurify(
        assert,
        false,
        /** 注入直接执行传入规则的 Trusted Types stub，以制造真实重入。 */
        function setup(window) {
          window.trustedTypes = {
            /** 返回把调用转发给规则对象的 policy。 */
            createPolicy(name, rules) {
              return {
                /** 转发 HTML 签名，使自引用规则能够重新进入 DOMPurify。 */
                createHTML(s) {
                  return rules.createHTML(s);
                },
                /** 转发 ScriptURL 签名，保持 policy 接口完整。 */
                createScriptURL(s) {
                  return rules.createScriptURL(s);
                },
              };
            },
          };
        },
        undefined,
        /** 构造自引用 policy，验证重入保护与失败后的实例可用性。 */
        function onload(window) {
          // `createHTML` 回调重新调用 DOMPurify.sanitize 会形成定义上的循环（见 #1422）。
          // 将它设为 DOMPurify policy 时必须快速给出描述性错误，而非最终触发
          // "Maximum call stack size exceeded"。
          const selfPolicy = window.trustedTypes.createPolicy('my-policy', {
            /** 故意重新进入 DOMPurify，构造被禁止的循环 policy。 */
            createHTML(input) {
              return window.DOMPurify.sanitize(input);
            },
            /** 保持 ScriptURL 为恒等函数，使失败唯一来自 HTML 重入。 */
            createScriptURL(input) {
              return input;
            },
          });

          assert.throws(
            function () {
              window.DOMPurify.setConfig({ TRUSTED_TYPES_POLICY: selfPolicy });
            },
            /must not call DOMPurify\.sanitize/,
            'circular TRUSTED_TYPES_POLICY throws a descriptive TypeError'
          );

          // 失败的 setConfig 不得污染实例：之后的普通清洗仍须工作。
          assert.equal(
            window.DOMPurify.sanitize('<img src=x onerror=alert(1)>'),
            '<img src="x">'
          );
        }
      );
    }
  );

  // GHSA-vxr8-fq34-vvx9 回归测试放在 bootstrap（jsdom）套件，而非 test-suite.js。
  // 每个用例使用新 window，独立观察默认策略创建、调用方策略清理与创建次数。
  // stub 只记录 createPolicy，不执行真实浏览器的同名策略或 CSP 校验。
  /**
   * 构造记录 policy 名称的 Trusted Types 环境，并返回供 `loadDOMPurify()` 使用的 setup。
   *
   * @param created - 接收每次 `createPolicy()` 名称的共享数组。
   */
  function withCountingTrustedTypes(created) {
    /** 为新 window 安装可计数、同时支持 HTML 与 ScriptURL 的 Trusted Types stub。 */
    return function setup(window) {
      window.trustedTypes = {
        /** 记录 policy 名称，并用测试包装器代理规则回调。 */
        createPolicy(name, rules) {
          created.push(name);
          return {
            /** 按规则创建带对象身份的 HTML 包装值。 */
            createHTML(s) {
              return new StringWrapper(rules.createHTML(s));
            },
            /** 按规则创建带对象身份的 ScriptURL 包装值。 */
            createScriptURL(s) {
              return new StringWrapper(rules.createScriptURL(s));
            },
          };
        },
      };
    };
  }

  /**
   * 返回忽略输入、固定签出危险 HTML 的调用方 policy。
   *
   * 该对象模拟低信任集成安装的不安全或外部 policy，用于证明配置清理不会让它继续签名。
   */
  function unsafeCallerPolicy() {
    return {
      /** 固定返回含事件处理器的 HTML，作为 policy 泄漏的可观察标记。 */
      createHTML() {
        return new StringWrapper('<img src=x onerror=alert(1)>');
      },
      /** 原样返回 ScriptURL；当前回归只关注 HTML policy 泄漏。 */
      createScriptURL(url) {
        return url;
      },
    };
  }

  /**
   * Given：一次调用显式安装会签出 `onerror` 的不安全调用方 policy。
   * When：调用 `clearConfig()` 后仅请求默认 `RETURN_TRUSTED_TYPE`。
   * Then：旧 policy 不再签名，结果恢复为 `<img src="x">`。
   *
   * 验证机制：先确认危险 policy 在其配置调用中确实生效，再断言清理后的内容与精确安全输出。
   * 对应源码：`clearConfig()` 恢复 `defaultTrustedTypesPolicy` 的 GHSA-vxr8-fq34-vvx9 分支。
   */
  QUnit.test(
    'a caller TRUSTED_TYPES_POLICY does not survive clearConfig()',
    function (assert) {
      const created = [];
      loadDOMPurify(
        assert,
        false,
        withCountingTrustedTypes(created),
        undefined,
        /** 执行不安全 policy、清理配置和默认 policy 恢复的三阶段断言。 */
        function onload(window) {
          const DOMPurify = window.DOMPurify;

          // 首次调用显式启用不安全 policy；它会暂留在实例上，clearConfig 才解除。
          const during = String(
            DOMPurify.sanitize('<img src=x onerror=alert(1)>', {
              TRUSTED_TYPES_POLICY: unsafeCallerPolicy(),
              RETURN_TRUSTED_TYPE: true,
            })
          );
          assert.ok(
            during.indexOf('onerror') > -1,
            'opted-in policy applies to its own call'
          );

          DOMPurify.clearConfig();

          const afterTrusted = String(
            DOMPurify.sanitize('<img src=x onerror=alert(1)>', {
              RETURN_TRUSTED_TYPE: true,
            })
          );
          assert.equal(
            afterTrusted.indexOf('onerror'),
            -1,
            'stale policy must not sign output after clearConfig()'
          );
          assert.equal(
            afterTrusted,
            '<img src="x">',
            'output is the default-sanitized result'
          );
        }
      );
    }
  );

  /**
   * Given：实例已使用过不安全调用方 policy。
   * When：下一次调用显式传入 `TRUSTED_TYPES_POLICY: null`。
   * Then：先前 policy 被退出，返回默认清洗后的普通安全内容。
   *
   * 验证机制：`onerror` 缺失与精确输出联合证明结果不是旧 policy 的签名产物。
   * 对应源码：`_parseConfig()` 的显式 null policy 分支。
   */
  QUnit.test(
    'TRUSTED_TYPES_POLICY: null clears a previously active policy',
    function (assert) {
      const created = [];
      loadDOMPurify(
        assert,
        false,
        withCountingTrustedTypes(created),
        undefined,
        /** 先激活外部 policy，再验证 null 配置立即清除其影响。 */
        function onload(window) {
          const DOMPurify = window.DOMPurify;

          DOMPurify.sanitize('x', {
            TRUSTED_TYPES_POLICY: unsafeCallerPolicy(),
            RETURN_TRUSTED_TYPE: true,
          });

          const afterNull = String(
            DOMPurify.sanitize('<img src=x onerror=alert(1)>', {
              TRUSTED_TYPES_POLICY: null,
              RETURN_TRUSTED_TYPE: true,
            })
          );
          assert.equal(
            afterNull.indexOf('onerror'),
            -1,
            'null opts out of any retained policy'
          );
          assert.equal(
            afterNull,
            '<img src="x">',
            'null returns the sanitized string'
          );
        }
      );
    }
  );

  /**
   * Given：仅存在可计数的 Trusted Types API，没有调用方 policy。
   * When：请求 Trusted Type 输出，执行 `clearConfig()` 后再次请求。
   * Then：首个输出为 StringWrapper 包装的安全 `<b>ok</b>`，内部 dompurify policy 总共创建一次。
   *
   * 验证机制：对象身份、清洗内容和跨清理创建计数共同覆盖缓存不变量。
   * 对应源码：`_getDefaultTrustedTypesPolicy()` 的单次解析缓存及 `clearConfig()` 恢复逻辑。
   */
  QUnit.test(
    'default RETURN_TRUSTED_TYPE yields a Trusted Type and creates the internal policy once',
    function (assert) {
      const created = [];
      loadDOMPurify(
        assert,
        false,
        withCountingTrustedTypes(created),
        undefined,
        /** 验证默认 policy 的包装内容与该实例跨 clearConfig 的缓存。 */
        function onload(window) {
          const DOMPurify = window.DOMPurify;

          const out = DOMPurify.sanitize('<b>ok</b><script>alert(2)</script>', {
            RETURN_TRUSTED_TYPE: true,
          });
          assert.ok(
            out instanceof StringWrapper,
            'returns a Trusted Type, not a plain string'
          );
          assert.equal(
            String(out),
            '<b>ok</b>',
            'wraps the sanitized result; script removed'
          );

          // clearConfig 保留该实例缓存的默认 policy；第二次清洗复用它，创建计数保持为一。
          DOMPurify.clearConfig();
          DOMPurify.sanitize('<b>again</b>', { RETURN_TRUSTED_TYPE: true });
          assert.equal(
            created.filter(function (name) {
              return name === 'dompurify';
            }).length,
            1,
            'internal dompurify policy created exactly once'
          );
        }
      );
    }
  );

  /**
   * Given：Trusted Types stub 把 `<script src>` 识别为 TrustedScriptURL，且调用方
   * `createScriptURL` 会重新进入 DOMPurify。
   * When：允许 script/src 后清洗该元素。
   * Then：重入快速抛出明确错误，失败后默认清洗仍可用。
   *
   * 验证机制：匹配重入错误，再检查默认清洗输出。这里的 createHTML 是恒等回调，
   * 后续结果确认共享计数器在失败后复位；本例没有断言调用方 policy 被卸载。
   * 对应源码：`_applyTrustedTypesToAttribute()`、`_createTrustedScriptURL()` 和共享重入计数器。
   */
  QUnit.test(
    'a self-referential createScriptURL throws a clear error instead of recursing',
    function (assert) {
      loadDOMPurify(
        assert,
        false,
        /** 注入能够声明属性 Trusted Type 的环境，使清洗进入 ScriptURL 分支。 */
        function setup(window) {
          window.trustedTypes = {
            /** 返回直接转发规则的 policy，允许测试构造真实重入。 */
            createPolicy(name, rules) {
              return {
                /** 转发 HTML 签名规则。 */
                createHTML(s) {
                  return rules.createHTML(s);
                },
                /** 转发 ScriptURL 签名规则，使自引用回调进入重入保护。 */
                createScriptURL(s) {
                  return rules.createScriptURL(s);
                },
              };
            },
            /** 把 `script[src]` 标记为 TrustedScriptURL，驱动 DOMPurify 进入对应分支。 */
            getAttributeType(tag, attr) {
              return tag === 'script' && attr === 'src'
                ? 'TrustedScriptURL'
                : null;
            },
          };
        },
        undefined,
        /** 构造 ScriptURL 自引用 policy，并验证失败后实例仍可安全使用。 */
        function onload(window) {
          const DOMPurify = window.DOMPurify;
          const cfg = { ADD_TAGS: ['script'], ADD_ATTR: ['src'] };

          // `createScriptURL` 重新进入 DOMPurify.sanitize 与 createHTML 场景一样形成循环
          //（#1422），必须快速失败，不能递归到栈溢出。顶层孤立 `<script>` 会被解析器丢弃，
          // 因而用 `<div>` 包裹以确保测试确实到达属性签名分支。
          const selfPolicy = {
            /** HTML 签名保持恒等，隔离测试变量到 ScriptURL 回调。 */
            createHTML(input) {
              return input;
            },
            /** 故意重新进入同一清洗流程，触发共享 Trusted Types 重入保护。 */
            createScriptURL() {
              return DOMPurify.sanitize(
                '<div><script src=x></script></div>',
                Object.assign({ TRUSTED_TYPES_POLICY: selfPolicy }, cfg)
              );
            },
          };

          assert.throws(
            function () {
              DOMPurify.sanitize(
                '<div><script src=x></script></div>',
                Object.assign({ TRUSTED_TYPES_POLICY: selfPolicy }, cfg)
              );
            },
            /must not call DOMPurify\.sanitize/,
            'circular createScriptURL throws a descriptive TypeError'
          );

          // createScriptURL 失败后，共享重入计数器必须复位，后续普通清洗仍可执行。
          assert.equal(
            DOMPurify.sanitize('<img src=x onerror=alert(1)>'),
            '<img src="x">'
          );
        }
      );
    }
  );
};
