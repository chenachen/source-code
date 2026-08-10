import type {
  microAppWindowType,
  MicroEventListener,
  CommonEffectHook,
} from '@micro-app/types'
import type IframeSandbox from './index'
import {
  rawDefineProperty,
  rawDefineProperties,
  isFunction,
  logWarn,
  isUniqueElement,
  isInvalidQuerySelectorKey,
  throttleDeferForIframeAppName,
  isWebComponentElement,
} from '../../libs/utils'
import globalEnv from '../../libs/global_env'
import bindFunctionToRawTarget from '../bind_function'
import {
  uniqueDocumentElement,
  proxy2RawDocOrShadowKeys,
  proxy2RawDocOrShadowMethods,
  proxy2RawDocumentKeys,
  proxy2RawDocumentMethods,
} from './special_key'
import {
  SCOPE_DOCUMENT_EVENT,
  SCOPE_DOCUMENT_ON_EVENT,
} from '../../constants'
import {
  updateElementInfo,
} from '../adapter'
import {
  appInstanceMap,
} from '../../create_app'
import microApp from '../../micro_app'

/**
 * 修补 iframe 子应用的 `Document` 原型、宿主属性与事件副作用，并返回可做快照的清理钩子。
 *
 * 这里同时承担两层桥接：DOM 查询/创建需要在子应用容器与主文档间选择正确目标，事件监听则需要
 * 在 iframe realm 的 `document` 外观下登记到实际生效的宿主文档。后续仍需完善 Shadow DOM 支持并梳理结构。
 *
 * @param appName 子应用名称，用于查找容器并标记新建节点的归属。
 * @param microAppWindow iframe realm 中的子应用窗口。
 * @param sandbox 当前 iframe 沙箱，用于读取代理路由与容器配置。
 * @returns 支持记录、重建和释放 document 副作用的钩子。
 */
export function patchDocument (
  appName: string,
  microAppWindow: microAppWindowType,
  sandbox: IframeSandbox,
): CommonEffectHook {
  patchDocumentPrototype(appName, microAppWindow)
  patchDocumentProperty(appName, microAppWindow, sandbox)

  return patchDocumentEffect(appName, microAppWindow)
}

/**
 * 选择元素创建 API 的真实接收者。
 *
 * 默认保留 iframe realm 的文档，从而让普通节点属于子应用 realm；显式关闭 iframe 根文档隔离时则
 * 回退到主文档，以兼容必须在宿主 realm 创建节点的场景。
 *
 * @param microDocument iframe realm 的文档实例。
 * @param rawDocument 主应用原始文档。
 * @returns 本次 DOM 创建应绑定的文档。
 */
function getElementDocument(microDocument: Document, rawDocument: Document): Document {
  if (microApp?.options?.disableIframeRootDocument) {
    return rawDocument
  }
  return microDocument
}

/**
 * 重写 iframe realm 的 `Document.prototype`，把 DOM 创建、查询和光标定位桥接到子应用容器。
 *
 * 被保存的原始方法始终来自 iframe realm，调用时再显式指定目标文档，避免跨 realm 方法身份和
 * `this` 校验不一致；所有返回的新节点都会写入子应用归属信息，供后续 DOM 适配器继续路由。
 *
 * @param appName 子应用名称。
 * @param microAppWindow iframe realm 的窗口对象。
 */
function patchDocumentPrototype (appName: string, microAppWindow: microAppWindowType): void {
  const rawDocument = globalEnv.rawDocument
  const microRootDocument = microAppWindow.Document
  const microDocument = microAppWindow.document
  const rawMicroCreateElement = microRootDocument.prototype.createElement
  const rawMicroCreateElementNS = microRootDocument.prototype.createElementNS
  const rawMicroCreateTextNode = microRootDocument.prototype.createTextNode
  const rawMicroCreateDocumentFragment = microRootDocument.prototype.createDocumentFragment
  const rawMicroCreateComment = microRootDocument.prototype.createComment
  const rawMicroQuerySelector = microRootDocument.prototype.querySelector
  const rawMicroQuerySelectorAll = microRootDocument.prototype.querySelectorAll
  const rawMicroGetElementById = microRootDocument.prototype.getElementById
  const rawMicroGetElementsByClassName = microRootDocument.prototype.getElementsByClassName
  const rawMicroGetElementsByTagName = microRootDocument.prototype.getElementsByTagName
  const rawMicroGetElementsByName = microRootDocument.prototype.getElementsByName
  const rawMicroElementFromPoint = microRootDocument.prototype.elementFromPoint
  const rawMicroCaretRangeFromPoint = microRootDocument.prototype.caretRangeFromPoint
  const rawMicroCaretPositionFromPoint = microRootDocument.prototype.caretPositionFromPoint

  /**
   * Firefox 可能不支持 `caretRangeFromPoint`，因此只在 iframe realm 暴露该能力时覆写。
   *
   * @see https://developer.mozilla.org/zh-CN/docs/Web/API/Document/caretRangeFromPoint
   */
  if (isFunction(rawMicroCaretRangeFromPoint)) {
    /**
     * 在主文档坐标系中计算光标范围，并给命中的元素补充子应用归属。
     *
     * 方法必须以真实文档为 `this` 才能成功创建 `Range`，不能直接依赖代理文档的隐式绑定。
     */
    microRootDocument.prototype.caretRangeFromPoint = function caretRangeFromPoint (
      x: number,
      y: number,
    ): Range {
      // WHY：原生实现会校验 `this` 的文档身份；显式绑定真实文档后才能创建有效 Range。
      const element = rawMicroElementFromPoint.call(rawDocument, x, y)
      const range = rawMicroCaretRangeFromPoint.call(rawDocument, x, y)
      updateElementInfo(element, appName)
      return range
    }
  }

  if (isFunction(rawMicroCaretPositionFromPoint)) {
    /**
     * 在主文档坐标系中计算光标位置，并给命中的元素补充子应用归属。
     */
    microRootDocument.prototype.caretPositionFromPoint = function caretPositionFromPoint (
      x: number,
      y: number,
    ): CaretPosition {
      // WHY：原生实现会校验 `this` 的文档身份；显式绑定真实文档后才能返回有效光标位置。
      const element = rawMicroElementFromPoint.call(rawDocument, x, y)
      const range = rawMicroCaretPositionFromPoint.call(rawDocument, x, y)
      updateElementInfo(element, appName)
      return range
    }
  }

  /**
   * 在选定文档 realm 中创建元素，并将 Web Component 回退到主文档创建以复用已注册的构造器。
   */
  microRootDocument.prototype.createElement = function createElement (
    tagName: string,
    options?: ElementCreationOptions,
  ): HTMLElement {
    let element = rawMicroCreateElement.call(getElementDocument(this, rawDocument), tagName, options)
    if (isWebComponentElement(element)) {
      element = rawMicroCreateElement.call(rawDocument, tagName, options)
    }
    return updateElementInfo(element, appName)
  }

  /** 创建带命名空间的子应用元素，并记录其应用归属。 */
  microRootDocument.prototype.createElementNS = function createElementNS (
    namespaceURI: string,
    name: string,
    options?: string | ElementCreationOptions,
  ): HTMLElement {
    const element = rawMicroCreateElementNS.call(getElementDocument(this, rawDocument), namespaceURI, name, options)
    return updateElementInfo(element, appName)
  }

  /** 创建属于当前子应用的文本节点。 */
  microRootDocument.prototype.createTextNode = function createTextNode (data: string): Text {
    const element = rawMicroCreateTextNode.call(getElementDocument(this, rawDocument), data)
    return updateElementInfo<Text>(element, appName)
  }

  /** 创建属于当前子应用的文档片段。 */
  microRootDocument.prototype.createDocumentFragment = function createDocumentFragment (): DocumentFragment {
    const element = rawMicroCreateDocumentFragment.call(getElementDocument(this, rawDocument))
    return updateElementInfo(element, appName)
  }

  /** 创建属于当前子应用的注释节点。 */
  microRootDocument.prototype.createComment = function createComment (data: string): Comment {
    const element = rawMicroCreateComment.call(getElementDocument(this, rawDocument), data)
    return updateElementInfo<Comment>(element, appName)
  }

  /**
   * 解析文档方法的真实绑定目标，并在查询前刷新当前 iframe 子应用的 DOM 作用域。
   *
   * `DOMParser` 产生的独立文档必须保持自身为接收者；只有 iframe 的主 `microDocument` 才映射到
   * 主文档，否则跨文档查询会错误泄漏到宿主页面。
   *
   * @param target 调用查询方法的文档。
   * @returns 查询应绑定的真实文档。
   */
  function getBindTarget (target: Document): Document {
    // 覆盖链式查询，例如从 head/body 继续调用 querySelector(All) 的场景。
    throttleDeferForIframeAppName(appName)
    // WHY：DOMParser 的 document 不等于 microDocument，必须保留独立文档边界。
    return microDocument === target ? rawDocument : target
  }

  /**
   * 优先在子应用容器中查询元素，必要时回退到 iframe 文档。
   *
   * @param selectors CSS 选择器。
   * @returns 首个匹配元素；无结果时为 `null`。
   */
  function querySelector (this: Document, selectors: string): any {
    const _this = getBindTarget(this)
    if (selectors === 'body' && microApp?.options?.inheritBaseBody !== true) {
      return this.body
    }
    if (
      !selectors ||
      isUniqueElement(selectors) ||
      rawDocument !== _this
    ) {
      return rawMicroQuerySelector.call(_this, selectors)
    }

    /**
     * 子应用不能查询 iframe 模板中的 `base`，`querySelectorAll` 同样遵守该约束。
     *
     * 典型场景是 vue-router 4 的 `createWebHistory` 会读取 `document.querySelector('base')`；若把
     * 沙箱内部的 base 暴露出去，路由基址会被错误覆盖，因此 base 查无结果时也不能回退。
     *
     * @see https://github.com/jd-opensource/micro-app/issues/1335
     */
    const result = appInstanceMap.get(appName)?.querySelector(selectors)
    return result || selectors === 'base' ? result : rawMicroQuerySelector.call(microDocument, selectors)
  }

  /**
   * 查询子应用容器内的全部匹配元素，并维持 `base` 不可见的不变量。
   *
   * @param selectors CSS 选择器。
   * @returns 匹配元素集合。
   */
  function querySelectorAll (this: Document, selectors: string): any {
    const _this = getBindTarget(this)
    if (
      !selectors ||
      isUniqueElement(selectors) ||
      rawDocument !== _this
    ) {
      return rawMicroQuerySelectorAll.call(_this, selectors)
    }

    const result = appInstanceMap.get(appName)?.querySelectorAll(selectors) ?? []
    return result.length || selectors === 'base' ? result : rawMicroQuerySelectorAll.call(microDocument, selectors)
  }

  microRootDocument.prototype.querySelector = querySelector
  microRootDocument.prototype.querySelectorAll = querySelectorAll

  /** 按 id 查询子应用节点；非法选择器键或解析失败时回退到原生实现。 */
  microRootDocument.prototype.getElementById = function getElementById (key: string): HTMLElement | null {
    const _this = getBindTarget(this)
    if (isInvalidQuerySelectorKey(key)) {
      return rawMicroGetElementById.call(_this, key)
    }

    try {
      return querySelector.call(getElementDocument(this, rawDocument), `#${key}`)
    } catch {
      return rawMicroGetElementById.call(_this, key)
    }
  }

  /** 按 class 查询子应用节点；非法选择器键或解析失败时回退到原生实现。 */
  microRootDocument.prototype.getElementsByClassName = function getElementsByClassName (key: string): HTMLCollectionOf<Element> {
    const _this = getBindTarget(this)
    if (isInvalidQuerySelectorKey(key)) {
      return rawMicroGetElementsByClassName.call(_this, key)
    }

    try {
      return querySelectorAll.call(getElementDocument(this, rawDocument), `.${key}`)
    } catch {
      return rawMicroGetElementsByClassName.call(_this, key)
    }
  }

  /** 按标签名查询子应用节点，并让结构唯一标签及 iframe 脚本遵守各自的文档边界。 */
  microRootDocument.prototype.getElementsByTagName = function getElementsByTagName (key: string): HTMLCollectionOf<Element> {
    const _this = getBindTarget(getElementDocument(this, rawDocument))
    if (
      isUniqueElement(key) ||
      isInvalidQuerySelectorKey(key)
    ) {
      return rawMicroGetElementsByTagName.call(_this, key)
    // iframe 模板只允许脚本查询回退，不能把内部 base 暴露给子应用路由。
    } else if (/^script$/i.test(key)) {
      return rawMicroGetElementsByTagName.call(microDocument, key)
    }

    try {
      return querySelectorAll.call(getElementDocument(this, rawDocument), key)
    } catch {
      return rawMicroGetElementsByTagName.call(_this, key)
    }
  }

  /** 按 name 属性查询子应用节点；选择器不安全时回退到原生实现。 */
  microRootDocument.prototype.getElementsByName = function getElementsByName (key: string): NodeListOf<HTMLElement> {
    const _this = getBindTarget(getElementDocument(this, rawDocument))
    if (isInvalidQuerySelectorKey(key)) {
      return rawMicroGetElementsByName.call(_this, key)
    }

    try {
      return querySelectorAll.call(getElementDocument(this, rawDocument), `[name=${key}]`)
    } catch {
      return rawMicroGetElementsByName.call(_this, key)
    }
  }
}

/**
 * 给 iframe realm 的文档补充动态宿主属性描述符。
 *
 * 路由字段从沙箱代理 location 读取，结构字段与全局 document API 则按隔离策略桥接到主文档；
 * 描述符统一安装在 iframe `Document.prototype`，因此 ES module 等绕过 `proxyWindow` 的代码也能生效。
 *
 * @param appName 子应用名称。
 * @param microAppWindow iframe realm 的窗口对象。
 * @param sandbox 当前 iframe 沙箱。
 */
function patchDocumentProperty (
  appName: string,
  microAppWindow: microAppWindowType,
  sandbox: IframeSandbox,
): void {
  const rawDocument = globalEnv.rawDocument
  const microRootDocument = microAppWindow.Document
  const microDocument = microAppWindow.document

  /**
   * 生成保留原枚举性的只读访问器描述符。
   *
   * @param key 要代理的文档属性。
   * @param getter 动态解析属性值的读取器。
   * @returns 可安装到 `Document.prototype` 的描述符。
   */
  const getCommonDescriptor = (key: PropertyKey, getter: () => unknown): PropertyDescriptor => {
    const { enumerable } = Object.getOwnPropertyDescriptor(microRootDocument.prototype, key) || {
      enumerable: true,
    }
    return {
      configurable: true,
      enumerable,
      get: getter,
    }
  }

  /**
   * 汇总路由、结构节点和原生 document 能力的桥接描述符。
   *
   * 方法值在返回前绑定真实主文档，避免跨 realm 调用触发非法 `this`；Shadow DOM 尚未单独分流，
   * 当前相关键统一代理到原始文档。
   *
   * @returns 要一次性安装的属性描述符映射。
   */
  const createDescriptors = (): PropertyDescriptorMap => {
    const result: PropertyDescriptorMap = {}
    const descList: Array<[string, () => unknown]> = [
      // 即使禁用内存路由，URL 语义也统一由 proxyLocation 决定；该代理会按模式指向主应用地址。
      ['documentURI', () => sandbox.proxyLocation.href],
      ['URL', () => sandbox.proxyLocation.href],
      ['documentElement', () => rawDocument.documentElement],
      ['scrollingElement', () => rawDocument.scrollingElement],
      ['forms', () => microRootDocument.prototype.querySelectorAll.call(microDocument, 'form')],
      ['images', () => microRootDocument.prototype.querySelectorAll.call(microDocument, 'img')],
      ['links', () => microRootDocument.prototype.querySelectorAll.call(microDocument, 'a')],
      // micro-app 专属元数据只存在于子应用文档外观上。
      ['microAppElement', () => appInstanceMap.get(appName)?.container],
      ['__MICRO_APP_NAME__', () => appName],
    ]

    descList.forEach((desc) => {
      result[desc[0]] = getCommonDescriptor(desc[0], desc[1])
    })

    // TODO：接入 Shadow DOM 后需按容器类型选择 rawDocument 或 shadowRoot。
    proxy2RawDocOrShadowKeys.forEach((key) => {
      result[key] = getCommonDescriptor(key, () => rawDocument[key])
    })

    // TODO：接入 Shadow DOM 后需按容器类型选择 rawDocument 或 shadowRoot。
    proxy2RawDocOrShadowMethods.forEach((key) => {
      result[key] = getCommonDescriptor(key, () => bindFunctionToRawTarget<Document>(rawDocument[key], rawDocument, 'DOCUMENT'))
    })

    proxy2RawDocumentKeys.forEach((key) => {
      result[key] = getCommonDescriptor(key, () => rawDocument[key])
    })

    proxy2RawDocumentMethods.forEach((key) => {
      result[key] = getCommonDescriptor(key, () => bindFunctionToRawTarget<Document>(rawDocument[key], rawDocument, 'DOCUMENT'))
    })

    return result
  }

  rawDefineProperties(microRootDocument.prototype, createDescriptors())

  // 唯一结构元素必须映射到宿主 DOM；body 可按配置改为子应用的 micro-app-body 容器。
  uniqueDocumentElement.forEach((tagName: string) => {
    rawDefineProperty(microDocument, tagName, {
      enumerable: true,
      configurable: true,
      get: () => {
        throttleDeferForIframeAppName(appName)
        if (tagName === 'body' && microApp?.options?.inheritBaseBody !== true) {
          return sandbox.options.container?.querySelector('micro-app-body') || rawDocument[tagName]
        }
        return rawDocument[tagName]
      },
      set: (value: unknown) => { rawDocument[tagName] = value },
    })
  })
}

/**
 * 接管 iframe 文档事件，并提供可记录、重建和释放的副作用快照。
 *
 * 需要文档作用域的事件绑定到 iframe 文档，其余事件绑定到主文档；监听器仍以 iframe 文档为
 * `this`，从而同时维持事件传播位置和子应用 realm 语义。释放阶段会逐项解除真实绑定，避免卸载泄漏。
 *
 * @param appName 子应用名称，用于输出属性修补失败告警。
 * @param microAppWindow iframe realm 的窗口对象。
 * @returns document 事件副作用钩子。
 */
function patchDocumentEffect (appName: string, microAppWindow: microAppWindowType): CommonEffectHook {
  const { rawDocument, rawAddEventListener, rawRemoveEventListener, rawDispatchEvent } = globalEnv
  const eventListenerMap = new Map<string, Set<MicroEventListener>>()
  const sstEventListenerMap = new Map<string, Set<MicroEventListener>>()
  let onClickHandler: unknown = null
  let sstOnClickHandler: unknown = null
  const microRootDocument = microAppWindow.Document
  const microDocument = microAppWindow.document

  /**
   * 根据事件类型选择实际绑定文档。
   *
   * @param type 事件类型。
   * @param bindTarget 当前 iframe 文档。
   * @returns 事件应绑定的真实目标。
   */
  function getEventTarget (type: string, bindTarget: Document): Document {
    return SCOPE_DOCUMENT_EVENT.includes(type) ? bindTarget : rawDocument
  }

  /** 登记 iframe 文档监听器，并缓存绑定当前文档的稳定函数。 */
  microRootDocument.prototype.addEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const handler = isFunction(listener) ? (listener.__MICRO_APP_BOUND_FUNCTION__ = listener.__MICRO_APP_BOUND_FUNCTION__ || listener.bind(this)) : listener
    const listenerList = eventListenerMap.get(type)
    if (listenerList) {
      listenerList.add(listener)
    } else {
      eventListenerMap.set(type, new Set([listener]))
    }
    listener && (listener.__MICRO_APP_MARK_OPTIONS__ = options)
    rawAddEventListener.call(getEventTarget(type, this), type, handler, options)
  }

  /** 从快照登记表与真实目标上同步移除 iframe 文档监听器。 */
  microRootDocument.prototype.removeEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const listenerList = eventListenerMap.get(type)
    if (listenerList?.size && listenerList.has(listener)) {
      listenerList.delete(listener)
    }
    const handler = listener?.__MICRO_APP_BOUND_FUNCTION__ || listener
    rawRemoveEventListener.call(getEventTarget(type, this), type, handler, options)
  }

  /** 将事件派发到与监听器相同的真实文档目标。 */
  microRootDocument.prototype.dispatchEvent = function (event: Event): boolean {
    return rawDispatchEvent.call(getEventTarget(event?.type, this), event)
  }

  /**
   * 为 `document.on*` 属性创建写入器。
   *
   * `onclick` 需要单独登记真实监听器以支持副作用快照；其他 on 属性直接代理到主文档，并将函数
   * 绑定到 iframe 文档以保持回调中的 `this`。
   *
   * @param eventName `on` 前缀的事件属性名。
   * @returns 属性写入处理器。
   */
  function createSetterHandler (eventName: string): (value: unknown) => void {
    if (eventName === 'onclick') {
      return (value: unknown): void => {
        if (isFunction(onClickHandler)) {
          rawRemoveEventListener.call(rawDocument, 'click', onClickHandler, false)
        }
        if (isFunction(value)) {
          onClickHandler = value.bind(microDocument)
          rawAddEventListener.call(rawDocument, 'click', onClickHandler, false)
        } else {
          onClickHandler = value
        }
      }
    }
    return (value: unknown) => { rawDocument[eventName] = isFunction(value) ? value.bind(microDocument) : value }
  }

  /**
   * 将非文档作用域的 `on*` 属性代理到主文档。
   *
   * TODO：继续验证直接代理原生 document 的兼容性，并在 Shadow DOM 模式下选择正确事件目标。
   */
  Object.getOwnPropertyNames(microRootDocument.prototype)
    .filter((key: string) => /^on/.test(key) && !SCOPE_DOCUMENT_ON_EVENT.includes(key))
    .forEach((eventName: string) => {
      const { enumerable, writable, set } = Object.getOwnPropertyDescriptor(microRootDocument.prototype, eventName) || {
        enumerable: true,
        writable: true,
      }

      try {
        rawDefineProperty(microRootDocument.prototype, eventName, {
          enumerable,
          configurable: true,
          get: () => {
            if (eventName === 'onclick') return onClickHandler
            return rawDocument[eventName]
          },
          set: writable ?? !!set ? createSetterHandler(eventName) : undefined,
        })
      } catch (e) {
        logWarn(e, appName)
      }
    })

  /** 清空已记录的事件快照，不触碰当前仍在运行的真实监听器。 */
  const reset = (): void => {
    sstEventListenerMap.clear()
    sstOnClickHandler = null
  }

  /**
   * 合并记录当前 document 事件副作用，供预渲染或 keep-alive 恢复时重建。
   *
   * UMD 挂载、keep-alive 隐藏和预渲染完成都可能触发记录，同一次生命周期甚至会调用两次；
   * 因此这里使用集合合并并保留旧 `onclick`，而不是覆盖快照。
   */
  const record = (): void => {
    // onclick 在预渲染或 keep-alive 隐藏后可能再次赋值，空值不能覆盖已有快照。
    sstOnClickHandler = onClickHandler || sstOnClickHandler

    // 集合合并保证重复记录是幂等的，同时保留两次记录之间新增的监听器。
    eventListenerMap.forEach((listenerList, type) => {
      if (listenerList.size) {
        const cacheList = sstEventListenerMap.get(type) || []
        sstEventListenerMap.set(type, new Set([...cacheList, ...listenerList]))
      }
    })
  }

  /** 在重新挂载前恢复已记录的文档事件，并在成功登记后清空快照。 */
  const rebuild = (): void => {
    // 只在当前 onclick 尚未重新赋值时恢复，避免覆盖应用的新状态。
    if (sstOnClickHandler && !onClickHandler) microDocument.onclick = sstOnClickHandler

    sstEventListenerMap.forEach((listenerList, type) => {
      for (const listener of listenerList) {
        microDocument.addEventListener(type, listener, listener?.__MICRO_APP_MARK_OPTIONS__)
      }
    })

    reset()
  }

  /**
   * 解除当前子应用登记的全部文档事件。
   *
   * 清理必须使用缓存的绑定函数和对应的真实目标，否则 `removeEventListener` 无法命中，子应用卸载后
   * 仍会收到主文档事件。
   */
  const release = (): void => {
    // 清理由子应用通过 document.onclick 绑定的函数。
    if (isFunction(onClickHandler)) {
      rawRemoveEventListener.call(rawDocument, 'click', onClickHandler)
    }
    onClickHandler = null

    // 清理通过 document.addEventListener 登记的全部真实绑定。
    if (eventListenerMap.size) {
      eventListenerMap.forEach((listenerList, type) => {
        for (const listener of listenerList) {
          rawRemoveEventListener.call(
            getEventTarget(type, microDocument),
            type,
            listener?.__MICRO_APP_BOUND_FUNCTION__ || listener,
          )
        }
      })
      eventListenerMap.clear()
    }
  }

  return {
    reset,
    record,
    rebuild,
    release,
  }
}
