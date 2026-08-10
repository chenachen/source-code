'use strict';

// 自动 JSX 转换的发布入口按环境装载对应 CJS 实现。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react-jsx-runtime.production.js');
} else {
  module.exports = require('./cjs/react-jsx-runtime.development.js');
}
