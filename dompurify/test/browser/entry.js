/**
 * 浏览器 QUnit 入口：HTML 先按顺序加载 QUnit、jQuery、待测 UMD、setup 与 test-suite，
 * 此 ESM 再导入 fixture、安装结果收集回调并启动测试。两个 HTML 入口仅替换待测构建。
 * autostart 在 HTML 中关闭，保证用例注册完成前不会提前结束空套件。
 */

import tests from '/test/fixtures/expect.mjs';

/** 从完整语料筛选 payload 中含 alert 的条目，交给三种 DOM sink 测试；其余仍跑序列化断言。 */
const xssTests = tests.filter((element) => /alert/.test(element.payload));

// Playwright/legacy runner 通过完成标志轮询；完成回调先发布结果，再把标志置真，避免读到半套数据。
window.__qunitDone__ = false;
window.__qunitResult__ = null;
window.__qunitFailures__ = [];

// 每个失败用例只收集失败断言与定位信息，供外层 runner 输出；成功用例不增加诊断数组。
QUnit.testDone((details) => {
  if (details.failed > 0) {
    window.__qunitFailures__.push({
      module: details.module,
      name: details.name,
      failed: details.failed,
      total: details.total,
      assertions: details.assertions
        .filter((a) => !a.result)
        .map((a) => ({
          message: a.message || null,
          expected: a.expected,
          actual: a.actual,
          source: a.source || null,
        })),
    });
  }
});

// 此事件代表整个 QUnit 队列结束；total/passed/failed 是断言数量，不是注册用例数量。
QUnit.done((details) => {
  window.__qunitResult__ = {
    passed: details.passed,
    failed: details.failed,
    total: details.total,
    runtime: details.runtime,
  };
  window.__qunitDone__ = true;
});

QUnit.module(window.__SUITE_NAME__ || 'DOMPurify');

// test-suite 的 UMD 在浏览器全局公开注册函数；传入同一 window/实例，使 setup 的 alert 探针与 sink 一致。
// eslint-disable-next-line no-undef
testSuite(DOMPurify, window, tests, xssTests);

QUnit.start();
