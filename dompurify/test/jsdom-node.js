/* jshint node: true, esnext: true */
/* global QUnit */
'use strict';

/** 根据覆盖率开关加载普通或插桩后的 CommonJS DOMPurify 构建。 */
const createDOMPurify = require(
  process.env.DOMPURIFY_COV ? '../dist/purify.cov.cjs' : '../dist/purify.cjs'
);
/** jsdom 包入口；用于为 Node.js 测试创建浏览器兼容 realm。 */
const jsdom = require('jsdom');
/** 从 jsdom 提取文档环境构造器与虚拟控制台构造器。 */
const { JSDOM, VirtualConsole } = jsdom;
/** 接收测试 realm 的控制台事件，避免 JSDOM 默认转发扰乱 QUnit 输出。 */
const virtualConsole = new VirtualConsole();
/**
 * Node.js 测试共享的 JSDOM window；允许脚本，以覆盖真实 DOM sink 行为。
 */
const { window } = new JSDOM(
  `<html><head></head><body><div id="qunit-fixture"></div></body></html>`,
  { runScripts: 'dangerously', virtualConsole }
);
require('jquery')(window);

/** 注册跨 jsdom/浏览器复用的 DOMPurify 主测试套件。 */
const sanitizeTestSuite = require('./test-suite');
/** 注册每例独立 realm 的 Trusted Types 引导测试套件。 */
const bootstrapTestSuite = require('./bootstrap-test-suite');

/**
 * 异步加载 ESM fixtures，注册全部套件并启动 Node.js 下的 QUnit。
 *
 * @returns {Promise<void>} fixtures 加载和测试注册完成后兑现。
 */
async function startQUnit() {
  const { default: tests } = await import('./fixtures/expect.mjs');
  const xssTests = tests.filter((element) => /alert/.test(element.payload));

  /**
   * 判断实际输出是否命中期望候选。
   *
   * expected 为数组时，用严格相等查找候选；为字符串时，检查 actual 是否为其子串，
   * 包括空字符串。需要验证完整输出相等的用例使用 assert.strictEqual。
   *
   * @param {*} actual DOMPurify 的实际输出。
   * @param {Array<*> | string} expected 可接受候选数组或历史标量期望。
   * @param {string} message QUnit 失败信息。
   * @returns {void}
   */
  QUnit.assert.contains = function (actual, expected, message) {
    const result = expected.indexOf(actual) > -1;
    // QUnit pushResult API 参考：https://api.qunitjs.com/assert/pushResult/
    this.pushResult({
      result: result,
      actual: actual,
      expected: expected,
      message: message,
    });
  };

  QUnit.config.autostart = false;

  QUnit.module('DOMPurify - bootstrap', bootstrapTestSuite(JSDOM));

  QUnit.module('DOMPurify in jsdom');

  if (!window.jQuery) {
    console.warn('Unable to load jQuery');
  }

  const DOMPurify = createDOMPurify(window);
  if (!DOMPurify.isSupported) {
    console.error('Unexpected error returned by jsdom.env():', err, err.stack);
    process.exit(1);
  }

  /**
   * 把载荷触发的 alert 转换成可断言的 xssed 状态。
   *
   * @returns {void}
   */
  window.alert = () => {
    window.xssed = true;
  };

  sanitizeTestSuite(DOMPurify, window, tests, xssTests);

  if (process.env.DOMPURIFY_COV) {
    QUnit.done(() => {
      const fs = require('fs');
      fs.mkdirSync('.nyc_output', { recursive: true });
      fs.writeFileSync(
        '.nyc_output/out.json',
        JSON.stringify(global.__coverage__ || {})
      );
    });
  }

  QUnit.start();
}

module.exports = startQUnit;
