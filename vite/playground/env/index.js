text('.url', import.meta.url)

/** 显示 import.meta.url，供 env base 和模块 URL 测试检查。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}
