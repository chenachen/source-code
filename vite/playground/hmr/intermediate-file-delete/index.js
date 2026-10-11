import { displayCount } from './re-export.js'

/** 保存计数的按钮节点；点击递增其文本，渲染函数从这里取当前值。 */
const button = document.querySelector('.intermediate-file-delete-increment')

/** 读取当前计数，转换成数值后交给显示函数，写到 DOM 或共享输出槽位。 */
const render = () => {
  document.querySelector('.intermediate-file-delete-display').textContent =
    displayCount(Number(button.textContent))
}

render()

button.addEventListener('click', () => {
  button.textContent = `${Number(button.textContent) + 1}`
  render()
})

if (import.meta.hot) import.meta.hot.accept()
