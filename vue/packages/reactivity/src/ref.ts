import {
  type IfAny,
  hasChanged,
  isArray,
  isFunction,
  isIntegerKey,
  isObject,
  isSymbol,
} from '@vue/shared'
import { Dep, getDepFromReactive } from './dep'
import {
  type Builtin,
  type ShallowReactiveBrand,
  type Target,
  isProxy,
  isReactive,
  isReadonly,
  isShallow,
  toRaw,
  toReactive,
} from './reactive'
import type { ComputedRef, WritableComputedRef } from './computed'
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './constants'
import { warn } from './warning'

/** Ref 类型品牌使用的私有 Symbol；不出现在 IDE 自动补全中。 */
declare const RefSymbol: unique symbol
/** `markRaw()` 的类型品牌；由 `UnwrapRefSimple` 用来终止递归解包。 */
export declare const RawSymbol: unique symbol

/**
 * Ref 的公共协议：以 `.value` 作为单一响应式读写入口。
 *
 * `T` 是读取类型，`S` 是允许写入的类型；二者分离后，可写 computed 等 API 能表达
 * “getter 返回一种类型，setter 接收另一种类型”。
 */
export interface Ref<T = any, S = T> {
  /** 读取内部值并建立依赖。 */
  get value(): T
  /** 写入内部值并在实际变化时触发依赖。 */
  set value(_: S)
  /**
   * 仅用于类型区分。它必须存在于公开 d.ts 才能让 TypeScript 识别 Ref，但不希望出现在
   * IDE 自动补全中，所以使用私有 Symbol 键；运行时实际识别依赖 `__v_isRef` 标记。
   */
  [RefSymbol]: true
}

/**
 * 检查值是否遵循 Ref 协议。
 *
 * @param r 待检查的值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#isref}
 */
export function isRef<T>(r: Ref<T> | unknown): r is Ref<T>
/*@__NO_SIDE_EFFECTS__*/
export function isRef(r: any): r is Ref {
  return r ? r[ReactiveFlags.IS_REF] === true : false
}

/**
 * 把内部值包装成可变响应式 Ref，通过唯一属性 `.value` 读写。
 *
 * 对象值会按需转换成深层响应式代理；传入已有 Ref 时直接返回，避免重复包装。
 *
 * @param value 要包装的内部值；缺省时值为 `undefined`。
 * @see {@link https://vuejs.org/api/reactivity-core.html#ref}
 */
export function ref<T>(
  value: T,
): [T] extends [Ref] ? IfAny<T, Ref<T>, T> : Ref<UnwrapRef<T>, UnwrapRef<T> | T>
export function ref<T = any>(): Ref<T | undefined>
/*@__NO_SIDE_EFFECTS__*/
export function ref(value?: unknown) {
  return createRef(value, false)
}

/** 浅层 Ref 的类型品牌，阻止 `UnwrapRef` 继续递归内部值。 */
declare const ShallowRefMarker: unique symbol

/** 浅层 Ref：只追踪 `.value` 本身的替换，不转换或追踪内部对象。 */
export type ShallowRef<T = any, S = T> = Ref<T, S> & {
  [ShallowRefMarker]?: true
}

/**
 * {@link ref} 的浅层版本。
 *
 * 内部值按原样保存；深层修改不会触发，但替换整个 `.value` 会触发。适合大型不可变结构、
 * 外部状态对象，或由使用者通过 {@link triggerRef} 手动通知的场景。
 *
 * @example
 * ```js
 * const state = shallowRef({ count: 1 })
 *
 * // 不触发更新
 * state.value.count = 2
 *
 * // 替换根值会触发更新
 * state.value = { count: 2 }
 * ```
 *
 * @param value 浅层 Ref 的内部值。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#shallowref}
 */
export function shallowRef<T>(
  value: T,
): Ref extends T
  ? T extends Ref
    ? IfAny<T, ShallowRef<T>, T>
    : ShallowRef<T>
  : ShallowRef<T>
export function shallowRef<T = any>(): ShallowRef<T | undefined>
/*@__NO_SIDE_EFFECTS__*/
export function shallowRef(value?: unknown) {
  return createRef(value, true)
}

/**
 * 创建深层或浅层 Ref 的统一入口；已有 Ref 保持引用不变。
 */
function createRef(rawValue: unknown, shallow: boolean) {
  if (isRef(rawValue)) {
    return rawValue
  }
  return new RefImpl(rawValue, shallow)
}

/**
 * 普通 Ref 实现，同时保存“用于比较的原始值”和“暴露给用户的响应式值”。
 *
 * 深层 Ref 写入代理对象时先还原为 raw 再比较，避免同一原始对象的不同代理造成假变化；
 * 读取值则保存转换后的响应式代理。浅层/只读值需要保持原身份，不能强制还原再代理。
 *
 * @internal
 */
class RefImpl<T = any> {
  /** `.value` 实际返回的值；深层对象通常是响应式代理。 */
  _value: T
  /** 用于变更比较的值；深层对象通常是原始对象。 */
  private _rawValue: T

  /** 管理所有读取 `.value` 的订阅者。 */
  dep: Dep = new Dep()

  /** Ref 运行时身份标记。 */
  public readonly [ReactiveFlags.IS_REF] = true
  /** 当前 Ref 是否只追踪根值替换。 */
  public readonly [ReactiveFlags.IS_SHALLOW]: boolean = false

  /** @param value 初始值。 @param isShallow 是否按原样保存内部值。 */
  constructor(value: T, isShallow: boolean) {
    this._rawValue = isShallow ? value : toRaw(value)
    this._value = isShallow ? value : toReactive(value)
    this[ReactiveFlags.IS_SHALLOW] = isShallow
  }

  /** 读取当前值，并让活动 effect/computed 订阅本 Ref 的 Dep。 */
  get value() {
    if (__DEV__) {
      this.dep.track({
        target: this,
        type: TrackOpTypes.GET,
        key: 'value',
      })
    } else {
      this.dep.track()
    }
    return this._value
  }

  /**
   * 设置新值；按 `Object.is` 语义确认实际变化后才更新两种存储并触发订阅者。
   *
   * 新值本身若已是浅层或只读代理，必须直接保留：还原再经 `toReactive()` 包装会丢失
   * 原有浅层/只读约束。
   */
  set value(newValue) {
    const oldValue = this._rawValue
    const useDirectValue =
      this[ReactiveFlags.IS_SHALLOW] ||
      isShallow(newValue) ||
      isReadonly(newValue)
    newValue = useDirectValue ? newValue : toRaw(newValue)
    if (hasChanged(newValue, oldValue)) {
      this._rawValue = newValue
      this._value = useDirectValue ? newValue : toReactive(newValue)
      if (__DEV__) {
        this.dep.trigger({
          target: this,
          type: TriggerOpTypes.SET,
          key: 'value',
          newValue,
          oldValue,
        })
      } else {
        this.dep.trigger()
      }
    }
  }
}

/**
 * 强制触发依赖某个浅层 Ref 的 effect，通常用于直接修改其内部对象之后。
 *
 * 此函数不会改变 `.value`，只是递增 Ref 的 Dep 版本并发出 SET 通知。
 *
 * @example
 * ```js
 * const shallow = shallowRef({
 *   greet: 'Hello, world'
 * })
 *
 * // 首次运行打印 "Hello, world"
 * watchEffect(() => {
 *   console.log(shallow.value.greet)
 * })
 *
 * // shallowRef 不追踪内部字段，因此不会触发 effect
 * shallow.value.greet = 'Hello, universe'
 *
 * // 手动通知后打印 "Hello, universe"
 * triggerRef(shallow)
 * ```
 *
 * @param ref 要强制通知订阅者的 Ref。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#triggerref}
 */
export function triggerRef(ref: Ref): void {
  // 参数也可能是 ObjectRefImpl；其 dep 是转发得到的可选属性，因此先检查。
  if ((ref as unknown as RefImpl).dep) {
    if (__DEV__) {
      ;(ref as unknown as RefImpl).dep.trigger({
        target: ref,
        type: TriggerOpTypes.SET,
        key: 'value',
        newValue: (ref as unknown as RefImpl)._value,
      })
    } else {
      ;(ref as unknown as RefImpl).dep.trigger()
    }
  }
}

/** 普通值，或任意可写 Ref/计算属性。常用于组合式函数的灵活输入。 */
export type MaybeRef<T = any> =
  T | Ref<T> | ShallowRef<T> | WritableComputedRef<T>

/** 普通值、任意 Ref/计算属性，或返回值的 getter。 */
export type MaybeRefOrGetter<T = any> = MaybeRef<T> | ComputedRef<T> | (() => T)

/**
 * 参数是 Ref 时返回内部值，否则原样返回；等价于
 * `isRef(val) ? val.value : val`。
 *
 * @example
 * ```js
 * function useFoo(x: number | Ref<number>) {
 *   const unwrapped = unref(x)
 *   // 此时 unwrapped 的类型一定是 number
 * }
 * ```
 *
 * @param ref Ref 或普通值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#unref}
 */
export function unref<T>(ref: MaybeRef<T> | ComputedRef<T>): T {
  return isRef(ref) ? ref.value : ref
}

/**
 * 把普通值、Ref 或 getter 统一归一化为值。
 *
 * 与 {@link unref} 相比，它还会执行函数参数并返回结果。这里把函数一律视为 getter；
 * 若业务值本身就是函数，不应使用 `toValue()` 归一化。
 *
 * @example
 * ```js
 * toValue(1) // 1
 * toValue(ref(1)) // 1
 * toValue(() => 1) // 1
 * ```
 *
 * @param source getter、已有 Ref 或非函数普通值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#tovalue}
 */
export function toValue<T>(source: MaybeRefOrGetter<T>): T {
  return isFunction(source) ? source() : unref(source)
}

/**
 * `proxyRefs()` 使用的浅层代理处理器。
 *
 * 读取属性时自动 `unref`；若旧属性是 Ref 而新值不是，则写入被转发到 `oldRef.value`，
 * 对象槽位继续保存原 Ref。写入另一个 Ref 时才真正替换属性。
 */
const shallowUnwrapHandlers: ProxyHandler<any> = {
  get: (target, key, receiver) =>
    key === ReactiveFlags.RAW
      ? target
      : unref(Reflect.get(target, key, receiver)),
  set: (target, key, value, receiver) => {
    const oldValue = target[key]
    if (isRef(oldValue) && !isRef(value)) {
      oldValue.value = value
      return true
    } else {
      return Reflect.set(target, key, value, receiver)
    }
  },
}

/**
 * 返回一个会浅层解包 Ref 属性的代理。
 *
 * 已有响应式对象的 `get/set` 陷阱本就具备相同解包语义，直接返回可避免重复代理；普通
 * 对象才套用 `shallowUnwrapHandlers`。常用于把 `setup()` 返回对象暴露给模板。
 *
 * @param objectWithRefs 已有响应式对象，或包含 Ref 属性的普通对象。
 */
export function proxyRefs<T extends object>(
  objectWithRefs: T,
): ShallowUnwrapRef<T> {
  return isReactive(objectWithRefs)
    ? (objectWithRefs as ShallowUnwrapRef<T>)
    : new Proxy(objectWithRefs, shallowUnwrapHandlers)
}

/**
 * 自定义 Ref 工厂：Vue 提供 `track` / `trigger`，使用者返回实际 getter/setter。
 * getter 必须在合适时机调用 track，setter 必须在值应被视为变化时调用 trigger。
 */
export type CustomRefFactory<T, S = T> = (
  track: () => void,
  trigger: () => void,
) => {
  get: () => T
  set: (value: S) => void
}

/** 自定义 Ref 实现；只负责连接 Dep，值的存储、比较和触发策略完全由工厂控制。 */
class CustomRefImpl<T, S = T> {
  /** 当前自定义 Ref 的依赖源。 */
  public dep: Dep

  /** 工厂返回的读取逻辑。 */
  private readonly _get: ReturnType<CustomRefFactory<T, S>>['get']
  /** 工厂返回的写入逻辑。 */
  private readonly _set: ReturnType<CustomRefFactory<T, S>>['set']

  /** Ref 运行时身份标记。 */
  public readonly [ReactiveFlags.IS_REF] = true

  /** 最近一次 getter 返回值，供开发调试事件和内部观察使用。 */
  public _value: T = undefined!

  /** @param factory 接收依赖收集/触发函数并返回自定义 get/set 的工厂。 */
  constructor(factory: CustomRefFactory<T, S>) {
    const dep = (this.dep = new Dep())
    const { get, set } = factory(dep.track.bind(dep), dep.trigger.bind(dep))
    this._get = get
    this._set = set
  }

  /** 执行用户 getter；是否收集依赖由 getter 内调用 `track()` 决定。 */
  get value(): T {
    return (this._value = this._get())
  }

  /** 执行用户 setter；是否、何时触发依赖由 setter 内调用 `trigger()` 决定。 */
  set value(newVal: S) {
    this._set(newVal)
  }
}

/**
 * 创建自定义 Ref，让使用者显式控制何时收集依赖、何时触发更新。
 *
 * 典型用途是防抖输入：getter 调用 `track()`，setter 延迟保存值并在计时结束后调用
 * `trigger()`。工厂应始终返回稳定的 get/set，避免在 getter 中生成全新对象导致父子
 * 组件对同一逻辑值产生不必要的引用变化。
 *
 * @param factory 接收 `track` 与 `trigger` 回调的工厂函数。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#customref}
 */
export function customRef<T, S = T>(
  factory: CustomRefFactory<T, S>,
): Ref<T, S> {
  return new CustomRefImpl(factory) as any
}

/** 将对象每个属性映射成保持相同键、且指向原属性的 Ref。 */
export type ToRefs<T = any> = {
  [K in keyof T]: ToRef<T[K]>
}

/**
 * 非元组数组额外接受形如 `` `${number}` `` 的字符串索引，与 JS 属性键转换保持一致；
 * 固定长度元组仍只允许其明确的 `keyof`，避免丢失每个位置的精确类型。
 */
type ArrayStringKey<T> = T extends readonly any[]
  ? number extends T['length']
    ? `${number}`
    : never
  : never

/** `toRef(object, key)` 接受的对象键类型。 */
type ToRefKey<T> = keyof T | ArrayStringKey<T>

/** 从对象键推导属性 Ref 的值类型，并处理普通数组的字符串数字索引。 */
type ToRefValue<T extends object, K extends ToRefKey<T>> = K extends keyof T
  ? T[K]
  : T extends readonly (infer V)[]
    ? K extends ArrayStringKey<T>
      ? V
      : never
    : never

/**
 * 把响应式对象转换成普通对象，其中每个可枚举属性都是指向原属性的 Ref。
 *
 * 这些 Ref 不复制值：读取/写入都会转发到源对象，因此解构后仍保留响应性。数组返回
 * 等长 Ref 数组；普通对象只处理 `for...in` 可枚举键。传入普通非代理对象虽然可工作，
 * 但源属性变化本身无法被追踪，开发模式会警告。
 *
 * @param object 要转换为属性 Ref 集合的响应式对象。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#torefs}
 */
/*@__NO_SIDE_EFFECTS__*/
export function toRefs<T extends object>(object: T): ToRefs<T> {
  if (__DEV__ && !isProxy(object)) {
    warn(`toRefs() expects a reactive object but received a plain one.`)
  }
  const ret: any = isArray(object) ? new Array(object.length) : {}
  // propertyToRef 会复用属性本身已有的 Ref，否则创建双向转发的 ObjectRefImpl。
  for (const key in object) {
    ret[key] = propertyToRef(object, key)
  }
  return ret
}

/**
 * 指向对象某个属性的 Ref，不独立保存业务值。
 *
 * `.value` 读写都转发到源对象属性，因此源对象和 Ref 双向同步。`dep` 也直接返回原始
 * 对象该 key 的 Dep，使 `triggerRef()`、watch 等底层逻辑看到同一依赖源。
 */
class ObjectRefImpl<T extends object, K extends keyof T> {
  /** Ref 运行时身份标记。 */
  public readonly [ReactiveFlags.IS_REF] = true
  /** 最近一次读取结果，主要供内部调试/统一 Ref 处理使用。 */
  public _value: T[K] = undefined!

  /** 源对象最内层 raw 身份，用于查找属性 Dep 和检查原槽位 Ref。 */
  private readonly _raw: T
  /** 经 JS 属性键规则归一化后的键；非 Symbol 键统一转字符串。 */
  private readonly _key: K
  /** 源对象访问该属性时是否不会自动解包 Ref。 */
  private readonly _shallow: boolean

  /**
   * @param _object 源对象，通常是响应式代理。
   * @param key 要转发的属性键。
   * @param _defaultValue 属性值为 `undefined` 时使用的默认值。
   */
  constructor(
    private readonly _object: T,
    key: K,
    private readonly _defaultValue?: T[K],
  ) {
    this._key = (isSymbol(key) ? key : String(key)) as K
    this._raw = toRaw(_object)

    let shallow = true
    let obj = _object

    // 数组整数索引在响应式代理中不会自动解包 Ref，因此属性 Ref 也按浅层路径处理。
    if (!isArray(_object) || isSymbol(this._key) || !isIntegerKey(this._key)) {
      // 其他属性逐层检查代理：只要遇到深层代理，其 get 已完成 Ref 解包；只有整条链
      // 都是 raw/浅层代理时，ObjectRefImpl 才需自行 unref。
      do {
        shallow = !isProxy(obj) || isShallow(obj)
      } while (shallow && (obj = (obj as Target)[ReactiveFlags.RAW]))
    }

    this._shallow = shallow
  }

  /** 读取源属性；必要时自行解包 Ref，`undefined` 时返回默认值。 */
  get value() {
    let val = this._object[this._key]
    if (this._shallow) {
      val = unref(val)
    }
    return (this._value = val === undefined ? this._defaultValue! : val)
  }

  /**
   * 写入源属性。浅层/raw 源对象的槽位若原本是 Ref，则优先写其 `.value`，避免用普通值
   * 替换 Ref；深层响应式代理已在自身 set 陷阱实现相同规则，直接交给源对象即可。
   */
  set value(newVal) {
    if (this._shallow && isRef(this._raw[this._key])) {
      const nestedRef = this._object[this._key]
      if (isRef(nestedRef)) {
        nestedRef.value = newVal
        return
      }
    }

    this._object[this._key] = newVal
  }

  /** 返回源对象该属性现有的 Dep；从未被追踪时为 `undefined`。 */
  get dep(): Dep | undefined {
    return getDepFromReactive(this._raw, this._key)
  }
}

/** 只读 getter Ref：每次读取都执行 getter，不自行缓存或持有 Dep。 */
class GetterRefImpl<T> {
  /** Ref 运行时身份标记。 */
  public readonly [ReactiveFlags.IS_REF] = true
  /** 只读运行时标记，使 `isReadonly()` 返回 true。 */
  public readonly [ReactiveFlags.IS_READONLY] = true
  /** 最近一次 getter 返回值。 */
  public _value: T = undefined!

  /** @param _getter 每次读取 `.value` 时执行的 getter。 */
  constructor(private readonly _getter: () => T) {}
  /** 直接执行 getter；其内部响应式读取会由当前外部 effect 自然收集。 */
  get value() {
    return (this._value = this._getter())
  }
}

/** `toRef` 的归一化类型：`any` 变普通 Ref，已有 Ref 保留，其余值包装为 Ref。 */
export type ToRef<T> = IfAny<T, Ref<T>, [T] extends [Ref] ? T : Ref<T>>

/**
 * 把普通值、已有 Ref、getter 统一归一化成 Ref。
 *
 * @example
 * ```js
 * // 已有 Ref 原样返回
 * toRef(existingRef)
 *
 * // 创建每次读取 .value 都执行 getter 的只读 Ref
 * toRef(() => props.foo)
 *
 * // 非函数普通值创建常规 Ref，等价于 ref(1)
 * toRef(1)
 * ```
 *
 * 传入对象和 key 时则创建属性 Ref；它与源属性双向同步，适合从响应式对象解构单个字段
 * 而不丢失响应性。可选默认值只在属性当前为 `undefined` 时影响读取，不会写回源对象。
 *
 * @example
 * ```js
 * const state = reactive({
 *   foo: 1,
 *   bar: 2
 * })
 *
 * const fooRef = toRef(state, 'foo')
 *
 * // 修改 Ref 会更新源对象
 * fooRef.value++
 * console.log(state.foo) // 2
 *
 * // 修改源对象也会更新 Ref
 * state.foo++
 * console.log(fooRef.value) // 3
 * ```
 *
 * @param source getter、已有 Ref、非函数值，或用于创建属性 Ref 的响应式对象。
 * @param key 可选；源对象上的属性名。
 * @param defaultValue 可选；属性值为 `undefined` 时的读取默认值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#toref}
 */
export function toRef<T>(
  value: T,
): T extends () => infer R
  ? Readonly<Ref<R>>
  : T extends Ref
    ? T
    : Ref<UnwrapRef<T>>
export function toRef<T extends object, K extends ToRefKey<T>>(
  object: T,
  key: K,
): ToRef<ToRefValue<T, K>>
export function toRef<T extends object, K extends ToRefKey<T>>(
  object: T,
  key: K,
  defaultValue: ToRefValue<T, K>,
): ToRef<Exclude<ToRefValue<T, K>, undefined>>
/*@__NO_SIDE_EFFECTS__*/
export function toRef(
  source: Record<PropertyKey, any> | MaybeRef,
  key?: string | number | symbol,
  defaultValue?: unknown,
): Ref {
  if (isRef(source)) {
    // Ref 归一化保持引用稳定。
    return source
  } else if (isFunction(source)) {
    // getter Ref 不缓存，且通过类型重载暴露为只读。
    return new GetterRefImpl(source) as any
  } else if (isObject(source) && arguments.length > 1) {
    // 用 arguments.length 区分“显式传入 undefined key”和单参数普通对象值。
    return propertyToRef(source, key!, defaultValue)
  } else {
    return ref(source)
  }
}

/** 创建指向对象属性的 Ref；若属性本身已是 Ref，则 `ObjectRefImpl` 的访问规则会正确转发。 */
function propertyToRef(
  source: Record<PropertyKey, any>,
  key: string | number | symbol,
  defaultValue?: unknown,
) {
  return new ObjectRefImpl(source, key, defaultValue) as any
}

/**
 * 供其他包通过模块扩充声明“遇到后停止 Ref 递归解包”的特殊类型。
 *
 * DOM 节点、Window 等宿主对象不应被映射类型递归展开；例如 `@vue/runtime-dom` 可在
 * 自己的 d.ts 中这样扩充：
 *
 * ``` ts
 * declare module '@vue/reactivity' {
 *   export interface RefUnwrapBailTypes {
 *     runtimeDOMBailTypes: Node | Window
 *   }
 * }
 * ```
 */
export interface RefUnwrapBailTypes {}

/**
 * `proxyRefs()` 的返回类型：浅层响应式品牌保持原类型，其余对象只解包每个顶层 Ref。
 */
export type ShallowUnwrapRef<T> = T extends ShallowReactiveBrand
  ? T
  : {
      [K in keyof T]: DistributeRef<T[K]>
    }

/** 借助条件类型分发联合类型；联合成员是 Ref 时取其读取值，否则保留。 */
type DistributeRef<T> = T extends Ref<infer V, unknown> ? V : T

/**
 * Ref 解包入口：浅层 Ref 只去掉外壳，普通 Ref 还会递归处理内部值，非 Ref 直接进入
 * `UnwrapRefSimple`。条件类型顺序保证 shallowRef 不会被普通 Ref 分支继续深挖。
 */
export type UnwrapRef<T> =
  T extends ShallowRef<infer V, unknown>
    ? V
    : T extends Ref<infer V, unknown>
      ? UnwrapRefSimple<V>
      : UnwrapRefSimple<T>

/**
 * 深层 Ref 解包的核心映射类型。
 *
 * - 原始/内建值、Ref、外部声明的 bail 类型和 `markRaw` 类型直接停止；
 * - 浅层响应式对象保持原类型；
 * - Map/Set 递归处理值并保留子类额外字段，键保持身份不变；
 * - 数组/元组按索引递归；普通对象跳过 Symbol 键，对字符串/数字键继续 `UnwrapRef`。
 *
 * Symbol 键常承载框架/库内部品牌或协议，递归改写可能破坏其名义类型，因此原样保留。
 */
export type UnwrapRefSimple<T> = T extends
  | Builtin
  | Ref
  | RefUnwrapBailTypes[keyof RefUnwrapBailTypes]
  | { [RawSymbol]?: true }
  ? T
  : T extends ShallowReactiveBrand
    ? T
    : T extends Map<infer K, infer V>
      ? Map<K, UnwrapRefSimple<V>> & UnwrapRef<Omit<T, keyof Map<any, any>>>
      : T extends WeakMap<infer K, infer V>
        ? WeakMap<K, UnwrapRefSimple<V>> &
            UnwrapRef<Omit<T, keyof WeakMap<any, any>>>
        : T extends Set<infer V>
          ? Set<UnwrapRefSimple<V>> & UnwrapRef<Omit<T, keyof Set<any>>>
          : T extends WeakSet<infer V>
            ? WeakSet<UnwrapRefSimple<V>> &
                UnwrapRef<Omit<T, keyof WeakSet<any>>>
            : T extends ReadonlyArray<any>
              ? { [K in keyof T]: UnwrapRefSimple<T[K]> }
              : T extends object
                ? {
                    [P in keyof T]: P extends symbol ? T[P] : UnwrapRef<T[P]>
                  }
                : T
