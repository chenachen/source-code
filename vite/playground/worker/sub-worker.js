/** 仅收到ping时回传带self.location.href的文本，供嵌套worker路径断言。
 * @param event 上层worker消息。 */
self.onmessage = (event) => {
  if (event.data === 'ping') {
    self.postMessage(`pong ${self.location.href}`)
  }
}

// 为 source map 检查保留可定位的日志语句。
console.log('sub-worker.js')
