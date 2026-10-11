import WorkerAccept from './worker-accept-src.js?worker'

/** 当前 module 包装器创建的实例；模块自身接受更新，dispose 终止旧实例避免重复消息。 */
const worker = new WorkerAccept()
worker.postMessage('ping')
worker.addEventListener('message', (e) => {
  document.querySelector('.worker-accept').textContent = e.data
})

import.meta.hot?.accept()
import.meta.hot?.dispose(() => worker.terminate())
