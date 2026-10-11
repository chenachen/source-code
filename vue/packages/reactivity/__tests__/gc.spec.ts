import {
  type ComputedRef,
  computed,
  effect,
  reactive,
  shallowRef as ref,
  toRaw,
} from '../src/index'
import { getDepFromReactive } from '../src/dep'

describe.skipIf(!global.gc)('reactivity/gc', () => {
  /**
   * 跨到下一计时器任务后调用显式 GC 并完成 Promise，避开 WeakRef 在当前任务内的保活。
   */
  const gc = () => {
    return new Promise<void>(resolve => {
      setTimeout(() => {
        global.gc!()
        resolve()
      })
    })
  }

  // #9233
  /**
   * 仅在 global.gc 可用时执行：shallowRef 保存对象，WeakRef 观察它，computed 首次读后缓存对象；把源设为 undefined 并丢弃 computed 引用后跨任务 GC，WeakRef 返回 undefined，验证不再可达的计算缓存能释放。
   */
  it('should release computed cache', async () => {
    const src = ref<{} | undefined>({})
    // @ts-expect-error ES2021 API
    const srcRef = new WeakRef(src.value!)

    let c: ComputedRef | undefined = computed(() => src.value)

    c.value // 首次读取后 computed 缓存源对象。
    src.value = undefined // 清空源 Ref，解除它对旧对象的引用。
    c = undefined // 丢弃 computed 引用，让其中的旧缓存也不再可达。

    await gc()
    expect(srcRef.deref()).toBeUndefined()
  })

  /**
   * 仅在 global.gc 可用时执行：computed 读取 reactive.foo = 1，确认属性 Dep 存在；丢弃 computed 引用并跨任务两次 GC 后 Dep 查找为 undefined，验证无订阅属性依赖的回收。
   */
  it('should release reactive property dep', async () => {
    const src = reactive({ foo: 1 })

    let c: ComputedRef | undefined = computed(() => src.foo)

    c.value
    expect(getDepFromReactive(toRaw(src), 'foo')).not.toBeUndefined()

    c = undefined
    await gc()
    await gc()
    expect(getDepFromReactive(toRaw(src), 'foo')).toBeUndefined()
  })

  /**
   * 仅在 global.gc 可用时执行：effect 订阅 ref(0) 且不保留 runner；跨任务 GC 后源自增，spy 从一次变为两次，验证活动 Ref 订阅仍保持 effect 可执行。
   */
  it('should not release effect for ref', async () => {
    const spy = vi.fn()
    const src = ref(0)

    effect(() => {
      spy()
      src.value
    })

    expect(spy).toHaveBeenCalledTimes(1)

    await gc()
    src.value++
    expect(spy).toHaveBeenCalledTimes(2)
  })

  /**
   * 仅在 global.gc 可用时执行：effect 订阅 reactive.foo = 1 且不保留 runner；跨任务 GC 后 foo 自增，spy 从一次变为两次，验证活动对象属性订阅仍保持 effect 可执行。
   */
  it('should not release effect for reactive', async () => {
    const spy = vi.fn()
    const src = reactive({ foo: 1 })

    effect(() => {
      spy()
      src.foo
    })

    expect(spy).toHaveBeenCalledTimes(1)

    await gc()
    src.foo++
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
