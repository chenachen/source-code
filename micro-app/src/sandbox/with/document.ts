/* eslint-disable no-cond-assign */
import type {
  CommonEffectHook,
  MicroEventListener,
  WithSandBoxInterface,
  microAppWindowType,
} from '@micro-app/types'
import microApp from '../../micro_app'
import globalEnv from '../../libs/global_env'
import bindFunctionToRawTarget from '../bind_function'
import {
  throttleDeferForSetAppName,
  isFunction,
  rawDefineProperties,
} from '../../libs/utils'
import {
  appInstanceMap,
} from '../../create_app'
import {
  updateElementInfo,
} from '../adapter'

/**
 * 为 with 沙箱创建 proxyDocument 与 MicroDocument 构造器，并注入隔离 window。
 *
 * @remarks
 * 文档数据仍来自基座 document；Proxy 负责节点归属和副作用追踪，MicroDocument 则补齐构造器、原型及 `instanceof` 语义。
 *
 * @param appName - 当前应用名。
 * @param microAppWindow - window Proxy 的隔离目标。
 * @param sandbox - 提供 proxyWindow 的 with 沙箱。
 * @returns document 事件快照钩子。
 */
export function patchDocument (
  appName: string,
  microAppWindow: microAppWindowType,
  sandbox: WithSandBoxInterface,
): CommonEffectHook {
  const { proxyDocument, documentEffect } = createProxyDocument(appName, sandbox)
  const MicroDocument = createMicroDocument(appName, proxyDocument)
  rawDefineProperties(microAppWindow, {
    document: {
      configurable: false,
      enumerable: true,
      /** 返回带节点归属与副作用追踪的 document Proxy。 */
      get () {
        // 若直接返回 globalEnv.rawDocument，将绕过子应用节点标记和事件清理。
        return proxyDocument
      },
    },
    Document: {
      configurable: false,
      enumerable: false,
      /** 返回桥接原生原型链的 MicroDocument 构造器。 */
      get () {
        // 若直接返回 globalEnv.rawRootDocument，将丢失子应用 `instanceof` 与方法绑定边界。
        return MicroDocument
      },
    }
  })

  return documentEffect
}

/**
 * 创建基于原生 document 的 Proxy，并封装文档事件的记录、恢复与释放。
 */
function createProxyDocument (
  appName: string,
  sandbox: WithSandBoxInterface,
): {
    /** 注入子应用 window 的 document Proxy。 */
    proxyDocument: Document,
    /** 文档事件和 onclick 的快照生命周期钩子。 */
    documentEffect: CommonEffectHook,
  } {
  const eventListenerMap = new Map<string, Set<MicroEventListener>>()
  const sstEventListenerMap = new Map<string, Set<MicroEventListener>>()
  let onClickHandler: unknown = null
  let sstOnClickHandler: unknown = null
  const {
    rawDocument,
    rawCreateElement,
    rawCreateElementNS,
    rawAddEventListener,
    rawRemoveEventListener,
  } = globalEnv

  /** 使用基座 document 创建元素，并写入当前应用归属。 */
  function createElement (
    tagName: string,
    options?: ElementCreationOptions,
  ): HTMLElement {
    const element = rawCreateElement.call(rawDocument, tagName, options)
    return updateElementInfo(element, appName)
  }

  /** 使用基座 document 创建命名空间元素，并写入当前应用归属。 */
  function createElementNS (
    namespaceURI: string,
    name: string,
    options?: string | ElementCreationOptions,
  ): HTMLElement {
    const element = rawCreateElementNS.call(rawDocument, namespaceURI, name, options)
    return updateElementInfo(element, appName)
  }

  /**
   * 登记子应用 document 监听器，并绑定到基座原生 document。
   *
   * 函数监听器由真实 document 调用，不绑定 proxyDocument；显式 call 借用此方法也仍绑定宿主文档。
   * 登记表按事件名保存回调引用，options 附着在回调对象上，恢复时读取该值。
   */
  function addEventListener (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions
  ): void {
    const listenerList = eventListenerMap.get(type)
    if (listenerList) {
      listenerList.add(listener)
    } else {
      eventListenerMap.set(type, new Set([listener]))
    }
    listener && (listener.__MICRO_APP_MARK_OPTIONS__ = options)
    rawAddEventListener.call(rawDocument, type, listener, options)
  }

  /** 删除回调登记并按传入 options 移除基座绑定；capture 不匹配时原生绑定仍在，但登记已删除。 */
  function removeEventListener (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const listenerList = eventListenerMap.get(type)
    if (listenerList?.size && listenerList.has(listener)) {
      listenerList.delete(listener)
    }
    rawRemoveEventListener.call(rawDocument, type, listener, options)
  }

  /** 丢弃尚未恢复的文档监听器与 onclick 快照。 */
  const reset = (): void => {
    sstEventListenerMap.clear()
    sstOnClickHandler = null
  }

  /**
   * 合并记录 document.onclick 与普通监听器，供 UMD、预渲染或 keep-alive 恢复。
   *
   * @remarks
   * 连续记录时采用当前非假值 onclick，否则保留旧槽位；监听器集合取并集。默认模式 stop 先清空快照再释放。
   */
  const record = (): void => {
    /**
     * 应用隐藏后可能再次设置 onclick；优先保存当前值，否则保留上一次尚未恢复的快照。
     */
    sstOnClickHandler = onClickHandler || sstOnClickHandler

    // 合并而非覆盖，避免重复暂停时丢失先前监听器。
    eventListenerMap.forEach((listenerList, type) => {
      if (listenerList.size) {
        const cacheList = sstEventListenerMap.get(type) || []
        sstEventListenerMap.set(type, new Set([...cacheList, ...listenerList]))
      }
    })
  }

  /** 重挂载前恢复 onclick 和普通监听器，并消费快照。 */
  const rebuild = (): void => {
    // 当前槽位为假值时恢复旧 onclick；已设置的新函数优先。null 等假值也满足恢复条件。
    if (sstOnClickHandler && !onClickHandler) proxyDocument.onclick = sstOnClickHandler

    // 通过 proxyDocument API 恢复，确保登记表与真实绑定同步更新。
    sstEventListenerMap.forEach((listenerList, type) => {
      for (const listener of listenerList) {
        proxyDocument.addEventListener(type, listener, listener?.__MICRO_APP_MARK_OPTIONS__)
      }
    })

    reset()
  }

  /**
   * 移除 onclick 绑定并清空文档监听器登记。
   * 普通监听器移除时未传 options，只匹配 capture=false；capture=true 需应用自行以相同选项解除。
   */
  const release = (): void => {
    // 清理子应用通过 document.onclick 绑定的函数。
    if (isFunction(onClickHandler)) {
      rawRemoveEventListener.call(rawDocument, 'click', onClickHandler)
    }
    onClickHandler = null

    // 清理子应用通过 addEventListener 绑定的文档事件。
    if (eventListenerMap.size) {
      eventListenerMap.forEach((listenerList, type) => {
        for (const listener of listenerList) {
          rawRemoveEventListener.call(rawDocument, type, listener)
        }
      })
      eventListenerMap.clear()
    }
  }

  /**
   * 在本次 proxyDocument 创建时合并内置与配置 setter，同名配置优先；之后替换配置 Map 不会更新此快照。
   */
  const genProxyDocumentProps = () => {
    // 框架内置 onclick 代理负责替换真实 click 监听器。
    const builtInProxyProps = new Map([
      ['onclick', (value: unknown) => {
        if (isFunction(onClickHandler)) {
          rawRemoveEventListener.call(rawDocument, 'click', onClickHandler, false)
        }
        // 不改绑函数 this；真实 document 的 click 派发会调用该处理器。
        if (isFunction(value)) {
          rawAddEventListener.call(rawDocument, 'click', value, false)
        }
        onClickHandler = value
      }]
    ])
    // 外部配置可为其他 document 属性提供定制写入副作用。
    const customProxyDocumentProps = microApp.options?.customProxyDocumentProps || new Map()
    // 外部同名处理器替代内置 setter；它不自动更新 onClickHandler，也不改变 Proxy 的读取分支。
    const mergedProxyDocumentProps = new Map([
      ...builtInProxyProps,
      ...customProxyDocumentProps,
    ])
    return mergedProxyDocumentProps
  }

  const mergedProxyDocumentProps = genProxyDocumentProps()

  const proxyDocument = new Proxy(rawDocument, {
    /** 返回子应用创建/监听门面和独立 onclick 槽位；其余文档能力读取宿主并绑定真实 document。 */
    get: (target: Document, key: PropertyKey): unknown => {
      throttleDeferForSetAppName(appName)
      // TODO：改为与 iframe document 一致的描述符数据表，减少逐键分支。
      if (key === 'createElement') return createElement
      if (key === 'createElementNS') return createElementNS
      if (key === Symbol.toStringTag) return 'ProxyDocument'
      if (key === 'defaultView') return sandbox.proxyWindow
      if (key === 'onclick') return onClickHandler
      if (key === 'addEventListener') return addEventListener
      if (key === 'removeEventListener') return removeEventListener
      if (key === 'microAppElement') return appInstanceMap.get(appName)?.container
      if (key === '__MICRO_APP_NAME__') return appName
      return bindFunctionToRawTarget<Document>(Reflect.get(target, key), rawDocument, 'DOCUMENT')
    },
    /** 优先调用创建时合并的定制写入处理器；普通属性写宿主，microAppElement 仅供读取。 */
    set: (target: Document, key: PropertyKey, value: unknown): boolean => {
      if (mergedProxyDocumentProps.has(key)) {
        const proxyCallback = mergedProxyDocumentProps.get(key)
        proxyCallback(value)
      } else if (key !== 'microAppElement') {
        /**
         * 用真实 document 作为 Reflect.set 接收者，避免设置 document.title 时出现 Illegal invocation。
         * 陷阱固定返回 true，防止严格模式因底层 setter 返回 false 而抛出 TypeError。
         */
        Reflect.set(target, key, value)
      }
      return true
    }
  })

  return {
    proxyDocument,
    documentEffect: {
      reset,
      record,
      rebuild,
      release,
    }
  }
}

/**
 * 创建与原生 Document 共享静态/实例原型能力的子应用构造器。
 *
 * @remarks
 * 自定义 `Symbol.hasInstance` 同时接受 proxyDocument、原生 Document 和显式 MicroDocument 原型链；原型代理还会把宿主方法绑定回原生 document，避免 Illegal invocation。
 * 这层门面只代理共享原型能力，不复制一份独立 Document.prototype；经继承代理写入会影响宿主和其他 with 应用。
 */
function createMicroDocument (appName: string, proxyDocument: Document): Function {
  const { rawDocument, rawRootDocument } = globalEnv

  /** with 沙箱向子应用暴露的 Document 构造器门面。 */
  class MicroDocument {
    /** 合并门面原型、document Proxy 与原生 Document 三种实例来源。 */
    static [Symbol.hasInstance] (target: unknown) {
      let proto = target
      while (proto) {
        proto = Object.getPrototypeOf(proto)
        if (proto === MicroDocument.prototype) {
          return true
        }
      }
      return (
        target === proxyDocument ||
        target instanceof rawRootDocument
      )
    }
  }

  /**
   * 构造器继承由 `MicroDocument.__proto__` 指向原生 Document；
   * 实例方法继承则由 `MicroDocument.prototype.__proto__` 指向原生 Document.prototype 的代理。
   */
  Object.setPrototypeOf(MicroDocument, rawRootDocument)
  // 门面原型继承共享原型的 Proxy；对继承属性的写入经 set 陷阱转发到宿主 Document.prototype。
  Object.setPrototypeOf(MicroDocument.prototype, new Proxy(rawRootDocument.prototype, {
    /** 读取原型方法时绑定到原生 document，并登记当前应用执行作用域。 */
    get (target: Document, key: PropertyKey): unknown {
      throttleDeferForSetAppName(appName)
      return bindFunctionToRawTarget<Document>(Reflect.get(target, key), rawDocument, 'DOCUMENT')
    },
    /** 把子应用对 Document.prototype 的写入转发到共享原生原型。 */
    set (target: Document, key: PropertyKey, value: unknown): boolean {
      Reflect.set(target, key, value)
      return true
    }
  }))

  return MicroDocument
}
