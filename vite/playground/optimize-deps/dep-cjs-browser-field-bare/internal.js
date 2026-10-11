'use strict'

/** 故意不带 node: 前缀加载 events，由 browser mapping 改为含 foo 的 shim。 */
// eslint-disable-next-line n/prefer-node-protocol
const events = require('events')

module.exports = 'foo' in events ? 'pong' : ''
