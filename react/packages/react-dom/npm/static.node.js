'use strict';

// Node static shim 按 NODE_ENV 选择同时支持 Node Stream 与 Web Streams 的预渲染产物。
var s;
if (process.env.NODE_ENV === 'production') {
  s = require('./cjs/react-dom-server.node.production.js');
} else {
  s = require('./cjs/react-dom-server.node.development.js');
}

exports.version = s.version;
exports.prerenderToNodeStream = s.prerenderToNodeStream;
exports.prerender = s.prerender;
exports.resumeAndPrerenderToNodeStream = s.resumeAndPrerenderToNodeStream;
exports.resumeAndPrerender = s.resumeAndPrerender;
