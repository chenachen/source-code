import './dynamic.css'

/** 等待已被静态导入的模块再次动态导入后标记 loaded，测试据此检查 CSS 完成加载且链接未重复。 */
export const lazyLoad = async () => {
  await import('./static.js')
  document.body.classList.add('loaded')
}
