/**
 * 用例手动 resolve/reject loader Promise，并用 timeout helper 控制 loading 延迟、超时与重试顺序。
 * 宿主树由 runtime-test 渲染；切换包装器或组合 Suspense/KeepAlive 后检查最终内容与 ref、钩子。
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
  /** 测试场景：挂载尚未 resolve 的 loader，只显示注释；手动完成后显示 resolved，切走再切回在 nextTick 直接复用已解析组件，验证共享解析缓存。 */
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
      /** 渲染toggle.value决定Foo节点或null。 */
      render: () => (toggle.value ? h(Foo) : null),
    }).mount(root)

    expect(serializeInner(root)).toBe('<!---->')

    resolve!(() => 'resolved')
    // 首次解析需等待宏任务，让连续的
    // 微任务与 .then() 链完成。
    await timeout()
    expect(serializeInner(root)).toBe('resolved')

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // 已解析组件重新挂载，在 nextTick 后更新完成。
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('resolved')
  })

  /** 测试场景：loader 未完成且 delay=1 时先保持注释，等待后显示 loading；resolve 改为真实内容，再次挂载直接用缓存而不重走 loading。 */
  test('with loading component', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      /** 返回等待中的加载Promise，并把resolve保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () =>
        new Promise(r => {
          resolve = r as any
        }),
      /** 加载占位函数组件，输出loading文本供delay及pending断言辨认。 */
      loadingComponent: () => 'loading',
      delay: 1, // defaults to 200
    })

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    createApp({
      /** 渲染toggle.value决定Foo节点或null。 */
      render: () => (toggle.value ? h(Foo) : null),
    }).mount(root)

    // delay 尚未到期，首次挂载只显示空注释。
    expect(serializeInner(root)).toBe('<!---->')

    // delay 到期后显示 loading 内容。
    await timeout(1)
    expect(serializeInner(root)).toBe('loading')

    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // 已解析组件重新挂载，在 nextTick 后更新完成。 without loading
    // 状态。
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('resolved')
  })

  /** 测试场景：delay=0 的未完成 loader 首次即显示 loading；完成后显示真实内容，切走再挂载直接使用共享已解析组件。 */
  test('with loading component + explicit delay (0)', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      /** 返回等待中的加载Promise，并把resolve保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () =>
        new Promise(r => {
          resolve = r as any
        }),
      /** 加载占位函数组件，输出loading文本供delay及pending断言辨认。 */
      loadingComponent: () => 'loading',
      delay: 0,
    })

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    createApp({
      /** 渲染toggle.value决定Foo节点或null。 */
      render: () => (toggle.value ? h(Foo) : null),
    }).mount(root)

    // delay=0 时立即显示 loading。
    expect(serializeInner(root)).toBe('loading')

    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // 已解析组件重新挂载，在 nextTick 后更新完成。 without loading
    // 状态。
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('resolved')
  })

  /** 测试场景：没有 errorComponent 的 loader 拒绝后，把原 Error 交给 app.errorHandler 并保留注释；重新挂载发起新请求，成功后恢复内容。 */
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
      /** 渲染toggle.value决定Foo节点或null。 */
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

    // 上次加载失败后关闭并重新打开，本次模拟加载成功。
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // 本次成功解析后显示组件内容。
    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  /** 测试场景：配置 errorComponent 与全局 handler，loader 拒绝后 handler 收到原错误，界面显示其 message；重新挂载并完成新请求后恢复真实组件。 */
  test('error with error component', async () => {
    let resolve: (comp: Component) => void
    let reject: (e: Error) => void
    const Foo = defineAsyncComponent({
      /** 返回等待中的加载Promise，并把resolve与reject保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () =>
        new Promise((_resolve, _reject) => {
          resolve = _resolve as any
          reject = _reject
        }),
      /** 错误函数组件，读取wrapper传入的error.message作为输出，供加载拒绝断言辨认。 */
      errorComponent: (props: {
        /** 错误组件接收的加载失败Error，用其message输出断言文本。 */
        error: Error
      }) => props.error.message,
    })

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const app = createApp({
      /** 渲染toggle.value决定Foo节点或null。 */
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

    // 上次加载失败后关闭并重新打开，本次模拟加载成功。
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // 本次成功解析后显示组件内容。
    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  // #2129
  /** 测试场景：有 errorComponent 但没有全局 handler 时拒绝 loader，开发环境警告且显示错误文本；重新挂载仍能加载成功，验证降级渲染不被开发重抛中断。 */
  test('error with error component, without global handler', async () => {
    let resolve: (comp: Component) => void
    let reject: (e: Error) => void
    const Foo = defineAsyncComponent({
      /** 返回等待中的加载Promise，并把resolve与reject保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () =>
        new Promise((_resolve, _reject) => {
          resolve = _resolve as any
          reject = _reject
        }),
      /** 错误函数组件，读取wrapper传入的error.message作为输出，供加载拒绝断言辨认。 */
      errorComponent: (props: {
        /** 错误组件接收的加载失败Error，用其message输出断言文本。 */
        error: Error
      }) => props.error.message,
    })

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const app = createApp({
      /** 渲染toggle.value决定Foo节点或null。 */
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

    // 上次加载失败后关闭并重新打开，本次模拟加载成功。
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // 本次成功解析后显示组件内容。
    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  /** 测试场景：同时配置 loading/error 组件，先经过 delay 显示 loading，拒绝后切错误文本并通知 handler；重新挂载重复等待过程后成功恢复。 */
  test('error with error + loading components', async () => {
    let resolve: (comp: Component) => void
    let reject: (e: Error) => void
    const Foo = defineAsyncComponent({
      /** 返回等待中的加载Promise，并把resolve与reject保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () =>
        new Promise((_resolve, _reject) => {
          resolve = _resolve as any
          reject = _reject
        }),
      /** 错误函数组件，读取wrapper传入的error.message作为输出，供加载拒绝断言辨认。 */
      errorComponent: (props: {
        /** 错误组件接收的加载失败Error，用其message输出断言文本。 */
        error: Error
      }) => props.error.message,
      /** 加载占位函数组件，输出loading文本供delay及pending断言辨认。 */
      loadingComponent: () => 'loading',
      delay: 1,
    })

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const app = createApp({
      /** 渲染toggle.value决定Foo节点或null。 */
      render: () => (toggle.value ? h(Foo) : null),
    })

    const handler = (app.config.errorHandler = vi.fn())

    app.mount(root)

    // delay 尚未到期，首次挂载只显示空注释。
    expect(serializeInner(root)).toBe('<!---->')

    // delay 到期后显示 loading 内容。
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

    // 上次加载失败后关闭并重新打开，本次模拟加载成功。
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // delay 到期后显示 loading 内容。
    await timeout(1)
    expect(serializeInner(root)).toBe('loading')

    // 本次成功解析后显示组件内容。
    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  /** 测试场景：loader 超过 1ms 且无 errorComponent，handler 收到超时错误、界面保持注释；随后请求成功仍显示 resolved，超时没有取消共享加载 Promise。 */
  test('timeout without error component', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      /** 返回等待中的加载Promise，并把resolve保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () =>
        new Promise(_resolve => {
          resolve = _resolve as any
        }),
      timeout: 1,
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      /** 渲染Foo节点。 */
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

    // timeout 后加载仍可成功，内容随后替换错误占位。
    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  /** 测试场景：loader 超过 1ms 后显示 timed out 并通知 handler；晚到的成功结果替换错误组件，验证超时状态不会永久锁住 loaded。 */
  test('timeout with error component', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      /** 返回等待中的加载Promise，并把resolve保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () =>
        new Promise(_resolve => {
          resolve = _resolve as any
        }),
      timeout: 1,
      /** 超时错误函数组件，固定输出timed out供timeout断言辨认。 */
      errorComponent: () => 'timed out',
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      /** 渲染Foo节点。 */
      render: () => h(Foo),
    })

    const handler = (app.config.errorHandler = vi.fn())

    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')

    await timeout(1)
    expect(handler).toHaveBeenCalled()
    expect(serializeInner(root)).toBe('timed out')

    // timeout 后加载仍可成功，内容随后替换错误占位。
    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  /** 测试场景：delay=1、timeout=16 的 loader 依次显示注释、loading、timed out；超时通知 handler，后续成功仍显示真实内容。 */
  test('timeout with error + loading components', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      /** 返回等待中的加载Promise，并把resolve保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () =>
        new Promise(_resolve => {
          resolve = _resolve as any
        }),
      delay: 1,
      timeout: 16,
      /** 超时错误函数组件，固定输出timed out供timeout断言辨认。 */
      errorComponent: () => 'timed out',
      /** 加载占位函数组件，输出loading文本供delay及pending断言辨认。 */
      loadingComponent: () => 'loading',
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      /** 渲染Foo节点。 */
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

  /** 测试场景：有 loading 但无 errorComponent，delay 后显示 loading，16ms 超时仅通知 handler，继续保留 loading；晚到成功最终替换它。 */
  test('timeout without error component, but with loading component', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      /** 返回等待中的加载Promise，并把resolve保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () =>
        new Promise(_resolve => {
          resolve = _resolve as any
        }),
      delay: 1,
      timeout: 16,
      /** 加载占位函数组件，输出loading文本供delay及pending断言辨认。 */
      loadingComponent: () => 'loading',
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      /** 渲染Foo节点。 */
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
    // 组件尚未解析，继续显示 loading。
    expect(serializeInner(root)).toBe('loading')

    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
  })

  /** 测试场景：挂载永不完成且 timeout=50 的包装器，超时前移除并等待；handler 未调用，核对卸载清理定时器和回调闸门。 */
  test('should not call errorHandler after unmount (timeout)', async () => {
    const Foo = defineAsyncComponent({
      /** 返回永不settle的加载Promise，制造超时路径；不提供任何手动resolver。 */
      loader: () => new Promise(() => {}),
      timeout: 50,
    })

    const show = ref(true)
    const root = nodeOps.createElement('div')
    const handler = vi.fn()
    const app = createApp({
      /** 渲染show.value决定Foo节点或null。 */
      render: () => (show.value ? h(Foo) : null),
    })
    app.config.errorHandler = handler
    app.mount(root)

    show.value = false
    await nextTick()

    await timeout(60)
    expect(handler).not.toHaveBeenCalled()
  })

  /** 测试场景：挂载立即拒绝的 loader 后同步隐藏包装器并等待调度，handler 未调用，验证卸载后的 loader 错误被忽略。 */
  test('should not call errorHandler after unmount (loader error)', async () => {
    const Foo = defineAsyncComponent({
      /** 返回拒绝Error(load failed)的Promise，驱动默认错误处理和throwUnhandledErrorInProduction场景。 */
      loader: () => Promise.reject(new Error('load failed')),
    })

    const show = ref(true)
    const root = nodeOps.createElement('div')
    const handler = vi.fn()
    const app = createApp({
      /** 渲染show.value决定Foo节点或null。 */
      render: () => (show.value ? h(Foo) : null),
    })
    app.config.errorHandler = handler
    app.mount(root)

    show.value = false
    await nextTick()

    await timeout()
    expect(handler).not.toHaveBeenCalled()
  })

  /** 测试场景：首次挂载后卸载，再拒绝该请求；错误不报告。重新挂载应第二次调用 loader，完成后显示 resolved，验证忽略错误仍清共享 pendingRequest。 */
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
      /** 渲染show.value决定Foo节点或null。 */
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

  /** 测试场景：Suspense 默认树含两个同包装器实例，未完成时显示 fallback；一次 loader resolve 后两处同时显示真实内容，边界等待共享请求对应的实例依赖。 */
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
      /** 渲染Suspense节点（null；插槽{default回调，fallback回调}）。 */
      render: () =>
        h(Suspense, null, {
          /** 提供default插槽：'div'节点（根数组[Foo节点、' & '、Foo节点]）。 */
          default: () => h('div', [h(Foo), ' & ', h(Foo)]),
          /** 提供fallback插槽：'loading'。 */
          fallback: () => 'loading',
        }),
    })

    app.mount(root)
    expect(serializeInner(root)).toBe('loading')

    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('<div>resolved & resolved</div>')
  })

  /** 测试场景：suspensible=false 的两个包装器不阻塞 Suspense，首次直接显示带两处注释的默认树；loader 成功后两处都更新为 resolved。 */
  test('suspensible: false', async () => {
    let resolve: (comp: Component) => void
    const Foo = defineAsyncComponent({
      /** 返回等待中的加载Promise，并把resolve保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () =>
        new Promise(_resolve => {
          resolve = _resolve as any
        }),
      suspensible: false,
    })

    const root = nodeOps.createElement('div')
    const app = createApp({
      /** 渲染Suspense节点（null；插槽{default回调，fallback回调}）。 */
      render: () =>
        h(Suspense, null, {
          /** 提供default插槽：'div'节点（根数组[Foo节点、' & '、Foo节点]）。 */
          default: () => h('div', [h(Foo), ' & ', h(Foo)]),
          /** 提供fallback插槽：'loading'。 */
          fallback: () => 'loading',
        }),
    })

    app.mount(root)
    // suspensible=false，未让该 wrapper 触发 Suspense fallback。
    expect(serializeInner(root)).toBe('<div><!----> & <!----></div>')

    resolve!(() => 'resolved')
    await timeout()
    expect(serializeInner(root)).toBe('<div>resolved & resolved</div>')
  })

  /** 测试场景：Suspense 默认树的共享 loader 拒绝时，先显示 fallback，错误通知 app handler；边界随后结算为含两处注释的默认树，不一直停留在 fallback。 */
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
      /** 渲染Suspense节点（null；插槽{default回调，fallback回调}）。 */
      render: () =>
        h(Suspense, null, {
          /** 提供default插槽：'div'节点（根数组[Foo节点、' & '、Foo节点]）。 */
          default: () => h('div', [h(Foo), ' & ', h(Foo)]),
          /** 提供fallback插槽：'loading'。 */
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

  /** 测试场景：onError 对 foo 错误调用 retry；首次失败不通知全局 handler，loader 次数增至二，第二次 resolve 显示内容，验证用户重试 Promise 跟随新请求。 */
  test('retry (success)', async () => {
    let loaderCallCount = 0
    let resolve: (comp: Component) => void
    let reject: (e: Error) => void

    const Foo = defineAsyncComponent({
      /** 每次调用递增加载计数；返回等待中的加载Promise，并把resolve与reject保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () => {
        loaderCallCount++
        return new Promise((_resolve, _reject) => {
          resolve = _resolve as any
          reject = _reject
        })
      },
      /** 错误message匹配foo时retry，其余fail，验证用户回调可选择重新加载。 */
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
      /** 渲染Foo节点。 */
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

    // 本次成功解析后显示组件内容。
    resolve!(() => 'resolved')
    await timeout()
    expect(handler).not.toHaveBeenCalled()
    expect(serializeInner(root)).toBe('resolved')
  })

  /** 测试场景：onError 对不匹配重试条件的 foo 错误调用 fail；loader 仅一次，原 Error 进入 handler，界面保持注释。 */
  test('retry (skipped)', async () => {
    let loaderCallCount = 0
    let reject: (e: Error) => void

    const Foo = defineAsyncComponent({
      /** 每次调用递增加载计数；返回等待中的加载Promise，并把reject保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () => {
        loaderCallCount++
        return new Promise((_resolve, _reject) => {
          reject = _reject
        })
      },
      /** 只有错误message匹配bar才retry，其余调用fail，让本例的foo错误直接结束。 */
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
      /** 渲染Foo节点。 */
      render: () => h(Foo),
    })

    const handler = (app.config.errorHandler = vi.fn())
    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')
    expect(loaderCallCount).toBe(1)

    const err = new Error('foo')
    reject!(err)
    await timeout()
    // 错误不满足 onError 的重试条件，调用 fail 结束本轮加载。
    expect(handler).toHaveBeenCalled()
    expect(handler.mock.calls[0][0]).toBe(err)
    expect(loaderCallCount).toBe(1)
    expect(serializeInner(root)).toBe('<!---->')
  })

  /** 测试场景：onError 只允许 attempts<=1 重试；首次失败发起第二请求而不报告，第二次失败停止重试并把原错误交给 handler。 */
  test('retry (fail w/ max retry attempts)', async () => {
    let loaderCallCount = 0
    let reject: (e: Error) => void

    const Foo = defineAsyncComponent({
      /** 每次调用递增加载计数；返回等待中的加载Promise，并把reject保存给用例，允许手动成功/失败以驱动加载状态。 */
      loader: () => {
        loaderCallCount++
        return new Promise((_resolve, _reject) => {
          reject = _reject
        })
      },
      /** 仅当错误message匹配foo且attempts<=1时调用retry，否则fail；重试次数由wrapper传入，不由fixture另行计数。 */
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
      /** 渲染Foo节点。 */
      render: () => h(Foo),
    })

    const handler = (app.config.errorHandler = vi.fn())
    app.mount(root)
    expect(serializeInner(root)).toBe('<!---->')
    expect(loaderCallCount).toBe(1)

    // 首次重试，建立下一次加载请求。
    const err = new Error('foo')
    reject!(err)
    await timeout()
    expect(handler).not.toHaveBeenCalled()
    expect(loaderCallCount).toBe(2)
    expect(serializeInner(root)).toBe('<!---->')

    // 再次失败时 attempts 超出允许次数，调用 fail。
    reject!(err)
    await timeout()
    expect(handler).toHaveBeenCalled()
    expect(handler.mock.calls[0][0]).toBe(err)
    expect(loaderCallCount).toBe(2)
    expect(serializeInner(root)).toBe('<!---->')
  })

  /** 测试场景：异步包装器带模板 ref，未完成时 ref 为 null；解析真实组件后 ref 指向其 id，隐藏清空，重新挂载再次指向内部实例。 */
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
      /** 渲染toggle.value决定Foo节点（属性{ref: fooRef}）或null。 */
      render: () => (toggle.value ? h(Foo, { ref: fooRef }) : null),
    }).mount(root)

    expect(serializeInner(root)).toBe('<!---->')
    expect(fooRef.value).toBe(null)

    resolve!({
      /** 初始化组件状态为{id: 'foo'}，供本例渲染和事件更新读取。 */
      data() {
        return {
          id: 'foo',
        }
      },
      /** 渲染'resolved'。 */
      render: () => 'resolved',
    })
    // 首次解析需等待宏任务，让连续的
    // 微任务与 .then() 链完成。
    await timeout()
    expect(serializeInner(root)).toBe('resolved')
    expect(fooRef.value.id).toBe('foo')

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')
    expect(fooRef.value).toBe(null)

    // 已解析组件重新挂载，在 nextTick 后更新完成。
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('resolved')
    expect(fooRef.value.id).toBe('foo')
  })

  // #3188
  /** 测试场景：异步真实组件解析后已有 ref，再更新同 Fragment 的 updater；内容更新但 ref 仍存在，最后隐藏才清空，验证多次 patch 不误清转发 ref。 */
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
      /** 渲染toggle.value决定根数组[Foo节点（属性{ref: fooRef}）、updater.value]或null。 */
      render: () =>
        toggle.value ? [h(Foo, { ref: fooRef }), updater.value] : null,
    }).mount(root)

    expect(serializeInner(root)).toBe('<!---->0')
    expect(fooRef.value).toBe(null)

    resolve!({
      /** 初始化组件状态为{id: 'foo'}，供本例渲染和事件更新读取。 */
      data() {
        return {
          id: 'foo',
        }
      },
      /** 渲染'resolved'。 */
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

  /** 测试场景：包装器配置六种 VNode 钩子；加载完成、父更新、隐藏分别只调用对应 before/after 一次，验证钩子归真实组件且不被包装层重复执行。 */
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
      /** 渲染toggle.value决定根数组[Foo节点（vnodeHooks）、updater.value]或null。 */
      render: () => (toggle.value ? [h(Foo, vnodeHooks), updater.value] : null),
    }).mount(root)

    expect(serializeInner(root)).toBe('<!---->0')

    resolve!({
      /** 初始化组件状态为{id: 'foo'}，供本例渲染和事件更新读取。 */
      data() {
        return {
          id: 'foo',
        }
      },
      /** 渲染'resolved'。 */
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

  /** 测试场景：KeepAlive 中切换两个异步包装器，Foo 解析后 activated 仅一次，切到已解析 Bar 显示 Bar；核对解析后的保活钩子与内容。 */
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
      /** 渲染KeepAlive节点（根数组[toggle.value决定Foo节点或Bar节点]）。 */
      render: () => h(KeepAlive, [toggle.value ? h(Foo) : h(Bar)]),
    })

    app.mount(root)
    await nextTick()

    resolve!({
      /** 注册onActivated。setup返回渲染函数：'Foo'。 */
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
  /** 测试场景：KeepAlive include=Foo 时先加载包装器，再解析为名为 Foo 的组件；其内容和 activated 一次断言证明父更新按真实名称重新匹配缓存。 */
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
      /** 渲染KeepAlive节点（属性{include: 'Foo'}；根数组[Foo节点]）。 */
      render: () => h(KeepAlive, { include: 'Foo' }, [h(Foo)]),
    })

    app.mount(root)
    await nextTick()

    resolve!({
      name: 'Foo',
      /** 注册onActivated。setup返回渲染函数：'Foo'。 */
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
