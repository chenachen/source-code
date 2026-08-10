import type {
  microAppWindowType,
  CommonEffectHook,
  MicroEventListener,
  timeInfo,
  WithSandBoxInterface,
} from '@micro-app/types'
import globalEnv from '../../libs/global_env'
import bindFunctionToRawTarget from '../bind_function'
import {
  SCOPE_WINDOW_EVENT_OF_WITH,
  SCOPE_WINDOW_ON_EVENT_OF_WITH,
  RAW_GLOBAL_TARGET,
} from '../../constants'
import {
  isString,
  includes,
  unique,
  throttleDeferForSetAppName,
  rawDefineProperty,
  rawHasOwnProperty,
  removeDomScope,
  getRootContainer,
  formatEventType,
} from '../../libs/utils'
import {
  appInstanceMap,
} from '../../create_app'
import WorkerProxy from '../../proxies/worker'

/**
 * 组装 with 沙箱的 window 属性代理、Proxy 陷阱与副作用追踪。
 *
 * @param appName - 当前应用名，用于建立执行期 DOM 归属和事件命名空间。
 * @param microAppWindow - Proxy 的隔离目标对象。
 * @param sandbox - 持有作用域键、逃逸键及注入键集合的沙箱。
 * @returns 窗口事件和定时器的记录、恢复与释放钩子。
 */
export function patchWindow (
  appName: string,
  microAppWindow: microAppWindowType,
  sandbox: WithSandBoxInterface,
): CommonEffectHook {
  patchWindowProperty(microAppWindow)
  createProxyWindow(appName, microAppWindow, sandbox)
  return patchWindowEffect(microAppWindow, appName)
}

/**
 * 把不需要隔离的 `on*` 属性桥接到基座原生 window。
 *
 * @remarks
 * `SCOPE_WINDOW_ON_EVENT_OF_WITH` 中的属性留在子应用，其余属性沿用宿主描述符的可写边界。
 *
 * @param microAppWindow - 子应用隔离 window。
 */
function patchWindowProperty (
  microAppWindow: microAppWindowType,
):void {
  const rawWindow = globalEnv.rawWindow
  Object.getOwnPropertyNames(rawWindow)
    .filter((key: string) => {
      return /^on/.test(key) && !SCOPE_WINDOW_ON_EVENT_OF_WITH.includes(key)
    })
    .forEach((eventName: string) => {
      const { enumerable, writable, set } = Object.getOwnPropertyDescriptor(rawWindow, eventName) || {
        enumerable: true,
        writable: true,
      }
      rawDefineProperty(microAppWindow, eventName, {
        enumerable,
        configurable: true,
        get: () => rawWindow[eventName],
        set: writable ?? !!set
          ? (value) => { rawWindow[eventName] = value }
          : undefined,
      })
    })
}

/**
 * 创建以 `microAppWindow` 为隔离存储、以原生 window 为回退来源的 Proxy。
 *
 * @remarks
 * 读操作优先隔离目标并绑定原生函数；写操作默认留在隔离目标，插件声明的逃逸键才镜像到宿主。注入键和逃逸键都被记录，供默认模式卸载时精确清理。
 */
function createProxyWindow (
  appName: string,
  microAppWindow: microAppWindowType,
  sandbox: WithSandBoxInterface,
): void {
  const rawWindow = globalEnv.rawWindow
  const descriptorTargetMap = new Map<PropertyKey, 'target' | 'rawWindow'>()

  rawDefineProperty(microAppWindow, 'Worker', {
    value: WorkerProxy,
    configurable: true,
    writable: true,
  })

  const proxyWindow = new Proxy(microAppWindow, {
    get: (target: microAppWindowType, key: PropertyKey): unknown => {
      throttleDeferForSetAppName(appName)
      // 子应用读取 Worker 时始终返回可登记并清理实例的代理构造器。
      if (key === 'Worker') {
        return WorkerProxy
      }
      if (
        Reflect.has(target, key) ||
        (isString(key) && /^__MICRO_APP_/.test(key)) ||
        includes(sandbox.scopeProperties, key)
      ) {
        if (includes(RAW_GLOBAL_TARGET, key)) removeDomScope()
        return Reflect.get(target, key)
      }

      return bindFunctionToRawTarget(Reflect.get(rawWindow, key), rawWindow)
    },
    set: (target: microAppWindowType, key: PropertyKey, value: unknown): boolean => {
      if (includes(sandbox.rawWindowScopeKeyList, key)) {
        Reflect.set(rawWindow, key, value)
      } else if (
        // `target.hasOwnProperty` 已由沙箱重写，此处必须调用缓存的原生实现。
        !rawHasOwnProperty.call(target, key) &&
        rawHasOwnProperty.call(rawWindow, key) &&
        !includes(sandbox.scopeProperties, key)
      ) {
        const descriptor = Object.getOwnPropertyDescriptor(rawWindow, key)
        const { configurable, enumerable, writable, set } = descriptor!
        // 把宿主已有属性复制为隔离目标自有值，同时继承其描述符写入能力。
        rawDefineProperty(target, key, {
          value,
          configurable,
          enumerable,
          writable: writable ?? !!set,
        })

        sandbox.injectedKeys.add(key)
      } else {
        // scopeProperties 也纳入 injectedKeys，`has` 陷阱据此区分尚未注入与显式赋值。
        if (!Reflect.has(target, key) || includes(sandbox.scopeProperties, key)) {
          sandbox.injectedKeys.add(key)
        }
        Reflect.set(target, key, value)
      }

      if (
        (
          includes(sandbox.escapeProperties, key) ||
          (
            // TODO：把 staticEscapeProperties 合并进 escapeProperties，消除两套逃生键分支。
            includes(sandbox.staticEscapeProperties, key) &&
            !Reflect.has(rawWindow, key)
          )
        ) &&
        !includes(sandbox.scopeProperties, key)
      ) {
        !Reflect.has(rawWindow, key) && sandbox.escapeKeys.add(key)
        Reflect.set(rawWindow, key, value)
      }

      return true
    },
    has: (target: microAppWindowType, key: PropertyKey): boolean => {
      /**
       * Vue 等作用域键在未注入时需同时满足 `window.Vue === undefined` 与 `'Vue' in window === false`。
       * 一旦子应用显式写入，则恢复普通自有属性语义。
       * @see https://github.com/jd-opensource/micro-app/issues/686
       */
      if (includes(sandbox.scopeProperties, key)) {
        if (sandbox.injectedKeys.has(key)) {
          return Reflect.has(target, key) // true
        }
        return !!target[key] // false
      }
      return Reflect.has(target, key) || Reflect.has(rawWindow, key)
    },
    // `Object.getOwnPropertyDescriptor(window, key)`：记录描述符来自隔离目标还是宿主。
    getOwnPropertyDescriptor: (target: microAppWindowType, key: PropertyKey): PropertyDescriptor|undefined => {
      if (rawHasOwnProperty.call(target, key)) {
        descriptorTargetMap.set(key, 'target')
        return Object.getOwnPropertyDescriptor(target, key)
      }

      if (rawHasOwnProperty.call(rawWindow, key)) {
        descriptorTargetMap.set(key, 'rawWindow')
        const descriptor = Object.getOwnPropertyDescriptor(rawWindow, key)
        if (descriptor && !descriptor.configurable) {
          descriptor.configurable = true
        }
        return descriptor
      }

      return undefined
    },
    // `Object.defineProperty` 紧随描述符查询时写回同一底层对象，维持反射语义。
    defineProperty: (target: microAppWindowType, key: PropertyKey, value: PropertyDescriptor): boolean => {
      const from = descriptorTargetMap.get(key)
      if (from === 'rawWindow') {
        return Reflect.defineProperty(rawWindow, key, value)
      }
      return Reflect.defineProperty(target, key, value)
    },
    // 枚举结果合并宿主与隔离目标并去重。
    ownKeys: (target: microAppWindowType): Array<string | symbol> => {
      return unique(Reflect.ownKeys(rawWindow).concat(Reflect.ownKeys(target)))
    },
    deleteProperty: (target: microAppWindowType, key: PropertyKey): boolean => {
      if (rawHasOwnProperty.call(target, key)) {
        sandbox.injectedKeys.has(key) && sandbox.injectedKeys.delete(key)
        sandbox.escapeKeys.has(key) && Reflect.deleteProperty(rawWindow, key)
        return Reflect.deleteProperty(target, key)
      }
      return true
    },
  })

  sandbox.proxyWindow = proxyWindow
}

/**
 * 改写 window 事件和定时器 API，并提供跨卸载阶段的副作用快照。
 *
 * @remarks
 * 特殊生命周期/路由事件绑定到应用根元素，其余事件和全部定时器使用宿主 window。监听器始终登记；默认卸载清事件和定时器，UMD、预渲染与 keep-alive 则记录事件并保留仍运行的定时器。
 */
function patchWindowEffect (microAppWindow: microAppWindowType, appName: string): CommonEffectHook {
  const eventListenerMap = new Map<string, Set<MicroEventListener>>()
  const sstEventListenerMap = new Map<string, Set<MicroEventListener>>()
  const intervalIdMap = new Map<number, timeInfo>()
  const timeoutIdMap = new Map<number, timeInfo>()
  const {
    rawWindow,
    rawAddEventListener,
    rawRemoveEventListener,
    rawDispatchEvent,
    rawSetInterval,
    rawSetTimeout,
    rawClearInterval,
    rawClearTimeout,
  } = globalEnv

  /**
   * 选择事件真实绑定目标：作用域事件落到应用根元素，其余落到宿主 window。
   *
   * @remarks
   * 早期使用独立 EventTarget，但无法兼容 iOS 14 及更早版本，现以 micro-app 根元素承载子应用专属事件。
   */
  function getEventTarget (type: string): EventTarget {
    if (SCOPE_WINDOW_EVENT_OF_WITH.includes(type) && appInstanceMap.get(appName)?.container) {
      return getRootContainer(appInstanceMap.get(appName)!.container!)
    }
    return rawWindow
  }

  /**
   * 监听器允许为 null，例如 passive 特性探测。
   * TODO：继续验证 listener 是否应绑定 microAppWindow；当前函数回调中的 this 指向真实事件目标。
   * 对 `window.addEventListener.call(非 window, ...)` 这类显式借用调用，还需定义非 proxyWindow/
   * microAppWindow 接收者的兼容语义。
   */
  /** 登记监听器及原始 options，并绑定到按事件类型选择的真实目标。 */
  microAppWindow.addEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    type = formatEventType(type, appName)
    const listenerList = eventListenerMap.get(type)
    if (listenerList) {
      listenerList.add(listener)
    } else {
      eventListenerMap.set(type, new Set([listener]))
    }
    listener && (listener.__MICRO_APP_MARK_OPTIONS__ = options)
    rawAddEventListener.call(getEventTarget(type), type, listener, options)
  }

  /** 从登记表与真实目标同步移除监听器。 */
  microAppWindow.removeEventListener = function (
    type: string,
    listener: MicroEventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    type = formatEventType(type, appName)
    const listenerList = eventListenerMap.get(type)
    if (listenerList?.size && listenerList.has(listener)) {
      listenerList.delete(listener)
    }
    rawRemoveEventListener.call(getEventTarget(type), type, listener, options)
  }

  /** 在与监听器相同的真实目标上派发事件。 */
  microAppWindow.dispatchEvent = function (event: Event): boolean {
    return rawDispatchEvent.call(getEventTarget(event?.type), event)
  }

  /** 使用宿主定时器创建 interval，并保存重建/清理所需参数。 */
  microAppWindow.setInterval = function (
    handler: TimerHandler,
    timeout?: number,
    ...args: any[]
  ): number {
    const intervalId = rawSetInterval.call(rawWindow, handler, timeout, ...args)
    intervalIdMap.set(intervalId, { handler, timeout, args })
    return intervalId
  }

  /** 使用宿主定时器创建 timeout，并在函数回调执行前移除活动记录。 */
  microAppWindow.setTimeout = function (
    handler: TimerHandler,
    timeout?: number,
    ...args: any[]
  ): number {
    /** 函数型 timeout 执行时先清除登记，避免已完成任务仍被快照持有。 */
    const setTimeoutHander = function(...args: any[]) {
      timeoutIdMap.delete(timeoutId)
      typeof handler === 'function' && handler(...args)
    }
    const handlerWithCleanup: TimerHandler = typeof handler === 'string' ? handler : setTimeoutHander
    const timeoutId = rawSetTimeout.call(rawWindow, handlerWithCleanup, timeout, ...args)
    timeoutIdMap.set(timeoutId, { handler: handlerWithCleanup, timeout, args })
    return timeoutId
  }

  /** 清除 interval 的活动记录及宿主定时器。 */
  microAppWindow.clearInterval = function (intervalId: number) {
    intervalIdMap.delete(intervalId)
    rawClearInterval.call(rawWindow, intervalId)
  }

  /** 清除 timeout 的活动记录及宿主定时器。 */
  microAppWindow.clearTimeout = function (timeoutId: number) {
    timeoutIdMap.delete(timeoutId)
    rawClearTimeout.call(rawWindow, timeoutId)
  }

  /** 丢弃尚未重建的窗口事件快照。 */
  const reset = (): void => {
    sstEventListenerMap.clear()
  }

  /**
   * 合并记录当前窗口监听器，供 UMD、预渲染或 keep-alive 恢复。
   *
   * @remarks
   * 记录可能发生多次，因此与旧快照取并集；定时器在这些模式下不会释放，无需重建。普通默认模式不记录，直接清理事件与定时器。
   */
  const record = (): void => {
    // 合并而非覆盖，防止预渲染卸载与手动 keep-alive 连续记录时丢失监听器。
    eventListenerMap.forEach((listenerList, type) => {
      if (listenerList.size) {
        const cacheList = sstEventListenerMap.get(type) || []
        sstEventListenerMap.set(type, new Set([...cacheList, ...listenerList]))
      }
    })
  }

  /** 重挂载前按原 options 重新绑定窗口事件，并消费快照。 */
  const rebuild = (): void => {
    // 通过代理 API 重建，确保登记表与真实绑定同步恢复。
    sstEventListenerMap.forEach((listenerList, type) => {
      for (const listener of listenerList) {
        microAppWindow.addEventListener(type, listener, listener?.__MICRO_APP_MARK_OPTIONS__)
      }
    })

    reset()
  }

  /** 释放全部窗口事件，并按模式决定是否同时终止定时器。 */
  const release = (clearTimer: boolean): void => {
    // 从每种事件实际绑定的目标移除监听器。
    if (eventListenerMap.size) {
      eventListenerMap.forEach((listenerList, type) => {
        for (const listener of listenerList) {
          rawRemoveEventListener.call(getEventTarget(type), type, listener)
        }
      })
      eventListenerMap.clear()
    }

    // 只有普通默认卸载或销毁才终止定时器；暂停类模式保持后台活性。
    if (clearTimer) {
      intervalIdMap.forEach((_, intervalId: number) => {
        rawClearInterval.call(rawWindow, intervalId)
      })

      timeoutIdMap.forEach((_, timeoutId: number) => {
        rawClearTimeout.call(rawWindow, timeoutId)
      })

      intervalIdMap.clear()
      timeoutIdMap.clear()
    }
  }

  return {
    reset,
    record,
    rebuild,
    release,
  }
}
