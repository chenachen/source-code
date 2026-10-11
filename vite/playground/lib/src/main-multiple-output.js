// 引入共享 CSS，覆盖多入口、多输出库模式的样式收集。
import './index.css'

/** 共享 CSS 导入完成后把 success 写入指定节点，供多入口/多格式库输出检查。 */
export default async function message(sel) {
  document.querySelector(sel).textContent = 'success'
}
