'use strict';

// React Server 条件下按 NODE_ENV 选择专用 ReactDOM 公共表面，不加载客户端 DOM renderer。
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./cjs/react-dom.react-server.production.js');
} else {
  module.exports = require('./cjs/react-dom.react-server.development.js');
}
