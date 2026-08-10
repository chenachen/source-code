'use strict';

// 浏览器 server shim 分别加载旧式同步 API 与 Web Streams Fizz 适配产物，再组合公共导出。
var l, s;
if (process.env.NODE_ENV === 'production') {
  l = require('./cjs/react-dom-server-legacy.browser.production.js');
  s = require('./cjs/react-dom-server.browser.production.js');
} else {
  l = require('./cjs/react-dom-server-legacy.browser.development.js');
  s = require('./cjs/react-dom-server.browser.development.js');
}

exports.version = l.version;
exports.renderToString = l.renderToString;
exports.renderToStaticMarkup = l.renderToStaticMarkup;
exports.renderToReadableStream = s.renderToReadableStream;
exports.resume = s.resume;
