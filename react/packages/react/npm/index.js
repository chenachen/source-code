'use strict';

// 发布包入口只按环境选择预构建 CJS；源码逻辑位于对应 `cjs/react.*.js`。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react.production.js');
} else {
  module.exports = require('./cjs/react.development.js');
}
