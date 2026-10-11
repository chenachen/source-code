/** 通过 exports 属性赋值提供 Hello World!；SSR noExternal/优化路径必须保留该 CommonJS 可调用导出。 */
exports.hello = function () {
  return 'Hello World!'
}
