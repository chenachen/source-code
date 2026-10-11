/** 收到 ping 时回传 worker: pong，让主页面确认 Worker 已启动并接收消息。 */
self.onmessage = (e) => {
  if (e.data === 'ping') {
    self.postMessage({ message: 'worker: pong' })
  }
}
