import './base.css'

/** 挂载共享 btn 与指定异步样式类的按钮，再显示其计算颜色，供异步 CSS 顺序测试读取。 */
export function createButton(className) {
  const button = document.createElement('button')
  button.className = `btn ${className}`
  document.body.appendChild(button)
  button.textContent = `button ${getComputedStyle(button).color}`
}
