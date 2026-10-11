import { isRef, ref, shallowRef } from '../src/ref'
import {
  isProxy,
  isReactive,
  isReadonly,
  isShallow,
  markRaw,
  reactive,
  readonly,
  shallowReactive,
  shallowReadonly,
  toRaw,
} from '../src/reactive'
import { computed } from '../src/computed'
import { effect } from '../src/effect'
import { targetMap } from '../src/dep'

describe('reactivity/reactive', () => {
  /**
   * 将 { foo: 1 } 转为 reactive 后读取属性、检查 in 和枚举自有键。
   * 断言代理与原对象身份不同、原对象无响应式标记，且三种读取仍返回原始数据。
   */
  test('Object', () => {
    const original = { foo: 1 }
    const observed = reactive(original)
    expect(observed).not.toBe(original)
    expect(isReactive(observed)).toBe(true)
    expect(isReactive(original)).toBe(false)
    // 读取属性值。
    expect(observed.foo).toBe(1)
    // 查询属性是否存在。
    expect('foo' in observed).toBe(true)
    // 枚举自有可枚举键。
    expect(Object.keys(observed)).toEqual(['foo'])
  })

  /**
   * 先读取响应式空对象的 __proto__，再转换含 ['a'] 的另一对象并读取首项。
   * 验证原型访问后其他对象的代理创建及嵌套数组读取仍正常；本例不直接断言原型身份。
   */
  test('proto', () => {
    const obj = {}
    const reactiveObj = reactive(obj)
    expect(isReactive(reactiveObj)).toBe(true)
    // 读取对象属性可能触发嵌套代理转换；这里访问原型后再验证另一对象。
    // @ts-expect-error
    const prototype = reactiveObj['__proto__']
    const otherObj = { data: ['a'] }
    expect(isReactive(otherObj)).toBe(false)
    const reactiveOther = reactive(otherObj)
    expect(isReactive(reactiveOther)).toBe(true)
    expect(reactiveOther.data[0]).toBe('a')
  })

  /**
   * 将含普通嵌套对象和对象数组的状态转为 reactive，再逐层读取。
   * 断言 nested、array 和 array[0] 都获得响应式标记，证明深层转换发生在读取路径。
   */
  test('nested reactives', () => {
    const original = {
      nested: {
        foo: 1,
      },
      array: [{ bar: 2 }],
    }
    const observed = reactive(original)
    expect(isReactive(observed.nested)).toBe(true)
    expect(isReactive(observed.array)).toBe(true)
    expect(isReactive(observed.array[0])).toBe(true)
  })

  /**
   * 代理 Map、Set 的空子类实例：Map 写入对象后读取，Set 的 has effect 经 add/delete 更新。
   * 断言 instanceof 保留、Map 值被深层代理，Set 成员依赖按 false→true→false 变化。
   */
  test('observing subtypes of IterableCollections(Map, Set)', () => {
    /**
     * Map 空子类夹具，用于验证代理保留原生集合继承关系并代理读取到的对象值。
     */
    class CustomMap extends Map {}
    const cmap = reactive(new CustomMap())

    expect(cmap).toBeInstanceOf(Map)
    expect(isReactive(cmap)).toBe(true)

    cmap.set('key', {})
    expect(isReactive(cmap.get('key'))).toBe(true)

    /**
     * Set 空子类夹具，用于验证成员 add/delete 仍能通知 has 订阅者。
     */
    class CustomSet extends Set {}
    const cset = reactive(new CustomSet())

    expect(cset).toBeInstanceOf(Set)
    expect(isReactive(cset)).toBe(true)

    let dummy
    effect(() => (dummy = cset.has('value')))
    expect(dummy).toBe(false)
    cset.add('value')
    expect(dummy).toBe(true)
    cset.delete('value')
    expect(dummy).toBe(false)
  })

  /**
   * 代理 WeakMap、WeakSet 的空子类实例，使用同一对象键写入、查询和删除。
   * 断言弱集合 instanceof 保留、WeakMap 对象值被代理，WeakSet 的 has effect 随成员变化。
   */
  test('observing subtypes of WeakCollections(WeakMap, WeakSet)', () => {
    /**
     * WeakMap 空子类夹具，以对象键验证弱集合代理及值的深层转换。
     */
    class CustomMap extends WeakMap {}
    const cmap = reactive(new CustomMap())

    expect(cmap).toBeInstanceOf(WeakMap)
    expect(isReactive(cmap)).toBe(true)

    const key = {}
    cmap.set(key, {})
    expect(isReactive(cmap.get(key))).toBe(true)

    /**
     * WeakSet 空子类夹具，用于验证对象成员变化仍能驱动 has 订阅者。
     */
    class CustomSet extends WeakSet {}
    const cset = reactive(new CustomSet())

    expect(cset).toBeInstanceOf(WeakSet)
    expect(isReactive(cset)).toBe(true)

    let dummy
    effect(() => (dummy = cset.has(key)))
    expect(dummy).toBe(false)
    cset.add(key)
    expect(dummy).toBe(true)
    cset.delete(key)
    expect(dummy).toBe(false)
  })

  // #8647
  /**
   * 原始 Set 预存一个 reactive 对象，再代理 Set 并重复 add 同一代理。
   * has 始终命中且 size 保持 1，验证已存在的代理成员不会因本次重复写入而增加。
   */
  test('observing Set with reactive initial value', () => {
    const observed = reactive({})
    const observedSet = reactive(new Set([observed]))

    expect(observedSet.has(observed)).toBe(true)
    expect(observedSet.size).toBe(1)

    // 同一代理成员再次加入，成员数不变。
    observedSet.add(observed)
    expect(observedSet.size).toBe(1)
  })

  /**
   * 原始对象已有 foo，通过代理新增 bar 并删除 foo。
   * 同时检查代理与 raw 的读取结果，证明 set/delete 操作落到同一个原始对象。
   */
  test('observed value should proxy mutations to original (Object)', () => {
    const original: any = { foo: 1 }
    const observed = reactive(original)
    // 写入新增属性。
    observed.bar = 1
    expect(observed.bar).toBe(1)
    expect(original.bar).toBe(1)
    // 删除已有属性。
    delete observed.foo
    expect('foo' in observed).toBe(false)
    expect('foo' in original).toBe(false)
  })

  /**
   * 原对象 foo 不可写，effect 已读取其初值 1；随后经代理尝试写入 2。
   * 严格模式写入抛 TypeError，读取值和执行次数仍为 1，验证 Reflect.set 失败不发送更新。
   */
  test('failed set operation should not trigger effects', () => {
    const original: any = {}
    Object.defineProperty(original, 'foo', {
      value: 1,
      writable: false,
      configurable: true,
    })
    const observed = reactive(original)
    let dummy
    let run = 0
    effect(() => {
      run++
      dummy = observed.foo
    })

    expect(() => {
      observed.foo = 2
    }).toThrow(TypeError)
    expect(dummy).toBe(1)
    expect(run).toBe(1)
  })

  /**
   * 代理 { foo: 1 } 后直接向 raw 新增 bar、删除 foo，再从两侧读取。
   * 两侧均反映底层变更，证明代理读取使用当前 raw；本例没有订阅者，不验证 raw 写入通知。
   */
  test('original value change should reflect in observed value (Object)', () => {
    const original: any = { foo: 1 }
    const observed = reactive(original)
    // 写入新增属性。
    original.bar = 1
    expect(original.bar).toBe(1)
    expect(observed.bar).toBe(1)
    // 删除已有属性。
    delete original.foo
    expect('foo' in original).toBe(false)
    expect('foo' in observed).toBe(false)
  })

  /**
   * 在响应式空对象的 foo 槽位写入普通对象，再读取 foo。
   * 返回值与写入对象身份不同且 isReactive 为 true，验证新嵌套值按需转为代理。
   */
  test('setting a property with an unobserved value should wrap with reactive', () => {
    const observed = reactive<{
      /** 允许后续写入普通对象的可选槽位，用于检查读取时的深层代理转换。 */ foo?: object
    }>({})
    const raw = {}
    observed.foo = raw
    expect(observed.foo).not.toBe(raw)
    expect(isReactive(observed.foo)).toBe(true)
  })

  /**
   * 先代理 { foo: 1 }，再将该代理传给 reactive。
   * 两次结果引用相同，验证已有可变代理的复用分支。
   */
  test('observing already observed value should return same Proxy', () => {
    const original = { foo: 1 }
    const observed = reactive(original)
    const observed2 = reactive(observed)
    expect(observed2).toBe(observed)
  })

  /**
   * 将同一个原始 { foo: 1 } 连续两次传给 reactive。
   * 两次得到同一代理引用，验证按输入 target 保存的 reactive 缓存。
   */
  test('observing the same value multiple times should return same Proxy', () => {
    const original = { foo: 1 }
    const observed = reactive(original)
    const observed2 = reactive(original)
    expect(observed2).toBe(observed)
  })

  /**
   * 把第二个对象的 reactive 代理写入第一个对象的代理属性 bar。
   * 代理侧读回原代理，raw 侧保存第二个原对象，验证深层 set 保存 raw 而读取恢复代理身份。
   */
  test('should not pollute original object with Proxies', () => {
    const original: any = { foo: 1 }
    const original2 = { bar: 2 }
    const observed = reactive(original)
    const observed2 = reactive(original2)
    observed.bar = observed2
    expect(observed.bar).toBe(observed2)
    expect(original.bar).toBe(original2)
  })

  // #1246
  /**
   * 普通子对象以 reactive({ foo: 1 }) 为原型，effect 读取继承的 foo。
   * 修改原型 foo 会更新 effect；随后子对象建立并修改自有 foo 不再通知该原型依赖，验证 receiver 检查。
   */
  test('mutation on objects using reactive as prototype should not trigger', () => {
    const observed = reactive({ foo: 1 })
    const original = Object.create(observed)
    let dummy
    effect(() => (dummy = original.foo))
    expect(dummy).toBe(1)
    observed.foo = 2
    expect(dummy).toBe(2)
    original.foo = 3
    expect(dummy).toBe(2)
    original.foo = 4
    expect(dummy).toBe(2)
  })

  /**
   * 对 reactive({ foo: 1 }) 及其原始对象分别调用 toRaw。
   * 两条入口都返回同一原对象，验证代理解包与原对象直返。
   */
  test('toRaw', () => {
    const original = { foo: 1 }
    const observed = reactive(original)
    expect(toRaw(observed)).toBe(original)
    expect(toRaw(original)).toBe(original)
  })

  /**
   * 普通对象以 reactive 代理为原型，再对该普通对象调用 toRaw。
   * 结果仍是子对象自身，验证 RAW 读取不会把继承者误认成原型代理。
   */
  test('toRaw on object using reactive as prototype', () => {
    const original = { foo: 1 }
    const observed = reactive(original)
    const inherited = Object.create(observed)
    expect(toRaw(inherited)).toBe(inherited)
  })

  /**
   * 用户创建的空 handler Proxy 再包住一个 reactive 代理，然后调用 toRaw。
   * 结果是最内层原对象，验证允许的同原型接收者可以沿 RAW 递归解包。
   */
  test('toRaw on user Proxy wrapping reactive', () => {
    const original = {}
    const re = reactive(original)
    const obj = new Proxy(re, {})
    const raw = toRaw(obj)
    expect(raw).toBe(original)
  })

  /**
   * 将数值 Ref 和对象 Ref 实例本身传给 reactive。
   * 两者仍被 isRef 识别，验证直接代理 Ref 实例不会把整个实例替换成 value。
   */
  test('should not unwrap Ref<T>', () => {
    const observedNumberRef = reactive(ref(1))
    const observedObjectRef = reactive(ref({ foo: 1 }))

    expect(isRef(observedNumberRef)).toBe(true)
    expect(isRef(observedObjectRef)).toBe(true)
  })

  /**
   * 响应式对象属性分别保存只读 computed 和带 setter 的 computed，再读取 a/b。
   * 类型层面可做数值运算，运行时 typeof 均为 number，验证普通对象属性自动解包计算 Ref。
   */
  test('should unwrap computed refs', () => {
    // 无 setter 的只读 computed。
    const a = computed(() => 1)
    // 提供 setter 的可写 computed。
    const b = computed({
      /**
       * 恒定返回 1 的可写 computed getter，供普通对象属性读取验证计算 Ref 的自动解包。
       */
      get: () => 1,
      /**
       * 空 setter 使本夹具成为可写 computed；本例只验证读取解包，不执行写入行为。
       */
      set: () => {},
    })
    const obj = reactive({ a, b })
    // 用数值运算检查属性解包后的类型。
    obj.a + 1
    obj.b + 1
    expect(typeof obj.a).toBe(`number`)
    expect(typeof obj.b).toBe(`number`)
  })

  /**
   * 响应式对象 a 起初保存 foo Ref，computed 读取解包后的 a；随后用 bar Ref 替换 a。
   * 派生值从 0→1，再随 bar.value 增长到 2，验证 Ref 到 Ref 的赋值替换槽位并切换依赖。
   */
  test('should allow setting property from a ref to another ref', () => {
    const foo = ref(0)
    const bar = ref(1)
    const observed = reactive({ a: foo })
    const dummy = computed(() => observed.a)
    expect(dummy.value).toBe(0)

    // @ts-expect-error
    observed.a = bar
    expect(dummy.value).toBe(1)

    bar.value++
    expect(dummy.value).toBe(2)
  })

  /**
   * 依次将数字、字符串、布尔、null、undefined、Symbol、BigInt 传给 reactive。
   * 逐项确认开发警告；Promise、RegExp、Date 则返回原引用，验证无效原始输入与不支持对象类型的不同路径。
   */
  test('non-observable values', () => {
    /**
     * 将一个无效原始输入传给 reactive，并确认最新开发警告包含该输入的字符串表示。
     */
    const assertValue = (value: any) => {
      reactive(value)
      expect(
        `value cannot be made reactive: ${String(value)}`,
      ).toHaveBeenWarnedLast()
    }

    // 数字输入。
    assertValue(1)
    // 字符串输入。
    assertValue('foo')
    // 布尔输入。
    assertValue(false)
    // null 输入。
    assertValue(null)
    // undefined 输入。
    assertValue(undefined)
    // Symbol 输入。
    const s = Symbol()
    assertValue(s)
    // BigInt 输入。
    const bn = BigInt('9007199254740991')
    assertValue(bn)

    // 不支持代理的内建对象保持原引用。
    const p = Promise.resolve()
    expect(reactive(p)).toBe(p)
    const r = new RegExp('')
    expect(reactive(r)).toBe(r)
    const d = new Date()
    expect(reactive(d)).toBe(d)
  })

  /**
   * 响应式对象同时保存普通 foo 和 markRaw 标记的 bar，然后读取两项。
   * foo 被代理而 bar 不被代理，验证嵌套读取尊重 SKIP 标记。
   */
  test('markRaw', () => {
    const obj = reactive({
      foo: { a: 1 },
      bar: markRaw({ b: 2 }),
    })
    expect(isReactive(obj.foo)).toBe(true)
    expect(isReactive(obj.bar)).toBe(false)
  })

  /**
   * 对已经 Object.seal 的对象调用 markRaw。
   * 调用不抛错，验证无法扩展的对象无需尝试新增 SKIP 属性。
   */
  test('markRaw should skip non-extensible objects', () => {
    const obj = Object.seal({ foo: 1 })
    expect(() => markRaw(obj)).not.toThrowError()
  })

  /**
   * 同一对象先 markRaw，再重复标记两次。
   * 返回引用始终相同且不抛错，验证已有 SKIP 标记不会被重复定义。
   */
  test('markRaw should not redefine on an marked object', () => {
    const obj = markRaw({ foo: 1 })
    const raw = markRaw(obj)
    expect(raw).toBe(obj)
    expect(() => markRaw(obj)).not.toThrowError()
  })

  /**
   * 先创建对象 a 的代理，再将 markRaw(toRaw(a)) 写入另一代理 b。
   * 读回 b.a 不等于旧代理 a，验证标记后的 raw 在新读取路径上跳过代理缓存。
   */
  test('should not markRaw object as reactive', () => {
    const a = reactive({ a: 1 })
    const b = reactive({ b: 2 }) as any
    b.a = markRaw(toRaw(a))
    expect(b.a === a).toBe(false)
  })

  /**
   * 响应式外层对象包含 preventExtensions、freeze、seal 三种不可扩展对象。
   * 逐项读取后 isReactive 均为 false，验证这些嵌套目标跳过代理转换。
   */
  test('should not observe non-extensible objects', () => {
    const obj = reactive({
      foo: Object.preventExtensions({ a: 1 }),
      // 密封和冻结同样会让对象不可扩展。
      bar: Object.freeze({ a: 1 }),
      baz: Object.seal({ a: 1 }),
    })
    expect(isReactive(obj.foo)).toBe(false)
    expect(isReactive(obj.bar)).toBe(false)
    expect(isReactive(obj.baz)).toBe(false)
  })

  /**
   * 对象创建时已带 __v_skip: true，再传给 reactive。
   * isReactive 返回 false，验证内部跳过协议在代理创建前生效。
   */
  test('should not observe objects with __v_skip', () => {
    const original = {
      foo: 1,
      __v_skip: true,
    }
    const observed = reactive(original)
    expect(isReactive(observed)).toBe(false)
  })

  /**
   * 响应式对象含 Symbol 自有键，effect 用 hasOwnProperty 查询该键，再删除它。
   * 结果 true→false，验证 Symbol 不经字符串化，且自有属性查询建立可触发的 HAS 依赖。
   */
  test('hasOwnProperty edge case: Symbol values', () => {
    const key = Symbol()
    const obj = reactive({ [key]: 1 }) as {
      /** 以当前 Symbol 为键的可删除属性，供 HAS effect 验证 Symbol 键通知。 */ [key]?: 1
    }
    let dummy
    effect(() => {
      dummy = obj.hasOwnProperty(key)
    })
    expect(dummy).toBe(true)

    delete obj[key]
    expect(dummy).toBe(false)
  })

  /**
   * 响应式对象含 '[object Object]' 属性，effect 用对象参数调用 hasOwnProperty，再用同一参数删除。
   * 结果 true→false，验证查询和删除使用一致的属性键转换及依赖键。
   */
  test('hasOwnProperty edge case: non-string values', () => {
    const key = {}
    const obj = reactive({ '[object Object]': 1 }) as {
      /** 对象参数转成字符串后命中的可删除属性，供查询与删除共享同一依赖键。 */ '[object Object]'?: 1
    }
    let dummy
    effect(() => {
      // @ts-expect-error
      dummy = obj.hasOwnProperty(key)
    })
    expect(dummy).toBe(true)

    // @ts-expect-error
    delete obj[key]
    expect(dummy).toBe(false)
  })

  /**
   * 对普通对象、四种深浅可变/只读代理和 computed 实例调用 isProxy。
   * 四种代理为 true，普通对象和 computed 为 false，验证 API 识别代理标记而非所有响应式容器。
   */
  test('isProxy', () => {
    const foo = {}
    expect(isProxy(foo)).toBe(false)

    const fooRe = reactive(foo)
    expect(isProxy(fooRe)).toBe(true)

    const fooSRe = shallowReactive(foo)
    expect(isProxy(fooSRe)).toBe(true)

    const barRl = readonly(foo)
    expect(isProxy(barRl)).toBe(true)

    const barSRl = shallowReadonly(foo)
    expect(isProxy(barSRl)).toBe(true)

    const c = computed(() => {})
    expect(isProxy(c)).toBe(false)
  })

  /**
   * 向深层 reactive Map 分别写入 shallowReactive 普通对象和 readonly 普通对象。
   * get 后仍保留各自的浅层/只读标记，验证集合 value 写入对这两种输入保留身份。
   */
  test('The results of the shallow and readonly assignments are the same (Map)', () => {
    const map = reactive(new Map())
    map.set('foo', shallowReactive({ a: 2 }))
    expect(isShallow(map.get('foo'))).toBe(true)

    map.set('bar', readonly({ b: 2 }))
    expect(isReadonly(map.get('bar'))).toBe(true)
  })

  /**
   * 向深层 reactive Set 依次加入 shallowReactive 普通对象和 readonly 普通对象，再迭代。
   * 按插入顺序检查浅层/只读标记，验证深集合成员写入与读取保留这些输入模式。
   */
  test('The results of the shallow and readonly assignments are the same (Set)', () => {
    const set = reactive(new Set())
    set.add(shallowReactive({ a: 2 }))
    set.add(readonly({ b: 2 }))
    let count = 0
    for (const i of set) {
      if (count === 0) expect(isShallow(i)).toBe(true)
      else expect(isReadonly(i)).toBe(true)
      count++
    }
  })

  // #11696
  /**
   * 将数值 Ref 实例代理化并建立读取 value 的 effect，再执行 a.value++。
   * 操作不抛错，验证 Ref setter 使用正确 receiver，避免把内部 Dep 当作普通状态代理。
   */
  test('should use correct receiver on set handler for refs', () => {
    const a = reactive(ref(1))
    effect(() => a.value)
    expect(() => {
      a.value++
    }).not.toThrow()
  })

  // #11979
  /**
   * 只有一个 effect 读取 reactive 对象的 x，先确认 targetMap 中存在 x 的 Dep，再 stop。
   * 该 key 对应的 Dep 被删除，验证最后一个订阅者移除后的登记计数清理。
   */
  test('should release property Dep instance if it no longer has subscribers', () => {
    let obj = { x: 1 }
    let a = reactive(obj)
    const e = effect(() => a.x)
    expect(targetMap.get(obj)?.get('x')).toBeTruthy()
    e.effect.stop()
    expect(targetMap.get(obj)?.get('x')).toBeFalsy()
  })

  /**
   * reactive Map 起初为空，computed 读取合法的 undefined 键，再 set(undefined, 1)。
   * 派生值从 undefined→1，验证 undefined 不被当作“缺少 key”而漏掉该键通知。
   */
  test('should trigger reactivity when Map key is undefined', () => {
    const map = reactive(new Map())
    const c = computed(() => map.get(void 0))

    expect(c.value).toBe(void 0)

    map.set(void 0, 1)
    expect(c.value).toBe(1)
  })

  /**
   * 分别检查普通 reactive、readonly(reactive)、对象 Ref.value、readonly 对象 Ref.value 和 shallowReactive。
   * 这些值 isReactive 均为 true，验证可变代理及只读包装后的响应式来源可被识别。
   */
  test('should return true for reactive objects', () => {
    expect(isReactive(reactive({}))).toBe(true)
    expect(isReactive(readonly(reactive({})))).toBe(true)
    expect(isReactive(ref({}).value)).toBe(true)
    expect(isReactive(readonly(ref({})).value)).toBe(true)
    expect(isReactive(shallowReactive({}))).toBe(true)
  })

  /**
   * 检查保存布尔值的 Ref 实例本身和浅 Ref 中的普通对象值。
   * 两者 isReactive 均为 false，验证 Ref 协议与对象代理标记不同，浅 Ref 也不会自动深层转换。
   */
  test('should return false for non-reactive objects', () => {
    expect(isReactive(ref(true))).toBe(false)
    expect(isReactive(shallowRef({}).value)).toBe(false)
  })
})
