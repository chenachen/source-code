import type {
  microAppWindowType,
} from '@micro-app/types'
import type IframeSandbox from './index'
import globalEnv from '../../libs/global_env'
import {
  rawDefineProperty,
  CompletionPath,
  isScriptElement,
  isBaseElement,
  isElement,
  isNode,
  isDocumentFragment,
  isFunction,
  isBrowser,
} from '../../libs/utils'
import {
  updateElementInfo,
  getIframeParentNodeDesc,
} from '../adapter'
import microApp from '../../micro_app'

/**
 * 改写 iframe realm 的 Node、Element 与资源属性访问。
 *
 * @remarks
 * DOM 操作会在 iframe 原型与基座已打补丁的原型之间桥接；节点仍由 iframe realm 创建，但普通内容最终进入可见的 micro-app 容器。
 *
 * @param appName - 节点归属的应用名。
 * @param url - 相对资源地址的解析基准。
 * @param microAppWindow - iframe 自身的 window realm。
 * @param sandbox - 提供 iframe head/body 与 location 的沙箱实例。
 */
export function patchElement (
  appName: string,
  url: string,
  microAppWindow: microAppWindowType,
  sandbox: IframeSandbox,
): void {
  patchIframeNode(appName, microAppWindow, sandbox)
  patchIframeAttribute(url, microAppWindow, appName)
}

/**
 * 将 iframe Node/Element 原型操作桥接到基座 DOM 补丁，同时保留纯脚本和 base 元素在 iframe 内。
 *
 * @remarks
 * 普通节点委托给基座原型后会继续经过应用归属、资源和容器重定向逻辑；标记为 `__PURE_ELEMENT__` 的 script/base 必须留在 iframe，维持脚本执行和相对地址解析。
 */
function patchIframeNode (
  appName: string,
  microAppWindow: microAppWindowType,
  sandbox: IframeSandbox,
): void {
  const rawRootElement = globalEnv.rawRootElement // 基座原生 Element 构造器。
  const rawRootNode = globalEnv.rawRootNode
  const rawDocument = globalEnv.rawDocument
  const microDocument = microAppWindow.document
  const microRootNode = microAppWindow.Node
  const microRootElement = microAppWindow.Element
  const microDocumentFragment = microAppWindow.DocumentFragment
  // const rawMicroGetRootNode = microRootNode.prototype.getRootNode
  const rawMicroAppendChild = microRootNode.prototype.appendChild
  const rawMicroInsertBefore = microRootNode.prototype.insertBefore
  const rawMicroReplaceChild = microRootNode.prototype.replaceChild
  const rawMicroRemoveChild = microRootNode.prototype.removeChild
  const rawMicroAppend = microRootElement.prototype.append
  const rawMicroPrepend = microRootElement.prototype.prepend
  const rawMicroFragmentAppend = microDocumentFragment.prototype.append
  const rawMicroFragmentPrepend = microDocumentFragment.prototype.prepend
  const rawMicroInsertAdjacentElement = microRootElement.prototype.insertAdjacentElement
  const rawMicroCloneNode = microRootNode.prototype.cloneNode
  const rawInnerHTMLDesc = Object.getOwnPropertyDescriptor(microRootElement.prototype, 'innerHTML')!
  const rawParentNodeDesc = Object.getOwnPropertyDescriptor(microRootNode.prototype, 'parentNode')!
  const rawOwnerDocumentDesc = Object.getOwnPropertyDescriptor(microRootNode.prototype, 'ownerDocument')!

  /** 判断必须留在 iframe 文档中、不能转发到可见容器的内部节点。 */
  const isPureNode = (target: unknown): boolean | void => {
    return (isScriptElement(target) || isBaseElement(target)) && target.__PURE_ELEMENT__
  }

  /** 把 iframe 的 head/body 映射到基座文档入口，其余父节点保持不变。 */
  const getRawTarget = (parent: Node): Node => {
    if (parent === sandbox.microHead) {
      return rawDocument.head
    } else if (parent === sandbox.microBody) {
      return rawDocument.body
    }

    return parent
  }

  /** 标记节点归属，并按纯节点边界选择 iframe 或基座 appendChild。 */
  microRootNode.prototype.appendChild = function appendChild <T extends Node> (node: T): T {
    updateElementInfo(node, appName)
    if (isPureNode(node)) {
      return rawMicroAppendChild.call(this, node)
    }
    return rawRootNode.prototype.appendChild.call(getRawTarget(this), node)
  }

  /** 标记节点归属，并按纯节点边界选择 iframe 或基座 insertBefore。 */
  microRootNode.prototype.insertBefore = function insertBefore <T extends Node> (node: T, child: Node | null): T {
    updateElementInfo(node, appName)
    if (isPureNode(node)) {
      return rawMicroInsertBefore.call(this, node, child)
    }
    return rawRootNode.prototype.insertBefore.call(getRawTarget(this), node, child)
  }

  /** 标记节点归属，并按纯节点边界选择 iframe 或基座 replaceChild。 */
  microRootNode.prototype.replaceChild = function replaceChild <T extends Node> (node: Node, child: T): T {
    updateElementInfo(node, appName)
    if (isPureNode(node)) {
      return rawMicroReplaceChild.call(this, node, child)
    }
    return rawRootNode.prototype.replaceChild.call(getRawTarget(this), node, child)
  }

  /** 从节点真实所在 realm 删除子节点；已转移节点交由基座补丁定位。 */
  microRootNode.prototype.removeChild = function removeChild<T extends Node> (oldChild: T): T {
    if (isPureNode(oldChild) || this.contains(oldChild)) {
      return rawMicroRemoveChild.call(this, oldChild)
    }
    return rawRootNode.prototype.removeChild.call(getRawTarget(this), oldChild)
  }

  /** 批量追加节点；批次含纯节点时整体保留在 iframe realm。 */
  microDocumentFragment.prototype.append = microRootElement.prototype.append = function append (...nodes: (Node | string)[]): void {
    let i = 0; let hasPureNode = false
    while (i < nodes.length) {
      nodes[i] = isNode(nodes[i]) ? nodes[i] : microDocument.createTextNode(nodes[i])
      if (isPureNode(nodes[i])) hasPureNode = true
      i++
    }
    if (hasPureNode) {
      return (isDocumentFragment(this) ? rawMicroFragmentAppend : rawMicroAppend).call(this, ...nodes)
    }
    return rawRootElement.prototype.append.call(getRawTarget(this), ...nodes)
  }

  /** 批量前插节点；批次含纯节点时整体保留在 iframe realm。 */
  microDocumentFragment.prototype.prepend = microRootElement.prototype.prepend = function prepend (...nodes: (Node | string)[]): void {
    let i = 0; let hasPureNode = false
    while (i < nodes.length) {
      nodes[i] = isNode(nodes[i]) ? nodes[i] : microDocument.createTextNode(nodes[i])
      if (isPureNode(nodes[i])) hasPureNode = true
      i++
    }
    if (hasPureNode) {
      return (isDocumentFragment(this) ? rawMicroFragmentPrepend : rawMicroPrepend).call(this, ...nodes)
    }
    return rawRootElement.prototype.prepend.call(getRawTarget(this), ...nodes)
  }

  /**
   * 桥接 `insertAdjacentElement`，用于 Vite 4 开发环境动态插入样式等场景。
   * 纯节点仍使用 iframe 原型，普通节点则进入基座 DOM 补丁。
   */
  microRootElement.prototype.insertAdjacentElement = function insertAdjacentElement (where: InsertPosition, element: Element): Element | null {
    updateElementInfo(element, appName)
    if (isPureNode(element)) {
      return rawMicroInsertAdjacentElement.call(this, where, element)
    }
    return rawRootElement.prototype.insertAdjacentElement.call(getRawTarget(this), where, element)
  }

  /**
   * 下列原型属性统一修正跨 realm 观察结果：`baseURI`、`ownerDocument`、`parentNode` 与 `innerHTML`。
   */
  rawDefineProperty(microRootNode.prototype, 'baseURI', {
    configurable: true,
    enumerable: true,
    /** 始终返回微应用代理 location 的当前 href。 */
    get () {
      return sandbox.proxyWindow.location.href
    },
  })

  rawDefineProperty(microRootNode.prototype, 'ownerDocument', {
    configurable: true,
    enumerable: true,
    /** 内部纯节点保留真实 ownerDocument，业务节点则观察到 iframe document。 */
    get () {
      return this.__PURE_ELEMENT__ || this === microDocument
        ? rawOwnerDocumentDesc.get?.call(this)
        : microDocument
    },
  })

  // 复用适配器描述符，把可见容器边界映射为应用期望的父节点。
  rawDefineProperty(microRootNode.prototype, 'parentNode', getIframeParentNodeDesc(
    appName,
    rawParentNodeDesc,
  ))

  /** 让跨到基座 DOM 的业务节点仍把 iframe document 视为根节点。 */
  microRootNode.prototype.getRootNode = function getRootNode (): Node {
    return microDocument
    // TODO：确认是否存在必须把子应用容器根重新映射为 microDocument 的调用场景。
    // const rootNode = rawMicroGetRootNode.call(this, options)
    // if (rootNode === appInstanceMap.get(appName)?.container) return microDocument
    // return rootNode
  }

  /** 克隆节点后继承当前应用归属，确保后续插入仍进入同一容器。 */
  microRootNode.prototype.cloneNode = function cloneNode (deep?: boolean): Node {
    const clonedNode = rawMicroCloneNode.call(this, deep)
    return updateElementInfo(clonedNode, appName)
  }

  rawDefineProperty(microRootElement.prototype, 'innerHTML', {
    configurable: true,
    enumerable: true,
    /** 读取 iframe Element 原型的原始 innerHTML。 */
    get () {
      return rawInnerHTMLDesc.get?.call(this)
    },
    /** 写入后标记新生成的全部元素子节点，使其纳入后续 DOM 桥接。 */
    set (code: string) {
      rawInnerHTMLDesc.set?.call(this, code)
      Array.from(this.children).forEach((child) => {
        if (isElement(child)) {
          updateElementInfo(child, appName)
        }
      })
    }
  })

  // `new Image()` 不经过 document.createElement，需在构造边界补应用归属。
  const ImageProxy = new Proxy(microAppWindow.Image, {
    /** 创建 iframe 图片并标记所属应用。 */
    construct (Target, args): HTMLImageElement {
      const elementImage = new Target(...args)
      updateElementInfo(elementImage, appName)
      return elementImage
    },
  })

  rawDefineProperty(microAppWindow, 'Image', {
    configurable: true,
    writable: true,
    value: ImageProxy,
  })
}

/**
 * 改写 iframe realm 的属性写入，把相对资源地址补全到子应用 URL。
 *
 * @remarks
 * 同时覆盖 `setAttribute()` 和常见资源属性 setter；锚点可由外部 resolver 接管，哈希锚点保持原值。
 */
function patchIframeAttribute (url: string, microAppWindow: microAppWindowType, appName: string): void {
  const microRootElement = microAppWindow.Element
  const rawMicroSetAttribute = microRootElement.prototype.setAttribute

  /** 对资源型属性补全地址，micro-app 自定义元素的 data 属性则转回其自身实现。 */
  microRootElement.prototype.setAttribute = function setAttribute (key: string, value: any): void {
    if (
      /^micro-app(-\S+)?/i.test(this.tagName) &&
      key === 'data' &&
      this.setAttribute !== microRootElement.prototype.setAttribute
    ) {
      this.setAttribute(key, value)
    } else {
      const aHrefResolver = microApp?.options?.aHrefResolver
      if (key === 'href' && /^a$/i.test(this.tagName) && typeof aHrefResolver === 'function') {
        // 试验性质：a 标签开放自定义补齐功能
        value = aHrefResolver(value, appName, url)
      } else if (
        ((key === 'src' || key === 'srcset') && /^(img|script|video|audio|source|embed)$/i.test(this.tagName)) ||
        (key === 'href' && /^(link|image)$/i.test(this.tagName)) ||
        // 锚点标签形如 `<a href="#xxx"/>` 时不得补全路径。
        (key === 'href' && /^(a)$/i.test(this.tagName) && !/^#/.test(value))
      ) {
        let _url = url
        if (isBrowser && key === 'href' && /^a$/i.test(this.tagName) && isFunction(microApp.options.excludeAssetFilter) && microApp.options.excludeAssetFilter(value)) {
          _url = document.baseURI
        }
        value = CompletionPath(value, _url)
      }
      rawMicroSetAttribute.call(this, key, value)
    }
  }

  const protoAttrList: Array<[HTMLElement, string]> = [
    [microAppWindow.HTMLImageElement.prototype, 'src'],
    [microAppWindow.HTMLScriptElement.prototype, 'src'],
    [microAppWindow.HTMLLinkElement.prototype, 'href'],
    [microAppWindow.SVGImageElement.prototype, 'href'],
  ]

  /**
   * 直接设置 `img.src`、`script.src` 或 `link.href` 不经过 `setAttribute`，
   * 因此还需包装各 realm 原型上的属性描述符。
   */
  protoAttrList.forEach(([target, attr]) => {
    const { enumerable, configurable, get, set } = Object.getOwnPropertyDescriptor(target, attr) || {
      enumerable: true,
      configurable: true,
    }

    rawDefineProperty(target, attr, {
      enumerable,
      configurable,
      get: function () {
        return get?.call(this)
      },
      set: function (value) {
        set?.call(this, CompletionPath(value, url))
      },
    })
  })
}
