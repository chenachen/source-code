/** 以 import.meta.url 构造 上一级 Worker URL，等待其第一条消息，检验优化依赖中的资源相对路径。 */
export function urlImportWorker() {
  // 用 ../ 定位上级 Worker，检验优化输出仍保留正确资源基准。
  const worker = new Worker(new URL('../worker.js', import.meta.url), {
    type: 'module',
  })
  return new Promise((res) => {
    /** 把 Worker 返回的数据作为外层 Promise 的结果，供页面读取 worker-success。 */
    worker.onmessage = (e) => res(e.data)
  })
}
