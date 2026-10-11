import { effect, isReactive, reactive, toRaw } from '../../src'

describe('reactivity/collections', () => {
  /**
   * 创建集合代理，再将原实例指定方法覆盖为 spy，返回代理与计数器，供断言实际底层方法只被转发调用一次。
   */
  function coverCollectionFn(collection: Map<any, any>, fnName: string) {
    const spy = vi.fn()
    let proxy = reactive(collection)
    ;(collection as any)[fnName] = spy
    return [proxy as any, spy]
  }

  describe('Map', () => {
    /**
     * 把空 Map 转为 reactive，再检查两侧的 instanceof 与代理标记。
     * 代理仍是 Map 实例且具响应式标记，验证集合代理保留原型继承关系。
     */
    test('instanceof', () => {
      const original = new Map()
      const observed = reactive(original)
      expect(isReactive(observed)).toBe(true)
      expect(original).toBeInstanceOf(Map)
      expect(observed).toBeInstanceOf(Map)
    })

    /**
     * effect 读取空 reactive Map 的字符串键，随后新增该键、改值、删除。
     * 记录 undefined→value→value2→undefined，验证同一键的 ADD/SET/DELETE 通知。
     */
    it('should observe mutations', () => {
      let dummy
      const map = reactive(new Map())
      effect(() => {
        dummy = map.get('key')
      })

      expect(dummy).toBe(undefined)
      map.set('key', 'value')
      expect(dummy).toBe('value')
      map.set('key', 'value2')
      expect(dummy).toBe('value2')
      map.delete('key')
      expect(dummy).toBe(undefined)
    })

    /**
     * reactive Map 起初为空，effect 用 reactive 对象键 get，再用相同代理键 set/delete。
     * 记录 undefined→对象代理→undefined，验证代理键读写兼容及对象值包装，不把此场景扩大为双身份合并。
     */
    it('should observe mutations with observed value as key', () => {
      let dummy
      const key = reactive({})
      const value = reactive({})
      const map = reactive(new Map())
      effect(() => {
        dummy = map.get(key)
      })

      expect(dummy).toBe(undefined)
      map.set(key, value)
      expect(dummy).toBe(value)
      map.delete(key)
      expect(dummy).toBe(undefined)
    })

    /**
     * effect 读取空 reactive Map 的 size，依次新增两键、删除一键、clear。
     * 记录 0→2→1→0，验证结构操作通知 size 所订阅的 ITERATE_KEY。
     */
    it('should observe size mutations', () => {
      let dummy
      const map = reactive(new Map())
      effect(() => (dummy = map.size))

      expect(dummy).toBe(0)
      map.set('key1', 'value')
      map.set('key2', 'value2')
      expect(dummy).toBe(2)
      map.delete('key1')
      expect(dummy).toBe(1)
      map.clear()
      expect(dummy).toBe(0)
    })

    /**
     * effect 默认迭代 reactive Map 并累计数值，依次新增两键、修改已有键、删除、clear。
     * 总和 0→3→5→6→2→0，验证键值迭代也通知已有值变更，区别于 keys 迭代依赖。
     */
    it('should observe for of iteration', () => {
      let dummy
      const map = reactive(new Map())
      effect(() => {
        dummy = 0
        for (let [key, num] of map) {
          key
          dummy += num
        }
      })

      expect(dummy).toBe(0)
      map.set('key1', 3)
      expect(dummy).toBe(3)
      map.set('key2', 2)
      expect(dummy).toBe(5)
      // #709：键值迭代也应在已有键的值变化后更新。
      map.set('key1', 4)
      expect(dummy).toBe(6)
      map.delete('key1')
      expect(dummy).toBe(2)
      map.clear()
      expect(dummy).toBe(0)
    })

    /**
     * effect 经 forEach 累计 reactive Map 的值，依次新增两键、改已有值、删除和 clear。
     * 总和 0→3→5→6→2→0，验证 forEach 订阅键值迭代依赖而非仅键集合。
     */
    it('should observe forEach iteration', () => {
      let dummy: any
      const map = reactive(new Map())
      effect(() => {
        dummy = 0
        map.forEach((num: any) => (dummy += num))
      })

      expect(dummy).toBe(0)
      map.set('key1', 3)
      expect(dummy).toBe(3)
      map.set('key2', 2)
      expect(dummy).toBe(5)
      // #709：键值迭代也应在已有键的值变化后更新。
      map.set('key1', 4)
      expect(dummy).toBe(6)
      map.delete('key1')
      expect(dummy).toBe(2)
      map.clear()
      expect(dummy).toBe(0)
    })

    /**
     * effect 用 keys 累计空 reactive Map 的数字键，随后新增 3/2、删除 3、clear。
     * 总和 0→3→5→2→0，验证键集合结构操作通知 MAP_KEY_ITERATE_KEY；已有键改值由另一用例检查。
     */
    it('should observe keys iteration', () => {
      let dummy
      const map = reactive(new Map())
      effect(() => {
        dummy = 0
        for (let key of map.keys()) {
          dummy += key
        }
      })

      expect(dummy).toBe(0)
      map.set(3, 3)
      expect(dummy).toBe(3)
      map.set(2, 2)
      expect(dummy).toBe(5)
      map.delete(3)
      expect(dummy).toBe(2)
      map.clear()
      expect(dummy).toBe(0)
    })

    /**
     * effect 用 values 累计空 reactive Map 的值，随后新增、改已有值、删除及 clear。
     * 总和 0→3→5→6→2→0，验证 values 的 ITERATE_KEY 包含有效 SET 通知。
     */
    it('should observe values iteration', () => {
      let dummy
      const map = reactive(new Map())
      effect(() => {
        dummy = 0
        for (let num of map.values()) {
          dummy += num
        }
      })

      expect(dummy).toBe(0)
      map.set('key1', 3)
      expect(dummy).toBe(3)
      map.set('key2', 2)
      expect(dummy).toBe(5)
      // #709：键值迭代也应在已有键的值变化后更新。
      map.set('key1', 4)
      expect(dummy).toBe(6)
      map.delete('key1')
      expect(dummy).toBe(2)
      map.clear()
      expect(dummy).toBe(0)
    })

    /**
     * effect 用 entries 同时拼接键并求值总和，随后新增、改已有值、删除及 clear。
     * 改值只改变总和而键串不变，删除/clear 同时改变二者，验证 entries 的键值迭代依赖。
     */
    it('should observe entries iteration', () => {
      let dummy
      let dummy2
      const map = reactive(new Map())
      effect(() => {
        dummy = ''
        dummy2 = 0
        for (let [key, num] of map.entries()) {
          dummy += key
          dummy2 += num
        }
      })

      expect(dummy).toBe('')
      expect(dummy2).toBe(0)
      map.set('key1', 3)
      expect(dummy).toBe('key1')
      expect(dummy2).toBe(3)
      map.set('key2', 2)
      expect(dummy).toBe('key1key2')
      expect(dummy2).toBe(5)
      // #709：键值迭代也应在已有键的值变化后更新。
      map.set('key1', 4)
      expect(dummy).toBe('key1key2')
      expect(dummy2).toBe(6)
      map.delete('key1')
      expect(dummy).toBe('key2')
      expect(dummy2).toBe(2)
      map.clear()
      expect(dummy).toBe('')
      expect(dummy2).toBe(0)
    })

    /**
     * effect 读取 reactive Map 的 key，先 set 为 3 再 clear 非空集合。
     * 记录 undefined→3→undefined，验证 CLEAR 会通知已建立的该键 Dep。
     */
    it('should be triggered by clearing', () => {
      let dummy
      const map = reactive(new Map())
      effect(() => (dummy = map.get('key')))

      expect(dummy).toBe(undefined)
      map.set('key', 3)
      expect(dummy).toBe(3)
      map.clear()
      expect(dummy).toBe(undefined)
    })

    /**
     * effect 读取 reactive Map 上不存在的 customProp，再向该普通属性赋字符串。
     * 记录仍 undefined，验证集合 handler 不为额外对象属性建立追踪；本例不检查直接读回值。
     */
    it('should not observe custom property mutations', () => {
      let dummy
      const map: any = reactive(new Map())
      effect(() => (dummy = map.customProp))

      expect(dummy).toBe(undefined)
      map.customProp = 'Hello World'
      expect(dummy).toBe(undefined)
    })

    /**
     * spy effect 读取空 Map 的 key，依次新增 undefined、改字符串、同值重设、删除、重复删除、清空空 Map。
     * 新增 undefined 仍通知一次，随后仅有效改值/删除增加次数，总计 4，验证成员存在性与值变化分别判定。
     */
    it('should not observe non value changing mutations', () => {
      let dummy
      const map = reactive(new Map())
      const mapSpy = vi.fn(() => (dummy = map.get('key')))
      effect(mapSpy)

      expect(dummy).toBe(undefined)
      expect(mapSpy).toHaveBeenCalledTimes(1)
      map.set('key', undefined)
      expect(dummy).toBe(undefined)
      expect(mapSpy).toHaveBeenCalledTimes(2)
      map.set('key', 'value')
      expect(dummy).toBe('value')
      expect(mapSpy).toHaveBeenCalledTimes(3)
      map.set('key', 'value')
      expect(dummy).toBe('value')
      expect(mapSpy).toHaveBeenCalledTimes(3)
      map.delete('key')
      expect(dummy).toBe(undefined)
      expect(mapSpy).toHaveBeenCalledTimes(4)
      map.delete('key')
      expect(dummy).toBe(undefined)
      expect(mapSpy).toHaveBeenCalledTimes(4)
      map.clear()
      expect(dummy).toBe(undefined)
      expect(mapSpy).toHaveBeenCalledTimes(4)
    })

    /**
     * effect 绕过代理，经 toRaw(map).get 读取 key，再通过代理新增和删除。
     * 记录始终 undefined，验证原生 raw get 不建立可触发的依赖。
     */
    it('should not observe raw data', () => {
      let dummy
      const map = reactive(new Map())
      effect(() => (dummy = toRaw(map).get('key')))

      expect(dummy).toBe(undefined)
      map.set('key', 'Hello')
      expect(dummy).toBe(undefined)
      map.delete('key')
      expect(dummy).toBe(undefined)
    })

    /**
     * 向深 reactive Map 的字符串键写入一个普通 reactive 对象代理。
     * 原始 Map 保存的是 toRaw(value) 且不同于代理引用，验证深集合保存此类 value 的 raw；本例不写对象键。
     */
    it('should not pollute original Map with Proxies', () => {
      const map = new Map()
      const observed = reactive(map)
      const value = reactive({})
      observed.set('key', value)
      expect(map.get('key')).not.toBe(value)
      expect(map.get('key')).toBe(toRaw(value))
    })

    /**
     * 空 reactive Map 写入普通对象后 get 同一键。
     * 返回值具响应式标记且 toRaw 等于输入对象，验证深集合 get 惰性包装对象值。
     */
    it('should return observable versions of contained values', () => {
      const observed = reactive(new Map())
      const value = {}
      observed.set('key', value)
      const wrapped = observed.get('key')
      expect(isReactive(wrapped)).toBe(true)
      expect(toRaw(wrapped)).toBe(value)
    })

    /**
     * reactive Map 的 key 保存 { a: 1 }，effect 经 get 读取 a，再通过 get 的对象修改 a=2。
     * 记录变为 2，验证 get 产出代理后字段读取建立嵌套对象依赖。
     */
    it('should observed nested data', () => {
      const observed = reactive(new Map())
      observed.set('key', { a: 1 })
      let dummy
      effect(() => {
        dummy = observed.get('key').a
      })
      observed.get('key').a = 2
      expect(dummy).toBe(2)
    })

    /**
     * reactive Map 预存 { foo: 1 }，effect 经 forEach 检查成员代理并累加 foo，再递增 get 值的 foo。
     * 记录 1→2，验证 forEach 返回代理值且回调字段读取可追踪。
     */
    it('should observe nested values in iterations (forEach)', () => {
      const map = reactive(new Map([[1, { foo: 1 }]]))
      let dummy: any
      effect(() => {
        dummy = 0
        map.forEach(value => {
          expect(isReactive(value)).toBe(true)
          dummy += value.foo
        })
      })
      expect(dummy).toBe(1)
      map.get(1)!.foo++
      expect(dummy).toBe(2)
    })

    /**
     * reactive Map 预存 { foo: 1 }，effect 经 values 检查成员代理并累加 foo，再修改 get 值的 foo。
     * 记录 1→2，验证 values 的深层包装及字段依赖。
     */
    it('should observe nested values in iterations (values)', () => {
      const map = reactive(new Map([[1, { foo: 1 }]]))
      let dummy: any
      effect(() => {
        dummy = 0
        for (const value of map.values()) {
          expect(isReactive(value)).toBe(true)
          dummy += value.foo
        }
      })
      expect(dummy).toBe(1)
      map.get(1)!.foo++
      expect(dummy).toBe(2)
    })

    /**
     * reactive Map 用普通对象键保存 { foo: 1 }，effect 经 entries 检查键和值代理并累加 value.foo。
     * 修改 value.foo 后记录 1→2，验证键和值都被包装，实际字段通知来自被读取的 value.foo。
     */
    it('should observe nested values in iterations (entries)', () => {
      const key = {}
      const map = reactive(new Map([[key, { foo: 1 }]]))
      let dummy: any
      effect(() => {
        dummy = 0
        for (const [key, value] of map.entries()) {
          key
          expect(isReactive(key)).toBe(true)
          expect(isReactive(value)).toBe(true)
          dummy += value.foo
        }
      })
      expect(dummy).toBe(1)
      map.get(key)!.foo++
      expect(dummy).toBe(2)
    })

    /**
     * reactive Map 用普通对象键保存 { foo: 1 }，effect 经默认迭代检查键和值代理并累加 value.foo。
     * 修改 value.foo 后记录 1→2，验证默认键值迭代的深层包装与字段追踪。
     */
    it('should observe nested values in iterations (for...of)', () => {
      const key = {}
      const map = reactive(new Map([[key, { foo: 1 }]]))
      let dummy: any
      effect(() => {
        dummy = 0
        for (const [key, value] of map) {
          key
          expect(isReactive(key)).toBe(true)
          expect(isReactive(value)).toBe(true)
          dummy += value.foo
        }
      })
      expect(dummy).toBe(1)
      map.get(key)!.foo++
      expect(dummy).toBe(2)
    })

    /**
     * reactive Map 的 foo 初值为 NaN，spy effect get 该键后再 set 为 NaN。
     * spy 仍只运行一次，验证 hasChanged 的 Object.is 语义把 NaN→NaN 视为同值。
     */
    it('should not be trigger when the value and the old value both are NaN', () => {
      const map = reactive(new Map([['foo', NaN]]))
      const mapSpy = vi.fn(() => map.get('foo'))
      effect(mapSpy)
      map.set('foo', NaN)
      expect(mapSpy).toHaveBeenCalledTimes(1)
    })

    /**
     * 原始 Map 预存一个 reactive 对象键，创建代理后用同一代理键 has/get/delete。
     * 初始命中且 delete 返回 true，删除后 has false、get undefined，验证优先使用已存在的传入键身份。
     */
    it('should work with reactive keys in raw map', () => {
      const raw = new Map()
      const key = reactive({})
      raw.set(key, 1)
      const map = reactive(raw)

      expect(map.has(key)).toBe(true)
      expect(map.get(key)).toBe(1)

      expect(map.delete(key)).toBe(true)
      expect(map.has(key)).toBe(false)
      expect(map.get(key)).toBeUndefined()
    })

    /**
     * 原始 Map 预存 reactive 对象键及值 1，effect 经代理 get 此键，再代理 set 为 2。
     * 记录 1→2，验证已有 proxy 键不会被写入改成另一个 raw 键而漏通知。
     */
    it('should track set of reactive keys in raw map', () => {
      const raw = new Map()
      const key = reactive({})
      raw.set(key, 1)
      const map = reactive(raw)

      let dummy
      effect(() => {
        dummy = map.get(key)
      })
      expect(dummy).toBe(1)

      map.set(key, 2)
      expect(dummy).toBe(2)
    })

    /**
     * 原始 Map 预存 reactive 对象键，effect 经代理 has 查询，再 delete 同一键。
     * 记录 true→false，验证删除已有 proxy 键会通知该身份的 HAS 读取。
     */
    it('should track deletion of reactive keys in raw map', () => {
      const raw = new Map()
      const key = reactive({})
      raw.set(key, 1)
      const map = reactive(raw)

      let dummy
      effect(() => {
        dummy = map.has(key)
      })
      expect(dummy).toBe(true)

      map.delete(key)
      expect(dummy).toBe(false)
    })

    /**
     * 原始 Map 同时预存同一对象的 raw/proxy 两个键，随后经代理 set proxy 键。
     * 开发警告提示双身份共存，验证冲突检测；测试没有要求合并或移除这两个键。
     */
    it('should warn when both raw and reactive versions of the same object is used as key', () => {
      const raw = new Map()
      const rawKey = {}
      const key = reactive(rawKey)
      raw.set(rawKey, 1)
      raw.set(key, 1)
      const map = reactive(raw)
      map.set(key, 2)
      expect(
        `Reactive Map contains both the raw and reactive`,
      ).toHaveBeenWarned()
    })

    // #877
    /**
     * spy effect 收集空 reactive Map 的 keys，先新增 a/b，再修改已有 b 的值。
     * 新增时次数 1→2→3 且键序列更新，改值后仍为 3，验证 SET 不通知 MAP_KEY_ITERATE_KEY。
     */
    it('should not trigger key iteration when setting existing keys', () => {
      const map = reactive(new Map())
      const spy = vi.fn()

      effect(() => {
        const keys = []
        for (const key of map.keys()) {
          keys.push(key)
        }
        spy(keys)
      })

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toMatchObject([])

      map.set('a', 0)
      expect(spy).toHaveBeenCalledTimes(2)
      expect(spy.mock.calls[1][0]).toMatchObject(['a'])

      map.set('b', 0)
      expect(spy).toHaveBeenCalledTimes(3)
      expect(spy.mock.calls[2][0]).toMatchObject(['a', 'b'])

      // 键集合不变，keys 订阅者不重跑。
      map.set('b', 1)
      expect(spy).toHaveBeenCalledTimes(3)
    })

    /**
     * 夹具把空 Map 实例的 has 替换为 spy，通过代理调用 has('k')。
     * 底层实例方法只被调用一次，验证非代理搜索参数无需 raw 重试；这里计数的是方法调用而非 effect。
     */
    it('should trigger Map.has only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Map(), 'has')
      proxy.has('k')
      expect(spy).toBeCalledTimes(1)
    })

    /**
     * 夹具把空 Map 实例的 set 替换为 spy，通过代理 set('k','v')。
     * 底层 set 只被调用一次，验证插桩只转发一次实际写入调用，不测 effect 通知次数。
     */
    it('should trigger Map.set only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Map(), 'set')
      proxy.set('k', 'v')
      expect(spy).toBeCalledTimes(1)
    })

    /**
     * 夹具把空 Map 实例的 delete 替换为 spy，通过代理删除不存在的 'foo'。
     * 底层 delete 只被调用一次，验证未命中键也只进行一次实际删除调用。
     */
    it('should trigger Map.delete only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Map(), 'delete')
      proxy.delete('foo')
      expect(spy).toBeCalledTimes(1)
    })

    /**
     * 夹具把空 Map 实例的 clear 替换为 spy，再通过代理调用 clear。
     * 底层 clear 只被调用一次，验证插桩转发路径；本例没有订阅者。
     */
    it('should trigger Map.clear only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Map(), 'clear')
      proxy.clear()
      expect(spy).toBeCalledTimes(1)
    })

    /**
     * 空 reactive Map 执行 set('a','a') 并保存返回值。
     * 返回值等于 Map 代理自身，验证原生链式写入约定使用代理 receiver。
     */
    it('should return proxy from Map.set call', () => {
      const map = reactive(new Map())
      const result = map.set('a', 'a')
      expect(result).toBe(map)
    })

    /**
     * 分别从原始及 reactive Map 取得 entries 迭代器，检查 next 和 Symbol.iterator 协议。
     * 包装迭代器可自迭代，并包含原迭代器原型上的字符串/Symbol 自有属性，验证继承保留运行环境提供的能力。
     */
    it('should wrapped iterator inherit all iterator properties', () => {
      const raw = new Map([['key', 'value']])
      const map = reactive(raw)

      const rawIterator = raw.entries()
      const wrappedIterator = map.entries()

      // 包装迭代器保留原迭代器协议及自迭代约定。
      expect(typeof wrappedIterator.next).toBe('function')
      expect(typeof wrappedIterator[Symbol.iterator]).toBe('function')
      expect(wrappedIterator[Symbol.iterator]()).toBe(wrappedIterator)

      // 检查运行环境在原迭代器原型上提供的字符串和 Symbol 属性。
      for (const key of Object.getOwnPropertyNames(
        Object.getPrototypeOf(rawIterator),
      )) {
        expect(key in wrappedIterator).toBe(true)
      }
      for (const key of Object.getOwnPropertySymbols(
        Object.getPrototypeOf(rawIterator),
      )) {
        expect(key in wrappedIterator).toBe(true)
      }
    })
  })
})
