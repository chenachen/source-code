/** Node 路径模块；用于把同目录 foo.js 转成绝对 require 路径。 */
const path = require('node:path')

/** 通过绝对路径 require 同目录 foo.js 并返回其 hello 字段，验证 SSR CommonJS 依赖中的绝对 require。 */
module.exports.hello = () => require(path.resolve(__dirname, './foo.js')).hello
