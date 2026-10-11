/** Jest DOM 原始元素创建方法，测试结束或代理内部仍可绕过 module 支持补丁。 */
export const rawDocumentCreateElement = Document.prototype.createElement
/**
 * 改写元素创建，使脚本节点默认表现为支持 module 的浏览器环境。
 *
 * 只覆盖显式 createElement('script')，DOMParser 解析静态 HTML 不经此桩；因此静态
 * nomodule 不会获得对应 DOM 属性，不能把此桩当成完整浏览器模块实现。
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
 * 仅 key 精确等于 noModule 时同步该布尔属性；设置 type=module 仍由原生属性行为处理。
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
