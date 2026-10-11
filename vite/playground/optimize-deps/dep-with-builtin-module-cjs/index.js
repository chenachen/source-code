// 故意省略 node: 前缀，覆盖裸内置模块导入的浏览器外部化。
/** 故意不带 node: 前缀 require fs，浏览器外部化代理会在实际属性访问时报错。 */
// eslint-disable-next-line n/prefer-node-protocol
const fs = require('fs')
/** 故意不带 node: 前缀 require path，后续 join 访问验证浏览器外部化诊断。 */
// eslint-disable-next-line n/prefer-node-protocol
const path = require('path')

// 若在 require 后立即解构，会立刻访问代理属性并触发 get；此处保留对象到后续访问时再观察错误。

// 从默认导入对象访问属性。
try {
  path.join()
} catch (e) {
  console.log('dep-with-builtin-module-cjs', e)
}

// 在函数调用时才访问属性。
/** 在调用时访问 fs.readFileSync，验证函数内延迟访问也触发浏览器外部化诊断。 */
module.exports.read = () => {
  return fs.readFileSync('test')
}
