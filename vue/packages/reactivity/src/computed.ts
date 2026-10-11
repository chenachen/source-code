import { isFunction } from '@vue/shared'
import {
  type DebuggerEvent,
  type DebuggerOptions,
  EffectFlags,
  type Subscriber,
  activeSub,
  batch,
  refreshComputed,
} from './effect'
import type { Ref } from './ref'
import { warn } from './warning'
import { Dep, type Link, globalVersion } from './dep'
import { ReactiveFlags, TrackOpTypes } from './constants'

/** 只读计算属性在类型层面的品牌标记，防止与普通 `Ref` 完全等同。 */
declare const ComputedRefSymbol: unique symbol
/** 可写计算属性在类型层面的品牌标记。 */
declare const WritableComputedRefSymbol: unique symbol

/** 只读与可写计算属性共享的内部类型。 */
interface BaseComputedRef<T, S = T> extends Ref<T, S> {
  /** 只在类型层面区分 computed 与普通 Ref，不对应运行时属性。 */
  [ComputedRefSymbol]: true
  /**
   * @deprecated 计算属性已不再通过 `ReactiveEffect` 实现；仅为兼容读取
   * `computed.effect` 的旧代码而保留，实际返回计算属性实例自身。
   */
  effect: ComputedRefImpl
}

/** 只读计算属性；只能读取派生后的 `value`。 */
export interface ComputedRef<T = any> extends BaseComputedRef<T> {
  /** 读取缓存并按需刷新派生值；类型层面禁止赋值，运行时由 value getter 实现。 */
  readonly value: T
}

/** 可写计算属性；读取走 getter，赋值走 setter。 */
export interface WritableComputedRef<T, S = T> extends BaseComputedRef<T, S> {
  /** 区分可写 computed 的类型品牌；与 getter/setter 的读写类型一起参与推导。 */
  [WritableComputedRefSymbol]: true
}

/** 计算属性 getter；旧值可用于复用对象，减少无意义的引用变化。 */
export type ComputedGetter<T> = (oldValue?: T) => T
/** 可写计算属性 setter。 */
export type ComputedSetter<T> = (newValue: T) => void

/** 创建可写计算属性时传入的 getter/setter 配置。 */
export interface WritableComputedOptions<T, S = T> {
  /** 计算读取值；refreshComputed 传入上次缓存，返回值按 Object.is 语义决定是否发布。 */
  get: ComputedGetter<T>
  /** 接收 value 赋值；由使用者修改上游状态，Vue 不直接替换 computed 缓存。 */
  set: ComputedSetter<S>
}

/**
 * 计算属性的内部实现，同时扮演“依赖源”和“订阅者”两个角色：
 *
 * - 外部 effect 读取 `value` 时，订阅当前实例的 `dep`；
 * - getter 执行时，本实例又作为订阅者收集 getter 读取到的其他依赖；
 * - 上游变化先标脏并入批；读取 value 或下游 isDirty 检查时才按需刷新。
 *
 * 无活动下游时保留依赖 Link/版本，退出上游通知链；首次出现追踪中的消费者时，
 * Dep.addSub 再恢复上游订阅。computed 不作为 ReactiveEffect 登记到作用域。
 *
 * @private 供 Vue 核心通过 `@vue/reactivity` 使用，但不会从主 `vue` 包导出。
 */
export class ComputedRefImpl<T = any> implements Subscriber {
  /** 上一次计算结果；首次读取前为 `undefined`。 @internal */
  _value: any = undefined
  /** 管理所有读取当前计算结果的订阅者。 @internal */
  readonly dep: Dep = new Dep(this)
  /** Ref 协议标记，使 `isRef()` 能识别计算属性。 @internal */
  readonly __v_isRef = true
  // TODO：启用 isolatedDeclarations 后改用 ReactiveFlags.IS_REF。
  /** 是否只读；没有 setter 时为 `true`。 @internal */
  readonly __v_isReadonly: boolean
  // TODO：启用 isolatedDeclarations 后改用 ReactiveFlags.IS_READONLY。
  /** 计算属性作为订阅者时收集到的依赖链表头。 @internal */
  deps?: Link = undefined
  /** 依赖链表尾，用于 O(1) 追加依赖。 @internal */
  depsTail?: Link = undefined
  /** 脏、求值中、已加入批处理等运行状态位。 @internal */
  flags: EffectFlags = EffectFlags.DIRTY
  /** 上次检查时的全局响应式版本，用于“期间没有任何变化”的快速路径。 @internal */
  globalVersion: number = globalVersion - 1
  /** SSR 下没有渲染 effect，计算属性采用不同的缓存判断策略。 @internal */
  isSSR: boolean
  /** 批处理队列中的下一个订阅者节点。 @internal */
  next?: Subscriber = undefined

  /** 旧版兼容字段；计算属性现在直接实现订阅者协议。 */
  effect: this = this
  /** 开发模式下，依赖被收集时触发的调试钩子。 */
  onTrack?: (event: DebuggerEvent) => void
  /** 开发模式下，上游依赖触发更新时调用的调试钩子。 */
  onTrigger?: (event: DebuggerEvent) => void

  /** 开发模式下是否警告递归计算。 @internal */
  _warnRecursive?: boolean

  /**
   * 保存 getter/setter 并确定只读身份；构造阶段不执行 getter，也不收集上游依赖。
   *
   * @param fn 计算 getter，重新求值时会收到上一次结果。
   * @param setter 可写计算属性的 setter；缺省表示只读。
   * @param isSSR 是否运行于服务端渲染环境。
   */
  constructor(
    public fn: ComputedGetter<T>,
    private readonly setter: ComputedSetter<T> | undefined,
    isSSR: boolean,
  ) {
    this[ReactiveFlags.IS_READONLY] = !setter
    this.isSSR = isSSR
  }

  /**
   * 将计算属性标为脏，并放入“计算属性批处理队列”。
   *
   * 返回 `true` 告诉 `Dep.notify()`：当前订阅者是计算属性，还要继续通知
   * 读取该计算结果的下游订阅者。`activeSub !== this` 可避免 getter 修改自身
   * 依赖时立即递归通知自己，造成无限循环。
   *
   * @internal
   */
  notify(): true | void {
    this.flags |= EffectFlags.DIRTY
    if (
      !(this.flags & EffectFlags.NOTIFIED) &&
      // getter 正在执行时若触发自己的上游依赖，不再次把自己入队。
      activeSub !== this
    ) {
      batch(this, true)
      return true
    } else if (__DEV__) {
      // TODO：在开发模式补充计算属性递归触发警告。
    }
  }

  /**
   * 读取计算结果并让当前活动订阅者（effect 或外层 computed）订阅自身 Dep。
   *
   * 先让当前外部 effect 订阅 `dep`，再按需刷新 getter。刷新后同步 `Link` 版本，
   * 避免外层订阅者随后把本次已确认的新值误判为过期。刷新抛错时不执行版本同步或
   * 返回缓存，异常直接传播；非追踪上下文仍可求值，只是不创建消费者 Link。
   */
  get value(): T {
    const link = __DEV__
      ? this.dep.track({
          target: this,
          type: TrackOpTypes.GET,
          key: 'value',
        })
      : this.dep.track()
    refreshComputed(this)
    // 求值可能递增 dep.version，因此必须把本次读取对应的 Link 同步到最新版本。
    if (link) {
      link.version = this.dep.version
    }
    return this._value
  }

  /** 把新值交给 setter；只读计算属性在开发模式下给出警告。 */
  set value(newValue) {
    if (this.setter) {
      this.setter(newValue)
    } else if (__DEV__) {
      warn('Write operation failed: computed value is readonly')
    }
  }
}

/**
 * 创建带缓存的计算属性。
 *
 * 传入 getter 时返回只读计算属性；传入 `{ get, set }` 时返回可写计算属性。
 * getter 不会在创建时执行。首次读取必要求值；有下游订阅时，上游写入也可能在
 * 同步 runIfDirty 检查中刷新 getter。缓存命中与否由版本检查决定，不等于每次通知重算。
 *
 * @example
 * ```js
 * // 创建只读计算属性：
 * const count = ref(1)
 * const plusOne = computed(() => count.value + 1)
 *
 * console.log(plusOne.value) // 2
 * plusOne.value++ // 开发模式下警告：计算属性只读
 * ```
 *
 * ```js
 * // 创建可写计算属性：
 * const count = ref(1)
 * const plusOne = computed({
 *   get: () => count.value + 1,
 *   set: (val) => {
 *     count.value = val - 1
 *   }
 * })
 *
 * plusOne.value = 1
 * console.log(count.value) // 0
 * ```
 *
 * @param getter 产生派生值的函数。
 * @param debugOptions 开发模式调试钩子，参见
 * {@link https://vuejs.org/guide/extras/reactivity-in-depth.html#computed-debugging}。
 * @see {@link https://vuejs.org/api/reactivity-core.html#computed}
 */
export function computed<T>(
  getter: ComputedGetter<T>,
  debugOptions?: DebuggerOptions,
): ComputedRef<T>
/** 可写重载：读取值与 setter 输入可使用不同类型，赋值操作交给 options.set。 */
export function computed<T, S = T>(
  options: WritableComputedOptions<T, S>,
  debugOptions?: DebuggerOptions,
): WritableComputedRef<T, S>
/*@__NO_SIDE_EFFECTS__*/
/** 归一化只读 getter／可写配置，创建尚未求值的实例；调试钩子仅在开发且非 SSR 时安装。 */
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>,
  debugOptions?: DebuggerOptions,
  isSSR = false,
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T> | undefined

  if (isFunction(getterOrOptions)) {
    // 函数重载：只读计算属性没有 setter。
    getter = getterOrOptions
  } else {
    // 对象重载：getter 与 setter 共同组成可写计算属性。
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  const cRef = new ComputedRefImpl(getter, setter, isSSR)

  if (__DEV__ && debugOptions && !isSSR) {
    // SSR 没有常规渲染 effect，不启用依赖收集调试钩子。
    cRef.onTrack = debugOptions.onTrack
    cRef.onTrigger = debugOptions.onTrigger
  }

  return cRef as any
}
