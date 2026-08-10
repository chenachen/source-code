import { effect, isReactive, reactive, toRaw } from '../../src'

describe('reactivity/collections', () => {
  function coverCollectionFn(collection: Map<any, any>, fnName: string) {
    const spy = vi.fn()
    let proxy = reactive(collection)
    ;(collection as any)[fnName] = spy
    return [proxy as any, spy]
  }

  describe('Map', () => {
    // 场景：代理 Map 实例；验证响应式代理仍通过 Map 的 instanceof 检查。
    test('instanceof', () => {
      const original = new Map()
      const observed = reactive(original)
      expect(isReactive(observed)).toBe(true)
      expect(original).toBeInstanceOf(Map)
      expect(observed).toBeInstanceOf(Map)
    })

    // 场景：effect 读取 Map 键后执行新增、修改、删除；验证各类变化精确触发。
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

    // 场景：用响应式对象作为 Map 键；验证 proxy/raw 键身份能正确关联同一依赖。
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

    // 场景：effect 读取 Map.size 后增删键；验证集合大小变化触发更新。
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

    // 场景：effect 使用 for...of 遍历 Map；验证键值对结构变化重新执行遍历。
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
      // iteration should track mutation of existing entries (#709)
      map.set('key1', 4)
      expect(dummy).toBe(6)
      map.delete('key1')
      expect(dummy).toBe(2)
      map.clear()
      expect(dummy).toBe(0)
    })

    // 场景：effect 通过 Map.forEach 遍历；验证新增、改值、删除和清空均更新结果。
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
      // iteration should track mutation of existing entries (#709)
      map.set('key1', 4)
      expect(dummy).toBe(6)
      map.delete('key1')
      expect(dummy).toBe(2)
      map.clear()
      expect(dummy).toBe(0)
    })

    // 场景：effect 仅迭代 Map.keys；验证键增删触发、已有键改值不触发。
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

    // 场景：effect 迭代 Map.values；验证新增、改值和删除都会更新值序列。
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
      // iteration should track mutation of existing entries (#709)
      map.set('key1', 4)
      expect(dummy).toBe(6)
      map.delete('key1')
      expect(dummy).toBe(2)
      map.clear()
      expect(dummy).toBe(0)
    })

    // 场景：effect 迭代 Map.entries；验证键值对任一有效变化都会重新计算。
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
      // iteration should track mutation of existing entries (#709)
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

    // 场景：effect 依赖 Map 内容后调用 clear；验证所有相关键和遍历依赖被触发。
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

    // 场景：给 Map 实例添加普通自定义属性；验证集合插桩不追踪额外对象属性。
    it('should not observe custom property mutations', () => {
      let dummy
      const map: any = reactive(new Map())
      effect(() => (dummy = map.customProp))

      expect(dummy).toBe(undefined)
      map.customProp = 'Hello World'
      expect(dummy).toBe(undefined)
    })

    // 场景：重复写相同值、删除不存在键或清空空 Map；验证无实际变化不触发。
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

    // 场景：直接读取原始 Map；验证绕过代理的操作不会建立依赖。
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

    // 场景：向响应式 Map 写入代理键和值；验证深层集合按预期保存 raw 身份。
    it('should not pollute original Map with Proxies', () => {
      const map = new Map()
      const observed = reactive(map)
      const value = reactive({})
      observed.set('key', value)
      expect(map.get('key')).not.toBe(value)
      expect(map.get('key')).toBe(toRaw(value))
    })

    // 场景：从响应式 Map 读取对象值；验证返回对象被惰性包装为响应式代理。
    it('should return observable versions of contained values', () => {
      const observed = reactive(new Map())
      const value = {}
      observed.set('key', value)
      const wrapped = observed.get('key')
      expect(isReactive(wrapped)).toBe(true)
      expect(toRaw(wrapped)).toBe(value)
    })

    // 场景：effect 读取 Map 值的嵌套字段；验证嵌套字段变化可触发更新。
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

    // 场景：forEach 回调读取 Map 值的嵌套字段；验证回调值是响应式代理。
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

    // 场景：values 迭代结果读取嵌套字段；验证产出对象保持深层响应性。
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

    // 场景：entries 迭代的键和值读取嵌套字段；验证二者按模式转换并可追踪。
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

    // 场景：for...of 取得 Map 对象值并读取嵌套字段；验证深层变化触发遍历 effect。
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

    // 场景：同一 Map 键从 NaN 写回 NaN；验证 Object.is 语义下不触发。
    it('should not be trigger when the value and the old value both are NaN', () => {
      const map = reactive(new Map([['foo', NaN]]))
      const mapSpy = vi.fn(() => map.get('foo'))
      effect(mapSpy)
      map.set('foo', NaN)
      expect(mapSpy).toHaveBeenCalledTimes(1)
    })

    // 场景：原始 Map 已以响应式对象为键；验证代理 Map 仍能读取该键。
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

    // 场景：原始 Map 保存 proxy 键后通过代理 set；验证正确命中并触发该键依赖。
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

    // 场景：原始 Map 保存 proxy 键后通过代理 delete；验证删除通知与旧值正确。
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

    // 场景：Map 同时含同一对象的 raw/proxy 两个键；验证开发模式提示身份冲突。
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
    // 场景：只更新 Map 已有键的值；验证 keys 迭代依赖不被无意义触发。
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

      // keys didn't change, should not trigger
      map.set('b', 1)
      expect(spy).toHaveBeenCalledTimes(3)
    })

    // 场景：普通对象键只以单一身份参与 Map.has；验证一次操作只触发一次依赖。
    it('should trigger Map.has only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Map(), 'has')
      proxy.has('k')
      expect(spy).toBeCalledTimes(1)
    })

    // 场景：以非代理键调用 Map.set；验证不会因 raw/proxy 兼容分支重复触发。
    it('should trigger Map.set only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Map(), 'set')
      proxy.set('k', 'v')
      expect(spy).toBeCalledTimes(1)
    })

    // 场景：以非代理键调用 Map.delete；验证订阅者仅收到一次通知。
    it('should trigger Map.delete only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Map(), 'delete')
      proxy.delete('foo')
      expect(spy).toBeCalledTimes(1)
    })

    // 场景：清空只含非代理键的 Map；验证同一 effect 在批处理中仅执行一次。
    it('should trigger Map.clear only once for non-reactive keys', () => {
      const [proxy, spy] = coverCollectionFn(new Map(), 'clear')
      proxy.clear()
      expect(spy).toBeCalledTimes(1)
    })

    // 场景：调用响应式 Map.set；验证链式返回值是响应式代理。
    it('should return proxy from Map.set call', () => {
      const map = reactive(new Map())
      const result = map.set('a', 'a')
      expect(result).toBe(map)
    })

    // 场景：原始 Map 迭代器带有额外属性；验证包装迭代器通过原型继承保留它们。
    it('should wrapped iterator inherit all iterator properties', () => {
      const raw = new Map([['key', 'value']])
      const map = reactive(raw)

      const rawIterator = raw.entries()
      const wrappedIterator = map.entries()

      // Wrapped iterator should have the same properties as original iterator
      expect(typeof wrappedIterator.next).toBe('function')
      expect(typeof wrappedIterator[Symbol.iterator]).toBe('function')
      expect(wrappedIterator[Symbol.iterator]()).toBe(wrappedIterator)

      // Check inherited iterator helper methods if they exist on the original
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
