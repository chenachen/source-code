/* eslint-disable no-cond-assign */
import { CallableFunctionForInteract, AppName } from '@micro-app/types'
import { logError, isFunction, isPlainObject, assign, defer } from '../libs/utils'

/** 保存单个事件通道已提交数据、待提交批次及订阅者。 */
interface IEventInfo {
  /** 最近一次完成分发的数据快照。 */
  data: Record<PropertyKey, unknown>
  /** 当前微任务批次内合并、尚未提交的数据。 */
  tempData?: Record<PropertyKey, unknown> | null
  /** 当前批次是否必须越过浅比较并通知订阅者。 */
  force?: boolean
  /** 订阅该事件通道的去重回调集合。 */
  callbacks: Set<CallableFunctionForInteract>
}

/**
 * 以内存事件通道连接基座与子应用，并在同一微任务批次内合并连续数据更新。
 *
 * @remarks
 * `dispatch()` 只写入待提交状态并入队；数据变化或强制通知时，`process()` 在微任务中提交快照、通知监听器，再执行本批调用对应的后续回调。
 */
export default class EventCenter {
  /** 事件名到其已提交数据、待提交数据和监听器集合的注册表。 */
  public eventList = new Map<string, IEventInfo | undefined>()

  /** 校验事件名非空；非法名称会记录错误并阻止后续读写。 */
  private isLegalName (name: string): boolean {
    if (!name) {
      logError('event-center: Invalid name')
      return false
    }

    return true
  }

  /** 当前微任务批次等待处理的事件名；同名事件最多出现一次。 */
  private queue: string[] = []
  /** 记录当前批次内每个事件对应的后续步骤及可选 DOM 数据事件。 */
  private recordStep: Record<string, {
    /** 同一事件名每次 `dispatch()` 注册的完成回调，按调用顺序执行。 */
    nextStepList: Array<CallableFunction>,
    /** 数据提交后、完成回调前派发的可选 DOM 事件；同批次保留最后一个非空值。 */
    dispatchDataEvent?: CallableFunction,
  } | null> = {}

  /**
   * 把事件及其完成步骤并入当前批次，并在队列由空变为非空时安排一次微任务。
   *
   * @remarks
   * 同名连续更新共享一个事件队列项，但每次调用的 `nextStep` 都会保留。异步提交还可确保子应用二次渲染时，已排队的数据更新先于随后绑定的监听逻辑结算。
   */
  private enqueue (
    name: AppName,
    nextStep: CallableFunction,
    dispatchDataEvent?: CallableFunction,
  ): void {
    // 旧实现曾使用单一后续步骤；当前按事件名保存完整调用序列。
    if (this.recordStep[name]) {
      this.recordStep[name]!.nextStepList.push(nextStep)
      dispatchDataEvent && (this.recordStep[name]!.dispatchDataEvent = dispatchDataEvent)
    } else {
      this.recordStep[name] = {
        nextStepList: [nextStep],
        dispatchDataEvent,
      }
    }
    // 仅首个队列项安排微任务；该任务会消费随后追加的全部事件名。
    (!this.queue.includes(name) && this.queue.push(name) === 1) && defer(this.process)
  }

  /**
   * 提交当前批次的数据并依次通知监听器、DOM 事件与完成回调。
   *
   * @remarks
   * 处理前先交换队列和步骤表，使监听器内再次 `dispatch()` 的数据进入下一批，避免新旧批次共用 `tempData` 与 `force`。
   */
  private process = (): void => {
    let name: string | void
    const temRecordStep = this.recordStep
    const queue = this.queue
    this.recordStep = {}
    this.queue = []
    while (name = queue.shift()) {
      const eventInfo = this.eventList.get(name)!
      // 在回调前清空批次标记；回调内重入派发可安全建立下一批状态。
      const tempData = eventInfo.tempData
      const force = eventInfo.force
      eventInfo.tempData = null
      eventInfo.force = false
      let resArr: unknown[]
      if (force || !this.isEqual(eventInfo.data, tempData)) {
        eventInfo.data = tempData || eventInfo.data
        for (const f of eventInfo.callbacks) {
          const res = f(eventInfo.data)
          res && (resArr ??= []).push(res)
        }

        temRecordStep[name]!.dispatchDataEvent?.()

        // 完成回调最后执行；其中若向其他应用派发数据，会进入已交换出的下一批队列。
        temRecordStep[name]!.nextStepList.forEach((nextStep) => nextStep(resArr))
      }
    }
  }

  /**
   * 对新旧数据做浅层严格比较，过滤 React 等场景中重复 `setData` 造成的通知。
   *
   * @remarks
   * 只比较双方自有可枚举键的数量和值引用；嵌套对象不会递归比较，缺少待提交数据视为不相等。
   */
  private isEqual (
    oldData: Record<PropertyKey, unknown>,
    newData: Record<PropertyKey, unknown> | null | void,
  ): boolean {
    if (!newData || Object.keys(oldData).length !== Object.keys(newData).length) return false

    for (const key in oldData) {
      if (Object.prototype.hasOwnProperty.call(oldData, key)) {
        if (oldData[key] !== newData[key]) return false
      }
    }

    return true
  }

  /**
   * 为事件通道添加去重监听器，并可立即回放稳定的缓存数据。
   *
   * @param name - 事件通道名。
   * @param f - 数据更新监听器。
   * @param autoTrigger - 首次绑定时是否回放非空缓存；默认不回放。
   */
  public on (name: string, f: CallableFunctionForInteract, autoTrigger = false): void {
    if (this.isLegalName(name)) {
      if (!isFunction(f)) {
        return logError('event-center: Invalid callback function')
      }

      let eventInfo = this.eventList.get(name)
      if (!eventInfo) {
        eventInfo = {
          data: {},
          callbacks: new Set(),
        }
        this.eventList.set(name, eventInfo)
      } else if (
        autoTrigger &&
        Object.keys(eventInfo.data).length &&
        (
          !this.queue.includes(name) ||
          this.isEqual(eventInfo.data, eventInfo.tempData)
        )
      ) {
        // 仅在缓存非空且没有不同的待提交数据时回放，避免监听器先收到过期快照。
        f(eventInfo.data)
      }

      eventInfo.callbacks.add(f)
    }
  }

  /** 移除指定监听器；未传监听器时清空通道订阅，但保留已提交数据。 */
  public off (
    name: string,
    f?: CallableFunctionForInteract,
  ): void {
    if (this.isLegalName(name)) {
      const eventInfo = this.eventList.get(name)
      if (eventInfo) {
        if (isFunction(f)) {
          eventInfo.callbacks.delete(f)
        } else {
          eventInfo.callbacks.clear()
        }
      }
    }
  }

  /**
   * 清空事件通道的已提交数据，不改变监听器集合。
   */
  public clearData (name: string): void {
    if (this.isLegalName(name)) {
      const eventInfo = this.eventList.get(name)
      if (eventInfo) {
        eventInfo.data = {}
      }
    }
  }

  /**
   * 合并一次数据更新并排入异步批次。
   *
   * @remarks
   * 连续普通更新基于待提交值合并；任一调用要求 `force` 时整批保持强制通知。首次创建通道时强制处理，确保完成回调仍会结算。
   */
  public dispatch (
    name: string,
    data: Record<PropertyKey, unknown>,
    nextStep: CallableFunction,
    force?: boolean,
    dispatchDataEvent?: CallableFunction,
  ): void {
    if (this.isLegalName(name)) {
      if (!isPlainObject(data)) {
        return logError('event-center: data must be object')
      }

      let eventInfo = this.eventList.get(name)
      if (eventInfo) {
        eventInfo.tempData = assign({}, eventInfo.tempData || eventInfo.data, data)
        !eventInfo.force && (eventInfo.force = !!force)
      } else {
        eventInfo = {
          data: data,
          callbacks: new Set(),
        }
        this.eventList.set(name, eventInfo)
        // 子应用可能先发送数据、基座稍后才监听 `datachange`，因此首次派发需创建并强制提交通道。
        eventInfo.force = true
      }
      // 无论通道是否刚创建，都由统一批处理队列完成通知和后续步骤。
      this.enqueue(name, nextStep, dispatchDataEvent)
    }
  }

  /** 返回事件通道最近提交的数据；通道不存在时返回 `null`。 */
  public getData (name: string): Record<PropertyKey, unknown> | null {
    const eventInfo = this.eventList.get(name)
    return eventInfo?.data ?? null
  }
}
