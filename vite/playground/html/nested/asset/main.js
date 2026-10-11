/** 写入嵌套 HTML 相对 script src 的执行消息，验证入口目录改变后路径仍正确。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}
text('.relative-js', 'hello')
