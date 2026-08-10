'use strict';

// 半公开常量的 npm 环境路由；两个构建必须保持相同导出形状与数字编码。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react-reconciler-constants.production.js');
} else {
  module.exports = require('./cjs/react-reconciler-constants.development.js');
}
