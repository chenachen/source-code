/** 通过 CommonJS require 读取带 module 条件包的 msg，供依赖预构建条件选择测试。 */
const { msg } = require('@vitejs/test-resolve-exports-with-module-condition')
module.exports = { msg }
