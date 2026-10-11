import { displayCount } from './re-export.js'

/** 每次调用读取共享计数槽位，避免缓存上轮状态。
 * @returns 当前计数字符串。 */
const incrementValue = () =>
  globalThis.__HMR__['.intermediate-file-delete-increment']

/** 读取当前计数，转换成数值后交给显示函数，写到 DOM 或共享输出槽位。 */
const render = () => {
  globalThis.__HMR__['.intermediate-file-delete-display'] = displayCount(
    Number(incrementValue()),
  )
}

render()

/** 递增共享计数字符串并重新渲染，模拟浏览器点击以测试状态保留。 */
globalThis.__HMR__['.delete-intermediate-file'] = () => {
  globalThis.__HMR__['.intermediate-file-delete-increment'] = `${
    Number(incrementValue()) + 1
  }`
  render()
}

if (import.meta.hot) import.meta.hot.accept()
