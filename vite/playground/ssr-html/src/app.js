import { virtual } from 'virtual:file'

/** 追加到页面的动态段落；后续由 text 函数写入内容，供动态注入模块脚本测试观察。 */
const p = document.createElement('p')
p.innerHTML = '✅ Dynamically injected script from file'
document.body.appendChild(p)

text('.virtual', virtual)

/** 把传入消息写到已插入的段落；页面脚本随后调用它显示动态外部脚本已执行。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}
