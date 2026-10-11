import { def, hasOwn, isObject, toRawType } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReactiveHandlers,
  shallowReadonlyHandlers,
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers,
  shallowCollectionHandlers,
  shallowReadonlyCollectionHandlers,
} from './collectionHandlers'
import type { RawSymbol, Ref, UnwrapRefSimple } from './ref'
import { ReactiveFlags } from './constants'
import { warn } from './warning'

/**
 * 所有可代理目标共享的内部标记结构。
 *
 * 这些字段通常不是原始对象的业务属性，而由代理 `get` 陷阱虚拟返回；只有
 * `markRaw()` 会在原始对象上真正定义 `SKIP`。
 */
export interface Target {
  /** 原对象上的跳过标记；get 陷阱直接转发，createReactiveObject 据此不创建代理。 */
  [ReactiveFlags.SKIP]?: boolean
  /** 可变代理身份；readonly(reactive(raw)) 的递归判断通过 RAW 继续检查内层。 */
  [ReactiveFlags.IS_REACTIVE]?: boolean
  /** 当前访问层禁止写入；readonly 代理和只读 getter/computed 可提供此标记。 */
  [ReactiveFlags.IS_READONLY]?: boolean
  /** 当前值采用浅层转换；存在该字段不代表嵌套对象也已被转换。 */
  [ReactiveFlags.IS_SHALLOW]?: boolean
  /** 本层代理的直接 target；多层 readonly/reactive 由 toRaw 递归还原。 */
  [ReactiveFlags.RAW]?: any
}

/** 深层可变代理缓存：原始对象 → `reactive()` 返回的唯一代理。 */
export const reactiveMap: WeakMap<Target, any> = new WeakMap<Target, any>()
/** 浅层可变代理缓存：原始对象 → `shallowReactive()` 返回的唯一代理。 */
export const shallowReactiveMap: WeakMap<Target, any> = new WeakMap<
  Target,
  any
>()
/** 深层只读代理缓存：输入目标 → 只读代理；目标可以是 raw，也可以是内层可变代理。 */
export const readonlyMap: WeakMap<Target, any> = new WeakMap<Target, any>()
/** 浅层只读代理缓存：输入目标 → 浅只读代理；目标可以是 raw，也可以是内层可变代理。 */
export const shallowReadonlyMap: WeakMap<Target, any> = new WeakMap<
  Target,
  any
>()

/**
 * 原始值对应的代理处理器类别。
 *
 * `createReactiveObject()` 只据此做一次分派：COMMON 使用属性 Proxy 陷阱，COLLECTION
 * 使用方法插桩，INVALID 直接返回原值。数字值仅供内部快速比较，不暴露为调试协议。
 */
enum TargetType {
  /** 不支持代理，直接返回原值。 */
  INVALID = 0,
  /** 普通对象或数组，使用 `baseHandlers`。 */
  COMMON = 1,
  /** Map、Set 及其弱引用版本，使用 `collectionHandlers`。 */
  COLLECTION = 2,
}

/** 根据 `Object.prototype.toString` 得到的类型名选择代理处理器。 */
function targetTypeMap(rawType: string) {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

/**
 * 深层代理的 Ref 解包规则：顶层参数本身是 Ref 时保留，只有对象内部的 Ref 才解包。
 */
export type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRefSimple<T>

/** 响应式数组使用的类型品牌；仅参与类型推导，不存在于运行时。 */
declare const ReactiveMarkerSymbol: unique symbol

/** 响应式类型品牌接口，用于避免数组类型被某些解包规则错误处理。 */
export interface ReactiveMarker {
  /** 数组专用类型品牌；只影响类型解包，不在用户数组上写入 Symbol 属性。 */
  [ReactiveMarkerSymbol]?: void
}

/** `reactive()` 的返回类型：递归解包嵌套 Ref，并保留数组响应式品牌。 */
export type Reactive<T> = UnwrapNestedRefs<T> &
  (T extends readonly any[] ? ReactiveMarker : {})

/**
 * 返回对象的深层响应式代理。
 *
 * 转换是惰性且递归的：嵌套对象在被读取时才继续包装，嵌套 Ref 会自动解包且仍保持
 * 响应性。相同原始对象在同一种模式下始终复用同一代理，保持引用稳定。
 *
 * @example
 * ```js
 * const obj = reactive({ count: 0 })
 * ```
 *
 * @param target 要转换的原始对象。
 * @see {@link https://vuejs.org/api/reactivity-core.html#reactive}
 */
export function reactive<T extends object>(target: T): Reactive<T>
/*@__NO_SIDE_EFFECTS__*/
/** 深层可变转换的实现入口；只读输入保持原代理，其余按目标类型和缓存复用。 */
export function reactive(target: object) {
  // 只读约束不能被 reactive() 降级；传入只读代理时原样返回。
  if (isReadonly(target)) {
    return target
  }
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap,
  )
}

/**
 * 浅层响应式的名义类型品牌，使用私有 class 字段区分深层解包路径。
 * 品牌不会泄漏进 keyof/索引访问，也不要求普通对象赋值时提供实际字段；声明被擦除。
 */
declare class ShallowReactiveBrandClass {
  /** 私有可选字段仅用于阻断结构类型混同；无运行时存储、无业务值。 */
  private __shallowReactiveBrand?: never
}

/** 浅层响应式对象的类型品牌。 */
export type ShallowReactiveBrand = ShallowReactiveBrandClass

/** `shallowReactive()` 的返回类型；只加品牌，不递归改写属性类型。 */
export type ShallowReactive<T> = T & ShallowReactiveBrand

/*@__NO_SIDE_EFFECTS__*/
/**
 * {@link reactive} 的浅层版本。
 *
 * 只代理根层属性，属性值按原样存取；嵌套对象不会继续转换，Ref 也不会自动解包。
 * 适合把外部状态系统、大型不可变结构或需要手动控制的 Ref 放在根层。
 *
 * @example
 * ```js
 * const state = shallowReactive({
 *   foo: 1,
 *   nested: {
 *     bar: 2
 *   }
 * })
 *
 * // 修改根层属性会触发更新
 * state.foo++
 *
 * // 但嵌套对象不会被转换
 * isReactive(state.nested) // false
 *
 * // 不会触发响应式更新
 * state.nested.bar++
 * ```
 *
 * @param target 要转换的原始对象。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#shallowreactive}
 */
export function shallowReactive<T extends object>(
  target: T,
): ShallowReactive<T> {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowCollectionHandlers,
    shallowReactiveMap,
  )
}

/** TypeScript 原始值联合类型；深只读转换遇到这些值时直接保留。 */
type Primitive = string | number | boolean | bigint | symbol | undefined | null
/** 无需递归映射为只读属性的内建值类型。 */
export type Builtin = Primitive | Function | Date | Error | RegExp
/**
 * `readonly()` 的递归返回类型。
 *
 * 集合会转换为对应的只读接口，Ref 保留 `.value` 协议但其值继续递归只读，普通对象
 * 则递归添加 `readonly` 修饰符。WeakMap/WeakSet 没有只读标准接口，只递归其泛型。
 */
export type DeepReadonly<T> = T extends Builtin
  ? T
  : T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends WeakMap<infer K, infer V>
        ? WeakMap<DeepReadonly<K>, DeepReadonly<V>>
        : T extends Set<infer U>
          ? ReadonlySet<DeepReadonly<U>>
          : T extends ReadonlySet<infer U>
            ? ReadonlySet<DeepReadonly<U>>
            : T extends WeakSet<infer U>
              ? WeakSet<DeepReadonly<U>>
              : T extends Promise<infer U>
                ? Promise<DeepReadonly<U>>
                : T extends Ref<infer U, unknown>
                  ? Readonly<Ref<DeepReadonly<U>>>
                  : T extends {}
                    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
                    : Readonly<T>

/*@__NO_SIDE_EFFECTS__*/
/**
 * 接收普通对象、响应式对象或 Ref，返回指向原对象的深层只读代理。
 *
 * 只读转换同样惰性递归，并沿用 {@link reactive} 的 Ref 解包规则。只读代理仍会追踪
 * 底层可变响应式对象的变化，但通过该代理赋值或删除会失败并在开发模式发出警告。
 *
 * @example
 * ```js
 * const original = reactive({ count: 0 })
 *
 * const copy = readonly(original)
 *
 * watchEffect(() => {
 *   // 仍会建立响应式依赖
 *   console.log(copy.count)
 * })
 *
 * // 修改原响应式对象会触发依赖 copy 的 watcher
 * original.count++
 *
 * // 通过只读副本修改会失败并警告
 * copy.count++ // 触发只读警告
 * ```
 *
 * @param target 要转换的源对象。
 * @see {@link https://vuejs.org/api/reactivity-core.html#readonly}
 */
export function readonly<T extends object>(
  target: T,
): DeepReadonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers,
    readonlyMap,
  )
}

/*@__NO_SIDE_EFFECTS__*/
/**
 * {@link readonly} 的浅层版本。
 *
 * 只禁止根层属性写入；属性值按原样暴露，因此嵌套对象仍可修改，Ref 也不自动解包。
 * Vue 组件的 props 代理使用这一语义：禁止替换 prop，同时允许显式传递 Ref。
 *
 * @example
 * ```js
 * const state = shallowReadonly({
 *   foo: 1,
 *   nested: {
 *     bar: 2
 *   }
 * })
 *
 * // 修改根层属性会失败
 * state.foo++
 *
 * // 但嵌套对象不是只读代理
 * isReadonly(state.nested) // false
 *
 * // 可以修改
 * state.nested.bar++
 * ```
 *
 * @param target 要转换的源对象。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#shallowreadonly}
 */
export function shallowReadonly<T extends object>(target: T): Readonly<T> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    shallowReadonlyCollectionHandlers,
    shallowReadonlyMap,
  )
}

/**
 * 创建或复用响应式代理，是四种公开对象转换 API 的统一入口。
 *
 * 流程依次排除不可代理值、可直接复用的代理、显式跳过或不可扩展对象；随后查缓存，
 * 最后按普通对象/集合选择处理器。四份 `proxyMap` 使同一原始对象可以分别拥有深/浅、
 * 可变/只读代理，同时每种模式内引用稳定。
 *
 * @param target 原始对象或已有代理。
 * @param isReadonly 是否创建只读代理。
 * @param baseHandlers 普通对象和数组的代理陷阱。
 * @param collectionHandlers 集合类型的代理陷阱。
 * @param proxyMap 当前转换模式对应的代理缓存。
 * @returns 新建／缓存的代理，或因类型、SKIP、不可扩展、已有代理而原样保留的输入。
 * 缓存以本次 target 身份为键；只读包裹可变代理时 target 是该内层代理，不是最内层 raw。
 */
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>,
) {
  if (!isObject(target)) {
    if (__DEV__) {
      warn(
        `value cannot be made ${isReadonly ? 'readonly' : 'reactive'}: ${String(
          target,
        )}`,
      )
    }
    return target
  }
  // 已有代理通常原样返回，不因本次 API 的深浅模式而重建。只读 API 包装可变代理时，
  // 才继续创建外层只读代理，使读取沿内层收集依赖，同时禁止从外层写入。
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target
  }
  // markRaw() 标记或不可扩展对象不能安全安装/维持代理语义，直接返回。
  if (target[ReactiveFlags.SKIP] || !Object.isExtensible(target)) {
    return target
  }
  // 同一输入目标、同一模式复用缓存；readonly(reactive(raw)) 的目标是内层代理。
  const existingProxy = proxyMap.get(target)
  if (existingProxy) {
    return existingProxy
  }
  const targetType = targetTypeMap(toRawType(target))
  if (targetType === TargetType.INVALID) {
    return target
  }
  const proxy = new Proxy(
    target,
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers,
  )
  proxyMap.set(target, proxy)
  return proxy
}

/*@__NO_SIDE_EFFECTS__*/
/**
 * 检查值是否为 {@link reactive} / {@link shallowReactive} 创建的可变响应式代理
 *（某些 Ref 解包后的值也可能是响应式代理）。
 *
 * 若值是包裹响应式对象的只读代理，会递归检查其原始值，所以
 * `isReactive(readonly(reactive({})))` 仍为 `true`。
 *
 * @example
 * ```js
 * isReactive(reactive({}))            // => true
 * isReactive(readonly(reactive({})))  // => true
 * isReactive(ref({}).value)           // => true
 * isReactive(readonly(ref({})).value) // => true
 * isReactive(ref(true))               // => false
 * isReactive(shallowRef({}).value)    // => false
 * isReactive(shallowReactive({}))     // => true
 * ```
 *
 * @param value 待检查的值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#isreactive}
 */
export function isReactive(value: unknown): boolean {
  if (isReadonly(value)) {
    return isReactive((value as Target)[ReactiveFlags.RAW])
  }
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

/*@__NO_SIDE_EFFECTS__*/
/**
 * 检查传入值是否只读。底层原对象仍可能从其他入口变化，但不能经当前值直接赋值。
 *
 * {@link readonly}、{@link shallowReadonly} 创建的代理，以及没有 setter 的计算属性，
 * 都会被视为只读。
 *
 * @param value 待检查的值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#isreadonly}
 */
export function isReadonly(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}

/*@__NO_SIDE_EFFECTS__*/
/**
 * 检查值是否采用浅层响应式/只读语义。
 *
 * @param value 待检查的值。
 */
export function isShallow(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_SHALLOW])
}

/*@__NO_SIDE_EFFECTS__*/
/**
 * 检查对象是否由 {@link reactive}、{@link readonly}、{@link shallowReactive}
 * 或 {@link shallowReadonly} 创建。
 *
 * @param value 待检查的值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#isproxy}
 */
export function isProxy(value: any): boolean {
  return value ? !!value[ReactiveFlags.RAW] : false
}

/*@__NO_SIDE_EFFECTS__*/
/**
 * 返回 Vue 代理背后的最内层原始对象。
 *
 * 代理可能多层嵌套，例如 `readonly(reactive(raw))`，因此函数会递归读取 `RAW`，
 * 直到得到真正的原始对象。
 *
 * 这是临时绕过代理读取开销、依赖收集或触发更新的逃生口。不要长期持有原始引用，
 * 否则同一数据同时出现原始/代理两种身份，容易造成集合查找失败或状态更新不触发。
 *
 * @example
 * ```js
 * const foo = {}
 * const reactiveFoo = reactive(foo)
 *
 * console.log(toRaw(reactiveFoo) === foo) // true
 * ```
 *
 * @param observed 需要取回原始值的对象。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#toraw}
 */
export function toRaw<T>(observed: T): T {
  const raw = observed && (observed as Target)[ReactiveFlags.RAW]
  return raw ? toRaw(raw) : observed
}

/** 类型层面标记不会再被深层代理转换的值。 */
export type Raw<T> = T & {
  /** markRaw 的类型证据；UnwrapRefSimple 遇到该品牌时保留整个值。 */
  [RawSymbol]?: true
}

/**
 * 标记对象永远不转换为代理，并返回对象本身。
 *
 * @example
 * ```js
 * const foo = markRaw({})
 * console.log(isReactive(reactive(foo))) // false
 *
 * // 嵌套进其他响应式对象后仍保持原始身份
 * const bar = reactive({ foo })
 * console.log(isReactive(bar.foo)) // false
 * ```
 *
 * **注意：** `markRaw()` 与 {@link shallowReactive} 等浅层 API 可以选择性跳过默认的
 * 深层转换，适合第三方类实例、不可变数据等。但其未标记的嵌套对象若单独放进响应式
 * 状态仍可能被代理，从而产生原始值与代理值不全等的“身份风险”。
 *
 * @param value 要标记为原始值的对象。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#markraw}
 */
export function markRaw<T extends object>(value: T): Raw<T> {
  // 不覆盖用户已有标记；不可扩展对象本就不会被代理，也无法再定义属性。
  if (!hasOwn(value, ReactiveFlags.SKIP) && Object.isExtensible(value)) {
    def(value, ReactiveFlags.SKIP, true)
  }
  return value
}

/**
 * 值为对象时返回其响应式代理，否则原样返回。
 *
 * @param value 待转换值。
 */
export const toReactive = <T extends unknown>(value: T): T =>
  isObject(value) ? reactive(value) : value

/**
 * 值为对象时返回其只读代理，否则原样返回。
 *
 * @param value 待转换值。
 */
export const toReadonly = <T extends unknown>(value: T): DeepReadonly<T> =>
  isObject(value) ? readonly(value) : (value as DeepReadonly<T>)
