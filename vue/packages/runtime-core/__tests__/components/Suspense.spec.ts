/**
 * 本地 defineAsyncComponent 返回 async setup Promise，并把等待任务记入 deps；它不是公共异步加载器。
 * beforeEach 清空 deps、重置 suspenseId。用例先检查 fallback/旧分支，再等待依赖与 nextTick 检查提交。
 */
/**
 * @vitest-environment jsdom
 */

import {
  type ComponentOptions,
  Fragment,
  KeepAlive,
  Suspense,
  type SuspenseProps,
  Teleport,
  createBlock,
  createCommentVNode,
  createElementBlock,
  getCurrentInstance,
  h,
  nextTick,
  nodeOps,
  onErrorCaptured,
  onMounted,
  onUnmounted,
  onUpdated,
  openBlock,
  ref,
  render,
  renderList,
  renderSlot,
  resolveDynamicComponent,
  serializeInner,
  shallowRef,
  watch,
  watchEffect,
  withAsyncContext,
  withDirectives,
} from '@vue/runtime-test'
import {
  computed,
  createApp,
  defineAsyncComponent as defineAsyncComp,
  defineComponent,
  effectScope,
  inject,
  provide,
} from 'vue'
import type { RawSlots } from '../../src/componentSlots'
import { resetSuspenseId } from '../../src/components/Suspense'
import { PatchFlags } from '@vue/shared'

// 测试组：Suspense 对异步依赖、fallback、分支切换、水合和嵌套边界的协调。
describe('Suspense', () => {
  const deps: Promise<any>[] = []

  beforeEach(() => {
    deps.length = 0
    resetSuspenseId()
  })

  // 测试专用 async setup 工厂。
  /** 测试专用工厂：delay毫秒后让async setup Promise返回渲染给定comp的函数，透传props/slots；把多一微任务的等待项放deps，便于逐层驱动依赖完成。不同于公共异步加载器。 */
  function defineAsyncComponent<T extends ComponentOptions>(
    comp: T,
    delay: number = 0,
  ) {
    return {
      /** 执行deps.push(p.then(() => Promise.resolve()))。setup返回p。 */
      setup(props: any, { slots }: any) {
        const p = new Promise(resolve => {
          setTimeout(() => {
            resolve(() => h(comp, props, slots))
          }, delay)
        })
        // Node 12 的定时器/nextTick 顺序发生变化，
        // 额外等待一轮微任务，让 setup 恢复后再断言。
        deps.push(p.then(() => Promise.resolve()))
        return p
      },
    }
  }

  const RouterView = {
    /** 从注入route中按当前depth选组件，再provide下一层depth；每次渲染将当前Component交给默认插槽并取其首个VNode，模拟嵌套RouterView。 */
    setup(_: any, { slots }: any) {
      const route = inject('route') as any
      const depth = inject('depth', 0)
      provide('depth', depth + 1)
      return () => {
        const current = route.value[depth]
        return slots.default({ Component: current })[0]
      }
    },
  }

  /** 测试场景：本地异步 setup 工厂未完成时显示 fallback div；等待记录的 deps 与 nextTick 后改为 async div，验证首次依赖等待和内容提交。 */
  test('fallback content', async () => {
    const Async = defineAsyncComponent({
      /** 渲染'div'节点（'async'）。 */
      render() {
        return h('div', 'async')
      },
    })

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h(Async)，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h(Async),
            fallback: h('div', 'fallback'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>async</div>`)
  })

  /** 测试场景：timeout=0，首次异步挂载 pending/fallback 各一次，完成后 resolve 一次；切空根同步 pending+resolve 而不 fallback，再回异步根产生新一轮三种事件，核对次数边界。 */
  test('emits events', async () => {
    const Async = defineAsyncComponent({
      /** 渲染'div'节点（'async'）。 */
      render() {
        return h('div', 'async')
      },
    })

    const onFallback = vi.fn()
    const onResolve = vi.fn()
    const onPending = vi.fn()

    const show = ref(true)
    const Comp = {
      /** setup返回渲染函数：Suspense节点（属性{onFallback，onResolve，onPending，timeout: 0}；插槽{default回调，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(
            Suspense,
            {
              onFallback,
              onResolve,
              onPending,
              // 新一轮 pending 立即进入 fallback。
              timeout: 0,
            },
            {
              /** 提供default插槽：show.value决定Async节点或null。 */
              default: () => (show.value ? h(Async) : null),
              fallback: h('div', 'fallback'),
            },
          )
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(onPending).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledTimes(0)

    await Promise.all(deps)
    await nextTick()
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(onPending).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledTimes(1)

    show.value = false
    await nextTick()
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(onPending).toHaveBeenCalledTimes(2)
    expect(onResolve).toHaveBeenCalledTimes(2)

    deps.length = 0
    show.value = true
    await nextTick()
    expect(onFallback).toHaveBeenCalledTimes(2)
    expect(onPending).toHaveBeenCalledTimes(3)
    expect(onResolve).toHaveBeenCalledTimes(2)

    await Promise.all(deps)
    await nextTick()
    expect(onFallback).toHaveBeenCalledTimes(2)
    expect(onPending).toHaveBeenCalledTimes(3)
    expect(onResolve).toHaveBeenCalledTimes(3)
  })

  /** 测试场景：外异步组件完成后才发现内层更慢依赖；只完成外依赖仍显示 fallback且无 mounted，全部完成后显示 inner，mounted 顺序 outer、inner。 */
  test('nested async deps', async () => {
    const calls: string[] = []

    const AsyncOuter = defineAsyncComponent({
      /** 注册onMounted回调写入calls.push('outer mounted')。setup返回渲染函数：AsyncInner节点。 */
      setup() {
        onMounted(() => {
          calls.push('outer mounted')
        })
        return () => h(AsyncInner)
      },
    })

    const AsyncInner = defineAsyncComponent(
      {
        /** 注册onMounted回调写入calls.push('inner mounted')。setup返回渲染函数：'div'节点（'inner'）。 */
        setup() {
          onMounted(() => {
            calls.push('inner mounted')
          })
          return () => h('div', 'inner')
        },
      },
      10,
    )

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h(AsyncOuter)，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h(AsyncOuter),
            fallback: h('div', 'fallback'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(calls).toEqual([])

    await deps[0]
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(calls).toEqual([])

    await Promise.all(deps)
    await nextTick()
    expect(calls).toEqual([`outer mounted`, `inner mounted`])
    expect(serializeInner(root)).toBe(`<div>inner</div>`)
  })

  /** 测试场景：异步 setup pending 时展示 fallback且 onResolve 未调用；全部依赖完成并更新后展示 async且 onResolve 调用，检查提交事件。 */
  test('onResolve', async () => {
    const Async = defineAsyncComponent({
      /** 渲染'div'节点（'async'）。 */
      render() {
        return h('div', 'async')
      },
    })

    const onResolve = vi.fn()

    const Comp = {
      /** setup返回渲染函数：Suspense节点（属性{onResolve}；插槽{default: h(Async)，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(
            Suspense,
            {
              onResolve,
            },
            {
              default: h(Async),
              fallback: h('div', 'fallback'),
            },
          )
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(onResolve).not.toHaveBeenCalled()

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>async</div>`)
    expect(onResolve).toHaveBeenCalled()
  })

  /** 测试场景：异步 setup 注册 post watchEffect/watch并立即递增 count，同时注册 mounted/unmounted；pending 时记录为空，resolve 后按 effect、watch、mounted 放行，移除后再记 unmounted，此例没有 updated 钩子断言。 */
  test('buffer mounted/updated hooks & post flush watch callbacks', async () => {
    const deps: Promise<any>[] = []
    const calls: string[] = []
    const toggle = ref(true)

    const Async = {
      /** 建立count=ref(0)；执行deps.push(p.then(() => Promise.resolve()))；count.value++；注册watchEffect回调写入calls.push('watch effect')；watch回调写入calls.push('watch callback')；onMounted回调写入calls.push('mounted')；onUnmounted回调写入calls.push('unmounted')。setup返回渲染函数：'div'节点（'async'）。 async返回Promise，等待p后完成。 */
      async setup() {
        const p = new Promise(r => setTimeout(r, 1))
        // 多一轮微任务等待 setup 恢复与边界提交。
        deps.push(p.then(() => Promise.resolve()))

        watchEffect(
          () => {
            calls.push('watch effect')
          },
          { flush: 'post' },
        )

        const count = ref(0)
        watch(
          count,
          () => {
            calls.push('watch callback')
          },
          { flush: 'post' },
        )
        count.value++ // 立即修改 count，触发尚在 pending 分支的 watcher。

        onMounted(() => {
          calls.push('mounted')
        })

        onUnmounted(() => {
          calls.push('unmounted')
        })

        await p
        return () => h('div', 'async')
      },
    }

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: toggle.value ? h(Async) : null，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: toggle.value ? h(Async) : null,
            fallback: h('div', 'fallback'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(calls).toEqual([])

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>async</div>`)
    expect(calls).toEqual([`watch effect`, `watch callback`, `mounted`])

    // 边界已 resolve，后续 unmounted 按正常 post 队列执行。
    toggle.value = false
    await nextTick()
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    expect(calls).toEqual([
      `watch effect`,
      `watch callback`,
      `mounted`,
      'unmounted',
    ])
  })

  // #1059
  /** 测试场景：fallback 是注册 mounted/unmounted 的组件；pending 时 mounted立即执行，resolve 后内容替换 fallback并调用其 unmounted，核对 fallback 无需等待本边界。 */
  test('mounted/updated hooks & fallback component', async () => {
    const deps: Promise<any>[] = []
    const calls: string[] = []
    const toggle = ref(true)

    const Async = {
      /** 执行deps.push(p.then(() => Promise.resolve()))。setup返回渲染函数：'div'节点（'async'）。 async返回Promise，等待p后完成。 */
      async setup() {
        const p = new Promise(r => setTimeout(r, 1))
        // 多一轮微任务等待 setup 恢复与边界提交。
        deps.push(p.then(() => Promise.resolve()))

        await p
        return () => h('div', 'async')
      },
    }

    const Fallback = {
      /** 注册onMounted回调写入calls.push('mounted')；onUnmounted回调写入calls.push('unmounted')。setup返回渲染函数：'div'节点（'fallback'）。 */
      setup() {
        onMounted(() => {
          calls.push('mounted')
        })

        onUnmounted(() => {
          calls.push('unmounted')
        })
        return () => h('div', 'fallback')
      },
    }

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: toggle.value ? h(Async) : null，fallback: h(Fallback)}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: toggle.value ? h(Async) : null,
            fallback: h(Fallback),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(calls).toEqual([`mounted`])

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>async</div>`)
    expect(calls).toEqual([`mounted`, `unmounted`])
  })

  /** 测试场景：pending 异步子 props.msg 从 foo 改 bar；可见 fallback同步改 bar，完成依赖后内容使用 bar，确认隐藏分支接收最新 props。 */
  test('content update before suspense resolve', async () => {
    const Async = defineAsyncComponent({
      props: { msg: String },
      /** setup返回渲染函数：'div'节点（props.msg）。 */
      setup(props: any) {
        return () => h('div', props.msg)
      },
    })

    const msg = ref('foo')

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h(Async, { msg: msg.value })，fallback: h('div', `fallback ${msg.value}`)}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h(Async, { msg: msg.value }),
            fallback: h('div', `fallback ${msg.value}`),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback foo</div>`)

    // 依赖完成前修改输入值。
    msg.value = 'bar'
    await nextTick()
    // 可见 fallback 同步更新。
    expect(serializeInner(root)).toBe(`<div>fallback bar</div>`)

    await Promise.all(deps)
    await nextTick()
    // 异步组件恢复后接收最新 props/slots。
    expect(serializeInner(root)).toBe(`<div>bar</div>`)
  })

  // 实际内容组件尚未创建，相关 mounted/unmounted 不执行。
  /** 测试场景：异步 setup 已注册 post watchers 和生命周期但尚未完成时将 default 切 null；fallback替为注释，Promise 后来完成仍为注释且全部回调记录为空，验证废弃分支副作用清理。 */
  test('unmount before suspense resolve', async () => {
    const deps: Promise<any>[] = []
    const calls: string[] = []
    const toggle = ref(true)

    const Async = {
      /** 建立count=ref(0)；执行deps.push(p)；count.value++；注册watchEffect回调写入calls.push('watch effect')；watch回调写入calls.push('watch callback')；onMounted回调写入calls.push('mounted')；onUnmounted回调写入calls.push('unmounted')。setup返回渲染函数：'div'节点（'async'）。 async返回Promise，等待p后完成。 */
      async setup() {
        const p = new Promise(r => setTimeout(r, 1))
        deps.push(p)

        watchEffect(
          () => {
            calls.push('watch effect')
          },
          { flush: 'post' },
        )

        const count = ref(0)
        watch(
          count,
          () => {
            calls.push('watch callback')
          },
          { flush: 'post' },
        )
        count.value++ // 立即修改 count，触发尚在 pending 分支的 watcher。

        onMounted(() => {
          calls.push('mounted')
        })

        onUnmounted(() => {
          calls.push('unmounted')
        })

        await p
        return () => h('div', 'async')
      },
    }

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: toggle.value ? h(Async) : null，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: toggle.value ? h(Async) : null,
            fallback: h('div', 'fallback'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(calls).toEqual([])

    // 依赖未完成就移除该异步分支。
    toggle.value = false
    await nextTick()
    // 新空分支无依赖，边界立即提交注释。
    expect(serializeInner(root)).toBe(`<!---->`)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    // 废弃分支缓冲的 effects 不再执行。
    expect(calls).toEqual([])
  })

  /** 测试场景：异步内容 resolve 后整体关闭 Suspense；由 fallback到 async再到注释，内容 unmounted调用，确认已提交活动分支销毁。 */
  test('unmount suspense after resolve', async () => {
    const toggle = ref(true)
    const unmounted = vi.fn()

    const Async = defineAsyncComponent({
      /** 注册onUnmounted。setup返回渲染函数：'div'节点（'async'）。 */
      setup() {
        onUnmounted(unmounted)
        return () => h('div', 'async')
      },
    })

    const Comp = {
      /** setup返回渲染函数：toggle.value决定Suspense节点（null；插槽{default: h(Async)，fallback: h('div', 'fallback')}）或null。 */
      setup() {
        return () =>
          toggle.value
            ? h(Suspense, null, {
                default: h(Async),
                fallback: h('div', 'fallback'),
              })
            : null
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>async</div>`)
    expect(unmounted).not.toHaveBeenCalled()

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    expect(unmounted).toHaveBeenCalled()
  })

  /** 测试场景：首次 pending 时整体关闭 Suspense再完成其依赖；mounted/unmounted spies均不调用，确认内层实际组件尚未创建，迟到恢复不会提交。 */
  test('unmount suspense before resolve', async () => {
    const toggle = ref(true)
    const mounted = vi.fn()
    const unmounted = vi.fn()

    const Async = defineAsyncComponent({
      /** 注册onMounted；onUnmounted。setup返回渲染函数：'div'节点（'async'）。 */
      setup() {
        onMounted(mounted)
        onUnmounted(unmounted)
        return () => h('div', 'async')
      },
    })

    const Comp = {
      /** setup返回渲染函数：toggle.value决定Suspense节点（null；插槽{default: h(Async)，fallback: h('div', 'fallback')}）或null。 */
      setup() {
        return () =>
          toggle.value
            ? h(Suspense, null, {
                default: h(Async),
                fallback: h('div', 'fallback'),
              })
            : null
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    expect(mounted).not.toHaveBeenCalled()
    expect(unmounted).not.toHaveBeenCalled()

    await Promise.all(deps)
    await nextTick()
    // 迟到 Promise 不再提交内容或触发未创建组件的卸载。
    expect(mounted).not.toHaveBeenCalled()
    expect(unmounted).not.toHaveBeenCalled()
  })

  // vuetifyjs/vuetify#15207
  /** 测试场景：Root mounted 将 data由1改2，而异步子 setup仍等待；等待子 mounted Promise后元素 data-test=2，确认未解析子组件更新 attrs 的继承。 */
  test('update prop of async element before suspense resolve', async () => {
    let resolve: () => void
    const mounted = new Promise<void>(r => {
      resolve = r
    })
    const Async = {
      /** 注册onMounted。setup返回渲染函数：'div'节点（'async'）。 async返回Promise，等待p后完成。 */
      async setup() {
        onMounted(() => {
          resolve()
        })
        const p = new Promise(r => setTimeout(r, 1))
        await p
        return () => h('div', 'async')
      },
    }

    const Comp: ComponentOptions<{
      /** 父组件声明的字符串data prop，由Root在挂载时从1改2，并透传为异步根data-test，验证pending期attrs更新。 */
      data: string
    }> = {
      props: ['data'],
      /** setup返回渲染函数：Async节点（属性{'data-test': props.data}）。 */
      setup(props) {
        return () => h(Async, { 'data-test': props.data })
      },
    }

    const Root = {
      /** 建立data=ref('1')；注册onMounted回调写入data.value='2'。setup返回渲染函数：Suspense节点（null；插槽{default: h(Comp, { data: data.value })，fallback: h('div', 'fallback')}）。 */
      setup() {
        const data = ref('1')
        onMounted(() => {
          data.value = '2'
        })
        return () =>
          h(Suspense, null, {
            default: h(Comp, { data: data.value }),
            fallback: h('div', 'fallback'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Root), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    await mounted
    expect(serializeInner(root)).toBe(`<div data-test="2">async</div>`)
  })

  /** 测试场景：独立嵌套边界中外依赖1ms、内依赖10ms；父先展示 outer+inner fallback且仅 outer mounted，子完成后替为 inner内容并执行 inner mounted。 */
  test('nested suspense (parent resolves first)', async () => {
    const calls: string[] = []

    const AsyncOuter = defineAsyncComponent(
      {
        /** 注册onMounted回调写入calls.push('outer mounted')。setup返回渲染函数：'div'节点（'async outer'）。 */
        setup: () => {
          onMounted(() => {
            calls.push('outer mounted')
          })
          return () => h('div', 'async outer')
        },
      },
      1,
    )

    const AsyncInner = defineAsyncComponent(
      {
        /** 注册onMounted回调写入calls.push('inner mounted')。setup返回渲染函数：'div'节点（'async inner'）。 */
        setup: () => {
          onMounted(() => {
            calls.push('inner mounted')
          })
          return () => h('div', 'async inner')
        },
      },
      10,
    )

    const Inner = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h(AsyncInner)，fallback: h('div', 'fallback inner')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h(AsyncInner),
            fallback: h('div', 'fallback inner'),
          })
      },
    }

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h('div', [h(AsyncOuter), h(Inner)])，fallback: h('div', 'fallback outer')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h('div', [h(AsyncOuter), h(Inner)]),
            fallback: h('div', 'fallback outer'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback outer</div>`)

    await deps[0]
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>async outer</div><div>fallback inner</div></div>`,
    )
    expect(calls).toEqual([`outer mounted`])

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>async outer</div><div>async inner</div></div>`,
    )
    expect(calls).toEqual([`outer mounted`, `inner mounted`])
  })

  /** 测试场景：独立嵌套边界中内依赖先完成、外依赖后完成；外仍 fallback且 mounted记录为空，父完成后两层内容一起可见，缓冲 mounted按 inner、outer顺序放行。 */
  test('nested suspense (child resolves first)', async () => {
    const calls: string[] = []

    const AsyncOuter = defineAsyncComponent(
      {
        /** 注册onMounted回调写入calls.push('outer mounted')。setup返回渲染函数：'div'节点（'async outer'）。 */
        setup: () => {
          onMounted(() => {
            calls.push('outer mounted')
          })
          return () => h('div', 'async outer')
        },
      },
      10,
    )

    const AsyncInner = defineAsyncComponent(
      {
        /** 注册onMounted回调写入calls.push('inner mounted')。setup返回渲染函数：'div'节点（'async inner'）。 */
        setup: () => {
          onMounted(() => {
            calls.push('inner mounted')
          })
          return () => h('div', 'async inner')
        },
      },
      1,
    )

    const Inner = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h(AsyncInner)，fallback: h('div', 'fallback inner')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h(AsyncInner),
            fallback: h('div', 'fallback inner'),
          })
      },
    }

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h('div', [h(AsyncOuter), h(Inner)])，fallback: h('div', 'fallback outer')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h('div', [h(AsyncOuter), h(Inner)]),
            fallback: h('div', 'fallback outer'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback outer</div>`)

    await deps[1]
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>fallback outer</div>`)
    expect(calls).toEqual([])

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>async outer</div><div>async inner</div></div>`,
    )
    expect(calls).toEqual([`inner mounted`, `outer mounted`])
  })

  /** 测试场景：异步 setup拒绝 Error(oops)，祖先 errorCaptured写错误状态并return false；首次fallback后刷新改为oops div，验证错误可转为祖先渲染状态。 */
  test('error handling', async () => {
    const Async = {
      /** async setup直接抛Error(oops)，返回拒绝的Promise；供祖先errorCaptured把错误转换为替代渲染。 */
      async setup() {
        throw new Error('oops')
      },
    }

    const Comp = {
      /** 建立errorMessage=ref<string | null>(null)；注册onErrorCaptured回调写入errorMessage.value=err instanceof Error ? err.message : `A non-Error value thrown: ${err}`。setup返回渲染函数：errorMessage.value决定'div'节点（errorMessage.value）或Suspense节点（null；插槽{default: h(Async)，fallback: h('div', 'fallback')}）。 */
      setup() {
        const errorMessage = ref<string | null>(null)
        onErrorCaptured(err => {
          errorMessage.value =
            err instanceof Error
              ? err.message
              : `A non-Error value thrown: ${err}`
          return false
        })

        return () =>
          errorMessage.value
            ? h('div', errorMessage.value)
            : h(Suspense, null, {
                default: h(Async),
                fallback: h('div', 'fallback'),
              })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>oops</div>`)
  })

  // #3857
  /** 测试场景：编译优化模板用 v-if错误状态/v-else Suspense，内层异步setup拒绝oops；捕获错误后fallback切oops div，核对优化block的卸载切换。 */
  test('error handling w/ template optimization', async () => {
    const Async = {
      /** 优化模板中的异步子setup抛Error(oops)，让祖先捕获后触发v-if/v-else分支替换。 */
      async setup() {
        throw new Error('oops')
      },
    }

    const Comp = {
      template: `
      <div v-if="errorMessage">{{ errorMessage }}</div>
      <Suspense v-else>
        <div>
          <Async />
        </div>
        <template #fallback>
          <div>fallback</div>
        </template>
      </Suspense>
      `,
      components: { Async },
      /** 建立errorMessage=ref<string | null>(null)；注册onErrorCaptured回调写入errorMessage.value=err instanceof Error ? err.message : `A non-Error value thrown: ${err}`。setup返回{errorMessage}。 */
      setup() {
        const errorMessage = ref<string | null>(null)
        onErrorCaptured(err => {
          errorMessage.value =
            err instanceof Error
              ? err.message
              : `A non-Error value thrown: ${err}`
          return false
        })
        return { errorMessage }
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>oops</div>`)
  })

  /** 测试场景：父边界同时等待嵌套异步链和独立子边界；只完成首层依赖仍fallback，父链齐全后展示nested fallback+root async并放行0/1/3，子完成后追加2并使用等待期更新的msg。 */
  it('combined usage (nested async + nested suspense + multiple deps)', async () => {
    const msg = ref('nested msg')
    const calls: number[] = []

    const AsyncChildWithSuspense = defineAsyncComponent({
      props: { msg: String },
      /** 注册onMounted回调写入calls.push(0)。setup返回渲染函数：Suspense节点（null；插槽{default: h(AsyncInsideNestedSuspense, { msg: props.msg })，fallback: h('div', 'nested fallback')}）。 */
      setup(props: any) {
        onMounted(() => {
          calls.push(0)
        })
        return () =>
          h(Suspense, null, {
            default: h(AsyncInsideNestedSuspense, { msg: props.msg }),
            fallback: h('div', 'nested fallback'),
          })
      },
    })

    const AsyncInsideNestedSuspense = defineAsyncComponent(
      {
        props: { msg: String },
        /** 注册onMounted回调写入calls.push(2)。setup返回渲染函数：'div'节点（props.msg）。 */
        setup(props: any) {
          onMounted(() => {
            calls.push(2)
          })
          return () => h('div', props.msg)
        },
      },
      20,
    )

    const AsyncChildParent = defineAsyncComponent({
      props: { msg: String },
      /** 注册onMounted回调写入calls.push(1)。setup返回渲染函数：NestedAsyncChild节点（属性{msg: props.msg}）。 */
      setup(props: any) {
        onMounted(() => {
          calls.push(1)
        })
        return () => h(NestedAsyncChild, { msg: props.msg })
      },
    })

    const NestedAsyncChild = defineAsyncComponent(
      {
        props: { msg: String },
        /** 注册mounted时向calls写入3；返回读取props.msg的div渲染函数，记录根异步组件完成后的挂载时序。 */
        setup(props: any) {
          onMounted(() => {
            calls.push(3)
          })
          return () => h('div', props.msg)
        },
      },
      10,
    )

    const MiddleComponent = {
      /** setup返回渲染函数：AsyncChildWithSuspense节点（属性{msg: msg.value}）。 */
      setup() {
        return () =>
          h(AsyncChildWithSuspense, {
            msg: msg.value,
          })
      },
    }

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h('div', [ h(MiddleComponent), h(AsyncChildParent, { msg: 'root async', }), ])，fallback: h('div', 'root fallback')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h('div', [
              h(MiddleComponent),
              h(AsyncChildParent, {
                msg: 'root async',
              }),
            ]),
            fallback: h('div', 'root fallback'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>root fallback</div>`)
    expect(calls).toEqual([])

    /**
     * <Root>
     *   <Suspense>
     *     <MiddleComponent>
     *       <AsyncChildWithSuspense> (0: 宏任务完成)
     *         <Suspense>
     *           <AsyncInsideNestedSuspense> (2: 宏任务完成 后20ms)
     *     <AsyncChildParent> (1: 宏任务完成)
     *       <NestedAsyncChild> (3: 宏任务完成 后10ms)
     */

    // 首层两个依赖已完成，但普通异步链还有嵌套依赖，
    // 父边界继续显示 fallback。
    await Promise.all([deps[0], deps[1]])
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>root fallback</div>`)
    expect(calls).toEqual([])

    // 父边界自己的依赖齐全，现在提交父内容；
    // 独立嵌套边界仍展示其 fallback。
    await deps[3]
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>nested fallback</div><div>root async</div></div>`,
    )
    expect(calls).toEqual([0, 1, 3])

    // 嵌套组件未完成时修改其输入。
    msg.value = 'nested changed'

    // 内层依赖完成，子边界提交默认内容。
    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>nested changed</div><div>root async</div></div>`,
    )
    expect(calls).toEqual([0, 1, 3, 2])

    // resolve 后继续检查响应式更新。
    msg.value = 'nested changed again'
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>nested changed again</div><div>root async</div></div>`,
    )
  })

  /** 测试场景：Foo含更慢FooNested，先等二者全部完成；切Bar等待时保留Foo，再完成后替Bar并按钩子顺序卸载Foo；切回Foo也等两层依赖，旧Bar保持直到新链就绪。 */
  test('switching branches', async () => {
    const calls: string[] = []
    const toggle = ref(true)

    const Foo = defineAsyncComponent({
      /** 注册onMounted回调写入calls.push('foo mounted')；onUnmounted回调写入calls.push('foo unmounted')。setup返回渲染函数：'div'节点（根数组['foo'、FooNested节点]）。 */
      setup() {
        onMounted(() => {
          calls.push('foo mounted')
        })
        onUnmounted(() => {
          calls.push('foo unmounted')
        })
        return () => h('div', ['foo', h(FooNested)])
      },
    })

    const FooNested = defineAsyncComponent(
      {
        /** 注册onMounted回调写入calls.push('foo nested mounted')；onUnmounted回调写入calls.push('foo nested unmounted')。setup返回渲染函数：'div'节点（'foo nested'）。 */
        setup() {
          onMounted(() => {
            calls.push('foo nested mounted')
          })
          onUnmounted(() => {
            calls.push('foo nested unmounted')
          })
          return () => h('div', 'foo nested')
        },
      },
      10,
    )

    const Bar = defineAsyncComponent(
      {
        /** 注册onMounted回调写入calls.push('bar mounted')；onUnmounted回调写入calls.push('bar unmounted')。setup返回渲染函数：'div'节点（'bar'）。 */
        setup() {
          onMounted(() => {
            calls.push('bar mounted')
          })
          onUnmounted(() => {
            calls.push('bar unmounted')
          })
          return () => h('div', 'bar')
        },
      },
      10,
    )

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: toggle.value ? h(Foo) : h(Bar)，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: toggle.value ? h(Foo) : h(Bar),
            fallback: h('div', 'fallback'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(calls).toEqual([])

    await deps[0]
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(calls).toEqual([])

    await Promise.all(deps)
    await nextTick()
    expect(calls).toEqual([`foo mounted`, `foo nested mounted`])
    expect(serializeInner(root)).toBe(`<div>foo<div>foo nested</div></div>`)

    // 切换分支。
    toggle.value = false
    await nextTick()
    expect(deps.length).toBe(3)
    // 新分支仍 pending，保留当前可见内容。
    expect(calls).toEqual([`foo mounted`, `foo nested mounted`])
    expect(serializeInner(root)).toBe(`<div>foo<div>foo nested</div></div>`)

    await Promise.all(deps)
    await nextTick()
    const tempCalls = [
      `foo mounted`,
      `foo nested mounted`,
      `bar mounted`,
      `foo nested unmounted`,
      `foo unmounted`,
    ]
    expect(calls).toEqual(tempCalls)
    expect(serializeInner(root)).toBe(`<div>bar</div>`)

    // 切换分支。 back
    toggle.value = true
    await nextTick()
    // 仍保留原活动内容。
    expect(calls).toEqual(tempCalls)
    expect(serializeInner(root)).toBe(`<div>bar</div>`)

    await deps[3]
    await nextTick()
    // 嵌套依赖尚未齐全，继续保留旧内容。
    expect(calls).toEqual(tempCalls)
    expect(serializeInner(root)).toBe(`<div>bar</div>`)

    await Promise.all(deps)
    await nextTick()
    expect(calls).toEqual([
      ...tempCalls,
      `foo mounted`,
      `foo nested mounted`,
      `bar unmounted`,
    ])
    expect(serializeInner(root)).toBe(`<div>foo<div>foo nested</div></div>`)
  })

  // #10098
  /** 测试场景：模拟两层RouterView嵌套Suspense，先解析到innerA；切B尚未完成便切回A，等待全部任务后仍innerA，确认过期分支不会覆盖恢复的路由内容。 */
  test('switching branches w/ nested suspense', async () => {
    const OuterB = defineAsyncComponent({
      /** setup返回渲染函数：RouterView节点（null；插槽{default回调}）。 */
      setup: () => {
        return () =>
          h(RouterView, null, {
            /** 提供default插槽：根数组[Suspense节点（null；插槽{default回调}）]。 */
            default: ({ Component }: any) => [
              h(Suspense, null, {
                /** 提供default插槽：Component节点。 */
                default: () => h(Component),
              }),
            ],
          })
      },
    })

    const InnerB = defineAsyncComponent({
      /** setup返回渲染函数：'div'节点（'innerB'）。 */
      setup: () => {
        return () => h('div', 'innerB')
      },
    })

    const OuterA = defineAsyncComponent({
      /** setup返回渲染函数：RouterView节点（null；插槽{default回调}）。 */
      setup: () => {
        return () =>
          h(RouterView, null, {
            /** 提供default插槽：根数组[Suspense节点（null；插槽{default回调}）]。 */
            default: ({ Component }: any) => [
              h(Suspense, null, {
                /** 提供default插槽：Component节点。 */
                default: () => h(Component),
              }),
            ],
          })
      },
    })

    const InnerA = defineAsyncComponent({
      /** setup返回渲染函数：'div'节点（'innerA'）。 */
      setup: () => {
        return () => h('div', 'innerA')
      },
    })

    const toggle = ref(true)
    const route = computed(() => {
      return toggle.value ? [OuterA, InnerA] : [OuterB, InnerB]
    })

    const Comp = {
      /** 执行provide('route', route)。setup返回渲染函数：RouterView节点（null；插槽{default回调}）。 */
      setup() {
        provide('route', route)
        return () =>
          h(RouterView, null, {
            /** 提供default插槽：根数组[Suspense节点（null；插槽{default回调}）]。 */
            default: ({ Component }: any) => [
              h(Suspense, null, {
                /** 提供default插槽：Component节点。 */
                default: () => h(Component),
              }),
            ],
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>innerA</div>`)

    deps.length = 0

    toggle.value = false
    await nextTick()
    // 切换分支。 again
    toggle.value = true

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>innerA</div>`)
  })

  // #10415
  /** 测试场景：RouterView子边界启用suspensible，切OuterB后其异步回调连续将InnerB换InnerB1/InnerB2；父等待期间各周期更新依赖，最终只展示innerB2，避免过期子resolve提前结算父。 */
  test('nested suspense (w/ suspensible) switch several times before parent suspense resolve', async () => {
    const OuterA = defineAsyncComponent({
      /** setup返回渲染函数：RouterView节点（null；插槽{default回调}）。 */
      setup: () => {
        return () =>
          h(RouterView, null, {
            /** 提供default插槽：根数组[Suspense节点（null；插槽{default回调}）]。 */
            default: ({ Component }: any) => [
              h(Suspense, null, {
                /** 提供default插槽：Component节点。 */
                default: () => h(Component),
              }),
            ],
          })
      },
    })

    const InnerA = defineAsyncComponent({
      /** setup返回渲染函数：'div'节点（'innerA'）。 */
      setup: () => {
        return () => h('div', 'innerA')
      },
    })

    const route = shallowRef([OuterA, InnerA])
    const InnerB = defineAsyncComponent(
      {
        /** setup返回渲染函数：'div'节点（'innerB'）。 */
        setup: () => {
          return () => h('div', 'innerB')
        },
      },
      5,
    )

    const InnerB1 = defineAsyncComponent(
      {
        /** setup返回渲染函数：'div'节点（'innerB1'）。 */
        setup: () => {
          return () => h('div', 'innerB1')
        },
      },
      5,
    )

    const InnerB2 = defineAsyncComponent(
      {
        /** setup返回渲染函数：'div'节点（'innerB2'）。 */
        setup: () => {
          return () => h('div', 'innerB2')
        },
      },
      5,
    )

    const OuterB = defineAsyncComponent(
      {
        /** 安排nextTick回调route.value=[OuterB, InnerB1]；nextTick回调route.value=[OuterB, InnerB2]。setup返回渲染函数：RouterView节点（null；插槽{default回调}）。 */
        setup() {
          nextTick(async () => {
            await new Promise(resolve => setTimeout(resolve, 1))
            route.value = [OuterB, InnerB1]
          })

          nextTick(async () => {
            await new Promise(resolve => setTimeout(resolve, 1))
            route.value = [OuterB, InnerB2]
          })

          return () =>
            h(RouterView, null, {
              /** 提供default插槽：根数组[Suspense节点（属性{suspensible: true}；插槽{default回调}）]。 */
              default: ({ Component }: any) => [
                h(
                  Suspense,
                  { suspensible: true },
                  {
                    /** 提供default插槽：Component节点。 */
                    default: () => h(Component),
                  },
                ),
              ],
            })
        },
      },
      5,
    )

    const Comp = {
      /** 执行provide('route', route)。setup返回渲染函数：RouterView节点（null；插槽{default回调}）。 */
      setup() {
        provide('route', route)
        return () =>
          h(RouterView, null, {
            /** 提供default插槽：根数组[Suspense节点（null；插槽{default回调}）]。 */
            default: ({ Component }: any) => [
              h(Suspense, null, {
                /** 提供default插槽：Component节点。 */
                default: () => h(Component),
              }),
            ],
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>innerA</div>`)

    deps.length = 0

    route.value = [OuterB, InnerB]
    await nextTick()

    await Promise.all(deps)
    await Promise.all(deps)
    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>innerB2</div>`)
  })

  /** 测试场景：One已展示，Two pending期间改Three；Two完成后仍One且无Two mounted，Three完成后展示Three并卸载One，验证pending代次丢弃。 */
  test('branch switch to 3rd branch before resolve', async () => {
    const calls: string[] = []

    /** 接收name和delay，创建定时完成async setup并输出name div的fixture。mounted/unmounted把对应名字写calls，记录旧内容保留与最终替换。 */
    const makeComp = (name: string, delay = 0) =>
      defineAsyncComponent(
        {
          /** 注册onMounted回调写入calls.push(`${name} mounted`)；onUnmounted回调写入calls.push(`${name} unmounted`)。setup返回渲染函数：'div'节点（根数组[name]）。 */
          setup() {
            onMounted(() => {
              calls.push(`${name} mounted`)
            })
            onUnmounted(() => {
              calls.push(`${name} unmounted`)
            })
            return () => h('div', [name])
          },
        },
        delay,
      )

    const One = makeComp('one')
    const Two = makeComp('two', 10)
    const Three = makeComp('three', 20)

    const view = shallowRef(One)

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h(view.value)，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h(view.value),
            fallback: h('div', 'fallback'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(calls).toEqual([])

    await deps[0]
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>one</div>`)
    expect(calls).toEqual([`one mounted`])

    view.value = Two
    await nextTick()
    expect(deps.length).toBe(2)

    // Two 未完成时切换到 Three。
    view.value = Three
    await nextTick()
    expect(deps.length).toBe(3)

    // 等待被废弃的 Two 依赖完成。
    await deps[1]
    await nextTick()
    // Two 的迟到恢复不会覆盖当前 One。
    expect(serializeInner(root)).toBe(`<div>one</div>`)
    expect(calls).toEqual([`one mounted`])

    await deps[2]
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>three</div>`)
    expect(calls).toEqual([`one mounted`, `three mounted`, `one unmounted`])
  })

  /** 测试场景：One已展示，Two pending期间切回One；依赖数不增加，Two迟到完成后仍One且仅one mounted记录，验证恢复活动分支。 */
  test('branch switch back before resolve', async () => {
    const calls: string[] = []

    /** 接收name和delay，创建定时完成async setup并输出name div的fixture。mounted/unmounted把对应名字写calls，记录旧内容保留与最终替换。 */
    const makeComp = (name: string, delay = 0) =>
      defineAsyncComponent(
        {
          /** 注册onMounted回调写入calls.push(`${name} mounted`)；onUnmounted回调写入calls.push(`${name} unmounted`)。setup返回渲染函数：'div'节点（根数组[name]）。 */
          setup() {
            onMounted(() => {
              calls.push(`${name} mounted`)
            })
            onUnmounted(() => {
              calls.push(`${name} unmounted`)
            })
            return () => h('div', [name])
          },
        },
        delay,
      )

    const One = makeComp('one')
    const Two = makeComp('two', 10)

    const view = shallowRef(One)

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h(view.value)，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h(view.value),
            fallback: h('div', 'fallback'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(calls).toEqual([])

    await deps[0]
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>one</div>`)
    expect(calls).toEqual([`one mounted`])

    view.value = Two
    await nextTick()
    expect(deps.length).toBe(2)

    // Two 未完成时切回活动 One。
    view.value = One
    await nextTick()
    expect(deps.length).toBe(2)

    // 等待被废弃的 Two 依赖完成。
    await deps[1]
    await nextTick()
    // Two 的迟到恢复不会覆盖当前 One。
    expect(serializeInner(root)).toBe(`<div>one</div>`)
    expect(calls).toEqual([`one mounted`])
  })

  /** 测试场景：One已展示后切20ms的Two，边界timeout10ms；先保留One，超时后展示fallback并卸载One，Two完成才展示Two并mounted。 */
  test('branch switch timeout + fallback', async () => {
    const calls: string[] = []

    /** 接收name和delay，创建定时完成async setup并输出name div的fixture。mounted/unmounted把对应名字写calls，记录旧内容保留与最终替换。 */
    const makeComp = (name: string, delay = 0) =>
      defineAsyncComponent(
        {
          /** 注册onMounted回调写入calls.push(`${name} mounted`)；onUnmounted回调写入calls.push(`${name} unmounted`)。setup返回渲染函数：'div'节点（根数组[name]）。 */
          setup() {
            onMounted(() => {
              calls.push(`${name} mounted`)
            })
            onUnmounted(() => {
              calls.push(`${name} unmounted`)
            })
            return () => h('div', [name])
          },
        },
        delay,
      )

    const One = makeComp('one')
    const Two = makeComp('two', 20)

    const view = shallowRef(One)

    const Comp = {
      /** setup返回渲染函数：Suspense节点（属性{timeout: 10}；插槽{default: h(view.value)，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(
            Suspense,
            {
              timeout: 10,
            },
            {
              default: h(view.value),
              fallback: h('div', 'fallback'),
            },
          )
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(calls).toEqual([])

    await deps[0]
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>one</div>`)
    expect(calls).toEqual([`one mounted`])

    view.value = Two
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>one</div>`)
    expect(calls).toEqual([`one mounted`])

    await new Promise(r => setTimeout(r, 10))
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(calls).toEqual([`one mounted`, `one unmounted`])

    await deps[1]
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    expect(calls).toEqual([`one mounted`, `one unmounted`, `two mounted`])
  })

  /** 测试场景：Suspense后有three兄弟，One→Two时timeout10ms；旧内容、fallback、新内容始终位于three前，验证超时替换保存插入锚点。 */
  test('mount the fallback content is in the correct position', async () => {
    /** 接收name和delay，创建定时完成async setup并输出name div的fixture。返回组件定义，供与three兄弟比较边界插入位置。 */
    const makeComp = (name: string, delay = 0) =>
      defineAsyncComponent(
        {
          /** setup返回渲染函数：'div'节点（根数组[name]）。 */
          setup() {
            return () => h('div', [name])
          },
        },
        delay,
      )

    const One = makeComp('one')
    const Two = makeComp('two', 20)

    const view = shallowRef(One)

    const Comp = {
      /** setup返回渲染函数：'div'节点（根数组[Suspense节点（属性{timeout: 10}；插槽{default: h(view.value)，fallback: h('div', 'fallback')}）、'div'节点（'three'）]）。 */
      setup() {
        return () =>
          h('div', [
            h(
              Suspense,
              {
                timeout: 10,
              },
              {
                default: h(view.value),
                fallback: h('div', 'fallback'),
              },
            ),
            h('div', 'three'),
          ])
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(
      `<div><div>fallback</div><div>three</div></div>`,
    )

    await deps[0]
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>one</div><div>three</div></div>`,
    )

    view.value = Two
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>one</div><div>three</div></div>`,
    )

    await new Promise(r => setTimeout(r, 10))
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>fallback</div><div>three</div></div>`,
    )

    await deps[1]
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>two</div><div>three</div></div>`,
    )
  })

  // #2214
  // Suspense 自行修补内容根，
  // 内容 patch 不沿用外层 optimized 标志，避免漏掉嵌套动态节点。
  /** 测试场景：编译模板Suspense内嵌div/span，n从1增2；span文本正常更新，验证边界内容不因外层优化标志漏patch。 */
  test('should not miss nested element updates when used in templates', async () => {
    const n = ref(1)
    const Comp = {
      /** setup返回{n}。 */
      setup() {
        return { n }
      },
      template: `
      <Suspense>
        <div><span>{{ n }}</span></div>
      </Suspense>
      `,
    }
    const root = document.createElement('div')
    createApp(Comp).mount(root)
    expect(root.innerHTML).toBe(`<div><span>1</span></div>`)

    n.value++
    await nextTick()
    expect(root.innerHTML).toBe(`<div><span>2</span></div>`)
  })

  // #2215
  /** 测试场景：已resolve的同步Parent div内按toggle新增/移除async setup Child；新增后等待两tick出现child，移除恢复注释，验证已活动子树中新异步组件可单独恢复。 */
  test('toggling nested async setup component inside already resolved suspense', async () => {
    const toggle = ref(false)
    const Child = {
      /** setup返回渲染函数：'div'节点（'child'）。 async返回Promise；即使没有await，返回值也需经Promise完成后使用。 */
      async setup() {
        return () => h('div', 'child')
      },
    }
    /** 在固定div根内输出parent文本，并按toggle添加async Child；用来检查已resolve边界中新出现的异步后代。 */
    const Parent = () => h('div', ['parent', toggle.value ? h(Child) : null])
    const Comp = {
      /** setup返回渲染函数：Suspense节点（渲染函数：Parent节点）。 */
      setup() {
        return () => h(Suspense, () => h(Parent))
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>parent<!----></div>`)

    toggle.value = true
    // 等待组件更新队列刷新。
    await nextTick()
    // 再等待异步子 setup 恢复。
    await nextTick()
    // 异步子已恢复，实际内容应替换注释。
    expect(serializeInner(root)).toBe(`<div>parent<div>child</div></div>`)

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>parent<!----></div>`)
  })

  /** 测试场景：普通Parent直接挂载async setup Child且无Suspense；检查必须嵌套边界的警告，只验证诊断信息。 */
  test('warn if using async setup when not in a Suspense boundary', () => {
    const Child = {
      name: 'Child',
      /** setup返回渲染函数：'div'节点（'child'）。 async返回Promise；即使没有await，返回值也需经Promise完成后使用。 */
      async setup() {
        return () => h('div', 'child')
      },
    }
    const Parent = {
      /** setup返回渲染函数：'div'节点（根数组[Child节点]）。 */
      setup() {
        return () => h('div', [h(Child)])
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Parent), root)

    expect(
      `A component with async setup() must be nested in a <Suspense>`,
    ).toHaveBeenWarned()
  })

  /** 测试场景：异步外组件5ms、内组件10ms且子边界suspensible；外完成后父仍fallback，内完成一起提交；再切外/内分别保持旧可见内容至各次完成，检查mounted放行。 */
  test('nested suspense with suspensible', async () => {
    const calls: string[] = []
    let expected = ''

    const InnerA = defineAsyncComponent(
      {
        /** 执行calls.push('innerA created')；注册onMounted回调写入calls.push('innerA mounted')。setup返回渲染函数：'div'节点（'innerA'）。 */
        setup: () => {
          calls.push('innerA created')
          onMounted(() => {
            calls.push('innerA mounted')
          })
          return () => h('div', 'innerA')
        },
      },
      10,
    )

    const InnerB = defineAsyncComponent(
      {
        /** 执行calls.push('innerB created')；注册onMounted回调写入calls.push('innerB mounted')。setup返回渲染函数：'div'节点（'innerB'）。 */
        setup: () => {
          calls.push('innerB created')
          onMounted(() => {
            calls.push('innerB mounted')
          })
          return () => h('div', 'innerB')
        },
      },
      10,
    )

    const OuterA = defineAsyncComponent(
      {
        /** 执行calls.push('outerA created')；注册onMounted回调写入calls.push('outerA mounted')。setup返回渲染函数：Fragment节点（null；根数组['div'节点（'outerA'）、slots.default?.()]）。 */
        setup: (_, { slots }: any) => {
          calls.push('outerA created')
          onMounted(() => {
            calls.push('outerA mounted')
          })
          return () =>
            h(Fragment, null, [h('div', 'outerA'), slots.default?.()])
        },
      },
      5,
    )

    const OuterB = defineAsyncComponent(
      {
        /** 执行calls.push('outerB created')；注册onMounted回调写入calls.push('outerB mounted')。setup返回渲染函数：Fragment节点（null；根数组['div'节点（'outerB'）、slots.default?.()]）。 */
        setup: (_, { slots }: any) => {
          calls.push('outerB created')
          onMounted(() => {
            calls.push('outerB mounted')
          })
          return () =>
            h(Fragment, null, [h('div', 'outerB'), slots.default?.()])
        },
      },
      5,
    )

    const outerToggle = ref(false)
    const innerToggle = ref(false)

    /**
     *  <Suspense>
     *    <component :is="outerToggle ? outerB : outerA">
     *      <Suspense suspensible>
     *        <component :is="innerToggle ? innerB : innerA" />
     *      </Suspense>
     *    </component>
     *  </Suspense>
     */
    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: [ h(outerToggle.value ? OuterB : OuterA, null, { default: () => h( Suspense, { suspensible: true }, { default: h(innerToggle.value ? InnerB : InnerA), }, ), }), ]，fallback: h('div', 'fallback outer')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: [
              h(outerToggle.value ? OuterB : OuterA, null, {
                /** 提供default插槽：Suspense节点（属性{suspensible: true}；插槽{default: h(innerToggle.value ? InnerB : InnerA)}）。 */
                default: () =>
                  h(
                    Suspense,
                    { suspensible: true },
                    {
                      default: h(innerToggle.value ? InnerB : InnerA),
                    },
                  ),
              }),
            ],
            fallback: h('div', 'fallback outer'),
          })
      },
    }

    expected = `<div>fallback outer</div>`
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(expected)

    // 等待外层组件依赖完成。
    await Promise.all(deps)
    await nextTick()

    expect(serializeInner(root)).toBe(expected)
    expect(calls).toEqual([`outerA created`])

    // 等待内层组件依赖完成。
    await Promise.all(deps)
    await nextTick()
    expected = `<div>outerA</div><div>innerA</div>`
    expect(serializeInner(root)).toBe(expected)

    expect(calls).toEqual([
      'outerA created',
      'innerA created',
      'outerA mounted',
      'innerA mounted',
    ])

    // 切换分支。 outer component
    calls.length = 0
    deps.length = 0
    outerToggle.value = true
    await nextTick()

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(expected) // 等待期间可见内容保持不变。

    await Promise.all(deps)
    await nextTick()
    expected = `<div>outerB</div><div>innerA</div>`
    expect(serializeInner(root)).toBe(expected)
    expect(calls).toContain('outerB mounted')
    expect(calls).toContain('innerA mounted')

    // 切换分支。 inner component
    calls.length = 0
    deps.length = 0
    innerToggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe(expected) // 等待期间可见内容保持不变。

    await Promise.all(deps)
    await nextTick()
    expected = `<div>outerB</div><div>innerB</div>`
    expect(serializeInner(root)).toBe(expected)
    expect(calls).toContain('innerB mounted')
  })

  // #8206
  /** 测试场景：相同suspensible结构但组件全部同步；首次立即显示outerA+innerA、钩子按子后父执行；切外和内均正常更新，确认无异步依赖不滞留pending。 */
  test('nested suspense with suspensible & no async deps', async () => {
    const calls: string[] = []
    let expected = ''

    const InnerA = defineComponent({
      /** 执行calls.push('innerA created')；注册onMounted回调写入calls.push('innerA mounted')。setup返回渲染函数：'div'节点（'innerA'）。 */
      setup: () => {
        calls.push('innerA created')
        onMounted(() => {
          calls.push('innerA mounted')
        })
        return () => h('div', 'innerA')
      },
    })

    const InnerB = defineComponent({
      /** 执行calls.push('innerB created')；注册onMounted回调写入calls.push('innerB mounted')。setup返回渲染函数：'div'节点（'innerB'）。 */
      setup: () => {
        calls.push('innerB created')
        onMounted(() => {
          calls.push('innerB mounted')
        })
        return () => h('div', 'innerB')
      },
    })

    const OuterA = defineComponent({
      /** 执行calls.push('outerA created')；注册onMounted回调写入calls.push('outerA mounted')。setup返回渲染函数：Fragment节点（null；根数组['div'节点（'outerA'）、slots.default?.()]）。 */
      setup: (_, { slots }: any) => {
        calls.push('outerA created')
        onMounted(() => {
          calls.push('outerA mounted')
        })
        return () => h(Fragment, null, [h('div', 'outerA'), slots.default?.()])
      },
    })

    const OuterB = defineComponent({
      /** 执行calls.push('outerB created')；注册onMounted回调写入calls.push('outerB mounted')。setup返回渲染函数：Fragment节点（null；根数组['div'节点（'outerB'）、slots.default?.()]）。 */
      setup: (_, { slots }: any) => {
        calls.push('outerB created')
        onMounted(() => {
          calls.push('outerB mounted')
        })
        return () => h(Fragment, null, [h('div', 'outerB'), slots.default?.()])
      },
    })

    const outerToggle = ref(false)
    const innerToggle = ref(false)

    /**
     *  <Suspense>
     *    <component :is="outerToggle ? outerB : outerA">
     *      <Suspense suspensible>
     *        <component :is="innerToggle ? innerB : innerA" />
     *      </Suspense>
     *    </component>
     *  </Suspense>
     */
    const Comp = defineComponent({
      /** setup返回渲染函数：Suspense节点（null；插槽{default: [ h(outerToggle.value ? OuterB : OuterA, null, { default: () => h( Suspense, { suspensible: true }, { default: h(innerToggle.value ? InnerB : InnerA), }, ), }), ]，fallback: h('div', 'fallback outer')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: [
              h(outerToggle.value ? OuterB : OuterA, null, {
                /** 提供default插槽：Suspense节点（属性{suspensible: true}；插槽{default: h(innerToggle.value ? InnerB : InnerA)}）。 */
                default: () =>
                  h(
                    Suspense,
                    { suspensible: true },
                    {
                      default: h(innerToggle.value ? InnerB : InnerA),
                    },
                  ),
              }),
            ],
            fallback: h('div', 'fallback outer'),
          })
      },
    })

    expected = `<div>outerA</div><div>innerA</div>`
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(expected)

    // 等待外层组件依赖完成。 and inner component
    await Promise.all(deps)
    await nextTick()

    expect(serializeInner(root)).toBe(expected)
    expect(calls).toEqual([
      'outerA created',
      'innerA created',
      'innerA mounted',
      'outerA mounted',
    ])

    // 切换分支。 outer component
    calls.length = 0
    deps.length = 0
    outerToggle.value = true
    await nextTick()

    await Promise.all(deps)
    await nextTick()
    expected = `<div>outerB</div><div>innerA</div>`
    expect(serializeInner(root)).toBe(expected)
    expect(calls).toContain('outerB mounted')
    expect(calls).toContain('innerA mounted')

    // 切换分支。 inner component
    calls.length = 0
    deps.length = 0
    innerToggle.value = true
    await Promise.all(deps)
    await nextTick()
    expected = `<div>outerB</div><div>innerB</div>`
    expect(serializeInner(root)).toBe(expected)
  })

  //#8678
  /** 测试场景：独立子边界不suspensible，父先完成时展示outerA+注释；同时切外/内后先展示outerB+注释，子完成才展示innerB，核对各边界分开提交。 */
  test('nested suspense (child suspense update before parent suspense resolve)', async () => {
    const calls: string[] = []

    const InnerA = defineAsyncComponent(
      {
        /** 执行calls.push('innerA created')；注册onMounted回调写入calls.push('innerA mounted')。setup返回渲染函数：'div'节点（'innerA'）。 */
        setup: () => {
          calls.push('innerA created')
          onMounted(() => {
            calls.push('innerA mounted')
          })
          return () => h('div', 'innerA')
        },
      },
      10,
    )

    const InnerB = defineAsyncComponent(
      {
        /** 执行calls.push('innerB created')；注册onMounted回调写入calls.push('innerB mounted')。setup返回渲染函数：'div'节点（'innerB'）。 */
        setup: () => {
          calls.push('innerB created')
          onMounted(() => {
            calls.push('innerB mounted')
          })
          return () => h('div', 'innerB')
        },
      },
      10,
    )

    const OuterA = defineAsyncComponent(
      {
        /** 执行calls.push('outerA created')；注册onMounted回调写入calls.push('outerA mounted')。setup返回渲染函数：Fragment节点（null；根数组['div'节点（'outerA'）、slots.default?.()]）。 */
        setup: (_, { slots }: any) => {
          calls.push('outerA created')
          onMounted(() => {
            calls.push('outerA mounted')
          })
          return () =>
            h(Fragment, null, [h('div', 'outerA'), slots.default?.()])
        },
      },
      5,
    )

    const OuterB = defineAsyncComponent(
      {
        /** 执行calls.push('outerB created')；注册onMounted回调写入calls.push('outerB mounted')。setup返回渲染函数：Fragment节点（null；根数组['div'节点（'outerB'）、slots.default?.()]）。 */
        setup: (_, { slots }: any) => {
          calls.push('outerB created')
          onMounted(() => {
            calls.push('outerB mounted')
          })
          return () =>
            h(Fragment, null, [h('div', 'outerB'), slots.default?.()])
        },
      },
      5,
    )

    const outerToggle = ref(false)
    const innerToggle = ref(false)

    /**
     *  <Suspense>
     *    <component :is="outerToggle ? outerB : outerA">
     *      <Suspense>
     *        <component :is="innerToggle ? innerB : innerA" />
     *      </Suspense>
     *    </component>
     *  </Suspense>
     */
    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: [ h(outerToggle.value ? OuterB : OuterA, null, { default: () => h(Suspense, null, { default: h(innerToggle.value ? InnerB : InnerA), }), }), ]，fallback: h('div', 'fallback outer')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: [
              h(outerToggle.value ? OuterB : OuterA, null, {
                /** 提供default插槽：Suspense节点（null；插槽{default: h(innerToggle.value ? InnerB : InnerA)}）。 */
                default: () =>
                  h(Suspense, null, {
                    default: h(innerToggle.value ? InnerB : InnerA),
                  }),
              }),
            ],
            fallback: h('div', 'fallback outer'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback outer</div>`)

    // 等待外层组件依赖完成。
    await Promise.all(deps)
    await nextTick()

    expect(serializeInner(root)).toBe(`<div>outerA</div><!---->`)
    expect(calls).toEqual([`outerA created`, `outerA mounted`])

    // 等待内层组件依赖完成。
    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>outerA</div><div>innerA</div>`)

    expect(calls).toEqual([
      'outerA created',
      'outerA mounted',
      'innerA created',
      'innerA mounted',
    ])

    calls.length = 0
    deps.length = 0

    // 切换分支。 both outer and inner components
    outerToggle.value = true
    innerToggle.value = true
    await nextTick()

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>outerB</div><!---->`)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>outerB</div><div>innerB</div>`)

    // innerB mounted 只登记一次。
    expect(calls).toEqual([
      'outerB created',
      'outerB mounted',
      'innerB created',
      'innerB mounted',
    ])
  })

  // #6416
  /** 测试场景：KeepAlive包裹Suspense，异步默认未完成先切同步分支；切回异步时保留sync至resolve，再切sync正常显示，核对缓存和边界切换。 */
  test('KeepAlive with Suspense', async () => {
    const Async = defineAsyncComponent({
      /** 渲染'div'节点（'async'）。 */
      render() {
        return h('div', 'async')
      },
    })
    const Sync = {
      /** 渲染'div'节点（'sync'）。 */
      render() {
        return h('div', 'sync')
      },
    }
    const components = [Async, Sync]
    const viewRef = ref(0)
    const root = nodeOps.createElement('div')
    const App = {
      /** 渲染KeepAlive节点（null；插槽{default回调}）。 */
      render() {
        return h(KeepAlive, null, {
          /** 提供default插槽：Suspense节点（null；插槽{default: h(components[viewRef.value])，fallback: h('div', 'Loading-dynamic-components')}）。 */
          default: () => {
            return h(Suspense, null, {
              default: h(components[viewRef.value]),
              fallback: h('div', 'Loading-dynamic-components'),
            })
          },
        })
      },
    }
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<div>Loading-dynamic-components</div>`)

    viewRef.value = 1
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>sync</div>`)

    viewRef.value = 0
    await nextTick()

    expect(serializeInner(root)).toBe('<div>sync</div>')

    await Promise.all(deps)
    await nextTick()
    // 异步依赖完成后显示 async div。
    expect(serializeInner(root)).toBe('<div>async</div>')

    viewRef.value = 1
    await nextTick()
    // 回归检查：切回缓存内容不因空 host el 读取 parentNode 而抛错。
    // 后续切换正常完成。
    expect(serializeInner(root)).toBe(`<div>sync</div>`)
  })

  // #10899 / #11427
  /** 测试场景：KeepAlive max=1包裹Suspense，在Async1首次pending时切Async2；完成后只显示Async2，再往返两异步分支均显示所选内容，验证容量淘汰不破坏待定边界。 */
  test('KeepAlive + Suspense switch before branch resolves', async () => {
    const Async1 = defineAsyncComponent({
      /** 渲染'div'节点（'async1'）。 */
      render() {
        return h('div', 'async1')
      },
    })
    const Async2 = defineAsyncComponent({
      /** 渲染'div'节点（'async2'）。 */
      render() {
        return h('div', 'async2')
      },
    })
    const components = [Async1, Async2]
    const viewRef = ref(0)
    const root = nodeOps.createElement('div')
    const App = {
      /** 渲染KeepAlive节点（属性{max: 1}；插槽{default回调}）。 */
      render() {
        return h(
          KeepAlive,
          {
            max: 1,
          },
          {
            /** 提供default插槽：Suspense节点（null；插槽{default: h(components[viewRef.value])，fallback: h('div', 'loading')}）。 */
            default: () => {
              return h(Suspense, null, {
                default: h(components[viewRef.value]),
                fallback: h('div', 'loading'),
              })
            },
          },
        )
      },
    }
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<div>loading</div>`)

    // Async1 未完成时改为 Async2。
    viewRef.value = 1
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>loading</div>`)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe('<div>async2</div>')

    viewRef.value = 0
    await nextTick()
    await Promise.all(deps)
    expect(serializeInner(root)).toBe(`<div>async1</div>`)

    viewRef.value = 1
    await nextTick()
    await Promise.all(deps)
    expect(serializeInner(root)).toBe(`<div>async2</div>`)
  })

  /** 测试场景：KeepAlive内Suspense初始default为v-if注释；打开异步组件并等待依赖后显示async1，确认注释分支向可缓存内容切换。 */
  test('KeepAlive + Suspense + comment slot', async () => {
    const toggle = ref(false)
    const Async = defineAsyncComponent({
      /** 渲染'div'节点（'async1'）。 */
      render() {
        return h('div', 'async1')
      },
    })
    const App = {
      /** 渲染KeepAlive节点（null；插槽{default回调}）。 */
      render() {
        return h(KeepAlive, null, {
          /** 提供default插槽：Suspense节点（null；插槽{default: toggle.value ? h(Async) : createCommentVNode('v-if')}）。 */
          default: () => {
            return h(Suspense, null, {
              default: toggle.value ? h(Async) : createCommentVNode('v-if'),
            })
          },
        })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<!--v-if-->`)

    toggle.value = true
    await nextTick()
    await Promise.all(deps)
    expect(serializeInner(root)).toBe(`<div>async1</div>`)
  })

  // #6416 的后续回归 / #10017
  /** 测试场景：Suspense根为HOC Comp，异步子先resolve再修改key强制重挂，随后更新透传data；用例仅断言初始注释并要求整个更新流程不抛错，未断言最终DOM。 */
  test('Suspense patched during HOC async component re-mount', async () => {
    const key = ref('k')
    const data = ref('data')

    const Async = defineAsyncComponent({
      /** 渲染'div'节点（'async'）。 */
      render() {
        return h('div', 'async')
      },
    })

    const Comp = {
      /** 渲染Async节点（属性{key: key.value}）。 */
      render() {
        return h(Async, { key: key.value })
      },
    }

    const root = nodeOps.createElement('div')
    const App = {
      /** 渲染Suspense节点（null；插槽{default: h(Comp, { k: key.value, data: data.value })}）。 */
      render() {
        return h(Suspense, null, {
          default: h(Comp, { k: key.value, data: data.value }),
        })
      },
    }
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<!---->`)

    await Promise.all(deps)

    // 原异步内容已挂载，key 变化建立新的异步实例。
    key.value = 'k1'
    await nextTick()

    // 再次 patch 尚在等待的 Suspense。
    // 不得因边界 VNode.el 暂未提交而读取空宿主抛错。
    data.value = 'data2'
    await Promise.all(deps)
  })

  // #12920
  /** 测试场景：公共异步wrapper加载的子组件mounted自切keyed根show→hidden；刷新后关闭外Suspense，只留下v-if注释，验证最新host el用于移除。 */
  test('unmount Suspense after async child (with defineAsyncComponent) self-triggered update', async () => {
    const Comp = defineComponent({
      /** 建立show=ref(true)；注册onMounted回调写入show.value=!show.value。setup返回渲染函数：show.value决定openBlock(), createElementBlock('div', { key: 0 }, 'show')或openBlock(), createElementBlock('div', { key: 1 }, 'hidden')。 */
      setup() {
        const show = ref(true)
        onMounted(() => {
          // 触发响应式更新。
          show.value = !show.value
        })
        return () =>
          show.value
            ? (openBlock(), createElementBlock('div', { key: 0 }, 'show'))
            : (openBlock(), createElementBlock('div', { key: 1 }, 'hidden'))
      },
    })

    const AsyncComp = defineAsyncComp(() => {
      const p = new Promise(resolve => {
        resolve(Comp)
      })
      deps.push(p.then(() => Promise.resolve()))
      return p as any
    })

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const App = {
      /** 渲染openBlock(), createElementBlock( Fragment, null, [ h('h1', null, toggle.value), toggle.value ? (openBlock(), createBlock( Suspense, { key: 0 }, { default: h(AsyncComp), }, )) : createCommentVNode('v-if', true), ], PatchFlags.STABLE_FRAGMENT, )。 */
      render() {
        return (
          openBlock(),
          createElementBlock(
            Fragment,
            null,
            [
              h('h1', null, toggle.value),
              toggle.value
                ? (openBlock(),
                  createBlock(
                    Suspense,
                    { key: 0 },
                    {
                      default: h(AsyncComp),
                    },
                  ))
                : createCommentVNode('v-if', true),
            ],
            PatchFlags.STABLE_FRAGMENT,
          )
        )
      },
    }
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<h1>true</h1><!---->`)

    await Promise.all(deps)
    await nextTick()
    await nextTick()
    expect(serializeInner(root)).toBe(`<h1>true</h1><div>show</div>`)

    await nextTick()
    expect(serializeInner(root)).toBe(`<h1>true</h1><div>hidden</div>`)

    // 关闭外层 Suspense。
    toggle.value = false
    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<h1>true</h1><!--v-if-->`)
  })

  /** 测试场景：async setup子组件mounted自切keyed根show→hidden；resolve后直接显示hidden，关闭外Suspense只留下v-if注释，确认异步setup路径host el同步。 */
  test('unmount Suspense after async child (with async setup) self-triggered update', async () => {
    const AsyncComp = defineComponent({
      /** 建立show=ref(true)；执行deps.push(p.then(() => Promise.resolve()))；注册onMounted回调写入show.value=!show.value。setup返回渲染函数：show.value决定openBlock(), createElementBlock('div', { key: 0 }, 'show')或openBlock(), createElementBlock('div', { key: 1 }, 'hidden')。 async返回Promise；即使没有await，返回值也需经Promise完成后使用。 */
      async setup() {
        const show = ref(true)
        onMounted(() => {
          // 触发响应式更新。
          show.value = !show.value
        })
        const p = new Promise(r => setTimeout(r, 1))
        // 多一轮微任务等待 setup 恢复与边界提交。
        deps.push(p.then(() => Promise.resolve()))
        return () =>
          show.value
            ? (openBlock(), createElementBlock('div', { key: 0 }, 'show'))
            : (openBlock(), createElementBlock('div', { key: 1 }, 'hidden'))
      },
    })

    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const App = {
      /** 渲染openBlock(), createElementBlock( Fragment, null, [ h('h1', null, toggle.value), toggle.value ? (openBlock(), createBlock( Suspense, { key: 0 }, { default: h(AsyncComp), }, )) : createCommentVNode('v-if', true), ], PatchFlags.STABLE_FRAGMENT, )。 */
      render() {
        return (
          openBlock(),
          createElementBlock(
            Fragment,
            null,
            [
              h('h1', null, toggle.value),
              toggle.value
                ? (openBlock(),
                  createBlock(
                    Suspense,
                    { key: 0 },
                    {
                      default: h(AsyncComp),
                    },
                  ))
                : createCommentVNode('v-if', true),
            ],
            PatchFlags.STABLE_FRAGMENT,
          )
        )
      },
    }
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<h1>true</h1><!---->`)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<h1>true</h1><div>hidden</div>`)

    // 关闭外层 Suspense。
    toggle.value = false
    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<h1>true</h1><!--v-if-->`)
  })

  /** 测试场景：Outer→Inner→Suspense→async Child，Child mounted自切根key；完成后Suspense、Inner、Outer VNode.el均指当前hidden div，验证宿主引用向HOC链传播。 */
  test('propagates host el through wrapper components above Suspense after async child self-triggered update', async () => {
    const AsyncComp = defineComponent({
      /** 建立show=ref(true)；执行deps.push(p.then(() => Promise.resolve()))；注册onMounted回调写入show.value=false。setup返回渲染函数：'div'节点（属性{key: show.value ? 'show' : 'hidden'}；show.value决定'show'或'hidden'）。 async返回Promise；即使没有await，返回值也需经Promise完成后使用。 */
      async setup() {
        const show = ref(true)
        onMounted(() => {
          show.value = false
        })
        const p = new Promise(r => setTimeout(r, 1))
        deps.push(p.then(() => Promise.resolve()))
        return () =>
          h(
            'div',
            { key: show.value ? 'show' : 'hidden' },
            show.value ? 'show' : 'hidden',
          )
      },
    })

    const Inner = defineComponent({
      /** 渲染Suspense节点（null；插槽{default回调}）。 */
      render() {
        return h(Suspense, null, {
          /** 提供default插槽：AsyncComp节点。 */
          default: () => h(AsyncComp),
        })
      },
    })

    const Outer = defineComponent({
      /** 渲染Inner节点。 */
      render() {
        return h(Inner)
      },
    })

    const root = nodeOps.createElement('div')
    const vnode = h(Outer)
    render(vnode, root)
    expect(serializeInner(root)).toBe(`<!---->`)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>hidden</div>`)

    const renderedEl = root.children[0]
    const innerVNode = vnode.component!.subTree
    const suspenseVNode = innerVNode.component!.subTree

    expect(suspenseVNode.el).toBe(renderedEl)
    expect(innerVNode.el).toBe(renderedEl)
    expect(vnode.el).toBe(renderedEl)
  })

  /** 测试场景：pending默认div含Async和Teleport；初始fallback且target空，依赖完成并刷新后主树提交双锚点、target才出现teleported，检查远端挂载排队。 */
  test('should mount after suspense is resolved', async () => {
    const target = nodeOps.createElement('div')

    const Async = defineAsyncComponent({
      /** 渲染'div'节点（'async'）。 */
      render() {
        return h('div', 'async')
      },
    })

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h('div', null, [ h(Async), h(Teleport, { to: target }, h('div', 'teleported')), ])，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h('div', null, [
              h(Async),
              h(Teleport, { to: target }, h('div', 'teleported')),
            ]),
            fallback: h('div', 'fallback'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(serializeInner(target)).toBe(``)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>async</div><!--teleport start--><!--teleport end--></div>`,
    )
    expect(serializeInner(target)).toBe(`<div>teleported</div>`)
  })

  /** 测试场景：pending默认div内Teleport文本one改two；等待期间target空，resolve后仅挂最新two，验证延迟远端patch使用最新VNode。 */
  test('should patch teleport before suspense is resolved', async () => {
    const target = nodeOps.createElement('div')
    const text = ref('one')

    const Async = defineAsyncComponent({
      /** 渲染'div'节点（'async'）。 */
      render() {
        return h('div', 'async')
      },
    })

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h('div', null, [ h(Async), h(Teleport, { to: target }, h('div', text.value)), ])，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h('div', null, [
              h(Async),
              h(Teleport, { to: target }, h('div', text.value)),
            ]),
            fallback: h('div', 'fallback'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(serializeInner(target)).toBe(``)

    text.value = 'two'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(serializeInner(target)).toBe(``)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>async</div><!--teleport start--><!--teleport end--></div>`,
    )
    expect(serializeInner(target)).toBe(`<div>two</div>`)
  })

  /** 测试场景：pending期间将Teleport disabled false改true；resolve后child挂在主锚点间而target保持空，确认延迟挂载采用最新disabled和已提交容器。 */
  test('should handle disabled teleport updates before suspense is resolved', async () => {
    const target = nodeOps.createElement('div')
    const disabled = ref(false)

    const Async = defineAsyncComponent({
      /** 渲染'div'节点（'async'）。 */
      render() {
        return h('div', 'async')
      },
    })

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h('div', null, [ h(Async), h( Teleport, { to: target, disabled: disabled.value }, h('div', 'teleported'), ), ])，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () =>
          h(Suspense, null, {
            default: h('div', null, [
              h(Async),
              h(
                Teleport,
                { to: target, disabled: disabled.value },
                h('div', 'teleported'),
              ),
            ]),
            fallback: h('div', 'fallback'),
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(serializeInner(target)).toBe(``)

    disabled.value = true
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(serializeInner(target)).toBe(``)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>async</div><!--teleport start--><div>teleported</div><!--teleport end--></div>`,
    )
    expect(serializeInner(target)).toBe(``)
  })

  /** 测试场景：pending期间从默认children移除Teleport；resolve后仅保留Async，target始终空，确认废弃远端挂载任务被跳过。 */
  test('should not mount discarded teleport after suspense is resolved', async () => {
    const target = nodeOps.createElement('div')
    const showTeleport = ref(true)

    const Async = defineAsyncComponent({
      /** 渲染'div'节点（'async'）。 */
      render() {
        return h('div', 'async')
      },
    })

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h('div', null, children)，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () => {
          const children = [h(Async)]
          if (showTeleport.value) {
            children.push(h(Teleport, { to: target }, h('div', 'teleported')))
          }
          return h(Suspense, null, {
            default: h('div', null, children),
            fallback: h('div', 'fallback'),
          })
        }
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(serializeInner(target)).toBe(``)

    showTeleport.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(serializeInner(target)).toBe(``)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div><div>async</div></div>`)
    expect(serializeInner(target)).toBe(``)
  })

  // #14876
  /** 测试场景：pending期间移除带Inner组件的Teleport；resolve后主树仅Async、target空，确认未挂载组件子树不会被迟到任务提交。 */
  test('should not mount discarded teleport with component child after suspense is resolved', async () => {
    const target = nodeOps.createElement('div')
    const showTeleport = ref(true)

    const Async = defineAsyncComponent({
      /** 渲染'div'节点（'async'）。 */
      render() {
        return h('div', 'async')
      },
    })

    const Inner = {
      /** 渲染'div'节点（'inner'）。 */
      render() {
        return h('div', 'inner')
      },
    }

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h('div', null, children)，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () => {
          const children = [h(Async)]
          if (showTeleport.value) {
            children.push(h(Teleport, { to: target }, h(Inner)))
          }
          return h(Suspense, null, {
            default: h('div', null, children),
            fallback: h('div', 'fallback'),
          })
        }
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(serializeInner(target)).toBe(``)

    showTeleport.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(serializeInner(target)).toBe(``)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div><div>async</div></div>`)
    expect(serializeInner(target)).toBe(``)
  })

  /** 测试场景：pending期间先禁用Teleport再将其移除；resolve后主树仅Async、target空，验证废弃本地挂载更新也不执行。 */
  test('should not process discarded disabled teleport update after suspense is resolved', async () => {
    const target = nodeOps.createElement('div')
    const showTeleport = ref(true)
    const disabled = ref(false)

    const Async = defineAsyncComponent({
      /** 渲染'div'节点（'async'）。 */
      render() {
        return h('div', 'async')
      },
    })

    const Comp = {
      /** setup返回渲染函数：Suspense节点（null；插槽{default: h('div', null, children)，fallback: h('div', 'fallback')}）。 */
      setup() {
        return () => {
          const children = [h(Async)]
          if (showTeleport.value) {
            children.push(
              h(
                Teleport,
                { to: target, disabled: disabled.value },
                h('div', 'teleported'),
              ),
            )
          }
          return h(Suspense, null, {
            default: h('div', null, children),
            fallback: h('div', 'fallback'),
          })
        }
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(serializeInner(target)).toBe(``)

    disabled.value = true
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(serializeInner(target)).toBe(``)

    showTeleport.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)
    expect(serializeInner(target)).toBe(``)

    await Promise.all(deps)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div><div>async</div></div>`)
    expect(serializeInner(target)).toBe(``)
  })

  // #14701
  /** 测试场景：异步组件返回普通div+禁用Teleport的多根Fragment，Teleport子是组件；resolve搬运后主树含content和锚点间comp div，验证尚未挂载子组件时移动不崩溃。 */
  test('should not crash when moving disabled teleport with component children inside suspense', async () => {
    const target = nodeOps.createElement('div')

    const Comp = {
      /** 渲染'div'节点（'comp'）。 */
      render() {
        return h('div', 'comp')
      },
    }

    const Async = defineAsyncComponent({
      /** 渲染根数组['div'节点（'content'）、Teleport节点（属性{to: target，disabled: true}；Comp节点）]。 */
      render() {
        // 多根 Fragment：普通元素，加含组件子节点的禁用 Teleport。
        return [
          h('div', 'content'),
          h(Teleport, { to: target, disabled: true }, h(Comp)),
        ]
      },
    })

    const root = nodeOps.createElement('div')
    render(
      h(Suspense, null, {
        default: h(Async),
        fallback: h('div', 'fallback'),
      }),
      root,
    )
    expect(serializeInner(root)).toBe(`<div>fallback</div>`)

    await Promise.all(deps)
    await nextTick()
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div>content</div><!--teleport start--><div>comp</div><!--teleport end-->`,
    )
  })

  //#11617
  /** 测试场景：App mounted将同步Dummy换Parent，Parent mounted先设loading=true、定时改false；异步Child的onUpdated最终记录[true,false]，断言位于延迟挂载回调内，用例主体不等待该定时器。 */
  test('update async component before resolve then update again', async () => {
    const arr: boolean[] = []
    const Child = {
      props: ['loading'],
      /** 注册onUpdated回调写入arr.push(props.loading)。setup返回渲染函数：'div'节点（null；loading决定'1'或'2'）。 async返回Promise，等待1后完成。 */
      async setup(props: any) {
        onUpdated(() => {
          arr.push(props.loading)
        })
        await 1
        return () => {
          const loading = props.loading
          return h('div', null, loading ? '1' : '2')
        }
      },
    }

    const Parent = defineComponent({
      /** 建立loading=false，注册异步onMounted：先设true，等待delay(1000)再设false，并在更新后断言onUpdated记录[true,false]；返回读取loading的Child渲染函数。 */
      setup() {
        const loading = ref(false)
        /** 返回delayInms毫秒后完成的Promise，延后把loading由true改false，制造两轮异步子更新。 */
        const delay = (delayInms: any) => {
          return new Promise(resolve => setTimeout(resolve, delayInms))
        }
        onMounted(async () => {
          loading.value = true
          await delay(1000)
          loading.value = false
          await nextTick()
          expect(arr).toEqual([true, false])
        })
        return () => {
          return h(Child, { loading: loading.value })
        }
      },
    })

    const RouterView = {
      props: {
        name: { type: Object },
      },
      /** setup返回渲染函数：name节点。 */
      setup(props: any) {
        return () => {
          const name = props.name
          return h(name)
        }
      },
    }
    const App = {
      /** 建立flag=shallowRef(Dummy)；注册onMounted回调写入flag.value=Parent。setup返回渲染函数：Suspense节点（null；插槽{default回调}）。 */
      setup() {
        const Dummy = {
          /** setup返回渲染函数：'div'节点（null；'dummy'）。 */
          setup() {
            return () => {
              return h('div', null, 'dummy')
            }
          },
        }

        const flag: any = shallowRef(Dummy)

        onMounted(() => {
          flag.value = Parent
        })
        return () => {
          return h(Suspense, null, {
            /** 提供default插槽：RouterView节点（属性{name: flag.value}）。 */
            default: () => h(RouterView, { name: flag.value }),
          })
        }
      },
    }

    const root: any = nodeOps.createElement('div')

    render(h(App), root)
  })

  // #13453
  /** 测试场景：按types注册keyed边界，先展示A；追加B后异步间隔移除A，B仍pending时重新patch其插槽，等待依赖后展示B，验证patch新异步依赖不会丢登记。 */
  test('add new async deps during patching', async () => {
    /** 按type返回新建的A或B异步fixture，setup完成后输出对应文本div；每次调用生成新类型，用于pending边界再次patch的依赖登记。 */
    const getComponent = (type: string) => {
      if (type === 'A') {
        return defineAsyncComponent({
          /** setup返回渲染函数：'div'节点（'A'）。 */
          setup() {
            return () => h('div', 'A')
          },
        })
      }
      return defineAsyncComponent({
        /** setup返回渲染函数：'div'节点（'B'）。 */
        setup() {
          return () => h('div', 'B')
        },
      })
    }

    const types = ref(['A'])
    /** 把B加入types列表，async返回让调用方在移除A之前经历一个调度间隔，制造新边界的pending更新。 */
    const add = async () => {
      types.value.push('B')
    }

    /** 先异步追加B再移除A，让B在尚pending时被再次patch，供依赖登记回归断言。 */
    const update = async () => {
      // 追加 B，让其边界进入 pending。
      // 列表由 A 扩为 A 与 pending B。
      await add()
      // 移除 A 后，再 patch 仍 pending 的 B。
      // 列表缩为 B，插槽重新创建异步组件类型。
      types.value.shift()
    }

    const Comp = {
      /** 渲染Fragment节点（null；根数组[renderList(types.value, type => { return h( Suspense, { key: type }, { default: () => [ renderSlot(this.$slots, 'default', { type: type }), ], }, ) })]）。 */
      render(this: any) {
        return h(Fragment, null, [
          renderList(types.value, type => {
            return h(
              Suspense,
              { key: type },
              {
                /** 提供default插槽：根数组[renderSlot(this.$slots, 'default', { type: type })]。 */
                default: () => [
                  renderSlot(this.$slots, 'default', { type: type }),
                ],
              },
            )
          }),
        ])
      },
    }

    const App = {
      /** setup返回渲染函数：Comp节点（null；插槽{default回调}）。 */
      setup() {
        return () =>
          h(Comp, null, {
            /** 提供default插槽：根数组[getComponent(params.type)节点]。 */
            default: (params: any) => [h(getComponent(params.type))],
          })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<!---->`)

    await Promise.all(deps)
    expect(serializeInner(root)).toBe(`<div>A</div>`)

    update()
    await nextTick()
    // 等待本轮记录的依赖恢复。
    await Promise.all(deps)
    // 再等待 B 在 patch 中新登记的依赖。
    await Promise.all(deps)
    expect(serializeInner(root)).toBe(`<div>B</div>`)
  })

  // 测试组：Suspense 结构或用法不合法时的开发期警告。
  describe('warnings', () => {
    // 挂载给定插槽组合并按参数核对结构警告。
    /** 挂载给定default/fallback原始插槽与边界props，shouldWarn决定断言single-root警告出现还是缺席，供空值、单根和多根正规化复用。 */
    function baseCheckWarn(
      shouldWarn: boolean,
      children: RawSlots,
      props: SuspenseProps | null = null,
    ) {
      const Comp = {
        /** setup返回渲染函数：Suspense节点（props；children）。 */
        setup() {
          return () => h(Suspense, props, children)
        },
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)

      if (shouldWarn) {
        expect(`<Suspense> slots expect a single root node.`).toHaveBeenWarned()
      } else {
        expect(
          `<Suspense> slots expect a single root node.`,
        ).not.toHaveBeenWarned()
      }
    }

    // 固定 shouldWarn 参数，生成两个调用入口。
    /** 固定shouldWarn=true的绑定函数，挂载给定slots并要求single-root警告。 */
    const checkWarn = baseCheckWarn.bind(null, true)
    /** 固定shouldWarn=false的绑定函数，挂载给定slots并要求没有single-root警告。 */
    const checkNoWarn = baseCheckWarn.bind(null, false)

    /** 测试场景：default/fallback各传一个div；共享helper挂载并检查无single-root结构警告，验证单根正规化。 */
    test('does not warn on single child', async () => {
      checkNoWarn({
        default: h('div'),
        fallback: h('div'),
      })
    })

    /** 测试场景：default/fallback直接传null；共享helper挂载且无single-root警告，验证空插槽可正规化为注释。 */
    test('does not warn on null', async () => {
      checkNoWarn({
        default: null,
        fallback: null,
      })
    })

    /** 测试场景：default函数返回resolveDynamicComponent(null)、fallback函数返回null；挂载无single-root警告，验证空动态组件的占位正规化。 */
    test('does not warn on <component :is="null" />', async () => {
      checkNoWarn({
        /** 提供default插槽：根数组[resolveDynamicComponent(null)]。 */
        default: () => [resolveDynamicComponent(null)],
        /** 提供fallback插槽：null。 */
        fallback: () => null,
      })
    })

    /** 测试场景：default直接空数组、fallback函数返回空数组；挂载无single-root警告，确认空children按空根处理。 */
    test('does not warn on empty array', async () => {
      checkNoWarn({
        default: [],
        /** 提供fallback插槽：根数组[]。 */
        fallback: () => [],
      })
    })

    /** 测试场景：default传两个div；共享helper检查slots expect a single root node警告，验证默认插槽多根诊断。 */
    test('warns on multiple children in default', async () => {
      checkWarn({
        default: [h('div'), h('div')],
      })
    })

    /** 测试场景：default单div而fallback双div；挂载同一single-root警告，验证后备插槽也受根约束。 */
    test('warns on multiple children in fallback', async () => {
      checkWarn({
        default: h('div'),
        fallback: [h('div'), h('div')],
      })
    })

    // #13559
    /** 测试场景：Fragment按key映射三个异步组件，全部resolve后显示111/222/333；整批替换items/key后等待新依赖，显示444/555/666，验证列表更新。 */
    test('renders multiple async components in Suspense with v-for and updates on items change', async () => {
      const CompAsyncSetup = defineAsyncComponent({
        props: ['item'],
        /** 渲染'div'节点（ctx.item.name）。 */
        render(ctx: any) {
          return h('div', ctx.item.name)
        },
      })

      const items = ref([
        { id: 1, name: '111' },
        { id: 2, name: '222' },
        { id: 3, name: '333' },
      ])

      const Comp = {
        /** setup返回渲染函数：Suspense节点（null；插槽{default回调}）。 */
        setup() {
          return () =>
            h(Suspense, null, {
              /** 提供default插槽：Fragment节点（null；items.value.map(item => h(CompAsyncSetup, { item, key: item.id }), )）。 */
              default: () =>
                h(
                  Fragment,
                  null,
                  items.value.map(item =>
                    h(CompAsyncSetup, { item, key: item.id }),
                  ),
                ),
            })
        },
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      await nextTick()
      await Promise.all(deps)

      expect(serializeInner(root)).toBe(
        `<div>111</div><div>222</div><div>333</div>`,
      )

      items.value = [
        { id: 4, name: '444' },
        { id: 5, name: '555' },
        { id: 6, name: '666' },
      ]
      await nextTick()
      await Promise.all(deps)
      expect(serializeInner(root)).toBe(
        `<div>444</div><div>555</div><div>666</div>`,
      )
    })

    // #14173
    /** 测试场景：外列表每项经普通/异步wrapper进入内Suspense列表；分别替换外id和内items，三轮结果按外id×内name输出9节点，验证嵌套无元素包装链的host/锚点更新。 */
    test('nested async components with v-for + only Suspense and async component wrappers', async () => {
      const CompAsyncSetup = defineAsyncComponent({
        props: ['item', 'id'],
        /** 渲染'div'节点（ctx.id + '-' + ctx.item.name）。 */
        render(ctx: any) {
          return h('div', ctx.id + '-' + ctx.item.name)
        },
      })
      const items = ref([
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
        { id: 3, name: 'c' },
      ])
      const Comp = {
        props: ['id'],
        /** setup返回渲染函数：Suspense节点（null；插槽{default回调}）。 */
        setup(props: any) {
          return () =>
            h(Suspense, null, {
              /** 提供default插槽：Fragment节点（null；items.value.map(item => h(CompAsyncSetup, { item, key: item.id, id: props.id, }), )）。 */
              default: () =>
                h(
                  Fragment,
                  null,
                  items.value.map(item =>
                    h(CompAsyncSetup, {
                      item,
                      key: item.id,
                      id: props.id,
                    }),
                  ),
                ),
            })
        },
      }

      const CompAsyncWrapper = defineAsyncComponent({
        props: ['id'],
        /** 渲染Comp节点（属性{id: ctx.id}）。 */
        render(ctx: any) {
          return h(Comp, { id: ctx.id })
        },
      })
      const CompWrapper = defineComponent({
        props: ['id'],
        /** 渲染CompAsyncWrapper节点（属性{id: ctx.id}）。 */
        render(ctx: any) {
          return h(CompAsyncWrapper, { id: ctx.id })
        },
      })
      const list = ref([{ id: 1 }, { id: 2 }, { id: 3 }])

      const App = {
        /** setup返回渲染函数：Suspense节点（null；插槽{default回调}）。 */
        setup() {
          return () =>
            h(Suspense, null, {
              /** 提供default插槽：Fragment节点（null；list.value.map(item => h(CompWrapper, { id: item.id, key: item.id }), )）。 */
              default: () =>
                h(
                  Fragment,
                  null,
                  list.value.map(item =>
                    h(CompWrapper, { id: item.id, key: item.id }),
                  ),
                ),
            })
        },
      }

      const root = nodeOps.createElement('div')
      render(h(App), root)
      await nextTick()
      await Promise.all(deps)
      await Promise.all(deps)

      expect(serializeInner(root)).toBe(
        `<div>1-a</div><div>1-b</div><div>1-c</div><div>2-a</div><div>2-b</div><div>2-c</div><div>3-a</div><div>3-b</div><div>3-c</div>`,
      )

      list.value = [{ id: 4 }, { id: 5 }, { id: 6 }]
      await nextTick()
      await Promise.all(deps)
      await Promise.all(deps)
      expect(serializeInner(root)).toBe(
        `<div>4-a</div><div>4-b</div><div>4-c</div><div>5-a</div><div>5-b</div><div>5-c</div><div>6-a</div><div>6-b</div><div>6-c</div>`,
      )

      items.value = [
        { id: 4, name: 'd' },
        { id: 5, name: 'f' },
        { id: 6, name: 'g' },
      ]
      await nextTick()
      await Promise.all(deps)
      await Promise.all(deps)
      expect(serializeInner(root)).toBe(
        `<div>4-d</div><div>4-f</div><div>4-g</div><div>5-d</div><div>5-f</div><div>5-g</div><div>6-d</div><div>6-f</div><div>6-g</div>`,
      )
    })

    /** 测试场景：fallback div绑定unmounted指令，默认异步Foo再包Comp；全部resolve并刷新后指令unmounted恰一次，避免替换后备内容时重复卸载。 */
    test('should call unmounted directive once when fallback is replaced by resolved async component', async () => {
      const Comp = {
        /** 渲染'div'节点（null；'comp'）。 */
        render() {
          return h('div', null, 'comp')
        },
      }
      const Foo = defineAsyncComponent({
        /** 渲染Comp节点。 */
        render() {
          return h(Comp)
        },
      })
      const unmounted = vi.fn(el => {
        el.foo = null
      })
      const vDir = {
        unmounted,
      }
      const App = {
        /** setup返回渲染函数：Suspense节点（null；插槽{fallback回调，default回调}）。 */
        setup() {
          return () => {
            return h(Suspense, null, {
              /** 提供fallback插槽：withDirectives(h('div'), [[vDir, true]])。 */
              fallback: () => withDirectives(h('div'), [[vDir, true]]),
              /** 提供default插槽：Foo节点。 */
              default: () => h(Foo),
            })
          }
        },
      }
      const root = nodeOps.createElement('div')
      render(h(App), root)

      await Promise.all(deps)
      await nextTick()
      expect(unmounted).toHaveBeenCalledTimes(1)
    })
  })

  // 测试组：使用 withAsyncContext 恢复实例上下文的顶层 await。
  describe('async setup with top-level await', () => {
    /** 测试场景：SlowComp在withAsyncContext await期间被Filler替换；迟到恢复后创建watch再修改state，updateSpy不调用且filler已展示，验证废弃实例scope清理。 */
    test('pending branch replaced before async setup resolves', async () => {
      const updateSpy = vi.fn()
      const stateRef = ref(0)
      let resolvePending!: (v?: unknown) => void

      const SlowComp = defineComponent({
        /** 执行[__temp, __restore]=withAsyncContext( () => new Promise(r => { resolvePending = r }), )；withAsyncContext(回调)；__temp=await __temp；注册watch。setup返回渲染函数：'div'节点（'slow'）。 async返回Promise，等待__temp后完成。 */
        async setup() {
          let __temp: any, __restore: any
          ;[__temp, __restore] = withAsyncContext(
            () =>
              new Promise(r => {
                resolvePending = r
              }),
          )
          __temp = await __temp
          __restore()

          watch(stateRef, updateSpy)

          return () => h('div', 'slow')
        },
      })

      const FillerComp = defineComponent({
        /** setup返回渲染函数：'div'节点（'filler'）。 */
        setup: () => () => h('div', 'filler'),
      })

      const view = shallowRef<any>(SlowComp)
      const Comp = defineComponent({
        /** setup返回渲染函数：Suspense节点（null；插槽{default: h(view.value)，fallback: h('div', 'fallback')}）。 */
        setup: () => () =>
          h(Suspense, null, {
            default: h(view.value),
            fallback: h('div', 'fallback'),
          }),
      })

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(serializeInner(root)).toBe(`<div>fallback</div>`)

      view.value = FillerComp
      await nextTick()
      expect(serializeInner(root)).toBe(`<div>filler</div>`)

      // 等待宏任务，让全部异步恢复的微任务链完成。
      resolvePending(undefined)
      await new Promise(r => setTimeout(r))

      stateRef.value++
      await nextTick()
      expect(updateSpy).not.toHaveBeenCalled()
    })

    /** 测试场景：SlowComp await期间整体卸载边界；迟到恢复建立watch后修改state，spy不调用，验证卸载实例作用域仍处停止状态。 */
    test('boundary unmounted before async setup resolves', async () => {
      const updateSpy = vi.fn()
      const stateRef = ref(0)
      let resolvePending!: (v?: unknown) => void

      const SlowComp = defineComponent({
        /** 执行[__temp, __restore]=withAsyncContext( () => new Promise(r => { resolvePending = r }), )；withAsyncContext(回调)；__temp=await __temp；注册watch。setup返回渲染函数：'div'节点（'slow'）。 async返回Promise，等待__temp后完成。 */
        async setup() {
          let __temp: any, __restore: any
          ;[__temp, __restore] = withAsyncContext(
            () =>
              new Promise(r => {
                resolvePending = r
              }),
          )
          __temp = await __temp
          __restore()

          watch(stateRef, updateSpy)

          return () => h('div', 'slow')
        },
      })

      const root = nodeOps.createElement('div')
      render(
        h(() =>
          h(Suspense, null, {
            default: h(SlowComp),
            fallback: h('div', 'fallback'),
          }),
        ),
        root,
      )
      expect(serializeInner(root)).toBe(`<div>fallback</div>`)

      render(null, root)

      resolvePending(undefined)
      await new Promise(r => setTimeout(r))

      stateRef.value++
      await nextTick()
      expect(updateSpy).not.toHaveBeenCalled()
    })

    /** 测试场景：Filler和SlowComp往返三次，保存三项未完成resolver；全部迟到恢复后递增state，spy均不调用，验证每个废弃代次的watch都被清理。 */
    test('repeated branch replacement before async setup resolves', async () => {
      const updateSpy = vi.fn()
      const stateRef = ref(0)
      const resolvers: Array<(v?: unknown) => void> = []

      const SlowComp = defineComponent({
        /** 执行[__temp, __restore]=withAsyncContext( () => new Promise(r => { resolvers.push(r) }), )；withAsyncContext(回调)；__temp=await __temp；注册watch回调写入updateSpy(uid)。setup返回渲染函数：'div'节点（'slow'）。 async返回Promise，等待__temp后完成。 */
        async setup() {
          let __temp: any, __restore: any
          ;[__temp, __restore] = withAsyncContext(
            () =>
              new Promise(r => {
                resolvers.push(r)
              }),
          )
          __temp = await __temp
          __restore()

          const uid = getCurrentInstance()!.uid
          watch(stateRef, () => {
            updateSpy(uid)
          })

          return () => h('div', 'slow')
        },
      })

      const FillerComp = defineComponent({
        /** setup返回渲染函数：'div'节点（'filler'）。 */
        setup: () => () => h('div', 'filler'),
      })

      const view = shallowRef<any>(FillerComp)
      const Comp = defineComponent({
        /** setup返回渲染函数：Suspense节点（null；插槽{default: h(view.value)，fallback: h('div', 'fallback')}）。 */
        setup: () => () =>
          h(Suspense, null, {
            default: h(view.value),
            fallback: h('div', 'fallback'),
          }),
      })

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(serializeInner(root)).toBe(`<div>filler</div>`)

      for (let i = 0; i < 3; i++) {
        view.value = SlowComp
        await nextTick()
        view.value = FillerComp
        await nextTick()
      }

      expect(resolvers.length).toBe(3)
      resolvers.forEach(r => r(undefined))
      await new Promise(r => setTimeout(r))

      stateRef.value++
      await nextTick()
      expect(updateSpy).not.toHaveBeenCalled()
    })

    /** 测试场景：SlowComp await期间被Filler替换，迟到恢复后在新effectScope中创建watch；递增state仍不调用spy，确认新嵌套scope继承废弃父scope的停止状态。 */
    test('nested scope created after pending branch is abandoned', async () => {
      const updateSpy = vi.fn()
      const stateRef = ref(0)
      let resolvePending!: (v?: unknown) => void

      const SlowComp = defineComponent({
        /** 执行[__temp, __restore]=withAsyncContext( () => new Promise(r => { resolvePending = r }), )；withAsyncContext(回调)；__temp=await __temp。setup返回渲染函数：'div'节点（'slow'）。 async返回Promise，等待__temp后完成。 */
        async setup() {
          let __temp: any, __restore: any
          ;[__temp, __restore] = withAsyncContext(
            () =>
              new Promise(r => {
                resolvePending = r
              }),
          )
          __temp = await __temp
          __restore()

          effectScope().run(() => {
            watch(stateRef, updateSpy)
          })

          return () => h('div', 'slow')
        },
      })

      const FillerComp = defineComponent({
        /** setup返回渲染函数：'div'节点（'filler'）。 */
        setup: () => () => h('div', 'filler'),
      })

      const view = shallowRef<any>(SlowComp)
      const Comp = defineComponent({
        /** setup返回渲染函数：Suspense节点（null；插槽{default: h(view.value)，fallback: h('div', 'fallback')}）。 */
        setup: () => () =>
          h(Suspense, null, {
            default: h(view.value),
            fallback: h('div', 'fallback'),
          }),
      })

      const root = nodeOps.createElement('div')
      render(h(Comp), root)
      expect(serializeInner(root)).toBe(`<div>fallback</div>`)

      view.value = FillerComp
      await nextTick()
      expect(serializeInner(root)).toBe(`<div>filler</div>`)

      resolvePending(undefined)
      await new Promise(r => setTimeout(r))

      stateRef.value++
      await nextTick()
      expect(updateSpy).not.toHaveBeenCalled()
    })
  })
})
