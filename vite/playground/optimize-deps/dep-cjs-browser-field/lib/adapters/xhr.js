'use strict'

/** 浏览器 adapter 返回 data:pong 的已完成 Promise，供页面断言 browser 字段替换成功。 */
module.exports =
  /** 浏览器 adapter 返回 data:pong 的已完成 Promise，供页面断言 browser 字段替换成功。 */
  function xhrAdapter(config) {
    return Promise.resolve({ data: 'pong' })
  }
