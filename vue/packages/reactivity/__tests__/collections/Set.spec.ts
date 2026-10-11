import {
  effect,
  isReactive,
  reactive,
  readonly,
  shallowReactive,
  toRaw,
} from '../../src'

describe('reactivity/collections', () => {
  /**
   * 创建集合代理，再将原实例指定方法覆盖为 spy，返回代理与计数器，供检查单次底层转发调用。
   */
  function coverCollectionFn(collection: Set<any>, fnName: string) {
    const spy = vi.fn()
    let proxy = reactive(collection)
    ;(collection as any)[fnName] = spy
    return [proxy as any, spy]
  }

  describe('Set', () => {
    /**
     * 把空 Set 转为 reactive，再检查原实例和代理的 instanceof 及响应式标记。
     * 代理仍是 Set 实例且具有响应式标记，验证集合代理保留原型继承关系。
     */
    it('instanceof', () => {
      const original = new Set()
      const observed = reactive(original)
      expect(isReactive(observed)).toBe(true)
      expect(original).toBeInstanceOf(Set)
      expect(observed).toBeInstanceOf(Set)
    })

    /**
     * effect 查询空 reactive Set 的字符串成员，再 add/delete 同一成员。
     * 记录 false→true→false，验证成员 ADD/DELETE 通知相应的 HAS 依赖。
     */
    it('should observe mutations', () => {
      let dummy
      const set = reactive(new Set())
      effect(() => (dummy = set.has('value')))

      expect(dummy).toBe(false)
      set.add('value')
      expect(dummy).toBe(true)
      set.delete('value')
      expect(dummy).toBe(false)
    })

    /**
     * effect 用 reactive 对象代理查询空 reactive Set，再 add/delete 同一代理。
     * 记录 false→true→false，验证普通深层代理成员的身份兼容；本例不验证已预存双身份的合并。
     */
    it('should observe mutations with observed value', () => {
      let dummy
      const value = reactive({})
      const set = reactive(new Set())
      effect(() => (dummy = set.has(value)))

      expect(dummy).toBe(false)
      set.add(value)
      expect(dummy).toBe(true)
      set.delete(value)
      expect(dummy).toBe(false)
    })

    /**
     * effect 默认迭代数值 reactive Set 并求和，依次加入 2/1、删除 2、clear。
     * 记录 0→3→1→0，验证 Set 默认迭代的结构依赖。
     */
    it('should observe for of iteration', () => {
      let dummy
      const set = reactive(new Set() as Set<number>)
      effect(() => {
        dummy = 0
        for (let num of set) {
          dummy += num
        }
      })

      expect(dummy).toBe(0)
      set.add(2)
      set.add(1)
      expect(dummy).toBe(3)
      set.delete(2)
      expect(dummy).toBe(1)
      set.clear()
      expect(dummy).toBe(0)
    })

    /**
     * effect 用 forEach 累计 reactive Set 数值，依次 add 2/1、delete 2、clear。
     * 记录 0→3→1→0，验证 forEach 订阅成员迭代变化。
     */
    it('should observe forEach iteration', () => {
      let dummy: any
      const set = reactive(new Set())
      effect(() => {
        dummy = 0
        set.forEach(num => (dummy += num))
      })

      expect(dummy).toBe(0)
      set.add(2)
      set.add(1)
      expect(dummy).toBe(3)
      set.delete(2)
      expect(dummy).toBe(1)
      set.clear()
      expect(dummy).toBe(0)
    })

    /**
     * effect 用 values 累计 reactive Set 数值，依次 add 2/1、delete 2、clear。
     * 记录 0→3→1→0，验证 values 迭代响应有效成员变更。
     */
    it('should observe values iteration', () => {
      let dummy
      const set = reactive(new Set() as Set<number>)
      effect(() => {
        dummy = 0
        for (let num of set.values()) {
          dummy += num
        }
      })

      expect(dummy).toBe(0)
      set.add(2)
      set.add(1)
      expect(dummy).toBe(3)
      set.delete(2)
      expect(dummy).toBe(1)
      set.clear()
      expect(dummy).toBe(0)
    })

    /**
     * effect 用 keys 累计 reactive Set 数值，依次 add 2/1、delete 2、clear。
     * 记录 0→3→1→0，验证 Set.keys 产出成员并使用 ITERATE_KEY，不采用 Map 的独立键依赖。
     */
    it('should observe keys iteration', () => {
      let dummy
      const set = reactive(new Set() as Set<number>)
      effect(() => {
        dummy = 0
        for (let num of set.keys()) {
          dummy += num
        }
      })

      expect(dummy).toBe(0)
      set.add(2)
      set.add(1)
      expect(dummy).toBe(3)
      set.delete(2)
      expect(dummy).toBe(1)
      set.clear()
      expect(dummy).toBe(0)
    })

    /**
     * effect 用 entries 累计每对的第二项，依次 add 2/1、delete 2、clear。
     * 记录 0→3→1→0，验证 Set 成对成员迭代的结构依赖；本例不直接比较同对两项身份。
     */
    it('should observe entries iteration', () => {
      let dummy
      const set = reactive(new Set<number>())
      effect(() => {
        dummy = 0
        for (let [key, num] of set.entries()) {
          key
          dummy += num
        }
      })

      expect(dummy).toBe(0)
      set.add(2)
      set.add(1)
      expect(dummy).toBe(3)
      set.delete(2)
      expect(dummy).toBe(1)
      set.clear()
      expect(dummy).toBe(0)
    })

    /**
     * effect 用 has 查询 reactive Set 的 key，先 add 再 clear 非空集合。
     * 记录 false→true→false，验证 CLEAR 会通知该成员已建立的 Dep。
     */
    it('should be triggered by clearing', () => {
      let dummy
      const set = reactive(new Set())
      effect(() => (dummy = set.has('key')))

      expect(dummy).toBe(false)
      set.add('key')
      expect(dummy).toBe(true)
      set.clear()
      expect(dummy).toBe(false)
    })

    /**
     * effect 读取 reactive Set 上不存在的 customProp，再向该普通属性赋字符串。
     * 记录仍 undefined，验证集合 handler 不追踪额外对象属性；本例不检查直接读回值。
     */
    it('should not observe custom property mutations', () => {
      let dummy
      const set: any = reactive(new Set())
      effect(() => (dummy = set.customProp))

      expect(dummy).toBe(undefined)
      set.customProp = 'Hello World'
      expect(dummy).toBe(undefined)
    })

    /**
     * effect 读取空 reactive Set 的 size，加入两个不同成员、删除一个、clear。
     * 记录 0→2→1→0，验证 size 订阅的迭代依赖随结构变化更新。
     */
    it('should observe size mutations', () => {
      let dummy
      const set = reactive(new Set())
      effect(() => (dummy = set.size))

      expect(dummy).toBe(0)
      set.add('value')
      set.add('value2')
      expect(dummy).toBe(2)
      set.delete('value')
      expect(dummy).toBe(1)
      set.clear()
      expect(dummy).toBe(0)
    })

    /**
     * spy effect 查询空 Set 的 value，随后 add、重复 add、delete、重复 delete、clear 空集合。
     * 仅有效新增和删除增加次数，总计 3，验证重复成员和无成员变动不发通知。
     */
    it('should not observe non value changing mutations', () => {
      let dummy
      const set = reactive(new Set())
      const setSpy = vi.fn(() => (dummy = set.has('value')))
      effect(setSpy)

      expect(dummy).toBe(false)
      expect(setSpy).toHaveBeenCalledTimes(1)
      set.add('value')
      expect(dummy).toBe(true)
      expect(setSpy).toHaveBeenCalledTimes(2)
      set.add('value')
      expect(dummy).toBe(true)
      expect(setSpy).toHaveBeenCalledTimes(2)
      set.delete('value')
      expect(dummy).toBe(false)
      expect(setSpy).toHaveBeenCalledTimes(3)
      set.delete('value')
      expect(dummy).toBe(false)
      expect(setSpy).toHaveBeenCalledTimes(3)
      set.clear()
      expect(dummy).toBe(false)
      expect(setSpy).toHaveBeenCalledTimes(3)
    })

    /**
     * effect 绕过代理，经 toRaw(set).has 查询成员，再通过代理 add。
     * 记录保持 false，验证 raw has 不建立依赖。
     */
    it('should not observe raw data', () => {
      let dummy
      const set = reactive(new Set())
      effect(() => (dummy = toRaw(set).has('value')))

      expect(dummy).toBe(false)
      set.add('value')
      expect(dummy).toBe(false)
    })

    /**
     * effect 分别经 raw 的 entries、keys、values、forEach 和默认迭代累计数值，再经代理 add/delete。
     * 记录一直为 0，验证这些原生 raw 迭代入口都不接入代理依赖系统。
     */
    it('should not observe raw iterations', () => {
      let dummy = 0
      const set = reactive(new Set<number>())
      effect(() => {
        dummy = 0
        for (let [num] of toRaw(set).entries()) {
          dummy += num
        }
        for (let num of toRaw(set).keys()) {
          dummy += num
        }
        for (let num of toRaw(set).values()) {
          dummy += num
        }
        toRaw(set).forEach(num => {
          dummy += num
        })
        for (let num of toRaw(set)) {
          dummy += num
        }
      })

      expect(dummy).toBe(0)
      set.add(2)
      set.add(3)
      expect(dummy).toBe(0)
      set.delete(2)
      expect(dummy).toBe(0)
    })

    /**
     * effect 已通过代理 has 订阅，随后经 raw add/delete/clear；中途把记录手动设为 true。
     * 原始写入不改变记录，验证 bypass 代理的操作不发送通知，手动赋值用于辨别后续是否重跑。
     */
    it('should not be triggered by raw mutations', () => {
      let dummy
      const set = reactive(new Set())
      effect(() => (dummy = set.has('value')))

      expect(dummy).toBe(false)
      toRaw(set).add('value')
      expect(dummy).toBe(false)
      dummy = true
      toRaw(set).delete('value')
      expect(dummy).toBe(true)
      toRaw(set).clear()
      expect(dummy).toBe(true)
    })

    /**
     * effect 直接读取 toRaw(set).size，再通过代理 add 成员。
     * 记录保持 0，验证原始 size getter 不建立依赖。
     */
    it('should not observe raw size mutations', () => {
      let dummy
      const set = reactive(new Set())
      effect(() => (dummy = toRaw(set).size))

      expect(dummy).toBe(0)
      set.add('value')
      expect(dummy).toBe(0)
    })

    /**
     * effect 读取代理 Set.size，再通过 toRaw(set).add 增加成员。
     * 记录保持 0，验证即便存在订阅者，raw 写入也不进入触发路径。
     */
    it('should not be triggered by raw size mutations', () => {
      let dummy
      const set = reactive(new Set())
      effect(() => (dummy = set.size))

      expect(dummy).toBe(0)
      toRaw(set).add('value')
      expect(dummy).toBe(0)
    })

    /**
     * spy effect 用某个普通对象查询空 Set，先加入另一个对象，再加入查询对象。
     * 无关对象新增不重跑，匹配对象使 false→true 且次数 1→2，验证对象成员依赖按身份精确定位。
     */
    it('should support objects as key', () => {
      let dummy
      const key = {}
      const set = reactive(new Set())
      const setSpy = vi.fn(() => (dummy = set.has(key)))
      effect(setSpy)

      expect(dummy).toBe(false)
      expect(setSpy).toHaveBeenCalledTimes(1)

      set.add({})
      expect(dummy).toBe(false)
      expect(setSpy).toHaveBeenCalledTimes(1)

      set.add(key)
      expect(dummy).toBe(true)
      expect(setSpy).toHaveBeenCalledTimes(2)
    })

    /**
     * 向深 reactive Set 添加一个普通 reactive 对象代理，再分别从代理和原 Set has 查询。
     * 代理命中，原 Set 不含该代理引用，验证此类成员写入不把代理身份保存到 raw 容器。
     */
    it('should not pollute original Set with Proxies', () => {
      const set = new Set()
      const observed = reactive(set)
      const value = reactive({})
      observed.add(value)
      expect(observed.has(value)).toBe(true)
      expect(set.has(value)).toBe(false)
    })

    /**
     * effect 用 forEach 读取 reactive Set 中 { foo: 1 } 的字段，再经 forEach 递增 foo。
     * 成员具响应式标记，记录 1→2，验证回调值包装及其字段读取依赖。
     */
    it('should observe nested values in iterations (forEach)', () => {
      const set = reactive(new Set([{ foo: 1 }]))
      let dummy: any
      effect(() => {
        dummy = 0
        set.forEach(value => {
          expect(isReactive(value)).toBe(true)
          dummy += value.foo
        })
      })
      expect(dummy).toBe(1)
      set.forEach(value => {
        value.foo++
      })
      expect(dummy).toBe(2)
    })

    /**
     * effect 用 values 读取 reactive Set 中对象的 foo，再经 forEach 递增 foo。
     * 产出值具响应式标记，记录 1→2，验证 values 的深层包装与字段追踪。
     */
    it('should observe nested values in iterations (values)', () => {
      const set = reactive(new Set([{ foo: 1 }]))
      let dummy: any
      effect(() => {
        dummy = 0
        for (const value of set.values()) {
          expect(isReactive(value)).toBe(true)
          dummy += value.foo
        }
      })
      expect(dummy).toBe(1)
      set.forEach(value => {
        value.foo++
      })
      expect(dummy).toBe(2)
    })

    /**
     * effect 用 entries 检查对象成员对的两项代理标记并累加第二项 foo，再修改成员 foo。
     * 两项均响应式且记录 1→2，验证 Set 成对产出的包装和实际字段依赖。
     */
    it('should observe nested values in iterations (entries)', () => {
      const set = reactive(new Set([{ foo: 1 }]))
      let dummy: any
      effect(() => {
        dummy = 0
        for (const [key, value] of set.entries()) {
          expect(isReactive(key)).toBe(true)
          expect(isReactive(value)).toBe(true)
          dummy += value.foo
        }
      })
      expect(dummy).toBe(1)
      set.forEach(value => {
        value.foo++
      })
      expect(dummy).toBe(2)
    })

    /**
     * effect 默认迭代 reactive Set 中对象并累加 foo，再经 forEach 递增字段。
     * 产出值响应式且记录 1→2，验证默认迭代的深层成员包装。
     */
    it('should observe nested values in iterations (for...of)', () => {
      const set = reactive(new Set([{ foo: 1 }]))
      let dummy: any
      effect(() => {
        dummy = 0
        for (const value of set) {
          expect(isReactive(value)).toBe(true)
          dummy += value.foo
        }
      })
      expect(dummy).toBe(1)
      set.forEach(value => {
        value.foo++
      })
      expect(dummy).toBe(2)
    })

    /**
     * 原始 Set 已保存 reactive 对象成员，创建代理后用同一代理 has/delete。
     * has 初始为 true、delete 返回 true、删除后 has false，验证已存在的传入成员身份优先命中。
     */
    it('should work with reactive entries in raw set', () => {
      const raw = new Set()
      const entry = reactive({})
      raw.add(entry)
      const set = reactive(raw)

      expect(set.has(entry)).toBe(true)

      expect(set.delete(entry)).toBe(true)
      expect(set.has(entry)).toBe(false)
    })

    /**
     * 原始 Set 预存 reactive 对象成员，effect 用代理 has 查询，再经代理 delete。
     * 记录 true→false，验证删除已有 proxy 成员通知对应 HAS 读取。
     */
    it('should track deletion of reactive entries in raw set', () => {
      const raw = new Set()
      const entry = reactive({})
      raw.add(entry)
      const set = reactive(raw)

      let dummy
      effect(() => {
        dummy = set.has(entry)
      })
      expect(dummy).toBe(true)

      set.delete(entry)
      expect(dummy).toBe(false)
    })

    /**
     * 深 reactive Set 已含 raw 对象，再查询并 add 其 readonly 代理。
     * size 保持 1，raw 容器仅含 raw、不含只读代理，验证添加前也检查该输入的 toRaw 身份。
     */
    it('should not add readonly versions of existing raw values', () => {
      const rawValue = {}
      const wrappedValue = readonly(rawValue)
      const set = reactive(new Set([rawValue]))

      expect(set.has(wrappedValue)).toBe(true)

      set.add(wrappedValue)

      expect(set.size).toBe(1)
      expect(toRaw(set).has(rawValue)).toBe(true)
      expect(toRaw(set).has(wrappedValue)).toBe(false)
    })

    /**
     * 浅 reactive Set 已含 raw 对象，再查询并 add 其 reactive 代理。
     * size 保持 1，raw 容器没有新增 proxy，验证浅集合也检查输入及其 raw 已有成员。
     */
    it('should not add proxy versions of existing raw values to shallow sets', () => {
      const rawValue = {}
      const wrappedValue = reactive(rawValue)
      const set = shallowReactive(new Set([rawValue]))

      expect(set.has(wrappedValue)).toBe(true)

      set.add(wrappedValue)

      expect(set.size).toBe(1)
      expect(toRaw(set).has(rawValue)).toBe(true)
      expect(toRaw(set).has(wrappedValue)).toBe(false)
    })

    /**
     * 原始 Set 同时预存同一对象的 raw/proxy 两项，创建代理后 delete proxy 项。
     * 开发警告提示双身份共存，验证冲突检测；本例不要求预存成员自动合并。
     */
    it('should warn when set contains both raw and reactive versions of the same object', () => {
      const raw = new Set()
      const rawKey = {}
      const key = reactive(rawKey)
      raw.add(rawKey)
      raw.add(key)
      const set = reactive(raw)
      set.delete(key)
      expect(
        `Reactive Set contains both the raw and reactive`,
      ).toHaveBeenWarned()
    })

    /**
     * reactive Set 仅含字符串成员，forEach 传入 thisArg 并使用普通函数回调。
     * 回调执行一次，this 等于传入对象、value 正确、第三参数等于集合代理，验证集合回调协议。
     */
    it('thisArg', () => {
      const raw = new Set(['value'])
      const proxy = reactive(raw)
      const thisArg = {}
      let count = 0
      proxy.forEach(function (this: {}, value, _, set) {
        ++count
        expect(this).toBe(thisArg)
        expect(value).toBe('value')
        expect(set).toBe(proxy)
      }, thisArg)
      expect(count).toBe(1)
    })

    /**
     * 夹具将空 Set 的 has 覆盖为 spy，代理调用 has('foo')。
     * 底层 has 只调用一次，验证普通参数无需 raw 查询重试，计数对象为方法而非 effect。
     */
    it('should trigger Set.has only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Set(), 'has')
      proxy.has('foo')
      expect(spy).toBeCalledTimes(1)
    })

    /**
     * 夹具将空 Set 的 add 覆盖为 spy，代理调用 add('foo')。
     * 底层 add 只调用一次，验证插桩只转发一次实际成员写入。
     */
    it('should trigger Set.add only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Set(), 'add')
      proxy.add('foo')
      expect(spy).toBeCalledTimes(1)
    })

    /**
     * 夹具将空 Set 的 delete 覆盖为 spy，代理删除不存在的 'foo'。
     * 底层 delete 只调用一次，验证未命中成员仍只执行一次删除调用。
     */
    it('should trigger Set.delete only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Set(), 'delete')
      proxy.delete('foo')
      expect(spy).toBeCalledTimes(1)
    })

    /**
     * 夹具将空 Set 的 clear 覆盖为 spy，再经代理 clear。
     * 底层 clear 只调用一次，验证方法转发次数，不测通知或批处理次数。
     */
    it('should trigger Set.clear only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Set(), 'clear')
      proxy.clear()
      expect(spy).toBeCalledTimes(1)
    })

    /**
     * 空 reactive Set 执行 add('a') 并保存返回值。
     * 返回值等于集合代理本身，验证链式调用沿用代理 receiver。
     */
    it('should return proxy from Set.add call', () => {
      const set = reactive(new Set())
      const result = set.add('a')
      expect(result).toBe(set)
    })
  })
})
