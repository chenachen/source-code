/** URL构造worker的初始消息，测试修改后观察重建产物。 */
const msg = 'worker-url'

/** 收到 ping 时回传本模块消息。
 * @param e 主页面消息。 */
self.onmessage = (e) => {
  if (e.data === 'ping') {
    self.postMessage(msg)
  }
}
