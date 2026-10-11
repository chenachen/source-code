/** 把相对脚本加载成功的消息写入指定页面节点。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}
text('.relative-js', 'hello')
