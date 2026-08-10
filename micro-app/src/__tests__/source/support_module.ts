/** Jest DOM 原始元素创建方法，测试结束或代理内部仍可绕过 module 支持补丁。 */
export const rawDocumentCreateElement = Document.prototype.createElement
/**
 * 改写元素创建，使脚本节点默认表现为支持 module 的浏览器环境。
 *
 * @param tagName - 要创建的标签名。
 * @param options - 原生元素创建选项。
 * @returns 原生方法创建并完成脚本能力标记的元素。
 */
Document.prototype.createElement = function (tagName: string, options?: ElementCreationOptions): HTMLElement {
  const element = rawDocumentCreateElement.call(document, tagName, options)
  // @ts-ignore
  if (tagName === 'script') element.noModule = false
  return element
}

/** Jest DOM 原始属性写入方法，补丁末尾用它执行真实赋值。 */
export const rawSetAttribute = Element.prototype.setAttribute
/**
 * 同步脚本的 module/noModule DOM 属性，再委托原生 setter 写入属性表。
 *
 * 直接赋 DOM 属性模拟浏览器能力判断；最后调用原方法可保留其余标签和属性的原生行为。
 *
 * @param key - 待写入的属性名。
 * @param value - 待写入的属性值。
 */
Element.prototype.setAttribute = function setAttribute (key: string, value: string): void {
  if (/^script$/i.test(this.tagName)) {
    if (key === 'noModule') {
      // @ts-ignore
      this.noModule = true
    } else if (key === 'module') {
      // @ts-ignore
      this.type = 'module'
    }
  }

  rawSetAttribute.call(this, key, value)
}
