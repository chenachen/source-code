/**
 * 先用 ref、reactive 与独立 watcher 检查取值、遍历、清理和停止行为。
 * 组件调度用例读取 runtime-test 宿主树；SSR 停止用例通过 renderToString 核对服务端输出。
 */
import {
  type ComponentInternalInstance,
  type ComponentPublicInstance,
  computed,
  defineComponent,
  getCurrentInstance,
  nextTick,
  onErrorCaptured,
  onWatcherCleanup,
  reactive,
  ref,
  watch,
  watchEffect,
} from '../src/index'
import {
  type TestElement,
  createApp,
  h,
  nodeOps,
  onMounted,
  render,
  serializeInner,
  watchPostEffect,
  watchSyncEffect,
} from '@vue/runtime-test'
import {
  type DebuggerEvent,
  ITERATE_KEY,
  type Ref,
  type ShallowRef,
  TrackOpTypes,
  TriggerOpTypes,
  effectScope,
  onScopeDispose,
  shallowReactive,
  shallowRef,
  toRef,
  triggerRef,
} from '@vue/reactivity'
import { renderToString } from '@vue/server-renderer'

// watch/watchEffect 的依赖追踪、调度时机、清理和深度监听行为。
describe('api: watch', () => {
  // watchEffect 首次立即执行，依赖修改后在下一次刷新重新取值。
  it('effect', async () => {
    const state = reactive({ count: 0 })
    let dummy
    watchEffect(() => {
      dummy = state.count
    })
    expect(dummy).toBe(0)

    state.count++
    await nextTick()
    expect(dummy).toBe(1)
  })

  // 监听 getter 返回值，回调收到变化后的值与上次值。
  it('watching single source: getter', async () => {
    const state = reactive({ count: 0 })
    let dummy
    watch(
      () => state.count,
      (count, prevCount) => {
        dummy = [count, prevCount]
        // 保留静态类型使用表达式；运行时结论由下方 matcher 断言给出。
        count + 1
        if (prevCount) {
          prevCount + 1
        }
      },
    )
    state.count++
    await nextTick()
    expect(dummy).toMatchObject([1, 0])
  })

  // 监听单个 ref，修改 value 后回调收到新旧值。
  it('watching single source: ref', async () => {
    const count = ref(0)
    let dummy
    watch(count, (count, prevCount) => {
      dummy = [count, prevCount]
      // 保留静态类型使用表达式；运行时结论由下方 matcher 断言给出。
      count + 1
      if (prevCount) {
        prevCount + 1
      }
    })
    count.value++
    await nextTick()
    expect(dummy).toMatchObject([1, 0])
  })

  // reactive 数组作为一个数据源监听；push 后回调中的新旧值都指向该数组。
  it('watching single source: array', async () => {
    const array = reactive([] as number[])
    const spy = vi.fn()
    watch(array, spy)
    array.push(1)
    await nextTick()
    expect(spy).toBeCalledTimes(1)
    expect(spy).toBeCalledWith([1], [1], expect.anything())
  })

  // reactive 数组是被监听的值，数组内的函数不会被当作 getter 执行。
  it('should not call functions inside a reactive source array', () => {
    const spy1 = vi.fn()
    const array = reactive([spy1])
    const spy2 = vi.fn()
    watch(array, spy2, { immediate: true })
    expect(spy1).toBeCalledTimes(0)
    expect(spy2).toBeCalledWith([spy1], undefined, expect.anything())
  })

  // 直接监听 reactive 数组会深度访问其中 ref，但回调保留 ref 元素，不解包数组。
  it('should not unwrap refs in a reactive source array', async () => {
    const val = ref({ foo: 1 })
    const array = reactive([val])
    const spy = vi.fn()
    watch(array, spy, { immediate: true })
    expect(spy).toBeCalledTimes(1)
    expect(spy).toBeCalledWith([val], undefined, expect.anything())

    // 直接监听 reactive 数组会遍历 ref 元素的内部值。
    val.value.foo++
    await nextTick()
    expect(spy).toBeCalledTimes(2)
    expect(spy).toBeCalledWith([val], [val], expect.anything())
  })

  // getter 的依赖变化但返回值未变时，不再次调用 watch 回调。
  it('should not fire if watched getter result did not change', async () => {
    const spy = vi.fn()
    const n = ref(0)
    watch(() => n.value % 2, spy)

    n.value++
    await nextTick()
    expect(spy).toBeCalledTimes(1)

    n.value += 2
    await nextTick()
    // 依赖已变但取模结果不变，回调次数保持 1。
    expect(spy).toBeCalledTimes(1)
  })

  // 监听 computed ref，回调接收计算结果的新旧值。
  it('watching single source: computed ref', async () => {
    const count = ref(0)
    const plus = computed(() => count.value + 1)
    let dummy
    watch(plus, (count, prevCount) => {
      dummy = [count, prevCount]
      // 保留静态类型使用表达式；运行时结论由下方 matcher 断言给出。
      count + 1
      if (prevCount) {
        prevCount + 1
      }
    })
    count.value++
    await nextTick()
    expect(dummy).toMatchObject([2, 1])
  })

  // 监听基本类型 ref 时，deep: true 不影响新旧值回调。
  it('watching primitive with deep: true', async () => {
    const count = ref(0)
    let dummy
    watch(
      count,
      (c, prevCount) => {
        dummy = [c, prevCount]
      },
      {
        deep: true,
      },
    )
    count.value++
    await nextTick()
    expect(dummy).toMatchObject([1, 0])
  })

  // 直接 watch reactive({ count: 0 })，递增根属性 count 并刷新后，回调观察值为 1；确认对象 source 可监听根属性，此例没有嵌套输入。
  it('directly watching reactive object (with automatic deep: true)', async () => {
    const src = reactive({
      count: 0,
    })
    let dummy
    watch(src, ({ count }) => {
      dummy = count
    })
    src.count++
    await nextTick()
    expect(dummy).toBe(1)
  })

  // deep: false 只响应根层属性替换，不响应对象内部的嵌套修改。
  it('directly watching reactive object with explicit deep: false', async () => {
    const src = reactive({
      state: {
        count: 0,
      },
    })
    let dummy
    watch(
      src,
      ({ state }) => {
        dummy = state?.count
      },
      {
        deep: false,
      },
    )

    // deep:false 不追踪 state 内部的 count 修改。
    src.state.count++
    await nextTick()
    expect(dummy).toBe(undefined)

    // 替换根层 state 属性应触发回调。
    src.state = { count: 1 }
    await nextTick()
    expect(dummy).toBe(1)
  })

  // 直接监听 reactive 数组并设置 deep: false，响应数组项替换而不响应其中 ref 的修改。
  it('directly watching reactive array with explicit deep: false', async () => {
    const val = ref(1)
    const array: any[] = reactive([val])
    const spy = vi.fn()
    watch(array, spy, { immediate: true, deep: false })
    expect(spy).toBeCalledTimes(1)
    expect(spy).toBeCalledWith([val], undefined, expect.anything())

    val.value++
    await nextTick()
    expect(spy).toBeCalledTimes(1)

    array[1] = 2
    await nextTick()
    expect(spy).toBeCalledTimes(2)
    expect(spy).toBeCalledWith([val, 2], [val, 2], expect.anything())
  })

  // #9916
  // shallowReactive 数组配合 deep: false，忽略元素内部 ref 的修改并响应数组 push。
  it('watching shallow reactive array with deep: false', async () => {
    /**
     * 浅数组监听夹具，包含 shallowRef 字段和普通字符串字段；内部 ref 变化与集合 push 分别测试 deep:false 的遍历边界。
     */
    class foo {
      /**
       * 浅监听夹具内部的 shallowRef 字段；修改 value 后应不触发 deep:false 的数组监听。
       */
      prop1: ShallowRef<string> = shallowRef('')
      /**
       * 夹具的普通字符串字段；数组 push 添加新实例时用它检查集合层变化。
       */
      prop2: string = ''
    }

    const obj1 = new foo()
    const obj2 = new foo()

    const collection = shallowReactive([obj1, obj2])
    const cb = vi.fn()
    watch(collection, cb, { deep: false })

    collection[0].prop1.value = 'foo'
    await nextTick()
    // 当前修改不在已追踪范围内，回调计数保持原值。
    expect(cb).toBeCalledTimes(0)

    collection.push(new foo())
    await nextTick()
    // 数组 push 改变集合本身，应触发一次回调。
    expect(cb).toBeCalledTimes(1)
  })

  // 显式 deep: true 会继续遍历 shallowReactive 数组中的 reactive 元素。
  it('should still respect deep: true on shallowReactive source', async () => {
    const obj = reactive({ a: 1 })
    const arr = shallowReactive([obj])

    let dummy
    watch(
      arr,
      () => {
        dummy = arr[0].a
      },
      { deep: true },
    )

    obj.a++
    await nextTick()
    expect(dummy).toBe(2)
  })

  // 混合 getter、ref 和 computed 的多个数据源，合并同步修改并返回新旧值元组。
  it('watching multiple sources', async () => {
    const state = reactive({ count: 1 })
    const count = ref(1)
    const plus = computed(() => count.value + 1)

    let dummy
    watch([() => state.count, count, plus], (vals, oldVals) => {
      dummy = [vals, oldVals]
      // 保留静态类型使用表达式；运行时结论由下方 matcher 断言给出。
      vals.concat(1)
      oldVals.concat(1)
    })

    state.count++
    count.value++
    await nextTick()
    expect(dummy).toMatchObject([
      [2, 2, 3],
      [1, 1, 2],
    ])
  })

  // 多个初始值均为 undefined 的 ref 仍会立即回调，新旧值都可按数组解构。
  it('watching multiple sources: undefined initial values and immediate: true', async () => {
    const a = ref()
    const b = ref()
    let called = false
    watch(
      [a, b],
      ([newA, newB], [oldA, oldB]) => {
        called = true
        expect([newA, newB]).toMatchObject([undefined, undefined])
        expect([oldA, oldB]).toMatchObject([undefined, undefined])
      },
      { immediate: true },
    )
    await nextTick()
    expect(called).toBe(true)
  })

  // 空数据源数组配合 immediate: true，也立即调用一次回调并传入两个空数组。
  it('watching empty multiple sources with immediate: true', () => {
    const spy = vi.fn()
    watch([], spy, { immediate: true })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith([], [], expect.any(Function))
  })

  // 只读数据源元组保留每项类型，并在各项变化后返回对应的新旧值。
  it('watching multiple sources: readonly array', async () => {
    const state = reactive({ count: 1 })
    const status = ref(false)

    let dummy
    watch([() => state.count, status] as const, (vals, oldVals) => {
      dummy = [vals, oldVals]
      const [count] = vals
      const [, oldStatus] = oldVals
      // 保留静态类型使用表达式；运行时结论由下方 matcher 断言给出。
      count + 1
      oldStatus === true
    })

    state.count++
    status.value = true
    await nextTick()
    expect(dummy).toMatchObject([
      [2, true],
      [1, false],
    ])
  })

  // 把 reactive({ count: 0 }) 放入多 source 数组，递增根属性 count 并刷新后，回调接收包含 count: 1 的对象；此例没有嵌套输入。
  it('watching multiple sources: reactive object (with automatic deep: true)', async () => {
    const src = reactive({ count: 0 })
    let dummy
    watch([src], ([state]) => {
      dummy = state
      // 保留静态类型使用表达式；运行时结论由下方 matcher 断言给出。
      state.count === 1
    })
    src.count++
    await nextTick()
    expect(dummy).toMatchObject({ count: 1 })
  })

  // 单个无效数据源触发 Invalid watch source 警告。
  it('warn invalid watch source', () => {
    // @ts-expect-error
    watch(1, () => {})
    expect(`Invalid watch source`).toHaveBeenWarned()
  })

  // 多数据源数组中的无效项触发 Invalid watch source 警告。
  it('warn invalid watch source: multiple sources', () => {
    watch([1], () => {})
    expect(`Invalid watch source`).toHaveBeenWarned()
  })

  // 停止 watchEffect 后，依赖修改不再更新副作用结果。
  it('stopping the watcher (effect)', async () => {
    const state = reactive({ count: 0 })
    let dummy
    const stop = watchEffect(() => {
      dummy = state.count
    })
    expect(dummy).toBe(0)

    stop()
    state.count++
    await nextTick()
    // 停止句柄已执行，后续修改不再改变已记录结果。
    expect(dummy).toBe(0)
  })

  // SSR created 取得非立即 watcher 的停止句柄并调用它，渲染期间及渲染后的修改都不调用回调；此分支本就不创建 effect，不能据此证明停止了活跃 SSR watcher。
  it('stopping the watcher (SSR)', async () => {
    let dummy = 0
    const count = ref<number>(1)
    /**
     * 把传入的 getter 值写入 dummy，区分主动读取与 watcher 回调产生的副作用。
     */
    const captureValue = (value: number) => {
      dummy = value
    }
    const watchCallback = vi.fn(newValue => {
      captureValue(newValue)
    })
    const Comp = defineComponent({
      /**
       * 在 created 阶段执行 `captureValue(getter())`、`getter()`、`this.$watch(getter, watchCallback)`；写入 `this.count` 供后续观察或触发更新。
       */
      created() {
        /**
         * 通过 Options 公共 this 读取 count；停止前手动调用记录初始值，再作为 this.$watch 数据源。
         */
        const getter = () => this.count
        captureValue(getter()) // 停止前主动读取 getter，将 dummy 记为 1。
        const stop = this.$watch(getter, watchCallback)
        stop()
        this.count = 2 // 已停止的 watcher 不应产生新副作用。
      },
      /**
       * 渲染结果为 `h('div', this.count)`。
       */
      render() {
        return h('div', this.count)
      },
      /**
       * 返回 `count` 作为后续渲染可读的绑定。
       */
      setup() {
        return { count }
      },
    })
    let html
    html = await renderToString(h(Comp))
    // 服务端渲染输出包含修改后的 count=2。
    expect(html).toBe(`<div>2</div>`)
    expect(watchCallback).not.toHaveBeenCalled()
    expect(dummy).toBe(1)
    await nextTick()
    count.value = 3 // 已停止的 watcher 不应产生新副作用。
    await nextTick()
    expect(watchCallback).not.toHaveBeenCalled()
    expect(dummy).toBe(1)
  })

  // 停止带数据源的 watch 后，后续数据变化不再调用回调。
  it('stopping the watcher (with source)', async () => {
    const state = reactive({ count: 0 })
    let dummy
    const stop = watch(
      () => state.count,
      count => {
        dummy = count
      },
    )

    state.count++
    await nextTick()
    expect(dummy).toBe(1)

    stop()
    state.count++
    await nextTick()
    // 停止句柄已执行，后续修改不再改变已记录结果。
    expect(dummy).toBe(1)
  })

  // watchEffect 重跑前调用已登记清理函数，停止时再次清理。
  it('cleanup registration (effect)', async () => {
    const state = reactive({ count: 0 })
    const cleanup = vi.fn()
    let dummy
    const stop = watchEffect(onCleanup => {
      onCleanup(cleanup)
      dummy = state.count
    })
    expect(dummy).toBe(0)

    state.count++
    await nextTick()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(dummy).toBe(1)

    stop()
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  // watch 回调登记的清理函数，在下一次回调之前和停止时执行。
  it('cleanup registration (with source)', async () => {
    const count = ref(0)
    const cleanup = vi.fn()
    let dummy
    const stop = watch(count, (count, prevCount, onCleanup) => {
      onCleanup(cleanup)
      dummy = count
    })

    count.value++
    await nextTick()
    expect(cleanup).toHaveBeenCalledTimes(0)
    expect(dummy).toBe(1)

    count.value++
    await nextTick()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(dummy).toBe(2)

    stop()
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  // onWatcherCleanup 为 watchEffect 和 watch 登记清理，重跑或停止时分别执行。
  it('onWatcherCleanup', async () => {
    const count = ref(0)
    const cleanupEffect = vi.fn()
    const cleanupWatch = vi.fn()

    const stopEffect = watchEffect(() => {
      onWatcherCleanup(cleanupEffect)
      count.value
    })
    const stopWatch = watch(count, () => {
      onWatcherCleanup(cleanupWatch)
    })

    count.value++
    await nextTick()
    expect(cleanupEffect).toHaveBeenCalledTimes(1)
    expect(cleanupWatch).toHaveBeenCalledTimes(0)

    count.value++
    await nextTick()
    expect(cleanupEffect).toHaveBeenCalledTimes(2)
    expect(cleanupWatch).toHaveBeenCalledTimes(1)

    stopEffect()
    expect(cleanupEffect).toHaveBeenCalledTimes(3)
    stopWatch()
    expect(cleanupWatch).toHaveBeenCalledTimes(2)
  })

  // 默认 pre watchEffect 在所属组件 DOM 更新前执行，并合并同一同步栈内的两次修改。
  it('flush timing: pre (default)', async () => {
    const count = ref(0)
    const count2 = ref(0)

    let callCount = 0
    let result1
    let result2
    const assertion = vi.fn((count, count2Value) => {
      callCount++
      // 首次执行发生在宿主渲染前，容器为空。
      // 再次执行发生在宿主文本提交前，仍看到上一轮内容。
      const expectedDOM = callCount === 1 ? `` : `${count - 1}`
      result1 = serializeInner(root) === expectedDOM

      // pre 回调虽早于宿主 patch，同步栈内两个状态赋值已全部完成。
      const expectedState = callCount - 1
      result2 = count === expectedState && count2Value === expectedState
    })

    const Comp = {
      /**
       * 调用 `watchEffect(() => { assertion(count.value, count2.value); })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `count.value`。
       */
      setup() {
        watchEffect(() => {
          assertion(count.value, count2.value)
        })
        return () => count.value
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(assertion).toHaveBeenCalledTimes(1)
    expect(result1).toBe(true)
    expect(result2).toBe(true)

    count.value++
    count2.value++
    await nextTick()
    // 同一同步栈内两次修改被合并为一次后续执行。
    expect(assertion).toHaveBeenCalledTimes(2)
    expect(result1).toBe(true)
    expect(result2).toBe(true)
  })

  // post watchEffect 在组件 DOM 提交后执行，首次执行也能读到已挂载的输出。
  it('flush timing: post', async () => {
    const count = ref(0)
    let result
    const assertion = vi.fn(count => {
      result = serializeInner(root) === `${count}`
    })

    const Comp = {
      /**
       * 调用 `watchEffect(() => { assertion(count.value); }, { flush: 'post' })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `count.value`。
       */
      setup() {
        watchEffect(
          () => {
            assertion(count.value)
          },
          { flush: 'post' },
        )
        return () => count.value
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(assertion).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)

    count.value++
    await nextTick()
    expect(assertion).toHaveBeenCalledTimes(2)
    expect(result).toBe(true)
  })

  // watchPostEffect 在首次挂载及后续更新的 DOM 提交后读取新文本。
  it('watchPostEffect', async () => {
    const count = ref(0)
    let result
    const assertion = vi.fn(count => {
      result = serializeInner(root) === `${count}`
    })

    const Comp = {
      /**
       * 调用 `watchPostEffect(() => { assertion(count.value); })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `count.value`。
       */
      setup() {
        watchPostEffect(() => {
          assertion(count.value)
        })
        return () => count.value
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(assertion).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)

    count.value++
    await nextTick()
    expect(assertion).toHaveBeenCalledTimes(2)
    expect(result).toBe(true)
  })

  // sync watchEffect 在每次依赖修改时立即执行，能读到下一条语句执行前的状态。
  it('flush timing: sync', async () => {
    const count = ref(0)
    const count2 = ref(0)

    let callCount = 0
    let result1
    let result2
    const assertion = vi.fn(count => {
      callCount++
      // 首次执行发生在宿主渲染前，容器为空。
      // 再次执行发生在宿主文本提交前，仍看到上一轮内容。
      const expectedDOM = callCount === 1 ? `` : `${count - 1}`
      result1 = serializeInner(root) === expectedDOM

      // 第二次 sync 回调发生在 count 改值时，下一条 count2 赋值尚未执行。
      // count2 赋值再触发第三次回调，此时可以读到它的新值。
      const expectedState = callCount < 3 ? 0 : 1
      result2 = count2.value === expectedState
    })

    const Comp = {
      /**
       * 调用 `watchEffect(() => { assertion(count.value); }, { flush: 'sync', })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `count.value`。
       */
      setup() {
        watchEffect(
          () => {
            assertion(count.value)
          },
          {
            flush: 'sync',
          },
        )
        return () => count.value
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(assertion).toHaveBeenCalledTimes(1)
    expect(result1).toBe(true)
    expect(result2).toBe(true)

    count.value++
    count2.value++
    await nextTick()
    expect(assertion).toHaveBeenCalledTimes(3)
    expect(result1).toBe(true)
    expect(result2).toBe(true)
  })

  // watchSyncEffect 对连续两次依赖修改逐次执行，不进入组件批处理队列。
  it('watchSyncEffect', async () => {
    const count = ref(0)
    const count2 = ref(0)

    let callCount = 0
    let result1
    let result2
    const assertion = vi.fn(count => {
      callCount++
      // 首次执行发生在宿主渲染前，容器为空。
      // 再次执行发生在宿主文本提交前，仍看到上一轮内容。
      const expectedDOM = callCount === 1 ? `` : `${count - 1}`
      result1 = serializeInner(root) === expectedDOM

      // 第二次 sync 回调发生在 count 改值时，下一条 count2 赋值尚未执行。
      // count2 赋值再触发第三次回调，此时可以读到它的新值。
      const expectedState = callCount < 3 ? 0 : 1
      result2 = count2.value === expectedState
    })

    const Comp = {
      /**
       * 调用 `watchSyncEffect(() => { assertion(count.value); })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `count.value`。
       */
      setup() {
        watchSyncEffect(() => {
          assertion(count.value)
        })
        return () => count.value
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(assertion).toHaveBeenCalledTimes(1)
    expect(result1).toBe(true)
    expect(result2).toBe(true)

    count.value++
    count2.value++
    await nextTick()
    expect(assertion).toHaveBeenCalledTimes(3)
    expect(result1).toBe(true)
    expect(result2).toBe(true)
  })

  // 同一次状态修改使组件卸载时，所属 post watcher 不再执行。
  it('should not fire on component unmount w/ flush: post', async () => {
    const toggle = ref(true)
    const cb = vi.fn()
    const Comp = {
      /**
       * 调用 `watch(toggle, cb, { flush: 'post' })` 完成本例的初始化登记或读取。
       */
      setup() {
        watch(toggle, cb, { flush: 'post' })
      },
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
    }
    const App = {
      /**
       * 渲染结果为 `toggle.value ? h(Comp) : null`。
       */
      render() {
        return toggle.value ? h(Comp) : null
      },
    }
    render(h(App), nodeOps.createElement('div'))
    expect(cb).not.toHaveBeenCalled()
    toggle.value = false
    await nextTick()
    expect(cb).not.toHaveBeenCalled()
  })

  // #2291
  // 父组件先卸载子组件，已入队的子组件 pre watcher 不再执行。
  it('should not fire on component unmount w/ flush: pre', async () => {
    const toggle = ref(true)
    const cb = vi.fn()
    const Comp = {
      /**
       * 调用 `watch(toggle, cb, { flush: 'pre' })` 完成本例的初始化登记或读取。
       */
      setup() {
        watch(toggle, cb, { flush: 'pre' })
      },
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
    }
    const App = {
      /**
       * 渲染结果为 `toggle.value ? h(Comp) : null`。
       */
      render() {
        return toggle.value ? h(Comp) : null
      },
    }
    render(h(App), nodeOps.createElement('div'))
    expect(cb).not.toHaveBeenCalled()
    toggle.value = false
    await nextTick()
    expect(cb).not.toHaveBeenCalled()
  })

  // #7030
  // 经中间父组件传递状态并卸载孙组件时，孙组件 pre watcher 不再执行。
  it('should not fire on child component unmount w/ flush: pre', async () => {
    const visible = ref(true)
    const cb = vi.fn()
    const Parent = defineComponent({
      props: ['visible'],
      /**
       * 渲染结果为 `visible.value ? h(Comp) : null`。
       */
      render() {
        return visible.value ? h(Comp) : null
      },
    })
    const Comp = {
      /**
       * 调用 `watch(visible, cb, { flush: 'pre' })` 完成本例的初始化登记或读取。
       */
      setup() {
        watch(visible, cb, { flush: 'pre' })
      },
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
    }
    const App = {
      /**
       * 渲染结果为 `h(Parent, { visible: visible.value, })`。
       */
      render() {
        return h(Parent, {
          visible: visible.value,
        })
      },
    }
    render(h(App), nodeOps.createElement('div'))
    expect(cb).not.toHaveBeenCalled()
    visible.value = false
    await nextTick()
    expect(cb).not.toHaveBeenCalled()
  })

  // #7030
  // 父子组件同时监听同一状态时，父 pre watcher 和父 render 先于子的对应任务。
  it('flush: pre watcher in child component should not fire before parent update', async () => {
    const b = ref(0)
    const calls: string[] = []

    const Comp = {
      /**
       * 子组件的 pre watcher 和 render 都读取 b，并分别记日志，检查同一次更新中子 watcher 先于子 render。
       */
      setup() {
        watch(
          () => b.value,
          val => {
            calls.push('watcher child')
          },
          { flush: 'pre' },
        )
        return () => {
          b.value
          calls.push('render child')
        }
      },
    }

    const Parent = {
      props: ['a'],
      /**
       * 父组件同样监听并渲染 b，再返回子组件；让父子任务一起入队，检查父 pre/render 先于子 pre/render。
       */
      setup() {
        watch(
          () => b.value,
          val => {
            calls.push('watcher parent')
          },
          { flush: 'pre' },
        )
        return () => {
          b.value
          calls.push('render parent')
          return h(Comp)
        }
      },
    }

    const App = {
      /**
       * 把 b 作为父组件 prop 传入，使外层更新也参与本例的父子调度顺序验证。
       */
      render() {
        return h(Parent, {
          a: b.value,
        })
      },
    }

    render(h(App), nodeOps.createElement('div'))
    expect(calls).toEqual(['render parent', 'render child'])

    b.value++
    await nextTick()
    expect(calls).toEqual([
      'render parent',
      'render child',
      'watcher parent',
      'render parent',
      'watcher child',
      'render child',
    ])
  })

  // #1763
  // 父级同步更新多个 props 后，子的 pre watcher 及其触发的 watcher 先于子 render 执行。
  it('flush: pre watcher watching props should fire before child update', async () => {
    const a = ref(0)
    const b = ref(0)
    const c = ref(0)
    const calls: string[] = []

    const Comp = {
      props: ['a', 'b'],
      /**
       * 调用 `watch(() => props.a + props.b, () => { calls.push('watcher 1'); c.value++; }, { flush: 'pre' })`、`watch(c, () => { calls.push('watcher 2'); }, { flush: 'pre' })` 完成本例的初始化登记或读取；返回渲染闭包，执行时执行 `calls.push('render')`。
       */
      setup(props: any) {
        watch(
          () => props.a + props.b,
          () => {
            calls.push('watcher 1')
            c.value++
          },
          { flush: 'pre' },
        )

        // #1777：第一个 pre watcher 改写 c，再触发第二个 pre watcher。
        watch(
          c,
          () => {
            calls.push('watcher 2')
          },
          { flush: 'pre' },
        )
        return () => {
          c.value
          calls.push('render')
        }
      },
    }

    const App = {
      /**
       * 渲染结果为 `h(Comp, { a: a.value, b: b.value })`。
       */
      render() {
        return h(Comp, { a: a.value, b: b.value })
      },
    }

    render(h(App), nodeOps.createElement('div'))
    expect(calls).toEqual(['render'])

    // 同一同步栈修改两个父级 prop 来源。
    // 子 props watcher 只执行一次，随后执行它触发的 c watcher。
    // 两个 pre 回调都完成后，才重新执行子 render。
    a.value++
    b.value++
    await nextTick()
    expect(calls).toEqual(['render', 'watcher 1', 'watcher 2', 'render'])
  })

  // #5721
  // setup 中连续修改数据，pre watcher 合并取最终值并先于 mounted 执行。
  it('flush: pre triggered in component setup should be buffered and called before mounted', () => {
    const count = ref(0)
    const calls: string[] = []
    const App = {
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 调用 `watch(count, () => { calls.push('watch ' + count.value); }, { flush: 'pre' })`、`onMounted(() => { calls.push('mounted'); })` 完成本例的初始化登记或读取；把 `count.value` 写入本例的状态或观察变量。
       */
      setup() {
        watch(
          count,
          () => {
            calls.push('watch ' + count.value)
          },
          { flush: 'pre' },
        )
        onMounted(() => {
          calls.push('mounted')
        })
        // setup 同步连改三次，pre watcher 合并读取最终 count=3。
        count.value++
        count.value++
        count.value++
      },
    }
    render(h(App), nodeOps.createElement('div'))
    expect(calls).toMatchObject(['watch 3', 'mounted'])
  })

  // #1852
  // post watcher 在模板 ref 赋值后执行，能读到新挂载的节点。
  it('flush: post watcher should fire after template refs updated', async () => {
    const toggle = ref(false)
    let dom: TestElement | null = null

    const App = {
      /**
       * 调用 `watch(toggle, () => { dom = domRef.value; }, { flush: 'post' })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `toggle.value ? h('p', { ref: domRef }) : null`。
       */
      setup() {
        const domRef = ref<TestElement | null>(null)

        watch(
          toggle,
          () => {
            dom = domRef.value
          },
          { flush: 'post' },
        )

        return () => {
          return toggle.value ? h('p', { ref: domRef }) : null
        }
      },
    }

    render(h(App), nodeOps.createElement('div'))
    expect(dom).toBe(null)

    toggle.value = true
    await nextTick()
    expect(dom!.tag).toBe('p')
  })

  // deep watcher 遍历嵌套对象、数组、Map 和 Set，响应各类内部修改。
  it('deep', async () => {
    const state = reactive({
      nested: {
        count: ref(0),
      },
      array: [1, 2, 3],
      map: new Map([
        ['a', 1],
        ['b', 2],
      ]),
      set: new Set([1, 2, 3]),
    })

    let dummy
    watch(
      () => state,
      state => {
        dummy = [
          state.nested.count,
          state.array[0],
          state.map.get('a'),
          state.set.has(1),
        ]
      },
      { deep: true },
    )

    state.nested.count++
    await nextTick()
    expect(dummy).toEqual([1, 1, 1, true])

    // 修改嵌套数组元素。
    state.array[0] = 2
    await nextTick()
    expect(dummy).toEqual([1, 2, 1, true])

    // 修改嵌套 Map 中 a 的值。
    state.map.set('a', 2)
    await nextTick()
    expect(dummy).toEqual([1, 2, 2, true])

    // 删除嵌套 Set 中的元素 1。
    state.set.delete(1)
    await nextTick()
    expect(dummy).toEqual([1, 2, 2, false])
  })

  // 深度遍历包含 ref 与 computed 的 reactive 数组，响应 ref 引发的计算结果变化。
  it('watching deep ref', async () => {
    const count = ref(0)
    const double = computed(() => count.value * 2)
    const state = reactive([count, double])

    let dummy
    watch(
      () => state,
      state => {
        dummy = [state[0].value, state[1].value]
      },
      { deep: true },
    )

    count.value++
    await nextTick()
    expect(dummy).toEqual([1, 2])
  })

  // 深度监听可枚举 Symbol 属性的修改、添加和删除，忽略不可枚举属性。
  it('deep with symbols', async () => {
    const symbol1 = Symbol()
    const symbol2 = Symbol()
    const symbol3 = Symbol()
    const symbol4 = Symbol()

    const raw: any = {
      [symbol1]: {
        [symbol2]: 1,
      },
    }

    Object.defineProperty(raw, symbol3, {
      writable: true,
      enumerable: false,
      value: 1,
    })

    const state = reactive(raw)
    const spy = vi.fn()

    watch(() => state, spy, { deep: true })

    await nextTick()
    expect(spy).toHaveBeenCalledTimes(0)

    state[symbol1][symbol2] = 2
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)

    // 不可枚举 Symbol 字段未被 traverse 读取，修改它不触发回调。
    state[symbol3] = 3
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)

    // 添加可枚举 Symbol 字段，触发已收集的枚举依赖。
    state[symbol4] = 1
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(2)

    // 删除该 Symbol 字段，再次触发枚举依赖。
    delete state[symbol4]
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(3)
  })

  // immediate watcher 创建时执行一次，后续依赖变化再执行。
  it('immediate', async () => {
    const count = ref(0)
    const cb = vi.fn()
    watch(count, cb, { immediate: true })
    expect(cb).toHaveBeenCalledTimes(1)
    count.value++
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(2)
  })

  // 初始值为 null 的数据源也会触发 immediate 回调。
  it('immediate: triggers when initial value is null', async () => {
    const state = ref(null)
    const spy = vi.fn()
    watch(() => state.value, spy, { immediate: true })
    expect(spy).toHaveBeenCalled()
  })

  // 初始值为 undefined 仍立即回调；再次写入相同 undefined 不重复调用。
  it('immediate: triggers when initial value is undefined', async () => {
    const state = ref()
    const spy = vi.fn()
    watch(() => state.value, spy, { immediate: true })
    expect(spy).toHaveBeenCalledWith(undefined, undefined, expect.any(Function))
    state.value = 3
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(2)
    // 从 3 改回 undefined，应视为一次值变化。
    state.value = undefined
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(3)
    // 连续赋同一 undefined 不应再次回调。
    state.value = undefined
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(3)
  })

  // watchEffect 传入 immediate 会警告，该选项不改变其首次立即执行。
  it('warn immediate option when using effect', async () => {
    const count = ref(0)
    let dummy
    watchEffect(
      () => {
        dummy = count.value
      },
      // @ts-expect-error
      { immediate: false },
    )
    expect(dummy).toBe(0)
    expect(`"immediate" option is only respected`).toHaveBeenWarned()

    count.value++
    await nextTick()
    expect(dummy).toBe(1)
  })

  // watchEffect 传入 deep 会警告，也不会替回调自动遍历返回的 ref。
  it('warn and not respect deep option when using effect', async () => {
    const arr = ref([1, [2]])
    const spy = vi.fn()
    watchEffect(
      () => {
        spy()
        return arr
      },
      // @ts-expect-error
      { deep: true },
    )
    expect(spy).toHaveBeenCalledTimes(1)
    ;(arr.value[1] as Array<number>)[0] = 3
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(`"deep" option is only respected`).toHaveBeenWarned()
  })

  // onTrack 接收 watchEffect 读取属性、检查键和枚举对象时的调试事件。
  it('onTrack', async () => {
    const events: DebuggerEvent[] = []
    let dummy
    const onTrack = vi.fn((e: DebuggerEvent) => {
      events.push(e)
    })
    const obj = reactive({ foo: 1, bar: 2 })
    watchEffect(
      () => {
        dummy = [obj.foo, 'bar' in obj, Object.keys(obj)]
      },
      { onTrack },
    )
    await nextTick()
    expect(dummy).toEqual([1, true, ['foo', 'bar']])
    expect(onTrack).toHaveBeenCalledTimes(3)
    expect(events).toMatchObject([
      {
        target: obj,
        type: TrackOpTypes.GET,
        key: 'foo',
      },
      {
        target: obj,
        type: TrackOpTypes.HAS,
        key: 'bar',
      },
      {
        target: obj,
        type: TrackOpTypes.ITERATE,
        key: ITERATE_KEY,
      },
    ])
  })

  // onTrigger 接收属性设置与删除引发的 watchEffect 调试事件。
  it('onTrigger', async () => {
    const events: DebuggerEvent[] = []
    let dummy
    const onTrigger = vi.fn((e: DebuggerEvent) => {
      events.push(e)
    })
    const obj = reactive<{ foo?: number }>({ foo: 1 })
    watchEffect(
      () => {
        dummy = obj.foo
      },
      { onTrigger },
    )
    await nextTick()
    expect(dummy).toBe(1)

    obj.foo!++
    await nextTick()
    expect(dummy).toBe(2)
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(events[0]).toMatchObject({
      type: TriggerOpTypes.SET,
      key: 'foo',
      oldValue: 1,
      newValue: 2,
    })

    delete obj.foo
    await nextTick()
    expect(dummy).toBeUndefined()
    expect(onTrigger).toHaveBeenCalledTimes(2)
    expect(events[1]).toMatchObject({
      type: TriggerOpTypes.DELETE,
      key: 'foo',
      oldValue: 2,
    })
  })

  // sync watch 在 ref 修改的同步调用栈内执行回调。
  it('should work sync', () => {
    const v = ref(1)
    let calls = 0

    watch(
      v,
      () => {
        ++calls
      },
      {
        flush: 'sync',
      },
    )

    expect(calls).toBe(0)
    v.value++
    expect(calls).toBe(1)
  })

  // shallowRef 内部修改不自动触发 watch，显式 triggerRef 后才读取新内部值。
  test('should force trigger on triggerRef when watching a shallow ref', async () => {
    const v = shallowRef({ a: 1 })
    let sideEffect = 0
    watch(v, obj => {
      sideEffect = obj.a
    })

    v.value = v.value
    await nextTick()
    // 当前修改不在已追踪范围内，回调计数保持原值。
    expect(sideEffect).toBe(0)

    v.value.a++
    await nextTick()
    // 当前修改不在已追踪范围内，回调计数保持原值。
    expect(sideEffect).toBe(0)

    triggerRef(v)
    await nextTick()
    // 显式通知已追踪依赖后，应重新执行对应 watcher。
    expect(sideEffect).toBe(2)
  })

  // 多数据源中的 shallowRef 经 triggerRef 通知后，即使数组引用未变也会回调。
  test('should force trigger on triggerRef when watching multiple sources: shallow ref array', async () => {
    const v = shallowRef([] as any)
    const spy = vi.fn()
    watch([v], () => {
      spy()
    })

    v.value.push(1)
    triggerRef(v)

    await nextTick()
    // 显式通知已追踪依赖后，应重新执行对应 watcher。
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // 对 reactive 属性的 toRef 调用 triggerRef，也能重新执行读取该 ref 的 watchEffect。
  test('should force trigger on triggerRef with toRef from reactive', async () => {
    const foo = reactive({ bar: 1 })
    const bar = toRef(foo, 'bar')
    const spy = vi.fn()

    watchEffect(() => {
      bar.value
      spy()
    })

    expect(spy).toHaveBeenCalledTimes(1)

    triggerRef(bar)

    await nextTick()
    // 显式通知已追踪依赖后，应重新执行对应 watcher。
    expect(spy).toHaveBeenCalledTimes(2)
  })

  // #2125
  // watchEffect 向自己读取的数组 push，不递归执行自身。
  test('watchEffect should not recursively trigger itself', async () => {
    const spy = vi.fn()
    const price = ref(10)
    const history = ref<number[]>([])
    watchEffect(() => {
      history.value.push(price.value)
      spy()
    })
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // #2231
  // computed 的依赖变化但计算结果未变时，不再次调用 watch 回调。
  test('computed refs should not trigger watch if value has no change', async () => {
    const spy = vi.fn()
    const source = ref(0)
    const price = computed(() => source.value === 0)
    watch(price, spy)
    source.value++
    await nextTick()
    source.value++
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // https://github.com/vuejs/core/issues/2381
  // 在父组件 mounted 中调用子实例 $watch，watcher 仍属于子实例并随子卸载停止。
  test('$watch should always register its effects with its own instance', async () => {
    let instance: ComponentInternalInstance | null
    let _show: Ref<boolean>

    const Child = defineComponent({
      /**
       * 渲染结果为 `h('div')`。
       */
      render: () => h('div'),
      /**
       * 在 mounted 阶段执行 `getCurrentInstance()`；写入 `instance` 供后续观察或触发更新。
       */
      mounted() {
        instance = getCurrentInstance()
      },
      /**
       * 在 unmounted 阶段保留生命周期占位。
       */
      unmounted() {},
    })

    const Comp = defineComponent({
      /**
       * 把 `_show` 写入本例的状态或观察变量；返回 `comp`、`show` 作为后续渲染可读的绑定。
       */
      setup() {
        const comp = ref<ComponentPublicInstance | undefined>()
        const show = ref(true)
        _show = show
        return { comp, show }
      },
      /**
       * 渲染结果为 `this.show ? h(Child, { ref: vm => void (this.comp = vm as ComponentPublicInstance), }) : null`。
       */
      render() {
        return this.show
          ? h(Child, {
              /**
               * 修改或记录 `this.comp`；返回 `void (this.comp = vm as ComponentPublicInstance)`。
               */
              ref: vm => void (this.comp = vm as ComponentPublicInstance),
            })
          : null
      },
      /**
       * 在 mounted 阶段执行 `this.comp!.$watch(() => this.show, () => void 0)`。
       */
      mounted() {
        // 调用点位于父 Comp 的 mounted，而 $watch 接收者是 Child 的公开实例。
        // instanceWatch 必须将新 watcher 的 scope 切到 Child。
        this.comp!.$watch(
          () => this.show,
          () => void 0,
        )
      },
    })

    render(h(Comp), nodeOps.createElement('div'))

    expect(instance!).toBeDefined()
    expect(instance!.scope.effects).toBeInstanceOf(Array)
    // 子 scope 同时包含自身 render effect 和经 $watch 注册的 watcher effect。
    expect(instance!.scope.effects.length).toBe(2)

    _show!.value = false

    await nextTick()
    await nextTick()

    expect(instance!.scope.effects.length).toBe(0)
  })

  // created 中把函数 source 传给 this.$watch，挂载后确认公共实例已记录；参数成员检查只有 expect(...) 而没有 matcher，本例没有有效断言 source 收到该实例参数。
  test('this.$watch should pass `this.proxy` to watch source as the first argument ', () => {
    let instance: any
    const source = vi.fn()

    const Comp = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$watch(source, function () { })`；写入 `instance` 供后续观察或触发更新。
       */
      created(this: any) {
        instance = this
        this.$watch(source, function () {})
      },
    })

    const root = nodeOps.createElement('div')
    createApp(Comp).mount(root)

    expect(instance).toBeDefined()
    expect(source.mock.calls.some(args => args.includes(instance)))
  })

  // setup 中调用普通 watch 时，不给函数数据源传入 this.proxy 参数。
  test('should not leak `this.proxy` to setup()', () => {
    const source = vi.fn()

    const Comp = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 调用 `watch(source, () => { })` 完成本例的初始化登记或读取。
       */
      setup() {
        watch(source, () => {})
      },
    })

    const root = nodeOps.createElement('div')
    createApp(Comp).mount(root)
    // 普通 watch 的 source 调用不传入实例参数，参数列表为空。
    expect(source.mock.calls[0]).toMatchObject([])
  })

  // #2728
  // pre watcher 回调读取的其他 ref 不成为子组件的渲染依赖。
  test('pre watcher callbacks should not track dependencies', async () => {
    const a = ref(0)
    const b = ref(0)
    const updated = vi.fn()

    const Child = defineComponent({
      props: ['a'],
      updated,
      watch: {
        /**
         * Options pre watcher 的回调只读取 b.value，不返回派生数据；修改 b 后 Child.updated 次数检查该读取没有污染渲染依赖。
         */
        a() {
          b.value
        },
      },
      /**
       * 渲染结果为 `h('div', this.a)`。
       */
      render() {
        return h('div', this.a)
      },
    })

    const Parent = defineComponent({
      /**
       * 渲染结果为 `h(Child, { a: a.value })`。
       */
      render() {
        return h(Child, { a: a.value })
      },
    })

    const root = nodeOps.createElement('div')
    createApp(Parent).mount(root)

    a.value++
    await nextTick()
    expect(updated).toHaveBeenCalledTimes(1)

    b.value++
    await nextTick()
    // watch 回调读取 b 不应让它成为 Child render 的依赖。
    expect(updated).toHaveBeenCalledTimes(1)
  })

  // Options watch 与 this.$watch 都能通过 a.b 路径响应嵌套属性变化。
  test('watching keypath', async () => {
    const spy = vi.fn()
    const Comp = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 建立每实例初始 data：`{ a: { b: 1, }, }`。
       */
      data() {
        return {
          a: {
            b: 1,
          },
        }
      },
      watch: {
        'a.b': spy,
      },
      /**
       * 在 created 阶段执行 `this.$watch('a.b', spy)`。
       */
      created(this: any) {
        this.$watch('a.b', spy)
      },
      /**
       * 在 mounted 阶段写入 `this.a.b` 供后续观察或触发更新。
       */
      mounted(this: any) {
        this.a.b++
      },
    })

    const root = nodeOps.createElement('div')
    createApp(Comp).mount(root)

    await nextTick()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  // ref 中的数组被替换成新引用时，watch 调用一次回调。
  it('watching sources: ref<any[]>', async () => {
    const foo = ref([1])
    const spy = vi.fn()
    watch(foo, () => {
      spy()
    })
    foo.value = foo.value.slice()
    await nextTick()
    expect(spy).toBeCalledTimes(1)
  })

  // 多数据源中的 computed 结果未变时，不触发回调。
  it('watching multiple sources: computed', async () => {
    let count = 0
    const value = ref('1')
    const plus = computed(() => !!value.value)
    watch([plus], () => {
      count++
    })
    value.value = '2'
    await nextTick()
    expect(plus.value).toBe(true)
    expect(count).toBe(0)
  })

  // #4158
  // detached effectScope 内创建的 watch 不登记到当前组件的 scope.effects。
  test('watch should not register in owner component if created inside detached scope', () => {
    let instance: ComponentInternalInstance
    const Comp = {
      /**
       * 调用 `getCurrentInstance()` 完成本例的初始化登记或读取；把 `instance` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `''`。
       */
      setup() {
        instance = getCurrentInstance()!
        effectScope(true).run(() => {
          watch(
            () => 1,
            () => {},
          )
        })
        return () => ''
      },
    }
    const root = nodeOps.createElement('div')
    createApp(Comp).mount(root)
    // watcher 留在独立 detached scope，不登记到组件 scope。
    // 组件 scope 中只有自身 render effect。
    expect(instance!.scope.effects.length).toBe(1)
  })

  // detached effectScope 中的 watchEffect 和 watch 在组件卸载后仍可响应修改。
  test('watchEffect should keep running if created in a detached scope', async () => {
    const trigger = ref(0)
    let countWE = 0
    let countW = 0
    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `''`。
       */
      setup() {
        effectScope(true).run(() => {
          watchEffect(() => {
            trigger.value
            countWE++
          })
          watch(trigger, () => countW++)
        })
        return () => ''
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    // 初始 watchEffect 已执行；watch 未使用 immediate，尚未执行回调。
    expect(countWE).toBe(1)
    expect(countW).toBe(0)
    trigger.value++
    await nextTick()
    // 组件尚挂载时，修改 trigger 会使两类 watcher 都执行。
    expect(countWE).toBe(2)
    expect(countW).toBe(1)
    render(null, root) // 卸载当前组件。
    await nextTick()
    trigger.value++
    await nextTick()
    // 组件卸载不停止 detached scope，修改 trigger 后两类 watcher 仍运行。
    expect(countWE).toBe(3)
    expect(countW).toBe(2)
  })

  const options = [
    { name: 'only trigger once watch' },
    {
      deep: true,
      name: 'only trigger once watch with deep',
    },
    {
      flush: 'sync',
      name: 'only trigger once watch with flush: sync',
    },
    {
      flush: 'pre',
      name: 'only trigger once watch with flush: pre',
    },
    {
      immediate: true,
      name: 'only trigger once watch with immediate',
    },
  ] as const
  // 对初始 count=0 分别使用默认、deep、sync、pre 与 immediate 五组 once 配置；两次递增并刷新后回调始终一次，immediate 在创建时已消耗唯一调用。
  test.each(options)('$name', async option => {
    const count = ref(0)
    const cb = vi.fn()

    watch(count, cb, { once: true, ...option })

    count.value++
    await nextTick()

    expect(count.value).toBe(1)
    expect(cb).toHaveBeenCalledTimes(1)

    count.value++
    await nextTick()

    expect(count.value).toBe(2)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  // #5151
  // 回调不再登记新清理时，旧清理仍在下一次回调前执行且不会反复执行。
  test('OnCleanup also needs to be cleaned，', async () => {
    const spy1 = vi.fn()
    const spy2 = vi.fn()
    const num = ref(0)

    watch(num, (value, oldValue, onCleanup) => {
      if (value > 1) {
        return
      }
      spy1()
      onCleanup(() => {
        // 执行旧 cleanup 后移除登记，后续回调未再注册就不应重复清理。
        spy2()
      })
    })

    num.value++
    await nextTick()
    expect(spy1).toHaveBeenCalledTimes(1)
    expect(spy2).toHaveBeenCalledTimes(0)

    num.value++
    await nextTick()

    expect(spy1).toHaveBeenCalledTimes(1)
    expect(spy2).toHaveBeenCalledTimes(1)

    num.value++
    await nextTick()
    // value>1 的回调提前返回，旧 cleanup 已清掉，两个 spy 次数都保持不变。
    expect(spy1).toHaveBeenCalledTimes(1)
    expect(spy2).toHaveBeenCalledTimes(1)
  })

  // reactive 对象的 deep: 2 响应第二层替换，不响应更深层替换。
  it('watching reactive depth', async () => {
    const state = reactive({
      a: {
        b: {
          c: {
            d: {
              e: 1,
            },
          },
        },
      },
    })

    const cb = vi.fn()

    watch(state, cb, { deep: 2 })

    state.a.b = { c: { d: { e: 2 } } }
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(1)

    state.a.b.c = { d: { e: 3 } }

    await nextTick()
    expect(cb).toHaveBeenCalledTimes(1)

    state.a.b = { c: { d: { e: 4 } } }

    await nextTick()
    expect(cb).toHaveBeenCalledTimes(2)
  })

  // 对象 ref 的 deep: 1 响应根对象的属性替换，不响应下一层内部修改。
  it('watching ref depth', async () => {
    const state = ref({
      a: {
        b: 2,
      },
    })

    const cb = vi.fn()

    watch(state, cb, { deep: 1 })

    state.value.a.b = 3
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(0)

    state.value.a = { b: 3 }
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  // 数组 ref 的 deep: 2 响应数组增删及元素属性替换，忽略更深层属性修改。
  it('watching array depth', async () => {
    const arr = ref([
      {
        a: {
          b: 2,
        },
      },
      {
        a: {
          b: 3,
        },
      },
    ])
    const cb = vi.fn()
    watch(arr, cb, { deep: 2 })

    arr.value[0].a.b = 3
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(0)

    arr.value[0].a = { b: 3 }
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(1)

    arr.value[1].a = { b: 4 }
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(2)

    arr.value.push({ a: { b: 5 } })
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(3)

    arr.value.pop()
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(4)
  })

  // 同一对象可经不同数组路径到达；各 watcher 按自己的最大遍历深度响应修改。
  test('watching the same object at different depths', async () => {
    const arr1: any[] = reactive([[[{ foo: {} }]]])
    const arr2 = arr1[0]
    const arr3 = arr2[0]
    const obj = arr3[0]
    arr1.push(arr3)

    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const cb3 = vi.fn()
    const cb4 = vi.fn()
    watch(arr1, cb1, { deep: 1 })
    watch(arr1, cb2, { deep: 2 })
    watch(arr1, cb3, { deep: 3 })
    watch(arr1, cb4, { deep: 4 })

    await nextTick()
    expect(cb1).toHaveBeenCalledTimes(0)
    expect(cb2).toHaveBeenCalledTimes(0)
    expect(cb3).toHaveBeenCalledTimes(0)
    expect(cb4).toHaveBeenCalledTimes(0)

    obj.foo = {}
    await nextTick()
    expect(cb1).toHaveBeenCalledTimes(0)
    expect(cb2).toHaveBeenCalledTimes(0)
    expect(cb3).toHaveBeenCalledTimes(1)
    expect(cb4).toHaveBeenCalledTimes(1)

    obj.foo.bar = 1
    await nextTick()
    expect(cb1).toHaveBeenCalledTimes(0)
    expect(cb2).toHaveBeenCalledTimes(0)
    expect(cb3).toHaveBeenCalledTimes(1)
    expect(cb4).toHaveBeenCalledTimes(2)

    arr3.push(obj.foo)
    await nextTick()
    expect(cb1).toHaveBeenCalledTimes(0)
    expect(cb2).toHaveBeenCalledTimes(1)
    expect(cb3).toHaveBeenCalledTimes(2)
    expect(cb4).toHaveBeenCalledTimes(3)

    obj.foo.bar = 2
    await nextTick()
    expect(cb1).toHaveBeenCalledTimes(0)
    expect(cb2).toHaveBeenCalledTimes(1)
    expect(cb3).toHaveBeenCalledTimes(3)
    expect(cb4).toHaveBeenCalledTimes(4)
  })

  // pause 期间不回调；resume 后合并未处理的修改，并保留暂停前的旧值。
  test('pause / resume', async () => {
    const count = ref(0)
    const cb = vi.fn()
    const { pause, resume } = watch(count, cb)

    count.value++
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenLastCalledWith(1, 0, expect.any(Function))

    pause()
    count.value++
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenLastCalledWith(1, 0, expect.any(Function))

    resume()
    count.value++
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(2)
    expect(cb).toHaveBeenLastCalledWith(3, 1, expect.any(Function))

    count.value++
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(3)
    expect(cb).toHaveBeenLastCalledWith(4, 3, expect.any(Function))

    pause()
    count.value++
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(3)
    expect(cb).toHaveBeenLastCalledWith(4, 3, expect.any(Function))

    resume()
    await nextTick()
    expect(cb).toHaveBeenCalledTimes(4)
    expect(cb).toHaveBeenLastCalledWith(5, 4, expect.any(Function))
  })

  // 直接监听 shallowReactive 对象，只响应根层修改，不追踪其中 ref 或普通对象的内部变化。
  it('shallowReactive', async () => {
    const state = shallowReactive({
      msg: ref('hello'),
      foo: {
        a: ref(1),
        b: 2,
      },
      bar: 'bar',
    })

    const spy = vi.fn()

    watch(state, spy)

    state.msg.value = 'hi'
    await nextTick()
    expect(spy).not.toHaveBeenCalled()

    state.bar = 'bar2'
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)

    state.foo.a.value++
    state.foo.b++
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)

    state.bar = 'bar3'
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(2)
  })
  // reactive 对象显式 deep: false，只响应根层属性修改。
  it('watching reactive with deep: false', async () => {
    const state = reactive({
      foo: {
        a: 2,
      },
      bar: 'bar',
    })

    const spy = vi.fn()

    watch(state, spy, { deep: false })

    state.foo.a++
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(0)

    state.bar = 'bar2'
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // 停止 watcher 后从所属 scope.effects 移除；immediate + once 执行后也不留下 effect。
  test("effect should be removed from scope's effects after it is stopped", () => {
    const num = ref(0)
    let unwatch: () => void

    let instance: ComponentInternalInstance
    const Comp = {
      /**
       * 调用 `getCurrentInstance()`、`watch(num, () => { console.log(num.value); })` 完成本例的初始化登记或读取；把 `instance`、`unwatch` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        instance = getCurrentInstance()!
        unwatch = watch(num, () => {
          console.log(num.value)
        })
        return () => null
      },
    }
    const root = nodeOps.createElement('div')
    createApp(Comp).mount(root)
    expect(instance!.scope.effects.length).toBe(2)
    unwatch!()
    expect(instance!.scope.effects.length).toBe(1)

    const scope = effectScope()
    scope.run(() => {
      unwatch = watch(num, () => {
        console.log(num.value)
      })
    })
    expect(scope.effects.length).toBe(1)
    unwatch!()
    expect(scope.effects.length).toBe(0)

    scope.run(() => {
      watch(num, () => {}, { once: true, immediate: true })
    })
    expect(scope.effects.length).toBe(0)
  })

  // 模拟同步双向引用流程：内层 sync 回调必须看到外层临时标志。
  // 两个 sync watcher 同步串联时，内层回调在外层临时标记复位之前执行。
  test('sync watcher should not be batched', () => {
    const a = ref(0)
    const b = ref(0)
    let pauseB = false
    watch(
      a,
      () => {
        pauseB = true
        b.value = a.value + 1
        pauseB = false
      },
      { flush: 'sync' },
    )
    watch(
      b,
      () => {
        if (!pauseB) {
          throw new Error('should not be called')
        }
      },
      { flush: 'sync' },
    )

    a.value = 1
    expect(b.value).toBe(2)
  })

  // watchEffect 依赖的 computed 结果未变时，不重新执行副作用。
  test('watchEffect should not fire on computed deps that did not change', async () => {
    const a = ref(0)
    const c = computed(() => a.value % 2)
    const spy = vi.fn()
    watchEffect(() => {
      spy()
      c.value
    })
    expect(spy).toHaveBeenCalledTimes(1)
    a.value += 2
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // 深度遍历遇到循环引用会停止重复访问，仍能监听循环对象的属性修改。
  test('circular reference', async () => {
    const obj = { a: 1 }
    // @ts-expect-error
    obj.b = obj
    const foo = ref(obj)
    const spy = vi.fn()

    watch(foo, spy, { deep: true })

    // @ts-expect-error
    foo.value.b.a = 2
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(foo.value.a).toBe(2)
  })

  // setup 中 detached scope 内的 immediate watch 和普通 watchEffect 抛错，都由父组件捕获。
  test('watch immediate error in effect scope should be caught by onErrorCaptured', async () => {
    const warn = vi.spyOn(console, 'warn')
    warn.mockImplementation(() => {})
    const ERROR_IN_SCOPE = 'ERROR_IN_SCOPE'
    const ERROR_OUT_SCOPE = 'ERROR_OUT_SCOPE'

    const errors = ref<string[]>([])
    const Comp = {
      /**
       * 调用 `watchEffect(() => { throw new Error(ERROR_OUT_SCOPE); })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `''`。
       */
      setup() {
        const trigger = ref(0)

        effectScope(true).run(() => {
          watch(
            trigger,
            () => {
              throw new Error(ERROR_IN_SCOPE)
            },
            { immediate: true },
          )
        })

        watchEffect(() => {
          throw new Error(ERROR_OUT_SCOPE)
        })

        return () => ''
      },
    }

    const root = nodeOps.createElement('div')
    render(
      h(
        {
          /**
           * 调用 `onErrorCaptured(e => { errors.value.push(e.message); return false; })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div', slots.default && slots.default())`。
           */
          setup(_, { slots }) {
            onErrorCaptured(e => {
              errors.value.push(e.message)
              return false
            })

            return () => h('div', slots.default && slots.default())
          },
        },
        null,
        () => [h(Comp)],
      ),
      root,
    )
    await nextTick()
    // immediate watch 与 watchEffect 的错误依次进入父级捕获钩子。
    expect(errors.value).toHaveLength(2)
    expect(errors.value[0]).toBe(ERROR_IN_SCOPE)
    expect(errors.value[1]).toBe(ERROR_OUT_SCOPE)

    warn.mockRestore()
  })

  // 监听同一个 ref 的两个 sync watcher，按登记顺序在修改时执行。
  test('should be executed correctly', () => {
    const v = ref(1)
    let foo = ''

    watch(
      v,
      () => {
        foo += '1'
      },
      {
        flush: 'sync',
      },
    )
    watch(
      v,
      () => {
        foo += '2'
      },
      {
        flush: 'sync',
      },
    )

    expect(foo).toBe('')
    v.value++
    expect(foo).toBe('12')
  })

  // 12045
  // sync watcher 修改第二个 ref，不会丢失已订阅第一个 ref 的 pre watcher 通知。
  test('sync watcher should not break pre watchers', async () => {
    const count1 = ref(0)
    const count2 = ref(0)

    watch(
      count1,
      () => {
        count2.value++
      },
      { flush: 'sync' },
    )

    const spy1 = vi.fn()
    watch([count1, count2], spy1)

    const spy2 = vi.fn()
    watch(count1, spy2)

    count1.value++

    await nextTick()
    expect(spy1).toHaveBeenCalled()
    expect(spy2).toHaveBeenCalled()
  })

  // #12631
  // created 中调用 this.$watch 后登记 onScopeDispose；挂载结束时清理回调尚未执行。
  test('this.$watch w/ onScopeDispose', () => {
    const onCleanup = vi.fn()
    const toggle = ref(true)

    const Comp = defineComponent({
      /**
       * 空渲染占位，让组件完成本例所需的初始化，断言读取状态或诊断结果。
       */
      render() {},
      /**
       * 在 created 阶段执行 `this.$watch(() => 1, function () { })`、`onScopeDispose(onCleanup)`。
       */
      created(this: any) {
        this.$watch(
          () => 1,
          function () {},
        )
        onScopeDispose(onCleanup)
      },
    })

    const App = defineComponent({
      /**
       * 渲染结果为 `toggle.value ? h(Comp) : null`。
       */
      render() {
        return toggle.value ? h(Comp) : null
      },
    })

    const root = nodeOps.createElement('div')
    createApp(App).mount(root)
    expect(onCleanup).toBeCalledTimes(0)
  })
})
