/**
 * 在 runtime-test 宿主树中记录生命周期调用，并检查钩子执行时的节点与文本。
 * 父子顺序、钩子内状态修改、调试事件及挂载后立即卸载各有独立夹具。
 */
import {
  KeepAlive,
  TrackOpTypes,
  h,
  nextTick,
  nodeOps,
  onActivated,
  onBeforeMount,
  onBeforeUnmount,
  onBeforeUpdate,
  onMounted,
  onRenderTracked,
  onRenderTriggered,
  onUnmounted,
  onUpdated,
  reactive,
  ref,
  render,
  serializeInner,
} from '@vue/runtime-test'
import {
  type DebuggerEvent,
  ITERATE_KEY,
  TriggerOpTypes,
} from '@vue/reactivity'

// 组合式 API 生命周期钩子的注册、执行顺序与清理。
describe('api: lifecycle hooks', () => {
  // onBeforeMount 在首次 render 前执行；钩子内宿主容器仍为空，调用没有参数。
  it('onBeforeMount', () => {
    const root = nodeOps.createElement('div')
    const fn = vi.fn(() => {
      // 钩子执行时内部 div 尚未创建，宿主容器为空。
      expect(serializeInner(root)).toBe(``)
    })

    const Comp = {
      /**
       * 调用 `onBeforeMount(fn)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div')`。
       */
      setup() {
        onBeforeMount(fn)
        return () => h('div')
      },
    }
    render(h(Comp), root)
    expect(fn).toHaveBeenCalledTimes(1)
    // #10863
    expect(fn).toHaveBeenCalledWith()
  })

  // onMounted 执行时，组件子树已插入宿主容器。
  it('onMounted', () => {
    const root = nodeOps.createElement('div')
    const fn = vi.fn(() => {
      // 钩子执行时内部 div 已插入宿主容器。
      expect(serializeInner(root)).toBe(`<div></div>`)
    })

    const Comp = {
      /**
       * 调用 `onMounted(fn)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div')`。
       */
      setup() {
        onMounted(fn)
        return () => h('div')
      },
    }
    render(h(Comp), root)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // onBeforeUpdate 执行时，宿主文本仍保留更新前的值。
  it('onBeforeUpdate', async () => {
    const count = ref(0)
    const root = nodeOps.createElement('div')
    const fn = vi.fn(() => {
      // 更新前钩子仍读取上一轮宿主文本 0。
      expect(serializeInner(root)).toBe(`<div>0</div>`)
    })

    const Comp = {
      /**
       * 调用 `onBeforeUpdate(fn)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div', count.value)`。
       */
      setup() {
        onBeforeUpdate(fn)
        return () => h('div', count.value)
      },
    }
    render(h(Comp), root)

    count.value++
    await nextTick()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(serializeInner(root)).toBe(`<div>1</div>`)
  })

  // onBeforeUpdate 内再次修改状态纳入当前 render，不额外执行一次钩子或 render。
  it('state mutation in onBeforeUpdate', async () => {
    const count = ref(0)
    const root = nodeOps.createElement('div')
    const fn = vi.fn(() => {
      // 更新前钩子仍读取上一轮宿主文本 0。
      expect(serializeInner(root)).toBe(`<div>0</div>`)
      count.value++
    })
    const renderSpy = vi.fn()

    const Comp = {
      /**
       * 调用 `onBeforeUpdate(fn)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div', count.value)`。
       */
      setup() {
        onBeforeUpdate(fn)
        return () => {
          renderSpy()
          return h('div', count.value)
        }
      },
    }
    render(h(Comp), root)
    expect(renderSpy).toHaveBeenCalledTimes(1)

    count.value++
    await nextTick()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(renderSpy).toHaveBeenCalledTimes(2)
    expect(serializeInner(root)).toBe(`<div>2</div>`)
  })

  // onUpdated 执行时，宿主文本已是本轮的新值。
  it('onUpdated', async () => {
    const count = ref(0)
    const root = nodeOps.createElement('div')
    const fn = vi.fn(() => {
      // 更新后钩子读取本轮宿主文本 1。
      expect(serializeInner(root)).toBe(`<div>1</div>`)
    })

    const Comp = {
      /**
       * 调用 `onUpdated(fn)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div', count.value)`。
       */
      setup() {
        onUpdated(fn)
        return () => h('div', count.value)
      },
    }
    render(h(Comp), root)

    count.value++
    await nextTick()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // onBeforeUnmount 执行时，待卸载子组件的宿主节点仍在容器中。
  it('onBeforeUnmount', async () => {
    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const fn = vi.fn(() => {
      // 卸载前钩子执行时内部 div 仍在容器中。
      expect(serializeInner(root)).toBe(`<div></div>`)
    })

    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `(toggle.value ? h(Child) : null)`。
       */
      setup() {
        return () => (toggle.value ? h(Child) : null)
      },
    }

    const Child = {
      /**
       * 调用 `onBeforeUnmount(fn)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div')`。
       */
      setup() {
        onBeforeUnmount(fn)
        return () => h('div')
      },
    }

    render(h(Comp), root)

    toggle.value = false
    await nextTick()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // onUnmounted 执行时，子组件节点已移除并替换为父级空分支。
  it('onUnmounted', async () => {
    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const fn = vi.fn(() => {
      // 卸载后钩子执行时 div 已由空分支占位替代。
      expect(serializeInner(root)).toBe(`<!---->`)
    })

    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `(toggle.value ? h(Child) : null)`。
       */
      setup() {
        return () => (toggle.value ? h(Child) : null)
      },
    }

    const Child = {
      /**
       * 调用 `onUnmounted(fn)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div')`。
       */
      setup() {
        onUnmounted(fn)
        return () => h('div')
      },
    }

    render(h(Comp), root)

    toggle.value = false
    await nextTick()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // onMounted 中登记 onBeforeUnmount，卸载时仍能执行该钩子。
  it('onBeforeUnmount in onMounted', async () => {
    const toggle = ref(true)
    const root = nodeOps.createElement('div')
    const fn = vi.fn(() => {
      // 卸载前钩子执行时内部 div 仍在容器中。
      expect(serializeInner(root)).toBe(`<div></div>`)
    })

    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `(toggle.value ? h(Child) : null)`。
       */
      setup() {
        return () => (toggle.value ? h(Child) : null)
      },
    }

    const Child = {
      /**
       * 调用 `onMounted(() => { onBeforeUnmount(fn); })` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div')`。
       */
      setup() {
        onMounted(() => {
          onBeforeUnmount(fn)
        })
        return () => h('div')
      },
    }

    render(h(Comp), root)

    toggle.value = false
    await nextTick()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  // 父子 before 钩子父先子后，mounted、updated 与 unmounted 钩子子先父后。
  it('lifecycle call order', async () => {
    const count = ref(0)
    const root = nodeOps.createElement('div')
    const calls: string[] = []

    const Root = {
      /**
       * 调用 `onBeforeMount(() => calls.push('root onBeforeMount'))`、`onMounted(() => calls.push('root onMounted'))`、`onBeforeUpdate(() => calls.push('root onBeforeUpdate'))` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(Mid, { count: count.value })`。
       */
      setup() {
        onBeforeMount(() => calls.push('root onBeforeMount'))
        onMounted(() => calls.push('root onMounted'))
        onBeforeUpdate(() => calls.push('root onBeforeUpdate'))
        onUpdated(() => calls.push('root onUpdated'))
        onBeforeUnmount(() => calls.push('root onBeforeUnmount'))
        onUnmounted(() => calls.push('root onUnmounted'))
        return () => h(Mid, { count: count.value })
      },
    }

    const Mid = {
      props: ['count'],
      /**
       * 调用 `onBeforeMount(() => calls.push('mid onBeforeMount'))`、`onMounted(() => calls.push('mid onMounted'))`、`onBeforeUpdate(() => calls.push('mid onBeforeUpdate'))` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h(Child, { count: props.count })`。
       */
      setup(props: any) {
        onBeforeMount(() => calls.push('mid onBeforeMount'))
        onMounted(() => calls.push('mid onMounted'))
        onBeforeUpdate(() => calls.push('mid onBeforeUpdate'))
        onUpdated(() => calls.push('mid onUpdated'))
        onBeforeUnmount(() => calls.push('mid onBeforeUnmount'))
        onUnmounted(() => calls.push('mid onUnmounted'))
        return () => h(Child, { count: props.count })
      },
    }

    const Child = {
      props: ['count'],
      /**
       * 调用 `onBeforeMount(() => calls.push('child onBeforeMount'))`、`onMounted(() => calls.push('child onMounted'))`、`onBeforeUpdate(() => calls.push('child onBeforeUpdate'))` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div', props.count)`。
       */
      setup(props: any) {
        onBeforeMount(() => calls.push('child onBeforeMount'))
        onMounted(() => calls.push('child onMounted'))
        onBeforeUpdate(() => calls.push('child onBeforeUpdate'))
        onUpdated(() => calls.push('child onUpdated'))
        onBeforeUnmount(() => calls.push('child onBeforeUnmount'))
        onUnmounted(() => calls.push('child onUnmounted'))
        return () => h('div', props.count)
      },
    }

    // 首次挂载，核对记录的调用顺序。
    render(h(Root), root)
    expect(calls).toEqual([
      'root onBeforeMount',
      'mid onBeforeMount',
      'child onBeforeMount',
      'child onMounted',
      'mid onMounted',
      'root onMounted',
    ])

    calls.length = 0

    // 修改渲染依赖并等待一次刷新，核对更新顺序。
    count.value++
    await nextTick()
    expect(calls).toEqual([
      'root onBeforeUpdate',
      'mid onBeforeUpdate',
      'child onBeforeUpdate',
      'child onUpdated',
      'mid onUpdated',
      'root onUpdated',
    ])

    calls.length = 0

    // 卸载根树，核对卸载钩子顺序。
    render(null, root)
    expect(calls).toEqual([
      'root onBeforeUnmount',
      'mid onBeforeUnmount',
      'child onBeforeUnmount',
      'child onUnmounted',
      'mid onUnmounted',
      'root onUnmounted',
    ])
  })

  // onRenderTracked 报告 render 对属性读取、键检查和对象枚举的三类依赖。
  it('onRenderTracked', () => {
    const events: DebuggerEvent[] = []
    const onTrack = vi.fn((e: DebuggerEvent) => {
      events.push(e)
    })
    const obj = reactive({ foo: 1, bar: 2 })

    const Comp = {
      /**
       * 调用 `onRenderTracked(onTrack)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div', [obj.foo, 'bar' in obj, Object.keys(obj).join('')])`。
       */
      setup() {
        onRenderTracked(onTrack)
        return () =>
          h('div', [obj.foo, 'bar' in obj, Object.keys(obj).join('')])
      },
    }

    render(h(Comp), nodeOps.createElement('div'))
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

  // onRenderTriggered 报告触发 render 的属性设置、删除和添加。
  it('onRenderTriggered', async () => {
    const events: DebuggerEvent[] = []
    const onTrigger = vi.fn((e: DebuggerEvent) => {
      events.push(e)
    })
    const obj = reactive<{
      foo: number
      bar?: number
    }>({ foo: 1, bar: 2 })

    const Comp = {
      /**
       * 调用 `onRenderTriggered(onTrigger)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div', [obj.foo, 'bar' in obj, Object.keys(obj).join('')])`。
       */
      setup() {
        onRenderTriggered(onTrigger)
        return () =>
          h('div', [obj.foo, 'bar' in obj, Object.keys(obj).join('')])
      },
    }

    render(h(Comp), nodeOps.createElement('div'))

    obj.foo++
    await nextTick()
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(events[0]).toMatchObject({
      type: TriggerOpTypes.SET,
      key: 'foo',
      oldValue: 1,
      newValue: 2,
    })

    delete obj.bar
    await nextTick()
    expect(onTrigger).toHaveBeenCalledTimes(2)
    expect(events[1]).toMatchObject({
      type: TriggerOpTypes.DELETE,
      key: 'bar',
      oldValue: 2,
    })
    ;(obj as any).baz = 3
    await nextTick()
    expect(onTrigger).toHaveBeenCalledTimes(3)
    expect(events[2]).toMatchObject({
      type: TriggerOpTypes.ADD,
      key: 'baz',
      newValue: 3,
    })
  })

  // 两个组件实例共用同一用户钩子函数，各自的挂载与卸载前阶段都会调用它。
  it('runs shared hook fn for each instance', async () => {
    const fn = vi.fn()
    const toggle = ref(true)
    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `(toggle.value ? [h(Child), h(Child)] : null)`。
       */
      setup() {
        return () => (toggle.value ? [h(Child), h(Child)] : null)
      },
    }
    const Child = {
      /**
       * 调用 `onMounted(fn)`、`onBeforeUnmount(fn)` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `h('div')`。
       */
      setup() {
        onMounted(fn)
        onBeforeUnmount(fn)
        return () => h('div')
      },
    }

    render(h(Comp), nodeOps.createElement('div'))
    expect(fn).toHaveBeenCalledTimes(2)
    toggle.value = false
    await nextTick()
    expect(fn).toHaveBeenCalledTimes(4)
  })

  // 子 setup 立即把父级分支切回空值，失效的 mounted 钩子不再执行。
  it('immediately trigger unmount during rendering', async () => {
    const fn = vi.fn()
    const toggle = ref(false)

    const Child = {
      /**
       * 调用 `onMounted(fn)` 完成本例的初始化登记或读取；把 `toggle.value` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `h('div')`。
       */
      setup() {
        onMounted(fn)
        // 子 setup 立即关闭父级分支，令尚未执行的 post 挂载钩子失效。
        toggle.value = false
        return () => h('div')
      },
    }

    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `(toggle.value ? [h(Child)] : null)`。
       */
      setup() {
        return () => (toggle.value ? [h(Child)] : null)
      },
    }

    render(h(Comp), nodeOps.createElement('div'))

    toggle.value = true
    await nextTick()
    expect(fn).toHaveBeenCalledTimes(0)
  })

  // KeepAlive 内子 setup 立即切回空分支，失效的 mounted 和 activated 钩子都不执行。
  it('immediately trigger unmount during rendering(with KeepAlive)', async () => {
    const mountedSpy = vi.fn()
    const activeSpy = vi.fn()
    const toggle = ref(false)

    const Child = {
      /**
       * 调用 `onMounted(mountedSpy)`、`onActivated(activeSpy)` 完成本例的初始化登记或读取；把 `toggle.value` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `h('div')`。
       */
      setup() {
        onMounted(mountedSpy)
        onActivated(activeSpy)

        // 子 setup 立即关闭父级分支，令尚未执行的 post 挂载钩子失效。
        toggle.value = false
        return () => h('div')
      },
    }

    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `h(KeepAlive, [toggle.value ? h(Child) : null])`。
       */
      setup() {
        return () => h(KeepAlive, [toggle.value ? h(Child) : null])
      },
    }

    render(h(Comp), nodeOps.createElement('div'))

    toggle.value = true
    await nextTick()
    expect(mountedSpy).toHaveBeenCalledTimes(0)
    expect(activeSpy).toHaveBeenCalledTimes(0)
  })
})
