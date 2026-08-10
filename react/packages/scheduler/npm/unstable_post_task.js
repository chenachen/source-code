'use strict';

// `postTask` 实验适配器的 npm 入口按运行模式选择对应 CommonJS 产物。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/scheduler-unstable_post_task.production.js');
} else {
  module.exports = require('./cjs/scheduler-unstable_post_task.development.js');
}
