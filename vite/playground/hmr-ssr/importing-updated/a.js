/** 模块本次执行的输出文本，追加到累积日志；依赖自身更新后再改消费模块，用执行次数观察缓存复用。 */
const val = 'a0'
globalThis.__HMR__['.importing-reloaded'] ??= ''
globalThis.__HMR__['.importing-reloaded'] += `a.js: ${val}<br>`

export default val

if (import.meta.hot) {
  import.meta.hot.accept()
}
