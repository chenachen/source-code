'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
exports.hello = void 0
/** 返回 Hello World!，随后同时赋给 exports.hello 与 exports.default；保留 TypeScript 风格 __esModule 标记，提供双出口互操作输入。 */
function hello() {
  return 'Hello World!'
}
exports.hello = hello
exports.default = hello
