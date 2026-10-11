/**
 * 把浏览器测试载荷触发的 alert 转换成可断言的 xssed 状态。
 *
 * @returns {void}
 */
window.alert = function () {
  window.xssed = true;
};

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
