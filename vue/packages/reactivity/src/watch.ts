import {
  EMPTY_OBJ,
  NOOP,
  hasChanged,
  isArray,
  isFunction,
  isMap,
  isObject,
  isPlainObject,
  isSet,
  remove,
} from '@vue/shared'
import { warn } from './warning'
import type { ComputedRef } from './computed'
import { ReactiveFlags } from './constants'
import {
  type DebuggerOptions,
  EffectFlags,
  type EffectScheduler,
  ReactiveEffect,
  pauseTracking,
  resetTracking,
} from './effect'
import { isReactive, isShallow } from './reactive'
import { type Ref, isRef } from './ref'
import { getCurrentScope } from './effectScope'

/**
 * watch 各执行阶段对应的 Vue 错误码。
 *
 * 这些值随基础 watch 逻辑从 `runtime-core/errorHandling.ts` 移到 `@vue/reactivity`；
 * 运行时核心的统一错误处理依赖既有数字协议，因此数值和顺序必须保持不变。
 * `watch()` 不直接捕获这些阶段的异常，而把函数、错误码和参数交给可选 `call()`，
 * 由 runtime-core 关联组件实例、错误边界和应用级 errorHandler。
 */
export enum WatchErrorCodes {
  /** 执行数据源 getter 时出错。 */
  WATCH_GETTER = 2,
  /** 执行 watch 回调或 watchEffect 函数时出错。 */
  WATCH_CALLBACK,
  /** 执行 watcher 清理函数时出错。 */
  WATCH_CLEANUP,
}

/** `watchEffect()` 风格函数；参数用于注册下一轮前的清理动作。 */
export type WatchEffect = (onCleanup: OnCleanup) => void

/** 可直接作为 watch 数据源的 Ref、计算属性或 getter。 */
export type WatchSource<T = any> = Ref<T, any> | ComputedRef<T> | (() => T)

/**
 * `watch(source, callback)` 的回调签名。
 * `oldValue` 首次立即执行时为 `undefined`；多数据源首次立即执行时为空数组。
 */
export type WatchCallback<V = any, OV = any> = (
  value: V,
  oldValue: OV,
  onCleanup: OnCleanup,
) => any

/** watcher 回调拿到的清理注册函数类型。 */
export type OnCleanup = (cleanupFn: () => void) => void

/** 底层 watch 配置；运行时核心会在此基础上增加 flush 等调度语义。 */
export interface WatchOptions<Immediate = boolean> extends DebuggerOptions {
  /** 是否在建立旧值后立即执行一次回调。 */
  immediate?: Immediate
  /** 是否递归读取数据源；数字表示最大遍历层数。 */
  deep?: boolean | number
  /** 是否在第一次有效回调后自动停止。 */
  once?: boolean
  /** 自定义 job 调度器。 */
  scheduler?: WatchScheduler
  /** 自定义无效数据源警告输出。 */
  onWarn?: (msg: string, ...args: any[]) => void
  /**
   * 允许运行时核心给 job 添加队列标记、组件实例等元数据。
   *
   * @internal
   */
  augmentJob?: (job: (...args: any[]) => void) => void
  /**
   * 统一调用 getter/callback/cleanup 的错误处理入口；运行时核心用它关联组件错误边界。
   *
   * @internal
   */
  call?: (
    fn: Function | Function[],
    type: WatchErrorCodes,
    args?: unknown[],
  ) => void
}

/** 兼容旧 API 的纯停止函数类型。 */
export type WatchStopHandle = () => void

/**
 * watch 返回句柄：直接调用等价于 `stop()`，还可暂停并在恢复时补执行遗漏的变化。
 */
export interface WatchHandle extends WatchStopHandle {
  /** 暂停调度，但保留依赖与期间的触发记录。 */
  pause: () => void
  /** 恢复调度；暂停期间发生过变化时会调度一次。 */
  resume: () => void
  /** 永久停止并执行清理。 */
  stop: () => void
}

/**
 * 尚未取得旧值的哨兵。不能直接用 `undefined`，因为数据源的真实初值也可能是 undefined，
 * 而 `immediate` 回调仍需正确区分“首次调用”和“已有旧值 undefined”。
 */
const INITIAL_WATCHER_VALUE = {}

/** watch job 调度器；`isFirstRun` 允许运行时核心选择首次同步、后续入队。 */
export type WatchScheduler = (job: () => void, isFirstRun: boolean) => void

/** 每个 watcher 登记的全部清理函数；WeakMap 不延长已停止 effect 的生命周期。 */
const cleanupMap: WeakMap<ReactiveEffect, (() => void)[]> = new WeakMap()
/** 当前正在执行回调的 watcher，供 `onWatcherCleanup()` 隐式关联。 */
let activeWatcher: ReactiveEffect | undefined = undefined

/**
 * 返回当前正在执行回调的 watcher；没有时返回 `undefined`。
 *
 * 与 `activeSub` 不同，它只在 watch/watchEffect 用户回调期间设置，不覆盖普通 effect
 * 或 computed 的依赖收集上下文。
 */
export function getCurrentWatcher(): ReactiveEffect<any> | undefined {
  return activeWatcher
}

/**
 * 为当前活动 watcher 注册清理回调；回调会在下一次有效执行前或 watcher 停止时调用。
 *
 * 与 `onEffectCleanup` 的单函数字段不同，一个 watcher 可登记多个清理函数。常用于取消
 * 上一轮尚未完成的请求、定时器或事件监听，避免过期异步结果覆盖新状态。
 *
 * @param cleanupFn 要关联到 watcher 的清理函数。
 * @param failSilently 为 `true` 时，无活动 watcher 也不发出警告。
 * @param owner 显式所属 effect；默认使用当前活动 watcher。
 */
export function onWatcherCleanup(
  cleanupFn: () => void,
  failSilently = false,
  owner: ReactiveEffect | undefined = activeWatcher,
): void {
  if (owner) {
    let cleanups = cleanupMap.get(owner)
    if (!cleanups) cleanupMap.set(owner, (cleanups = []))
    cleanups.push(cleanupFn)
  } else if (__DEV__ && !failSilently) {
    warn(
      `onWatcherCleanup() was called when there was no active watcher` +
        ` to associate with.`,
    )
  }
}

/**
 * 创建 watcher：跟踪数据源，在有效变化时执行回调或重新执行 watchEffect。
 *
 * 支持单个 Ref/getter/响应式对象、多个数据源数组，以及无回调的 effect 函数。响应式
 * 对象默认深遍历；getter 默认只比较返回值。此函数是平台无关底层实现，组件队列时机、
 * 错误边界等由 `scheduler`、`call`、`augmentJob` 从运行时核心注入。
 *
 * @param source 要观察的数据源或 watchEffect 函数。
 * @param cb 数据变化回调；省略时采用 watchEffect 语义。
 * @param options 立即、深度、一次性、调度和调试配置。
 * @returns 可调用的停止句柄，并附带 pause/resume/stop 方法。
 */
export function watch(
  source: WatchSource | WatchSource[] | WatchEffect | object,
  cb?: WatchCallback | null,
  options: WatchOptions = EMPTY_OBJ,
): WatchHandle {
  const { immediate, deep, once, scheduler, augmentJob, call } = options

  /** 输出统一的无效 watch 数据源警告，并允许运行时核心替换警告渠道。 */
  const warnInvalidSource = (s: unknown) => {
    ;(options.onWarn || warn)(
      `Invalid watch source: `,
      s,
      `A watch source can only be a getter/effect function, a ref, ` +
        `a reactive object, or an array of these types.`,
    )
  }

  /** 按 `deep` 配置读取响应式对象，确保 getter 触及需要观察的属性层级。 */
  const reactiveGetter = (source: object) => {
    // deep 为真时，cb 分支稍后会统一包裹 getter 并按指定深度 traverse。
    if (deep) return source
    // 显式关闭 deep 或源本身为浅层代理：只读取根层属性，使根层替换仍可触发。
    if (isShallow(source) || deep === false || deep === 0)
      return traverse(source, 1)
    // 直接 watch 响应式对象且未指定 deep 时，按 Vue API 语义默认深度遍历。
    return traverse(source)
  }

  let effect: ReactiveEffect
  let getter: () => any
  let cleanup: (() => void) | undefined
  let boundCleanup: typeof onWatcherCleanup
  let forceTrigger = false
  let isMultiSource = false

  if (isRef(source)) {
    getter = () => source.value
    // shallowRef 的内部可被 triggerRef() 强制通知，即使引用未变化也必须执行回调。
    forceTrigger = isShallow(source)
  } else if (isReactive(source)) {
    getter = () => reactiveGetter(source)
    forceTrigger = true
  } else if (isArray(source)) {
    // source 数组表示多个数据源，而不是把普通数组本身作为单一深度观察对象。
    isMultiSource = true
    forceTrigger = source.some(s => isReactive(s) || isShallow(s))
    getter = () =>
      source.map(s => {
        if (isRef(s)) {
          return s.value
        } else if (isReactive(s)) {
          return reactiveGetter(s)
        } else if (isFunction(s)) {
          return call ? call(s, WatchErrorCodes.WATCH_GETTER) : s()
        } else {
          __DEV__ && warnInvalidSource(s)
        }
      })
  } else if (isFunction(source)) {
    if (cb) {
      // 有 cb：函数只是懒求值数据源，返回值用于新旧比较。
      getter = call
        ? () => call(source, WatchErrorCodes.WATCH_GETTER)
        : (source as () => any)
    } else {
      // 无 cb：函数本身就是 watchEffect，运行中读取的内容构成依赖。
      getter = () => {
        if (cleanup) {
          // 清理函数不属于新一轮数据源依赖，执行时暂停追踪。
          pauseTracking()
          try {
            cleanup()
          } finally {
            resetTracking()
          }
        }
        const currentEffect = activeWatcher
        activeWatcher = effect
        try {
          return call
            ? call(source, WatchErrorCodes.WATCH_CALLBACK, [boundCleanup])
            : source(boundCleanup)
        } finally {
          activeWatcher = currentEffect
        }
      }
    }
  } else {
    getter = NOOP
    __DEV__ && warnInvalidSource(source)
  }

  if (cb && deep) {
    // getter 返回对象时，仅返回引用不会触发嵌套属性的 get；主动遍历才能收集深层依赖。
    const baseGetter = getter
    const depth = deep === true ? Infinity : deep
    getter = () => traverse(baseGetter(), depth)
  }

  const scope = getCurrentScope()
  /**
   * 停止 watcher，并从仍活动的作用域中移除 effect，避免作用域长期持有已停止实例。
   */
  const watchHandle: WatchHandle = () => {
    effect.stop()
    if (scope && scope.active) {
      remove(scope.effects, effect)
    }
  }

  if (once && cb) {
    // 先执行用户回调再停止，确保回调中的清理注册能由 stop() 立即执行。
    const _cb = cb
    cb = (...args) => {
      const res = _cb(...args)
      watchHandle()
      return res
    }
  }

  let oldValue: any = isMultiSource
    ? new Array((source as []).length).fill(INITIAL_WATCHER_VALUE)
    : INITIAL_WATCHER_VALUE

  /**
   * 调度器真正执行的 watcher 任务：先做活动/脏检查，再求新值、清理上一轮并调用回调。
   */
  const job = (immediateFirstRun?: boolean) => {
    // 已停止无需执行；非首次且依赖版本没变时跳过昂贵 getter/深比较。
    if (
      !(effect.flags & EffectFlags.ACTIVE) ||
      (!effect.dirty && !immediateFirstRun)
    ) {
      return
    }
    if (cb) {
      // watch(source, cb)：重新求值，再根据配置与新旧值判断是否调用 cb。
      const newValue = effect.run()
      if (
        immediateFirstRun ||
        deep ||
        forceTrigger ||
        (isMultiSource
          ? (newValue as any[]).some((v, i) => hasChanged(v, oldValue[i]))
          : hasChanged(newValue, oldValue))
      ) {
        // 只在 cb 真要再次运行时清理上一轮资源；无有效变化时保留它们。
        if (cleanup) {
          cleanup()
        }
        const currentWatcher = activeWatcher
        activeWatcher = effect
        try {
          const args = [
            newValue,
            // 首次 immediate 单源传 undefined，多源传 []，匹配公开 API 约定。
            oldValue === INITIAL_WATCHER_VALUE
              ? undefined
              : isMultiSource && oldValue[0] === INITIAL_WATCHER_VALUE
                ? []
                : oldValue,
            boundCleanup,
          ]
          // 调用回调前更新 oldValue；同步递归调度时也能看到最近一次值。
          oldValue = newValue
          call
            ? call(cb!, WatchErrorCodes.WATCH_CALLBACK, args)
            : // @ts-expect-error：运行时 args 已按单源/多源重载构造，静态联合类型无法收窄。
              cb!(...args)
        } finally {
          activeWatcher = currentWatcher
        }
      }
    } else {
      // watchEffect：effect 内部自行管理依赖，无需新旧值比较。
      effect.run()
    }
  }

  if (augmentJob) {
    // 在交给 scheduler 前，允许运行时核心给稳定的 job 函数增加队列元数据。
    augmentJob(job)
  }

  effect = new ReactiveEffect(getter)

  effect.scheduler = scheduler
    ? () => scheduler(job, false)
    : (job as EffectScheduler)

  /** 把回调内的清理注册固定绑定到当前 effect，避免异步/嵌套 watcher 串错归属。 */
  boundCleanup = fn => onWatcherCleanup(fn, false, effect)

  /**
   * 执行当前 watcher 的全部清理并删除记录；下一轮注册时会创建新数组。
   * 同一函数也挂到 `effect.onStop`，因此重跑与永久停止共享完全相同的清理语义。
   */
  cleanup = effect.onStop = () => {
    const cleanups = cleanupMap.get(effect)
    if (cleanups) {
      if (call) {
        call(cleanups, WatchErrorCodes.WATCH_CLEANUP)
      } else {
        for (const cleanup of cleanups) cleanup()
      }
      cleanupMap.delete(effect)
    }
  }

  if (__DEV__) {
    effect.onTrack = options.onTrack
    effect.onTrigger = options.onTrigger
  }

  // 首次运行：watch 根据 immediate 决定只建立旧值还是执行回调；有 scheduler 的
  // watchEffect 由调度器决定首次时机，无 scheduler 则同步执行。
  if (cb) {
    if (immediate) {
      job(true)
    } else {
      oldValue = effect.run()
    }
  } else if (scheduler) {
    scheduler(job.bind(null, true), true)
  } else {
    effect.run()
  }

  watchHandle.pause = effect.pause.bind(effect)
  watchHandle.resume = effect.resume.bind(effect)
  // 句柄本身可调用停止，同时 `.stop()` 提供更显式的同一入口。
  watchHandle.stop = watchHandle

  return watchHandle
}

/**
 * 递归读取一个值的可观察内容，用“访问”而非结构比较来建立深度 watcher 依赖。
 *
 * 支持 Ref、数组、Map/Set 的值及普通对象的可枚举字符串/Symbol 属性。`markRaw()` 值、
 * 非对象和达到深度上限的分支立即停止。`seen` 记录某对象已被访问的最大剩余深度：
 * 既打断循环引用，也允许同一对象后来从更短路径进入、以更大剩余深度继续遍历。
 *
 * @param value 当前要访问的值。
 * @param depth 最大遍历层数；默认无限，`1` 表示只读取根层成员。
 * @param seen 本轮遍历的循环引用与深度记录表。
 * @returns 原值；返回值仅便于 getter 继续进行新旧引用比较。
 */
export function traverse(
  value: unknown,
  depth: number = Infinity,
  seen?: Map<unknown, number>,
): unknown {
  if (depth <= 0 || !isObject(value) || (value as any)[ReactiveFlags.SKIP]) {
    return value
  }

  seen = seen || new Map()
  if ((seen.get(value) || 0) >= depth) {
    return value
  }
  seen.set(value, depth)
  // 每进入一层容器消耗一层深度，子项共享更新后的剩余深度。
  depth--
  if (isRef(value)) {
    traverse(value.value, depth, seen)
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      traverse(value[i], depth, seen)
    }
  } else if (isSet(value) || isMap(value)) {
    // Map 键的身份通常不应被递归代理/解包；深度观察关注可能变化的 value/Set 成员。
    value.forEach((v: any) => {
      traverse(v, depth, seen)
    })
  } else if (isPlainObject(value)) {
    for (const key in value) {
      traverse(value[key], depth, seen)
    }
    for (const key of Object.getOwnPropertySymbols(value)) {
      // for...in 不覆盖 Symbol；只补充可枚举 Symbol，保持与普通可枚举状态字段一致。
      if (Object.prototype.propertyIsEnumerable.call(value, key)) {
        traverse(value[key as any], depth, seen)
      }
    }
  }
  return value
}
