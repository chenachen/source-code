import { effect, isReactive, reactive, toRaw } from '../../src'

describe('reactivity/collections', () => {
  describe('WeakSet', () => {
    // 场景：对 WeakSet 创建响应式代理；验证代理仍通过 WeakSet 的 instanceof 检查。
    it('instanceof', () => {
      const original = new WeakSet()
      const observed = reactive(original)
      expect(isReactive(observed)).toBe(true)
      expect(original).toBeInstanceOf(WeakSet)
      expect(observed).toBeInstanceOf(WeakSet)
    })

    // 场景：effect 查询 WeakSet 成员后执行 add/delete；验证成员变化触发对应 effect。
    it('should observe mutations', () => {
      let dummy
      const value = {}
      const set = reactive(new WeakSet())
      effect(() => (dummy = set.has(value)))

      expect(dummy).toBe(false)
      set.add(value)
      expect(dummy).toBe(true)
      set.delete(value)
      expect(dummy).toBe(false)
    })

    // 场景：以响应式对象作为 WeakSet 成员修改；验证 proxy/raw 身份能对应同一成员。
    it('should observe mutations with observed value', () => {
      let dummy
      const value = reactive({})
      const set = reactive(new WeakSet())
      effect(() => (dummy = set.has(value)))

      expect(dummy).toBe(false)
      set.add(value)
      expect(dummy).toBe(true)
      set.delete(value)
      expect(dummy).toBe(false)
    })

    // 场景：修改 WeakSet 实例的普通自定义属性；验证集合代理不会追踪额外属性。
    it('should not observe custom property mutations', () => {
      let dummy
      const set: any = reactive(new WeakSet())
      effect(() => (dummy = set.customProp))

      expect(dummy).toBe(undefined)
      set.customProp = 'Hello World'
      expect(dummy).toBe(undefined)
    })

    // 场景：重复添加已有成员或删除不存在成员；验证集合内容未变时不触发 effect。
    it('should not observe non value changing mutations', () => {
      let dummy
      const value = {}
      const set = reactive(new WeakSet())
      const setSpy = vi.fn(() => (dummy = set.has(value)))
      effect(setSpy)

      expect(dummy).toBe(false)
      expect(setSpy).toHaveBeenCalledTimes(1)
      set.add(value)
      expect(dummy).toBe(true)
      expect(setSpy).toHaveBeenCalledTimes(2)
      set.add(value)
      expect(dummy).toBe(true)
      expect(setSpy).toHaveBeenCalledTimes(2)
      set.delete(value)
      expect(dummy).toBe(false)
      expect(setSpy).toHaveBeenCalledTimes(3)
      set.delete(value)
      expect(dummy).toBe(false)
      expect(setSpy).toHaveBeenCalledTimes(3)
    })

    // 场景：直接操作原始 WeakSet；验证绕过代理的读取不会建立响应式依赖。
    it('should not observe raw data', () => {
      const value = {}
      let dummy
      const set = reactive(new WeakSet())
      effect(() => (dummy = toRaw(set).has(value)))

      expect(dummy).toBe(false)
      set.add(value)
      expect(dummy).toBe(false)
    })

    // 场景：effect 订阅代理后直接修改原始 WeakSet；验证 raw 写入不会触发代理订阅者。
    it('should not be triggered by raw mutations', () => {
      const value = {}
      let dummy
      const set = reactive(new WeakSet())
      effect(() => (dummy = set.has(value)))

      expect(dummy).toBe(false)
      toRaw(set).add(value)
      expect(dummy).toBe(false)
    })

    // 场景：向响应式 WeakSet 添加代理对象；验证原集合按预期保存原始身份。
    it('should not pollute original Set with Proxies', () => {
      const set = new WeakSet()
      const observed = reactive(set)
      const value = reactive({})
      observed.add(value)
      expect(observed.has(value)).toBe(true)
      expect(set.has(value)).toBe(false)
    })

    // 场景：调用响应式 WeakSet.add；验证链式调用返回响应式代理。
    it('should return proxy from WeakSet.add call', () => {
      const set = reactive(new WeakSet())
      const result = set.add({})
      expect(result).toBe(set)
    })
  })
})
