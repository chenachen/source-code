import './hmr.js'
import './hmr-asset.js'
import './invalidation-parent.js'
import './dead-accept.js'
import './cycle-a.js'
import './worker-accept.js'
import './worker-nested.js'
import './data.js'
import assetUrl from './asset.png'
import WorkerQuery from './worker-query.js?worker'

text('.app', 'hello')
text('.asset', assetUrl)

/** 通过查询包装器创建的 worker，入口发送 ping 并显示其消息，文件编辑后用于观察重建。 */
const workerQuery = new WorkerQuery()
workerQuery.postMessage('ping')
workerQuery.addEventListener('message', (e) => {
  text('.worker-query', e.data)
})

/** 通过相对 URL 创建的 module worker，入口发送 ping 并显示其消息。 */
const workerUrl = new Worker(new URL('./worker-url.js', import.meta.url), {
  type: 'module',
})
workerUrl.postMessage('ping')
workerUrl.addEventListener('message', (e) => {
  text('.worker-url', e.data)
})

/** 使用无接受依赖的 worker，修改其依赖后的新消息验证重新加载结果。 */
const workerPlain = new Worker(new URL('./worker-plain.js', import.meta.url), {
  type: 'module',
})
workerPlain.postMessage('ping')
workerPlain.addEventListener('message', (e) => {
  text('.worker-plain', e.data)
})

document.querySelector('#load-dynamic').addEventListener('click', () => {
  import('./dynamic.js')
})

import.meta.hot?.accept('./cycle-a.js', () => {})

/** 将入口和 worker 回传的文本写到指定DOM节点。
 * @param el 输出选择器。
 * @param text 待显示文本。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}
