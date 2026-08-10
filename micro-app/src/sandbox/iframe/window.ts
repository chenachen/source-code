import type {
  microAppWindowType,
  MicroEventListener,
  CommonEffectHook,
} from '@micro-app/types'
import type IframeSandbox from './index'
import globalEnv from '../../libs/global_env'
import bindFunctionToRawTarget from '../bind_function'
import {
  rawDefineProperty,
  isFunction,
  logWarn,
  includes,
  instanceOf,
  isConstructor,
} from '../../libs/utils'
import {
  GLOBAL_KEY_TO_WINDOW,
  SCOPE_WINDOW_EVENT_OF_IFRAME,
  SCOPE_WINDOW_ON_EVENT_OF_IFRAME,
} from '../../constants'
import {
  UN_PROXY_INSTANCEOF_KEYS,
  escape2RawWindowKeys,
  escape2RawWindowRegExpKeys,
} from './special_key'
import WorkerProxy from '../../proxies/worker'
import microApp from '../../micro_app'

/**
 * 组装 iframe realm 的 window 属性桥接、辅助 Proxy 与事件副作用追踪。
 *
 * @param appName - 当前应用名。
 * @param microAppWindow - iframe 自身的 window 对象。
 * @param sandbox - 持有代理 location、逃逸属性及代理 window 的 iframe 沙箱。
 * @returns 窗口事件的记录、恢复与释放钩子。
 */
export function patchWindow (
  appName: string,
  microAppWindow: microAppWindowType,
  sandbox: IframeSandbox,
): CommonEffectHook {
  patchWindowProperty(appName, microAppWindow, sandbox)
  createProxyWindow(microAppWindow, sandbox)
  return patchWindowEffect(microAppWindow)
}

/**
 * 修正 iframe window 与基座 window 之间的 API、构造器和事件属性边界。
 *
 * @remarks
 * 布局类宿主 API 直接桥接基座 realm；DOM 构造器合并 `Symbol.hasInstance` 判断；模块脚本会绕过辅助 Proxy，因此插件逃逸属性还必须直接定义在 iframe window 上。
 */
function patchWindowProperty (
  appName: string,
  microAppWindow: microAppWindowType,
  sandbox: IframeSandbox,
):void {
  const rawWindow = globalEnv.rawWindow

  escape2RawWindowKeys.forEach((key: string) => {
    microAppWindow[key] = bindFunctionToRawTarget(rawWindow[key], rawWindow)
  })

  Object.getOwnPropertyNames(microAppWindow)
    .filter((key: string) => {
      escape2RawWindowRegExpKeys.some((reg: RegExp) => {
        if (reg.test(key) && key in microAppWindow.parent) {
          if (isFunction(rawWindow[key])) {
            microAppWindow[key] = bindFunctionToRawTarget(rawWindow[key], rawWindow)
          } else {
            const { configurable, enumerable } = Object.getOwnPropertyDescriptor(microAppWindow, key) || {
              configurable: true,
              enumerable: true,
            }
            if (configurable) {
              rawDefineProperty(microAppWindow, key, {
                configurable,
                enumerable,
                get: () => rawWindow[key],
                set: (value) => { rawWindow[key] = value },
              })
            }
          }
          return true
        }
        return false
      })

      /**
       * Firefox 中 iframe 元素插入基座文档后，原型可能转向基座 realm。
       * 因此 iframe 构造器的 `Symbol.hasInstance` 同时接受基座与 iframe 原型链，覆盖 Event、Node、Element、URL 等跨 realm 对象。
       */
      if (
        isConstructor(microAppWindow[key]) &&
        key in rawWindow &&
        !UN_PROXY_INSTANCEOF_KEYS.includes(key) &&
        !microApp.options.excludeRewriteIframeConstructor?.includes(key)
      ) {
        rawDefineProperty(microAppWindow[key], Symbol.hasInstance, {
          configurable: true,
          enumerable: false,
          /** 在基座和 iframe 两条原型链中任一匹配即视为当前构造器实例。 */
          value (target: unknown): boolean {
            return instanceOf(target, rawWindow[key]) || instanceOf(target, microAppWindow[key])
          },
        })
      }

      return /^on/.test(key) && !SCOPE_WINDOW_ON_EVENT_OF_IFRAME.includes(key)
    })
    .forEach((eventName: string) => {
      const { enumerable, writable, set } = Object.getOwnPropertyDescriptor(microAppWindow, eventName) || {
        enumerable: true,
        writable: true,
      }
      try {
        rawDefineProperty(microAppWindow, eventName, {
          enumerable,
          configurable: true,
          get: () => rawWindow[eventName],
          set: writable ?? !!set
            ? (value) => { rawWindow[eventName] = isFunction(value) ? value.bind(microAppWindow) : value }
            : undefined,
        })
      } catch (e) {
        logWarn(e, appName)
      }
    })

  /**
   * Vite 等 ES module 脚本的全局解析直接落到 iframe window，不经过辅助 Proxy；
   * 插件声明的逃逸属性必须同步定义到真实 iframe window 才能生效。
   */
  sandbox.escapeProperties.forEach((key: PropertyKey) => {
    let rawValue = microAppWindow[key]
    rawDefineProperty(microAppWindow, key, {
      enumerable: true,
      configurable: true,
      /** 优先返回子应用覆盖值，否则读取并绑定基座值。 */
      get () {
        return rawValue ?? bindFunctionToRawTarget(rawWindow[key], rawWindow)
      },
      /** 只在 iframe realm 保存子应用覆盖值，不污染基座 window。 */
      set (value: unknown) {
        rawValue = value
      }
    })
  })
}

/**
 * 创建显式 `window.key` 访问使用的辅助 Proxy。
 *
 * @remarks
 * iframe window 已提供真实 realm 隔离；此 Proxy 只补 location、window/self/globalThis 和插件逃逸读取。模块脚本与裸全局标识符仍直接访问 iframe window。
 */
function createProxyWindow (
  microAppWindow: microAppWindowType,
  sandbox: IframeSandbox,
): void {
  const rawWindow = globalEnv.rawWindow
  const customProperties = new Set<PropertyKey>()

  Object.defineProperty(microAppWindow, 'Worker', {
    value: WorkerProxy,
    configurable: true,
    writable: true,
  })

  /**
   * Proxy 只覆盖部分访问路径：普通脚本的 `window.key` 会进入此处；
   * module 脚本的 `window.key` 及裸标识符判断通常落到真实 iframe window。
   */
  const proxyWindow = new Proxy(microAppWindow, {
    get: (target: microAppWindowType, key: PropertyKey): unknown => {
      if (key === 'Worker') {
        return WorkerProxy
      }
      if (key === 'location') {
        return sandbox.proxyLocation
      }

      if (includes(GLOBAL_KEY_TO_WINDOW, key)) {
        return proxyWindow
      }

      if (customProperties.has(key)) {
        return Reflect.get(target, key)
      }

      /**
       * 此处的 escapeProperties 回退只服务经过 Proxy 的访问；
       * module 与裸标识符路径由 `patchWindowProperty` 直接定义到 iframe window 的描述符处理。
       */
      if (includes(sandbox.escapeProperties, key) && !Reflect.get(target, key)) {
        return bindFunctionToRawTarget(Reflect.get(rawWindow, key), rawWindow)
      }

      return bindFunctionToRawTarget(Reflect.get(target, key), target)
    },
    set: (target: microAppWindowType, key: PropertyKey, value: unknown): boolean => {
      if (key === 'location') {
        return Reflect.set(rawWindow, key, value)
      }

      if (!Reflect.has(target, key)) {
        customProperties.add(key)
      }

      // 自 rc.9 起，iframe escapeProperties 的写入不再同步到基座 window。
      Reflect.set(target, key, value)

      return true
    },
    has: (target: microAppWindowType, key: PropertyKey) => key in target,
    deleteProperty: (target: microAppWindowType, key: PropertyKey): boolean => {
      if (Reflect.has(target, key)) {
        return Reflect.deleteProperty(target, key)
      }
      return true
    },
  })

  sandbox.proxyWindow = proxyWindow
}

/**
 * 改写 iframe window 的事件 API，并跟踪 UMD、预渲染与 keep-alive 所需快照。
 *
 * @remarks
 * 作用域事件留在 iframe window；其他事件桥接到基座 window。iframe 自身定时器由 realm 生命周期管理，本钩子只记录事件监听器。
 */
function patchWindowEffect (microAppWindow: microAppWindowType): CommonEffectHook {
  const { rawWindow, rawAddEventListener, rawRemoveEventListener, rawDispatchEvent } = globalEnv
  const eventListenerMap = new Map<string, Set<MicroEventListener>>()
  const sstEventListenerMap = new Map<string, Set<MicroEventListener>>()

  /** 按事件白名单和全局逃逸配置选择 iframe 或基座 window。 */
  function getEventTarget (type: string): Window {
    /**
     * TODO：`SCOPE_WINDOW_EVENT_OF_IFRAME` 白名单较窄，未知但应留在 iframe 的事件可能被误绑到主窗口；
     * 后续需以兼容性证据扩充白名单或改用更可靠的目标判定。
     */
    let escapeSandboxEvent: Array<string> = []
    if (Array.isArray(microApp?.options?.escapeIframeWindowEvents)) {
      escapeSandboxEvent = microApp.options.escapeIframeWindowEvents
    }
    const scopeWindowEvent = SCOPE_WINDOW_EVENT_OF_IFRAME.filter(item => !escapeSandboxEvent.includes(item))
    return scopeWindowEvent.includes(type) ? microAppWindow : rawWindow
  }

  // TODO：评估 listener 是否应绑定 microAppWindow；当前回调 this 由真实事件目标决定。
  /** 登记监听器及 options，并绑定到事件对应的真实 window。 */
  microAppWindow.addEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const listenerList = eventListenerMap.get(type)
    if (listenerList) {
      listenerList.add(listener)
    } else {
      eventListenerMap.set(type, new Set([listener]))
    }
    listener && (listener.__MICRO_APP_MARK_OPTIONS__ = options)
    rawAddEventListener.call(getEventTarget(type), type, listener, options)
  }

  /** 从登记表与真实 window 同步移除监听器。 */
  microAppWindow.removeEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const listenerList = eventListenerMap.get(type)
    if (listenerList?.size && listenerList.has(listener)) {
      listenerList.delete(listener)
    }
    rawRemoveEventListener.call(getEventTarget(type), type, listener, options)
  }

  /** 在与监听器一致的真实 window 上派发事件。 */
  microAppWindow.dispatchEvent = function (event: Event): boolean {
    return rawDispatchEvent.call(getEventTarget(event?.type), event)
  }

  /** 丢弃尚未恢复的窗口监听器快照。 */
  const reset = (): void => {
    sstEventListenerMap.clear()
  }

  /**
   * 合并记录当前窗口监听器，供 UMD、预渲染或 keep-alive 重挂载恢复。
   *
   * @remarks
   * 记录可能发生多次，因此与旧快照取并集；普通默认模式不记录，直接释放。iframe 定时器不在本映射中，由 iframe realm 是否销毁决定生命周期。
   *
   * TODO：清除、记录和恢复目前分散在 sandbox 与 create_app，后续应集中为单一生命周期协调器。
   */
  const record = (): void => {
    // 合并而非覆盖，避免连续暂停流程丢失先前监听器。
    eventListenerMap.forEach((listenerList, type) => {
      if (listenerList.size) {
        const cacheList = sstEventListenerMap.get(type) || []
        sstEventListenerMap.set(type, new Set([...cacheList, ...listenerList]))
      }
    })
  }

  /** 重挂载前按原 options 重新绑定窗口事件，并消费快照。 */
  const rebuild = (): void => {
    // 通过已改写 API 恢复，保持登记表与真实绑定一致。
    sstEventListenerMap.forEach((listenerList, type) => {
      for (const listener of listenerList) {
        microAppWindow.addEventListener(type, listener, listener?.__MICRO_APP_MARK_OPTIONS__)
      }
    })

    reset()
  }

  /** 从各自真实目标释放所有已登记窗口事件。 */
  const release = (): void => {
    if (eventListenerMap.size) {
      eventListenerMap.forEach((listenerList, type) => {
        for (const listener of listenerList) {
          rawRemoveEventListener.call(getEventTarget(type), type, listener)
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
