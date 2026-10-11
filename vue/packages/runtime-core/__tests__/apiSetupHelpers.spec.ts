/**
 * 直接检查编译辅助函数的声明合并、props getter 和宏误用警告。
 * withAsyncContext 用例在 Suspense 中模拟编译后的 await，检查实例恢复、微任务清理和作用域卸载。
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

// SFC <script setup> 编译产物依赖的运行时辅助函数。
describe('SFC <script setup> helpers', () => {
  // 编译宏直接留到运行时调用，会触发对应 compiler-hint 警告。
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

  // setup 未声明第二个参数时，useSlots/useAttrs 仍能取得传入的插槽和 attrs。
  test('useSlots / useAttrs (no args)', () => {
    let slots: SetupContext['slots'] | undefined
    let attrs: SetupContext['attrs'] | undefined
    const Comp = {
      /**
       * 捕获 useSlots/useAttrs 的返回对象，返回空渲染闭包；外层比较传入的 slot 函数与 attrs，检查没有第二个 setup 参数也可取得上下文。
       */
      setup() {
        slots = useSlots()
        attrs = useAttrs()
        return () => {}
      },
    }
    const passedAttrs = { id: 'foo' }
    const passedSlots = {
      /**
       * 空 default slot 夹具；本例比较 useSlots 取得的函数身份，不调用它检查渲染内容。
       */
      default: () => {},
      /**
       * 空命名 slot 夹具；作为第二个键检查 useSlots 保留传入函数，不承担渲染行为。
       */
      x: () => {},
    }
    render(h(Comp, passedAttrs, passedSlots), nodeOps.createElement('div'))
    expect(typeof slots!.default).toBe('function')
    expect(typeof slots!.x).toBe('function')
    expect(attrs).toMatchObject(passedAttrs)
  })

  // setup 声明第二个参数时，useSlots/useAttrs 与该 SetupContext 返回同一对象。
  test('useSlots / useAttrs (with args)', () => {
    let slots: SetupContext['slots'] | undefined
    let attrs: SetupContext['attrs'] | undefined
    let ctx: SetupContext | undefined
    const Comp = defineComponent({
      /**
       * 同时保存显式 SetupContext、useSlots 和 useAttrs 的返回值；空 render 只完成挂载，外层比较三个入口的对象身份。
       */
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

  // mergeDefaults 把 withDefaults 产物合并进运行时 props 声明。
  describe('mergeDefaults', () => {
    // 对象 props 声明按 null、构造器与完整选项三种形状合并默认值。
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

    // 数组 props 声明规范化成对象后，为每个键补入默认值。
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

    // 合并 foo 的函数默认值与 __skip_foo 元数据，断言选项中的 default 保留原函数且 skipFactory 为 true；本例不调用实际 prop 值解析。
    test('merging with skipFactory', () => {
      /**
       * 空 fn 夹具，保留本例的选项/回调形状；函数自身不产生副作用。
       */
      const fn = () => {}
      const merged = mergeDefaults(['foo', 'bar', 'baz'], {
        foo: fn,
        __skip_foo: true,
      })
      expect(merged).toMatchObject({
        foo: { default: fn, skipFactory: true },
      })
    })

    // 默认值的键没有对应 props 声明时，mergeDefaults 会警告。
    test('should warn missing', () => {
      mergeDefaults({}, { foo: 1 })
      expect(
        `props default key "foo" has no corresponding declaration`,
      ).toHaveBeenWarned()
    })
  })

  // mergeModels 合并 defineProps 与 defineModel 生成的 props/emits 选项。
  describe('mergeModels', () => {
    // 两份数组声明直接拼接。
    test('array syntax', () => {
      expect(mergeModels(['foo', 'bar'], ['baz'])).toMatchObject([
        'foo',
        'bar',
        'baz',
      ])
    })

    // 混合数组与对象声明时先规范化为对象，再合并各键。
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

    // 两份声明出现同名键时，后一份覆盖前一份。
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

  // rest 对象排除解构取出的键，剩余键通过 getter 读取原 props 的最新值。
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

  // withAsyncContext 在 await 前后保存并恢复正确的当前组件实例。
  describe('withAsyncContext', () => {
    // 关闭 Options API，避免 applyOptions 的实例恢复掩盖 withAsyncContext 的行为。
    // 这些断言因此独立检查异步上下文恢复与清理。
    beforeEach(() => {
      __FEATURE_OPTIONS_API__ = false
    })

    afterEach(() => {
      __FEATURE_OPTIONS_API__ = true
    })

    // 模拟编译后的 await 恢复当前实例，后续登记的 mounted 钩子属于原组件。
    test('basic', async () => {
      const spy = vi.fn()

      let beforeInstance: ComponentInternalInstance | null = null
      let afterInstance: ComponentInternalInstance | null = null
      let resolve: (msg: string) => void

      const Comp = defineComponent({
        /**
         * 模拟编译后的 async setup：await 前捕获实例，借 withAsyncContext 等待测试手动 resolve，调用 restore 后再次捕获实例并登记 mounted；返回已解析消息的 render。
         */
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

          // 在恢复后的 await 延续中登记 mounted，验证归属仍为原组件。
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
      // 等待一个宏任务，让 Promise 恢复、Suspense 提交和清理微任务全部执行。
      await new Promise(r => setTimeout(r))
      // 异步分支提交后应执行 mounted 钩子。
      expect(spy).toHaveBeenCalled()
      // await 前后应看到同一内部实例。
      expect(beforeInstance).toBe(afterInstance)
      expect(serializeInner(root)).toBe('hello')
    })

    // await continuation 恢复实例后，用户另排入的微任务看不到该实例。
    test('should not leak instance to user microtasks after restore', async () => {
      let leakedToUserMicrotask = false

      const Comp = defineComponent({
        /**
         * 模拟一次 await 的实例恢复；在 restore 后额外排入用户微任务记录可见实例，返回空文本，让断言检查该微任务中实例已被清理。
         */
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

    // 两个 async setup 同时恢复后，各自的用户微任务都看不到兄弟组件实例。
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

      /**
       * 为 one/two 创建分别等待 wait 的异步组件，模拟编译后的 await 恢复；各自用户微任务把可见实例 uid 写入 seenUid[name]。
       */
      const makeComp = (name: 'one' | 'two', wait: Promise<void>) =>
        defineComponent({
          /**
           * 等待 makeComp 传入的 Promise 并恢复该组件实例，再排入用户微任务记录 seenUid[name]；返回空文本，两个组件由外层并发 resolve。
           */
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

    // 并发 async setup 后渲染嵌套插槽，内部 render 保持自己的实例且不误报调用位置。
    test('should not leak currentInstance to sibling slot render', async () => {
      let done!: () => void
      const ready = new Promise<void>(r => {
        done = r
      })
      let innerUid: number | null = null
      let innerRenderUid: number | null = null

      const Inner = defineComponent({
        /**
         * 在 Inner 的初始化中保存自己的 uid，render 再检查渲染实例的 uid 并消费 default slot；用它区分 async setup 恢复实例与插槽渲染实例。
         */
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
        /**
         * 把收到的 default slot 经 Outer 转交给 Inner，返回调用它的渲染闭包；让并发恢复场景经过多层 slot 上下文。
         */
        setup(_, { slots }) {
          return () => h(Inner, null, () => [slots.default?.()])
        },
      })

      const AsyncA = defineComponent({
        /**
         * 通过两段 Promise.then 延长 A 的 await，恢复后返回 A 文本；与兄弟 B 的恢复交错，检查 slot 调用不串用实例。
         */
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
        /**
         * 完成一次 await/restore 后渲染 Outer，并提供 B 文本的 default slot；与 A 共同构造并发恢复和嵌套 slot 场景。
         */
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

    // await Promise 拒绝后，catch continuation 恢复原实例，随后 effect scope 的开启次数归零。
    test('error handling', async () => {
      const spy = vi.fn()

      let beforeInstance: ComponentInternalInstance | null = null
      let afterInstance: ComponentInternalInstance | null = null
      let reject: () => void

      const Comp = defineComponent({
        /**
         * 等待可手动 reject 的 Promise，在 catch continuation 中捕获恢复的实例；随后登记 mounted 并返回空文本，让外层检查实例身份和 scope 开启计数归零。
         */
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
          // 在恢复后的 await 延续中登记 mounted，验证归属仍为原组件。
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
      // 等待一个宏任务，让 Promise 恢复、Suspense 提交和清理微任务全部执行。
      await new Promise(r => setTimeout(r))
      // 异步分支提交后应执行 mounted 钩子。
      expect(spy).toHaveBeenCalled()
      // await 前后应看到同一内部实例。
      expect(beforeInstance).toBe(afterInstance)
      // 异步微任务结束后 scope 的开启计数应归零。
      expect((beforeInstance!.scope as any)._on).toBe(0)
    })

    // 连续 await 时，同步执行的被调用函数可见原实例，其内部 await 后的延续不可见。
    test('should not leak instance on multiple awaits', async () => {
      let resolve: (val?: any) => void
      let beforeInstance: ComponentInternalInstance | null = null
      let afterInstance: ComponentInternalInstance | null = null
      let inBandInstance: ComponentInternalInstance | null = null
      let outOfBandInstance: ComponentInternalInstance | null = null

      const ready = new Promise(r => {
        resolve = r
      })

      /**
       * 记录普通 async 函数同步部分与自身 await 后的实例；前者应继承调用窗口，后者不由 SFC 辅助器自动恢复。
       */
      async function doAsyncWork() {
        // 被调用异步函数的同步部分仍处于组件实例窗口。
        inBandInstance = getCurrentInstance()
        await Promise.resolve()
        // 普通异步函数自己的 await 延续不应继承组件实例。
        outOfBandInstance = getCurrentInstance()
      }

      const Comp = defineComponent({
        /**
         * 先 await 一次普通 Promise，再通过 withAsyncContext 调用 doAsyncWork；两次恢复后捕获实例，返回空文本，外层区分同步调用窗口与普通 async 函数的 await 延续。
         */
        async setup() {
          let __temp: any, __restore: any

          beforeInstance = getCurrentInstance()

          // 模拟编译器生成的第一次 await 保存/恢复。
          ;[__temp, __restore] = withAsyncContext(() => Promise.resolve())
          __temp = await __temp
          __restore()

          // 第二次 await 挂起时清空实例，完成后仅恢复当前 setup 延续。
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

    // 第二次 await 拒绝并交给错误处理器后，不留下 currentInstance。
    test('should not leak on multiple awaits + error', async () => {
      let resolve: (val?: any) => void
      const ready = new Promise(r => {
        resolve = r
      })

      const Comp = defineComponent({
        /**
         * 模拟两次编译 await：第一次 resolve 后恢复，第二次 reject 交由 withAsyncContext 的拒绝恢复路径和应用 errorHandler 处理；不返回成功渲染结果。
         */
        async setup() {
          let __temp: any, __restore: any
          ;[__temp, __restore] = withAsyncContext(() => Promise.resolve())
          __temp = await __temp
          __restore()
          ;[__temp, __restore] = withAsyncContext(() => Promise.reject())
          __temp = await __temp
          __restore()
        },
        /**
         * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
         */
        render() {},
      })

      const app = createApp(() => h(Suspense, () => h(Comp)))
      /**
       * 消费 async setup 的拒绝并唤醒测试 ready，随后检查 currentInstance 已清空；返回 false 不作为 errorHandler 的传播控制协议。
       */
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
    // 两个组件并发恢复时，await 前后各自的 uid 相同，彼此仍不同。
    test('race conditions', async () => {
      const uids = {
        one: { before: NaN, after: NaN },
        two: { before: NaN, after: NaN },
      }

      const Comp = defineComponent({
        props: ['name'],
        /**
         * 以 props.name 记录 await 前后的组件 uid，中间调用 withAsyncContext 与 restore；返回空文本，让外层同时挂载 one/two 并比较各自身份。
         */
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

    // await 恢复后创建的 effect 属于组件作用域，组件卸载后 effect 和 computed 订阅停止。
    test('should teardown in-scope effects', async () => {
      let resolve: (val?: any) => void
      const ready = new Promise(r => {
        resolve = r
      })

      let c: ComputedRefImpl
      let e: ReactiveEffectRunner

      const Comp = defineComponent({
        /**
         * await/restore 后创建 computed 和读取它的 effect，并把两者保存给外层；render 也读取 c.value，卸载后检查 effect 停止以及 computed 订阅标志清理。
         */
        async setup() {
          let __temp: any, __restore: any
          ;[__temp, __restore] = withAsyncContext(() => Promise.resolve())
          __temp = await __temp
          __restore()

          c = computed(() => {}) as unknown as ComputedRefImpl
          e = effect(() => c.value)
          // 在恢复后的 await 延续中登记 mounted，验证归属仍为原组件。
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
