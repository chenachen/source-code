document.querySelector('#app').innerHTML = `
  <div>
    <h1>Test worker</h1>
    <div id="worker">???</div>
  </div>
`

/** 以 import.meta.url 为基准创建测试 Worker，随后发送 hi 触发动态 import。 */
const worker = new Worker(new URL('./worker.js', import.meta.url))
/** 收到 Worker 返回值时更新 #worker 文本，供动态导入测试观测结果。 */
worker.onmessage = (e) => {
  document.querySelector('#worker').textContent = e.data
}
worker.postMessage('hi')
