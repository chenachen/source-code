/**
 * 对同一应用工厂分别执行客户端挂载与 renderToString，比较两端的完整 ID 输出。
 * 通过不同 Promise 延迟控制异步完成顺序，检查异步边界命名空间和应用前缀。
 */
/**
 * @vitest-environment jsdom
 */
import {
  type App,
  Suspense,
  createApp,
  defineAsyncComponent,
  defineComponent,
  h,
  onServerPrefetch,
  useId,
} from 'vue'
import { renderToString } from '@vue/server-renderer'

/** 测试工厂返回的应用实例，以及需要等待完成的异步依赖列表。 */
type FactoryRes = [App, Promise<any>[]]

/** 构造一轮客户端/服务端对照测试所需应用的工厂签名。 */
type TestCaseFactory = () => FactoryRes | Promise<FactoryRes>

/** 在浏览器端挂载测试应用，等待异步依赖后返回最终 HTML。 */
async function runOnClient(factory: TestCaseFactory) {
  const [app, deps] = await factory()
  const root = document.createElement('div')
  app.mount(root)
  await Promise.all(deps)
  await promiseWithDelay(null, 0)
  return root.innerHTML
}

/** 在服务端渲染测试应用，并移除不影响 ID 对比的 Fragment 边界注释。 */
async function runOnServer(factory: TestCaseFactory) {
  const [app, _] = await factory()
  return (await renderToString(app))
    .replace(/<!--[\[\]]-->/g, '') // 移除 Fragment 边界注释。
    .trim()
}

/**
 * 分别执行客户端挂载与 SSR，先确认两端输出一致，再把结果交给具体用例断言。
 */
async function getOutput(factory: TestCaseFactory) {
  const clientResult = await runOnClient(factory)
  const serverResult = await runOnServer(factory)
  expect(serverResult).toBe(clientResult)
  return clientResult
}

/** 创建指定延迟后兑现的 Promise，用于控制异步组件的完成顺序。 */
function promiseWithDelay(res: any, delay: number) {
  return new Promise<any>(r => {
    setTimeout(() => r(res), delay)
  })
}

/** 最小 useId 夹具组件：setup 中连续申请两个 ID，便于观察递增规则。 */
const BasicComponentWithUseId = defineComponent({
  /** 连续申请两个 ID 并返回文本 render，供客户端/服务端比较递增规则。 */
  setup() {
    const id1 = useId()
    const id2 = useId()
    return () => [id1, ' ', id2]
  },
})

// useId 在 CSR、SSR、异步分支和前缀配置下生成稳定且不冲突的 ID。
describe('useId', () => {
  // 组件 setup 连续申请两个 ID，两端输出都从 v-0 开始递增。
  test('basic', async () => {
    expect(
      await getOutput(() => {
        const app = createApp(BasicComponentWithUseId)
        return [app, []]
      }),
    ).toBe('v-0 v-1')
  })

  // config.idPrefix 覆盖默认 v 前缀，两端保留相同序号。
  test('with config.idPrefix', async () => {
    expect(
      await getOutput(() => {
        const app = createApp(BasicComponentWithUseId)
        app.config.idPrefix = 'foo'
        return [app, []]
      }),
    ).toBe('foo-0 foo-1')
  })

  // 两个异步组件交换完成先后顺序，仍按各自边界生成相同 ID。
  test('async component', async () => {
    /** 按 delay1/delay2 构造两个异步组件，返回新 App 和待等待的两个加载 Promise。 */
    const factory = (
      delay1: number,
      delay2: number,
    ): ReturnType<TestCaseFactory> => {
      const p1 = promiseWithDelay(BasicComponentWithUseId, delay1)
      const p2 = promiseWithDelay(BasicComponentWithUseId, delay2)
      const AsyncOne = defineAsyncComponent(() => p1)
      const AsyncTwo = defineAsyncComponent(() => p2)
      const app = createApp({
        /** 申请两个根 ID 后渲染两个异步组件，固定树顺序以对比不同完成顺序。 */
        setup() {
          const id1 = useId()
          const id2 = useId()
          return () => [id1, ' ', id2, ' ', h(AsyncOne), ' ', h(AsyncTwo)]
        },
      })
      return [app, [p1, p2]]
    }

    const expected =
      'v-0 v-1 ' + // 根组件
      'v-0-0 v-0-1 ' + // 第一个异步子树内。
      'v-1-0 v-1-1' // 第二个异步子树内。
    // 交换异步完成顺序，输出 ID 应一致。
    expect(await getOutput(() => factory(0, 16))).toBe(expected)
    expect(await getOutput(() => factory(16, 0))).toBe(expected)
  })

  // 两个 serverPrefetch 组件交换 Promise 完成顺序，后代 ID 在两端保持相同。
  test('serverPrefetch', async () => {
    /** 构造两个独立 serverPrefetch 延迟分支，返回新 App 与等待依赖。 */
    const factory = (
      delay1: number,
      delay2: number,
    ): ReturnType<TestCaseFactory> => {
      const p1 = promiseWithDelay(null, delay1)
      const p2 = promiseWithDelay(null, delay2)

      const SPOne = defineComponent({
        /** 服务端预取等待 p1，构造第一个异步边界。 */
        async serverPrefetch() {
          await p1
        },
        /** 渲染申请两个 ID 的基础组件，位于第一个预取边界内。 */
        render() {
          return h(BasicComponentWithUseId)
        },
      })

      const SPTwo = defineComponent({
        /** 服务端预取等待 p2，构造第二个异步边界。 */
        async serverPrefetch() {
          await p2
        },
        /** 渲染基础 ID 组件，位于第二个预取边界内。 */
        render() {
          return h(BasicComponentWithUseId)
        },
      })

      const app = createApp({
        /** 申请根 ID 后渲染两个预取组件，固定两条子树顺序。 */
        setup() {
          const id1 = useId()
          const id2 = useId()
          return () => [id1, ' ', id2, ' ', h(SPOne), ' ', h(SPTwo)]
        },
      })
      return [app, [p1, p2]]
    }

    const expected =
      'v-0 v-1 ' + // 根组件
      'v-0-0 v-0-1 ' + // 第一个预取子树内。
      'v-1-0 v-1-1' // 第二个预取子树内。
    // 交换预取完成顺序，输出 ID 应一致。
    expect(await getOutput(() => factory(0, 16))).toBe(expected)
    expect(await getOutput(() => factory(16, 0))).toBe(expected)
  })

  // 组合式 onServerPrefetch 也建立异步命名空间，没有该钩子的兄弟继续使用父计数。
  test('components with serverPrefetch', async () => {
    /** 构造有 onServerPrefetch 与无钩子的兄弟，返回新 App，供边界命名空间比较。 */
    const factory = (): ReturnType<TestCaseFactory> => {
      const SPOne = defineComponent({
        /** 登记空 onServerPrefetch 后渲染基础 ID 组件，构造有钩子的边界。 */
        setup() {
          onServerPrefetch(() => {})
          return () => h(BasicComponentWithUseId)
        },
      })

      const SPTwo = defineComponent({
        /** 直接渲染基础 ID 组件，构造没有预取钩子的同步兄弟。 */
        render() {
          return h(BasicComponentWithUseId)
        },
      })

      const app = createApp({
        /** 申请两个根 ID 后渲染有/无预取钩子的兄弟，供路径与共享计数比较。 */
        setup() {
          const id1 = useId()
          const id2 = useId()
          return () => [id1, ' ', id2, ' ', h(SPOne), ' ', h(SPTwo)]
        },
      })
      return [app, []]
    }

    const expected =
      'v-0 v-1 ' + // 根组件
      'v-0-0 v-0-1 ' + // 带预取钩子的子树内。
      'v-2 v-3' // 无预取钩子的同步子树内。
    // 两次创建独立应用，检查相同树形的 ID 输出稳定。
    expect(await getOutput(() => factory())).toBe(expected)
    expect(await getOutput(() => factory())).toBe(expected)
  })

  // 两个 async setup 组件交换完成先后顺序，Suspense 分支内 ID 仍稳定。
  test('async setup()', async () => {
    /** 按两种延迟构造 async setup 组件，置于 Suspense 下并返回等待依赖。 */
    const factory = (
      delay1: number,
      delay2: number,
    ): ReturnType<TestCaseFactory> => {
      const p1 = promiseWithDelay(null, delay1)
      const p2 = promiseWithDelay(null, delay2)

      const ASOne = defineComponent({
        /** 等待 p1 后返回空 setupState，构造第一个 async setup 边界。 */
        async setup() {
          await p1
          return {}
        },
        /** 在第一条 async setup 子树渲染基础 ID 组件。 */
        render() {
          return h(BasicComponentWithUseId)
        },
      })

      const ASTwo = defineComponent({
        /** 等待 p2 后返回空 setupState，构造第二个 async setup 边界。 */
        async setup() {
          await p2
          return {}
        },
        /** 在第二条 async setup 子树渲染基础 ID 组件。 */
        render() {
          return h(BasicComponentWithUseId)
        },
      })

      const app = createApp({
        /** 申请根 ID 后返回包住两条异步子树的 Suspense，固定输出树顺序。 */
        setup() {
          const id1 = useId()
          const id2 = useId()
          return () =>
            h(Suspense, null, {
              default: h('div', [id1, ' ', id2, ' ', h(ASOne), ' ', h(ASTwo)]),
            })
        },
      })
      return [app, [p1, p2]]
    }

    const expected =
      '<div>' +
      'v-0 v-1 ' + // 根组件
      'v-0-0 v-0-1 ' + // 第一个 async setup 子树内。
      'v-1-0 v-1-1' + // 第二个 async setup 子树内。
      '</div>'
    // 交换 async setup 完成顺序，输出 ID 应一致。
    expect(await getOutput(() => factory(0, 16))).toBe(expected)
    expect(await getOutput(() => factory(16, 0))).toBe(expected)
  })

  // 嵌套 async setup 边界逐层扩展 ID 路径，同层组件按边界或共享计数生成序号。
  test('deep nested', async () => {
    /** 构造 One/Two/Three 的嵌套 async setup 树，返回 App 与共享 Promise，供逐层路径比较。 */
    const factory = (): ReturnType<TestCaseFactory> => {
      const p = Promise.resolve()
      const One = {
        /** 先申请 One 的 ID 再等待 p，返回 Two 与 Three 两个后代分支。 */
        async setup() {
          const id = useId()
          await p
          return () => [id, ' ', h(Two), ' ', h(Three)]
        },
      }
      const Two = {
        /** 先申请 Two 的 ID 再等待 p，返回两个 Three，构造嵌套边界及同层计数。 */
        async setup() {
          const id = useId()
          await p
          return () => [id, ' ', h(Three), ' ', h(Three)]
        },
      }
      const Three = {
        /** async setup 中申请 ID 后返回文本 render，即使没有 await 也构成异步 setup 组件。 */
        async setup() {
          const id = useId()
          return () => id
        },
      }
      const app = createApp({
        /** 把 One 放入 Suspense 默认分支，构造整棵异步树的根入口。 */
        setup() {
          return () =>
            h(Suspense, null, {
              default: h(One),
            })
        },
      })
      return [app, [p]]
    }

    const expected =
      'v-0 ' + // 组件 One
      'v-0-0 ' + // 组件 Two
      'v-0-0-0 v-0-0-1 ' + // Two 中的两个 Three。
      'v-0-1' // Two 之后的 Three。
    // 两次独立创建同形嵌套树，检查 ID 路径稳定。
    expect(await getOutput(() => factory())).toBe(expected)
    expect(await getOutput(() => factory())).toBe(expected)
  })

  // async setup 内的异步组件即使已预加载，仍保留自己的异步边界 ID 路径。
  test('async component inside async setup, already resolved', async () => {
    /** 构造 async setup 包异步组件的树，预先调用 loader 后返回新 App 与等待依赖。 */
    const factory = async (
      delay1: number,
      delay2: number,
    ): Promise<FactoryRes> => {
      const p1 = promiseWithDelay(null, delay1)
      const p2 = promiseWithDelay(BasicComponentWithUseId, delay2)
      const AsyncInner = defineAsyncComponent(() => p2)

      const AsyncSetup = defineComponent({
        /** 等待外层 p1 后返回空 setupState，构造外层异步边界。 */
        async setup() {
          await p1
          return {}
        },
        /** 渲染已触发加载的 AsyncInner，构造异步组件的嵌套路径。 */
        render() {
          return h(AsyncInner)
        },
      })

      const app = createApp({
        /** 申请两个根 ID 并把 AsyncSetup 放入 Suspense，供预加载后的完整输出比较。 */
        setup() {
          const id1 = useId()
          const id2 = useId()
          return () =>
            h(Suspense, null, {
              default: h('div', [id1, ' ', id2, ' ', h(AsyncSetup)]),
            })
        },
      })

      // 提前调用 loader，模拟内层异步组件已经完成加载。
      await AsyncInner.__asyncLoader()
      return [app, [p1, p2]]
    }

    const expected =
      '<div>' +
      'v-0 v-1 ' + // 根组件
      'v-0-0-0 v-0-0-1' + // async setup 内的异步组件。
      '</div>'
    // 交换外层/内层完成顺序，预加载后 ID 路径仍一致。
    expect(await getOutput(async () => factory(0, 16))).toBe(expected)
    expect(await getOutput(() => factory(16, 0))).toBe(expected)
  })
})
