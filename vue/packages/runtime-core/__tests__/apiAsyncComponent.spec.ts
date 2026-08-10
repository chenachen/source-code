/**
 * 测试阅读说明：本文件验证 `runtime-core/apiAsyncComponent` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import {
  type Component,
  KeepAlive,
  Suspense,
  defineAsyncComponent,
  h,
  nextTick,
  ref,
} from '../src'
import { createApp, nodeOps, serializeInner } from '@vue/runtime-test'
import { onActivated } from '../src/components/KeepAlive'

/** 控制异步组件 loader、delay 和 timeout 之间的时间先后。 */
const timeout = (n: number = 0) => new Promise(r => setTimeout(r, n))

// 测试组：defineAsyncComponent 的加载、延迟、超时、重试、Suspense 和 KeepAlive 协作。
describe('api: defineAsyncComponent', () => {
  // 测试场景：简单用法。
  test('simple usage', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent(
      () =>
        new Promise(r => {
          resolve = r as any
        }),
    )

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    createApp({
      render: () => (toggle.value ? h(Foo) : null),
    }).mount(root)

    expect(serializeInner(root)).toBe('<!---->')

    resolve!(() => 'resolved')
    // first time resolve, wait for macro task since there are multiple
    // microtasks / .then() calls
    await timeout()
    expect(serializeInner(root)).toBe('resolved')

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // already resolved component should update on nextTick
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('resolved')
  })

  // 测试场景：带加载组件。
  test('with loading component', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      loader: () =>
        new Promise(r => {
          resolve = r as any
        }),
      loadingComponent: () => 'loading',
      delay: 1, // defaults to 200
    })

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    createApp({
      render: () => (toggle.value ? h(Foo) : null),
    }).mount(root)

    // due to the delay, initial mount should be empty
    expect(serializeInner(root)).toBe('<!---->')

    // loading show up after delay
    await timeout(1)
    expect(serializeInner(root)).toBe('loading')

    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // already resolved component should update on nextTick without loading
    // state
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('resolved')
  })

  // 测试场景：带加载组件 + 显式延迟 (0)。
  test('with loading component + explicit delay (0)', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      loader: () =>
        new Promise(r => {
          resolve = r as any
        }),
      loadingComponent: () => 'loading',
      delay: 0,
    })

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    createApp({
      render: () => (toggle.value ? h(Foo) : null),
    }).mount(root)

    // with delay: 0, should show loading immediately
    expect(serializeInner(root)).toBe('loading')

    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // already resolved component should update on nextTick without loading
    // state
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('resolved')
  })

  // 测试场景：没有错误组件的错误。
  test('error without error component', async () => {
    let resolve: (comp: Component) => void
    let reject: (e: Error) => void
    const Foo = defineAsyncComponent(
      () =>
        new Promise((_resolve, _reject) => {
          resolve = _resolve as any
          reject = _reject
        }),
    )

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => (toggle.value ? h(Foo) : null),
    })

    const handler = (app.config.errorHandler = vi.fn())

    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')

    const err = new Error('foo')
    reject!(err)
    await timeout()
    expect(handler).toHaveBeenCalled()
    expect(handler.mock.calls[0][0]).toBe(err)
    expect(serializeInner(root)).toBe('<!---->')

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // errored out on previous load, toggle and mock success this time
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // should render this time
    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  // 测试场景：错误组件错误。
  test('error with error component', async () => {
    let resolve: (comp: Component) => void
    let reject: (e: Error) => void
    const Foo = defineAsyncComponent({
      loader: () =>
        new Promise((_resolve, _reject) => {
          resolve = _resolve as any
          reject = _reject
        }),
      errorComponent: (props: { error: Error }) => props.error.message,
    })

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => (toggle.value ? h(Foo) : null),
    })

    const handler = (app.config.errorHandler = vi.fn())

    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')

    const err = new Error('errored out')
    reject!(err)
    await timeout()
    expect(handler).toHaveBeenCalled()
    expect(serializeInner(root)).toBe('errored out')

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // errored out on previous load, toggle and mock success this time
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // should render this time
    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  // #2129
  // 测试场景：带有错误组件的错误，没有全局处理程序。
  test('error with error component, without global handler', async () => {
    let resolve: (comp: Component) => void
    let reject: (e: Error) => void
    const Foo = defineAsyncComponent({
      loader: () =>
        new Promise((_resolve, _reject) => {
          resolve = _resolve as any
          reject = _reject
        }),
      errorComponent: (props: { error: Error }) => props.error.message,
    })

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => (toggle.value ? h(Foo) : null),
    })

    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')

    const err = new Error('errored out')
    reject!(err)
    await timeout()
    expect(serializeInner(root)).toBe('errored out')
    expect(
      'Unhandled error during execution of async component loader',
    ).toHaveBeenWarned()

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // errored out on previous load, toggle and mock success this time
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // should render this time
    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  // 测试场景：错误 + 加载组件。
  test('error with error + loading components', async () => {
    let resolve: (comp: Component) => void
    let reject: (e: Error) => void
    const Foo = defineAsyncComponent({
      loader: () =>
        new Promise((_resolve, _reject) => {
          resolve = _resolve as any
          reject = _reject
        }),
      errorComponent: (props: { error: Error }) => props.error.message,
      loadingComponent: () => 'loading',
      delay: 1,
    })

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => (toggle.value ? h(Foo) : null),
    })

    const handler = (app.config.errorHandler = vi.fn())

    app.mount(root)

    // due to the delay, initial mount should be empty
    expect(serializeInner(root)).toBe('<!---->')

    // loading show up after delay
    await timeout(1)
    expect(serializeInner(root)).toBe('loading')

    const err = new Error('errored out')
    reject!(err)
    await timeout()
    expect(handler).toHaveBeenCalled()
    expect(serializeInner(root)).toBe('errored out')

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // errored out on previous load, toggle and mock success this time
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // loading show up after delay
    await timeout(1)
    expect(serializeInner(root)).toBe('loading')

    // should render this time
    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  // 测试场景：无错误组件超时。
  test('timeout without error component', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      loader: () =>
        new Promise(_resolve => {
          resolve = _resolve as any
        }),
      timeout: 1,
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => h(Foo),
    })

    const handler = vi.fn()
    app.config.errorHandler = handler

    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')

    await timeout(1)
    expect(handler).toHaveBeenCalled()
    expect(handler.mock.calls[0][0].message).toMatch(
      `Async component timed out after 1ms.`,
    )
    expect(serializeInner(root)).toBe('<!---->')

    // if it resolved after timeout, should still work
    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  // 测试场景：超时，有错误组件。
  test('timeout with error component', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      loader: () =>
        new Promise(_resolve => {
          resolve = _resolve as any
        }),
      timeout: 1,
      errorComponent: () => 'timed out',
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => h(Foo),
    })

    const handler = (app.config.errorHandler = vi.fn())

    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')

    await timeout(1)
    expect(handler).toHaveBeenCalled()
    expect(serializeInner(root)).toBe('timed out')

    // if it resolved after timeout, should still work
    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  // 测试场景：超时，错误 + 加载组件。
  test('timeout with error + loading components', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      loader: () =>
        new Promise(_resolve => {
          resolve = _resolve as any
        }),
      delay: 1,
      timeout: 16,
      errorComponent: () => 'timed out',
      loadingComponent: () => 'loading',
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => h(Foo),
    })
    const handler = (app.config.errorHandler = vi.fn())
    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')
    await timeout(1)
    expect(serializeInner(root)).toBe('loading')

    await timeout(16)
    expect(serializeInner(root)).toBe('timed out')
    expect(handler).toHaveBeenCalled()

    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  // 测试场景：没有错误组件但有加载组件时超时。
  test('timeout without error component, but with loading component', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      loader: () =>
        new Promise(_resolve => {
          resolve = _resolve as any
        }),
      delay: 1,
      timeout: 16,
      loadingComponent: () => 'loading',
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => h(Foo),
    })
    const handler = vi.fn()
    app.config.errorHandler = handler
    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')
    await timeout(1)
    expect(serializeInner(root)).toBe('loading')

    await timeout(16)
    expect(handler).toHaveBeenCalled()
    expect(handler.mock.calls[0][0].message).toMatch(
      `Async component timed out after 16ms.`,
    )
    // should still display loading
    expect(serializeInner(root)).toBe('loading')

    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  // 测试场景：卸载后不应调用errorHandler（超时）。
  test('should not call errorHandler after unmount (timeout)', async () => {
    const Foo = defineAsyncComponent({
      loader: () => new Promise(() => {}),
      timeout: 50,
    })

    const show = ref(true)
    const root = nodeOps.createElement('div')
    const handler = vi.fn()
    const app = createApp({
      render: () => (show.value ? h(Foo) : null),
    })
    app.config.errorHandler = handler
    app.mount(root)

    show.value = false
    await nextTick()

    await timeout(60)
    expect(handler).not.toHaveBeenCalled()
  })

  // 测试场景：卸载后不应调用 errorHandler（加载程序错误）。
  test('should not call errorHandler after unmount (loader error)', async () => {
    const Foo = defineAsyncComponent({
      loader: () => Promise.reject(new Error('load failed')),
    })

    const show = ref(true)
    const root = nodeOps.createElement('div')
    const handler = vi.fn()
    const app = createApp({
      render: () => (show.value ? h(Foo) : null),
    })
    app.config.errorHandler = handler
    app.mount(root)

    show.value = false
    await nextTick()

    await timeout()
    expect(handler).not.toHaveBeenCalled()
  })

  // 测试场景：卸载后忽略被拒绝的加载程序后应重试加载程序。
  test('should retry loader after rejected loader is ignored after unmount', async () => {
    let reject!: (err: Error) => void
    let resolve!: (comp: Component) => void

    const loader = vi.fn(
      () =>
        new Promise<Component>((_resolve, _reject) => {
          resolve = _resolve
          reject = _reject
        }),
    )

    const Foo = defineAsyncComponent({ loader })
    const show = ref(true)
    const root = nodeOps.createElement('div')
    const handler = vi.fn()

    const app = createApp({
      render: () => (show.value ? h(Foo) : null),
    })
    app.config.errorHandler = handler
    app.mount(root)

    show.value = false
    await nextTick()

    reject(new Error('load failed'))
    await timeout()

    expect(handler).not.toHaveBeenCalled()

    show.value = true
    await nextTick()

    expect(loader).toHaveBeenCalledTimes(2)

    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  // 测试场景：异步组件位于 Suspense 内时把加载等待交给最近边界处理。
  test('with suspense', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent(
      () =>
        new Promise(_resolve => {
          resolve = _resolve as any
        }),
    )

    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () =>
        h(Suspense, null, {
          default: () => h('div', [h(Foo), ' & ', h(Foo)]),
          fallback: () => 'loading',
        }),
    })

    app.mount(root)
    expect(serializeInner(root)).toBe('loading')

    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('<div>resolved & resolved</div>')
  })

  // 测试场景：suspensible: false 时不登记到 Suspense，独立显示加载状态。
  test('suspensible: false', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      loader: () =>
        new Promise(_resolve => {
          resolve = _resolve as any
        }),
      suspensible: false,
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () =>
        h(Suspense, null, {
          default: () => h('div', [h(Foo), ' & ', h(Foo)]),
          fallback: () => 'loading',
        }),
    })

    app.mount(root)
    // should not show suspense fallback
    expect(serializeInner(root)).toBe('<div><!----> & <!----></div>')

    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('<div>resolved & resolved</div>')
  })

  // 测试场景：suspense 带错误处理。
  test('suspense with error handling', async () => {
    let reject: (e: Error) => void
    const Foo = defineAsyncComponent(
      () =>
        new Promise((_resolve, _reject) => {
          reject = _reject
        }),
    )

    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () =>
        h(Suspense, null, {
          default: () => h('div', [h(Foo), ' & ', h(Foo)]),
          fallback: () => 'loading',
        }),
    })

    const handler = (app.config.errorHandler = vi.fn())
    app.mount(root)
    expect(serializeInner(root)).toBe('loading')

    reject!(new Error('no'))
    await timeout()
    expect(handler).toHaveBeenCalled()
    expect(serializeInner(root)).toBe('<div><!----> & <!----></div>')
  })

  // 测试场景：重试（成功）。
  test('retry (success)', async () => {
    let loaderCallCount = 0
    let resolve: (comp: Component) => void
    let reject: (e: Error) => void

    const Foo = defineAsyncComponent({
      loader: () => {
        loaderCallCount++
        return new Promise((_resolve, _reject) => {
          resolve = _resolve as any
          reject = _reject
        })
      },
      onError(error, retry, fail) {
        if (error.message.match(/foo/)) {
          retry()
        } else {
          fail()
        }
      },
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => h(Foo),
    })

    const handler = (app.config.errorHandler = vi.fn())
    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')
    expect(loaderCallCount).toBe(1)

    const err = new Error('foo')
    reject!(err)
    await timeout()
    expect(handler).not.toHaveBeenCalled()
    expect(loaderCallCount).toBe(2)
    expect(serializeInner(root)).toBe('<!---->')

    // should render this time
    resolve!(() => 'resolved')
    await timeout()
    expect(handler).not.toHaveBeenCalled()
    expect(serializeInner(root)).toBe('resolved')
  })

  // 测试场景：重试（跳过）。
  test('retry (skipped)', async () => {
    let loaderCallCount = 0
    let reject: (e: Error) => void

    const Foo = defineAsyncComponent({
      loader: () => {
        loaderCallCount++
        return new Promise((_resolve, _reject) => {
          reject = _reject
        })
      },
      onError(error, retry, fail) {
        if (error.message.match(/bar/)) {
          retry()
        } else {
          fail()
        }
      },
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => h(Foo),
    })

    const handler = (app.config.errorHandler = vi.fn())
    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')
    expect(loaderCallCount).toBe(1)

    const err = new Error('foo')
    reject!(err)
    await timeout()
    // should fail because retryWhen returns false
    expect(handler).toHaveBeenCalled()
    expect(handler.mock.calls[0][0]).toBe(err)
    expect(loaderCallCount).toBe(1)
    expect(serializeInner(root)).toBe('<!---->')
  })

  // 测试场景：重试（最大重试次数失败）。
  test('retry (fail w/ max retry attempts)', async () => {
    let loaderCallCount = 0
    let reject: (e: Error) => void

    const Foo = defineAsyncComponent({
      loader: () => {
        loaderCallCount++
        return new Promise((_resolve, _reject) => {
          reject = _reject
        })
      },
      onError(error, retry, fail, attempts) {
        if (error.message.match(/foo/) && attempts <= 1) {
          retry()
        } else {
          fail()
        }
      },
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => h(Foo),
    })

    const handler = (app.config.errorHandler = vi.fn())
    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')
    expect(loaderCallCount).toBe(1)

    // first retry
    const err = new Error('foo')
    reject!(err)
    await timeout()
    expect(handler).not.toHaveBeenCalled()
    expect(loaderCallCount).toBe(2)
    expect(serializeInner(root)).toBe('<!---->')

    // 2nd retry, should fail due to reaching maxRetries
    reject!(err)
    await timeout()
    expect(handler).toHaveBeenCalled()
    expect(handler.mock.calls[0][0]).toBe(err)
    expect(loaderCallCount).toBe(2)
    expect(serializeInner(root)).toBe('<!---->')
  })

  // 测试场景：模板ref转发。
  test('template ref forwarding', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent(
      () =>
        new Promise(r => {
          resolve = r as any
        }),
    )

    const fooRef = ref<any>(null)
    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    createApp({
      render: () => (toggle.value ? h(Foo, { ref: fooRef }) : null),
    }).mount(root)

    expect(serializeInner(root)).toBe('<!---->')
    expect(fooRef.value).toBe(null)

    resolve!({
      data() {
        return {
          id: 'foo',
        }
      },
      render: () => 'resolved',
    })
    // first time resolve, wait for macro task since there are multiple
    // microtasks / .then() calls
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
    expect(fooRef.value.id).toBe('foo')

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')
    expect(fooRef.value).toBe(null)

    // already resolved component should update on nextTick
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('resolved')
    expect(fooRef.value.id).toBe('foo')
  })

  // #3188
  // 测试场景：进行多重修补时转发的模板ref应该始终存在。
  test('the forwarded template ref should always exist when doing multi patching', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent(
      () =>
        new Promise(r => {
          resolve = r as any
        }),
    )

    const fooRef = ref<any>(null)
    const toggle = ref(true)
    const updater = ref(0)

    const root = nodeOps.createElement('div')
    createApp({
      render: () =>
        toggle.value ? [h(Foo, { ref: fooRef }), updater.value] : null,
    }).mount(root)

    expect(serializeInner(root)).toBe('<!---->0')
    expect(fooRef.value).toBe(null)

    resolve!({
      data() {
        return {
          id: 'foo',
        }
      },
      render: () => 'resolved',
    })

    await timeout()
    expect(serializeInner(root)).toBe('resolved0')
    expect(fooRef.value.id).toBe('foo')

    updater.value++
    await nextTick()
    expect(serializeInner(root)).toBe('resolved1')
    expect(fooRef.value.id).toBe('foo')

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')
    expect(fooRef.value).toBe(null)
  })

  // 测试场景：vnode 挂接在异步包装器上。
  test('vnode hooks on async wrapper', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent(
      () =>
        new Promise(r => {
          resolve = r as any
        }),
    )
    const updater = ref(0)

    const vnodeHooks = {
      onVnodeBeforeMount: vi.fn(),
      onVnodeMounted: vi.fn(),
      onVnodeBeforeUpdate: vi.fn(),
      onVnodeUpdated: vi.fn(),
      onVnodeBeforeUnmount: vi.fn(),
      onVnodeUnmounted: vi.fn(),
    }

    const toggle = ref(true)

    const root = nodeOps.createElement('div')
    createApp({
      render: () => (toggle.value ? [h(Foo, vnodeHooks), updater.value] : null),
    }).mount(root)

    expect(serializeInner(root)).toBe('<!---->0')

    resolve!({
      data() {
        return {
          id: 'foo',
        }
      },
      render: () => 'resolved',
    })

    await timeout()
    expect(serializeInner(root)).toBe('resolved0')
    expect(vnodeHooks.onVnodeBeforeMount).toHaveBeenCalledTimes(1)
    expect(vnodeHooks.onVnodeMounted).toHaveBeenCalledTimes(1)

    updater.value++
    await nextTick()
    expect(serializeInner(root)).toBe('resolved1')
    expect(vnodeHooks.onVnodeBeforeUpdate).toHaveBeenCalledTimes(1)
    expect(vnodeHooks.onVnodeUpdated).toHaveBeenCalledTimes(1)

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')
    expect(vnodeHooks.onVnodeBeforeUnmount).toHaveBeenCalledTimes(1)
    expect(vnodeHooks.onVnodeUnmounted).toHaveBeenCalledTimes(1)
  })

  // 测试场景：异步组件解析后可被 KeepAlive 缓存并正确激活、停用。
  test('with KeepAlive', async () => {
    const spy = vi.fn()
    let resolve: (comp: Component) => void

    const Foo = defineAsyncComponent(
      () =>
        new Promise(r => {
          resolve = r as any
        }),
    )

    const Bar = defineAsyncComponent(() => Promise.resolve(() => 'Bar'))

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => h(KeepAlive, [toggle.value ? h(Foo) : h(Bar)]),
    })

    app.mount(root)
    await nextTick()

    resolve!({
      setup() {
        onActivated(() => {
          spy()
        })
        return () => 'Foo'
      },
    })

    await timeout()
    expect(serializeInner(root)).toBe('Foo')
    expect(spy).toBeCalledTimes(1)

    toggle.value = false
    await timeout()
    expect(serializeInner(root)).toBe('Bar')
  })

  // 11916
  // 测试场景：异步组件与 KeepAlive include 筛选组合时按解析后的组件名缓存。
  test('with KeepAlive + include', async () => {
    const spy = vi.fn()
    let resolve: (comp: Component) => void

    const Foo = defineAsyncComponent(
      () =>
        new Promise(r => {
          resolve = r as any
        }),
    )

    const root = nodeOps.createElement('div')
    const app = createApp({
      render: () => h(KeepAlive, { include: 'Foo' }, [h(Foo)]),
    })

    app.mount(root)
    await nextTick()

    resolve!({
      name: 'Foo',
      setup() {
        onActivated(spy)
        return () => 'Foo'
      },
    })

    await timeout()
    expect(serializeInner(root)).toBe('Foo')
    expect(spy).toBeCalledTimes(1)
  })
})
