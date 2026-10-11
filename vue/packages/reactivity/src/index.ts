/**
 * `@vue/reactivity` 的公共导出入口。
 *
 * 本文件不实现响应式逻辑，只集中声明包的公开 API。阅读实现时可按以下主线进入：
 * `reactive.ts`（代理创建）→ `baseHandlers.ts` / `collectionHandlers.ts`（拦截操作）
 * → `dep.ts`（收集与触发依赖）→ `effect.ts`（执行和调度副作用）。
 */

// Ref：用统一的 `.value` 访问协议包装任意值。
export {
  ref,
  shallowRef,
  isRef,
  toRef,
  toValue,
  toRefs,
  unref,
  proxyRefs,
  customRef,
  triggerRef,
  type Ref,
  type MaybeRef,
  type MaybeRefOrGetter,
  type ToRef,
  type ToRefs,
  type UnwrapRef,
  type ShallowRef,
  type ShallowUnwrapRef,
  type RefUnwrapBailTypes,
  type CustomRefFactory,
} from './ref'
// 响应式对象：创建代理、检查代理类型，以及在代理和原始对象之间转换。
export {
  reactive,
  readonly,
  isReactive,
  isReadonly,
  isShallow,
  isProxy,
  shallowReactive,
  shallowReadonly,
  markRaw,
  toRaw,
  toReactive,
  toReadonly,
  type Raw,
  type DeepReadonly,
  type ShallowReactive,
  type UnwrapNestedRefs,
  type Reactive,
  type ReactiveMarker,
} from './reactive'
// 计算属性：由其他响应式数据派生、按需求值并缓存结果。
export {
  computed,
  type ComputedRef,
  type WritableComputedRef,
  type WritableComputedOptions,
  type ComputedGetter,
  type ComputedSetter,
  type ComputedRefImpl,
} from './computed'
// 响应式副作用：执行用户函数，同时记录该函数读取过的依赖。
export {
  effect,
  stop,
  enableTracking,
  pauseTracking,
  resetTracking,
  onEffectCleanup,
  ReactiveEffect,
  EffectFlags,
  type ReactiveEffectRunner,
  type ReactiveEffectOptions,
  type EffectScheduler,
  type DebuggerOptions,
  type DebuggerEvent,
  type DebuggerEventExtraInfo,
} from './effect'
// 底层依赖图接口与遍历依赖使用的特殊键。
export {
  trigger,
  track,
  ITERATE_KEY,
  ARRAY_ITERATE_KEY,
  MAP_KEY_ITERATE_KEY,
} from './dep'
// 副作用作用域：成组管理 effect、watcher 及销毁回调。
export {
  effectScope,
  EffectScope,
  getCurrentScope,
  onScopeDispose,
} from './effectScope'
// 数组只读访问辅助函数；运行时核心也会复用它们。
export { reactiveReadArray, shallowReadArray } from './arrayInstrumentations'
// 收集、触发和代理标记使用的内部操作常量。
export { TrackOpTypes, TriggerOpTypes, ReactiveFlags } from './constants'
// 侦听器：观察响应式数据变化，并管理清理回调。
export {
  watch,
  getCurrentWatcher,
  traverse,
  onWatcherCleanup,
  WatchErrorCodes,
  type WatchOptions,
  type WatchScheduler,
  type WatchStopHandle,
  type WatchHandle,
  type WatchEffect,
  type WatchSource,
  type WatchCallback,
  type OnCleanup,
} from './watch'
