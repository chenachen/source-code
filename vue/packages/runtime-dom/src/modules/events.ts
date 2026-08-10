import { NOOP, hyphenate, isArray, isFunction } from '@vue/shared'
import {
  type ComponentInternalInstance,
  ErrorCodes,
  callWithAsyncErrorHandling,
  warn,
} from '@vue/runtime-core'

/**
 * 实际注册到 DOM 的稳定事件代理。
 * value 可热替换而无需 remove/add；attached 用于过滤早于监听器注册的冒泡事件。
 */
interface Invoker extends EventListener {
  value: EventValue
  attached: number
}

/** 单事件 prop 可绑定一个函数或按顺序执行的函数数组。 */
type EventValue = Function | Function[]

/** DOM addEventListener 的薄封装，便于测试替换/复用精确类型。 */
export function addEventListener(
  el: Element,
  event: string,
  handler: EventListener,
  options?: EventListenerOptions,
): void {
  el.addEventListener(event, handler, options)
}

/** DOM removeEventListener 的薄封装。options 必须与注册时解析结果一致。 */
export function removeEventListener(
  el: Element,
  event: string,
  handler: EventListener,
  options?: EventListenerOptions,
): void {
  el.removeEventListener(event, handler, options)
}

/** 元素上保存 Vue Event Invokers 映射的私有 symbol，避免与用户属性冲突。 */
const veiKey: unique symbol = Symbol('_vei')

/**
 * 新增、更新或移除 VNode 事件 prop。
 * 更新只替换稳定 invoker.value，不反复解绑 DOM listener，既更快，也保持事件冒泡期间
 * 当前 listener 身份稳定。rawName 同时编码 Once/Passive/Capture options。
 */
export function patchEvent(
  el: Element & { [veiKey]?: Record<string, Invoker | undefined> },
  rawName: string,
  prevValue: EventValue | null,
  nextValue: EventValue | unknown,
  instance: ComponentInternalInstance | null = null,
): void {
  // vei = Vue Event Invokers；按原 prop 名缓存，options 变化会表现为不同 key。
  const invokers = el[veiKey] || (el[veiKey] = {})
  const existingInvoker = invokers[rawName]
  if (nextValue && existingInvoker) {
    // 监听器已存在：只替换内部函数值。
    existingInvoker.value = __DEV__
      ? sanitizeEventValue(nextValue, rawName)
      : (nextValue as EventValue)
  } else {
    const [name, options] = parseName(rawName)
    if (nextValue) {
      // 首次绑定：解析事件名/options，创建稳定代理。
      const invoker = (invokers[rawName] = createInvoker(
        __DEV__
          ? sanitizeEventValue(nextValue, rawName)
          : (nextValue as EventValue),
        instance,
      ))
      addEventListener(el, name, invoker, options)
    } else if (existingInvoker) {
      // 新值为空：用同一代理和 options 解除监听。
      removeEventListener(el, name, existingInvoker, options)
      invokers[rawName] = undefined
    }
  }
}

/** 从事件 prop 尾部逐个提取 addEventListener options。 */
const optionsModifierRE = /(Once|Passive|Capture)$/
/** 保护事件本身名为 once/passive/capture，不把唯一名称误当 modifier。 */
const optionsModifierEventRE = /^on:?(?:Once|Passive|Capture)$/

/** 把 `onClickOnceCapture` 解析为 `[click, { once: true, capture: true }]`。 */
function parseName(name: string): [string, EventListenerOptions | undefined] {
  let options: EventListenerOptions | undefined
  let m
  while (
    (m = name.match(optionsModifierRE)) &&
    !optionsModifierEventRE.test(name)
  ) {
    if (!options) options = {}
    name = name.slice(0, name.length - m[1].length)
    ;(options as any)[m[1].toLowerCase()] = true
  }
  const event = name[2] === ':' ? name.slice(3) : hyphenate(name.slice(2))
  return [event, options]
}

// 同一 tick 注册的全部 listener 共用一个 Date.now 时间戳，并在微任务末尾清空；避免
// 大量节点挂载时反复调用时间 API，又能保持跨 tick 的先后判断。
let cachedNow: number = 0
/** 用微任务重置 cachedNow 的共享已决 Promise。 */
const p = /*@__PURE__*/ Promise.resolve()
/** 获取当前注册批次时间戳。 */
const getNow = () =>
  cachedNow || (p.then(() => (cachedNow = 0)), (cachedNow = Date.now()))

/**
 * 创建捕获组件错误上下文的稳定 DOM EventListener 代理。
 * 数组处理器额外模拟 stopImmediatePropagation，后续函数不会继续执行。
 */
function createInvoker(
  initialValue: EventValue,
  instance: ComponentInternalInstance | null,
) {
  const invoker: Invoker = (e: Event & { _vts?: number }) => {
    // vue#6566：内层 click 可在冒泡途中触发 patch，并给外层新增 handler；某些浏览器会在
    // 冒泡阶段间刷新微任务，导致这个“事件发生后才注册”的外层 handler 仍收到同一事件。
    // 保存注册时间，并给首次经 Vue 处理的事件附 `_vts`，仅执行事件发生后已存在的 handler。
    // 不直接信任 event.timeStamp：不同浏览器基准不一致，iframe 事件也会跨时间原点（#2513）。
    if (!e._vts) {
      e._vts = Date.now()
    } else if (e._vts <= invoker.attached) {
      return
    }
    const value = invoker.value
    if (isArray(value)) {
      const originalStop = e.stopImmediatePropagation
      e.stopImmediatePropagation = () => {
        originalStop.call(e)
        ;(e as any)._stopped = true
      }
      const handlers = value.slice()
      const args = [e]
      for (let i = 0; i < handlers.length; i++) {
        if ((e as any)._stopped) {
          break
        }
        const handler = handlers[i]
        if (handler) {
          callWithAsyncErrorHandling(
            handler,
            instance,
            ErrorCodes.NATIVE_EVENT_HANDLER,
            args,
          )
        }
      }
    } else {
      callWithAsyncErrorHandling(
        value,
        instance,
        ErrorCodes.NATIVE_EVENT_HANDLER,
        [e],
      )
    }
  }
  invoker.value = initialValue
  invoker.attached = getNow()
  return invoker
}

/** 开发环境把非法事件值替换为 NOOP 并给出常见 `@`/`:` 误写提示。 */
function sanitizeEventValue(value: unknown, propName: string): EventValue {
  if (isFunction(value) || isArray(value)) {
    return value as EventValue
  }
  warn(
    `Wrong type passed as event handler to ${propName} - did you forget @ or : ` +
      `in front of your prop?\nExpected function or array of functions, received type ${typeof value}.`,
  )
  return NOOP
}
