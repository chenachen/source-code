'use strict'

var adapter = require('./adapters/http.js')

module.exports = {
  /** 以 GET 和传入 URL 调用 adapter，供 browser 映射将 Node adapter 替换为 xhr 的测试。 */
  get: function (url) {
    return adapter({ method: 'GET', url: url })
  },
}
