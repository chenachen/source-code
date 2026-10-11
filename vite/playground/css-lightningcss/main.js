import './minify.css'
import './imported.css'
import './external.css'
import mod from './mod.module.css'
import './external-url.css'
import './css-url.css'

document.querySelector('.modules').classList.add(mod['apply-color'])
text('.modules-code', JSON.stringify(mod, null, 2))

import composesPathResolvingMod from './composes-path-resolving.module.css'
document
  .querySelector('.path-resolved-modules-css')
  .classList.add(...composesPathResolvingMod['path-resolving-css'].split(' '))
text(
  '.path-resolved-modules-code',
  JSON.stringify(composesPathResolvingMod, null, 2),
)

import inlineMod from './inline.module.css?inline'
text('.modules-inline', inlineMod)

/** 把 CSS Modules 映射或 inline CSS 文本写到页面，供 Lightning CSS 测试观察转换结果。 */
function text(el, text) {
  document.querySelector(el).textContent = text
}

if (import.meta.hot) {
  import.meta.hot.accept('./mod.module.css', (newMod) => {
    const list = document.querySelector('.modules').classList
    list.remove(mod.applyColor)
    list.add(newMod.applyColor)
    text('.modules-code', JSON.stringify(newMod.default, null, 2))
  })
}
