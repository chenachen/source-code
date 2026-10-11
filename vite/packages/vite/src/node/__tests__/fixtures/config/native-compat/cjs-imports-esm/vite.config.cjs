/** 通过 require 读取 ESM helper 的目录标记，并作为配置 define.DIR 的输入。 */
const { dir } = require('./esm-helper.mjs')

module.exports = { define: { DIR: dir } }
