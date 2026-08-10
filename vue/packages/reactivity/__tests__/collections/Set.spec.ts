import {
  effect,
  isReactive,
  reactive,
  readonly,
  shallowReactive,
  toRaw,
} from '../../src'

describe('reactivity/collections', () => {
  function coverCollectionFn(collection: Set<any>, fnName: string) {
    const spy = vi.fn()
    let proxy = reactive(collection)
    ;(collection as any)[fnName] = spy
    return [proxy as any, spy]
  }

  describe('Set', () => {
    // 场景：代理 Set 实例；验证响应式代理仍通过 Set 的 instanceof 检查。
    it('instanceof', () => {
      const original = new Set()
      const observed = reactive(original)
      expect(isReactive(observed)).toBe(true)
      expect(original).toBeInstanceOf(Set)
      expect(observed).toBeInstanceOf(Set)
    })

    // 场景：effect 查询 Set 成员后 add/delete；验证成员变化触发更新。
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

    // 场景：使用响应式对象作为 Set 成员；验证 proxy/raw 身份指向同一逻辑成员。
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

    // 场景：effect 使用 for...of 遍历 Set；验证成员增删触发重新遍历。
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

    // 场景：effect 通过 Set.forEach 遍历；验证 add/delete/clear 更新遍历结果。
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

    // 场景：effect 迭代 Set.values；验证集合结构变化触发值序列更新。
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

    // 场景：effect 迭代 Set.keys；验证 Set 的 keys 与 values 采用相同成员依赖。
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

    // 场景：effect 迭代 Set.entries；验证 `[value, value]` 结果随成员变化更新。
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

    // 场景：effect 依赖 Set 内容后调用 clear；验证全部成员和遍历依赖触发。
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

    // 场景：修改 Set 实例的普通自定义属性；验证集合插桩不追踪额外属性。
    it('should not observe custom property mutations', () => {
      let dummy
      const set: any = reactive(new Set())
      effect(() => (dummy = set.customProp))

      expect(dummy).toBe(undefined)
      set.customProp = 'Hello World'
      expect(dummy).toBe(undefined)
    })

    // 场景：effect 读取 Set.size 后增删成员；验证大小变化触发更新。
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

    // 场景：重复 add、删除不存在成员或清空空 Set；验证无实际变化时不触发。
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

    // 场景：直接读取原始 Set；验证绕过代理的操作不建立响应式依赖。
    it('should not observe raw data', () => {
      let dummy
      const set = reactive(new Set())
      effect(() => (dummy = toRaw(set).has('value')))

      expect(dummy).toBe(false)
      set.add('value')
      expect(dummy).toBe(false)
    })

    // 场景：在 effect 中迭代原始 Set；验证 raw 迭代不被代理依赖系统追踪。
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

    // 场景：effect 订阅代理后直接修改原始 Set；验证 raw 写入不会触发代理订阅。
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

    // 场景：effect 直接读取原始 Set.size；验证不会订阅大小依赖。
    it('should not observe raw size mutations', () => {
      let dummy
      const set = reactive(new Set())
      effect(() => (dummy = toRaw(set).size))

      expect(dummy).toBe(0)
      set.add('value')
      expect(dummy).toBe(0)
    })

    // 场景：代理 size 已被观察但从 raw Set 改变大小；验证绕过代理不主动触发。
    it('should not be triggered by raw size mutations', () => {
      let dummy
      const set = reactive(new Set())
      effect(() => (dummy = set.size))

      expect(dummy).toBe(0)
      toRaw(set).add('value')
      expect(dummy).toBe(0)
    })

    // 场景：Set 使用对象成员并以 raw/proxy 形态查询；验证对象身份兼容。
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

    // 场景：向深响应式 Set 添加代理对象；验证原 Set 不被代理身份污染。
    it('should not pollute original Set with Proxies', () => {
      const set = new Set()
      const observed = reactive(set)
      const value = reactive({})
      observed.add(value)
      expect(observed.has(value)).toBe(true)
      expect(set.has(value)).toBe(false)
    })

    // 场景：forEach 回调读取 Set 成员嵌套字段；验证成员以响应式代理传入。
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

    // 场景：values 迭代成员并读取嵌套字段；验证深层变化触发 effect。
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

    // 场景：entries 迭代成员对并读取嵌套字段；验证两个位置都正确包装。
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

    // 场景：for...of 读取 Set 成员嵌套字段；验证深层修改更新遍历 effect。
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

    // 场景：原始 Set 已保存响应式对象成员；验证代理 Set 仍能正确查询。
    it('should work with reactive entries in raw set', () => {
      const raw = new Set()
      const entry = reactive({})
      raw.add(entry)
      const set = reactive(raw)

      expect(set.has(entry)).toBe(true)

      expect(set.delete(entry)).toBe(true)
      expect(set.has(entry)).toBe(false)
    })

    // 场景：原始 Set 保存 proxy 成员后经代理删除；验证依赖正确触发。
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

    // 场景：Set 已含 raw 对象后尝试添加其只读代理；验证不会产生重复成员。
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

    // 场景：浅响应式 Set 已含 raw 对象后添加其代理；验证身份检查避免重复。
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

    // 场景：Set 同时含同一对象的 raw/proxy 版本；验证开发模式发出身份冲突警告。
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

    // 场景：调用响应式 Set.forEach 并传 thisArg；验证回调 this 与第三参数符合原生约定。
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

    // 场景：非代理成员参与 Set.has；验证一次变化只触发一次相关依赖。
    it('should trigger Set.has only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Set(), 'has')
      proxy.has('foo')
      expect(spy).toBeCalledTimes(1)
    })

    // 场景：添加非代理成员；验证 raw/proxy 兼容检查不会造成重复触发。
    it('should trigger Set.add only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Set(), 'add')
      proxy.add('foo')
      expect(spy).toBeCalledTimes(1)
    })

    // 场景：删除非代理成员；验证订阅者仅收到一次通知。
    it('should trigger Set.delete only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Set(), 'delete')
      proxy.delete('foo')
      expect(spy).toBeCalledTimes(1)
    })

    // 场景：清空只含非代理成员的 Set；验证同一 effect 在批处理中仅执行一次。
    it('should trigger Set.clear only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Set(), 'clear')
      proxy.clear()
      expect(spy).toBeCalledTimes(1)
    })

    // 场景：调用响应式 Set.add；验证链式返回值是响应式代理。
    it('should return proxy from Set.add call', () => {
      const set = reactive(new Set())
      const result = set.add('a')
      expect(result).toBe(set)
    })
  })
})
