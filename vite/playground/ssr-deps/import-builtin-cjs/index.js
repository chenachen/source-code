exports.stream = require('node:stream')

/** 用 CommonJS 属性赋值导出 Hello World! 函数；同文件另导出 node:stream，验证预优化依赖对 Node 内建模块的导入。 */
exports.hello = function () {
  return 'Hello World!'
}
