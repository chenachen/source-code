let sharedWorkerCount = 0

/** 每次连接递增共享计数，仅第二次及之后回传pong，供默认与命名SharedWorker的双连接场景消费。
 * @param event 连接端口事件。 */
// @ts-expect-error onconnect exists in worker
self.onconnect = (event) => {
  sharedWorkerCount++
  const port = event.ports[0]
  if (sharedWorkerCount >= 2) {
    port.postMessage('pong')
  }
}

// 为 source map 检查保留可定位的日志语句。
console.log('my-shared-worker.js')
