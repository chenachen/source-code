/** 外层 worker 创建的内层 module worker，收到主页面消息后向它发送 ping。 */
const inner = new Worker(new URL('./worker-nested-inner.js', import.meta.url), {
  type: 'module',
})

/** 收到主页面消息后向内层发送 ping。 */
self.onmessage = () => {
  inner.postMessage('ping')
}
/** 把内层消息加外层前缀后回传主页面。
 * @param e 内层 worker 的消息事件。 */
inner.onmessage = (e) => {
  self.postMessage(`nested-outer+${e.data}`)
}
/** 内层创建或执行失败时回传错误标记，页面文本帮助区分嵌套失败。 */
inner.onerror = () => {
  self.postMessage('nested-inner-error')
}
