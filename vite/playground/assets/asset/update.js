/** 把 HTML 模块脚本的消息写入 .update-content，build watch 测试修改消息后重载页面观察新产物。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}
text('.update-content', 'hello')
