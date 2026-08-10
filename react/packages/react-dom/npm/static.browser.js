'use strict';

// 浏览器 static shim 按 NODE_ENV 选择 Web Streams 预渲染产物。
var s;
if (process.env.NODE_ENV === 'production') {
  s = require('./cjs/react-dom-server.browser.production.js');
} else {
  s = require('./cjs/react-dom-server.browser.development.js');
}

exports.version = s.version;
exports.prerender = s.prerender;
exports.resumeAndPrerender = s.resumeAndPrerender;
