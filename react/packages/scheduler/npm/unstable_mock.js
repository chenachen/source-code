'use strict';

// 测试 mock 的 npm 入口按运行模式路由到对应 CommonJS 产物。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/scheduler-unstable_mock.production.js');
} else {
  module.exports = require('./cjs/scheduler-unstable_mock.development.js');
}
