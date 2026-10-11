'use strict'

// Node adapter 是错误哨兵；浏览器请求应通过 browser 映射改用 xhr adapter。
/** Node adapter 的错误哨兵；浏览器映射必须改用 xhr，否则调用就抛错。 */
module.exports =
  /** Node adapter 的错误哨兵；浏览器映射必须改用 xhr，否则调用就抛错。 */
  function httpAdapter(config) {
    throw new Error('Node.js adapter should not be used in browser')
  }
