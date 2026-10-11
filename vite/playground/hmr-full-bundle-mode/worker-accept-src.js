/** 子 worker 初始回传值，编辑后由自身接受的浏览器导入模块替换实例。 */
const msg = 'worker-accept'

/** 仅在收到 ping 时回传当前消息。
 * @param e 主页面发送的消息事件。 */
self.onmessage = (e) => {
  if (e.data === 'ping') {
    self.postMessage(msg)
  }
}
