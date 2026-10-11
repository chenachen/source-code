/* eslint-disable no-restricted-globals */

/** 延迟创建并复用的浏览器实体解码容器，避免每次解码都创建 DOM。 */
let decoder: HTMLDivElement

/**
 * 借助浏览器原生 HTML parser 解码字符实体。
 *
 * 属性值与文本的实体解析规则不同：属性模式把输入放进临时 `foo` 属性并转义双引号，
 * 文本模式则读取 `textContent`。该实现只用于浏览器内编译。
 * @param raw - tokenizer 交来的尚未解码内容；属性模式需保留文本/属性实体规则差异。
 * @param asAttr - 是否借助临时属性读取值，而非从容器的文本内容读取。
 * @returns 浏览器解析后的字符串。复用模块级容器并替换 innerHTML，不向文档挂载。
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
