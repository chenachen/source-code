/** 自接受模块的初始输出；连续编辑用于检查patch串行及错误恢复。 */
export const foo = 'hello'
text('.hmr', foo)

import assetUrlImported from './asset.png'

/** 转导出导入图片的 URL，使接受回调可从新命名空间读取最新资产链接。 */
export const assetUrl = assetUrlImported
text('.asset', assetUrl)

/** 按选择器写 DOM 文本，入口和接受回调复用它。
 * @param el 输出节点。
 * @param text 待显示值。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}

import.meta.hot?.accept((mod) => {
  if (mod) {
    text('.hmr', mod.foo)
    text('.asset', mod.assetUrl)
  }
})
