/** 以 import.meta.url 构造 同目录 Worker URL，等待其第一条消息，检验优化依赖中的资源相对路径。 */
export function urlImportWorker() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    type: 'module',
  })
  return new Promise((res) => {
    /** 把 Worker 返回的数据作为外层 Promise 的结果，供页面读取 worker-success。 */
    worker.onmessage = (e) => res(e.data)
  })
}

/** 返回同目录 logo.png 的绝对资源 URL，检验优化后 import.meta.url 的资源基准。 */
export function getAssetUrl() {
  return new URL('./logo.png', import.meta.url).href
}
