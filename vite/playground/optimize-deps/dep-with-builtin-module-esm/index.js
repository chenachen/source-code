// 故意省略 node: 前缀，覆盖裸内置模块导入的浏览器外部化。
// eslint-disable-next-line n/prefer-node-protocol
import { readFileSync } from 'fs'
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path'

// 调用具名导入，观察浏览器外部化诊断。
try {
  readFileSync()
} catch (e) {
  console.log('dep-with-builtin-module-esm', e)
}

// 从默认导入对象访问属性。
try {
  path.join()
} catch (e) {
  console.log('dep-with-builtin-module-esm', e)
}

// 在函数调用时才访问属性。
/** 调用具名导入的 readFileSync，验证 ESM 函数内延迟访问的浏览器外部化诊断。 */
export function read() {
  return readFileSync('test')
}
