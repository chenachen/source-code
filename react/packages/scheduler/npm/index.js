'use strict';

// npm 发布入口按运行模式选择 Rollup 生成的 CommonJS 产物，避免开发版逻辑进入生产包。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/scheduler.production.js');
} else {
  module.exports = require('./cjs/scheduler.development.js');
}
