/** 取得 object-assigned-exports 的 CommonJS 导出对象，随后原样赋给 module.exports，形成整体转发的互操作输入。 */
const original = require('object-assigned-exports')
module.exports = original
