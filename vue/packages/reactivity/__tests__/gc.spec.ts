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
  const gc = () => {
    return new Promise<void>(resolve => {
      setTimeout(() => {
        global.gc!()
        resolve()
      })
    })
  }

  // #9233
  // 场景：计算属性失去全部订阅者和外部引用；验证其缓存值可被垃圾回收。
  it('should release computed cache', async () => {
    const src = ref<{} | undefined>({})
    // @ts-expect-error ES2021 API
    const srcRef = new WeakRef(src.value!)

    let c: ComputedRef | undefined = computed(() => src.value)

    c.value // cache src value
    src.value = undefined // release value
    c = undefined // release computed

    await gc()
    expect(srcRef.deref()).toBeUndefined()
  })

  // 场景：响应式属性不再有订阅者；验证属性对应的 Dep 能从依赖表释放。
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

  // 场景：effect 仍被 Ref 的依赖关系持有；验证垃圾回收不会错误释放有效 effect。
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

  // 场景：effect 仍订阅响应式对象属性；验证有效订阅关系会保持 effect 存活。
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
