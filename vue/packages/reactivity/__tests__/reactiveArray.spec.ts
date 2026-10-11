import { type ComputedRef, computed } from '../src/computed'
import { isReactive, reactive, shallowReactive, toRaw } from '../src/reactive'
import { isRef, ref } from '../src/ref'
import { effect } from '../src/effect'

describe('reactivity/reactive/Array', () => {
  /**
   * 将含 { foo: 1 } 的数组转为 reactive，再读取索引、in 查询和自有键。
   * 断言外层及对象元素被代理、原数组无代理标记，且索引数据与键枚举仍正确。
   */
  test('should make Array reactive', () => {
    const original = [{ foo: 1 }]
    const observed = reactive(original)
    expect(observed).not.toBe(original)
    expect(isReactive(observed)).toBe(true)
    expect(isReactive(original)).toBe(false)
    expect(isReactive(observed[0])).toBe(true)
    // 读取索引中的对象字段。
    expect(observed[0].foo).toBe(1)
    // 查询整数索引是否存在。
    expect(0 in observed).toBe(true)
    // 枚举数组自有索引键。
    expect(Object.keys(observed)).toEqual(['0'])
  })

  /**
   * 对含对象元素的 reactive 数组执行 slice。
   * 副本首项与原数组槽位的 raw 不同、与代理数组读出的首项相同，验证复制保留已包装的元素身份。
   */
  test('cloned reactive Array should point to observed values', () => {
    const original = [{ foo: 1 }]
    const observed = reactive(original)
    const clone = observed.slice()
    expect(isReactive(clone[0])).toBe(true)
    expect(clone[0]).not.toBe(original[0])
    expect(clone[0]).toBe(observed[0])
  })

  /**
   * 代理数组起初含两个对象；经索引替换、delete 和 push 写入同一普通对象。
   * 同时检查代理侧包装值与 raw 侧原引用，验证索引和变异方法的写入转发及深层转换。
   */
  test('observed value should proxy mutations to original (Array)', () => {
    const original: any[] = [{ foo: 1 }, { bar: 2 }]
    const observed = reactive(original)
    // 替换首项。
    const value = { baz: 3 }
    const reactiveValue = reactive(value)
    observed[0] = value
    expect(observed[0]).toBe(reactiveValue)
    expect(original[0]).toBe(value)
    // 删除首项并保留长度。
    delete observed[0]
    expect(observed[0]).toBeUndefined()
    expect(original[0]).toBeUndefined()
    // 通过变异方法追加元素。
    observed.push(value)
    expect(observed[2]).toBe(reactiveValue)
    expect(original[2]).toBe(value)
  })

  /**
   * 向 reactive 数组 push 一个 raw 对象，分别用 raw 和代理读取值调用 indexOf/includes/lastIndexOf。
   * 确认两种参数均命中且 fromIndex 范围限制有效，验证未命中代理参数时的 raw 重试。
   */
  test('Array identity methods should work with raw values', () => {
    const raw = {}
    const arr = reactive([{}, {}])
    arr.push(raw)

    expect(arr.indexOf(raw)).toBe(2)
    expect(arr.indexOf(raw, 3)).toBe(-1)
    expect(arr.includes(raw)).toBe(true)
    expect(arr.includes(raw, 3)).toBe(false)
    expect(arr.lastIndexOf(raw)).toBe(2)
    expect(arr.lastIndexOf(raw, 1)).toBe(-1)

    // 用数组读取出的代理元素查询也应命中。
    const observed = arr[2]
    expect(arr.indexOf(observed)).toBe(2)
    expect(arr.indexOf(observed, 3)).toBe(-1)
    expect(arr.includes(observed)).toBe(true)
    expect(arr.includes(observed, 3)).toBe(false)
    expect(arr.lastIndexOf(observed)).toBe(2)
    expect(arr.lastIndexOf(observed, 1)).toBe(-1)
  })

  /**
   * 原始数组预先保存 reactive 对象，再代理数组并用该代理调用 includes。
   * 首次身份查询成功，验证原始容器已存代理时不会强制改用 raw 参数而失去命中。
   */
  test('Array identity methods should work if raw value contains reactive objects', () => {
    const raw = []
    const obj = reactive({})
    raw.push(obj)
    const arr = reactive(raw)
    expect(arr.includes(obj)).toBe(true)
  })

  /**
   * effect 通过 indexOf 查找 reactive 数组中的 raw 对象，随后 reverse 调换位置。
   * 记录索引从 0→1，验证身份查询订阅数组内容迭代变化。
   */
  test('Array identity methods should be reactive', () => {
    const obj = {}
    const arr = reactive([obj, {}])

    let index: number = -1
    effect(() => {
      index = arr.indexOf(obj)
    })
    expect(index).toBe(0)
    arr.reverse()
    expect(index).toBe(1)
  })

  // 只有代理搜索参数首次未命中时，才以其 raw 形态重试。
  describe('Array identity methods should not be called more than necessary', () => {
    const identityMethods = ['includes', 'indexOf', 'lastIndexOf'] as const

    /**
     * 将数组的 includes、indexOf、lastIndexOf 替换为保留原实现的 spy，记录一次查询是否进行了 raw 重试。
     */
    function instrumentArr(rawTarget: any[]) {
      const mutableTarget = rawTarget as Record<
        (typeof identityMethods)[number],
        any
      >
      identityMethods.forEach(key => {
        const spy = vi.fn(rawTarget[key] as any)
        mutableTarget[key] = spy
      })
    }

    /**
     * 用同一参数依次调用三个身份查询方法，按 includes/indexOf/lastIndexOf 顺序返回查询结果。
     */
    function searchValue(target: any[], ...args: unknown[]) {
      return identityMethods.map(key => (target[key] as any)(...args))
    }

    /**
     * 清除三个查询 spy 并恢复 Array.prototype 方法，避免当前夹具的覆盖方法残留。
     */
    function unInstrumentArr(rawTarget: any[]) {
      identityMethods.forEach(key => {
        ;(rawTarget[key] as any).mockClear()
        // 恢复数组原型上的原生方法。
        rawTarget[key] = Array.prototype[key] as any
      })
    }

    /**
     * 逐一检查三个身份方法的调用次数，使重试策略对所有查询方法都有同样的断言。
     */
    function expectHaveBeenCalledTimes(rawTarget: any[], times: number) {
      identityMethods.forEach(key => {
        expect(rawTarget[key]).toHaveBeenCalledTimes(times)
      })
    }

    /**
     * 给空 reactive 数组的三个身份方法加 spy，用不存在的普通对象查询后恢复原方法。
     * 结果为 false/-1/-1 且每个 spy 只执行一次，验证 raw 参数未命中无需重试。
     */
    test('should be called once with a non-existent raw value', () => {
      const reactiveArr = reactive([])
      instrumentArr(toRaw(reactiveArr))
      const searchResult = searchValue(reactiveArr, {})

      expectHaveBeenCalledTimes(toRaw(reactiveArr), 1)
      expect(searchResult).toStrictEqual([false, -1, -1])

      unInstrumentArr(toRaw(reactiveArr))
    })

    /**
     * 原始数组两次保存同一个 reactive 对象，给身份方法加 spy 后用该代理查询。
     * 结果为 true/0/1 且每个方法只调用一次，验证首次代理身份命中时跳过 raw 重试。
     */
    test('should be called once with an existent reactive value', () => {
      const existReactiveValue = reactive({})
      const reactiveArr = reactive([existReactiveValue, existReactiveValue])

      instrumentArr(toRaw(reactiveArr))
      const searchResult = searchValue(reactiveArr, existReactiveValue)

      expectHaveBeenCalledTimes(toRaw(reactiveArr), 1)
      expect(searchResult).toStrictEqual([true, 0, 1])

      unInstrumentArr(toRaw(reactiveArr))
    })

    /**
     * 空 reactive 数组的身份方法带 spy，用不存在的 reactive 对象查询。
     * 结果为 false/-1/-1 且每个方法调用两次，验证代理参数未命中会以 toRaw 参数重试。
     */
    test('should be called twice with a non-existent reactive value', () => {
      const reactiveArr = reactive([])
      instrumentArr(toRaw(reactiveArr))
      const searchResult = searchValue(reactiveArr, reactive({}))

      expectHaveBeenCalledTimes(toRaw(reactiveArr), 2)
      expect(searchResult).toStrictEqual([false, -1, -1])

      unInstrumentArr(toRaw(reactiveArr))
    })

    /**
     * 原始数组两次保存同一个 raw 对象，给身份方法加 spy 后用其 reactive 代理查询。
     * 第二次 raw 查询命中并得到 true/0/1，每个方法调用两次，验证重试只更换搜索参数身份。
     */
    test('should be called twice with a non-existent reactive value, but the raw value exists', () => {
      const existRaw = {}
      const reactiveArr = reactive([existRaw, existRaw])

      instrumentArr(toRaw(reactiveArr))
      const searchResult = searchValue(reactiveArr, reactive(existRaw))

      expectHaveBeenCalledTimes(toRaw(reactiveArr), 2)
      expect(searchResult).toStrictEqual([true, 0, 1])

      unInstrumentArr(toRaw(reactiveArr))
    })
  })

  /**
   * 只有一个 effect 读取三元素 reactive 数组的 length，随后删除索引 1。
   * spy 次数仍为 1，验证删除索引留下空洞而不通知未变化的 length 依赖。
   */
  test('delete on Array should not trigger length dependency', () => {
    const arr = reactive([1, 2, 3])
    const fn = vi.fn()
    effect(() => {
      fn(arr.length)
    })
    expect(fn).toHaveBeenCalledTimes(1)
    delete arr[1]
    expect(fn).toHaveBeenCalledTimes(1)
  })

  /**
   * effect 用 hasOwnProperty(0) 查询 reactive 数组首项，随后 delete 首项。
   * 查询结果 true→false，验证数字参数转成相同属性键后建立和触发 HAS 依赖。
   */
  test('should track hasOwnProperty call with index', () => {
    const original = [1, 2, 3]
    const observed = reactive(original)

    let dummy
    effect(() => {
      dummy = observed.hasOwnProperty(0)
    })

    expect(dummy).toBe(true)

    delete observed[0]
    expect(dummy).toBe(false)
  })

  /**
   * effect 逐项读取 reactive([1,2,3]) 的 length 与索引，再执行 shift。
   * spy 总次数从 1→2，验证一个变异方法中的多次底层写入被同一 batch 合并。
   */
  test('shift on Array should trigger dependency once', () => {
    const arr = reactive([1, 2, 3])
    const fn = vi.fn()
    effect(() => {
      for (let i = 0; i < arr.length; i++) {
        arr[i]
      }
      fn()
    })
    expect(fn).toHaveBeenCalledTimes(1)
    arr.shift()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  //#6018
  /**
   * Ref 保存单元素数组，effect 先计数，再仅在非空时 slice 并计数第二个 spy；随后 splice(0)。
   * 第一个 spy 共两次、条件分支 spy 仍一次，验证缩短数组批处理只重跑一次并退出非空分支。
   */
  test('edge case: avoid trigger effect in deleteProperty when array length-decrease mutation methods called', () => {
    const arr = ref([1])
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    effect(() => {
      fn1()
      if (arr.value.length > 0) {
        arr.value.slice()
        fn2()
      }
    })
    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledTimes(1)
    arr.value.splice(0)
    expect(fn1).toHaveBeenCalledTimes(2)
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  /**
   * new Array(3) 的索引 1 起初是空洞，effect 只读取代理 length，再给索引 1 赋值。
   * spy 仍只调用一次，验证长度以内的索引写入按 SET 处理，即使该索引原本没有自有属性。
   */
  test('add existing index on Array should not trigger length dependency', () => {
    const array = new Array(3)
    const observed = reactive(array)
    const fn = vi.fn()
    effect(() => {
      fn(observed.length)
    })
    expect(fn).toHaveBeenCalledTimes(1)
    observed[1] = 1
    expect(fn).toHaveBeenCalledTimes(1)
  })

  /**
   * effect 只读长度为 3 的代理数组 length，依次写入 x、-1、NaN 属性。
   * 每次写入后 spy 仍一次，验证这些非整数索引键不会通知 length。
   */
  test('add non-integer prop on Array should not trigger length dependency', () => {
    const array: any[] & {
      /** 数组上的可选字符串属性，用于区分普通属性新增与整数索引引起的长度通知。 */ x?: string
    } = new Array(3)
    const observed = reactive(array)
    const fn = vi.fn()
    effect(() => {
      fn(observed.length)
    })
    expect(fn).toHaveBeenCalledTimes(1)
    observed.x = 'x'
    expect(fn).toHaveBeenCalledTimes(1)
    observed[-1] = 'x'
    expect(fn).toHaveBeenCalledTimes(1)
    observed[NaN] = 'x'
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // #2427
  /**
   * effect 用 for...in 拼接 reactive([1]) 的自有索引键，随后 push 一项。
   * 结果从 '0'→'01'，验证数组 ownKeys 订阅 length，新增长度会重新枚举。
   */
  test('track length on for ... in iteration', () => {
    const array = reactive([1])
    let length = ''
    effect(() => {
      length = ''
      for (const key in array) {
        length += key
      }
    })
    expect(length).toBe('0')
    array.push(1)
    expect(length).toBe('01')
  })

  // #9742
  /**
   * 用户用空 handler Proxy 包住空 reactive 数组，再通过外层 proxy.push(1)。
   * 内外层 length 都为 1，验证套层代理上的变异方法正确转发写入；本例没有 effect 通知断言。
   */
  test('mutation on user proxy of reactive Array', () => {
    const array = reactive<number[]>([])
    const proxy = new Proxy(array, {})
    proxy.push(1)
    expect(array).toHaveLength(1)
    expect(proxy).toHaveLength(1)
  })

  describe('Array methods w/ refs', () => {
    let original: any[]
    beforeEach(() => {
      original = reactive([1, ref(2)])
    })

    /**
     * 夹具 reactive([1, ref(2)]) 与 [3, ref(4)] 做 concat。
     * 结果索引 1/3 都仍是 Ref，验证数组复制不会按普通对象属性规则自动解包整数索引 Ref。
     */
    test('read only copy methods', () => {
      const raw = original.concat([3, ref(4)])
      expect(isRef(raw[1])).toBe(true)
      expect(isRef(raw[3])).toBe(true)
    })

    /**
     * 夹具 reactive([1, ref(2)]) 执行 copyWithin(0,1,2)，随后读取结果的 raw 数组。
     * 两个槽位都保存 Ref，验证复制和写入仍保留 Ref 容器，而非保存其 value。
     */
    test('read + write mutating methods', () => {
      const res = original.copyWithin(0, 1, 2)
      const raw = toRaw(res)
      expect(isRef(raw[0])).toBe(true)
      expect(isRef(raw[1])).toBe(true)
    })

    /**
     * 读取夹具数组索引 1 中的 Ref，再用 indexOf 查找该 Ref。
     * 读取值等于 raw 槽位容器且索引为 1，验证整数索引不解包 Ref，身份查询仍可命中。
     */
    test('read + identity', () => {
      const ref = original[1]
      expect(ref).toBe(toRaw(original)[1])
      expect(original.indexOf(ref)).toBe(1)
    })
  })

  describe('Array subclasses', () => {
    /**
     * 数组子类夹具，以参数记录字段验证代理实际调用子类覆盖的 push 与 indexOf。
     */
    class SubArray<T> extends Array<T> {
      /**
       * 记录最近一次 push 接收到的元素，验证覆盖方法及 this 对象没有被插桩绕过。
       */
      lastPushed: undefined | T
      /**
       * 记录最近一次 indexOf 接收到的搜索元素，验证代理调用保持原参数。
       */
      lastSearched: undefined | T

      /**
       * 记录被追加的元素，再转发给原生 push，供原实例和代理调用共同验证子类方法。
       */
      push(item: T) {
        this.lastPushed = item
        return super.push(item)
      }

      /**
       * 记录搜索元素，再保留 fromIndex 转发给原生 indexOf，返回实际命中索引。
       */
      indexOf(searchElement: T, fromIndex?: number | undefined): number {
        this.lastSearched = searchElement
        return super.indexOf(searchElement, fromIndex)
      }
    }

    /**
     * 数组子类 push 会记录 lastPushed；分别经原实例和 reactive 代理 push 7/9。
     * 记录值分别为 7/9，验证变异插桩调用实际子类方法并保持正确的 this。
     */
    test('calls correct mutation method on Array subclass', () => {
      const subArray = new SubArray(4, 5, 6)
      const observed = reactive(subArray)

      subArray.push(7)
      expect(subArray.lastPushed).toBe(7)
      observed.push(9)
      expect(observed.lastPushed).toBe(9)
    })

    /**
     * 数组子类 indexOf 会记录 lastSearched；分别经原实例查 4、代理查 6。
     * 结果索引 0/2、记录参数 4/6，验证身份搜索插桩保留子类覆盖方法及其副作用。
     */
    test('calls correct identity-sensitive method on Array subclass', () => {
      const subArray = new SubArray(4, 5, 6)
      const observed = reactive(subArray)
      let index

      index = subArray.indexOf(4)
      expect(index).toBe(0)
      expect(subArray.lastSearched).toBe(4)

      index = observed.indexOf(6)
      expect(index).toBe(2)
      expect(observed.lastSearched).toBe(6)
    })
  })

  describe('Optimized array methods:', () => {
    /**
     * computed 用 for...of 对浅数值数组和深对象数组求平方和，再分别替换索引及修改对象字段。
     * 结果 30→21、5→10，验证迭代依赖响应索引变动，深层元素读取另行收集字段依赖。
     */
    test('iterator', () => {
      const shallow = shallowReactive([1, 2, 3, 4])
      let result = computed(() => {
        let sum = 0
        for (let x of shallow) {
          sum += x ** 2
        }
        return sum
      })
      expect(result.value).toBe(30)

      shallow[2] = 0
      expect(result.value).toBe(21)

      const deep = reactive([{ val: 1 }, { val: 2 }])
      result = computed(() => {
        let sum = 0
        for (let x of deep) {
          sum += x.val ** 2
        }
        return sum
      })
      expect(result.value).toBe(5)

      deep[1].val = 3
      expect(result.value).toBe(10)
    })

    /**
     * concat 合并浅数组、深数组、普通数组与单值，computed 缓存拼接结果。
     * 检查不同输入元素的代理身份，浅/深数组 shift/pop 会更新结果，普通数组 pop 不使缓存失效。
     */
    test('concat', () => {
      const a1 = shallowReactive([1, { val: 2 }])
      const a2 = reactive([{ val: 3 }])
      const a3 = [4, 5]

      let result = computed(() => a1.concat(a2, a3, 6, { val: 7 }))
      expect(result.value).toStrictEqual([
        1,
        { val: 2 },
        { val: 3 },
        4,
        5,
        6,
        { val: 7 },
      ])
      expect(isReactive(result.value[1])).toBe(false)
      expect(isReactive(result.value[2])).toBe(true)
      expect(isReactive(result.value[6])).toBe(false)

      a1.shift()
      expect(result.value).toStrictEqual([
        { val: 2 },
        { val: 3 },
        4,
        5,
        6,
        { val: 7 },
      ])

      a2.pop()
      expect(result.value).toStrictEqual([{ val: 2 }, 4, 5, 6, { val: 7 }])

      a3.pop()
      expect(result.value).toStrictEqual([{ val: 2 }, 4, 5, 6, { val: 7 }])
    })

    /**
     * computed 收集浅数组和深对象数组的 entries，再替换浅索引、pop 深数组。
     * 索引保持数字、深层 value 是代理，结果随相应结构操作变化，验证 entries 的迭代追踪与值包装。
     */
    test('entries', () => {
      const shallow = shallowReactive([0, 1])
      const result1 = computed(() => Array.from(shallow.entries()))
      expect(result1.value).toStrictEqual([
        [0, 0],
        [1, 1],
      ])

      shallow[1] = 10
      expect(result1.value).toStrictEqual([
        [0, 0],
        [1, 10],
      ])

      const deep = reactive([{ val: 0 }, { val: 1 }])
      const result2 = computed(() => Array.from(deep.entries()))
      expect(result2.value).toStrictEqual([
        [0, { val: 0 }],
        [1, { val: 1 }],
      ])
      expect(isReactive(result2.value[0][1])).toBe(true)

      deep.pop()
      expect(Array.from(result2.value)).toStrictEqual([[0, { val: 0 }]])
    })

    /**
     * computed 用 every(x<5) 检查浅数组，用 every(x.val<5) 检查深对象数组。
     * 浅数组 pop 和深对象字段修改分别使 false→true，验证容器变化及实际读取的深字段依赖。
     */
    test('every', () => {
      const shallow = shallowReactive([1, 2, 5])
      let result = computed(() => shallow.every(x => x < 5))
      expect(result.value).toBe(false)

      shallow.pop()
      expect(result.value).toBe(true)

      const deep = reactive([{ val: 1 }, { val: 5 }])
      result = computed(() => deep.every(x => x.val < 5))
      expect(result.value).toBe(false)

      deep[1].val = 2
      expect(result.value).toBe(true)
    })

    /**
     * computed 用 filter 筛选浅数值数组和深对象数组，再替换浅索引和修改深元素字段。
     * 结果集合随条件变化，深数组返回元素 isReactive 为 true，验证筛选依赖和返回元素包装。
     */
    test('filter', () => {
      const shallow = shallowReactive([1, 2, 3, 4])
      const result1 = computed(() => shallow.filter(x => x < 3))
      expect(result1.value).toStrictEqual([1, 2])

      shallow[2] = 0
      expect(result1.value).toStrictEqual([1, 2, 0])

      const deep = reactive([{ val: 1 }, { val: 2 }])
      const result2 = computed(() => deep.filter(x => x.val < 2))
      expect(result2.value).toStrictEqual([{ val: 1 }])
      expect(isReactive(result2.value[0])).toBe(true)

      deep[1].val = 0
      expect(result2.value).toStrictEqual([{ val: 1 }, { val: 0 }])
    })

    /**
     * 对浅、深对象数组同时建立 find/findLast/findIndex/findLastIndex 的 computed。
     * 浅元素字段修改不会使缓存重算，pop 才得到未命中；深字段修改立即得到 undefined/-1，验证深浅依赖差异。
     */
    test('find and co.', () => {
      const shallow = shallowReactive([{ val: 1 }, { val: 2 }])
      let find = computed(() => shallow.find(x => x.val === 2))
      // @ts-expect-error tests are not limited to es2016
      let findLast = computed(() => shallow.findLast(x => x.val === 2))
      let findIndex = computed(() => shallow.findIndex(x => x.val === 2))
      let findLastIndex = computed(() =>
        // @ts-expect-error tests are not limited to es2016
        shallow.findLastIndex(x => x.val === 2),
      )

      expect(find.value).toBe(shallow[1])
      expect(isReactive(find.value)).toBe(false)
      expect(findLast.value).toBe(shallow[1])
      expect(isReactive(findLast.value)).toBe(false)
      expect(findIndex.value).toBe(1)
      expect(findLastIndex.value).toBe(1)

      shallow[1].val = 0

      expect(find.value).toBe(shallow[1])
      expect(findLast.value).toBe(shallow[1])
      expect(findIndex.value).toBe(1)
      expect(findLastIndex.value).toBe(1)

      shallow.pop()

      expect(find.value).toBe(undefined)
      expect(findLast.value).toBe(undefined)
      expect(findIndex.value).toBe(-1)
      expect(findLastIndex.value).toBe(-1)

      const deep = reactive([{ val: 1 }, { val: 2 }])
      find = computed(() => deep.find(x => x.val === 2))
      // @ts-expect-error tests are not limited to es2016
      findLast = computed(() => deep.findLast(x => x.val === 2))
      findIndex = computed(() => deep.findIndex(x => x.val === 2))
      // @ts-expect-error tests are not limited to es2016
      findLastIndex = computed(() => deep.findLastIndex(x => x.val === 2))

      expect(find.value).toBe(deep[1])
      expect(isReactive(find.value)).toBe(true)
      expect(findLast.value).toBe(deep[1])
      expect(isReactive(findLast.value)).toBe(true)
      expect(findIndex.value).toBe(1)
      expect(findLastIndex.value).toBe(1)

      deep[1].val = 0

      expect(find.value).toBe(undefined)
      expect(findLast.value).toBe(undefined)
      expect(findIndex.value).toBe(-1)
      expect(findLastIndex.value).toBe(-1)
    })

    /**
     * computed 经 forEach 累加浅数值数组和深对象数组的平方和。
     * 浅索引替换得到 30→21、深字段修改得到 5→10，验证遍历依赖与深字段读取；本例不检查回调数组参数。
     */
    test('forEach', () => {
      const shallow = shallowReactive([1, 2, 3, 4])
      let result = computed(() => {
        let sum = 0
        shallow.forEach(x => (sum += x ** 2))
        return sum
      })
      expect(result.value).toBe(30)

      shallow[2] = 0
      expect(result.value).toBe(21)

      const deep = reactive([{ val: 1 }, { val: 2 }])
      result = computed(() => {
        let sum = 0
        deep.forEach(x => (sum += x.val ** 2))
        return sum
      })
      expect(result.value).toBe(5)

      deep[1].val = 3
      expect(result.value).toBe(10)
    })

    /**
     * 数组元素自定义 toString 读取 val，computed 调用浅数组 join('+') 和深数组 join()。
     * 浅字段修改保留缓存、pop 更新结构；深字段修改更新字符串，验证字符串转换中的属性追踪受深浅模式影响。
     */
    test('join', () => {
      /**
       * 返回当前元素 val，供 join 隐式转换时读取字段并比较深浅依赖收集。
       */
      function toString(this: {
        /** join 元素转换读取的数值字段，用于观察浅层变更不失效而深层变更会失效。 */ val: number
      }) {
        return this.val
      }
      const shallow = shallowReactive([
        { val: 1, toString },
        { val: 2, toString },
      ])
      let result = computed(() => shallow.join('+'))
      expect(result.value).toBe('1+2')

      shallow[1].val = 23
      expect(result.value).toBe('1+2')

      shallow.pop()
      expect(result.value).toBe('1')

      const deep = reactive([
        { val: 1, toString },
        { val: 2, toString },
      ])
      result = computed(() => deep.join())
      expect(result.value).toBe('1,2')

      deep[1].val = 23
      expect(result.value).toBe('1,23')
    })

    /**
     * computed 用 map 计算浅数值数组与深对象数组的平方，再分别替换浅索引和修改深 val。
     * 输出 [1,4,9,16]→[1,4,0,16]、[1,4]→[1,9]，验证 map 的迭代与回调字段依赖。
     */
    test('map', () => {
      const shallow = shallowReactive([1, 2, 3, 4])
      let result = computed(() => shallow.map(x => x ** 2))
      expect(result.value).toStrictEqual([1, 4, 9, 16])

      shallow[2] = 0
      expect(result.value).toStrictEqual([1, 4, 0, 16])

      const deep = reactive([{ val: 1 }, { val: 2 }])
      result = computed(() => deep.map(x => x.val ** 2))
      expect(result.value).toStrictEqual([1, 4])

      deep[1].val = 3
      expect(result.value).toStrictEqual([1, 9])
    })

    /**
     * 分别对浅、深对象数组执行 reduce/reduceRight，覆盖显式 undefined 初值与无初值路径。
     * 浅字段修改保留缓存，删除后返回唯一原元素；深字段修改更新结果，maxBy 断言累加器和当前元素均为代理。
     */
    test('reduce left and right', () => {
      /**
       * 在 val 后追加连字符，供无初值归并把第一个对象累加器隐式转换为字符串。
       */
      function toString(this: any) {
        return this.val + '-'
      }
      const shallow = shallowReactive([
        { val: 1, toString },
        { val: 2, toString },
      ] as any[])

      expect(shallow.reduce((acc, x) => acc + '' + x.val, undefined)).toBe(
        'undefined12',
      )

      let left = computed(() => shallow.reduce((acc, x) => acc + '' + x.val))
      let right = computed(() =>
        shallow.reduceRight((acc, x) => acc + '' + x.val),
      )
      expect(left.value).toBe('1-2')
      expect(right.value).toBe('2-1')

      shallow[1].val = 23
      expect(left.value).toBe('1-2')
      expect(right.value).toBe('2-1')

      shallow.pop()
      expect(left.value).toBe(shallow[0])
      expect(right.value).toBe(shallow[0])

      let deep = reactive([{ val: 1 }, { val: 2 }])
      left = computed(() => deep.reduce((acc, x) => acc + x.val, '0'))
      right = computed(() => deep.reduceRight((acc, x) => acc + x.val, '3'))
      expect(left.value).toBe('012')
      expect(right.value).toBe('321')

      deep[1].val = 23
      expect(left.value).toBe('0123')
      expect(right.value).toBe('3231')

      deep = reactive([{ val: 1 }, { val: 2 }])
      /**
       * 断言两个归并参数均为响应式对象，再返回 val 较大的对象，验证无初值深数组的累加器包装。
       */
      const maxBy = (prev: any, cur: any) => {
        expect(isReactive(prev)).toBe(true)
        expect(isReactive(cur)).toBe(true)
        return prev.val > cur.val ? prev : cur
      }
      left = computed(() => deep.reduce(maxBy))
      right = computed(() => deep.reduceRight(maxBy))
      expect(left.value).toMatchObject({ val: 2 })
      expect(right.value).toMatchObject({ val: 2 })

      deep[0].val = 23
      expect(left.value).toMatchObject({ val: 23 })
      expect(right.value).toMatchObject({ val: 23 })

      deep[1].val = 24
      expect(left.value).toMatchObject({ val: 24 })
      expect(right.value).toMatchObject({ val: 24 })
    })

    /**
     * 深 reactive 数组只有一个对象，不提供 reduce/reduceRight 初值，回调无需执行。
     * 两种归并仍返回代理对象，字段变化可从返回值读到，验证无回调路径也包装最终元素。
     */
    test('reduce left and right with single deep reactive element and no initial value', () => {
      const deep = reactive([{ val: 1 }])
      const left = computed(() => deep.reduce(prev => prev))
      const right = computed(() => deep.reduceRight(prev => prev))

      expect(isReactive(left.value)).toBe(true)
      expect(isReactive(right.value)).toBe(true)
      expect(left.value).toMatchObject({ val: 1 })
      expect(right.value).toMatchObject({ val: 1 })

      deep[0].val = 2
      expect(left.value).toMatchObject({ val: 2 })
      expect(right.value).toMatchObject({ val: 2 })
    })

    /**
     * computed 用 some(x>4) 检查浅数组，用 some(x.val>4) 检查深对象数组。
     * 浅数组 pop 和深字段修改分别使 true→false，验证相应结构及字段读取使缓存失效。
     */
    test('some', () => {
      const shallow = shallowReactive([1, 2, 5])
      let result = computed(() => shallow.some(x => x > 4))
      expect(result.value).toBe(true)

      shallow.pop()
      expect(result.value).toBe(false)

      const deep = reactive([{ val: 1 }, { val: 5 }])
      result = computed(() => deep.some(x => x.val > 4))
      expect(result.value).toBe(true)

      deep[1].val = 2
      expect(result.value).toBe(false)
    })

    /**
     * 仅在运行环境提供 toReversed 时执行：computed 反向复制含普通对象的 reactive 数组。
     * 首个结果元素被代理，splice 替换后得到 [2,1]，验证新复制数组的迭代依赖与深层元素包装。
     */
    // @ts-expect-error tests are not limited to es2016
    test.skipIf(!Array.prototype.toReversed)('toReversed', () => {
      const array = reactive([1, { val: 2 }])
      const result = computed(() => (array as any).toReversed())
      expect(result.value).toStrictEqual([{ val: 2 }, 1])
      expect(isReactive(result.value[0])).toBe(true)

      array.splice(1, 1, 2)
      expect(result.value).toStrictEqual([2, 1])
    })

    /**
     * 仅在运行环境提供 toSorted 时执行：检查默认数值排序及按 val 排序的浅、深对象数组。
     * 浅字段修改只改变缓存中的对象值而不重排，结构 pop 才重排；深字段修改会重排，验证 comparator 的字段追踪。
     */
    // @ts-expect-error tests are not limited to es2016
    test.skipIf(!Array.prototype.toSorted)('toSorted', () => {
      // 不提供比较回调，检查原生默认排序。
      // @ts-expect-error
      expect(shallowReactive([2, 1, 3]).toSorted()).toStrictEqual([1, 2, 3])

      const shallow = shallowReactive([{ val: 2 }, { val: 1 }, { val: 3 }])
      let result: ComputedRef<
        {
          /** 排序回调读取的数值字段，供浅数组结果缓存与重新排序的差异断言。 */ val: number
        }[]
      >
      // @ts-expect-error
      result = computed(() => shallow.toSorted((a, b) => a.val - b.val))
      expect(result.value.map(x => x.val)).toStrictEqual([1, 2, 3])
      expect(isReactive(result.value[0])).toBe(false)

      shallow[0].val = 4
      expect(result.value.map(x => x.val)).toStrictEqual([1, 4, 3])

      shallow.pop()
      expect(result.value.map(x => x.val)).toStrictEqual([1, 4])

      const deep = reactive([{ val: 2 }, { val: 1 }, { val: 3 }])
      // @ts-expect-error
      result = computed(() => deep.toSorted((a, b) => a.val - b.val))
      expect(result.value.map(x => x.val)).toStrictEqual([1, 2, 3])
      expect(isReactive(result.value[0])).toBe(true)

      deep[0].val = 4
      expect(result.value.map(x => x.val)).toStrictEqual([1, 3, 4])
    })

    /**
     * 仅在运行环境提供 toSpliced 时执行：computed 对 reactive([1,2,3]) 复制并替换中间项为 -2。
     * 源数组首项从 1→0 后结果 [1,-2,3]→[0,-2,3]，验证复制方法订阅源内容而不靠修改源数组实现。
     */
    // @ts-expect-error tests are not limited to es2016
    test.skipIf(!Array.prototype.toSpliced)('toSpliced', () => {
      const array = reactive([1, 2, 3])
      // @ts-expect-error
      const result = computed(() => array.toSpliced(1, 1, -2))
      expect(result.value).toStrictEqual([1, -2, 3])

      array[0] = 0
      expect(result.value).toStrictEqual([0, -2, 3])
    })

    /**
     * computed 用 Array.from(shallow.values()) 收集浅对象数组，再 pop；另读取深对象数组 values 的首项。
     * 浅成员保持原始对象并随 pop 缩短，深成员被代理，验证 values 的模式包装与迭代通知。
     */
    test('values', () => {
      const shallow = shallowReactive([{ val: 1 }, { val: 2 }])
      const result = computed(() => Array.from(shallow.values()))
      expect(result.value).toStrictEqual([{ val: 1 }, { val: 2 }])
      expect(isReactive(result.value[0])).toBe(false)

      shallow.pop()
      expect(result.value).toStrictEqual([{ val: 1 }])

      const deep = reactive([{ val: 1 }, { val: 2 }])
      const firstItem = Array.from(deep.values())[0]
      expect(isReactive(firstItem)).toBe(true)
    })

    /**
     * 数组子类覆盖多个原生同名方法，代理以 foo/bar/baz 三个自定义参数逐一调用。
     * 断言参数、布尔/索引/对象结果及对象代理身份；另一子类 find 的 computed 随深元素字段修改更新，验证覆盖方法仍通过代理追踪。
     */
    test('extend methods', () => {
      /**
       * 覆盖九个原生同名数组方法的夹具，以三参数协议验证代理保留用户实现及返回值包装。
       */
      class Collection extends Array {
        // @ts-expect-error
        /**
         * 确认三个自定义参数原样传入，再检查所有成员 id 是否等于第一个参数。
         */
        every(foo: any, bar: any, baz: any) {
          expect(foo).toBe('foo')
          expect(bar).toBe('bar')
          expect(baz).toBe('baz')
          return super.every(obj => obj.id === foo)
        }

        // @ts-expect-error
        /**
         * 确认三参数协议，再按第一个参数筛选成员，供测试检查数组结果和元素身份。
         */
        filter(foo: any, bar: any, baz: any) {
          expect(foo).toBe('foo')
          expect(bar).toBe('bar')
          expect(baz).toBe('baz')
          return super.filter(obj => obj.id === foo)
        }

        // @ts-expect-error
        /**
         * 确认三参数协议，再返回 id 匹配第一个参数的成员，供测试检查对象返回值被代理。
         */
        find(foo: any, bar: any, baz: any) {
          expect(foo).toBe('foo')
          expect(bar).toBe('bar')
          expect(baz).toBe('baz')
          return super.find(obj => obj.id === foo)
        }

        // @ts-expect-error
        /**
         * 确认三参数协议，再查找 id 匹配第二个参数的首个索引。
         */
        findIndex(foo: any, bar: any, baz: any) {
          expect(foo).toBe('foo')
          expect(bar).toBe('bar')
          expect(baz).toBe('baz')
          return super.findIndex(obj => obj.id === bar)
        }

        /**
         * 确认三参数协议，再用原生 findLast 查找 id 匹配第二个参数的末个成员。
         */
        findLast(foo: any, bar: any, baz: any) {
          expect(foo).toBe('foo')
          expect(bar).toBe('bar')
          expect(baz).toBe('baz')
          // @ts-expect-error our code is limited to es2016 but user code is not
          return super.findLast(obj => obj.id === bar)
        }

        /**
         * 确认三参数协议并转发给 findIndex；本夹具验证覆盖方法的实际返回值，不实现原生末项查找语义。
         */
        findLastIndex(foo: any, bar: any, baz: any) {
          expect(foo).toBe('foo')
          expect(bar).toBe('bar')
          expect(baz).toBe('baz')
          return super.findIndex(obj => obj.id === bar)
        }

        // @ts-expect-error
        /**
         * 只断言三参数原样到达覆盖方法并返回 undefined，验证代理不会强制将参数解释为原生回调。
         */
        forEach(foo: any, bar: any, baz: any) {
          expect(foo).toBe('foo')
          expect(bar).toBe('bar')
          expect(baz).toBe('baz')
        }

        // @ts-expect-error
        /**
         * 确认三参数协议，再把成员映射成 value 字段，供测试检查自定义映射结果。
         */
        map(foo: any, bar: any, baz: any) {
          expect(foo).toBe('foo')
          expect(bar).toBe('bar')
          expect(baz).toBe('baz')
          return super.map(obj => obj.value)
        }

        // @ts-expect-error
        /**
         * 确认三参数协议，再检查是否存在 id 等于第三个参数的成员。
         */
        some(foo: any, bar: any, baz: any) {
          expect(foo).toBe('foo')
          expect(bar).toBe('bar')
          expect(baz).toBe('baz')
          return super.some(obj => obj.id === baz)
        }
      }

      const state = reactive({
        things: new Collection(),
      })

      const foo = { id: 'foo', value: '1' }
      const bar = { id: 'bar', value: '2' }
      const baz = { id: 'baz', value: '3' }
      state.things.push(foo)
      state.things.push(bar)
      state.things.push(baz)

      expect(state.things.every('foo', 'bar', 'baz')).toBe(false)
      expect(state.things.filter('foo', 'bar', 'baz')).toEqual([foo])

      const _foo = state.things.find('foo', 'bar', 'baz')
      expect(isReactive(_foo)).toBe(true)
      expect(foo).toStrictEqual(_foo)

      expect(state.things.findIndex('foo', 'bar', 'baz')).toBe(1)

      const _bar = state.things.findLast('foo', 'bar', 'baz')
      expect(isReactive(_bar)).toBe(true)
      expect(bar).toStrictEqual(_bar)

      expect(state.things.findLastIndex('foo', 'bar', 'baz')).toBe(1)
      expect(state.things.forEach('foo', 'bar', 'baz')).toBeUndefined()
      expect(state.things.map('foo', 'bar', 'baz')).toEqual(['1', '2', '3'])
      expect(state.things.some('foo', 'bar', 'baz')).toBe(true)

      {
        /**
         * 只覆盖 find 的数组子类夹具，验证经自定义转发方法读取的深层字段仍能建立 computed 依赖。
         */
        class Collection extends Array {
          /**
           * 把匹配回调转发给原生 find，保留通过代理读取元素时建立的字段依赖。
           */
          find(matcher: any) {
            return super.find(matcher)
          }
        }

        const state = reactive({
          // @ts-expect-error
          things: new Collection({ foo: '' }),
        })

        const bar = computed(() => {
          return state.things.find((obj: any) => obj.foo === 'bar')
        })
        bar.value
        state.things[0].foo = 'bar'

        expect(bar.value).toEqual({ foo: 'bar' })
      }
    })
  })
})
