/** 返回当前包的成功标记，不读取可选 peer dependency。 */
exports.callItself = function () {
  return '[success]'
}

/** 尝试 require 未安装的可选 peer foobar；捕获错误后返回 fallback。 */
exports.callPeerDep = function () {
  try {
    // eslint-disable-next-line n/no-missing-require
    return require('foobar')
  } catch {
    return 'fallback'
  }
}
