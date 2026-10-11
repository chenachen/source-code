import { msg } from './worker-plain-dep.js'

/** 只响应 ping，返回无接受依赖的当前导出。
 * @param e 主页面消息。 */
self.onmessage = (e) => {
  if (e.data === 'ping') {
    self.postMessage(msg)
  }
}
