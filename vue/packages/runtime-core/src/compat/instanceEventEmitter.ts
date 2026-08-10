import { isArray } from '@vue/shared'
import type { ComponentInternalInstance } from '../component'
import { ErrorCodes, callWithAsyncErrorHandling } from '../errorHandling'
import { DeprecationTypes, assertCompatEnabled } from './compatConfig'
import type { ComponentPublicInstance } from '../componentPublicInstance'

/** 单个组件实例的 Vue 2 事件名 -> 回调数组注册表。 */
interface EventRegistry {
  [event: string]: Function[] | undefined
}

/** 按组件实例保存事件表；WeakMap 让实例卸载且无引用后自动回收。 */
const eventRegistryMap = /*@__PURE__*/ new WeakMap<
  ComponentInternalInstance,
  EventRegistry
>()

/** 惰性取得/创建实例事件注册表，无原型对象避免事件名与对象原型冲突。 */
export function getRegistry(
  instance: ComponentInternalInstance,
): EventRegistry {
  let events = eventRegistryMap.get(instance)
  if (!events) {
    eventRegistryMap.set(instance, (events = Object.create(null)))
  }
  return events!
}

/** 实现 Vue 2 `vm.$on`，并区分普通事件总线与 `hook:*` 生命周期事件的弃用项。 */
export function on(
  instance: ComponentInternalInstance,
  event: string | string[],
  fn: Function,
): ComponentPublicInstance | null {
  if (isArray(event)) {
    event.forEach(e => on(instance, e, fn))
  } else {
    if (event.startsWith('hook:')) {
      assertCompatEnabled(
        DeprecationTypes.INSTANCE_EVENT_HOOKS,
        instance,
        event,
      )
    } else {
      assertCompatEnabled(DeprecationTypes.INSTANCE_EVENT_EMITTER, instance)
    }
    const events = getRegistry(instance)
    ;(events[event] || (events[event] = [])).push(fn)
  }
  return instance.proxy
}

/**
 * 实现 `vm.$once`：包装函数首次调用前先注销自身；`.fn` 保存原回调，确保用户使用
 * 原函数调用 `$off(event, fn)` 也能匹配包装器。
 */
export function once(
  instance: ComponentInternalInstance,
  event: string,
  fn: Function,
): ComponentPublicInstance | null {
  const wrapped = (...args: any[]) => {
    off(instance, event, wrapped)
    fn.apply(instance.proxy, args)
  }
  wrapped.fn = fn
  on(instance, event, wrapped)
  return instance.proxy
}

/** 实现 `vm.$off` 的清空全部、批量事件、清空单事件及删除指定回调四种形式。 */
export function off(
  instance: ComponentInternalInstance,
  event?: string | string[],
  fn?: Function,
): ComponentPublicInstance | null {
  assertCompatEnabled(DeprecationTypes.INSTANCE_EVENT_EMITTER, instance)
  const vm = instance.proxy
  // 无事件名：用新空表替换，移除实例全部监听器。
  if (!event) {
    eventRegistryMap.set(instance, Object.create(null))
    return vm
  }
  // 事件数组：逐项递归复用相同逻辑。
  if (isArray(event)) {
    event.forEach(e => off(instance, e, fn))
    return vm
  }
  // 指定事件：无 fn 时清空整组，有 fn 时同时匹配原回调和 once 包装器 `.fn`。
  const events = getRegistry(instance)
  const cbs = events[event!]
  if (!cbs) {
    return vm
  }
  if (!fn) {
    events[event!] = undefined
    return vm
  }
  events[event!] = cbs.filter(cb => !(cb === fn || (cb as any).fn === fn))
  return vm
}

/**
 * 向 Vue 2 实例事件总线派发事件。
 * 回调绑定公共实例为 this，并走 Vue 统一异步错误处理，使 Promise 拒绝也能进入
 * errorCaptured/app.config.errorHandler。
 */
export function emit(
  instance: ComponentInternalInstance,
  event: string,
  args: any[],
): ComponentPublicInstance | null {
  const cbs = getRegistry(instance)[event]
  if (cbs) {
    callWithAsyncErrorHandling(
      cbs.map(cb => cb.bind(instance.proxy)),
      instance,
      ErrorCodes.COMPONENT_EVENT_HANDLER,
      args,
    )
  }
  return instance.proxy
}
