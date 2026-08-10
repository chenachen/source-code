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
 * 审计 caveat：expected 为数组时采用严格候选匹配；expected 为字符串时 indexOf
 * 实际执行子串匹配，且空 actual 会命中任意字符串。因此标量 fixture 的通过不能等同于
 * 完整输出严格相等，安全结论还需由精确断言与真实 DOM sink 用例支撑。
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
