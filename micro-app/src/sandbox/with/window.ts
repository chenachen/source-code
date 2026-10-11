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
        /** 读取宿主实时 on 处理器；普通事件属性在 with 窗口上不另建隔离槽位。 */
        get: () => rawWindow[eventName],
        /** 宿主描述符允许写入时才桥接赋值；release 不恢复这些宿主 on 属性的旧值。 */
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
 * 读取优先使用隔离目标，回退到宿主的方法才绑定宿主 this。普通赋值留在目标；location 写到宿主，
 * 插件逃逸键和宿主尚不存在的静态逃逸键可镜像到宿主。运行期登记的键供默认卸载或销毁时清理。
 * 此 Proxy 没有以 sandbox.active 限制 get/set；停止后仍持有代理的代码仍能赋值，active 只约束生命周期。
 * 描述符来源 Map 随此 Proxy 存活，defineProperty 的目的地取决于先前查询，不经过普通赋值登记。
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
    /**
     * 读取前设置应用 DOM 作用域；自有键、框架保留前缀及作用域键从隔离目标读取。
     * 其余键回退宿主，并为宿主函数缓存绑定接收者；RAW_GLOBAL_TARGET 读取会先退出 DOM 作用域。
     */
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
    /**
     * 按键领域写入宿主或隔离目标，登记新增隔离键与新逃逸键，供普通卸载清理。
     * 宿主已有属性被复制时继承其可写边界；scopeProperties 优先于逃逸配置，active 不参与赋值门禁。
     */
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
    /** 作用域键在未注入时屏蔽宿主存在性，其余键合并目标与宿主的 in 判断。 */
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
    /** 查询自有描述符并记住来源；宿主不可配置描述符作为可配置副本返回，满足当前代理目标约束。 */
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
    /** 曾查询到宿主描述符的键写回宿主，其他键定义到目标；此路径不经过 set 的注入/逃逸登记。 */
    defineProperty: (target: microAppWindowType, key: PropertyKey, value: PropertyDescriptor): boolean => {
      const from = descriptorTargetMap.get(key)
      if (from === 'rawWindow') {
        return Reflect.defineProperty(rawWindow, key, value)
      }
      return Reflect.defineProperty(target, key, value)
    },
    /** 合并宿主和隔离目标的自有键并去重，使枚举能看到两侧成员。 */
    ownKeys: (target: microAppWindowType): Array<string | symbol> => {
      return unique(Reflect.ownKeys(rawWindow).concat(Reflect.ownKeys(target)))
    },
    /** 删除隔离自有键及对应宿主新逃逸值；目标上不存在的键不会删除宿主同名成员。 */
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
 * 作用域事件有容器时绑定到应用根元素，其余事件和全部定时器使用宿主 window。
 * 监听器按事件名与回调引用登记；options 写在回调对象上，恢复时读取该值。默认卸载清理定时器，
 * UMD、预渲染与 keep-alive 保留仍运行的定时器，快照只恢复事件。
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
   * 目标每次从当前 container 计算，不保存在监听器登记表中；容器迁移后的 remove/release 不一定命中旧目标。
   */
  function getEventTarget (type: string): EventTarget {
    if (SCOPE_WINDOW_EVENT_OF_WITH.includes(type) && appInstanceMap.get(appName)?.container) {
      return getRootContainer(appInstanceMap.get(appName)!.container!)
    }
    return rawWindow
  }

  /**
   * 登记监听器及 options，并绑定到按事件类型选择的真实目标；null 监听器用于 passive 特性探测。
   * 函数监听器不改绑 this，仍由真实事件目标调用；显式 call 借用此方法也不改变所选目标。
   */
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

  /** 删除登记并按传入 options 尝试移除真实绑定；登记不区分 capture，选项不匹配时原绑定可能仍在。 */
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

  /** 使用宿主定时器创建 interval，并登记 id 供默认卸载或销毁时清理。 */
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
    /** 函数型 timeout 执行时先清除活动登记；字符串 handler 直接交给浏览器，不经过此回调。 */
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
   * 记录可能发生多次，因此与旧快照取并集；定时器在这些模式下不会释放，无需重建。默认模式 stop 选择 reset 分支，随后清理事件与定时器。
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

  /** 重挂载前按回调对象保存的 options 重新绑定窗口事件，并消费快照。 */
  const rebuild = (): void => {
    // 通过代理 API 登记到当前所选目标，不记住上次的容器；重建成功后再消费快照。
    sstEventListenerMap.forEach((listenerList, type) => {
      for (const listener of listenerList) {
        microAppWindow.addEventListener(type, listener, listener?.__MICRO_APP_MARK_OPTIONS__)
      }
    })

    reset()
  }

  /**
   * 清空窗口监听器登记，并按模式决定是否终止定时器。
   * 移除监听器未传 options，只匹配 capture=false 的绑定；capture=true 需应用自行以相同选项解除。
   * scope 事件还依赖当前 container 与登记时目标一致；keep-alive 已换到临时 div 时只能尝试解除新目标。
   */
  const release = (clearTimer: boolean): void => {
    // 按当前容器重新选择目标尝试移除；登记表没有保存旧绑定的目标/capture 元组。
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
