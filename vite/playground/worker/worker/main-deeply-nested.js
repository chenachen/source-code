/** 三层链的根module worker，页面按消息类型把各层路径输出到独立槽位。 */
const worker = new Worker(
  new URL('../deeply-nested-worker.js', import.meta.url),
  { type: 'module' },
)

/** 按选择器显示JSON化后的层级消息。
 * @param el 输出节点。
 * @param text 序列化结果。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}

worker.addEventListener('message', (ev) => {
  if (ev.data.type === 'deeplyNestedSecondWorker') {
    text('.deeply-nested-second-worker', JSON.stringify(ev.data.data))
  } else if (ev.data.type === 'deeplyNestedThirdWorker') {
    text('.deeply-nested-third-worker', JSON.stringify(ev.data.data))
  } else {
    text('.deeply-nested-worker', JSON.stringify(ev.data.data))
  }
})
