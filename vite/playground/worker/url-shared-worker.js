import constant from './modules/module0.js'

/** 取首端口并发送导入常量，供URL构造SharedWorker场景消费。
 * @param event 连接事件。 */
self.onconnect = (event) => {
  const port = event.ports[0]
  port.postMessage(constant)
}

// 为 source map 检查保留可定位的日志语句。
console.log('url-shared-worker.js')
