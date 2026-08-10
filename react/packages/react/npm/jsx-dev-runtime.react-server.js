'use strict';

// `react-server` 条件下的 DEV JSX 发布入口按环境选择预构建 CJS。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react-jsx-dev-runtime.react-server.production.js');
} else {
  module.exports = require('./cjs/react-jsx-dev-runtime.react-server.development.js');
}
