/** 接收主页面消息后回传 load worker，验证变量动态导入的 ?worker 包装器。
 * @param event 收到的事件；当前 fixture 不读取负载。 */
self.onmessage = (event) => {
  self.postMessage({
    msg: 'load worker',
  })
}
