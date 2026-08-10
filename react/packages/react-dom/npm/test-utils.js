'use strict';

// 测试工具发布 shim 按 NODE_ENV 选择诊断完整度不同的预构建 CJS。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react-dom-test-utils.production.js');
} else {
  module.exports = require('./cjs/react-dom-test-utils.development.js');
}
