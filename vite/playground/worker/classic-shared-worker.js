let base = `/${self.location.pathname.split('/')[1]}`
if (base.endsWith('.js') || base === `/worker-entries`) base = '' // 开发模式下修正源文件 URL 对应的 base。

importScripts(`${base}/classic.js`)

/** 取首个连接端口，回传 importScripts 加载的全局常量。
 * @param event 含 ports 的连接事件。 */
self.onconnect = (event) => {
  const port = event.ports[0]
  port.postMessage(self.constant)
}

// 为 source map 检查保留可定位的日志语句。
console.log('classic-shared-worker.js')
