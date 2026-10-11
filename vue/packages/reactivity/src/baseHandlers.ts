import {
  type Target,
  isReadonly,
  isShallow,
  reactive,
  reactiveMap,
  readonly,
  readonlyMap,
  shallowReactiveMap,
  shallowReadonlyMap,
  toRaw,
} from './reactive'
import { arrayInstrumentations } from './arrayInstrumentations'
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './constants'
import { ITERATE_KEY, track, trigger } from './dep'
import {
  hasChanged,
  hasOwn,
  isArray,
  isIntegerKey,
  isObject,
  isSymbol,
  makeMap,
} from '@vue/shared'
import { isRef } from './ref'
import { warn } from './warning'

/**
 * 不应建立依赖的内部属性名。
 *
 * `__proto__` 属于原型协议，`__v_isRef` / `__isVue` 是 Vue 身份探测；若这些探测也
 * 被追踪，会产生与业务状态无关的依赖和额外更新。
 */
const isNonTrackableKeys = /*@__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)

/**
 * JavaScript 内建 Symbol 集合。读取迭代器、类型标签等语言协议 Symbol 时不收集依赖。
 */
const builtInSymbols = new Set(
  /*@__PURE__*/
  Object.getOwnPropertyNames(Symbol)
    // iOS 10.x 会枚举出 arguments/caller；Symbol 是严格模式函数，读取二者会抛错，
    // 因此必须在 `Symbol[key]` 前过滤。
    .filter(key => key !== 'arguments' && key !== 'caller')
    .map(key => Symbol[key as keyof SymbolConstructor])
    .filter(isSymbol),
)

/**
 * 响应式版本的 `hasOwnProperty`。
 *
 * 原生方法通常通过 `obj.hasOwnProperty(key)` 调用，代理在 `get` 时返回本函数；这里
 * 取回原始对象并以 `HAS` 类型收集 key 依赖。
 *
 * issue #10455 场景：用户可传数字、对象等非字符串键。原生实现会先做属性键转换，
 * 若 Vue 直接把原值交给追踪而原生查询使用字符串，会导致收集键与触发键不一致；
 * 因此除 Symbol 外显式 `String(key)`。
 */
function hasOwnProperty(this: object, key: unknown) {
  // #10455：让依赖图中的 key 与原生 hasOwnProperty 实际查询的属性键保持一致。
  if (!isSymbol(key)) key = String(key)
  const obj = toRaw(this)
  track(obj, TrackOpTypes.HAS, key)
  return obj.hasOwnProperty(key as string)
}

/**
 * 普通对象与数组代理共享的读取处理器。
 *
 * 可变/只读、深层/浅层四种组合由两个布尔字段控制。写入相关陷阱只存在于子类。
 */
class BaseReactiveHandler implements ProxyHandler<Target> {
  /**
   * 固定该处理器的只读／深浅模式；Proxy 的 get 陷阱在每次访问时复用此配置。
   *
   * @param _isReadonly 是否禁止写操作，并在读取嵌套对象时继续创建只读代理。
   * @param _isShallow 是否只处理根层，不解包 Ref、不递归代理嵌套对象。
   */
  constructor(
    protected readonly _isReadonly = false,
    protected readonly _isShallow = false,
  ) {}

  /**
   * 拦截属性读取，依次处理内部标记、数组插桩、依赖收集、Ref 解包和嵌套代理。
   *
   * 顺序很重要：内部标记和语言内建 Symbol 不应收集依赖；浅层模式在收集根属性后
   * 立即返回；深层模式才对 Ref/对象做惰性转换。readonly(raw) 本层不 track，
   * readonly(reactive(raw)) 则可经 Reflect.get 的内层代理建立依赖。
   *
   * @param target 本层代理的直接目标，可为 raw 或被外层 readonly 包裹的可变代理。
   * @param key 属性名或 Symbol；内部标记在普通读取前分流。
   * @param receiver 本次访问的接收者，传给普通 getter 维持 this／原型语义。
   */
  get(target: Target, key: string | symbol, receiver: object): any {
    if (key === ReactiveFlags.SKIP) return target[ReactiveFlags.SKIP]

    const isReadonly = this._isReadonly,
      isShallow = this._isShallow
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return isShallow
    } else if (key === ReactiveFlags.RAW) {
      // 只允许“当前缓存中的官方代理”或具有相同原型的用户二次代理读取 raw。
      // 该校验避免任意以响应式代理为原型的对象轻易越过代理边界取得原始对象。
      if (
        receiver ===
          (isReadonly
            ? isShallow
              ? shallowReadonlyMap
              : readonlyMap
            : isShallow
              ? shallowReactiveMap
              : reactiveMap
          ).get(target) ||
        // receiver 不是 Vue 直接创建的代理，但原型相同，说明它是用户在外层再包的代理。
        Object.getPrototypeOf(target) === Object.getPrototypeOf(receiver)
      ) {
        return target
      }
      // 接收者身份不匹配，不暴露原始对象。
      return
    }

    const targetIsArray = isArray(target)

    if (!isReadonly) {
      let fn: Function | undefined
      // 数组方法需要定制依赖收集、参数身份归一化或暂停追踪，不能直接走原生方法。
      if (targetIsArray && (fn = arrayInstrumentations[key])) {
        return fn
      }
      if (key === 'hasOwnProperty') {
        return hasOwnProperty
      }
    }

    const res = Reflect.get(
      target,
      key,
      // 代理包裹 Ref 时让 getter/method 的 this 指向原始 Ref，避免每个 Ref 类方法
      // 都重复调用 toRaw(this)，也避免访问私有字段时接收者不合法。
      isRef(target) ? target : receiver,
    )

    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      // 语言协议和 Vue 身份探测只返回结果，不污染业务依赖图。
      return res
    }

    if (!isReadonly) {
      track(target, TrackOpTypes.GET, key)
    }

    if (isShallow) {
      return res
    }

    if (isRef(res)) {
      // 普通对象属性自动返回 ref.value；数组整数索引保留 Ref 本身，避免
      // `reactive([ref(1)])[0]` 失去可操作的 Ref 身份。
      const value = targetIsArray && isIntegerKey(key) ? res : res.value
      return isReadonly && isObject(value) ? readonly(value) : value
    }

    if (isObject(res)) {
      // 深层转换采用按需包装：只有读取到对象时才调用 readonly()/reactive()。
      // 先做 isObject 检查可避免无效值警告；延迟到这里访问转换函数也缓解模块循环依赖。
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}

/** 普通对象与数组的可变代理处理器，负责写入、删除、存在性检查和遍历。 */
class MutableReactiveHandler extends BaseReactiveHandler {
  /** 创建可变处理器并复用基类读取规则；isShallow 决定是否保留嵌套值与 Ref 身份。 */
  constructor(isShallow = false) {
    super(false, isShallow)
  }

  /**
   * 拦截属性写入，并区分新增与修改以触发正确依赖。
   *
   * 深层模式先把普通代理值还原，避免“同一原始对象的不同代理”被误判为变化。若旧值
   * 是 Ref、新值不是 Ref，则赋值被转发到 `oldRef.value`，保持对象属性里的 Ref 容器；
   * 数组整数索引例外，数组元素需要保留显式 Ref 身份。浅层或只读新值保留其身份，
   * 不经 toRaw 丢掉转换约束；普通深层代理新值才用于 raw 比较和存储。
   *
   * @returns Reflect.set 的成功结果；旧只读 Ref 分支仅警告并返回 true，不实际赋值。
   * 通知发生在原生写入之后，且必须 target===toRaw(receiver)，以避免原型链双重触发。
   */
  set(
    target: Record<string | symbol, unknown>,
    key: string | symbol,
    value: unknown,
    receiver: object,
  ): boolean {
    let oldValue = target[key]
    const isArrayWithIntegerKey = isArray(target) && isIntegerKey(key)
    if (!this._isShallow) {
      const isOldValueReadonly = isReadonly(oldValue)
      if (!isShallow(value) && !isReadonly(value)) {
        oldValue = toRaw(oldValue)
        value = toRaw(value)
      }
      if (!isArrayWithIntegerKey && isRef(oldValue) && !isRef(value)) {
        // 只读 Ref（常见于只读 computed）不能通过对象属性赋值绕过其只读约束。
        if (isOldValueReadonly) {
          if (__DEV__) {
            warn(
              `Set operation on key "${String(key)}" failed: target is readonly.`,
              target[key],
            )
          }
          return true
        } else {
          // `state.count = 2` 等价于 `state.countRef.value = 2`，对象槽位仍保存原 Ref。
          oldValue.value = value
          return true
        }
      }
    } else {
      // 浅层模式按原样存值，不还原代理，也不对 Ref 做赋值转发。
    }

    // 数组整数键落在 length 范围内就按 SET 处理，即使该槽位是空洞；超出范围才按 ADD。
    // 这样补齐空洞不会误报 length 增长。对象则用 hasOwn 判断自有属性，原型属性不算。
    const hadKey = isArrayWithIntegerKey
      ? Number(key) < target.length
      : hasOwn(target, key)
    const result = Reflect.set(
      target,
      key,
      value,
      isRef(target) ? target : receiver,
    )
    // receiver 的原始对象必须就是 target 才触发。若 target 只是 receiver 原型链上的对象，
    // 实际写入属于子对象；子对象若有响应式代理，由其 set 陷阱通知，原型 target 不通知。
    if (target === toRaw(receiver) && result) {
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }

  /** 删除自有属性；仅在删除成功且属性原本存在时触发 `DELETE`。 */
  deleteProperty(
    target: Record<string | symbol, unknown>,
    key: string | symbol,
  ): boolean {
    const hadKey = hasOwn(target, key)
    const oldValue = target[key]
    const result = Reflect.deleteProperty(target, key)
    if (result && hadKey) {
      trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
    }
    return result
  }

  /** 拦截 `key in proxy`；内建 Symbol 不参与业务依赖收集。 */
  has(target: Record<string | symbol, unknown>, key: string | symbol): boolean {
    const result = Reflect.has(target, key)
    if (!isSymbol(key) || !builtInSymbols.has(key)) {
      track(target, TrackOpTypes.HAS, key)
    }
    return result
  }

  /**
   * 拦截 `Object.keys`、`for...in` 等自有键遍历。
   *
   * 对象订阅统一的 `ITERATE_KEY`；数组键集合主要由 `length` 决定，因此订阅 length。
   */
  ownKeys(target: Record<string | symbol, unknown>): (string | symbol)[] {
    track(
      target,
      TrackOpTypes.ITERATE,
      isArray(target) ? 'length' : ITERATE_KEY,
    )
    return Reflect.ownKeys(target)
  }
}

/** 普通对象与数组的只读代理处理器；读取逻辑复用基类，赋值和删除陷阱均不修改目标。 */
class ReadonlyReactiveHandler extends BaseReactiveHandler {
  /** 创建只读处理器；isShallow 只保留根层保护，否则读取到的嵌套值继续只读转换。 */
  constructor(isShallow = false) {
    super(true, isShallow)
  }

  /** 拒绝赋值。返回 `true` 避免严格模式抛出代理陷阱错误，开发模式另发 Vue 警告。 */
  set(target: object, key: string | symbol) {
    if (__DEV__) {
      warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target,
      )
    }
    return true
  }

  /** 拒绝删除属性；返回 `true` 并在开发模式警告。 */
  deleteProperty(target: object, key: string | symbol) {
    if (__DEV__) {
      warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target,
      )
    }
    return true
  }
}

/** `reactive()` 用于普通对象/数组的深层可变处理器单例。 */
export const mutableHandlers: ProxyHandler<object> =
  /*@__PURE__*/ new MutableReactiveHandler()

/** `readonly()` 用于普通对象/数组的深层只读处理器单例。 */
export const readonlyHandlers: ProxyHandler<object> =
  /*@__PURE__*/ new ReadonlyReactiveHandler()

/** `shallowReactive()` 使用的浅层可变处理器单例。 */
export const shallowReactiveHandlers: MutableReactiveHandler =
  /*@__PURE__*/ new MutableReactiveHandler(true)

/**
 * `shallowReadonly()` 使用的浅层只读处理器单例。
 *
 * props 处理器会复用它：顶层 Ref 不解包，父组件可把 Ref 显式传给子组件；根层仍保持
 * 普通只读对象的禁止赋值语义，而嵌套值交由使用者自行管理。
 */
export const shallowReadonlyHandlers: ReadonlyReactiveHandler =
  /*@__PURE__*/ new ReadonlyReactiveHandler(true)
