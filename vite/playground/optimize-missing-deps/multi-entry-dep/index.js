/** 服务端 CommonJS 条件入口使用的 Node path 模块，负责规范化 Server 标记。 */
const path = require('node:path')

exports.name = path.normalize('./Server')
