import workerUrl from '../simple-worker?worker&url'

/** 按选择器显示来自URL包装worker的消息。
 * @param el 输出节点。
 * @param text 序列化消息。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}

/** 将?worker&url导出的URL交给Worker构造器，消息监听展示其执行结果。 */
const worker = new Worker(workerUrl, { type: 'module' })

worker.addEventListener('message', (ev) => {
  text('.simple-worker-url', JSON.stringify(ev.data))
})
