/** 查询包装器worker的初始消息，测试连续修改并恢复此字面量。 */
const msg = 'worker-query'

/** 收到 ping 时回传本模块消息。
 * @param e 主页面消息。 */
self.onmessage = (e) => {
  if (e.data === 'ping') {
    self.postMessage(msg)
  }
}
