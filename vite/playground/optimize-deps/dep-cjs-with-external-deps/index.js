// 测试包使用 stream 名称，构造被当作 Node 内置模块的外部依赖。
// eslint-disable-next-line n/prefer-node-protocol
let externalDummyNodeBuiltin = require('stream')
// 生产构建在 fixture 内手动补 default 互操作；Rolldown 不注入旧 requireReturnsDefault 兼容代码。
if (process.env.NODE_ENV === 'production') {
  const mod = externalDummyNodeBuiltin
  externalDummyNodeBuiltin = mod.default
  for (const key in mod) {
    externalDummyNodeBuiltin[key] = mod[key]
  }
}
/** 保持 excluded 的 ESM 外部依赖 namespace，供 CJS require 的属性访问测试。 */
const external = require('@vitejs/test-dep-esm-external')
/** 检查外部依赖 namespace 是否拥有 foo 自有属性，产出 ok/error 标记。 */
// eslint-disable-next-line no-prototype-builtins
const externalResult = external.hasOwnProperty('foo') ? 'ok' : 'error'
/** 调用名为 stream 的测试依赖并读取 bar 属性，观察被当作内置模块时的互操作结果。 */
const externalDummyNodeBuiltinResult = `${externalDummyNodeBuiltin()} ${externalDummyNodeBuiltin.bar}`
module.exports = { externalResult, externalDummyNodeBuiltinResult }
