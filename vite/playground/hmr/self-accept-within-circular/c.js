import './b'

/** 环内自身接受模块的初始文本；测试改导出后读取重新渲染结果。 */
export const c = 'c'

/** 把传入导出值写到当前环形场景输出；SSR 允许接受回调无导出时传 undefined，浏览器版本直接读新导出。
 * @param content 当前或更新后的导出文本。 */
function render(content) {
  document.querySelector('.self-accept-within-circular').textContent = content
}
render(c)

import.meta.hot?.accept((nextExports) => {
  render(nextExports.c)
})
