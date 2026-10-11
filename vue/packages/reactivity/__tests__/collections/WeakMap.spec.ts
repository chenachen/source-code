import { effect, isReactive, reactive, toRaw } from '../../src'

describe('reactivity/collections', () => {
  describe('WeakMap', () => {
    /**
     * 把空 WeakMap 转为 reactive，再检查原实例和代理的 instanceof 与响应式标记。
     * 代理仍是 WeakMap 实例且具有响应式标记，验证弱集合代理保留继承关系。
     */
    test('instanceof', () => {
      const original = new WeakMap()
      const observed = reactive(original)
      expect(isReactive(observed)).toBe(true)
      expect(original).toBeInstanceOf(WeakMap)
      expect(observed).toBeInstanceOf(WeakMap)
    })

    /**
     * effect 用普通对象键 get 空 reactive WeakMap，随后新增值、改值、删除。
     * 记录 undefined→value→value2→undefined，验证弱集合对象键的 ADD/SET/DELETE 通知。
     */
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

    /**
     * effect 用 reactive 对象键 get 空 reactive WeakMap，再以同一键 set 对象代理值和 delete。
     * 记录 undefined→原值代理→undefined，验证对象代理键读写兼容及深层 value 包装。
     */
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

    /**
     * effect 读取 reactive WeakMap 上不存在的 customProp，再写入字符串。
     * 记录保持 undefined，验证弱集合 handler 不追踪额外对象属性。
     */
    it('should not observe custom property mutations', () => {
      let dummy
      const map: any = reactive(new WeakMap())
      effect(() => (dummy = map.customProp))

      expect(dummy).toBe(undefined)
      map.customProp = 'Hello World'
      expect(dummy).toBe(undefined)
    })

    /**
     * spy effect get 一个对象键，依次新增 undefined、改字符串、同值重设、删除、重复删除。
     * 新增 undefined 会增加一次计数，只有有效改值/删除继续增加，总计 4，验证存在性变化不同于同值写入。
     */
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

    /**
     * effect 经 toRaw(map).get 读取对象键，再通过代理 set/delete。
     * 记录始终 undefined，验证原生 WeakMap get 不建立代理依赖。
     */
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

    /**
     * 向深 reactive WeakMap 的普通对象键写入一个普通 reactive 对象值。
     * 原 WeakMap 的值等于 toRaw(value) 且不同于代理，验证深集合 value 保存 raw；本例键本来就是 raw。
     */
    it('should not pollute original Map with Proxies', () => {
      const map = new WeakMap()
      const observed = reactive(map)
      const key = {}
      const value = reactive({})
      observed.set(key, value)
      expect(map.get(key)).not.toBe(value)
      expect(map.get(key)).toBe(toRaw(value))
    })

    /**
     * 空 reactive WeakMap 用普通对象键保存普通对象值，再 get。
     * 返回对象被代理且 toRaw 等于输入值，验证弱集合对象 value 的惰性深层转换。
     */
    it('should return observable versions of contained values', () => {
      const observed = reactive(new WeakMap())
      const key = {}
      const value = {}
      observed.set(key, value)
      const wrapped = observed.get(key)
      expect(isReactive(wrapped)).toBe(true)
      expect(toRaw(wrapped)).toBe(value)
    })

    /**
     * reactive WeakMap 预存 { a: 1 }，effect 经 get 读取 a，再通过返回对象修改 a=2。
     * 记录变为 2，验证弱集合 get 返回的对象代理能建立嵌套字段依赖。
     */
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

    /**
     * 原生 WeakMap 预存 NaN，spy effect 直接 get 原生对象，再把同键值写成 NaN。
     * spy 始终一次，因为此夹具从未创建代理或登记依赖；本例不能用于证明 reactive 的 Object.is 去重。
     */
    it('should not be trigger when the value and the old value both are NaN', () => {
      const map = new WeakMap()
      const key = {}
      map.set(key, NaN)
      const mapSpy = vi.fn(() => map.get(key))
      effect(mapSpy)
      map.set(key, NaN)
      expect(mapSpy).toHaveBeenCalledTimes(1)
    })
    /**
     * 空 reactive WeakMap 执行 set({},'a') 并保存返回值。
     * 返回值等于集合代理自身，验证链式 set 约定保留代理 receiver。
     */
    it('should return proxy from WeakMap.set call', () => {
      const map = reactive(new WeakMap())
      const result = map.set({}, 'a')
      expect(result).toBe(map)
    })
  })
})
