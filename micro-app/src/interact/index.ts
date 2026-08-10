import { CallableFunctionForInteract } from '@micro-app/types'
import EventCenter from './event_center'
import { appInstanceMap } from '../create_app'
import {
  removeDomScope,
  isString,
  isFunction,
  isPlainObject,
  formatAppName,
  logError,
  getRootContainer,
} from '../libs/utils'

/** 基座、所有子应用及全局数据通道共享的底层事件中心。 */
const eventCenter = new EventCenter()

/**
 * 把应用名和数据方向编码为内部事件通道名。
 *
 * @param appName - 已登记或待格式化的应用名。
 * @param fromBaseApp - 为真表示基座发往子应用；否则表示子应用发往基座。
 */
function createEventName (appName: string, fromBaseApp: boolean): string {
  if (!isString(appName) || !appName) return ''
  return fromBaseApp ? `__${appName}_from_base_app__` : `__${appName}_from_micro_app__`
}

/**
 * 封装跨所有应用共享的全局数据通道。
 *
 * @remarks
 * 基座与子应用共用 `global` 通道；子应用实例会给回调标记应用名，以便卸载时只清理自己的监听器。
 */
class EventCenterForGlobal {
  /**
   * 订阅全局数据，并可立即回放稳定的缓存值。
   *
   * @param cb - 全局数据监听器。
   * @param autoTrigger - 首次绑定时是否回放非空缓存；默认不回放。
   */
  addGlobalDataListener (cb: CallableFunctionForInteract, autoTrigger?: boolean): void {
    const appName = (this as any).appName
    // 仅子应用数据中心带有 appName；标记用于按应用清理和 UMD 快照恢复。
    if (appName) {
      cb.__APP_NAME__ = appName
      cb.__AUTO_TRIGGER__ = autoTrigger
    }
    eventCenter.on('global', cb, autoTrigger)
  }

  /**
   * 从全局数据通道移除指定监听器，缓存数据保持不变。
   *
   * @param cb - 先前注册的监听器。
   */
  removeGlobalDataListener (cb: CallableFunctionForInteract): void {
    isFunction(cb) && eventCenter.off('global', cb)
  }

  /**
   * 合并并异步分发全局数据。
   *
   * @param data - 写入全局通道的局部数据对象。
   * @param nextStep - 本批数据完成通知后接收监听器返回值的回调。
   * @param force - 是否跳过浅比较、强制通知。
   */
  setGlobalData (
    data: Record<PropertyKey, unknown>,
    nextStep?: CallableFunction,
    force?: boolean,
  ): void {
    // 分发前清除当前 DOM 归属，避免监听器中的基座操作被误标记为某个子应用。
    removeDomScope()

    eventCenter.dispatch(
      'global',
      data,
      (resArr: unknown[]) => isFunction(nextStep) && nextStep(resArr),
      force,
    )
  }

  /** 强制分发全局数据，即使合并后的浅层键值没有变化。 */
  forceSetGlobalData (
    data: Record<PropertyKey, unknown>,
    nextStep?: CallableFunction,
  ): void {
    this.setGlobalData(data, nextStep, true)
  }

  /**
   * 返回最近一次提交的全局数据；通道尚未创建时返回 `null`。
   */
  getGlobalData (): Record<PropertyKey, unknown> | null {
    return eventCenter.getData('global')
  }

  /**
   * 清空全局数据缓存，但保留所有监听器。
   */
  clearGlobalData (): void {
    eventCenter.clearData('global')
  }

  /**
   * 清理当前调用方拥有的全部全局数据监听器。
   *
   * @remarks
   * 子应用实例只删除带相同 `__APP_NAME__` 的回调；基座实例只删除未标记应用名的回调，避免相互越权清理。
   */
  clearGlobalDataListener (): void {
    const appName = (this as any).appName
    const eventInfo = eventCenter.eventList.get('global')
    if (eventInfo) {
      for (const cb of eventInfo.callbacks) {
        if (
          (appName && appName === cb.__APP_NAME__) ||
          !(appName || cb.__APP_NAME__)
        ) {
          eventInfo.callbacks.delete(cb)
        }
      }
    }
  }
}

/** 为基座暴露定向子应用的数据收发、查询及清理 API。 */
export class EventCenterForBaseApp extends EventCenterForGlobal {
  /**
   * 监听指定子应用发往基座的数据。
   *
   * @param appName - 子应用名。
   * @param cb - 数据监听器。
   * @param autoTrigger - 首次绑定时是否回放非空缓存；默认不回放。
   */
  addDataListener (appName: string, cb: CallableFunction, autoTrigger?: boolean): void {
    eventCenter.on(createEventName(formatAppName(appName), false), cb, autoTrigger)
  }

  /**
   * 移除指定子应用发往基座的数据监听器。
   *
   * @param appName - 子应用名。
   * @param cb - 先前注册的监听器。
   */
  removeDataListener (appName: string, cb: CallableFunction): void {
    isFunction(cb) && eventCenter.off(createEventName(formatAppName(appName), false), cb)
  }

  /**
   * 查询指定应用方向上最近提交的数据。
   *
   * @param appName - 子应用名。
   * @param fromBaseApp - 为真读取基座发往子应用的数据；默认读取子应用发往基座的数据。
   */
  getData (appName: string, fromBaseApp = false): Record<PropertyKey, unknown> | null {
    return eventCenter.getData(createEventName(formatAppName(appName), fromBaseApp))
  }

  /**
   * 合并并异步发送数据到指定子应用。
   *
   * @param appName - 目标子应用名。
   * @param data - 写入该应用通道的局部数据对象。
   * @param nextStep - 本批数据完成通知后的回调。
   * @param force - 是否跳过浅比较、强制通知。
   */
  setData (
    appName: string,
    data: Record<PropertyKey, unknown>,
    nextStep?: CallableFunction,
    force?: boolean,
  ): void {
    eventCenter.dispatch(
      createEventName(formatAppName(appName), true),
      data,
      (resArr: unknown[]) => isFunction(nextStep) && nextStep(resArr),
      force,
    )
  }

  /** 强制发送数据到指定子应用，即使浅比较结果未变化。 */
  forceSetData (
    appName: string,
    data: Record<PropertyKey, unknown>,
    nextStep?: CallableFunction,
  ): void {
    this.setData(appName, data, nextStep, true)
  }

  /**
   * 清空指定应用方向的数据缓存。
   *
   * @param appName - 子应用名。
   * @param fromBaseApp - 为真清除基座发往子应用的数据；默认值为真。
   */
  clearData (appName: string, fromBaseApp = true): void {
    eventCenter.clearData(createEventName(formatAppName(appName), fromBaseApp))
  }

  /**
   * 清空基座对指定子应用上行数据的全部监听器。
   *
   * @param appName - 子应用名。
   */
  clearDataListener (appName: string): void {
    eventCenter.off(createEventName(formatAppName(appName), false))
  }

  /**
   * 应用重命名时迁移基座发往子应用的通道缓存与监听器。
   *
   * @remarks
   * 只有旧通道存在时才移动；新通道同名记录会被旧记录覆盖，随后删除旧键。
   */
  changeEventAppName (newAppName: string, oldAppName: string): void {
    const newEventName = createEventName(formatAppName(newAppName), true)
    const oldEventName = createEventName(formatAppName(oldAppName), true)
    if (eventCenter.eventList.has(oldEventName)) {
      eventCenter.eventList.set(newEventName, eventCenter.eventList.get(oldEventName))
      eventCenter.eventList.delete(oldEventName)
    }
  }
}

/** 为单个子应用绑定应用名，并暴露与基座之间的数据通信 API。 */
export class EventCenterForMicroApp extends EventCenterForGlobal {
  /** 经 `formatAppName()` 规范化后用于构造内部通道名的应用名。 */
  appName: string
  /** UMD/预渲染暂停副作用时暂存、重挂载后恢复的监听器快照。 */
  umdDataListeners?: {
    /** 归属于当前子应用的全局数据监听器。 */
    global: Set<CallableFunctionForInteract>,
    /** 当前子应用接收基座数据的普通监听器。 */
    normal: Set<CallableFunctionForInteract>,
  }

  /** 创建绑定到指定应用名的数据中心；非法名称会记录错误。 */
  constructor (appName: string) {
    super()
    this.appName = formatAppName(appName)
    !this.appName && logError(`Invalid appName ${appName}`)
  }

  /**
   * 监听基座发往当前子应用的数据。
   *
   * @param cb - 数据监听器；会记录自动回放配置供 UMD 恢复使用。
   * @param autoTrigger - 首次绑定时是否回放非空缓存；默认不回放。
   */
  addDataListener (cb: CallableFunctionForInteract, autoTrigger?: boolean): void {
    cb.__AUTO_TRIGGER__ = autoTrigger
    eventCenter.on(createEventName(this.appName, true), cb, autoTrigger)
  }

  /**
   * 移除当前子应用接收基座数据的指定监听器。
   *
   * @param cb - 先前注册的监听器。
   */
  removeDataListener (cb: CallableFunctionForInteract): void {
    isFunction(cb) && eventCenter.off(createEventName(this.appName, true), cb)
  }

  /**
   * 查询当前应用指定方向上最近提交的数据。
   *
   * @param fromBaseApp - 为真读取基座发来的数据；默认值为真。
   */
  getData (fromBaseApp = true): Record<PropertyKey, unknown> | null {
    return eventCenter.getData(createEventName(this.appName, fromBaseApp))
  }

  /**
   * 合并并异步发送数据到基座，同时在应用根容器派发 `datachange`。
   *
   * @param data - 写入上行通道的局部数据对象。
   * @param nextStep - 本批数据完成通知后的回调。
   * @param force - 是否跳过浅比较、强制通知。
   */
  dispatch (data: Record<PropertyKey, unknown>, nextStep?: CallableFunction, force?: boolean): void {
    removeDomScope()

    eventCenter.dispatch(
      createEventName(this.appName, false),
      data,
      (resArr: unknown[]) => isFunction(nextStep) && nextStep(resArr),
      force,
      () => {
        const app = appInstanceMap.get(this.appName)
        if (app?.container && isPlainObject(data)) {
          const event = new CustomEvent('datachange', {
            detail: {
              data: eventCenter.getData(createEventName(this.appName, false))
            }
          })

          getRootContainer(app.container).dispatchEvent(event)
        }
      })
  }

  /** 强制向基座发送数据，即使浅比较结果未变化。 */
  forceDispatch (data: Record<PropertyKey, unknown>, nextStep?: CallableFunction): void {
    this.dispatch(data, nextStep, true)
  }

  /**
   * 清空当前应用指定方向的数据缓存。
   *
   * @param fromBaseApp - 为真清除基座发来的数据；默认清除子应用发往基座的数据。
   */
  clearData (fromBaseApp = false): void {
    eventCenter.clearData(createEventName(this.appName, fromBaseApp))
  }

  /**
   * 清空当前子应用接收基座数据的全部监听器。
   */
  clearDataListener (): void {
    eventCenter.off(createEventName(this.appName, true))
  }
}

/**
 * 在 UMD 副作用释放前记录当前子应用的数据监听器快照。
 *
 * @remarks
 * 预渲染卸载、keep-alive 与手动 UMD 流程可能重复记录，因此先复制旧集合再补入当前仍绑定的监听器，避免丢失先前快照。
 *
 * @param microAppEventCenter - 当前子应用的数据中心实例。
 */
export function recordDataCenterSnapshot (microAppEventCenter: EventCenterForMicroApp): void {
  if (microAppEventCenter) {
    microAppEventCenter.umdDataListeners = {
      global: new Set(microAppEventCenter.umdDataListeners?.global),
      normal: new Set(microAppEventCenter.umdDataListeners?.normal),
    }

    const globalEventInfo = eventCenter.eventList.get('global')
    if (globalEventInfo) {
      for (const cb of globalEventInfo.callbacks) {
        if (microAppEventCenter.appName === cb.__APP_NAME__) {
          microAppEventCenter.umdDataListeners.global.add(cb)
        }
      }
    }

    const subAppEventInfo = eventCenter.eventList.get(createEventName(microAppEventCenter.appName, true))
    if (subAppEventInfo) {
      for (const cb of subAppEventInfo.callbacks) {
        microAppEventCenter.umdDataListeners.normal.add(cb)
      }
    }
  }
}

/**
 * 重挂载前把 UMD 快照中的监听器重新绑定到共享事件中心。
 *
 * @remarks
 * 每个监听器沿用原始自动回放配置；恢复完成后立即删除快照，防止后续重复绑定。
 *
 * @param microAppEventCenter - 当前子应用的数据中心实例。
 */
export function rebuildDataCenterSnapshot (microAppEventCenter: EventCenterForMicroApp): void {
  // with 沙箱预渲染模块脚本时可能从未生成 UMD 监听器快照。
  if (microAppEventCenter?.umdDataListeners) {
    for (const cb of microAppEventCenter.umdDataListeners.global) {
      microAppEventCenter.addGlobalDataListener(cb, cb.__AUTO_TRIGGER__)
    }

    for (const cb of microAppEventCenter.umdDataListeners.normal) {
      microAppEventCenter.addDataListener(cb, cb.__AUTO_TRIGGER__)
    }

    resetDataCenterSnapshot(microAppEventCenter)
  }
}

/**
 * 删除子应用数据中心上的 UMD 监听器快照。
 *
 * @param microAppEventCenter - 当前子应用的数据中心实例。
 */
export function resetDataCenterSnapshot (microAppEventCenter: EventCenterForMicroApp): void {
  delete microAppEventCenter?.umdDataListeners
}
