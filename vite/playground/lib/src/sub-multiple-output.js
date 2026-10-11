// 第二入口复用 CSS，覆盖多输出共享样式资产。
import './index.css'

/** 第二个库入口复用 index.css 后写 success，制造多输出之间的共享样式资产。 */
export default async function message(sel) {
  document.querySelector(sel).textContent = 'success'
}
