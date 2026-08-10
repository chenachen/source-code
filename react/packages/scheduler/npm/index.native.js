'use strict';

// React Native npm 入口按运行模式选择对应的生成产物。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/scheduler.native.production.js');
} else {
  module.exports = require('./cjs/scheduler.native.development.js');
}
