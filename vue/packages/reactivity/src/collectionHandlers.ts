import {
  type Target,
  isReadonly,
  isShallow,
  toRaw,
  toReactive,
  toReadonly,
} from './reactive'
import { ITERATE_KEY, MAP_KEY_ITERATE_KEY, track, trigger } from './dep'
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './constants'
import {
  capitalize,
  extend,
  hasChanged,
  hasOwn,
  isMap,
  toRawType,
} from '@vue/shared'
import { warn } from './warning'

/** 所有受支持集合的联合类型。 */
type CollectionTypes = IterableCollections | WeakCollections

/** 可枚举集合；具有 `size`、`forEach` 和迭代器。 */
type IterableCollections = (Map<any, any> | Set<any>) & Target
/** 不可枚举的弱引用集合；仅支持按键读取和修改。 */
type WeakCollections = (WeakMap<any, any> | WeakSet<any>) & Target
/** 具有键值映射语义的集合。 */
type MapTypes = (Map<any, any> | WeakMap<any, any>) & Target
/** 只存成员值的集合。 */
type SetTypes = (Set<any> | WeakSet<any>) & Target

/** 浅层模式包装函数：集合返回的键和值保持原样。 */
const toShallow = <T extends unknown>(value: T): T => value

/** 获取集合原型；从原型调用原生方法可避免响应式对象上的同名覆盖干扰内部判断。 */
const getProto = <T extends CollectionTypes>(v: T): any =>
  Reflect.getPrototypeOf(v)

/**
 * 为 `keys`、`values`、`entries` 和 `Symbol.iterator` 创建响应式迭代方法。
 *
 * Map 的“仅键迭代”单独订阅 `MAP_KEY_ITERATE_KEY`：修改已有键的值不会改变 keys，
 * 因而不必触发；值/键值对迭代则订阅 `ITERATE_KEY`。返回的包装迭代器在每次
 * `next()` 时按深浅、只读模式转换值，不会提前复制整个集合。
 *
 * @param method 原生迭代方法。
 * @param isReadonly 是否创建只读插桩。
 * @param isShallow 是否直接返回原始键和值。
 * @returns 保持原生迭代状态的包装方法；创建时收集迭代 Dep，next 时才转换单项，
 * 结束结果不包装。readonly 外层不直接 track，但内层 reactive 的原生入口仍可追踪。
 */
function createIterableMethod(
  method: string | symbol,
  isReadonly: boolean,
  isShallow: boolean,
) {
  return function (
    this: IterableCollections,
    ...args: unknown[]
  ): Iterable<unknown> & Iterator<unknown> {
    const target = this[ReactiveFlags.RAW]
    const rawTarget = toRaw(target)
    const targetIsMap = isMap(rawTarget)
    const isPair =
      method === 'entries' || (method === Symbol.iterator && targetIsMap)
    const isKeyOnly = method === 'keys' && targetIsMap
    const innerIterator = target[method](...args)
    const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive
    !isReadonly &&
      track(
        rawTarget,
        TrackOpTypes.ITERATE,
        isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY,
      )
    // 包装真实迭代器：保留其自定义属性，只覆写 next() 的产出值。
    return extend(
      // 通过原型继承真实迭代器的其余属性和迭代协议实现。
      Object.create(innerIterator),
      {
        // Map entries/默认迭代器产出 `[key, value]`，键和值都需分别包装。
        /** 读取原迭代器下一项，并在尚未结束时转换产出值。 */
        next() {
          const { value, done } = innerIterator.next()
          return done
            ? { value, done }
            : {
                value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
                done,
              }
        },
      },
    )
  }
}

/**
 * 创建只读集合的写方法。
 *
 * 返回值与原生 API 形状保持一致：`delete` 返回 false，`clear` 返回 undefined，
 * `add` / `set` 返回当前代理以维持链式调用；开发模式额外警告。
 */
function createReadonlyMethod(type: TriggerOpTypes): Function {
  return function (this: CollectionTypes, ...args: unknown[]) {
    if (__DEV__) {
      const key = args[0] ? `on key "${args[0]}" ` : ``
      warn(
        `${capitalize(type)} operation ${key}failed: target is readonly.`,
        toRaw(this),
      )
    }
    return type === TriggerOpTypes.DELETE
      ? false
      : type === TriggerOpTypes.CLEAR
        ? undefined
        : this
  }
}

/** 集合插桩表；除方法外还包含 `size` getter 返回的数字。 */
type Instrumentations = Record<string | symbol, Function | number>

/**
 * 创建某一种“只读 × 深浅”模式下的完整集合插桩表。
 *
 * 集合的原生方法要求 `this` 具有 Map/Set 内部槽，直接把代理作为 this 会抛出
 * “incompatible receiver”。因此代理 `get` 不直接返回原生方法，而返回这些知道如何
 * 取 raw target、收集/触发依赖并包装返回值的方法。
 */
function createInstrumentations(
  readonly: boolean,
  shallow: boolean,
): Instrumentations {
  const instrumentations: Instrumentations = {
    /**
     * 读取 Map/WeakMap 中的值，同时兼容 key 的原始身份和代理身份。
     *
     * issue #1772：`readonly(reactive(map))` 需要返回“既响应式又只读”的值，故最终
     * 取值走内层 target.get，再按外层模式包装，不能只从最原始 Map 取值。
     * 先尝试传入 key，未命中才尝试 rawKey；查询 raw key 不会遍历反查代理 key。
     * 不存在时返回 undefined，可变集合仍建立缺失 key 的 Dep，供以后 ADD 通知。
     */
    get(this: MapTypes, key: unknown) {
      // #1772：保留内层 reactive Map 的读取链，再给结果增加 readonly 约束。
      const target = this[ReactiveFlags.RAW]
      const rawTarget = toRaw(target)
      const rawKey = toRaw(key)
      if (!readonly) {
        // key 若是代理，同时追踪 proxy key 与 raw key：集合可能由用户以任一身份建键。
        if (hasChanged(key, rawKey)) {
          track(rawTarget, TrackOpTypes.GET, key)
        }
        track(rawTarget, TrackOpTypes.GET, rawKey)
      }
      const { has } = getProto(rawTarget)
      const wrap = shallow ? toShallow : readonly ? toReadonly : toReactive
      if (has.call(rawTarget, key)) {
        return wrap(target.get(key))
      } else if (has.call(rawTarget, rawKey)) {
        return wrap(target.get(rawKey))
      } else if (target !== rawTarget) {
        // #3602：外层 readonly 不收集依赖，但内层 target 可能是 reactive(Map)。即便
        // 没找到键也要调用一次内层 get，让“当前不存在的键”建立依赖；以后 set 该键
        // 时，依赖 readonly(reactive(map)).get(key) 的 effect 才会重新运行。
        target.get(key)
      }
    },
    /**
     * 读取 size 时，可变模式订阅 ITERATE_KEY。新增、删除、非空清空都会通知它；
     * Map 已有键换值也会通知此依赖，不要求 size 数值发生变化。
     */
    get size() {
      const target = (this as unknown as IterableCollections)[ReactiveFlags.RAW]
      !readonly && track(toRaw(target), TrackOpTypes.ITERATE, ITERATE_KEY)
      return target.size
    },
    /** 检查键/成员是否存在，同时兼容查询值的代理与原始身份。 */
    has(this: CollectionTypes, key: unknown): boolean {
      const target = this[ReactiveFlags.RAW]
      const rawTarget = toRaw(target)
      const rawKey = toRaw(key)
      if (!readonly) {
        if (hasChanged(key, rawKey)) {
          track(rawTarget, TrackOpTypes.HAS, key)
        }
        track(rawTarget, TrackOpTypes.HAS, rawKey)
      }
      return key === rawKey
        ? target.has(key)
        : target.has(key) || target.has(rawKey)
    },
    /**
     * 遍历集合。回调的 value、key 依当前模式包装，第三参数保持集合代理身份，
     * 与原生 `forEach((value, key, collection) => ...)` 的调用约定一致。
     */
    forEach(this: IterableCollections, callback: Function, thisArg?: unknown) {
      const observed = this
      const target = observed[ReactiveFlags.RAW]
      const rawTarget = toRaw(target)
      const wrap = shallow ? toShallow : readonly ? toReadonly : toReactive
      !readonly && track(rawTarget, TrackOpTypes.ITERATE, ITERATE_KEY)
      return target.forEach((value: unknown, key: unknown) => {
        // 必须让第三参数仍是代理集合，并让 value/key 与集合的响应式/只读模式一致。
        return callback.call(thisArg, wrap(value), wrap(key), observed)
      })
    },
  }

  extend(
    instrumentations,
    readonly
      ? {
          add: createReadonlyMethod(TriggerOpTypes.ADD),
          set: createReadonlyMethod(TriggerOpTypes.SET),
          delete: createReadonlyMethod(TriggerOpTypes.DELETE),
          clear: createReadonlyMethod(TriggerOpTypes.CLEAR),
        }
      : {
          /**
           * 向 Set/WeakSet 添加成员。浅层集合保存传入值；深层集合仅在
           * `isShallow(value)` 与 `isReadonly(value)` 均为 false 时存 raw 值。
           * 写入前检查拟存身份、传入身份及原始身份，避免这些已知身份对应的重复添加；
           * 不会从原始对象反查集合中其他代理身份。
           */
          add(this: SetTypes, value: unknown) {
            const target = toRaw(this)
            const proto = getProto(target)
            const rawValue = toRaw(value)
            const valueToAdd =
              !shallow && !isShallow(value) && !isReadonly(value)
                ? rawValue
                : value
            const hadKey =
              proto.has.call(target, valueToAdd) ||
              (hasChanged(value, valueToAdd) &&
                proto.has.call(target, value)) ||
              (hasChanged(rawValue, valueToAdd) &&
                proto.has.call(target, rawValue))
            if (!hadKey) {
              // 只有真正新增成员才修改集合并触发 ADD，重复 add 不产生更新。
              target.add(valueToAdd)
              trigger(target, TriggerOpTypes.ADD, valueToAdd, valueToAdd)
            }
            return this
          },
          /**
           * 设置 Map/WeakMap 键值。已有 key 优先沿用其当前身份；找不到才尝试 raw key。
           * 新键触发 ADD，已有键且值按 Object.is 实际变化触发 SET。深层写入普通代理
           * value 存 raw，浅层／只读 value 则保留；key 身份判断与 value 转换彼此独立。
           */
          set(this: MapTypes, key: unknown, value: unknown) {
            if (!shallow && !isShallow(value) && !isReadonly(value)) {
              value = toRaw(value)
            }
            const target = toRaw(this)
            const { has, get } = getProto(target)

            let hadKey = has.call(target, key)
            if (!hadKey) {
              // 用户常以代理 key 调用 set，而深层集合通常保存 raw key；统一到已有身份。
              key = toRaw(key)
              hadKey = has.call(target, key)
            } else if (__DEV__) {
              // 若 raw/proxy 两种 key 已同时存在，任何一次 set 都可能产生歧义，开发期警告。
              checkIdentityKeys(target, has, key)
            }

            const oldValue = get.call(target, key)
            target.set(key, value)
            if (!hadKey) {
              trigger(target, TriggerOpTypes.ADD, key, value)
            } else if (hasChanged(value, oldValue)) {
              trigger(target, TriggerOpTypes.SET, key, value, oldValue)
            }
            return this
          },
          /** 删除集合成员；先保存旧值供调试钩子使用，再执行原生删除和依赖通知。 */
          delete(this: CollectionTypes, key: unknown) {
            const target = toRaw(this)
            const { has, get } = getProto(target)
            let hadKey = has.call(target, key)
            if (!hadKey) {
              key = toRaw(key)
              hadKey = has.call(target, key)
            } else if (__DEV__) {
              checkIdentityKeys(target, has, key)
            }

            const oldValue = get ? get.call(target, key) : undefined
            // 先完成集合变更再通知，副作用同步读取时看到删除后的最终状态。
            const result = target.delete(key)
            if (hadKey) {
              trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
            }
            return result
          },
          /** 清空 Map/Set；仅非空集合触发，开发模式复制旧集合供 onTrigger 调试。 */
          clear(this: IterableCollections) {
            const target = toRaw(this)
            const hadItems = target.size !== 0
            const oldTarget = __DEV__
              ? isMap(target)
                ? new Map(target)
                : new Set(target)
              : undefined
            // 先完成清空再通知，副作用同步读取时不会看到中间状态。
            const result = target.clear()
            if (hadItems) {
              trigger(
                target,
                TriggerOpTypes.CLEAR,
                undefined,
                undefined,
                oldTarget,
              )
            }
            return result
          },
        },
  )

  const iteratorMethods = [
    'keys',
    'values',
    'entries',
    Symbol.iterator,
  ] as const

  // 四种迭代方法共用创建逻辑；Map.keys 单独订阅 MAP_KEY_ITERATE_KEY，
  // 其余方法订阅 ITERATE_KEY，并按产出形态包装值。
  iteratorMethods.forEach(method => {
    instrumentations[method] = createIterableMethod(method, readonly, shallow)
  })

  return instrumentations
}

/**
 * 创建集合代理唯一需要的 `get` 陷阱。
 *
 * 若 key 在插桩表中且原集合也确实支持该成员，则返回插桩；否则回退到原集合属性。
 * “原集合也支持”可避免 WeakMap 意外暴露 size、迭代器等不属于它的 API。
 * 插桩表按只读／深浅模式创建并由返回的闭包共享；只替代受支持的成员，用户额外属性
 * 仍由 Reflect.get 返回。内部 RAW 直接返回本层 target，toRaw 再逐层还原。
 */
function createInstrumentationGetter(isReadonly: boolean, shallow: boolean) {
  const instrumentations = createInstrumentations(isReadonly, shallow)

  return (
    target: CollectionTypes,
    key: string | symbol,
    receiver: CollectionTypes,
  ) => {
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (key === ReactiveFlags.RAW) {
      return target
    }

    return Reflect.get(
      hasOwn(instrumentations, key) && key in target
        ? instrumentations
        : target,
      key,
      receiver,
    )
  }
}

/** 深层可变 Map/Set/WeakMap/WeakSet 处理器。 */
export const mutableCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: /*@__PURE__*/ createInstrumentationGetter(false, false),
}

/** 浅层可变集合处理器；键和值不做递归转换。 */
export const shallowCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: /*@__PURE__*/ createInstrumentationGetter(false, true),
}

/** 深层只读集合处理器；读取到的对象继续转换为只读。 */
export const readonlyCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: /*@__PURE__*/ createInstrumentationGetter(true, false),
}

/** 浅层只读集合处理器；只禁止集合自身修改，已有键和值按原样返回。 */
export const shallowReadonlyCollectionHandlers: ProxyHandler<CollectionTypes> =
  {
    get: /*@__PURE__*/ createInstrumentationGetter(true, true),
  }

/**
 * 检查集合是否同时保存同一对象的 raw key 和 reactive key。
 *
 * 两种身份会导致 `get` / `set` / `delete` 的命中项依赖传参形态，产生看似随机的不一致。
 * Vue 只能在开发模式警告，因为自动合并会覆盖其中一个 Map 值或改变 Set 内容。
 */
function checkIdentityKeys(
  target: CollectionTypes,
  has: (key: unknown) => boolean,
  key: unknown,
) {
  const rawKey = toRaw(key)
  if (rawKey !== key && has.call(target, rawKey)) {
    const type = toRawType(target)
    warn(
      `Reactive ${type} contains both the raw and reactive ` +
        `versions of the same object${type === `Map` ? ` as keys` : ``}, ` +
        `which can lead to inconsistencies. ` +
        `Avoid differentiating between the raw and reactive versions ` +
        `of an object and only use the reactive version if possible.`,
    )
  }
}
