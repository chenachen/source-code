'use strict';

// Node server shim 分别加载旧式同步 API 与流式 Fizz 适配产物，再组合公共导出。
var l, s;
if (process.env.NODE_ENV === 'production') {
  l = require('./cjs/react-dom-server-legacy.node.production.js');
  s = require('./cjs/react-dom-server.node.production.js');
} else {
  l = require('./cjs/react-dom-server-legacy.node.development.js');
  s = require('./cjs/react-dom-server.node.development.js');
}

exports.version = l.version;
exports.renderToString = l.renderToString;
exports.renderToStaticMarkup = l.renderToStaticMarkup;
exports.renderToPipeableStream = s.renderToPipeableStream;
exports.renderToReadableStream = s.renderToReadableStream;
exports.resumeToPipeableStream = s.resumeToPipeableStream;
exports.resume = s.resume;
