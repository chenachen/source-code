import {
  isReactive,
  isShallow,
  reactive,
  shallowReactive,
  shallowReadonly,
} from '../src/reactive'

import { effect } from '../src/effect'
import { type Ref, isRef, ref } from '../src/ref'

describe('shallowReactive', () => {
  /**
   * 浅响应式对象 n 保存普通 { foo: 1 }，读取 n 后检查代理标记。
   * isReactive(n) 为 false，验证根层代理不递归转换普通嵌套值。
   */
  test('should not make non-reactive properties reactive', () => {
    const props = shallowReactive({ n: { foo: 1 } })
    expect(isReactive(props.n)).toBe(false)
  })

  /**
   * 浅响应式对象 n 起初是一个 reactive 对象，再将 n 替换为另一个 reactive 对象。
   * 读取 n 仍为响应式，验证浅层写入与读取保留已有代理模式。
   */
  test('should keep reactive properties reactive', () => {
    const props: any = shallowReactive({ n: reactive({ foo: 1 }) })
    props.n = reactive({ foo: 2 })
    expect(isReactive(props.n)).toBe(true)
  })

  // #2843
  /**
   * 同一 raw 含 foo 对象，分别创建 shallowReactive 与 reactive 两个入口。
   * 代理引用不同，浅入口 foo 非响应式而深入口 foo 响应式，验证深浅缓存与读取策略分离。
   */
  test('should allow shallow and normal reactive for same target', () => {
    const original = { foo: {} }
    const shallowProxy = shallowReactive(original)
    const reactiveProxy = reactive(original)
    expect(shallowProxy).not.toBe(reactiveProxy)
    expect(isReactive(shallowProxy.foo)).toBe(false)
    expect(isReactive(reactiveProxy.foo)).toBe(true)
  })

  /**
   * 对 shallowReactive({}) 和 shallowReadonly({}) 调用 isShallow。
   * 两项均为 true，验证两个浅层普通对象代理的标记；本例未检查深代理或集合。
   */
  test('isShallow', () => {
    expect(isShallow(shallowReactive({}))).toBe(true)
    expect(isShallow(shallowReadonly({}))).toBe(true)
  })

  // #5271
  /**
   * 深 reactive 对象 foo 起初保存 shallowReactive({ bar: {} })，再替换为新浅代理。
   * 替换前后 foo 保持浅标记、bar 非响应式，验证深层对象 set/get 保留浅对象代理身份。
   */
  test('should respect shallow reactive nested inside reactive on reset', () => {
    const r = reactive({ foo: shallowReactive({ bar: {} }) })
    expect(isShallow(r.foo)).toBe(true)
    expect(isReactive(r.foo.bar)).toBe(false)

    r.foo = shallowReactive({ bar: {} })
    expect(isShallow(r.foo)).toBe(true)
    expect(isReactive(r.foo.bar)).toBe(false)
  })

  // vuejs/vue#12597
  /**
   * 浅响应式对象根属性 bar 保存 ref(123)，读取 bar 和 bar.value。
   * bar 仍是 Ref 且 value 为 123，验证浅 getter 不自动解包根属性 Ref。
   */
  test('should not unwrap refs', () => {
    const foo = shallowReactive({
      bar: ref(123),
    })
    expect(isRef(foo.bar)).toBe(true)
    expect(foo.bar.value).toBe(123)
  })

  // vuejs/vue#12688
  /**
   * 浅响应式对象 bar 起初保存 ref(123)，再直接给 bar 赋数值 234。
   * 槽位变成 234，而原 Ref.value 仍为 123，验证浅 set 替换槽位而不向旧 Ref 转发赋值。
   */
  test('should not mutate refs', () => {
    const original = ref(123)
    const foo = shallowReactive<{
      /** 允许 Ref 与普通数值交替保存的浅层槽位，供断言普通赋值替换槽位而不修改旧 Ref.value。 */ bar:
        Ref<number> | number
    }>({
      bar: original,
    })
    expect(foo.bar).toBe(original)
    foo.bar = 234
    expect(foo.bar).toBe(234)
    expect(original.value).toBe(123)
  })

  /**
   * 同一 raw 已有浅、深两个代理，再将这两个代理分别放进深 reactive 对象。
   * 读回引用各等于原浅/深代理，验证嵌套访问不会将同 target 的两种输入模式混为一项。
   */
  test('should respect shallow/deep versions of same target on access', () => {
    const original = {}
    const shallow = shallowReactive(original)
    const deep = reactive(original)
    const r = reactive({ shallow, deep })
    expect(r.shallow).toBe(shallow)
    expect(r.deep).toBe(deep)
  })

  describe('collections', () => {
    /**
     * 空 shallowReactive Set 的 size 被 effect 读取，随后 add、delete 同一对象。
     * 记录 0→1→0，验证浅模式仅限制成员转换，集合自身的结构依赖仍响应变化。
     */
    test('should be reactive', () => {
      const shallowSet = shallowReactive(new Set())
      const a = {}
      let size

      effect(() => {
        size = shallowSet.size
      })

      expect(size).toBe(0)

      shallowSet.add(a)
      expect(size).toBe(1)

      shallowSet.delete(a)
      expect(size).toBe(0)
    })

    /**
     * 空浅响应式 Set 加入普通对象，再用展开迭代取首项。
     * 产出成员非响应式，验证 Set 默认迭代在浅模式返回原值。
     */
    test('should not observe when iterating', () => {
      const shallowSet = shallowReactive(new Set())
      const a = {}
      shallowSet.add(a)

      const spreadA = [...shallowSet][0]
      expect(isReactive(spreadA)).toBe(false)
    })

    /**
     * 空浅响应式 Map 用字符串键保存普通对象，再 get 该键。
     * 返回值非响应式，验证浅集合 get 不深层包装新写入的值。
     */
    test('should not get reactive entry', () => {
      const shallowMap = shallowReactive(new Map())
      const a = {}
      const key = 'a'

      shallowMap.set(key, a)

      expect(isReactive(shallowMap.get(key))).toBe(false)
    })

    /**
     * 空浅响应式 Set 加入普通对象，再 forEach 检查回调成员。
     * 成员非响应式，验证 forEach 的浅模式回调参数保持原值。
     */
    test('should not get reactive on foreach', () => {
      const shallowSet = shallowReactive(new Set())
      const a = {}
      shallowSet.add(a)

      shallowSet.forEach(x => expect(isReactive(x)).toBe(false))
    })

    /**
     * 浅响应式 Map 初始键和后续 set 的键都保存同一个 reactive 对象。
     * get 两个键都返回响应式值，验证浅模式保留已有代理，不因初始/后续写入而还原为 raw。
     */
    test('Setting a reactive object on a shallowReactive map', () => {
      const msg = ref('ads')
      const bar = reactive({ msg })
      const foo = shallowReactive(new Map([['foo1', bar]]))
      foo.set('foo2', bar)

      expect(isReactive(foo.get('foo2'))).toBe(true)
      expect(isReactive(foo.get('foo1'))).toBe(true)
    })

    /**
     * 浅响应式 Set 起初保存一个 reactive 对象，再添加另一个 reactive 对象。
     * forEach 的两个成员均响应式，验证浅集合成员写入与迭代保留已有代理。
     */
    test('Setting a reactive object on a shallowReactive set', () => {
      const msg = ref(1)
      const bar = reactive({ msg })
      const foo = reactive({ msg })

      const deps = shallowReactive(new Set([bar]))
      deps.add(foo)

      deps.forEach(dep => {
        expect(isReactive(dep)).toBe(true)
      })
    })

    // #1210
    /**
     * effect 配置 onTrack，调用 Array.from 收集空浅响应式 Set。
     * 结果为空数组且 onTrack 被调用，验证此处实际发生的是集合迭代依赖追踪。
     */
    test('onTrack on called on objectSpread', () => {
      const onTrackFn = vi.fn()
      const shallowSet = shallowReactive(new Set())
      let a
      effect(
        () => {
          a = Array.from(shallowSet)
        },
        {
          onTrack: onTrackFn,
        },
      )

      expect(a).toMatchObject([])
      expect(onTrackFn).toHaveBeenCalled()
    })
  })

  describe('array', () => {
    /**
     * 空浅响应式数组的 length 被 effect 读取，随后 push 普通对象再 pop。
     * 记录 0→1→0，验证浅数组自身的长度变化仍能触发依赖。
     */
    test('should be reactive', () => {
      const shallowArray = shallowReactive<unknown[]>([])
      const a = {}
      let size

      effect(() => {
        size = shallowArray.length
      })

      expect(size).toBe(0)

      shallowArray.push(a)
      expect(size).toBe(1)

      shallowArray.pop()
      expect(size).toBe(0)
    })

    /**
     * 向空浅响应式数组 push 普通对象，再用展开迭代取首项。
     * 元素非响应式，验证浅数组的迭代出口不递归包装对象。
     */
    test('should not observe when iterating', () => {
      const shallowArray = shallowReactive<object[]>([])
      const a = {}
      shallowArray.push(a)

      const spreadA = [...shallowArray][0]
      expect(isReactive(spreadA)).toBe(false)
    })

    /**
     * effect 配置 onTrack，调用 Array.from 收集空浅响应式数组。
     * 结果为空数组且 onTrack 被调用，验证数组迭代仍建立依赖。
     */
    test('onTrack on called on objectSpread', () => {
      const onTrackFn = vi.fn()
      const shallowArray = shallowReactive([])
      let a
      effect(
        () => {
          a = Array.from(shallowArray)
        },
        {
          onTrack: onTrackFn,
        },
      )

      expect(a).toMatchObject([])
      expect(onTrackFn).toHaveBeenCalled()
    })
  })
})
