text('.dynamic', 'loaded')

/** 按选择器显示动态入口已执行的文本，按钮首次点击触发该模块加载。
 * @param el 输出选择器。
 * @param text 新文本。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}
