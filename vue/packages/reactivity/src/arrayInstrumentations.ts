import { TrackOpTypes } from './constants'
import { endBatch, pauseTracking, resetTracking, startBatch } from './effect'
import {
  isProxy,
  isReactive,
  isReadonly,
  isShallow,
  toRaw,
  toReactive,
  toReadonly,
} from './reactive'
import { ARRAY_ITERATE_KEY, track } from './dep'
import { isArray } from '@vue/shared'

/**
 * 收集数组迭代依赖，并返回适合只读类方法使用的数组。
 *
 * - 深层响应式数组：复制原始数组，并把每个元素转换成响应式值；
 * - 非响应式或浅层响应式数组：直接返回原始数组。
 *
 * 数组方法在原始数组上执行，可避免逐个索引触发代理 `get`；统一订阅
 * `ARRAY_ITERATE_KEY` 又能在任意数字索引变化时正确更新。
 */
export function reactiveReadArray<T>(array: T[]): T[] {
  const raw = toRaw(array)
  if (raw === array) return raw
  track(raw, TrackOpTypes.ITERATE, ARRAY_ITERATE_KEY)
  return isShallow(array) ? raw : raw.map(toReactive)
}

/**
 * 收集数组迭代依赖并返回原始数组，不包装其中元素。
 *
 * 用于回调类方法和迭代器：它们会在真正把元素交给用户前按当前深浅/只读模式包装。
 */
export function shallowReadArray<T>(arr: T[]): T[] {
  track((arr = toRaw(arr)), TrackOpTypes.ITERATE, ARRAY_ITERATE_KEY)
  return arr
}

/**
 * 按来源数组的代理模式包装一个元素。
 *
 * `readonly(reactive(array))` 同时具备只读和响应式身份：元素先转响应式，再转只读，
 * 既能沿内层代理追踪变化，又不能从外层修改。
 */
function toWrapped(target: unknown, item: unknown) {
  if (isReadonly(target)) {
    return isReactive(target) ? toReadonly(toReactive(item)) : toReadonly(item)
  }
  return toReactive(item)
}

/**
 * 替代响应式数组原生方法的插桩表。
 *
 * 代理 `get` 陷阱会优先返回这里的同名方法。各方法主要解决三类差异：
 *
 * 1. 批量读取只收集一次数组迭代依赖，并把返回元素恢复为正确代理；
 * 2. `includes` 等身份敏感查询同时兼容原始对象和响应式代理；
 * 3. `push` 等改长度方法暂停依赖收集，避免方法内部读取 `length` 形成自触发循环。
 */
export const arrayInstrumentations: Record<string | symbol, Function> = <any>{
  // 创建无原型表，避免 `constructor` 等继承属性被误识别为数组插桩。
  __proto__: null,

  /** 默认值迭代器：统一订阅数组迭代依赖，并在 `next()` 产出时包装元素。 */
  [Symbol.iterator]() {
    return iterator(this, Symbol.iterator, item => toWrapped(this, item))
  },

  /** 合并当前数组和参数；所有参与合并的响应式数组都需建立迭代依赖。 */
  concat(...args: unknown[]) {
    // concat 还会读取作为参数传入的数组，因此这些数组也要各自收集迭代依赖。
    return reactiveReadArray(this).concat(
      ...args.map(x => (isArray(x) ? reactiveReadArray(x) : x)),
    )
  },

  /** 返回 `[index, value]` 迭代器，仅包装元组中的 value。 */
  entries() {
    return iterator(this, 'entries', (value: [number, unknown]) => {
      value[1] = toWrapped(this, value[1])
      return value
    })
  },

  /** 检查是否所有元素满足条件；回调收到与代理模式一致的元素和数组。 */
  every(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    return apply(this, 'every', fn, thisArg, undefined, arguments)
  },

  /** 筛选元素；返回数组中来自原数组的对象需重新包装。 */
  filter(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    // filter 返回输入数组中的元素；深层代理需把结果数组里的元素重新包装。
    return apply(
      this,
      'filter',
      fn,
      thisArg,
      v => v.map((item: unknown) => toWrapped(this, item)),
      arguments,
    )
  },

  /** 查找首个匹配元素；命中对象按当前代理模式包装后返回。 */
  find(
    fn: (item: unknown, index: number, array: unknown[]) => boolean,
    thisArg?: unknown,
  ) {
    return apply(
      this,
      'find',
      fn,
      thisArg,
      item => toWrapped(this, item),
      arguments,
    )
  },

  /** 查找首个匹配索引；返回数字，无需包装结果。 */
  findIndex(
    fn: (item: unknown, index: number, array: unknown[]) => boolean,
    thisArg?: unknown,
  ) {
    return apply(this, 'findIndex', fn, thisArg, undefined, arguments)
  },

  /** 从尾部查找首个匹配元素；命中对象按当前代理模式包装。 */
  findLast(
    fn: (item: unknown, index: number, array: unknown[]) => boolean,
    thisArg?: unknown,
  ) {
    return apply(
      this,
      'findLast',
      fn,
      thisArg,
      item => toWrapped(this, item),
      arguments,
    )
  },

  /** 从尾部查找首个匹配索引；返回数字，无需包装结果。 */
  findLastIndex(
    fn: (item: unknown, index: number, array: unknown[]) => boolean,
    thisArg?: unknown,
  ) {
    return apply(this, 'findLastIndex', fn, thisArg, undefined, arguments)
  },

  // flat/flatMap 也可受益于 ARRAY_ITERATE_KEY，但嵌套展开涉及多层数组，插桩并不直接。

  /** 遍历全部元素；回调第三参数保持响应式数组代理身份。 */
  forEach(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    return apply(this, 'forEach', fn, thisArg, undefined, arguments)
  },

  /** 判断是否包含指定元素；查询失败时用 raw 参数重试以兼容代理身份。 */
  includes(...args: unknown[]) {
    return searchProxy(this, 'includes', args)
  },

  /** 查找首个元素索引；同时兼容传入原始对象或其代理。 */
  indexOf(...args: unknown[]) {
    return searchProxy(this, 'indexOf', args)
  },

  /** 拼接所有元素为字符串，并统一订阅数组迭代依赖。 */
  join(separator?: string) {
    return reactiveReadArray(this).join(separator)
  },

  // keys() 只产生数字索引、仅依赖 length，直接走代理即可，无需专门插桩。

  /** 从尾部查找元素索引；同时兼容传入原始对象或其代理。 */
  lastIndexOf(...args: unknown[]) {
    return searchProxy(this, 'lastIndexOf', args)
  },

  /** 映射全部元素；回调读取由统一数组迭代依赖负责触发。 */
  map(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    return apply(this, 'map', fn, thisArg, undefined, arguments)
  },

  /** 删除并返回末项；暂停方法内部 length 读取的依赖收集。 */
  pop() {
    return noTracking(this, 'pop')
  },

  /** 向尾部添加元素；批量触发索引和 length 依赖。 */
  push(...args: unknown[]) {
    return noTracking(this, 'push', args)
  },

  /** 从左向右归并；额外处理未显式传入初始累加值时的首元素包装。 */
  reduce(
    fn: (
      acc: unknown,
      item: unknown,
      index: number,
      array: unknown[],
    ) => unknown,
    ...args: unknown[]
  ) {
    return reduce(this, 'reduce', fn, args)
  },

  /** 从右向左归并；其依赖收集和首个累加值包装规则与 reduce 相同。 */
  reduceRight(
    fn: (
      acc: unknown,
      item: unknown,
      index: number,
      array: unknown[],
    ) => unknown,
    ...args: unknown[]
  ) {
    return reduce(this, 'reduceRight', fn, args)
  },

  /** 删除并返回首项；暂停内部 length 读取并合并大量索引移动通知。 */
  shift() {
    return noTracking(this, 'shift')
  },

  // slice 可统一订阅 ARRAY_ITERATE_KEY，但更理想的是只追踪切片区间，暂不插桩。

  /** 检查是否存在满足条件的元素；回调收到与代理模式一致的参数。 */
  some(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    return apply(this, 'some', fn, thisArg, undefined, arguments)
  },

  /** 原地删除/插入元素；暂停内部追踪并把多次索引变化放在同一批中。 */
  splice(...args: unknown[]) {
    return noTracking(this, 'splice', args)
  },

  /** 返回反转副本，不修改源数组；结果元素沿用 `reactiveReadArray` 的包装。 */
  toReversed() {
    // @ts-expect-error：源码类型基线是 ES2016，但用户运行环境可能支持更新的数组 API。
    return reactiveReadArray(this).toReversed()
  },

  /** 返回排序副本，不修改源数组；比较器接收包装后的元素。 */
  toSorted(comparer?: (a: unknown, b: unknown) => number) {
    // @ts-expect-error：源码类型基线是 ES2016，但用户运行环境可能支持更新的数组 API。
    return reactiveReadArray(this).toSorted(comparer)
  },

  /** 返回 splice 后的副本，不修改源数组。 */
  toSpliced(...args: unknown[]) {
    // @ts-expect-error：源码类型基线是 ES2016，但用户运行环境可能支持更新的数组 API。
    return (reactiveReadArray(this).toSpliced as any)(...args)
  },

  /** 向头部添加元素；暂停内部 length 追踪并合并索引移动通知。 */
  unshift(...args: unknown[]) {
    return noTracking(this, 'unshift', args)
  },

  /** 返回值迭代器；每个产出值按当前响应式/只读模式包装。 */
  values() {
    return iterator(this, 'values', item => toWrapped(this, item))
  },
}

/**
 * 包装数组迭代器，使创建迭代器时收集 `ARRAY_ITERATE_KEY`，产出元素时按代理模式转换。
 *
 * 这里的收集时机与原生代理并非严格一致：原生迭代器创建时不读数组，直到 `next()`
 * 才读取 length 和索引。理论上可在一个 effect 中创建、在另一个 effect 中分段消费；
 * 但 JS 迭代器只能单向消费，这种跨作用域用法极少。为减少每步索引追踪，Vue 接受
 * “创建时统一追踪”的简化。
 *
 * @param self 响应式数组代理。
 * @param method 迭代器方法名。
 * @param wrapValue 每次产出值时使用的包装函数。
 */
function iterator(
  self: unknown[],
  method: keyof Array<unknown>,
  wrapValue: (value: any) => unknown,
) {
  const arr = shallowReadArray(self)
  const iter = (arr[method] as any)() as IterableIterator<unknown> & {
    _next: IterableIterator<unknown>['next']
  }
  if (arr !== self && !isShallow(self)) {
    // 深层代理才需要改写 next；浅层数组按原样暴露元素。
    iter._next = iter.next
    iter.next = () => {
      const result = iter._next()
      if (!result.done) {
        result.value = wrapValue(result.value)
      }
      return result
    }
  }
  return iter
}

/**
 * 支持插桩的数组回调方法名。源码编译目标为 ES2016，但用户可能在更高版本环境运行，
 * 因此额外纳入 ES2023 的 `findLast` / `findLastIndex`。
 */
type ArrayMethods = keyof Array<any> | 'findLast' | 'findLastIndex'

/** 原生数组原型，用于识别方法是否被用户子类覆盖。 */
const arrayProto = Array.prototype
/**
 * 执行可能读取全部元素的回调类数组方法，如 `map`、`filter`、`find`。
 *
 * 方法在原始数组上运行以避免逐索引追踪，但回调收到的元素和第三参数仍保持调用者
 * 所见的代理语义；必要时还包装方法返回值。
 *
 * issue #11759 场景：Array 子类或用户扩展数组可能覆盖 `map` 等方法，其参数顺序和
 * 含义不再遵循原生规范。此时不能套用 Vue 的原生方法包装，必须用原始 `arguments`
 * 对代理本身直接调用用户方法，否则会改坏调用约定。
 */
function apply(
  self: unknown[],
  method: ArrayMethods,
  fn: (item: unknown, index: number, array: unknown[]) => unknown,
  thisArg?: unknown,
  wrappedRetFn?: (result: any) => unknown,
  args?: IArguments,
) {
  const arr = shallowReadArray(self)
  const needsWrap = arr !== self && !isShallow(self)
  // @ts-expect-error：method 可能是运行环境提供、但 ES2016 类型库尚未声明的方法。
  const methodFn = arr[method]

  // #11759：用户覆盖的方法签名未知，跳过原生数组优化，并保留原调用参数和 this。
  if (methodFn !== arrayProto[method as any]) {
    const result = methodFn.apply(self, args)
    return needsWrap ? toReactive(result) : result
  }

  let wrappedFn = fn
  if (arr !== self) {
    if (needsWrap) {
      // 深层代理：包装元素，第三参数必须仍是用户传入的响应式数组，而不是 raw 数组。
      wrappedFn = function (this: unknown, item, index) {
        return fn.call(this, toWrapped(self, item), index, self)
      }
    } else if (fn.length > 2) {
      // 浅层代理无需包装元素，但显式接收第三参数的回调仍应拿到代理数组。
      wrappedFn = function (this: unknown, item, index) {
        return fn.call(this, item, index, self)
      }
    }
  }
  const result = methodFn.call(arr, wrappedFn, thisArg)
  return needsWrap && wrappedRetFn ? wrappedRetFn(result) : result
}

/**
 * 执行 `reduce` / `reduceRight`，统一收集数组迭代依赖并修正回调参数。
 *
 * 未传初始累加值时，原生 reduce 会把首个数组元素直接作为 `acc`，它不会经过 item
 * 包装路径，因此首次回调前需额外包装；单元素数组甚至不会调用回调，返回前仍要包装。
 */
function reduce(
  self: unknown[],
  method: keyof Array<any>,
  fn: (acc: unknown, item: unknown, index: number, array: unknown[]) => unknown,
  args: unknown[],
) {
  const arr = shallowReadArray(self)
  const needsWrap = arr !== self && !isShallow(self)
  let wrappedFn = fn
  let wrapInitialAccumulator = false
  if (arr !== self) {
    if (needsWrap) {
      wrapInitialAccumulator = args.length === 0
      wrappedFn = function (this: unknown, acc, item, index) {
        if (wrapInitialAccumulator) {
          wrapInitialAccumulator = false
          acc = toWrapped(self, acc)
        }
        return fn.call(this, acc, toWrapped(self, item), index, self)
      }
    } else if (fn.length > 3) {
      wrappedFn = function (this: unknown, acc, item, index) {
        return fn.call(this, acc, item, index, self)
      }
    }
  }
  const result = (arr[method] as any)(wrappedFn, ...args)
  return wrapInitialAccumulator ? toWrapped(self, result) : result
}

/**
 * 执行 `includes`、`indexOf`、`lastIndexOf` 等依赖引用身份的查询。
 *
 * 原始数组内部通常保存 raw 对象，而用户查询时可能传入该对象的代理。先按用户参数
 * 查询，以兼容数组本就保存代理的情况；失败且参数是代理时，再还原参数重试。
 */
function searchProxy(
  self: unknown[],
  method: keyof Array<any>,
  args: unknown[],
) {
  const arr = toRaw(self) as any
  track(arr, TrackOpTypes.ITERATE, ARRAY_ITERATE_KEY)
  // 第一次保留原参数；数组可能由用户显式存入了代理值。
  const res = arr[method](...args)

  // 未找到时把首个查询参数还原，覆盖“raw 存储、proxy 查询”的常见场景。
  if ((res === -1 || res === false) && isProxy(args[0])) {
    args[0] = toRaw(args[0])
    return arr[method](...args)
  }

  return res
}

/**
 * 执行会修改数组长度的方法，并在调用期间暂停依赖收集、合并触发通知。
 *
 * issue #2137 场景：两个 effect 分别执行 `arr.push(...)`。原生 push 会先读取 length；
 * 若把该读取记为 effect 依赖，一个 effect 改 length 会触发另一个，另一个 push 又反向
 * 触发，形成无限循环。暂停追踪可避免“写方法的内部读取”成为业务依赖；批处理则让
 * 多个索引/length 写入完成后统一通知，观察者不会看到中间状态。
 */
function noTracking(
  self: unknown[],
  method: keyof Array<any>,
  args: unknown[] = [],
) {
  pauseTracking()
  startBatch()
  const res = (toRaw(self) as any)[method].apply(self, args)
  endBatch()
  resetTracking()
  return res
}
