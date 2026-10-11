import {
  type TestElement,
  defineComponent,
  h,
  nextTick,
  nodeOps,
  onMounted,
  onUnmounted,
  render,
  serializeInner,
  triggerEvent,
} from '@vue/runtime-test'
import {
  type DebuggerEvent,
  ITERATE_KEY,
  TrackOpTypes,
  TriggerOpTypes,
  type WritableComputedRef,
  computed,
  effect,
  isReadonly,
  reactive,
  ref,
  shallowRef,
  toRaw,
  triggerRef,
} from '../src'
import { EffectFlags, pauseTracking, resetTracking } from '../src/effect'
import type { ComputedRef, ComputedRefImpl } from '../src/computed'

describe('reactivity/computed', () => {
  /**
   * 响应式空对象的 foo 尚未定义，computed 读取 foo 得到 undefined；新增 foo = 1 后再读得到 1，验证属性新增能使按需计算返回新值。
   */
  it('should return updated value', () => {
    const value = reactive<{
      /** 可选数值源属性，初始缺失以覆盖属性新增后的计算更新。 */
      foo?: number
    }>({})
    const cValue = computed(() => value.foo)
    expect(cValue.value).toBe(undefined)
    value.foo = 1
    expect(cValue.value).toBe(1)
  })

  /**
   * 以 count = 0 创建 computed，并让 getter 把收到的旧值写入 oldValue；首次读取收到 undefined，count 改为 1 后读取收到旧结果 0，验证 getter 的 previous 参数传递缓存值。
   */
  it('pass oldValue to computed getter', () => {
    const count = ref(0)
    const oldValue = ref()
    const curValue = computed(pre => {
      oldValue.value = pre
      return count.value
    })
    expect(curValue.value).toBe(0)
    expect(oldValue.value).toBe(undefined)
    count.value++
    expect(curValue.value).toBe(1)
    expect(oldValue.value).toBe(0)
  })

  /**
   * 为响应式空对象的 foo 配置 getter spy；创建 computed 不求值，首次读取求值一次，重复读取复用缓存，foo 改为 1 也要等下一次读取才求值第二次，验证惰性求值与缓存失效。
   */
  it('should compute lazily', () => {
    const value = reactive<{
      /** 可选数值源属性，用于区分创建、读取和失效后的惰性求值。 */
      foo?: number
    }>({})
    const getter = vi.fn(() => value.foo)
    const cValue = computed(getter)

    // 创建计算属性不执行 getter，首次读取才执行。
    expect(getter).not.toHaveBeenCalled()

    expect(cValue.value).toBe(undefined)
    expect(getter).toHaveBeenCalledTimes(1)

    // 依赖未变，重复读取复用计算缓存。
    cValue.value
    expect(getter).toHaveBeenCalledTimes(1)

    // 源变化先使缓存失效，尚未读取时不执行 getter。
    value.foo = 1
    expect(getter).toHaveBeenCalledTimes(1)

    // 此次读取才重新执行 getter，取得最新值。
    expect(cValue.value).toBe(1)
    expect(getter).toHaveBeenCalledTimes(2)

    // 依赖未变，重复读取复用计算缓存。
    cValue.value
    expect(getter).toHaveBeenCalledTimes(2)
  })

  /**
   * computed 读取响应式空对象的 foo，effect 把 computed.value 写入 dummy；初始为 undefined，新增 foo = 1 后 dummy 同步变为 1，验证 computed 的下游订阅能收到更新。
   */
  it('should trigger effect', () => {
    const value = reactive<{
      /** 可选数值源属性，由计算属性转发给下游 effect。 */
      foo?: number
    }>({})
    const cValue = computed(() => value.foo)
    let dummy
    effect(() => {
      dummy = cValue.value
    })
    expect(dummy).toBe(undefined)
    value.foo = 1
    expect(dummy).toBe(1)
  })

  /**
   * 以 foo = 0 建立 c1 = foo、c2 = c1 + 1 的计算链；先读得到 0、1，foo 自增后再读得到 1、2，验证逐层按需刷新。
   */
  it('should work when chained', () => {
    const value = reactive({ foo: 0 })
    const c1 = computed(() => value.foo)
    const c2 = computed(() => c1.value + 1)
    expect(c2.value).toBe(1)
    expect(c1.value).toBe(0)
    value.foo++
    expect(c2.value).toBe(2)
    expect(c1.value).toBe(1)
  })

  /**
   * 以 foo = 0 建立两层计算链，并让 effect 读取末端 c2；foo 自增后 dummy 从 1 变为 2，两层 getter 均由一次增至两次，验证链式通知和刷新次数。
   */
  it('should trigger effect when chained', () => {
    const value = reactive({ foo: 0 })
    const getter1 = vi.fn(() => value.foo)
    const getter2 = vi.fn(() => {
      return c1.value + 1
    })
    const c1 = computed(getter1)
    const c2 = computed(getter2)

    let dummy
    effect(() => {
      dummy = c2.value
    })
    expect(dummy).toBe(1)
    expect(getter1).toHaveBeenCalledTimes(1)
    expect(getter2).toHaveBeenCalledTimes(1)
    value.foo++
    expect(dummy).toBe(2)
    // 同一轮上游变化后，每层 getter 只新增一次调用。
    expect(getter1).toHaveBeenCalledTimes(2)
    expect(getter2).toHaveBeenCalledTimes(2)
  })

  /**
   * effect 同时读取 c1 和依赖 c1 的 c2，初始 foo = 0 时和为 1；foo 自增后和为 3，两层 getter 各只新增一次调用，验证同一轮混合订阅不会重复求值。
   */
  it('should trigger effect when chained (mixed invocations)', () => {
    const value = reactive({ foo: 0 })
    const getter1 = vi.fn(() => value.foo)
    const getter2 = vi.fn(() => {
      return c1.value + 1
    })
    const c1 = computed(getter1)
    const c2 = computed(getter2)

    let dummy
    effect(() => {
      dummy = c1.value + c2.value
    })
    expect(dummy).toBe(1)

    expect(getter1).toHaveBeenCalledTimes(1)
    expect(getter2).toHaveBeenCalledTimes(1)
    value.foo++
    expect(dummy).toBe(3)
    // 同一轮上游变化后，每层 getter 只新增一次调用。
    expect(getter1).toHaveBeenCalledTimes(2)
    expect(getter2).toHaveBeenCalledTimes(2)
  })

  /**
   * n 初始为 1，可写 computed 的 getter 返回 n + 1、setter 写入 val - 1；n 自增后读取为 3，给 computed 赋 0 后 n 为 -1，验证读写转换双向成立。
   */
  it('should support setter', () => {
    const n = ref(1)
    const plusOne = computed({
      /**
       * 返回 n.value + 1，为可写计算属性提供读侧转换。
       */
      get: () => n.value + 1,
      /**
       * 把写入值减 1 后存入 n.value，使 getter/setter 转换互逆。
       */
      set: val => {
        n.value = val - 1
      },
    })

    expect(plusOne.value).toBe(2)
    n.value++
    expect(plusOne.value).toBe(3)

    plusOne.value = 0
    expect(n.value).toBe(-1)
  })

  /**
   * effect 直接订阅 n = 1，可写 computed 的 setter 写入 val - 1；给 computed 赋 0 后 dummy 为 -1，验证 setter 修改源 Ref 后触发其直接订阅者。
   */
  it('should trigger effect w/ setter', () => {
    const n = ref(1)
    const plusOne = computed({
      /**
       * 返回 n.value + 1，供检查 setter 修改源时触发直接 effect。
       */
      get: () => n.value + 1,
      /**
       * 把写入值减 1 后存入 n.value，通知直接订阅 n 的 effect。
       */
      set: val => {
        n.value = val - 1
      },
    })

    let dummy
    effect(() => {
      dummy = n.value
    })
    expect(dummy).toBe(1)

    plusOne.value = 0
    expect(dummy).toBe(-1)
  })

  // #5720
  /**
   * effect 同时读 n 和 n + 1 的 computed，先额外读取 computed 使其缓存有效；n 从 0 自增后记录结果由 [1] 变为 [1, 2]，验证 effect 重跑时读取到已刷新的计算值。
   */
  it('should invalidate before non-computed effects', () => {
    let plusOneValues: number[] = []
    const n = ref(0)
    const plusOne = computed(() => n.value + 1)
    effect(() => {
      n.value
      plusOneValues.push(plusOne.value)
    })
    // 先读取 plusOne，使其计算缓存有效。
    plusOne.value
    // 修改源 Ref，触发重新检查计算链。
    n.value++
    // effect 第二次运行时应读到更新后的 plusOne 值。
    expect(plusOneValues).toMatchObject([1, 2])
  })

  /**
   * 以 n = 1 创建仅有 getter 的 computed，并通过类型断言对 value 自增；断言出现只读写入警告，验证开发模式拒绝无 setter 的写入。
   */
  it('should warn if trying to set a readonly computed', () => {
    const n = ref(1)
    const plusOne = computed(() => n.value + 1)
    ;(plusOne as WritableComputedRef<number>).value++ // 用类型断言绕过静态只读限制，以检查运行时警告。

    expect(
      'Write operation failed: computed value is readonly',
    ).toHaveBeenWarnedLast()
  })

  /**
   * 以普通对象 a = { a: 1 } 创建只读 computed x 与带 getter/setter 的 computed z；x 为 readonly，但 x.value、其数字字段以及 z 都不为 readonly，验证 computed 的只读品牌不自动把返回对象变为只读代理。
   */
  it('should be readonly', () => {
    let a = { a: 1 }
    const x = computed(() => a)
    expect(isReadonly(x)).toBe(true)
    expect(isReadonly(x.value)).toBe(false)
    expect(isReadonly(x.value.a)).toBe(false)
    const z = computed<typeof a>({
      /**
       * 返回当前普通对象 a，供可写 computed 的只读品牌检查。
       */
      get() {
        return a
      },
      /**
       * 把输入对象替换到普通变量 a，提供可写 computed 的 setter。
       */
      set(v) {
        a = v
      },
    })
    expect(isReadonly(z)).toBe(false)
    expect(isReadonly(z.value.a)).toBe(false)
  })

  /**
   * computed 的 getter 读取 foo、检查 bar 是否存在并枚举对象键；首次求值触发三条 onTrack 事件，逐条核对 GET、HAS、ITERATE 的键、原始对象和 computed 实例，验证依赖调试信息。
   */
  it('debug: onTrack', () => {
    let events: DebuggerEvent[] = []
    const onTrack = vi.fn((e: DebuggerEvent) => {
      events.push(e)
    })
    const obj = reactive({ foo: 1, bar: 2 })
    const c = computed(() => (obj.foo, 'bar' in obj, Object.keys(obj)), {
      onTrack,
    })
    expect(c.value).toEqual(['foo', 'bar'])
    expect(onTrack).toHaveBeenCalledTimes(3)
    expect(events).toEqual([
      {
        effect: c,
        target: toRaw(obj),
        type: TrackOpTypes.GET,
        key: 'foo',
      },
      {
        effect: c,
        target: toRaw(obj),
        type: TrackOpTypes.HAS,
        key: 'bar',
      },
      {
        effect: c,
        target: toRaw(obj),
        type: TrackOpTypes.ITERATE,
        key: ITERATE_KEY,
      },
    ])
  })

  /**
   * foo = 1 的 computed 先由 effect 订阅，再自增和删除 foo；分别得到 2 和 undefined，并核对 onTrigger 的 SET、DELETE 事件及新旧值，验证响应式属性的计算订阅调试事件。
   */
  it('debug: onTrigger (reactive)', () => {
    let events: DebuggerEvent[] = []
    const onTrigger = vi.fn((e: DebuggerEvent) => {
      events.push(e)
    })
    const obj = reactive<{
      /** 可删除的数值源属性，用于核对 SET 与 DELETE 调试事件。 */
      foo?: number
    }>({ foo: 1 })
    const c = computed(() => obj.foo, { onTrigger })

    // 先加入下游订阅，使 computed 连入上游通知链后再检查 onTrigger。
    effect(() => c.value)

    obj.foo!++
    expect(c.value).toBe(2)
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(events[0]).toEqual({
      effect: c,
      target: toRaw(obj),
      type: TriggerOpTypes.SET,
      key: 'foo',
      oldValue: 1,
      newValue: 2,
    })

    delete obj.foo
    expect(c.value).toBeUndefined()
    expect(onTrigger).toHaveBeenCalledTimes(2)
    expect(events[1]).toEqual({
      effect: c,
      target: toRaw(obj),
      type: TriggerOpTypes.DELETE,
      key: 'foo',
      oldValue: 2,
    })
  })

  // https://github.com/vuejs/core/pull/5912#issuecomment-1497596875
  /**
   * a 保存 { v: 1 }，计算链先读对象再按对象是否存在选择 v；先把 v 改为 2，再把 a 改为 null，读取末端时 cSpy 仍只调用一次，验证脏检查按依赖顺序避免执行已经失去意义的分支。
   */
  it('should query deps dirty sequentially', () => {
    const cSpy = vi.fn()

    const a = ref<null | {
      /** 对象分支中的数值字段；外层 Ref 可切换为 null 来移除此分支。 */
      v: number
    }>({
      v: 1,
    })
    const b = computed(() => {
      return a.value
    })
    const c = computed(() => {
      cSpy()
      return b.value?.v
    })
    const d = computed(() => {
      if (b.value) {
        return c.value
      }
      return 0
    })

    d.value
    a.value!.v = 2
    a.value = null
    d.value
    expect(cSpy).toHaveBeenCalledTimes(1)
  })

  // https://github.com/vuejs/core/pull/5912#issuecomment-1738257692
  /**
   * items 初始为 undefined，isLoaded 和 msg 构成计算链并由 effect 订阅；依次赋入数组、另一份等内容数组、undefined，最终 msg 为 The items are not loaded，验证中间计算值不变时后续依赖仍能正确更新。
   */
  it('chained computed dirty reallocation after querying dirty', () => {
    let _msg: string | undefined

    const items = ref<number[]>()
    const isLoaded = computed(() => {
      return !!items.value
    })
    const msg = computed(() => {
      if (isLoaded.value) {
        return 'The items are loaded'
      } else {
        return 'The items are not loaded'
      }
    })

    effect(() => {
      _msg = msg.value
    })

    items.value = [1, 2, 3]
    items.value = [1, 2, 3]
    items.value = undefined

    expect(_msg).toBe('The items are not loaded')
  })

  /**
   * items 初始为 undefined，手动读取 msg 建立缓存；赋数组后先读 isLoaded 再读 msg，最后把 items 置为 undefined 并读 msg 得到 The items are not loaded，验证分步手动刷新后的链式失效。
   */
  it('chained computed dirty reallocation after trigger computed getter', () => {
    let _msg: string | undefined

    const items = ref<number[]>()
    const isLoaded = computed(() => {
      return !!items.value
    })
    const msg = computed(() => {
      if (isLoaded.value) {
        return 'The items are loaded'
      } else {
        return 'The items are not loaded'
      }
    })

    _msg = msg.value
    items.value = [1, 2, 3]
    isLoaded.value // 先单独刷新中间计算属性。
    _msg = msg.value
    items.value = undefined
    _msg = msg.value

    expect(_msg).toBe('The items are not loaded')
  })

  // https://github.com/vuejs/core/pull/5912#issuecomment-1739159832
  /**
   * 以 a = 0 建立按模 3 结果切换的计算链；a 自增为 1 后读取 e，断言依赖顺序为 b、d、c，cSpy 累计两次；再自增为 2 后 e 由 d 分支绕过 c，cSpy 保持两次，验证按最新读取顺序检查依赖。
   */
  it('deps order should be consistent with the last time get value', () => {
    const cSpy = vi.fn()

    const a = ref(0)
    const b = computed(() => {
      return a.value % 3 !== 0
    }) as unknown as ComputedRefImpl
    const c = computed(() => {
      cSpy()
      if (a.value % 3 === 2) {
        return 'expensive'
      }
      return 'cheap'
    }) as unknown as ComputedRefImpl
    const d = computed(() => {
      return a.value % 3 === 2
    }) as unknown as ComputedRefImpl
    const e = computed(() => {
      if (b.value) {
        if (d.value) {
          return 'Avoiding expensive calculation'
        }
      }
      return c.value
    }) as unknown as ComputedRefImpl

    e.value
    a.value++
    e.value

    expect(e.deps!.dep).toBe(b.dep)
    expect(e.deps!.nextDep!.dep).toBe(d.dep)
    expect(e.deps!.nextDep!.nextDep!.dep).toBe(c.dep)
    expect(cSpy).toHaveBeenCalledTimes(2)

    a.value++
    e.value

    expect(cSpy).toHaveBeenCalledTimes(2)
  })

  /**
   * src1、src2 初始为 0，c3 同时读取 c1 = src1 和 c2 = src1 % 2 + src2；把 src1 设为 2 后读 c3，再把 src2 设为 1 后读 c3，cSpy 共执行三次，验证后一轮第一个依赖未变时仍检查第二个依赖。
   */
  it('should trigger by the second computed that maybe dirty', () => {
    const cSpy = vi.fn()

    const src1 = ref(0)
    const src2 = ref(0)
    const c1 = computed(() => src1.value)
    const c2 = computed(() => (src1.value % 2) + src2.value)
    const c3 = computed(() => {
      cSpy()
      c1.value
      c2.value
    })

    c3.value
    src1.value = 2
    c3.value
    expect(cSpy).toHaveBeenCalledTimes(2)
    src2.value = 1
    c3.value
    expect(cSpy).toHaveBeenCalledTimes(3)
  })

  /**
   * 两个 effect 订阅同一个由 v = 1 派生的 computed；把 v 改为 2 后第二个 effect 的 spy 从一次变为两次，验证多个订阅者都能收到计算值变化。
   */
  it('should trigger the second effect', () => {
    const fnSpy = vi.fn()
    const v = ref(1)
    const c = computed(() => v.value)

    effect(() => {
      c.value
    })
    effect(() => {
      c.value
      fnSpy()
    })

    expect(fnSpy).toBeCalledTimes(1)
    v.value = 2
    expect(fnSpy).toBeCalledTimes(2)
  })

  /**
   * 以 v = 1 建立两层 computed 并手动读取末端；断言两层的 DIRTY 标志均被清除，验证完成读取后的计算链状态。
   */
  it('should chained recursive effects clear dirty after trigger', () => {
    const v = ref(1)
    const c1 = computed(() => v.value) as unknown as ComputedRefImpl
    const c2 = computed(() => c1.value) as unknown as ComputedRefImpl

    c2.value
    expect(c1.flags & EffectFlags.DIRTY).toBeFalsy()
    expect(c2.flags & EffectFlags.DIRTY).toBeFalsy()
  })

  /**
   * 三层 computed 的第一层在 v = 0 时把 v 改为 1；读取末端以覆盖求值中修改上游的路径。当前只执行末端读取，值、标志与历史警告都没有启用断言。
   */
  it('should chained computeds dirtyLevel update with first computed effect', () => {
    const v = ref(0)
    const c1 = computed(() => {
      if (v.value === 0) {
        v.value = 1
      }
      return v.value
    })
    const c2 = computed(() => c1.value)
    const c3 = computed(() => c2.value)

    c3.value
    // expect(COMPUTED_SIDE_EFFECT_WARN).toHaveBeenWarned()
  })

  /**
   * c1 首次求值把 v 从 0 改为 1 并返回 foo，c2 先读 v 再读 c1；连续两次读 c2 分别得到 0foo 和 1foo，验证 getter 内写入后后续读取刷新先前缓存。
   */
  it('should work when chained(ref+computed)', () => {
    const v = ref(0)
    const c1 = computed(() => {
      if (v.value === 0) {
        v.value = 1
      }
      return 'foo'
    })
    const c2 = computed(() => v.value + c1.value)
    expect(c2.value).toBe('0foo')
    expect(c2.value).toBe('1foo')
    // expect(COMPUTED_SIDE_EFFECT_WARN).toHaveBeenWarned()
  })

  /**
   * effect 订阅先读取 v、再读取会把 v 从 0 改为 1 的 c1 的 c2；首次结果为 0foo，再把 v 改为 2 后 spy 第二次调用且结果为 2foo，验证求值中产生过更新后外部写入仍能通知下游。
   */
  it('should trigger effect even computed already dirty', () => {
    const fnSpy = vi.fn()
    const v = ref(0)
    const c1 = computed(() => {
      if (v.value === 0) {
        v.value = 1
      }
      return 'foo'
    })
    const c2 = computed(() => v.value + c1.value)

    effect(() => {
      fnSpy(c2.value)
    })
    expect(fnSpy).toBeCalledTimes(1)
    expect(fnSpy.mock.calls).toMatchObject([['0foo']])
    expect(v.value).toBe(1)
    v.value = 2
    expect(fnSpy).toBeCalledTimes(2)
    expect(fnSpy.mock.calls).toMatchObject([['0foo'], ['2foo']])
    expect(v.value).toBe(2)
    // expect(COMPUTED_SIDE_EFFECT_WARN).toHaveBeenWarned()
  })

  // #10185
  /**
   * c1 创建带内部 Ref 的 Item 并存入 shallowRef，c2 受布尔开关控制，c3 包装 c2；开关打开后仍读 no，再把 Item.v 改为 999 后读 yes，验证求值中建立的新依赖继续有效。
   */
  it('should not override queried MaybeDirty result', () => {
    /**
     * 携带独立内部 Ref 的测试模型，用于计算过程中新建依赖。
     */
    class Item {
      /**
       * 新实例从 0 开始的内部 Ref；写入 999 后，供后续读取计算链时检查依赖版本并刷新结果。
       */
      v = ref(0)
    }
    const v1 = shallowRef()
    const v2 = ref(false)
    const c1 = computed(() => {
      let c = v1.value
      if (!v1.value) {
        c = new Item()
        v1.value = c
      }
      return c.v.value
    })
    const c2 = computed(() => {
      if (!v2.value) return 'no'
      return c1.value ? 'yes' : 'no'
    })
    const c3 = computed(() => c2.value)

    c3.value
    v2.value = true

    c3.value
    v1.value.v.value = 999

    expect(c3.value).toBe('yes')
    // expect(COMPUTED_SIDE_EFFECT_WARN).toHaveBeenWarned()
  })

  /**
   * 组件的 computed 在 state.a 缺失时写入 1，setup 另安排 nextTick 把 a 改为 2；渲染后等待两轮 tick 得到文本 2，验证 getter 内初始化依赖后异步写入仍能更新组件。
   */
  it('should be not dirty after deps mutate (mutate deps in computed)', async () => {
    const state = reactive<any>({})
    const consumer = computed(() => {
      if (!('a' in state)) state.a = 1
      return state.a
    })
    const Comp = {
      /**
       * 安排下一 tick 把 a 设为 2，并返回读取会初始化 a 的 computed 的渲染函数。
       */
      setup: () => {
        nextTick().then(() => {
          state.a = 2
        })
        return () => consumer.value
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    await nextTick()
    await nextTick()
    expect(serializeInner(root)).toBe(`2`)
    // expect(COMPUTED_SIDE_EFFECT_WARN).toHaveBeenWarned()
  })

  /**
   * 组件读取的 computed 每次求值都给 Hello 追加 World；首次渲染为 Hello World，外部再追加一次并等待 tick 后得到含四个 World 的文本，验证这条带副作用路径仍能完成后续渲染。
   */
  it('should not trigger effect scheduler by recursive computed effect', async () => {
    const v = ref('Hello')
    const c = computed(() => {
      v.value += ' World'
      return v.value
    })
    const Comp = {
      /**
       * 返回读取带字符串追加副作用的 computed 的渲染函数。
       */
      setup: () => {
        return () => c.value
      },
    }
    const root = nodeOps.createElement('div')

    render(h(Comp), root)
    await nextTick()
    expect(serializeInner(root)).toBe('Hello World')

    v.value += ' World'
    await nextTick()
    expect(serializeInner(root)).toBe('Hello World World World World')
    // expect(COMPUTED_SIDE_EFFECT_WARN).toHaveBeenWarned()
  })

  /**
   * computed 返回 src 的奇偶值并由 effect 订阅；src 从 0 改为 2 不重跑 effect，改为 3 才重跑，再改为 5 仍不重跑，验证计算结果相同时跳过下游执行。
   */
  test('should not trigger if value did not change', () => {
    const src = ref(0)
    const c = computed(() => src.value % 2)
    const spy = vi.fn()
    effect(() => {
      spy(c.value)
    })
    expect(spy).toHaveBeenCalledTimes(1)
    src.value = 2

    // 奇偶结果未变，不重新执行下游 effect。
    expect(spy).toHaveBeenCalledTimes(1)

    src.value = 3
    src.value = 5
    // 写入 3 改变奇偶结果，执行一次；随后写入 5 的结果相同，不再执行。
    expect(spy).toHaveBeenCalledTimes(2)
  })

  /**
   * 以 src = 0 建立 c1 = src % 2、c2 = c1 + 1，并让 effect 读 c2；src 改为 1 后两个 getter 和 effect 的 spy 均由一次变为两次，验证结果改变时整条链刷新。
   */
  test('chained computed trigger', () => {
    const effectSpy = vi.fn()
    const c1Spy = vi.fn()
    const c2Spy = vi.fn()

    const src = ref(0)
    const c1 = computed(() => {
      c1Spy()
      return src.value % 2
    })
    const c2 = computed(() => {
      c2Spy()
      return c1.value + 1
    })

    effect(() => {
      effectSpy(c2.value)
    })

    expect(c1Spy).toHaveBeenCalledTimes(1)
    expect(c2Spy).toHaveBeenCalledTimes(1)
    expect(effectSpy).toHaveBeenCalledTimes(1)

    src.value = 1
    expect(c1Spy).toHaveBeenCalledTimes(2)
    expect(c2Spy).toHaveBeenCalledTimes(2)
    expect(effectSpy).toHaveBeenCalledTimes(2)
  })

  /**
   * 以 src = 0 建立奇偶计算链，依次写入 2、4、6；上游 getter 共执行四次，下游 getter 和 effect 各只一次，验证上游重算但结果不变时保留下游缓存。
   */
  test('chained computed avoid re-compute', () => {
    const effectSpy = vi.fn()
    const c1Spy = vi.fn()
    const c2Spy = vi.fn()

    const src = ref(0)
    const c1 = computed(() => {
      c1Spy()
      return src.value % 2
    })
    const c2 = computed(() => {
      c2Spy()
      return c1.value + 1
    })

    effect(() => {
      effectSpy(c2.value)
    })

    expect(effectSpy).toHaveBeenCalledTimes(1)
    src.value = 2
    src.value = 4
    src.value = 6
    expect(c1Spy).toHaveBeenCalledTimes(4)
    // c1 的结果未变，c2 的 getter 不需要重算。
    expect(c2Spy).toHaveBeenCalledTimes(1)
    // c2 的结果未变，末端 effect 不需要重跑。
    expect(effectSpy).toHaveBeenCalledTimes(1)
  })

  /**
   * effect 订阅奇偶计算链，初始末端为 1；src 从 0 改为 1 后同步读取末端为 2，c2Spy 为两次，验证同步读取不会返回已失效的链式缓存。
   */
  test('chained computed value invalidation', () => {
    const effectSpy = vi.fn()
    const c1Spy = vi.fn()
    const c2Spy = vi.fn()

    const src = ref(0)
    const c1 = computed(() => {
      c1Spy()
      return src.value % 2
    })
    const c2 = computed(() => {
      c2Spy()
      return c1.value + 1
    })

    effect(() => {
      effectSpy(c2.value)
    })

    expect(effectSpy).toHaveBeenCalledTimes(1)
    expect(effectSpy).toHaveBeenCalledWith(1)
    expect(c2.value).toBe(1)

    expect(c1Spy).toHaveBeenCalledTimes(1)
    expect(c2Spy).toHaveBeenCalledTimes(1)

    src.value = 1
    // 更新后同步读取应得到最新末端值。
    expect(c2.value).toBe(2)
    expect(c2Spy).toHaveBeenCalledTimes(2)
  })

  /**
   * effect 订阅奇偶计算链，src 改为 1 后再手动读取 c2；末端为 2，effectSpy 共两次，验证更新后的同步访问不会漏掉末端 effect 的执行。
   */
  test('sync access of invalidated chained computed should not prevent final effect from running', () => {
    const effectSpy = vi.fn()
    const c1Spy = vi.fn()
    const c2Spy = vi.fn()

    const src = ref(0)
    const c1 = computed(() => {
      c1Spy()
      return src.value % 2
    })
    const c2 = computed(() => {
      c2Spy()
      return c1.value + 1
    })

    effect(() => {
      effectSpy(c2.value)
    })
    expect(effectSpy).toHaveBeenCalledTimes(1)

    src.value = 1
    // 更新后同步读取 c2。
    c2.value
    expect(effectSpy).toHaveBeenCalledTimes(2)
  })

  /**
   * 外层 effect 在 pauseTracking 区域读取 n，并创建 computed 与内层 effect；n 自增后外层 spy 仍一次、内层为两次，验证 computed 求值会启用自己的依赖收集。
   */
  it('computed should force track in untracked zone', () => {
    const n = ref(0)
    const spy1 = vi.fn()
    const spy2 = vi.fn()

    let c: ComputedRef
    effect(() => {
      spy1()
      pauseTracking()
      n.value
      c = computed(() => n.value + 1)
      // 在暂停外层收集的区域中首次读取 computed，建立其自身依赖。
      c.value
      effect(() => spy2(c.value))
      n.value
      resetTracking()
    })

    expect(spy1).toHaveBeenCalledTimes(1)
    expect(spy2).toHaveBeenCalledTimes(1)

    n.value++
    // 外层未订阅 n，因此不重新执行。
    expect(spy1).toHaveBeenCalledTimes(1)
    // 内层独立建立依赖，因此重新执行。
    expect(spy2).toHaveBeenCalledTimes(2)
  })

  // 保留 getter 写入其他状态的历史兼容路径。
  // 此路径曾用于 VueUse 的 asyncComputed。
  /**
   * computed 的 getter 把 a 设为 true，再返回 b；另一个 effect 在 a 为 true 时把 b 设为 true。读取 computed 后 b 和后续计算值均为 true，验证既有副作用兼容路径的触发结果。
   */
  it('computed side effect should be able trigger', () => {
    const a = ref(false)
    const b = ref(false)
    const c = computed(() => {
      a.value = true
      return b.value
    })
    effect(() => {
      if (a.value) {
        b.value = true
      }
    })
    expect(b.value).toBe(false)
    // 读取 c 时写入 a，继而让另一个 effect 更新 b。
    c.value
    expect(b.value).toBe(true)
    expect(c.value).toBe(true)
  })

  /**
   * 以 n = 0 建立两层 computed，先手动读取末端再注册 effect；初始 dummy 为 1，n 自增后为 2 且 spy 为两次，验证已有缓存随后加入订阅时仍能连通上游。
   */
  it('chained computed should work when accessed before having subs', () => {
    const n = ref(0)
    const c = computed(() => n.value)
    const d = computed(() => c.value + 1)
    const spy = vi.fn()

    // 先手动读取，建立计算缓存。
    d.value

    let dummy
    effect(() => {
      spy()
      dummy = d.value
    })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(dummy).toBe(1)

    n.value++
    expect(spy).toHaveBeenCalledTimes(2)
    expect(dummy).toBe(2)
  })

  // #10236
  /**
   * 子组件建立 a + 1、再加 1 的计算链并预先读取，在卸载钩子中再次读取末端；a 自增后隐藏子组件，等待 tick，钩子 spy 收到 3，验证卸载过程中的外部读取得到新值。
   */
  it('chained computed should still refresh after owner component unmount', async () => {
    const a = ref(0)
    const spy = vi.fn()

    const Child = {
      /**
       * 建立并预读两层计算链，在卸载钩子中读取末端值交给 spy。
       */
      setup() {
        const b = computed(() => a.value + 1)
        const c = computed(() => b.value + 1)
        // 先手动读取，建立计算缓存。
        c.value
        onUnmounted(() => spy(c.value))
        return () => {}
      },
    }

    const show = ref(true)
    const Parent = {
      /**
       * 返回受 show 控制的子组件渲染函数，供测试触发卸载。
       */
      setup() {
        return () => (show.value ? h(Child) : null)
      },
    }

    render(h(Parent), nodeOps.createElement('div'))

    a.value++
    show.value = false

    await nextTick()
    expect(spy).toHaveBeenCalledWith(3)
  })

  // 场景来源：radix-vue 的 useForwardExpose 在挂载过程中设置模板 ref，
  // 再通过 computed 查询元素最近的 form。
  // 回归目标是在挂载完成后才因这次 ref 更新重新求值。
  /**
   * 组件先读取 a + 1 的 computed，元素 ref 回调在挂载时把 a 设为 1；记录 getter 和 mounted 的调用顺序为 b eval、mounted、b eval，验证调度阶段不提前刷新组件的计算依赖。
   */
  it('computed deps should only be refreshed when the subscribing effect is run, not when scheduled', async () => {
    const calls: string[] = []
    const a = ref(0)
    const b = computed(() => {
      calls.push('b eval')
      return a.value + 1
    })

    const App = {
      /**
       * 记录 mounted 时机并返回读取 b 的渲染函数，元素 ref 回调会修改源值。
       */
      setup() {
        onMounted(() => {
          calls.push('mounted')
        })
        return () =>
          h(
            'div',
            {
              /**
               * 元素 ref 回调在挂载过程中把 a 设为 1，安排依赖它的组件更新。
               */
              ref: () => (a.value = 1),
            },
            b.value,
          )
      },
    }

    render(h(App), nodeOps.createElement('div'))

    await nextTick()
    expect(calls).toMatchObject(['b eval', 'mounted', 'b eval'])
  })

  /**
   * 三层 computed 的第一层每次求值给字符串追加 World，组件同时读取后两层；首次得到 Hello World 的两个副本，外部追加后等待 tick，两处均得到含四个 World 的文本，验证带副作用计算链仍保留更新能力。
   */
  it('should chained computeds keep reactivity when computed effect happens', async () => {
    const v = ref('Hello')
    const c = computed(() => {
      v.value += ' World'
      return v.value
    })
    const d = computed(() => c.value)
    const e = computed(() => d.value)
    const Comp = {
      /**
       * 返回同时读取 d、e 的渲染函数，覆盖带副作用的多层计算链。
       */
      setup: () => {
        return () => d.value + ' | ' + e.value
      },
    }
    const root = nodeOps.createElement('div')

    render(h(Comp), root)
    await nextTick()
    expect(serializeInner(root)).toBe('Hello World | Hello World')

    v.value += ' World'
    await nextTick()
    expect(serializeInner(root)).toBe(
      'Hello World World World World | Hello World World World World',
    )
  })

  /**
   * computed c 每次求值把 v 自增并返回新值，d 返回包含 c 的对象，组件重复读取 d.value.d；首次渲染为 11，之后读取 d.value.d 仍为 1，验证该求值路径的缓存结果。
   */
  it('should keep dirty level when side effect computed value changed', () => {
    const v = ref(0)
    const c = computed(() => {
      v.value += 1
      return v.value
    })
    const d = computed(() => {
      return { d: c.value }
    })

    const Comp = {
      /**
       * 返回重复读取 d.value.d 的渲染函数，核对该路径的缓存结果。
       */
      setup: () => {
        return () => {
          return [d.value.d, d.value.d]
        }
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect(d.value.d).toBe(1)
    expect(serializeInner(root)).toBe('11')
  })

  /**
   * c1 首次求值把 v 设为 1 并返回 0，c2 先读 v 再读 c1；初次读取为 0,0，再赋 v = 1 后读取为 1,0，验证副作用留下的源变化不会使后续缓存停留在旧结果。
   */
  it('should be recomputed without being affected by side effects', () => {
    const v = ref(0)
    const c1 = computed(() => {
      v.value = 1
      return 0
    })
    const c2 = computed(() => {
      return v.value + ',' + c1.value
    })

    expect(c2.value).toBe('0,0')
    v.value = 1
    expect(c2.value).toBe('1,0')
    // expect(COMPUTED_SIDE_EFFECT_WARN).toHaveBeenWarned()
  })

  /**
   * computed 读取 Ref 初值 1，并先由 effect 建立订阅；Ref 自增后计算值为 2，onTrigger 收到一次以 value 为键、旧值 1 和新值 2 的 SET 事件，验证 Ref 计算订阅的调试信息。
   */
  it('debug: onTrigger (ref)', () => {
    let events: DebuggerEvent[] = []
    const onTrigger = vi.fn((e: DebuggerEvent) => {
      events.push(e)
    })
    const obj = ref(1)
    const c = computed(() => obj.value, { onTrigger })

    // 先加入下游订阅，使 computed 连入上游通知链后再检查 onTrigger。
    effect(() => c.value)

    obj.value++

    expect(c.value).toBe(2)
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(events[0]).toEqual({
      effect: c,
      target: toRaw(obj),
      type: TriggerOpTypes.SET,
      key: 'value',
      oldValue: 1,
      newValue: 2,
    })
  })

  // #11797
  /**
   * 组件的 message 在 counter = 0 时先自增再读取自身；首次渲染得到 Step 1，触发按钮点击并等待 tick 后得到 Step 2，验证自引用 getter 能结束且后续事件正常更新。
   */
  test('should prevent endless recursion in self-referencing computed getters', async () => {
    const Comp = defineComponent({
      /**
       * 提供初始 counter = 0 的组件状态，触发首次自引用 getter 分支。
       */
      data() {
        return {
          counter: 0,
        }
      },

      computed: {
        /**
         * counter 为 0 时自增并读取自身，之后返回当前 Step 文本，覆盖自引用计算路径。
         */
        message(): string {
          if (this.counter === 0) {
            this.counter++
            return this.message
          } else {
            return `Step ${this.counter}`
          }
        },
      },

      /**
       * 渲染递增 counter 的按钮与计算文本，供核对初次渲染和点击后的结果。
       */
      render() {
        return [
          h(
            'button',
            {
              /**
               * 按钮点击时把组件 counter 自增，触发 message 文本更新。
               */
              onClick: () => {
                this.counter++
              },
            },
            'Step',
          ),
          h('p', this.message),
        ]
      },
    })
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<button>Step</button><p>Step 1</p>`)
    triggerEvent(root.children[1] as TestElement, 'click')
    await nextTick()
    expect(serializeInner(root)).toBe(`<button>Step</button><p>Step 2</p>`)
  })

  /**
   * 常量 computed 尚未读取时先调用 triggerRef；随后读取仍为 1，验证手动通知不阻止首次求值。
   */
  test('manual trigger computed', () => {
    const cValue = computed(() => 1)
    triggerRef(cValue)
    expect(cValue.value).toBe(1)
  })

  /**
   * computed getter 只调用 spy，不读取响应式数据；首次读取后修改一个无关 Ref 以推进 globalVersion，再读仍只求值一次，验证无依赖的常量缓存。
   */
  test('should not recompute if computed does not track reactive data', async () => {
    const spy = vi.fn()
    const c1 = computed(() => spy())

    c1.value
    ref(0).value++ // 修改无关 Ref，推进全局变更版本。
    c1.value

    expect(spy).toBeCalledTimes(1)
  })

  /**
   * effect 订阅 state.a + 1 的 computed 后停止；仍保留 computed 引用，先读为 2，再把 a 自增后读为 3，验证失去全部下游订阅后仍能按需刷新。
   */
  test('computed should remain live after losing all subscribers', () => {
    const state = reactive({ a: 1 })
    const p = computed(() => state.a + 1)
    const { effect: e } = effect(() => p.value)
    e.stop()

    expect(p.value).toBe(2)
    state.a++
    expect(p.value).toBe(3)
  })

  // #11995
  /**
   * p 受开关控制读取 state.a，pp 始终读取同一属性；先缓存 pp = 1，再关闭 p 的分支并把 a 自增，pp 读取为 2，验证一个 computed 清理依赖不会破坏另一个保留的属性依赖。
   */
  test('computed dep cleanup should not cause property dep to be deleted', () => {
    const toggle = ref(true)
    const state = reactive({ a: 1 })
    const p = computed(() => {
      return toggle.value ? state.a : 111
    })
    const pp = computed(() => state.a)
    effect(() => p.value)

    expect(pp.value).toBe(1)
    toggle.value = false
    state.a++
    expect(pp.value).toBe(2)
  })

  // #12020
  /**
   * effect 在 flag 为真时同时读取 obj.foo 和 c1，flag 变为 0 后结果为 0；把 foo 改为 2 再恢复 flag = 1，结果为 2，验证清理计算订阅后重新进入分支能恢复更新。
   */
  test('computed value updates correctly after dep cleanup', () => {
    const obj = reactive({ foo: 1, flag: 1 })
    const c1 = computed(() => obj.foo)

    let foo
    effect(() => {
      foo = obj.flag ? (obj.foo, c1.value) : 0
    })
    expect(foo).toBe(1)

    obj.flag = 0
    expect(foo).toBe(0)

    obj.foo = 2
    obj.flag = 1
    expect(foo).toBe(2)
  })

  // #11928
  /**
   * 用四个 shallowRef 建立 1000 层相互交叉的计算链，每层四个 effect；依次改写四个源值，断言耗时低于 CI 100ms／本地 30ms，末层值为 [-2, -4, 2, 3]，验证深链传播的性能回归与结果。
   */
  test('should not lead to exponential perf cost with deeply chained computed', () => {
    const start = {
      prop1: shallowRef(1),
      prop2: shallowRef(2),
      prop3: shallowRef(3),
      prop4: shallowRef(4),
    }

    let layer = start

    const LAYERS = 1000

    for (let i = LAYERS; i > 0; i--) {
      const m = layer
      const s = {
        prop1: computed(() => m.prop2.value),
        prop2: computed(() => m.prop1.value - m.prop3.value),
        prop3: computed(() => m.prop2.value + m.prop4.value),
        prop4: computed(() => m.prop3.value),
      }
      effect(() => s.prop1.value)
      effect(() => s.prop2.value)
      effect(() => s.prop3.value)
      effect(() => s.prop4.value)

      s.prop1.value
      s.prop2.value
      s.prop3.value
      s.prop4.value

      layer = s
    }

    const t = performance.now()
    start.prop1.value = 4
    start.prop2.value = 3
    start.prop3.value = 2
    start.prop4.value = 1
    expect(performance.now() - t).toBeLessThan(process.env.CI ? 100 : 30)

    const end = layer
    expect([
      end.prop1.value,
      end.prop2.value,
      end.prop3.value,
      end.prop4.value,
    ]).toMatchObject([-2, -4, 2, 3])
  })

  /**
   * 建立 30 层、每层累加之前全部 computed 的依赖图，尾部由开关选择读链或返回 0；首次结果为 2 的 29 次方，关闭开关后为 0，两阶段各低于 CI 100ms／本地 30ms，验证密集依赖读取与移除的性能回归。
   */
  test('performance when removing dependencies from deeply nested computeds', () => {
    const base = ref(1)
    const trigger = ref(true)
    const computeds: ComputedRef<number>[] = []

    const LAYERS = 30

    for (let i = 0; i < LAYERS; i++) {
      const earlier = [...computeds]

      computeds.push(
        computed(() => {
          return base.value + earlier.reduce((sum, c) => sum + c.value, 0)
        }),
      )
    }

    const tail = computed(() =>
      trigger.value ? computeds[computeds.length - 1].value : 0,
    )

    const t0 = performance.now()
    expect(tail.value).toBe(2 ** (LAYERS - 1))
    const t1 = performance.now()
    expect(t1 - t0).toBeLessThan(process.env.CI ? 100 : 30)

    trigger.value = false
    expect(tail.value).toBe(0)
    const t2 = performance.now()
    expect(t2 - t1).toBeLessThan(process.env.CI ? 100 : 30)
  })
})
