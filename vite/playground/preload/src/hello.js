import style from './hello.module.css'

/** hello 页面消息节点；动态模块执行时应用 CSS Modules 类，供 preload CSS 就绪断言。 */
const msg = document.querySelector('#hello .msg')
msg.textContent = 'hello'
msg.classList.add(style.h1)
