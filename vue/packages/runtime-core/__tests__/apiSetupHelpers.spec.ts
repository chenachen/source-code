/**
 * 测试阅读说明：本文件验证 `runtime-core/apiSetupHelpers` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import {
  type ComponentInternalInstance,
  type SetupContext,
  Suspense,
  computed,
  createApp,
  defineComponent,
  getCurrentInstance,
  h,
  nodeOps,
  onMounted,
  render,
  serializeInner,
  shallowReactive,
} from '@vue/runtime-test'
import {
  createPropsRestProxy,
  defineEmits,
  defineExpose,
  defineProps,
  mergeDefaults,
  mergeModels,
  useAttrs,
  useSlots,
  withAsyncContext,
  withDefaults,
} from '../src/apiSetupHelpers'
import type { ComputedRefImpl } from '../../reactivity/src/computed'
import { EffectFlags, type ReactiveEffectRunner, effect } from '@vue/reactivity'

// 测试组：SFC <script setup> 编译产物依赖的运行时辅助函数。
describe('SFC <script setup> helpers', () => {
  // 测试场景：应该警告运行时使用情况。
  test('should warn runtime usage', () => {
    defineProps()
    expect(`defineProps() is a compiler-hint`).toHaveBeenWarned()

    defineEmits()
    expect(`defineEmits() is a compiler-hint`).toHaveBeenWarned()

    defineExpose()
    expect(`defineExpose() is a compiler-hint`).toHaveBeenWarned()

    withDefaults({}, {})
    expect(`withDefaults() is a compiler-hint`).toHaveBeenWarned()
  })

  // 测试场景：useSlots / useAttrs（无参数）。
  test('useSlots / useAttrs (no args)', () => {
    let slots: SetupContext['slots'] | undefined
    let attrs: SetupContext['attrs'] | undefined
    const Comp = {
      setup() {
        slots = useSlots()
        attrs = useAttrs()
        return () => {}
      },
    }
    const passedAttrs = { id: 'foo' }
    const passedSlots = {
      default: () => {},
      x: () => {},
    }
    render(h(Comp, passedAttrs, passedSlots), nodeOps.createElement('div'))
    expect(typeof slots!.default).toBe('function')
    expect(typeof slots!.x).toBe('function')
    expect(attrs).toMatchObject(passedAttrs)
  })

  // 测试场景：useSlots / useAttrs（带参数）。
  test('useSlots / useAttrs (with args)', () => {
    let slots: SetupContext['slots'] | undefined
    let attrs: SetupContext['attrs'] | undefined
    let ctx: SetupContext | undefined
    const Comp = defineComponent({
      setup(_, _ctx) {
        slots = useSlots()
        attrs = useAttrs()
        ctx = _ctx
        return () => {}
      },
    })
    render(h(Comp), nodeOps.createElement('div'))
    expect(slots).toBe(ctx!.slots)
    expect(attrs).toBe(ctx!.attrs)
  })

  // 测试组：mergeDefaults 把 withDefaults 产物合并进运行时 props 声明。
  describe('mergeDefaults', () => {
    // 测试场景：对象语法。
    test('object syntax', () => {
      const merged = mergeDefaults(
        {
          foo: null,
          bar: { type: String, required: false },
          baz: String,
        },
        {
          foo: 1,
          bar: 'baz',
          baz: 'qux',
        },
      )
      expect(merged).toMatchObject({
        foo: { default: 1 },
        bar: { type: String, required: false, default: 'baz' },
        baz: { type: String, default: 'qux' },
      })
    })

    // 测试场景：数组语法。
    test('array syntax', () => {
      const merged = mergeDefaults(['foo', 'bar', 'baz'], {
        foo: 1,
        bar: 'baz',
        baz: 'qux',
      })
      expect(merged).toMatchObject({
        foo: { default: 1 },
        bar: { default: 'baz' },
        baz: { default: 'qux' },
      })
    })

    // 测试场景：mergeDefaults 保留编译器生成的 skipFactory 标记。
    test('merging with skipFactory', () => {
      const fn = () => {}
      const merged = mergeDefaults(['foo', 'bar', 'baz'], {
        foo: fn,
        __skip_foo: true,
      })
      expect(merged).toMatchObject({
        foo: { default: fn, skipFactory: true },
      })
    })

    // 测试场景：应该警告失踪。
    test('should warn missing', () => {
      mergeDefaults({}, { foo: 1 })
      expect(
        `props default key "foo" has no corresponding declaration`,
      ).toHaveBeenWarned()
    })
  })

  // 测试组：mergeModels 合并 defineProps 与 defineModel 生成的 props/emits 选项。
  describe('mergeModels', () => {
    // 测试场景：数组语法。
    test('array syntax', () => {
      expect(mergeModels(['foo', 'bar'], ['baz'])).toMatchObject([
        'foo',
        'bar',
        'baz',
      ])
    })

    // 测试场景：对象语法。
    test('object syntax', () => {
      expect(
        mergeModels({ foo: null, bar: { required: true } }, ['baz']),
      ).toMatchObject({
        foo: null,
        bar: { required: true },
        baz: {},
      })

      expect(
        mergeModels(['baz'], { foo: null, bar: { required: true } }),
      ).toMatchObject({
        foo: null,
        bar: { required: true },
        baz: {},
      })
    })

    // 测试场景：mergeModels 遇到同名声明时按组件 model 规则覆盖。
    test('overwrite', () => {
      expect(
        mergeModels(
          { foo: null, bar: { required: true } },
          { bar: {}, baz: {} },
        ),
      ).toMatchObject({
        foo: null,
        bar: {},
        baz: {},
      })
    })
  })

  // 测试场景：createPropsRestProxy 暴露排除指定 key 后、随原 props 更新的只读代理。
  test('createPropsRestProxy', () => {
    const original = shallowReactive({
      foo: 1,
      bar: 2,
      baz: 3,
    })
    const rest = createPropsRestProxy(original, ['foo', 'bar'])
    expect('foo' in rest).toBe(false)
    expect('bar' in rest).toBe(false)
    expect(rest.baz).toBe(3)
    expect(Object.keys(rest)).toEqual(['baz'])

    original.baz = 4
    expect(rest.baz).toBe(4)
  })

  // 测试组：withAsyncContext 在 await 前后保存并恢复正确的当前组件实例。
  describe('withAsyncContext', () => {
    // disable options API because applyOptions() also resets currentInstance
    // and we want to ensure the logic works even with Options API disabled.
    beforeEach(() => {
      __FEATURE_OPTIONS_API__ = false
    })

    afterEach(() => {
      __FEATURE_OPTIONS_API__ = true
    })

    // 测试场景：await 完成后恢复进入异步操作前的当前组件实例。
    test('basic', async () => {
      const spy = vi.fn()

      let beforeInstance: ComponentInternalInstance | null = null
      let afterInstance: ComponentInternalInstance | null = null
      let resolve: (msg: string) => void

      const Comp = defineComponent({
        async setup() {
          let __temp: any, __restore: any

          beforeInstance = getCurrentInstance()

          const msg =
            (([__temp, __restore] = withAsyncContext(
              () =>
                new Promise(r => {
                  resolve = r
                }),
            )),
            (__temp = await __temp),
            __restore(),
            __temp)

          // register the lifecycle after an await statement
          onMounted(spy)
          afterInstance = getCurrentInstance()
          return () => msg
        },
      })

      const root = nodeOps.createElement('div')
      render(
        h(() => h(Suspense, () => h(Comp))),
        root,
      )

      expect(spy).not.toHaveBeenCalled()
      resolve!('hello')
      // wait a macro task tick for all micro ticks to resolve
      await new Promise(r => setTimeout(r))
      // mount hook should have been called
      expect(spy).toHaveBeenCalled()
      // should retain same instance before/after the await call
      expect(beforeInstance).toBe(afterInstance)
      expect(serializeInner(root)).toBe('hello')
    })

    // 测试场景：恢复后不应将实例泄漏给用户微任务。
    test('should not leak instance to user microtasks after restore', async () => {
      let leakedToUserMicrotask = false

      const Comp = defineComponent({
        async setup() {
          let __temp: any, __restore: any
          ;[__temp, __restore] = withAsyncContext(() => Promise.resolve())
          __temp = await __temp
          __restore()

          Promise.resolve().then(() => {
            leakedToUserMicrotask = getCurrentInstance() !== null
          })

          return () => ''
        },
      })

      const root = nodeOps.createElement('div')
      render(
        h(() => h(Suspense, () => h(Comp))),
        root,
      )

      await new Promise(r => setTimeout(r))
      expect(leakedToUserMicrotask).toBe(false)
    })

    // 测试场景：并发异步上下文恢复时，不能把当前实例泄漏给兄弟组件。
    test('should not leak sibling instance in concurrent restores', async () => {
      let resolveOne: () => void
      let resolveTwo: () => void
      let done!: () => void
      let pending = 2
      const ready = new Promise<void>(r => {
        done = r
      })
      const seenUid: Record<'one' | 'two', number | null> = {
        one: null,
        two: null,
      }

      const makeComp = (name: 'one' | 'two', wait: Promise<void>) =>
        defineComponent({
          async setup() {
            let __temp: any, __restore: any
            ;[__temp, __restore] = withAsyncContext(() => wait)
            __temp = await __temp
            __restore()

            Promise.resolve().then(() => {
              seenUid[name] = getCurrentInstance()?.uid ?? null
              if (--pending === 0) done()
            })

            return () => ''
          },
        })

      const oneReady = new Promise<void>(r => {
        resolveOne = r
      })
      const twoReady = new Promise<void>(r => {
        resolveTwo = r
      })
      const CompOne = makeComp('one', oneReady)
      const CompTwo = makeComp('two', twoReady)

      const root = nodeOps.createElement('div')
      render(
        h(() => h(Suspense, () => h('div', [h(CompOne), h(CompTwo)]))),
        root,
      )

      resolveOne!()
      resolveTwo!()
      await ready
      expect(seenUid.one).toBeNull()
      expect(seenUid.two).toBeNull()
    })

    // 测试场景：不应将 currentInstance 泄漏给同级 slot 渲染。
    test('should not leak currentInstance to sibling slot render', async () => {
      let done!: () => void
      const ready = new Promise<void>(r => {
        done = r
      })
      let innerUid: number | null = null
      let innerRenderUid: number | null = null

      const Inner = defineComponent({
        setup(_, { slots }) {
          innerUid = getCurrentInstance()!.uid
          return () => {
            innerRenderUid = getCurrentInstance()!.uid
            done()
            return h('div', slots.default?.())
          }
        },
      })

      const Outer = defineComponent({
        setup(_, { slots }) {
          return () => h(Inner, null, () => [slots.default?.()])
        },
      })

      const AsyncA = defineComponent({
        async setup() {
          let __temp: any, __restore: any
          ;[__temp, __restore] = withAsyncContext(() =>
            Promise.resolve()
              .then(() => {})
              .then(() => {}),
          )
          __temp = await __temp
          __restore()
          return () => h('div', 'A')
        },
      })

      const AsyncB = defineComponent({
        async setup() {
          let __temp: any, __restore: any
          ;[__temp, __restore] = withAsyncContext(() => Promise.resolve())
          __temp = await __temp
          __restore()
          return () => h(Outer, null, () => 'B')
        },
      })

      const root = nodeOps.createElement('div')
      render(
        h(() => h(Suspense, () => h('div', [h(AsyncA), h(AsyncB)]))),
        root,
      )

      await ready
      expect(
        'Slot "default" invoked outside of the render function',
      ).not.toHaveBeenWarned()
      expect(innerRenderUid).toBe(innerUid)
      await Promise.resolve()
      expect(serializeInner(root)).toBe(`<div><div>A</div><div>B</div></div>`)
    })

    // 测试场景：错误处理。
    test('error handling', async () => {
      const spy = vi.fn()

      let beforeInstance: ComponentInternalInstance | null = null
      let afterInstance: ComponentInternalInstance | null = null
      let reject: () => void

      const Comp = defineComponent({
        async setup() {
          let __temp: any, __restore: any

          beforeInstance = getCurrentInstance()
          try {
            ;[__temp, __restore] = withAsyncContext(
              () =>
                new Promise((_, rj) => {
                  reject = rj
                }),
            )
            __temp = await __temp
            __restore()
          } catch (e: any) {
            // ignore
          }
          // register the lifecycle after an await statement
          onMounted(spy)
          afterInstance = getCurrentInstance()
          return () => ''
        },
      })

      const root = nodeOps.createElement('div')
      render(
        h(() => h(Suspense, () => h(Comp))),
        root,
      )

      expect(spy).not.toHaveBeenCalled()
      reject!()
      // wait a macro task tick for all micro ticks to resolve
      await new Promise(r => setTimeout(r))
      // mount hook should have been called
      expect(spy).toHaveBeenCalled()
      // should retain same instance before/after the await call
      expect(beforeInstance).toBe(afterInstance)
      // instance scope should be fully restored/cleaned after async ticks
      expect((beforeInstance!.scope as any)._on).toBe(0)
    })

    // 测试场景：不应在多个等待时泄漏实例。
    test('should not leak instance on multiple awaits', async () => {
      let resolve: (val?: any) => void
      let beforeInstance: ComponentInternalInstance | null = null
      let afterInstance: ComponentInternalInstance | null = null
      let inBandInstance: ComponentInternalInstance | null = null
      let outOfBandInstance: ComponentInternalInstance | null = null

      const ready = new Promise(r => {
        resolve = r
      })

      async function doAsyncWork() {
        // should still have instance
        inBandInstance = getCurrentInstance()
        await Promise.resolve()
        // should not leak instance
        outOfBandInstance = getCurrentInstance()
      }

      const Comp = defineComponent({
        async setup() {
          let __temp: any, __restore: any

          beforeInstance = getCurrentInstance()

          // first await
          ;[__temp, __restore] = withAsyncContext(() => Promise.resolve())
          __temp = await __temp
          __restore()

          // setup exit, instance set to null, then resumed
          ;[__temp, __restore] = withAsyncContext(() => doAsyncWork())
          __temp = await __temp
          __restore()

          afterInstance = getCurrentInstance()
          return () => {
            resolve()
            return ''
          }
        },
      })

      const root = nodeOps.createElement('div')
      render(
        h(() => h(Suspense, () => h(Comp))),
        root,
      )

      await ready
      expect(inBandInstance).toBe(beforeInstance)
      expect(outOfBandInstance).toBeNull()
      expect(afterInstance).toBe(beforeInstance)
      expect(getCurrentInstance()).toBeNull()
    })

    // 测试场景：不应在多个等待+错误时泄漏。
    test('should not leak on multiple awaits + error', async () => {
      let resolve: (val?: any) => void
      const ready = new Promise(r => {
        resolve = r
      })

      const Comp = defineComponent({
        async setup() {
          let __temp: any, __restore: any
          ;[__temp, __restore] = withAsyncContext(() => Promise.resolve())
          __temp = await __temp
          __restore()
          ;[__temp, __restore] = withAsyncContext(() => Promise.reject())
          __temp = await __temp
          __restore()
        },
        render() {},
      })

      const app = createApp(() => h(Suspense, () => h(Comp)))
      app.config.errorHandler = () => {
        resolve()
        return false
      }

      const root = nodeOps.createElement('div')
      app.mount(root)

      await ready
      expect(getCurrentInstance()).toBeNull()
    })

    // #4050
    // 测试场景：竞争条件。
    test('race conditions', async () => {
      const uids = {
        one: { before: NaN, after: NaN },
        two: { before: NaN, after: NaN },
      }

      const Comp = defineComponent({
        props: ['name'],
        async setup(props: { name: 'one' | 'two' }) {
          let __temp: any, __restore: any

          uids[props.name].before = getCurrentInstance()!.uid
          ;[__temp, __restore] = withAsyncContext(() => Promise.resolve())
          __temp = await __temp
          __restore()

          uids[props.name].after = getCurrentInstance()!.uid
          return () => ''
        },
      })

      const app = createApp(() =>
        h(Suspense, () =>
          h('div', [h(Comp, { name: 'one' }), h(Comp, { name: 'two' })]),
        ),
      )
      const root = nodeOps.createElement('div')
      app.mount(root)

      await new Promise(r => setTimeout(r))
      expect(uids.one.before).not.toBe(uids.two.before)
      expect(uids.one.before).toBe(uids.one.after)
      expect(uids.two.before).toBe(uids.two.after)
    })

    // 测试场景：应该拆解范围内的效果。
    test('should teardown in-scope effects', async () => {
      let resolve: (val?: any) => void
      const ready = new Promise(r => {
        resolve = r
      })

      let c: ComputedRefImpl
      let e: ReactiveEffectRunner

      const Comp = defineComponent({
        async setup() {
          let __temp: any, __restore: any
          ;[__temp, __restore] = withAsyncContext(() => Promise.resolve())
          __temp = await __temp
          __restore()

          c = computed(() => {}) as unknown as ComputedRefImpl
          e = effect(() => c.value)
          // register the lifecycle after an await statement
          onMounted(resolve)
          return () => c.value
        },
      })

      const app = createApp(() => h(Suspense, () => h(Comp)))
      const root = nodeOps.createElement('div')
      app.mount(root)

      await ready
      expect(e!.effect.flags & EffectFlags.ACTIVE).toBeTruthy()
      expect(c!.flags & EffectFlags.TRACKING).toBeTruthy()

      app.unmount()
      expect(e!.effect.flags & EffectFlags.ACTIVE).toBeFalsy()
      expect(c!.flags & EffectFlags.TRACKING).toBeFalsy()
    })
  })
})
