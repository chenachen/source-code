/**
 * CommonJS 包入口按 NODE_ENV 选择预构建产物；这里只转发导出，不在运行时重新编译源码。
 * production 使用裁去开发诊断的版本，其他环境使用保留开发检查的版本。
 */
'use strict'

if (process.env.NODE_ENV === 'production') {
  module.exports = require('./dist/compiler-core.cjs.prod.js')
} else {
  module.exports = require('./dist/compiler-core.cjs.js')
}
