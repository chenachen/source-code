/** 通过 require 取得嵌套外部依赖的读取函数，再作为 hello 导出；用于核对优化过的 CommonJS 父包仍读取外部包共享状态。 */
const getMessage = require('nested-external')

module.exports = {
  hello: getMessage,
}
