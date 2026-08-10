'use strict';

// 旧实验 cache 子路径保留为发布兼容层，并按环境选择预构建 CJS。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react-unstable-cache.production.js');
} else {
  module.exports = require('./cjs/react-unstable-cache.development.js');
}
