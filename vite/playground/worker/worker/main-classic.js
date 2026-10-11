/** 按选择器展示classic普通/共享worker消息。
 * @param el 输出节点。
 * @param text 结果文本。 */
// prettier-ignore
function text(el, text) {
  document.querySelector(el).textContent = text
}

let classicWorker = new Worker(
  new URL('../classic-worker.js', import.meta.url) /* , */,
  // 参数间保留注释，检验 Worker 构造器的解析。
)

// 检验右括号后续逗号不会被误认为 Worker 的第二个选项参数。
classicWorker = new Worker(new URL('../classic-worker.js', import.meta.url))

classicWorker.addEventListener('message', ({ data }) => {
  switch (data.message) {
    case 'ping': {
      text('.classic-worker', data.result)
      break
    }
    case 'test-import': {
      text('.classic-worker-import', data.result)
      break
    }
  }
})
classicWorker.postMessage('ping')
classicWorker.postMessage('test-import')

/** 显式classic选项创建的SharedWorker；保留尾逗号和评论语法，端口start后接收importScripts全局常量。 */
// prettier-ignore
// 检验第二个参数后的尾逗号。
const classicSharedWorker = new SharedWorker(
  new URL('../classic-shared-worker.js', import.meta.url),
  {
    type: 'classic'
  }, // 参数间保留注释，检验 Worker 构造器的解析。
)
classicSharedWorker.port.addEventListener('message', (ev) => {
  text('.classic-shared-worker', JSON.stringify(ev.data))
})
classicSharedWorker.port.start()
