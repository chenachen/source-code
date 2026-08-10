'use strict';

// 无条件 CommonJS 解析默认采用 Node server shim；package exports 会为其他宿主选择专用文件。
module.exports = require('./server.node');
