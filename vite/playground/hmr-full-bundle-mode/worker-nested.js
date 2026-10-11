/** 自身接受的浏览器模块创建的外层worker；消息写页面，dispose终止旧实例，更新重建后创建新实例。 */
const worker = new Worker(
  new URL('./worker-nested-outer.js', import.meta.url),
  {
    type: 'module',
  },
)
worker.postMessage('ping')
worker.addEventListener('message', (e) => {
  document.querySelector('.worker-nested').textContent = e.data
})
worker.addEventListener('error', () => {
  document.querySelector('.worker-nested').textContent = 'nested-outer-error'
})

import.meta.hot?.accept()
import.meta.hot?.dispose(() => worker.terminate())
