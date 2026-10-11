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
 * 布局类宿主 API 桥接基座 realm；未排除且被识别为构造器的同名全局合并 `Symbol.hasInstance`。
 * 模块脚本不经过辅助 Proxy，因此插件逃逸读取还通过 iframe window 上的访问器实现。
 * 通用 on* 赋值会写宿主属性，事件快照不会恢复这些宿主旧值；单个 on* 描述符定义失败只告警并继续。
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
                /** 读取匹配逃逸规则的宿主实时值，避免复制时固定旧值。 */
                get: () => rawWindow[key],
                /** 该静态桥接键直接写宿主，与插件逃逸键的 iframe 局部覆盖槽位不同。 */
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
          /** 返回宿主当前 on 处理器；同名 iframe 属性在此作为共享门面。 */
          get: () => rawWindow[eventName],
          /** 可写 on 属性转发宿主；函数预绑定 iframe window，release 不恢复宿主旧值。 */
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
 * 普通包装脚本把 window/self/global 参数指向此 Proxy，把 location 参数指向 proxyLocation。
 * 其他裸全局标识符仍在 iframe realm 查找；module 脚本不做参数包装，使用真实 iframe window 上的补丁。
 */
function createProxyWindow (
  microAppWindow: microAppWindowType,
  sandbox: IframeSandbox,
): void {
  const rawWindow = globalEnv.rawWindow
  const customProperties = new Set<PropertyKey>()
  // 只记录经 Proxy set 新增的键，使这些业务函数不被绑定到 Window；直接 module 赋值不进入此集合。
  // deleteProperty 不删除集合项，同名键再次创建后仍按业务自定义值读取。

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
    /**
     * 读取显式 window 属性：别名返回代理、location 返回虚拟视图，自定义函数保留原引用。
     * 其他函数绑定 iframe window；插件逃逸值为假值时可回退宿主，裸标识符不经过此陷阱。
     */
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
       * Proxy 路径遇到假值会回退；直接访问 iframe window 的描述符仅遇到 null/undefined 时回退。
       * 因而插件键赋为 0/false 时，这两条读取路径可能得到不同值。
       */
      if (includes(sandbox.escapeProperties, key) && !Reflect.get(target, key)) {
        return bindFunctionToRawTarget(Reflect.get(rawWindow, key), rawWindow)
      }

      return bindFunctionToRawTarget(Reflect.get(target, key), target)
    },
    /** location 整体赋值转发宿主，其他值写 iframe；首次新增键被标为无需 Window 绑定的业务值。 */
    set: (target: microAppWindowType, key: PropertyKey, value: unknown): boolean => {
      if (key === 'location') {
        return Reflect.set(rawWindow, key, value)
      }

      if (!Reflect.has(target, key)) {
        customProperties.add(key)
      }

      // 包括 escapeProperties 在内的普通赋值只写 iframe，不同步到基座 window。
      Reflect.set(target, key, value)

      return true
    },
    /** 成员存在性只查询 iframe 目标，不把宿主回退读取能力扩展为 in 运算的存在性。 */
    has: (target: microAppWindowType, key: PropertyKey) => key in target,
    /** 删除 iframe 成员并返回真实删除结果；历史 customProperties 标记不随删除清空。 */
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
 * 白名单事件留在 iframe window，escapeIframeWindowEvents 可把其中的事件改绑基座；其他事件也绑定基座。
 * 这里不对 mounted/unmount 追加应用名，调用方需与实际派发名称一致。定时器不进入本钩子的映射或快照。
 */
function patchWindowEffect (microAppWindow: microAppWindowType): CommonEffectHook {
  const { rawWindow, rawAddEventListener, rawRemoveEventListener, rawDispatchEvent } = globalEnv
  const eventListenerMap = new Map<string, Set<MicroEventListener>>()
  const sstEventListenerMap = new Map<string, Set<MicroEventListener>>()

  /** 按事件白名单和全局逃逸配置选择 iframe 或基座 window。 */
  function getEventTarget (type: string): Window {
    // 只有仍在作用域白名单内的事件留在 iframe；其余全部使用基座 window。
    let escapeSandboxEvent: Array<string> = []
    if (Array.isArray(microApp?.options?.escapeIframeWindowEvents)) {
      escapeSandboxEvent = microApp.options.escapeIframeWindowEvents
    }
    const scopeWindowEvent = SCOPE_WINDOW_EVENT_OF_IFRAME.filter(item => !escapeSandboxEvent.includes(item))
    return scopeWindowEvent.includes(type) ? microAppWindow : rawWindow
  }

  /** 登记监听器及 options 并绑定真实目标；函数 this 由目标决定，显式 call 也不改变所选目标。 */
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

  /** 删除登记并按传入 options 尝试解除当前所选 window 的绑定；登记不区分 capture 或原始目标。 */
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

  /** 按当前逃逸配置选择 iframe 或宿主派发目标；配置改变后不必等于最初的监听目标。 */
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
   * 记录可能发生多次，因此与旧快照取并集；默认模式 stop 选择 reset 分支后释放。iframe 定时器不在本映射中，由 iframe realm 是否销毁决定生命周期。
   *
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

  /** 重挂载前按回调对象保存的 options 重新绑定窗口事件，并消费快照。 */
  const rebuild = (): void => {
    // 通过已改写 API 向当前配置选择的目标重新登记，不恢复登记时的旧目标选择。
    sstEventListenerMap.forEach((listenerList, type) => {
      for (const listener of listenerList) {
        microAppWindow.addEventListener(type, listener, listener?.__MICRO_APP_MARK_OPTIONS__)
      }
    })

    reset()
  }

  /**
   * 清空窗口事件登记，并从当前配置选择的真实目标移除监听器。
   * 移除时未传 options，只匹配 capture=false；capture=true 需应用自行以相同选项解除。
   * escapeIframeWindowEvents 在每次调用时重新读取；运行中变更配置可能使当前目标不同于原登记目标。
   */
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
