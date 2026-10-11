import type {
  Func,
  AppInterface,
} from '@micro-app/types'
import {
  appInstanceMap,
  isIframeSandbox,
} from '../create_app'
import {
  CompletionPath,
  getCurrentAppName,
  pureCreateElement,
  removeDomScope,
  isInvalidQuerySelectorKey,
  isUniqueElement,
  isProxyDocument,
  isFunction,
  isElement,
  isNode,
  rawDefineProperty,
  rawDefineProperties,
  isLinkElement,
  isStyleElement,
  isScriptElement,
  isIFrameElement,
  isMicroAppBody,
  isMicroAppHead,
  isNull,
  getIframeCurrentAppName,
  isDocumentFragment,
  isDocumentShadowRoot,
  isImageElement,
  isVideoElement,
  isAudioElement,
} from '../libs/utils'
import scopedCSS from '../sandbox/scoped_css'
import {
  extractLinkFromHtml,
  formatDynamicLink,
} from './links'
import {
  extractScriptElement,
  runDynamicInlineScript,
  runDynamicRemoteScript,
  checkExcludeUrl,
  checkIgnoreUrl,
} from './scripts'
import {
  fixReactHMRConflict,
  updateElementInfo,
} from '../sandbox/adapter'
import microApp from '../micro_app'
import globalEnv from '../libs/global_env'

/**
 * 原始动态资源节点到实际插入节点的映射。
 *
 * link/script/style 可能被 style 或注释替代；删除、insertBefore 等后续操作必须定位替代节点。
 * WeakMap 不延长原节点生命周期，应用 DOM 释放后映射可随垃圾回收清理。
 */
const dynamicElementInMicroAppMap = new WeakMap<Node, Element | Comment>()

/** 返回节点对应的替代节点；从未转换的节点保持原值。 */
function getMappingNode(node: Node): Node {
  return dynamicElementInMicroAppMap.get(node) ?? node
}

/**
 * 处理即将插入子应用的动态节点，并转换需接管的 style/link/script。
 *
 * 已转换节点直接复用映射，重复插入同一原节点不会再次发起框架下载或脚本求值。style 执行 CSS 隔离；stylesheet link
 * 转为异步填充的 style；脚本按 inline/Function 策略执行并返回真实 script 或注释。exclude
 * 资源用注释占位，ignore 与基座过滤器命中的资源保留原生行为。
 *
 * @param child - 调用方试图插入的原始节点。
 * @param app - 节点所属的应用实例。
 * @returns 实际应交给原生 DOM 方法的节点。
 */
function handleNewNode(child: Node, app: AppInterface): Node {
  if (dynamicElementInMicroAppMap.has(child)) {
    return dynamicElementInMicroAppMap.get(child)!
  } else if (isStyleElement(child)) {
    if (child.hasAttribute('exclude')) {
      const replaceComment = document.createComment('style element with exclude attribute ignored by micro-app')
      dynamicElementInMicroAppMap.set(child, replaceComment)
      return replaceComment
    } else if (app.scopecss && !child.hasAttribute('ignore')) {
      return scopedCSS(child, app)
    }
    return child
  } else if (isLinkElement(child)) {
    if (child.hasAttribute('exclude') || checkExcludeUrl(child.getAttribute('href'), app.name)) {
      const linkReplaceComment = document.createComment('link element with exclude attribute ignored by micro-app')
      dynamicElementInMicroAppMap.set(child, linkReplaceComment)
      return linkReplaceComment
    } else if (
      child.hasAttribute('ignore') ||
      checkIgnoreUrl(child.getAttribute('href'), app.name) ||
      (
        child.href &&
        isFunction(microApp.options.excludeAssetFilter) &&
        microApp.options.excludeAssetFilter(child.href)
      )
    ) {
      return child
    }

    const { address, linkInfo, replaceComment } = extractLinkFromHtml(
      child,
      null,
      app,
      true,
    )

    if (address && linkInfo) {
      const replaceStyle = formatDynamicLink(address, app, linkInfo, child)
      dynamicElementInMicroAppMap.set(child, replaceStyle)
      return replaceStyle
    } else if (replaceComment) {
      dynamicElementInMicroAppMap.set(child, replaceComment)
      return replaceComment
    }

    return child
  } else if (isScriptElement(child)) {
    if (
      child.src &&
      isFunction(microApp.options.excludeAssetFilter) &&
      microApp.options.excludeAssetFilter(child.src)
    ) {
      return child
    }

    const { replaceComment, address, scriptInfo } = extractScriptElement(
      child,
      null,
      app,
      true,
    ) || {}

    if (address && scriptInfo) {
      // 远程与内联脚本共用执行入口；资源信息中的 `isExternal` 决定是否需要异步抓取。
      const replaceElement: HTMLScriptElement | Comment = scriptInfo.isExternal ? runDynamicRemoteScript(address, app, scriptInfo, child) : runDynamicInlineScript(address, app, scriptInfo)
      dynamicElementInMicroAppMap.set(child, replaceElement)
      return replaceElement
    } else if (replaceComment) {
      dynamicElementInMicroAppMap.set(child, replaceComment)
      return replaceComment
    }

    return child
  }

  return child
}

/**
 * 把针对全局 head/body 的 DOM 操作路由到应用隔离容器，再调用保存的原生方法。
 *
 * 非劫持目标仍在原父节点执行。insertBefore/replaceChild 的参照节点会映射到替代节点；
 * removeChild 对已卸载或不在隔离容器中的节点走容错分支，避免异步清理抛错。
 *
 * @param app - 当前节点所属应用。
 * @param rawMethod - 初始化阶段保存的原生 DOM 方法。
 * @param parent - 调用方看到的父节点。
 * @param targetNode - 待插入、替换或移除的实际节点。
 * @param passiveNode - insertBefore 的参照节点或 replaceChild 的旧节点。
 * @returns 原生 DOM 方法结果，或无需删除时原样返回目标节点。
 */
function invokePrototypeMethod(
  app: AppInterface,
  rawMethod: Func,
  parent: Node,
  targetNode: Node,
  passiveNode?: Node | null,
): any {
    const hijackParent = getHijackParent(parent, targetNode, app)
  if (hijackParent) {
    /**
     * 非 iframe 沙箱把 `<micro-app-body>` 内节点的 `parentNode` 对外映射为基座 body，兼容
     * element-ui@2 `vue-popper.js` 对 `document.body` 的身份判断。异步通过 parentNode 操作
     * 子节点时应用可能已经卸载；真实父节点不再是 micro-app-body 或 app.container 为空时，
     * getter 返回原生值，不再伪装为宿主 body。
     * 证据：https://github.com/jd-opensource/micro-app/issues/739
     */
    if (
      !isIframeSandbox(app.name) &&
      isMicroAppBody(hijackParent) &&
      rawMethod !== globalEnv.rawRemoveChild
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(targetNode, 'parentNode')
      if ((!descriptor || descriptor.configurable) && !targetNode.__MICRO_APP_HAS_DPN__) {
        rawDefineProperties(targetNode, {
          parentNode: {
            configurable: true,
            /** 在节点仍位于应用 body 时返回兼容父节点，脱离后恢复真实 parentNode。 */
            get() {
              const result: ParentNode = globalEnv.rawParentNodeDesc.get.call(this)
              if (isMicroAppBody(result) && app.container) {
                // TODO：移除 getRootElementParentNode 兼容入口。
                return microApp.options.getRootElementParentNode?.(this, app.name) || document.body
              }
              return result
            },
          },
          __MICRO_APP_HAS_DPN__: {
            configurable: true,
            /** 标记已安装兼容 parentNode getter，避免后续插入重复定义描述符。 */
            get: () => true,
          }
        })
      }
    }

    if (
      __DEV__ &&
      isIFrameElement(targetNode) &&
      rawMethod === globalEnv.rawAppendChild
    ) {
      fixReactHMRConflict(app)
    }

    /**
     * `passiveNode` 仅用于 insertBefore/replaceChild。若参照节点不在隔离容器，默认降级为
     * appendChild；但 insertBefore 的参照仍在原 parent 时，先按原 childNodes 索引寻找隔离
     * 容器中的对应位置，兼容 `document.head.insertBefore(..., head.childNodes[0])`。
     * 证据：https://github.com/jd-opensource/micro-app/issues/1071
     * removeChild 的目标可能已不在 micro-app-head，需单独容错。
     */
    if (passiveNode && !hijackParent.contains(passiveNode)) {
      if (rawMethod === globalEnv.rawInsertBefore && parent.contains(passiveNode)) {
        const indexOfParent = Array.from(parent.childNodes).indexOf(passiveNode as ChildNode)
        if (hijackParent.childNodes[indexOfParent]) {
          return invokeRawMethod(rawMethod, hijackParent, targetNode, hijackParent.childNodes[indexOfParent], app)
        }
      }
      return globalEnv.rawAppendChild.call(hijackParent, targetNode)
    } else if (rawMethod === globalEnv.rawRemoveChild && !hijackParent.contains(targetNode)) {
      if (parent.contains(targetNode)) {
        return rawMethod.call(targetNode.parentElement, targetNode)
      }
      return targetNode
    }

    return invokeRawMethod(rawMethod, hijackParent, targetNode, passiveNode, app)
  }

  return invokeRawMethod(rawMethod, parent, targetNode, passiveNode, app)
}

/**
 * 计算全局父节点在当前应用中的真实插入容器。
 *
 * document.head 映射到 micro-app-head，document.body 及其 parentNode 映射到 micro-app-body。
 * iframe 真实 script 在 head 操作时进入 iframe head，其他父节点的操作一律进入 iframe body，
 * 因而调用方即使指定应用内部元素也不会把该 script 放在那里。其余内部父节点返回 `null`。
 */
function getHijackParent(
  parent: Node,
  targetNode: Node,
  app: AppInterface,
): HTMLElement | null | undefined {
  if (app) {
    if (parent === document.head) {
      if (app.iframe && isScriptElement(targetNode)) {
        return app.sandBox.microHead
      }
      return app.querySelector<HTMLElement>('micro-app-head')
    }
    if (parent === document.body || parent === document.body.parentNode) {
      if (app.iframe && isScriptElement(targetNode)) {
        return app.sandBox.microBody
      }
      return app.querySelector<HTMLElement>('micro-app-body')
    }
    if (app.iframe && isScriptElement(targetNode)) {
      return app.sandBox.microBody
    }
  }
  return null
}

/**
 * 以正确签名调用保存的原生插入方法。
 *
 * append/prepend 只接收目标节点；iframe 脚本把 DocumentFragment 方法改成 Element 对应
 * 方法，因为两个原型函数并不相等，直接借用会破坏 receiver 约束。
 */
function invokeRawMethod(
  rawMethod: Func,
  parent: Node,
  targetNode: Node,
  passiveNode?: Node | null,
  app?: AppInterface,
) {
  if (isPendMethod(rawMethod)) {
    /**
     * iframe 脚本最终追加到 iframe.body，需把 Fragment 方法换成 Element 方法，因为：
     * Element.prototype.append === DocumentFragment.prototype.append ==> false
     * Element.prototype.prepend === DocumentFragment.prototype.prepend ==> false
     */
    if (app?.iframe && isScriptElement(targetNode)) {
      if (rawMethod === globalEnv.rawFragmentAppend) {
        rawMethod = globalEnv.rawAppend
      } else if (rawMethod === globalEnv.rawFragmentPrepend) {
        rawMethod = globalEnv.rawPrepend
      }
    }
    return rawMethod.call(parent, targetNode)
  }

  return rawMethod.call(parent, targetNode, passiveNode)
}

/** 判断方法是否属于只接收节点列表的 append/prepend 族。 */
function isPendMethod(method: CallableFunction) {
  return (
    method === globalEnv.rawAppend ||
    method === globalEnv.rawPrepend ||
    method === globalEnv.rawFragmentAppend ||
    method === globalEnv.rawFragmentPrepend
  )
}

/**
 * 在动态节点插入前补全其资源地址。
 *
 * 只处理会由浏览器发起请求的常见标签；锚点纯 hash 地址保持不变，自定义 `aHrefResolver`
 * 优先于默认 URL 补全。使用保存的原始 setAttribute 避免再次进入全局补丁。
 * srcset 当前整段交给 CompletionPath，不解析逗号分隔的候选图及尺寸描述；iframe 不在此表内。
 *
 * @param app - 提供入口基址和锚点解析器上下文的应用。
 * @param newChild - 待插入节点。
 */
function completePathDynamic(app: AppInterface, newChild: Node): void {
  if (isElement(newChild)) {
    if (/^(img|script)$/i.test(newChild.tagName)) {
      if (newChild.hasAttribute('src')) {
        globalEnv.rawSetAttribute.call(newChild, 'src', CompletionPath(newChild.getAttribute('src')!, app.url))
      }
      if (newChild.hasAttribute('srcset')) {
        globalEnv.rawSetAttribute.call(newChild, 'srcset', CompletionPath(newChild.getAttribute('srcset')!, app.url))
      }
    } else if ((/^(link|image)$/i.test(newChild.tagName) && newChild.hasAttribute('href')) ||
          // 锚点的纯 hash 地址只引用当前文档片段，不应补全为应用绝对 URL。
          (/^(a)$/i.test(newChild.tagName) && newChild.hasAttribute('href') && !/^#/.test(newChild.getAttribute('href') || ''))
    ) {
      const aHrefResolver = microApp?.options?.aHrefResolver
      const hrefValue = newChild.getAttribute('href')!
      let nextHrefValue
      if ((/^(a)$/i.test(newChild.tagName) && typeof aHrefResolver === 'function')) {
        nextHrefValue = aHrefResolver(hrefValue, app.name, app.url)
      } else {
        nextHrefValue = CompletionPath(hrefValue, app.url)
      }
      globalEnv.rawSetAttribute.call(newChild, 'href', nextHrefValue)
    }
  }
}

/**
 * DOM 原型补丁的统一入口：识别节点所属应用、补充标记并路由动态资源。
 *
 * 纯净节点和没有应用归属的节点直接走原生方法。ShadowRoot 中动态 style 自动标记 ignore，
 * 避免再次执行普通 CSS 隔离。应用已卸载且无容器时也回退原生行为。
 *
 * @param parent - 调用 DOM 方法的父节点。
 * @param newChild - 待插入、替换或删除的节点。
 * @param passiveNode - 可选参照/旧节点。
 * @param rawMethod - 对应的原生 DOM 方法。
 */
function commonElementHandler(
  parent: Node,
  newChild: Node,
  passiveNode: Node | null,
  rawMethod: Func,
) {
  const currentAppName = getCurrentAppName()
  if (
    isNode(newChild) &&
    !newChild.__PURE_ELEMENT__ &&
    (
      newChild.__MICRO_APP_NAME__ ||
      currentAppName
    )
  ) {
    updateElementInfo(newChild, newChild.__MICRO_APP_NAME__ || currentAppName)
    const app = appInstanceMap.get(newChild.__MICRO_APP_NAME__!)
    if (app?.container) {
      if (isStyleElement(newChild)) {
        parent.getRootNode() instanceof ShadowRoot && newChild.setAttribute('ignore', 'true')
      }
      completePathDynamic(app, newChild)
      return invokePrototypeMethod(
        app,
        rawMethod,
        parent,
        handleNewNode(newChild, app),
        passiveNode && getMappingNode(passiveNode),
      )
    }
  }

  return invokeRawMethod(rawMethod, parent, newChild, passiveNode)
}

/**
 * 安装 Element、Node、DocumentFragment 与 Document 的全局 DOM 补丁。
 *
 * 补丁把子应用创建的节点标记归属，并将全局 head/body 操作重定向到应用隔离容器；动态
 * 资源也在这里进入 CSS/脚本处理链。原生引用来自 `globalEnv` 快照；最后一个沙箱停止时
 * 调用配对 release 函数恢复其中列出的补丁。Document.createComment、Fragment 的
 * append/prepend 和 Element.insertAdjacentElement 未出现在释放清单中，仍保留这里安装的实现。
 */
export function patchElementAndDocument(): void {
  patchDocument()

  const rawRootElement = globalEnv.rawRootElement
  const rawRootNode = globalEnv.rawRootNode
  const rawDocumentFragment = globalEnv.rawDocumentFragment

  // 新增节点相关原型方法。
  /** 劫持 appendChild，使动态资源在进入 DOM 前完成应用级转换。 */
  rawRootNode.prototype.appendChild = function appendChild<T extends Node>(newChild: T): T {
    return commonElementHandler(this, newChild, null, globalEnv.rawAppendChild)
  }

  /** 劫持 insertBefore，并把参照节点同步映射到其替代节点。 */
  rawRootNode.prototype.insertBefore = function insertBefore<T extends Node>(newChild: T, refChild: Node | null): T {
    return commonElementHandler(this, newChild, refChild, globalEnv.rawInsertBefore)
  }

  /** 劫持 replaceChild，使新旧节点都遵守动态资源映射。 */
  rawRootNode.prototype.replaceChild = function replaceChild<T extends Node>(newChild: Node, oldChild: T): T {
    return commonElementHandler(this, newChild, oldChild, globalEnv.rawReplaceChild)
  }

  // 删除节点相关原型方法。
  /** 删除原始节点对应的真实替代节点，并容忍应用卸载后的异步清理。 */
  rawRootNode.prototype.removeChild = function removeChild<T extends Node>(oldChild: T): T {
    if (oldChild?.__MICRO_APP_NAME__) {
      const app = appInstanceMap.get(oldChild.__MICRO_APP_NAME__)
      if (app?.container) {
        return invokePrototypeMethod(
          app,
          globalEnv.rawRemoveChild,
          this,
          getMappingNode(oldChild),
        )
      }
      try {
        return globalEnv.rawRemoveChild.call(this, oldChild) as T
      } catch {
        return (oldChild?.parentNode && globalEnv.rawRemoveChild.call(oldChild.parentNode, oldChild)) as T
      }
    }

    return globalEnv.rawRemoveChild.call(this, oldChild) as T
  }

  /** 逐个规范化字符串/节点后执行 append，保持输入顺序。 */
  rawDocumentFragment.prototype.append = rawRootElement.prototype.append = function append(...nodes: (Node | string)[]): void {
    let i = 0
    while (i < nodes.length) {
      let node = nodes[i]
      node = isNode(node) ? node : globalEnv.rawCreateTextNode.call(globalEnv.rawDocument, node)
      commonElementHandler(
        this,
        markElement(node as Node),
        null,
        isDocumentFragment(this) ? globalEnv.rawFragmentAppend : globalEnv.rawAppend,
      )
      i++
    }
  }

  /** 逆序插入输入节点，实现与原生 prepend 相同的最终顺序。 */
  rawDocumentFragment.prototype.prepend = rawRootElement.prototype.prepend = function prepend(...nodes: (Node | string)[]): void {
    let i = nodes.length
    let target = globalEnv.rawPrepend
    if (isDocumentFragment(this) || isDocumentShadowRoot(this)) {
      target = globalEnv.rawFragmentPrepend
    }

    while (i > 0) {
      let node = nodes[i - 1]
      node = isNode(node) ? node : globalEnv.rawCreateTextNode.call(globalEnv.rawDocument, node)
      commonElementHandler(
        this,
        markElement(node as Node),
        null,
        target,
      )
      i--
    }
  }

  /**
   * 劫持 `insertAdjacentElement`，把有应用归属的资源元素转换后插入真实隔离父节点。
   * 第二个参数按平台契约必须仍是 Element；若转换得到注释节点，则保留原元素返回，避免
   * 把不兼容类型传给原生方法。
   * 资源转换先于类型检查，Function 型动态内联脚本可能已经同步执行，再因注释替代节点
   * 而返回原元素且不插入；这个返回值不能表示原 script 已进入 DOM。
   */
  rawRootElement.prototype.insertAdjacentElement = function (where: InsertPosition, element: Element): Element | null {
    if (element?.__MICRO_APP_NAME__ && isElement(element)) {
      const app = appInstanceMap.get(element.__MICRO_APP_NAME__)
      if (app?.container) {
        const processedEle = handleNewNode(element, app) as Element
        if (!isElement(processedEle)) return element
        const realParent = getHijackParent(this, processedEle, app) ?? this
        return globalEnv.rawInsertAdjacentElement.call(realParent, where, processedEle)
      }
    }
    return globalEnv.rawInsertAdjacentElement.call(this, where, element)
  }

  /**
   * 把子应用上下文中的 document.body/head 查询目标映射到 micro-app-body/head。
   *
   * 该映射只在能解析当前应用且实例仍有容器时生效；其他节点保持原查询目标。iframe 与
   * with 沙箱共用此入口，因此应用名优先读取 iframe 临时作用域。
   */
  function getElementQueryTarget(targetNode: Node): Node | null {
    const currentAppName = getIframeCurrentAppName() || getCurrentAppName()
    if ((targetNode === document.body || targetNode === document.head) && currentAppName) {
      const app = appInstanceMap.get(currentAppName)
      if (app?.container) {
        if (targetNode === document.body) {
          return app.querySelector<HTMLElement>('micro-app-body')
        } else if (targetNode === document.head) {
          return app.querySelector<HTMLElement>('micro-app-head')
        }
      }
    }
    return targetNode
  }

  /**
   * 在映射后的 micro-app 容器查询为空时，为 iframe 沙箱补查 iframe 的 head/body。
   *
   * iframe 脚本实际渲染在 iframe 而非 micro-app-body；只在第一次结果为空且当前应用确为
   * iframe 沙箱时回退，避免合并两套结果或改变首个匹配语义。
   *
   * @param isEmpty - 原查询结果是否为空。
   * @param targetNode - 已映射的 micro-app-head/body 查询目标。
   * @param result - 原查询结果。
   * @param selectors - 原选择器。
   * @param methodName - `querySelector` 或 `querySelectorAll`。
   */
  function getElementQueryResult<T>(
    isEmpty: boolean,
    targetNode: Node,
    result: T,
    selectors: string,
    methodName: string,
  ): T {
    if (isEmpty) {
      const currentAppName = getIframeCurrentAppName() || getCurrentAppName()
      if (currentAppName && isIframeSandbox(currentAppName)) {
        const app = appInstanceMap.get(currentAppName)!
        if (isMicroAppHead(targetNode)) {
          return app.sandBox.microHead[methodName](selectors)
        }
        if (isMicroAppBody(targetNode)) {
          return app.sandBox.microBody[methodName](selectors)
        }
      }
    }
    return result
  }

  /** 在必要时改写查询目标，并为 iframe 内容提供空结果回退。 */
  rawRootElement.prototype.querySelector = function querySelector(selectors: string): Node | null {
    const _this = getElementQueryTarget(this) ?? this
    const result = globalEnv.rawElementQuerySelector.call(_this, selectors)
    return getElementQueryResult<Node | null>(
      isNull(result) && _this !== this,
      _this,
      result,
      selectors,
      'querySelector',
    )
  }

  /** querySelectorAll 对应的隔离容器映射与 iframe 空结果回退。 */
  rawRootElement.prototype.querySelectorAll = function querySelectorAll(selectors: string): NodeListOf<Node> {
    const _this = getElementQueryTarget(this) ?? this
    const result = globalEnv.rawElementQuerySelectorAll.call(_this, selectors)
    return getElementQueryResult<NodeListOf<Node>>(
      !result.length && _this !== this,
      _this,
      result,
      selectors,
      'querySelectorAll',
    )
  }

  /**
   * 劫持 setAttribute，为子应用资源属性补全地址，并执行媒体资源跨域配置检查。
   *
   * micro-app 自定义元素的 data 属性必须转回其自定义 setter；其他元素只在能确定应用归属
   * 且属性会触发资源解析时补址。纯 hash 锚点保持原值。媒体分支中 includeCrossOrigin 返回
   * true 时，当前代码写的是未声明的 `node.crossOrigin` 而非 this；没有同名全局变量时，会在
   * 属性已写入后抛出 ReferenceError。
   */
  rawRootElement.prototype.setAttribute = function setAttribute(key: string, value: any): void {
    if (
      /^micro-app(-\S+)?/i.test(this.tagName) &&
      key === 'data' &&
      this.setAttribute !== rawRootElement.prototype.setAttribute
    ) {
      this.setAttribute(key, value)
    } else {
      const appName = this.__MICRO_APP_NAME__ || getCurrentAppName()
      if (
        appName &&
        appInstanceMap.has(appName) &&
        (
          ((key === 'src' || key === 'srcset') && /^(img|script|video|audio|source|embed)$/i.test(this.tagName)) ||
          (key === 'href' && /^(link|image)$/i.test(this.tagName)) ||
          // 纯 hash 锚点只指向当前文档片段，不参与应用基址补全。
          (key === 'href' && /^(a)$/i.test(this.tagName) && !/^#/.test(value))
        )

      ) {
        const app = appInstanceMap.get(appName)
        const aHrefResolver = microApp?.options?.aHrefResolver
        if (key === 'href' && /^a$/i.test(this.tagName) && typeof aHrefResolver === 'function') {
          value = aHrefResolver(value, appName, app!.url)
        } else {
          value = CompletionPath(value, app!.url)
        }
      }
      globalEnv.rawSetAttribute.call(this, key, value)
      if (isImageElement(this) || isVideoElement(this) || isAudioElement(this)) {
        let includeCrossOrigin = false
        if (microApp?.options?.includeCrossOrigin && isFunction(microApp.options.includeCrossOrigin)) {
          includeCrossOrigin = microApp.options.includeCrossOrigin(value)
        }
        // @ts-ignore
        includeCrossOrigin && (node.crossOrigin = 'anonymous')
      }
    }
  }

  /**
   * TODO：兼容直接通过 img.src 等属性设置资源地址的场景。
   * 注意：
   *  1. 卸载时恢复原始值
   *  2. 循环嵌套的情况
   *  3. 放在global_env中统一处理
   *  4. 是否和completePathDynamic的作用重复？
   */
  // const protoAttrList: Array<[HTMLElement, string]> = [
  //   [HTMLImageElement.prototype, 'src'],
  //   [HTMLScriptElement.prototype, 'src'],
  //   [HTMLLinkElement.prototype, 'href'],
  // ]

  // protoAttrList.forEach(([target, attr]) => {
  //   const { enumerable, configurable, get, set } = Object.getOwnPropertyDescriptor(target, attr) || {
  //     enumerable: true,
  //     configurable: true,
  //   }

  //   rawDefineProperty(target, attr, {
  //     enumerable,
  //     configurable,
  //     get: function () {
  //       return get?.call(this)
  //     },
  //     set: function (value) {
  //       const currentAppName = this.__MICRO_APP_NAME__ || getCurrentAppName()
  //       if (currentAppName && appInstanceMap.has(currentAppName)) {
  //         const app = appInstanceMap.get(currentAppName)
  //         value = CompletionPath(value, app!.url)
  //       }
  //       set?.call(this, value)
  //     },
  //   })
  // })

  rawDefineProperty(rawRootNode.prototype, 'parentNode', {
    configurable: true,
    enumerable: true,
    /** 在特定兼容场景重写 html 节点的父级，其余节点返回原生描述符结果。 */
    get() {
      /**
       * with 沙箱中劫持 html.parentNode，兼容 element-ui@2 `popper.js` 判断
       * `element.parentNode === root.document` 的场景；其中 root 是子应用 window，document
       * 因而是 proxyDocument/microDocument。
       */
      const currentAppName = getIframeCurrentAppName() || getCurrentAppName()
      if (currentAppName && this === globalEnv.rawDocument.firstElementChild) {
        const microDocument = appInstanceMap.get(currentAppName)?.sandBox?.proxyWindow?.document
        if (microDocument) return microDocument
      }
      // 必须先处理 html.parentNode 特例，再读取原生描述符结果。
      const result = globalEnv.rawParentNodeDesc.get.call(this)
      /**
       * 这里不统一把 micro-app-body 映射为基座 body，以免清理代码通过错误父级删除节点。
       * 兼容 vue-popper 的映射仅在 invokePrototypeMethod 中定义到实际插入的节点上。
       */
      // if (isMicroAppBody(result) && appInstanceMap.get(this.__MICRO_APP_NAME__)?.container) {
      //   return document.body
      // }
      return result
    },
  })

  rawDefineProperty(rawRootElement.prototype, 'innerHTML', {
    configurable: true,
    enumerable: true,
    /** 通过初始化时保存的原生描述符读取 innerHTML。 */
    get() {
      return globalEnv.rawInnerHTMLDesc.get.call(this)
    },
    /** 写入 innerHTML 后为新生成的直属子节点补充当前应用归属。 */
    set(code: string) {
      globalEnv.rawInnerHTMLDesc.set.call(this, code)
      const currentAppName = this.__MICRO_APP_NAME__ || getIframeCurrentAppName() || getCurrentAppName()
      Array.from(this.children).forEach((child) => {
        if (isElement(child) && currentAppName) {
          updateElementInfo(child, currentAppName)
        }
      })
    }
  })

  /** 克隆节点后把原节点的应用归属写入副本根节点。 */
  rawRootNode.prototype.cloneNode = function cloneNode(deep?: boolean): Node {
    const clonedNode = globalEnv.rawCloneNode.call(this, deep)
    return updateElementInfo(clonedNode, this.__MICRO_APP_NAME__)
  }
}

/**
 * 给新创建或克隆的节点写入当前应用归属。
 *
 * `updateElementInfo()` 会尊重纯净节点与临时禁止标记状态，无法确定应用时保持节点不变。
 *
 * @param element - 待标记节点。
 * @returns 原节点引用。
 */
function markElement<T extends Node>(element: T): T {
  return updateElementInfo(element, getCurrentAppName())
}

/**
 * 安装 Document 创建与查询方法补丁。
 *
 * proxyDocument 的创建操作绑定回真实 document，并给新节点写入应用归属；查询操作在可安全
 * 转成选择器时限制到当前应用容器。body/head/html/title/:root 等唯一元素走原生查询；
 * getElement(s) 方法的非法键或转换后选择器异常回退原生方法，querySelector 本身不做该捕获。
 */
function patchDocument() {
  const rawDocument = globalEnv.rawDocument
  const rawRootDocument = globalEnv.rawRootDocument

  /** 把 with 沙箱的 proxyDocument 还原为真实 document，其他 Document 保持自身。 */
  function getBindTarget(target: Document): Document {
    return isProxyDocument(target) ? rawDocument : target
  }

  // 节点创建方法。
  /** 使用真实 Document 创建元素，并记录当前应用归属。 */
  rawRootDocument.prototype.createElement = function createElement(
    tagName: string,
    options?: ElementCreationOptions,
  ): HTMLElement {
    const element = globalEnv.rawCreateElement.call(getBindTarget(this), tagName, options)
    return markElement(element)
  }

  /** 创建命名空间元素并记录当前应用归属。 */
  rawRootDocument.prototype.createElementNS = function createElementNS(
    namespaceURI: string,
    name: string,
    options?: string | ElementCreationOptions,
  ): any {
    const element = globalEnv.rawCreateElementNS.call(getBindTarget(this), namespaceURI, name, options)
    return markElement(element)
  }

  // TODO：评估并启用 createTextNode 的应用归属标记。
  // rawRootDocument.prototype.createTextNode = function createTextNode (data: string): Text {
  //   const element = globalEnv.rawCreateTextNode.call(getBindTarget(this), data)
  //   return markElement(element)
  // }

  /** 创建 DocumentFragment，并使后续插入操作能识别其应用归属。 */
  rawRootDocument.prototype.createDocumentFragment = function createDocumentFragment(): DocumentFragment {
    const element = globalEnv.rawCreateDocumentFragment.call(getBindTarget(this))
    return markElement(element)
  }

  /** 创建带应用归属的注释节点，供资源占位和后续映射使用。 */
  rawRootDocument.prototype.createComment = function createComment(data: string): Comment {
    const element = globalEnv.rawCreateComment.call(getBindTarget(this), data)
    return markElement(element)
  }

  // 节点查询方法。
  /**
   * 在当前应用容器中执行单元素查询；无应用上下文、空选择器、唯一元素或其他 Document 走原生方法。
   */
  function querySelector(this: Document, selectors: string): any {
    const _this = getBindTarget(this)
    const currentAppName = getCurrentAppName()
    if (
      !currentAppName ||
      !selectors ||
      isUniqueElement(selectors) ||
      // 原生 Document 查询分支的兼容证据：https://github.com/jd-opensource/micro-app/issues/56
      rawDocument !== _this
    ) {
      return globalEnv.rawQuerySelector.call(_this, selectors)
    }

    return appInstanceMap.get(currentAppName)?.querySelector(selectors) ?? null
  }

  /** querySelector 对应的多元素版本，空回退值保持为数组。 */
  function querySelectorAll(this: Document, selectors: string): any {
    const _this = getBindTarget(this)
    const currentAppName = getCurrentAppName()
    if (
      !currentAppName ||
      !selectors ||
      isUniqueElement(selectors) ||
      rawDocument !== _this
    ) {
      return globalEnv.rawQuerySelectorAll.call(_this, selectors)
    }

    return appInstanceMap.get(currentAppName)?.querySelectorAll(selectors) ?? []
  }

  rawRootDocument.prototype.querySelector = querySelector
  rawRootDocument.prototype.querySelectorAll = querySelectorAll

  /**
   * 优先把合法 id 拼成应用容器内的 `#id` 查询；该选择器抛错时回退原生 getElementById。
   */
  rawRootDocument.prototype.getElementById = function getElementById(this: Document, key: string): HTMLElement | null {
    const _this = getBindTarget(this)
    if (!getCurrentAppName() || isInvalidQuerySelectorKey(key)) {
      return globalEnv.rawGetElementById.call(_this, key)
    }

    try {
      return querySelector.call(_this, `#${key}`)
    } catch {
      return globalEnv.rawGetElementById.call(_this, key)
    }
  }

  /** 把合法类名限制在当前应用容器查询；非法输入或选择器异常回退原生方法。 */
  rawRootDocument.prototype.getElementsByClassName = function getElementsByClassName(this: Document, key: string): HTMLCollectionOf<Element> {
    const _this = getBindTarget(this)
    if (!getCurrentAppName() || isInvalidQuerySelectorKey(key)) {
      return globalEnv.rawGetElementsByClassName.call(_this, key)
    }

    try {
      return querySelectorAll.call(_this, `.${key}`)
    } catch {
      return globalEnv.rawGetElementsByClassName.call(_this, key)
    }
  }

  /**
   * 把标签查询限制在当前应用；唯一标签及非 inline 模式的 script 查询保留原生全局语义。
   */
  rawRootDocument.prototype.getElementsByTagName = function getElementsByTagName(this: Document, key: string): HTMLCollectionOf<Element> {
    const _this = getBindTarget(this)
    const currentAppName = getCurrentAppName()
    if (
      !currentAppName ||
      isUniqueElement(key) ||
      isInvalidQuerySelectorKey(key) ||
      (!appInstanceMap.get(currentAppName)?.inline && /^script$/i.test(key))
    ) {
      return globalEnv.rawGetElementsByTagName.call(_this, key)
    }

    try {
      return querySelectorAll.call(_this, key)
    } catch {
      return globalEnv.rawGetElementsByTagName.call(_this, key)
    }
  }

  /** 把合法 name 转成应用容器内的属性选择器；失败时回退原生方法。 */
  rawRootDocument.prototype.getElementsByName = function getElementsByName(this: Document, key: string): NodeListOf<HTMLElement> {
    const _this = getBindTarget(this)
    if (!getCurrentAppName() || isInvalidQuerySelectorKey(key)) {
      return globalEnv.rawGetElementsByName.call(_this, key)
    }

    try {
      return querySelectorAll.call(_this, `[name=${key}]`)
    } catch {
      return globalEnv.rawGetElementsByName.call(_this, key)
    }
  }
}

/** 恢复下列 Document 创建和查询方法；createComment 未在此恢复。 */
function releasePatchDocument(): void {
  const rawRootDocument = globalEnv.rawRootDocument
  rawRootDocument.prototype.createElement = globalEnv.rawCreateElement
  rawRootDocument.prototype.createElementNS = globalEnv.rawCreateElementNS
  rawRootDocument.prototype.createDocumentFragment = globalEnv.rawCreateDocumentFragment
  rawRootDocument.prototype.querySelector = globalEnv.rawQuerySelector
  rawRootDocument.prototype.querySelectorAll = globalEnv.rawQuerySelectorAll
  rawRootDocument.prototype.getElementById = globalEnv.rawGetElementById
  rawRootDocument.prototype.getElementsByClassName = globalEnv.rawGetElementsByClassName
  rawRootDocument.prototype.getElementsByTagName = globalEnv.rawGetElementsByTagName
  rawRootDocument.prototype.getElementsByName = globalEnv.rawGetElementsByName
}

/**
 * 释放全局 DOM 补丁并恢复初始化时保存的原型方法与属性描述符。
 *
 * 先清除当前应用 DOM 作用域，再恢复下列 Document、Node 与 Element 方法及属性描述符。
 * Document.createComment、DocumentFragment.append/prepend 与 Element.insertAdjacentElement 不在此释放。调用方只在没有
 * 活跃沙箱依赖补丁时执行。
 */
export function releasePatchElementAndDocument(): void {
  removeDomScope()
  releasePatchDocument()

  const rawRootElement = globalEnv.rawRootElement
  const rawRootNode = globalEnv.rawRootNode
  rawRootNode.prototype.appendChild = globalEnv.rawAppendChild
  rawRootNode.prototype.insertBefore = globalEnv.rawInsertBefore
  rawRootNode.prototype.replaceChild = globalEnv.rawReplaceChild
  rawRootNode.prototype.removeChild = globalEnv.rawRemoveChild
  rawRootNode.prototype.cloneNode = globalEnv.rawCloneNode
  rawRootElement.prototype.append = globalEnv.rawAppend
  rawRootElement.prototype.prepend = globalEnv.rawPrepend
  rawRootElement.prototype.querySelector = globalEnv.rawElementQuerySelector
  rawRootElement.prototype.querySelectorAll = globalEnv.rawElementQuerySelectorAll
  rawRootElement.prototype.setAttribute = globalEnv.rawSetAttribute
  rawDefineProperty(rawRootNode.prototype, 'parentNode', globalEnv.rawParentNodeDesc)
  rawDefineProperty(rawRootElement.prototype, 'innerHTML', globalEnv.rawInnerHTMLDesc)
}

/** 标记基础容器样式是否已注入，保证多个沙箱初始化只写入一个 style。 */
let hasRejectMicroAppStyle = false

/**
 * 一次性注入 micro-app 容器基础显示规则。
 *
 * micro-app 与 body 参与布局，head 保持隐藏。style 由纯净元素工厂创建并用原始
 * `setAttribute` 配置，因此即使原型补丁已存在，也不会进入应用资源转换分支。
 */
export function rejectMicroAppStyle(): void {
  if (!hasRejectMicroAppStyle) {
    hasRejectMicroAppStyle = true
    const style = pureCreateElement('style')
    globalEnv.rawSetAttribute.call(style, 'type', 'text/css')
    style.textContent = `\n${microApp.tagName}, micro-app-body { display: block; } \nmicro-app-head { display: none; }`
    globalEnv.rawDocument.head.appendChild(style)
  }
}
