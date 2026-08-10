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
  // 场景：浅响应式对象包含普通嵌套对象；验证嵌套值不会被递归转换为响应式代理。
  test('should not make non-reactive properties reactive', () => {
    const props = shallowReactive({ n: { foo: 1 } })
    expect(isReactive(props.n)).toBe(false)
  })

  // 场景：浅响应式对象接收已有响应式值；验证读取时仍保留原响应式代理身份。
  test('should keep reactive properties reactive', () => {
    const props: any = shallowReactive({ n: reactive({ foo: 1 }) })
    props.n = reactive({ foo: 2 })
    expect(isReactive(props.n)).toBe(true)
  })

  // #2843
  // 场景：同一原始对象分别创建浅层和深层代理；验证两种模式可共存且各自缓存。
  test('should allow shallow and normal reactive for same target', () => {
    const original = { foo: {} }
    const shallowProxy = shallowReactive(original)
    const reactiveProxy = reactive(original)
    expect(shallowProxy).not.toBe(reactiveProxy)
    expect(isReactive(shallowProxy.foo)).toBe(false)
    expect(isReactive(reactiveProxy.foo)).toBe(true)
  })

  // 场景：检查浅层与深层响应式值；验证 isShallow 只识别浅层代理。
  test('isShallow', () => {
    expect(isShallow(shallowReactive({}))).toBe(true)
    expect(isShallow(shallowReadonly({}))).toBe(true)
  })

  // #5271
  // 场景：深层响应式对象重新写入浅层代理；验证浅层边界不会在重设后丢失。
  test('should respect shallow reactive nested inside reactive on reset', () => {
    const r = reactive({ foo: shallowReactive({ bar: {} }) })
    expect(isShallow(r.foo)).toBe(true)
    expect(isReactive(r.foo.bar)).toBe(false)

    r.foo = shallowReactive({ bar: {} })
    expect(isShallow(r.foo)).toBe(true)
    expect(isReactive(r.foo.bar)).toBe(false)
  })

  // vuejs/vue#12597
  // 场景：浅响应式对象根属性保存 Ref；验证读取属性时保留 Ref 而不自动解包。
  test('should not unwrap refs', () => {
    const foo = shallowReactive({
      bar: ref(123),
    })
    expect(isRef(foo.bar)).toBe(true)
    expect(foo.bar.value).toBe(123)
  })

  // vuejs/vue#12688
  // 场景：给浅响应式对象中原为 Ref 的属性赋普通值；验证替换槽位而非修改 ref.value。
  test('should not mutate refs', () => {
    const original = ref(123)
    const foo = shallowReactive<{ bar: Ref<number> | number }>({
      bar: original,
    })
    expect(foo.bar).toBe(original)
    foo.bar = 234
    expect(foo.bar).toBe(234)
    expect(original.value).toBe(123)
  })

  // 场景：同一目标同时存在浅/深代理并被嵌套访问；验证访问结果遵守各自转换深度。
  test('should respect shallow/deep versions of same target on access', () => {
    const original = {}
    const shallow = shallowReactive(original)
    const deep = reactive(original)
    const r = reactive({ shallow, deep })
    expect(r.shallow).toBe(shallow)
    expect(r.deep).toBe(deep)
  })

  describe('collections', () => {
    // 场景：对 Map 创建浅响应式代理；验证集合本身具备响应式身份和根层追踪能力。
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

    // 场景：迭代浅响应式 Map 中的对象值；验证产出值不会被递归代理。
    test('should not observe when iterating', () => {
      const shallowSet = shallowReactive(new Set())
      const a = {}
      shallowSet.add(a)

      const spreadA = [...shallowSet][0]
      expect(isReactive(spreadA)).toBe(false)
    })

    // 场景：通过 get 读取浅响应式 Map 的对象值；验证返回原值而非响应式代理。
    test('should not get reactive entry', () => {
      const shallowMap = shallowReactive(new Map())
      const a = {}
      const key = 'a'

      shallowMap.set(key, a)

      expect(isReactive(shallowMap.get(key))).toBe(false)
    })

    // 场景：通过浅响应式 Map.forEach 读取对象值；验证回调参数保持浅层语义。
    test('should not get reactive on foreach', () => {
      const shallowSet = shallowReactive(new Set())
      const a = {}
      shallowSet.add(a)

      shallowSet.forEach(x => expect(isReactive(x)).toBe(false))
    })

    // 场景：向浅响应式 Map 写入已有响应式对象；验证写入和读取都保留该代理身份。
    test('Setting a reactive object on a shallowReactive map', () => {
      const msg = ref('ads')
      const bar = reactive({ msg })
      const foo = shallowReactive(new Map([['foo1', bar]]))
      foo.set('foo2', bar)

      expect(isReactive(foo.get('foo2'))).toBe(true)
      expect(isReactive(foo.get('foo1'))).toBe(true)
    })

    // 场景：向浅响应式 Set 添加已有响应式对象；验证集合不会把成员还原为 raw。
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
    // 场景：对浅响应式 Map 执行对象展开式读取；验证 onTrack 收到正确遍历事件。
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
    // 场景：对 Set 创建浅响应式代理；验证集合自身仍可被 effect 追踪。
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

    // 场景：迭代浅响应式 Set 的对象成员；验证成员不会被递归转换。
    test('should not observe when iterating', () => {
      const shallowArray = shallowReactive<object[]>([])
      const a = {}
      shallowArray.push(a)

      const spreadA = [...shallowArray][0]
      expect(isReactive(spreadA)).toBe(false)
    })

    // 场景：对浅响应式 Set 执行对象展开式读取；验证 onTrack 的遍历事件正确。
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
