import './static.js'
import('./dynamic.js')
import('./direct-dynamic.css')
import('./dynamic2.js')

import myWorker from './worker.js?worker'

document.querySelector('.js').textContent = 'js: ok'

document.querySelector('.importmap').textContent = JSON.stringify(
  JSON.parse(
    document.head.querySelector('script[type="importmap"]')?.textContent,
  ),
  null,
  2,
)

/** 通过 ?worker 构造的独立 Worker，用 ping/pong 验证 import map 模式下 Worker 输出可加载。 */
const worker = new myWorker()
worker.postMessage('ping')
worker.addEventListener('message', (e) => {
  document.querySelector('.worker').textContent = e.data.message
})
