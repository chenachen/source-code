/* eslint-disable no-restricted-globals */

/** 延迟创建并复用的浏览器实体解码容器，避免每次解码都创建 DOM。 */
let decoder: HTMLDivElement

/**
 * 借助浏览器原生 HTML parser 解码字符实体。
 *
 * 属性值与文本的实体解析规则不同：属性模式把输入放进临时 `foo` 属性并转义双引号，
 * 文本模式则读取 `textContent`。该实现只用于浏览器内编译。
 */
export function decodeHtmlBrowser(raw: string, asAttr = false): string {
  if (!decoder) {
    decoder = document.createElement('div')
  }
  if (asAttr) {
    decoder.innerHTML = `<div foo="${raw.replace(/"/g, '&quot;')}">`
    return decoder.children[0].getAttribute('foo')!
  } else {
    decoder.innerHTML = raw
    return decoder.textContent!
  }
}
