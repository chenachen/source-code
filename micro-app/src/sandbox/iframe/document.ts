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
 * 在 iframe 文档与主文档间选择真实目标。结构属性和全局文档方法目前统一桥接主文档，未按 ShadowRoot 分流。
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
   * 普通选择器先查子应用容器，无结果时回退 iframe 文档；文档唯一结构元素查询主文档。
   * 精确的 `body` 选择器在未继承基座 body 时读取 this.body；独立解析文档仍查询自身。
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
     * 精确的 `base` 选择器不回退到 iframe 模板，`querySelectorAll` 同样处理。
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
   * 普通选择器先查子应用容器，无结果才回退 iframe；精确的 `base` 选择器不回退。
   * 唯一结构元素仍查询主文档，独立解析文档查询自身。
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
    // script 直接查询 iframe 模板；普通标签仍走容器优先路径，精确的 base 不回退模板。
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

  // body 未继承基座时从创建沙箱时的 options.container 查找 micro-app-body，找不到则返回宿主 body。
  // 其他结构属性直接读取宿主；这里没有把 options.container 更新为应用后续切换的新容器。
  uniqueDocumentElement.forEach((tagName: string) => {
    rawDefineProperty(microDocument, tagName, {
      enumerable: true,
      configurable: true,
      /** 读取结构属性时标记当前应用；body 优先使用创建时容器，其他结构属性读取宿主文档。 */
      get: () => {
        throttleDeferForIframeAppName(appName)
        if (tagName === 'body' && microApp?.options?.inheritBaseBody !== true) {
          return sandbox.options.container?.querySelector('micro-app-body') || rawDocument[tagName]
        }
        return rawDocument[tagName]
      },
      /** 结构属性赋值直接转发宿主，不替换 iframe 内部原生 head/body 引用。 */
      set: (value: unknown) => { rawDocument[tagName] = value },
    })
  })
}

/**
 * 接管 iframe 文档事件，并提供可记录、重建和释放的副作用快照。
 *
 * DOMContentLoaded/readystatechange 使用调用方法的文档，其余事件绑定到主文档。
 * 函数监听器首次登记时缓存绑定调用文档的函数；handleEvent 对象保持原引用。
 * 释放通过缓存函数定位真实绑定，不处理未纳入快照的其他 on* 属性。
 * 登记表只按事件名/回调保存，不保存调用文档；独立文档的 scope 事件释放、重建仍使用主 microDocument，
 * 因而不保证从原独立文档移除，也不会重建到原文档。缓存函数的 this 仍是第一次登记时的调用文档。
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
   * @param bindTarget 调用事件方法的文档；释放阶段使用沙箱的 microDocument。
   * @returns 事件应绑定的真实目标。
   */
  function getEventTarget (type: string, bindTarget: Document): Document {
    return SCOPE_DOCUMENT_EVENT.includes(type) ? bindTarget : rawDocument
  }

  /** 按事件名登记回调引用；函数首次绑定调用文档后缓存在回调对象上，options 也保存在该对象上。 */
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

  /**
   * 从活动登记表删除回调，并用缓存函数、调用文档和传入 options 尝试解除真实绑定。
   * 登记不区分 capture 或调用文档；移除条件不匹配时记录会先消失，原目标的绑定仍可保留。
   */
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
   * 除 onclick 由快照钩子管理外，这些赋值直接改写主文档属性；release 不恢复它们的旧值。
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
          /** onclick 返回可快照的独立槽位；其他 on 属性反映宿主当前处理器。 */
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
   * UMD 软卸载、keep-alive 隐藏和预渲染完成都可能触发记录，同一次生命周期甚至会调用两次；
   * 因此监听器集合取并集；onclick 采用当前非假值，否则保留旧快照。
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
    // 当前槽位是假值时恢复旧 onclick；已设置的新函数优先，null 等假值也满足恢复条件。
    if (sstOnClickHandler && !onClickHandler) microDocument.onclick = sstOnClickHandler

    sstEventListenerMap.forEach((listenerList, type) => {
      for (const listener of listenerList) {
        microDocument.addEventListener(type, listener, listener?.__MICRO_APP_MARK_OPTIONS__)
      }
    })

    reset()
  }

  /**
   * 移除 onclick 绑定并清空当前子应用的文档监听器登记。
   *
   * 清理必须使用缓存的绑定函数和对应的真实目标，否则 `removeEventListener` 无法命中，子应用卸载后
   * 仍会收到主文档事件。这里未传 options，只匹配 capture=false；capture=true 需应用自行以相同选项解除。
   */
  const release = (): void => {
    // 清理由子应用通过 document.onclick 绑定的函数。
    if (isFunction(onClickHandler)) {
      rawRemoveEventListener.call(rawDocument, 'click', onClickHandler)
    }
    onClickHandler = null

    // 按主 microDocument/宿主文档尝试解除登记项；这里不保存独立文档或 capture=true 的原绑定元组。
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
