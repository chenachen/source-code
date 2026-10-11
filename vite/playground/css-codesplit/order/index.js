import './insert' // 先插入橙色 style。
import './base.css' // 静态 CSS 将其覆盖为蓝色。

document.querySelector('.order-bulk-update').addEventListener('click', () => {
  import('./dynamic.css') // 点击后加载绿色 CSS，验证后加载规则覆盖。
})
