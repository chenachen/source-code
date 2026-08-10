import { effect, isReactive, reactive, toRaw } from '../../src'

describe('reactivity/collections', () => {
  describe('WeakMap', () => {
    // 场景：对 WeakMap 创建响应式代理；验证代理仍通过 WeakMap 的 instanceof 检查。
    test('instanceof', () => {
      const original = new WeakMap()
      const observed = reactive(original)
      expect(isReactive(observed)).toBe(true)
      expect(original).toBeInstanceOf(WeakMap)
      expect(observed).toBeInstanceOf(WeakMap)
    })

    // 场景：读取后新增、修改和删除 WeakMap 键；验证相关 effect 按变化重新执行。
    it('should observe mutations', () => {
      let dummy
      const key = {}
      const map = reactive(new WeakMap())
      effect(() => {
        dummy = map.get(key)
      })

      expect(dummy).toBe(undefined)
      map.set(key, 'value')
      expect(dummy).toBe('value')
      map.set(key, 'value2')
      expect(dummy).toBe('value2')
      map.delete(key)
      expect(dummy).toBe(undefined)
    })

    // 场景：使用响应式对象作为 WeakMap 键进行修改；验证 proxy/raw 键身份均能命中依赖。
    it('should observe mutations with observed value as key', () => {
      let dummy
      const key = reactive({})
      const value = reactive({})
      const map = reactive(new WeakMap())
      effect(() => {
        dummy = map.get(key)
      })

      expect(dummy).toBe(undefined)
      map.set(key, value)
      expect(dummy).toBe(value)
      map.delete(key)
      expect(dummy).toBe(undefined)
    })

    // 场景：给 WeakMap 实例添加普通自定义属性；验证集合响应式不会追踪这些额外属性。
    it('should not observe custom property mutations', () => {
      let dummy
      const map: any = reactive(new WeakMap())
      effect(() => (dummy = map.customProp))

      expect(dummy).toBe(undefined)
      map.customProp = 'Hello World'
      expect(dummy).toBe(undefined)
    })

    // 场景：重复写入相同 WeakMap 值或删除不存在的键；验证无实际变化时不触发 effect。
    it('should not observe non value changing mutations', () => {
      let dummy
      const key = {}
      const map = reactive(new WeakMap())
      const mapSpy = vi.fn(() => (dummy = map.get(key)))
      effect(mapSpy)

      expect(dummy).toBe(undefined)
      expect(mapSpy).toHaveBeenCalledTimes(1)
      map.set(key, undefined)
      expect(dummy).toBe(undefined)
      expect(mapSpy).toHaveBeenCalledTimes(2)
      map.set(key, 'value')
      expect(dummy).toBe('value')
      expect(mapSpy).toHaveBeenCalledTimes(3)
      map.set(key, 'value')
      expect(dummy).toBe('value')
      expect(mapSpy).toHaveBeenCalledTimes(3)
      map.delete(key)
      expect(dummy).toBe(undefined)
      expect(mapSpy).toHaveBeenCalledTimes(4)
      map.delete(key)
      expect(dummy).toBe(undefined)
      expect(mapSpy).toHaveBeenCalledTimes(4)
    })

    // 场景：绕过代理直接读取原始 WeakMap；验证 raw 操作不会建立响应式依赖。
    it('should not observe raw data', () => {
      let dummy
      const key = {}
      const map = reactive(new WeakMap())
      effect(() => (dummy = toRaw(map).get(key)))

      expect(dummy).toBe(undefined)
      map.set(key, 'Hello')
      expect(dummy).toBe(undefined)
      map.delete(key)
      expect(dummy).toBe(undefined)
    })

    // 场景：向响应式 WeakMap 写入代理键和值；验证原集合不会被不必要的代理身份污染。
    it('should not pollute original Map with Proxies', () => {
      const map = new WeakMap()
      const observed = reactive(map)
      const key = {}
      const value = reactive({})
      observed.set(key, value)
      expect(map.get(key)).not.toBe(value)
      expect(map.get(key)).toBe(toRaw(value))
    })

    // 场景：从响应式 WeakMap 读取对象值；验证返回对象会转换成响应式代理。
    it('should return observable versions of contained values', () => {
      const observed = reactive(new WeakMap())
      const key = {}
      const value = {}
      observed.set(key, value)
      const wrapped = observed.get(key)
      expect(isReactive(wrapped)).toBe(true)
      expect(toRaw(wrapped)).toBe(value)
    })

    // 场景：effect 读取 WeakMap 值的嵌套字段；验证嵌套对象变化仍能触发更新。
    it('should observed nested data', () => {
      const observed = reactive(new WeakMap())
      const key = {}
      observed.set(key, { a: 1 })
      let dummy
      effect(() => {
        dummy = observed.get(key).a
      })
      observed.get(key).a = 2
      expect(dummy).toBe(2)
    })

    // 场景：WeakMap 某键的旧值和新值都是 NaN；验证 Object.is 语义下不产生重复触发。
    it('should not be trigger when the value and the old value both are NaN', () => {
      const map = new WeakMap()
      const key = {}
      map.set(key, NaN)
      const mapSpy = vi.fn(() => map.get(key))
      effect(mapSpy)
      map.set(key, NaN)
      expect(mapSpy).toHaveBeenCalledTimes(1)
    })
    // 场景：调用响应式 WeakMap.set；验证链式调用返回响应式代理而非原始 WeakMap。
    it('should return proxy from WeakMap.set call', () => {
      const map = reactive(new WeakMap())
      const result = map.set({}, 'a')
      expect(result).toBe(map)
    })
  })
})
