import { effect, isReactive, reactive, toRaw } from '../../src'

describe('reactivity/collections', () => {
  describe('WeakSet', () => {
    /**
     * 把空 WeakSet 转为 reactive，再检查原实例和代理的 instanceof 与响应式标记。
     * 代理仍是 WeakSet 实例且具有响应式标记，验证弱成员集合代理保留继承关系。
     */
    it('instanceof', () => {
      const original = new WeakSet()
      const observed = reactive(original)
      expect(isReactive(observed)).toBe(true)
      expect(original).toBeInstanceOf(WeakSet)
      expect(observed).toBeInstanceOf(WeakSet)
    })

    /**
     * effect 用普通对象查询空 reactive WeakSet，随后 add/delete 同一对象。
     * 记录 false→true→false，验证弱集合成员变化通知 HAS 依赖。
     */
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

    /**
     * effect 用 reactive 对象代理查询空 reactive WeakSet，再 add/delete 同一代理。
     * 记录 false→true→false，验证普通深层代理成员的 raw 查询兼容。
     */
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

    /**
     * effect 读取 reactive WeakSet 上不存在的 customProp，再写入字符串。
     * 记录保持 undefined，验证弱集合 handler 不追踪额外对象属性。
     */
    it('should not observe custom property mutations', () => {
      let dummy
      const set: any = reactive(new WeakSet())
      effect(() => (dummy = set.customProp))

      expect(dummy).toBe(undefined)
      set.customProp = 'Hello World'
      expect(dummy).toBe(undefined)
    })

    /**
     * spy effect 查询普通对象成员，随后 add、重复 add、delete、重复 delete。
     * 只有首次加入和有效删除增加次数，总计 3，验证不存在内容变化时不发送通知。
     */
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

    /**
     * effect 经 toRaw(set).has 读取成员，随后通过代理 add。
     * 记录保持 false，验证原生 WeakSet has 不建立代理依赖。
     */
    it('should not observe raw data', () => {
      const value = {}
      let dummy
      const set = reactive(new WeakSet())
      effect(() => (dummy = toRaw(set).has(value)))

      expect(dummy).toBe(false)
      set.add(value)
      expect(dummy).toBe(false)
    })

    /**
     * effect 通过代理 has 已订阅对象成员，随后经 toRaw(set).add 写入。
     * 记录保持 false，验证原始写入不经过代理触发路径。
     */
    it('should not be triggered by raw mutations', () => {
      const value = {}
      let dummy
      const set = reactive(new WeakSet())
      effect(() => (dummy = set.has(value)))

      expect(dummy).toBe(false)
      toRaw(set).add(value)
      expect(dummy).toBe(false)
    })

    /**
     * 向深 reactive WeakSet 添加一个普通 reactive 对象代理，再从代理和原 WeakSet 查询。
     * 代理 has 命中，原 WeakSet 不含该代理引用，验证此类深层成员写入不保存 proxy 身份。
     */
    it('should not pollute original Set with Proxies', () => {
      const set = new WeakSet()
      const observed = reactive(set)
      const value = reactive({})
      observed.add(value)
      expect(observed.has(value)).toBe(true)
      expect(set.has(value)).toBe(false)
    })

    /**
     * 空 reactive WeakSet 执行 add({}) 并保存返回值。
     * 返回值等于集合代理自身，验证链式 add 约定保留代理 receiver。
     */
    it('should return proxy from WeakSet.add call', () => {
      const set = reactive(new WeakSet())
      const result = set.add({})
      expect(result).toBe(set)
    })
  })
})
