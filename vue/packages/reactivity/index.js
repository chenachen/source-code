'use strict'

/** CommonJS 包入口：依据 NODE_ENV 选择预构建的生产／开发产物；不在此实现响应式逻辑。 */

if (process.env.NODE_ENV === 'production') {
  module.exports = require('./dist/reactivity.cjs.prod.js')
} else {
  module.exports = require('./dist/reactivity.cjs.js')
}
