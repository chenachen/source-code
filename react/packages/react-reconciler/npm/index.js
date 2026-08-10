'use strict';

// 已发布 npm 包的环境路由：生产使用压缩/去开发分支实现，其余环境保留诊断版本。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react-reconciler.production.js');
} else {
  module.exports = require('./cjs/react-reconciler.development.js');
}
