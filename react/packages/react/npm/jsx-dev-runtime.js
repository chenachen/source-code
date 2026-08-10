'use strict';

// DEV JSX API 的发布入口仍按环境选包，生产构建会加载无开发诊断的对应产物。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react-jsx-dev-runtime.production.js');
} else {
  module.exports = require('./cjs/react-jsx-dev-runtime.development.js');
}
