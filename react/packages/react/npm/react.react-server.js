'use strict';

// RSC 运行时通过此条件入口获得服务器允许的 React API 子集。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react.react-server.production.js');
} else {
  module.exports = require('./cjs/react.react-server.development.js');
}
