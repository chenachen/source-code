'use strict'

// 包根 CommonJS 入口只按 NODE_ENV 选择预构建产物；源码注释任务不生成或加载 dist。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./dist/compiler-dom.cjs.prod.js')
} else {
  module.exports = require('./dist/compiler-dom.cjs.js')
}
