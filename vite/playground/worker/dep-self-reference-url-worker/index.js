/** 创建依赖包内的入口worker并发送 main，所有消息交给调用方handler；入口仅在main时创建一层自身。
 * @param handler 接收worker消息事件的回调。 */
export function startWorker(handler) {
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    type: 'module',
  })
  worker.postMessage('main')
  worker.addEventListener('message', (e) => {
    handler(e)
  })
}
