let inlineSharedWorkerCount = 0

/** 每次连接递增共享计数，仅第二次及之后向新连接的首端口回传pong，验证inline URL是否复用实例。
 * @param event 连接端口事件。 */
// @ts-expect-error onconnect exists in worker
self.onconnect = (event) => {
  inlineSharedWorkerCount++
  const port = event.ports[0]
  if (inlineSharedWorkerCount >= 2) {
    port.postMessage('pong')
  }
}

// 为 source map 检查保留可定位的日志语句。
console.log('my-inline-shared-worker.js')
