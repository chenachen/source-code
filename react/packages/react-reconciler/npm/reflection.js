'use strict';

// Fiber 反射 API 的 npm 环境路由；不在此 shim 中复制查询逻辑。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react-reconciler-reflection.production.js');
} else {
  module.exports = require('./cjs/react-reconciler-reflection.development.js');
}
