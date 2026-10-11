/* eslint-disable no-cond-assign */
import { CallableFunctionForInteract, AppName } from '@micro-app/types'
import { logError, isFunction, isPlainObject, assign, defer } from '../libs/utils'

/** 保存单个事件通道的可读取数据、待提交数据及订阅者。 */
interface IEventInfo {
  /** 当前可读取的数据；首次 dispatch 同步写入，已有通道则在批次处理时更新。 */
  data: Record<PropertyKey, unknown>
  /** dispatch 合并后尚未被 process 消费的数据。 */
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
 * 已有通道的 `dispatch()` 合并到待提交数据；首次派发会立即建立可读取数据。监听器、DOM 数据事件和
 * 后续回调统一由微任务处理，只有浅比较发现变化或本批要求强制通知时才执行。
 */
export default class EventCenter {
  /** 事件名到其可读取数据、待提交数据和监听器集合的注册表。 */
  public eventList = new Map<string, IEventInfo | undefined>()

  /** 只校验名称是否为真值；适配 API 负责先格式化应用名，此层不额外做字符串类型检查。 */
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
    /** 本批实际通知时，按 dispatch 调用顺序执行的后续回调。 */
    nextStepList: Array<CallableFunction>,
    /** 数据提交后、完成回调前派发的可选 DOM 事件；同批次保留最后一个非空值。 */
    dispatchDataEvent?: CallableFunction,
  } | null> = {}

  /**
   * 把事件及其完成步骤并入当前批次，并在队列由空变为非空时安排一次微任务。
   *
   * @remarks
   * 同名连续更新共享一个队列项，但每次调用的 `nextStep` 都会保留。微任务边界使同一同步调用栈内
   * 后绑定的监听器也能加入本次通知，不必先收到旧缓存再收到新数据。
   */
  private enqueue (
    name: AppName,
    nextStep: CallableFunction,
    dispatchDataEvent?: CallableFunction,
  ): void {
    // 同名派发只合并数据，不丢弃每次调用登记的后续步骤。
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
   * 先取走队列和步骤表，让回调内的派发可以登记新的微任务。各通道的 `tempData/force` 则在轮到该
   * 通道时才取走并清空：向已处理通道重入时建立下一批数据，向本轮尚未处理通道派发则仍会改变它
   * 本轮读取的数据。只有发生通知时才执行后续步骤，监听器返回的真值被收集为数组，不等待 Promise。
   * 同步回调抛错会中断当前处理，后续 DOM 事件、完成步骤和本轮剩余通道不会继续执行。
   * 若旧队列为 A/B，A 向尚未消费的 B 派发，B 本轮会用新数据配旧完成步骤；新队列又留下 B，
   * 下一批读取已清成 null 的 tempData，浅比较判为不等，可重复通知同一 data 并执行新完成步骤。
   */
  private process = (): void => {
    let name: string | void
    const temRecordStep = this.recordStep
    const queue = this.queue
    this.recordStep = {}
    this.queue = []
    // 队列只保存名称，没有通道数据快照；重入修改的仍是 eventList 中的同一个 eventInfo。
    while (name = queue.shift()) {
      const eventInfo = this.eventList.get(name)!
      // 先清空当前通道的批次标记；该通道监听器再次派发时会建立新的待提交数据。
      const tempData = eventInfo.tempData
      const force = eventInfo.force
      eventInfo.tempData = null
      eventInfo.force = false
      let resArr: unknown[]
      if (force || !this.isEqual(eventInfo.data, tempData)) {
        eventInfo.data = tempData || eventInfo.data
        // 遍历活的 Set：回调中的增删遵循 Set 迭代规则，不冻结本轮监听器名单。
        for (const f of eventInfo.callbacks) {
          const res = f(eventInfo.data)
          res && (resArr ??= []).push(res)
        }

        temRecordStep[name]!.dispatchDataEvent?.()

        // 后续步骤拿到监听器返回的真值数组；没有真值时为 undefined，可选 DOM 数据事件已先派发。
        temRecordStep[name]!.nextStepList.forEach((nextStep) => nextStep(resArr))
      }
    }
  }

  /**
   * 对新旧数据做浅层严格比较，过滤 React 等场景中重复 `setData` 造成的通知。
   *
   * @remarks
   * 先比较自有可枚举字符串键数量，再逐个检查旧对象自有键的值是否严格相等；不递归比较嵌套对象，
   * 也不比较 Symbol 键。缺少待提交数据视为不相等，因此首次派发仍会进入通知分支。
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
   * 为事件通道添加去重监听器，并可按队列状态同步回放当前 data。
   *
   * @param name - 事件通道名。
   * @param f - 数据更新监听器。
   * @param autoTrigger - 是否同步回放非空 data；当前待调度队列含该通道且新旧值不等时跳过，默认关闭。
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
        // 仅检查当前待调度队列；process 已取走的本轮队列不在 this.queue 中。
        // 普通同步派发后，新旧值不等时跳过旧值回放，监听器随后加入批次通知。
        f(eventInfo.data)
      }

      eventInfo.callbacks.add(f)
    }
  }

  /** 移除指定监听器；未传函数时清空通道订阅，保留数据与已排队的派发。 */
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
   * 清空事件通道当前可读取的数据，不改变监听器或待提交批次。
   *
   * 已排队的 tempData 仍可能在随后微任务中重新写入；此方法不取消派发。
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
   * 已有通道基于待提交值或当前数据做浅合并；任一调用要求 `force` 时整批保持强制通知。新通道直接
   * 保存传入对象并强制处理，因此首次 `getData()` 可同步读到它，通知及后续步骤仍在微任务中执行。
   *
   * @param name - 内部通道名；应由适配层生成。
   * @param data - 浅合并的对象数据，数组及其他类型会被拒绝。
   * @param nextStep - 必需的完成回调，适配层会包装可选用户回调；直接漏传会在通知后调用时抛错。
   * @param force - 越过同值过滤；同一待提交批次内一旦为 true 就不再被后续 false 覆盖。
   * @param dispatchDataEvent - 通知监听器后派发的可选 DOM 事件，同批次保留最后一个非空回调。
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
        // 首次派发没有 tempData；强制通知保证它仍会派发 DOM 事件并执行后续步骤。
        eventInfo.force = true
      }
      // 无论通道是否刚创建，都由统一批处理队列完成通知和后续步骤。
      this.enqueue(name, nextStep, dispatchDataEvent)
    }
  }

  /** 返回通道当前 data 引用；首次派发立即可读，已有通道的待提交合并值尚不可读，未建通道返回 null。 */
  public getData (name: string): Record<PropertyKey, unknown> | null {
    const eventInfo = this.eventList.get(name)
    return eventInfo?.data ?? null
  }
}
