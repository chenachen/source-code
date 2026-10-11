import {
  type Ref,
  effect,
  isReactive,
  isRef,
  reactive,
  ref,
  toRef,
  toRefs,
  toValue,
} from '../src/index'
import { computed } from '@vue/runtime-dom'
import { customRef, shallowRef, triggerRef, unref } from '../src/ref'
import {
  isReadonly,
  isShallow,
  readonly,
  shallowReactive,
  shallowReadonly,
} from '../src/reactive'

describe('reactivity/ref', () => {
  /**
   * 以数值 1 创建 Ref，读取为 1，再给 value 赋 2 后读为 2，验证 Ref 保存与替换值。
   */
  it('should hold a value', () => {
    const a = ref(1)
    expect(a.value).toBe(1)
    a.value = 2
    expect(a.value).toBe(2)
  })

  /**
   * effect 读取 Ref 初值 1；写入 2 后 dummy 为 2、spy 两次，再写同一个 2 不增加次数，验证变化通知与同值过滤。
   */
  it('should be reactive', () => {
    const a = ref(1)
    let dummy
    const fn = vi.fn(() => {
      dummy = a.value
    })
    effect(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(dummy).toBe(1)
    a.value = 2
    expect(fn).toHaveBeenCalledTimes(2)
    expect(dummy).toBe(2)
    // 相同值赋入不通知订阅者。
    a.value = 2
    expect(fn).toHaveBeenCalledTimes(2)
  })

  /**
   * 把 ref(1) 再包 reactive，effect 读取代理 value；直接写原 Ref 为 3 只新增一次调用，经代理写为 5 新增两次，总次数为四，验证内部 _value 不额外订阅，同时外层属性与 Ref 各有通知。
   */
  it('ref wrapped in reactive should not track internal _value access', () => {
    const a = ref(1)
    const b = reactive(a)
    let dummy
    const fn = vi.fn(() => {
      dummy = b.value // 同时订阅外层代理的 value 属性与原 Ref 的 value。
    })
    effect(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(dummy).toBe(1)

    // 直接写原 Ref 只经 Ref 的通知，因此执行一次。
    a.value = 3
    expect(fn).toHaveBeenCalledTimes(2)
    expect(dummy).toBe(3)

    // 经外层代理写入分别经过 Ref 和代理属性的通知，因此执行两次。
    b.value = 5
    expect(fn).toHaveBeenCalledTimes(4)
    expect(dummy).toBe(5)
  })

  /**
   * Ref 初始保存 { count: 1 }，effect 读取 value.count；只修改内部 count 为 2 就更新 dummy，验证普通 Ref 对对象进行深层响应式转换。
   */
  it('should make nested properties reactive', () => {
    const a = ref({
      count: 1,
    })
    let dummy
    effect(() => {
      dummy = a.value.count
    })
    expect(dummy).toBe(1)
    a.value.count = 2
    expect(dummy).toBe(2)
  })

  /**
   * 无参数创建 Ref，effect 首次读到 undefined；给 value 赋 2 后 dummy 为 2，验证无初值 Ref 仍可建立订阅。
   */
  it('should work without initial value', () => {
    const a = ref()
    let dummy
    effect(() => {
      dummy = a.value
    })
    expect(dummy).toBe(undefined)
    a.value = 2
    expect(dummy).toBe(2)
  })

  /**
   * 同一 ref(1) 放入 reactive 的直接属性 a 与嵌套 b.c，effect 同时读取两处；依次自增原 Ref、obj.a、obj.b.c，两处结果依次为 2、3、4，验证读取解包与赋值转发。
   */
  it('should work like a normal property when nested in a reactive object', () => {
    const a = ref(1)
    const obj = reactive({
      a,
      b: {
        c: a,
      },
    })

    let dummy1: number
    let dummy2: number

    effect(() => {
      dummy1 = obj.a
      dummy2 = obj.b.c
    })

    /**
     * 断言直接与嵌套两个属性解包所得 dummy 都等于给定值。
     */
    const assertDummiesEqualTo = (val: number) =>
      [dummy1, dummy2].forEach(dummy => expect(dummy).toBe(val))

    assertDummiesEqualTo(1)
    a.value++
    assertDummiesEqualTo(2)
    obj.a++
    assertDummiesEqualTo(3)
    obj.b.c++
    assertDummiesEqualTo(4)
  })

  /**
   * 把 ref(0) 再传给 ref，使用 b.value + 1；运行时类型为 number，验证 Ref 归一化后可直接使用数值类型。
   */
  it('should unwrap nested ref in types', () => {
    const a = ref(0)
    const b = ref(a)

    expect(typeof (b.value + 1)).toBe('number')
  })

  /**
   * 对象属性 b 保存 ref(0)，再用 ref 包装对象；c.value.b + 1 的运行时类型为 number，验证对象内 Ref 的类型解包与实际访问一致。
   */
  it('should unwrap nested values in types', () => {
    const a = {
      b: ref(0),
    }

    const c = ref(a)

    expect(typeof (c.value.b + 1)).toBe('number')
  })

  /**
   * Ref 保存 [1, ref(3)]，取出响应式数组；第一项不是 Ref、第二项仍为 Ref 且 value = 3，验证数组整数索引保留 Ref 身份。
   */
  it('should NOT unwrap ref types nested inside arrays', () => {
    const arr = ref([1, ref(3)]).value
    expect(isRef(arr[0])).toBe(false)
    expect(isRef(arr[1])).toBe(true)
    expect((arr[1] as Ref).value).toBe(3)
  })

  /**
   * 数组整数索引、空字符串属性和 Symbol 属性分别存 Ref；用 ref 包装后索引仍是 Ref，自定义两项属性解包为 1、2，验证数组仅对整数索引保留 Ref。
   */
  it('should unwrap ref types as props of arrays', () => {
    const arr = [ref(0)]
    const symbolKey = Symbol('')
    arr['' as any] = ref(1)
    arr[symbolKey as any] = ref(2)
    const arrRef = ref(arr).value
    expect(isRef(arrRef[0])).toBe(true)
    expect(isRef(arrRef['' as any])).toBe(false)
    expect(isRef(arrRef[symbolKey as any])).toBe(false)
    expect(arrRef['' as any]).toBe(1)
    expect(arrRef[symbolKey as any]).toBe(2)
  })

  /**
   * Ref 保存包含数字、字符串、对象、函数和 Ref 的元组；分别修改或调用各位置，得到 1、11、对象 a = 2、函数结果 0、内部 Ref = 1，验证元组各位置的类型与解包规则。
   */
  it('should keep tuple types', () => {
    const tuple: [
      number,
      string,
      {
        /** 元组对象元素中的数值字段，递增后应保留对象位置类型。 */
        a: number
      },
      () => number,
      Ref<number>
    ] = [
      0,
      '1',
      { a: 1 },
      () => 0,
      ref(0),
    ]
    const tupleRef = ref(tuple)

    tupleRef.value[0]++
    expect(tupleRef.value[0]).toBe(1)
    tupleRef.value[1] += '1'
    expect(tupleRef.value[1]).toBe('11')
    tupleRef.value[2].a++
    expect(tupleRef.value[2].a).toBe(2)
    expect(tupleRef.value[3]()).toBe(0)
    tupleRef.value[4].value++
    expect(tupleRef.value[4].value).toBe(1)
  })

  /**
   * 对象以多种内建 Symbol 和一个自定义 Symbol 保存 Ref、集合或嵌套结构；ref 包装后逐键 strictEqual 原值，验证 Symbol 键访问与类型保留规则。
   */
  it('should keep symbols', () => {
    const customSymbol = Symbol()
    const obj = {
      [Symbol.asyncIterator]: ref(1),
      [Symbol.hasInstance]: { a: ref('a') },
      [Symbol.isConcatSpreadable]: { b: ref(true) },
      [Symbol.iterator]: [ref(1)],
      [Symbol.match]: new Set<Ref<number>>(),
      [Symbol.matchAll]: new Map<number, Ref<string>>(),
      [Symbol.replace]: { arr: [ref('a')] },
      [Symbol.search]: { set: new Set<Ref<number>>() },
      [Symbol.species]: { map: new Map<number, Ref<string>>() },
      [Symbol.split]: new WeakSet<Ref<boolean>>(),
      [Symbol.toPrimitive]: new WeakMap<Ref<boolean>, string>(),
      [Symbol.toStringTag]: { weakSet: new WeakSet<Ref<boolean>>() },
      [Symbol.unscopables]: { weakMap: new WeakMap<Ref<boolean>, string>() },
      [customSymbol]: { arr: [ref(1)] },
    }

    const objRef = ref(obj)

    const keys: (keyof typeof obj)[] = [
      Symbol.asyncIterator,
      Symbol.hasInstance,
      Symbol.isConcatSpreadable,
      Symbol.iterator,
      Symbol.match,
      Symbol.matchAll,
      Symbol.replace,
      Symbol.search,
      Symbol.species,
      Symbol.split,
      Symbol.toPrimitive,
      Symbol.toStringTag,
      Symbol.unscopables,
      customSymbol,
    ]

    keys.forEach(key => {
      expect(objRef.value[key]).toStrictEqual(obj[key])
    })
  })

  /**
   * 分别把普通数字 1 与 ref(1) 传给 unref，两次均得到 1，验证普通值原样返回而 Ref 读取 value。
   */
  test('unref', () => {
    expect(unref(1)).toBe(1)
    expect(unref(ref(1))).toBe(1)
  })

  /**
   * shallowRef 初值为 { a: 1 }，effect 读取 a；value 不为 reactive，整体替换为 { a: 2 } 后 dummy 为 2 且仍不为 reactive，验证浅 Ref 的根值订阅。
   */
  test('shallowRef', () => {
    const sref = shallowRef({ a: 1 })
    expect(isReactive(sref.value)).toBe(false)

    let dummy
    effect(() => {
      dummy = sref.value.a
    })
    expect(dummy).toBe(1)

    sref.value = { a: 2 }
    expect(isReactive(sref.value)).toBe(false)
    expect(dummy).toBe(2)
  })

  /**
   * effect 读取 shallowRef 内部对象 a = 1；直接改内部 a = 2 时 dummy 不变，调用 triggerRef 后变为 2，验证浅对象变更需要显式通知。
   */
  test('shallowRef force trigger', () => {
    const sref = shallowRef({ a: 1 })
    let dummy
    effect(() => {
      dummy = sref.value.a
    })
    expect(dummy).toBe(1)

    sref.value.a = 2
    expect(dummy).toBe(1) // 此处只修改内部值，尚未显式通知订阅者。

    // 显式通知读取此 shallowRef 的 effect。
    triggerRef(sref)
    expect(dummy).toBe(2)
  })

  /**
   * 以对象创建 shallowRef，再用 isShallow 检查为 true，验证浅层 Ref 的身份标记。
   */
  test('shallowRef isShallow', () => {
    expect(isShallow(shallowRef({ a: 1 }))).toBe(true)
  })

  /**
   * isRef 检查普通 Ref、computed 均为真，检查数字和仅含 value 字段的普通对象为假，验证 Ref 品牌识别。
   */
  test('isRef', () => {
    expect(isRef(ref(1))).toBe(true)
    expect(isRef(computed(() => 1))).toBe(true)

    expect(isRef(0)).toBe(false)
    expect(isRef(1)).toBe(false)
    // 仅有 value 字段不满足 Ref 品牌标记。
    expect(isRef({ value: 0 })).toBe(false)
  })

  /**
   * 从 reactive.x = 1 创建属性 Ref，双向写入和 effect 订阅均同步；另检查已有 Ref 原样返回、普通对象可包装、普通对象的 Ref 属性写入转发及 undefined 时默认值 7，验证 toRef 的归一化和属性联动。
   */
  test('toRef', () => {
    const a = reactive({
      x: 1,
    })
    const x = toRef(a, 'x')

    const b = ref({ y: 1 })

    const c = toRef(b)

    const d = toRef({ z: 1 })

    expect(isRef(d)).toBe(true)
    expect(d.value.z).toBe(1)

    expect(c).toBe(b)

    expect(isRef(x)).toBe(true)
    expect(x.value).toBe(1)

    // 修改源属性，属性 Ref 的读取同步变化。
    a.x = 2
    expect(x.value).toBe(2)

    // 经属性 Ref 写入，源属性同步变化。
    x.value = 3
    expect(a.x).toBe(3)

    // 订阅属性 Ref，检查源属性写入后的自动更新。
    let dummyX
    effect(() => {
      dummyX = x.value
    })
    expect(dummyX).toBe(x.value)

    // 修改源属性会通知读取属性 Ref 的 effect。
    a.x = 4
    expect(dummyX).toBe(4)

    // 普通对象的 Ref 属性也通过属性 Ref 解包并转发读写。
    const r: any = { x: ref(1) }
    const t = toRef(r, 'x')
    expect(t.value).toBe(1)

    r.x.value = 2
    expect(t.value).toBe(2)

    t.value = 3
    expect(t.value).toBe(3)
    expect(r.x.value).toBe(3)

    // 为同一源属性创建带默认值的属性 Ref。
    const u = toRef(r, 'x', 7)
    expect(u.value).toBe(3)

    r.x.value = undefined
    expect(r.x.value).toBeUndefined()
    expect(t.value).toBeUndefined()
    expect(u.value).toBe(7)

    u.value = 7
    expect(r.x.value).toBe(7)
    expect(t.value).toBe(7)
    expect(u.value).toBe(7)
  })

  /**
   * 从响应式数组索引 1 创建属性 Ref，写入后数组同步；索引改存 Ref 后读写其 value，缺失索引默认 def 随 push 和截断变化，length Ref 可写，字符串及 Symbol 属性也能转发 Ref，验证数组属性 Ref 的各类键。
   */
  test('toRef on array', () => {
    const a: any = reactive(['a', 'b'])
    const r = toRef(a, 1)
    expect(r.value).toBe('b')
    r.value = 'c'
    expect(r.value).toBe('c')
    expect(a[1]).toBe('c')

    a[1] = ref('d')
    expect(isRef(a[1])).toBe(true)
    expect(r.value).toBe('d')
    r.value = 'e'
    expect(isRef(a[1])).toBe(true)
    expect(a[1].value).toBe('e')

    const s = toRef(a, 2, 'def')
    const len = toRef(a, 'length')

    expect(s.value).toBe('def')
    expect(len.value).toBe(2)

    a.push('f')
    expect(s.value).toBe('f')
    expect(len.value).toBe(3)

    len.value = 2

    expect(s.value).toBe('def')
    expect(len.value).toBe(2)

    const symbol = Symbol()
    const t = toRef(a, 'foo')
    const u = toRef(a, symbol)
    expect(t.value).toBeUndefined()
    expect(u.value).toBeUndefined()

    const foo = ref(3)
    const bar = ref(5)
    a.foo = foo
    a[symbol] = bar
    expect(t.value).toBe(3)
    expect(u.value).toBe(5)

    t.value = 4
    u.value = 6

    expect(a.foo).toBe(4)
    expect(foo.value).toBe(4)
    expect(a[symbol]).toBe(6)
    expect(bar.value).toBe(6)
  })

  /**
   * 分别以数字 0 和数组 [0] 为属性键创建响应式数组的 toRef；effect 首次调用一次，triggerRef 后两次，验证非 Symbol 键归一为字符串 0 后找到同一依赖。
   */
  test('triggerRef on toRef created from array coerces property keys', () => {
    /**
     * 用给定数组属性键建立 toRef 并订阅，检查 triggerRef 新增一次执行。
     */
    const assertTriggerRef = (key: unknown) => {
      const array = reactive(['a'])
      const first = toRef(array as any, key as any)
      const fn = vi.fn()

      effect(() => fn(first.value))
      expect(fn).toHaveBeenCalledTimes(1)

      triggerRef(first)
      expect(fn).toHaveBeenCalledTimes(2)
    }

    assertTriggerRef(0)
    // JavaScript 会把 [0] 这样的非 Symbol 属性键转换为字符串 "0"。
    assertTriggerRef([0])
  })

  /**
   * 响应式对象的 Symbol 键值为 a，从该键创建 toRef 并注册 effect；triggerRef 后 spy 从一次增为两次，验证通知保留 Symbol 身份。
   */
  test('triggerRef on toRef created from symbol key preserves the symbol', () => {
    const key = Symbol()
    const object = reactive({ [key]: 'a' })
    const value = toRef(object, key)
    const fn = vi.fn()

    effect(() => fn(value.value))
    expect(fn).toHaveBeenCalledTimes(1)

    triggerRef(value)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  /**
   * 普通对象 x 初始为 undefined，toRef 提供默认值 1；读为 1，源改为 2 后读为 2，再改为 undefined 后回到 1，验证默认值仅在读取缺失值时回退。
   */
  test('toRef default value', () => {
    const a: {
      /** 可为 undefined 的源字段，读取时使用属性 Ref 的默认值。 */
      x: number | undefined
    } = { x: undefined }
    const x = toRef(a, 'x', 1)
    expect(x.value).toBe(1)

    a.x = 2
    expect(x.value).toBe(2)

    a.x = undefined
    expect(x.value).toBe(1)
  })

  /**
   * 把返回 1 的 getter 传给 toRef；读取与 unref 均为 1，isRef、isReadonly 为真，强制赋 value 时抛错，验证 getter Ref 的只读归一化。
   */
  test('toRef getter', () => {
    const x = toRef(() => 1)
    expect(x.value).toBe(1)
    expect(isRef(x)).toBe(true)
    expect(unref(x)).toBe(1)
    //@ts-expect-error
    expect(() => (x.value = 123)).toThrow()

    expect(isReadonly(x)).toBe(true)
  })

  /**
   * 同一 computed getter spy 放入普通、reactive、readonly、shallowReactive、shallowReadonly 对象后分别创建属性 Ref；创建不求值，逐一读取均为 5 且 getter 总计一次，验证创建惰性与计算缓存。
   */
  test('toRef lazy evaluation of properties inside a proxy', () => {
    const fn = vi.fn(() => 5)
    const num = computed(fn)
    const a = toRef({ num }, 'num')
    const b = toRef(reactive({ num }), 'num')
    const c = toRef(readonly({ num }), 'num')
    const d = toRef(shallowReactive({ num }), 'num')
    const e = toRef(shallowReadonly({ num }), 'num')

    expect(fn).not.toHaveBeenCalled()

    expect(a.value).toBe(5)
    expect(b.value).toBe(5)
    expect(c.value).toBe(5)
    expect(d.value).toBe(5)
    expect(e.value).toBe(5)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  /**
   * shallowReactive.foo 初始为 ref(0)，其 shallowReadonly 视图创建另一属性 Ref；替换源 Ref、写入 undefined、经两种属性 Ref 赋值和移除槽位，逐步核对旧 Ref 保持 0、当前槽位与不同默认值，验证浅代理槽位转发。
   */
  test('toRef with shallowReactive/shallowReadonly', () => {
    const r = ref(0)
    const s1 = shallowReactive<{
      /** 浅代理的可替换槽位，允许保存 Ref 或 undefined 以检查转发和默认值。 */
      foo: any
    }>({ foo: r })
    const t1 = toRef(s1, 'foo', 2)
    const s2 = shallowReadonly(s1)
    const t2 = toRef(s2, 'foo', 3)

    expect(r.value).toBe(0)
    expect(s1.foo.value).toBe(0)
    expect(t1.value).toBe(0)
    expect(s2.foo.value).toBe(0)
    expect(t2.value).toBe(0)

    s1.foo = ref(1)

    expect(r.value).toBe(0)
    expect(s1.foo.value).toBe(1)
    expect(t1.value).toBe(1)
    expect(s2.foo.value).toBe(1)
    expect(t2.value).toBe(1)

    s1.foo.value = undefined

    expect(r.value).toBe(0)
    expect(s1.foo.value).toBeUndefined()
    expect(t1.value).toBe(2)
    expect(s2.foo.value).toBeUndefined()
    expect(t2.value).toBe(3)

    t1.value = 2

    expect(r.value).toBe(0)
    expect(s1.foo.value).toBe(2)
    expect(t1.value).toBe(2)
    expect(s2.foo.value).toBe(2)
    expect(t2.value).toBe(2)

    t2.value = 4

    expect(r.value).toBe(0)
    expect(s1.foo.value).toBe(4)
    expect(t1.value).toBe(4)
    expect(s2.foo.value).toBe(4)
    expect(t2.value).toBe(4)

    s1.foo = undefined

    expect(r.value).toBe(0)
    expect(s1.foo).toBeUndefined()
    expect(t1.value).toBe(2)
    expect(s2.foo).toBeUndefined()
    expect(t2.value).toBe(3)
  })

  /**
   * shallowReadonly 包裹 reactive 的可写 computed 属性，创建 toRef 不求值；写入触发只读警告且 getter/setter 未调用，随后读取为 3、getter 一次而 setter 零次，验证外层只读限制。
   */
  test('toRef for shallowReadonly around reactive', () => {
    const get = vi.fn(() => 3)
    const set = vi.fn()
    const num = computed({ get, set })
    const t = toRef(shallowReadonly(reactive({ num })), 'num')

    expect(get).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()

    t.value = 1

    expect(
      'Set operation on key "num" failed: target is readonly',
    ).toHaveBeenWarned()

    expect(get).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()

    expect(t.value).toBe(3)

    expect(get).toHaveBeenCalledTimes(1)
    expect(set).not.toHaveBeenCalled()
  })

  /**
   * readonly 包裹 shallowReactive 的可写 computed 属性，创建 toRef 后尝试写入；出现只读警告且 getter/setter 未调用，读取为 3、getter 一次而 setter 零次，验证另一代理组合下的只读限制。
   */
  test('toRef for readonly around shallowReactive', () => {
    const get = vi.fn(() => 3)
    const set = vi.fn()
    const num = computed({ get, set })
    const t: Ref<number> = toRef(readonly(shallowReactive({ num })), 'num')

    expect(get).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()

    t.value = 1

    expect(
      'Set operation on key "num" failed: target is readonly',
    ).toHaveBeenWarned()

    expect(get).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()

    expect(t.value).toBe(3)

    expect(get).toHaveBeenCalledTimes(1)
    expect(set).not.toHaveBeenCalled()
  })

  /**
   * shallowReactive.num 初始为 ref(2)，effect 通过属性 Ref 写入 3；替换 num 为新 ref(4) 后 effect 再写入 3，新 Ref 也为 3，验证属性 Ref 的读写始终经过源代理而非固定旧 Ref。
   */
  test(`toRef doesn't bypass the proxy when getting/setting a nested ref`, () => {
    const r = ref(2)
    const obj = shallowReactive({ num: r })
    const t = toRef(obj, 'num')

    expect(t.value).toBe(2)

    effect(() => {
      t.value = 3
    })

    expect(t.value).toBe(3)
    expect(r.value).toBe(3)

    const s = ref(4)
    obj.num = s

    expect(t.value).toBe(3)
    expect(s.value).toBe(3)
  })

  /**
   * 对 reactive({ x: 1, y: 2 }) 调用 toRefs；确认两项均为 Ref，源写与 Ref 写双向同步，effect 读取两项后再改源得到 4、5，验证批量属性 Ref 的响应性。
   */
  test('toRefs', () => {
    const a = reactive({
      x: 1,
      y: 2,
    })

    const { x, y } = toRefs(a)

    expect(isRef(x)).toBe(true)
    expect(isRef(y)).toBe(true)
    expect(x.value).toBe(1)
    expect(y.value).toBe(2)

    // 修改源属性，属性 Ref 的读取同步变化。
    a.x = 2
    a.y = 3
    expect(x.value).toBe(2)
    expect(y.value).toBe(3)

    // 经属性 Ref 写入，源属性同步变化。
    x.value = 3
    y.value = 4
    expect(a.x).toBe(3)
    expect(a.y).toBe(4)

    // 订阅属性 Ref，检查源属性写入后的自动更新。
    let dummyX, dummyY
    effect(() => {
      dummyX = x.value
      dummyY = y.value
    })
    expect(dummyX).toBe(x.value)
    expect(dummyY).toBe(y.value)

    // 修改源属性会通知读取属性 Ref 的 effect。
    a.x = 4
    a.y = 5
    expect(dummyX).toBe(4)
    expect(dummyY).toBe(5)
  })

  /**
   * 把普通空对象传给 toRefs；断言开发警告要求 reactive object，验证非代理对象提示。
   */
  test('toRefs should warn on plain object', () => {
    toRefs({})
    expect(`toRefs() expects a reactive object`).toHaveBeenWarned()
  })

  /**
   * 把普通空数组传给 toRefs；断言开发警告要求 reactive object，验证非代理数组同样提示。
   */
  test('toRefs should warn on plain array', () => {
    toRefs([])
    expect(`toRefs() expects a reactive object`).toHaveBeenWarned()
  })

  /**
   * 对 reactive([a, b, c]) 调用 toRefs；结果仍是数组，写 refs[0].value 更新源首项，写源第二项更新 refs[1]，验证数组形状与双向联动。
   */
  test('toRefs reactive array', () => {
    const arr = reactive(['a', 'b', 'c'])
    const refs = toRefs(arr)

    expect(Array.isArray(refs)).toBe(true)

    refs[0].value = '1'
    expect(arr[0]).toBe('1')

    arr[1] = '2'
    expect(refs[1].value).toBe('2')
  })

  /**
   * customRef 用 getter 调 track、setter 只保存新值和 trigger 函数；effect 初读 1，赋 2 后仍为 1，手动调用保存的 trigger 后为 2，验证用户决定通知时机。
   */
  test('customRef', () => {
    let value = 1
    let _trigger: () => void

    const custom = customRef((track, trigger) => ({
      /**
       * 显式收集依赖并返回当前闭包值，由用户决定 customRef 的读取行为。
       */
      get() {
        track()
        return value
      },
      /**
       * 只保存新值和 trigger 函数，不立即通知，供测试稍后手动触发。
       */
      set(newValue: number) {
        value = newValue
        _trigger = trigger
      },
    }))

    expect(isRef(custom)).toBe(true)

    let dummy
    effect(() => {
      dummy = custom.value
    })
    expect(dummy).toBe(1)

    custom.value = 2
    // 此处只修改内部值，尚未显式通知订阅者。
    expect(dummy).toBe(1)

    _trigger!()
    expect(dummy).toBe(2)
  })

  /**
   * 普通 Ref 与 shallowRef 都保存同一个 reactive 对象，并分别由 effect 读取；重新赋入同一代理后两个 spy 都仅一次，验证同一代理值不会通知。
   */
  test('should not trigger when setting value to same proxy', () => {
    const obj = reactive({ count: 0 })

    const a = ref(obj)
    const spy1 = vi.fn(() => a.value)

    effect(spy1)

    a.value = obj
    expect(spy1).toBeCalledTimes(1)

    const b = shallowRef(obj)
    const spy2 = vi.fn(() => b.value)

    effect(spy2)

    b.value = obj
    expect(spy2).toBeCalledTimes(1)
  })

  /**
   * Ref 先保存原始对象，初读为对应 reactive 代理；依次赋 shallowReactive 和 readonly 代理后严格等于各自输入且不等于普通代理，验证保留浅层和只读身份。
   */
  test('ref should preserve value shallow/readonly-ness', () => {
    const original = {}
    const r = reactive(original)
    const s = shallowReactive(original)
    const rr = readonly(original)
    const a = ref(original)

    expect(a.value).toBe(r)

    a.value = s
    expect(a.value).toBe(s)
    expect(a.value).not.toBe(r)

    a.value = rr
    expect(a.value).toBe(rr)
    expect(a.value).not.toBe(r)
  })

  /**
   * Ref 保存原始对象并由 effect 订阅，随后再次赋该原始对象；spy 仍一次，验证深 Ref 缓存代理时按 raw 身份过滤同值写入。
   */
  test('should not trigger when setting the same raw object', () => {
    const obj = {}
    const r = ref(obj)
    const spy = vi.fn()
    effect(() => spy(r.value))
    expect(spy).toHaveBeenCalledTimes(1)

    r.value = obj
    expect(spy).toHaveBeenCalledTimes(1)
  })

  /**
   * 以 a = ref(1)、b = computed(a + 1)、c = getter(a + 2) 和普通值 d = 4 调用 toValue；分别得到 1、2、3、4，验证统一读取 Ref、getter 和普通值。
   */
  test('toValue', () => {
    const a = ref(1)
    const b = computed(() => a.value + 1)
    /**
     * 读取 a.value 后加 2，作为 toValue 的 getter 输入。
     */
    const c = () => a.value + 2
    const d = 4

    expect(toValue(a)).toBe(1)
    expect(toValue(b)).toBe(2)
    expect(toValue(c)).toBe(3)
    expect(toValue(d)).toBe(4)
  })

  /**
   * 分别创建普通 Ref、自定义 Ref、getter Ref 和属性 Ref；必要时先读取 value，再检查内部 _value 为 1、0、1、1，验证各实现保存最近读取的值缓存。
   */
  test('ref w/ customRef w/ getterRef w/ objectRef should store value cache', () => {
    const refValue = ref(1)
    // @ts-expect-error private field
    expect(refValue._value).toBe(1)

    let customRefValueCache = 0
    const customRefValue = customRef((track, trigger) => {
      return {
        /**
         * 显式收集依赖并返回闭包值，供检查 customRef 的最近读取缓存。
         */
        get() {
          track()
          return customRefValueCache
        },
        /**
         * 保存闭包值并立即通知订阅者，提供缓存检查用的 customRef 写入行为。
         */
        set(value: number) {
          customRefValueCache = value
          trigger()
        },
      }
    })
    customRefValue.value

    // @ts-expect-error internal field
    expect(customRefValue._value).toBe(0)

    const getterRefValue = toRef(() => 1)
    getterRefValue.value
    // @ts-expect-error internal field
    expect(getterRefValue._value).toBe(1)

    const objectRefValue = toRef({ value: 1 }, 'value')
    objectRefValue.value
    // @ts-expect-error internal field
    expect(objectRefValue._value).toBe(1)
  })
})
