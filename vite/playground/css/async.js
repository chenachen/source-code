import './async.css'

/** 异步 CSS 加载后插入的节点，立即读取计算颜色以检查模块执行前样式已就绪。 */
const div = document.createElement('div')
div.className = 'async'
document.body.appendChild(div)
div.textContent = `async chunk (this should be teal) ${
  getComputedStyle(div).color
}`
