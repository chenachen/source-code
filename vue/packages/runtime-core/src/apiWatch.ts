import {
  type WatchOptions as BaseWatchOptions,
  type DebuggerOptions,
  type ReactiveMarker,
  type WatchCallback,
  type WatchEffect,
  type WatchHandle,
  type WatchSource,
  watch as baseWatch,
} from '@vue/reactivity'
import { type SchedulerJob, SchedulerJobFlags, queueJob } from './scheduler'
import { EMPTY_OBJ, NOOP, extend, isFunction, isString } from '@vue/shared'
import {
  type ComponentInternalInstance,
  currentInstance,
  isInSSRComponentSetup,
  setCurrentInstance,
} from './component'
import { callWithAsyncErrorHandling } from './errorHandling'
import { queuePostRenderEffect } from './renderer'
import { warn } from './warning'
import type { ObjectWatchOptionItem } from './componentOptions'
import { useSSRContext } from './helpers/useSsrContext'
import type { ComponentPublicInstance } from './componentPublicInstance'

export type {
  WatchHandle,
  WatchStopHandle,
  WatchEffect,
  WatchSource,
  WatchCallback,
  OnCleanup,
} from '@vue/reactivity'

/** immediate watcher 首次执行没有旧值，因此把回调第二个参数扩展为 `undefined`。 */
type MaybeUndefined<T, I> = I extends true ? T | undefined : T

/** 把多 source 元组逐项映射成回调接收的值元组，并保留每一项的推导类型。 */
type MapSources<T, Immediate> = {
  [K in keyof T]: T[K] extends WatchSource<infer V>
    ? MaybeUndefined<V, Immediate>
    : T[K] extends object
      ? MaybeUndefined<T[K], Immediate>
      : never
}

/** `watchEffect` 的运行时选项。 */
export interface WatchEffectOptions extends DebuggerOptions {
  /**
   * effect 相对组件渲染的执行时机：`pre` 在组件更新前，`post` 在提交后，`sync` 立即执行。
   */
  flush?: 'pre' | 'post' | 'sync'
}

/** `watch` 选项；`Immediate` 泛型同时决定旧值参数是否可能为 `undefined`。 */
export interface WatchOptions<Immediate = boolean> extends WatchEffectOptions {
  /** 是否在建立 watcher 时立即调用一次回调。 */
  immediate?: Immediate
  /** 是否遍历嵌套属性；数字表示最大遍历深度。 */
  deep?: boolean | number
  /** 是否在回调首次执行后自动停止 watcher。 */
  once?: boolean
}

/**
 * 创建自动追踪依赖的副作用，默认在所属组件更新前刷新。
 * 回调同时承担依赖读取和副作用，不提供新旧值比较。
 */
export function watchEffect(
  effect: WatchEffect,
  options?: WatchEffectOptions,
): WatchHandle {
  return doWatch(effect, null, options)
}

/** 创建在组件 DOM 更新完成后运行的 `watchEffect`，适合读取更新后的模板节点。 */
export function watchPostEffect(
  effect: WatchEffect,
  options?: DebuggerOptions,
): WatchHandle {
  return doWatch(
    effect,
    null,
    __DEV__
      ? extend({}, options as WatchEffectOptions, { flush: 'post' })
      : { flush: 'post' },
  )
}

/**
 * 创建依赖变化后同步运行的 `watchEffect`。
 * 不经过批处理；连续修改会连续触发，应避免监听会被批量变更的大型集合。
 */
export function watchSyncEffect(
  effect: WatchEffect,
  options?: DebuggerOptions,
): WatchHandle {
  return doWatch(
    effect,
    null,
    __DEV__
      ? extend({}, options as WatchEffectOptions, { flush: 'sync' })
      : { flush: 'sync' },
  )
}

/** `watch()` 多数据源数组允许 ref/getter，也允许直接传入响应式对象。 */
export type MultiWatchSources = (WatchSource<unknown> | object)[]

// 单个 source：回调值类型直接从 source 推导。
export function watch<T, Immediate extends Readonly<boolean> = false>(
  source: WatchSource<T>,
  cb: WatchCallback<T, MaybeUndefined<T, Immediate>>,
  options?: WatchOptions<Immediate>,
): WatchHandle

// 只读数组/元组：保留每一项类型；ReactiveMarker 用于区分响应式数组本身。
export function watch<
  T extends Readonly<MultiWatchSources>,
  Immediate extends Readonly<boolean> = false,
>(
  sources: readonly [...T] | T,
  cb: [T] extends [ReactiveMarker]
    ? WatchCallback<T, MaybeUndefined<T, Immediate>>
    : WatchCallback<MapSources<T, false>, MapSources<T, Immediate>>,
  options?: WatchOptions<Immediate>,
): WatchHandle

// 可变多 source 元组。
export function watch<
  T extends MultiWatchSources,
  Immediate extends Readonly<boolean> = false,
>(
  sources: [...T],
  cb: WatchCallback<MapSources<T, false>, MapSources<T, Immediate>>,
  options?: WatchOptions<Immediate>,
): WatchHandle

// 直接监听响应式对象时，回调接收该对象类型。
export function watch<
  T extends object,
  Immediate extends Readonly<boolean> = false,
>(
  source: T,
  cb: WatchCallback<T, MaybeUndefined<T, Immediate>>,
  options?: WatchOptions<Immediate>,
): WatchHandle

/**
 * 监听一个或多个响应式数据源，并在值变化时执行回调。
 *
 * 此处的重载负责公开类型，实际依赖追踪、深度遍历和清理机制位于 reactivity 包；
 * runtime-core 的职责是补上组件实例、错误处理、SSR 和渲染调度语义。
 */
export function watch<T = any, Immediate extends Readonly<boolean> = false>(
  source: T | WatchSource<T>,
  cb: any,
  options?: WatchOptions<Immediate>,
): WatchHandle {
  if (__DEV__ && !isFunction(cb)) {
    warn(
      `\`watch(fn, options?)\` signature has been moved to a separate API. ` +
        `Use \`watchEffect(fn, options?)\` instead. \`watch\` now only ` +
        `supports \`watch(source, cb, options?) signature.`,
    )
  }
  return doWatch(source as any, cb, options)
}

/**
 * 把 runtime-core 语义适配成 reactivity `baseWatch()` 的底层选项。
 *
 * 主要工作包括：把用户回调接入组件错误边界；按 flush 模式选择主队列、post-render
 * 队列或同步执行；给 pre watcher 绑定组件 uid 以保证排序；SSR 中跳过不会再触发的
 * watcher，避免为单次服务端渲染保留无用 effect。
 */
function doWatch(
  source: WatchSource | WatchSource[] | WatchEffect | object,
  cb: WatchCallback | null,
  options: WatchOptions = EMPTY_OBJ,
): WatchHandle {
  const { immediate, deep, flush, once } = options

  if (__DEV__ && !cb) {
    if (immediate !== undefined) {
      warn(
        `watch() "immediate" option is only respected when using the ` +
          `watch(source, callback, options?) signature.`,
      )
    }
    if (deep !== undefined) {
      warn(
        `watch() "deep" option is only respected when using the ` +
          `watch(source, callback, options?) signature.`,
      )
    }
    if (once !== undefined) {
      warn(
        `watch() "once" option is only respected when using the ` +
          `watch(source, callback, options?) signature.`,
      )
    }
  }

  const baseWatchOptions: BaseWatchOptions = extend({}, options)

  if (__DEV__) baseWatchOptions.onWarn = warn

  // immediate watcher 或非 post 的 watchEffect 会在创建时至少执行一次。
  const runsImmediately = (cb && immediate) || (!cb && flush !== 'post')
  let ssrCleanup: (() => void)[] | undefined
  if (__SSR__ && isInSSRComponentSetup) {
    if (flush === 'sync') {
      // sync watcher 在 SSR setup 期间可能多次触发，需保存句柄，等整次请求完成后清理。
      const ctx = useSSRContext()!
      ssrCleanup = ctx.__watcherHandles || (ctx.__watcherHandles = [])
    } else if (!runsImmediately) {
      // SSR 只有一次同步渲染，不立即运行的异步 watcher 永远没有触发机会，返回形状
      // 完整的空句柄，既避免创建 effect，也不破坏调用方 stop/pause/resume 代码。
      const watchStopHandle = () => {}
      watchStopHandle.stop = NOOP
      watchStopHandle.resume = NOOP
      watchStopHandle.pause = NOOP
      return watchStopHandle
    }
  }

  const instance = currentInstance
  baseWatchOptions.call = (fn, type, args) =>
    callWithAsyncErrorHandling(fn, instance, type, args)

  // 将响应式层产生的 job 对接组件渲染调度顺序。
  let isPre = false
  if (flush === 'post') {
    baseWatchOptions.scheduler = job => {
      queuePostRenderEffect(job, instance && instance.suspense)
    }
  } else if (flush !== 'sync') {
    // 默认 `pre`：首次执行同步完成依赖收集，后续变化再进入去重队列。
    isPre = true
    baseWatchOptions.scheduler = (job, isFirstRun) => {
      if (isFirstRun) {
        job()
      } else {
        queueJob(job)
      }
    }
  }

  baseWatchOptions.augmentJob = (job: SchedulerJob) => {
    // #1727：watch 回调不在执行期间追踪依赖；它若写回 source 通常是有意的状态
    // 归一化流程，因此允许自触发。watchEffect 没有此标记，避免读写同一依赖死循环。
    if (cb) {
      job.flags! |= SchedulerJobFlags.ALLOW_RECURSE
    }
    if (isPre) {
      // pre watcher 与组件更新共享 uid，但 PRE 排在更新任务前；父卸载组件时两者也能
      // 一并跳过。附加实例用于递归更新错误显示组件名。
      job.flags! |= SchedulerJobFlags.PRE
      if (instance) {
        job.id = instance.uid
        ;(job as SchedulerJob).i = instance
      }
    }
  }

  const watchHandle = baseWatch(source, cb, baseWatchOptions)

  if (__SSR__ && isInSSRComponentSetup) {
    if (ssrCleanup) {
      ssrCleanup.push(watchHandle)
    } else if (runsImmediately) {
      watchHandle()
    }
  }

  return watchHandle
}

/**
 * Options API `this.$watch()` 的内部实现。
 *
 * 字符串 source 支持 `a.b.c` 简单路径；函数 source 和回调都绑定公开实例为 `this`。
 * 临时设置 currentInstance，使 watcher 创建时归入该组件 effect scope，卸载可自动停止。
 */
export function instanceWatch(
  this: ComponentInternalInstance,
  source: string | Function,
  value: WatchCallback | ObjectWatchOptionItem,
  options?: WatchOptions,
): WatchHandle {
  const publicThis = this.proxy
  const getter = isString(source)
    ? source.includes('.')
      ? createPathGetter(publicThis!, source)
      : () => publicThis![source as keyof typeof publicThis]
    : source.bind(publicThis, publicThis)
  let cb
  if (isFunction(value)) {
    cb = value
  } else {
    cb = value.handler as Function
    options = value
  }
  const reset = setCurrentInstance(this)
  const res = doWatch(getter, cb.bind(publicThis), options)
  reset()
  return res
}

/**
 * 为 Options API 字符串路径创建安全 getter。
 * 遍历途中遇到 null/undefined 即停止，避免尚未初始化的中间属性导致运行时异常。
 */
export function createPathGetter(
  ctx: ComponentPublicInstance,
  path: string,
): () => WatchSource | WatchSource[] | WatchEffect | object {
  const segments = path.split('.')
  return (): WatchSource | WatchSource[] | WatchEffect | object => {
    let cur = ctx
    for (let i = 0; i < segments.length && cur; i++) {
      cur = cur[segments[i] as keyof typeof cur]
    }
    return cur
  }
}
