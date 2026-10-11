/**
 * beforeEach 重建 root、one/two 组件及生命周期 spies，避免缓存状态跨用例复用。
 * 通过切换视图、include/exclude 和容量检查实例复用、停用、再次激活与最终卸载。
 */
import {
  type Component,
  type ComponentOptions,
  type ComponentPublicInstance,
  KeepAlive,
  type Ref,
  type TestElement,
  cloneVNode,
  createApp,
  defineAsyncComponent,
  defineComponent,
  h,
  inject,
  markRaw,
  nextTick,
  nodeOps,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  provide,
  reactive,
  ref,
  render,
  serializeInner,
  shallowRef,
} from '@vue/runtime-test'
import type { KeepAliveProps } from '../../src/components/KeepAlive'

/** 等待异步组件或调度任务完成，以断言 KeepAlive 缓存的最终状态。 */
const timeout = (n: number = 0) => new Promise(r => setTimeout(r, n))

// 测试组：KeepAlive 的实例缓存、激活/停用、include/exclude 和容量淘汰。
describe('KeepAlive', () => {
  let one: ComponentOptions
  let two: ComponentOptions
  let oneTest: ComponentOptions
  let views: Record<string, ComponentOptions>
  let root: TestElement

  beforeEach(() => {
    root = nodeOps.createElement('div')
    one = {
      name: 'one',
      /** 初始化组件状态为{msg: 'one'}，供本例渲染和事件更新读取。 */
      data: () => ({ msg: 'one' }),
      /** 渲染'div'节点（this.msg）。 */
      render(this: any) {
        return h('div', this.msg)
      },
      created: vi.fn(),
      mounted: vi.fn(),
      activated: vi.fn(),
      deactivated: vi.fn(),
      unmounted: vi.fn(),
    }
    oneTest = {
      name: 'oneTest',
      /** 初始化组件状态为{msg: 'oneTest'}，供本例渲染和事件更新读取。 */
      data: () => ({ msg: 'oneTest' }),
      /** 渲染'div'节点（this.msg）。 */
      render(this: any) {
        return h('div', this.msg)
      },
      created: vi.fn(),
      mounted: vi.fn(),
      activated: vi.fn(),
      deactivated: vi.fn(),
      unmounted: vi.fn(),
    }
    two = {
      name: 'two',
      /** 初始化组件状态为{msg: 'two'}，供本例渲染和事件更新读取。 */
      data: () => ({ msg: 'two' }),
      /** 渲染'div'节点（this.msg）。 */
      render(this: any) {
        return h('div', this.msg)
      },
      created: vi.fn(),
      mounted: vi.fn(),
      activated: vi.fn(),
      deactivated: vi.fn(),
      unmounted: vi.fn(),
    }
    views = {
      one,
      oneTest,
      two,
    }
  })

  /**
   * 按 created、mounted、activated、deactivated、unmounted 固定顺序读取组件 spies，接收五项预期次数，区分缓存停用与真实卸载。 在此fixture入口检查[
   *       component.created.mock.calls.length,
   *       component.mounted.mock.calls.length,
   *       component.activated.mock.calls.length,
   *       component.deactivated.mock.calls.length,
   *       component.unmounted.mock.calls.length,
   *     ]，失败直接由expect抛出。
   */
  function assertHookCalls(component: any, callCounts: number[]) {
    expect([
      component.created.mock.calls.length,
      component.mounted.mock.calls.length,
      component.activated.mock.calls.length,
      component.deactivated.mock.calls.length,
      component.unmounted.mock.calls.length,
    ]).toEqual(callCounts)
  }

  /** 测试场景：缓存 one 后将实例 msg 改 changed，切换 two 再回 one；再次显示 changed，确认停用期间保留组件状态。 */
  test('should preserve state', async () => {
    const viewRef = ref('one')
    const instanceRef = ref<any>(null)
    const App = {
      /** 渲染KeepAlive节点（null；插槽{default回调}）。 */
      render() {
        return h(KeepAlive, null, {
          /** 提供default插槽：views[viewRef.value]节点（属性{ref: instanceRef}）。 */
          default: () => h(views[viewRef.value], { ref: instanceRef }),
        })
      },
    }
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<div>one</div>`)
    instanceRef.value.msg = 'changed'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>changed</div>`)
    viewRef.value = 'two'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    viewRef.value = 'one'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>changed</div>`)
  })

  /** 测试场景：首次挂载 one 后往返 one/two 两轮，最后卸载 KeepAlive；created/mounted 各仅一次，复用时累加 activated/deactivated，最终活动和已缓存实例均 unmounted 一次。 */
  test('should call correct lifecycle hooks', async () => {
    const toggle = ref(true)
    const viewRef = ref('one')
    const App = {
      /** 渲染toggle.value决定KeepAlive节点（渲染函数：views[viewRef.value]节点）或null。 */
      render() {
        return toggle.value ? h(KeepAlive, () => h(views[viewRef.value])) : null
      },
    }
    render(h(App), root)

    expect(serializeInner(root)).toBe(`<div>one</div>`)
    assertHookCalls(one, [1, 1, 1, 0, 0])
    assertHookCalls(two, [0, 0, 0, 0, 0])

    // 切换 KeepAlive 的活动子组件。
    viewRef.value = 'two'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 1, 1, 0])
    assertHookCalls(two, [1, 1, 1, 0, 0])

    viewRef.value = 'one'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>one</div>`)
    assertHookCalls(one, [1, 1, 2, 1, 0])
    assertHookCalls(two, [1, 1, 1, 1, 0])

    viewRef.value = 'two'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 2, 2, 0])
    assertHookCalls(two, [1, 1, 2, 1, 0])

    // 卸载整个 KeepAlive，活动实例及缓存实例都真实卸载。
    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 2, 2, 1])
    assertHookCalls(two, [1, 1, 2, 2, 1])
  })

  /** 测试场景：尚未切子分支就关闭 KeepAlive，再开启后切 two 并整体关闭；one 首次被真实卸载、重新创建，最终已缓存 one 和活动 two 都被卸载。 */
  test('should call correct lifecycle hooks when toggle the KeepAlive first', async () => {
    const toggle = ref(true)
    const viewRef = ref('one')
    const App = {
      /** 渲染toggle.value决定KeepAlive节点（渲染函数：views[viewRef.value]节点）或null。 */
      render() {
        return toggle.value ? h(KeepAlive, () => h(views[viewRef.value])) : null
      },
    }
    render(h(App), root)

    expect(serializeInner(root)).toBe(`<div>one</div>`)
    assertHookCalls(one, [1, 1, 1, 0, 0])
    assertHookCalls(two, [0, 0, 0, 0, 0])

    // 先关闭整个 KeepAlive，one 实例真实卸载。
    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 1, 1, 1])
    assertHookCalls(two, [0, 0, 0, 0, 0])

    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>one</div>`)
    assertHookCalls(one, [2, 2, 2, 1, 1])
    assertHookCalls(two, [0, 0, 0, 0, 0])

    // 首次在仍存在的 KeepAlive 内切换子组件。
    viewRef.value = 'two'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [2, 2, 2, 2, 1])
    assertHookCalls(two, [1, 1, 1, 0, 0])

    // 整体关闭后，所有缓存及活动子组件都卸载。
    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [2, 2, 2, 2, 2])
    assertHookCalls(two, [1, 1, 1, 1, 1])
  })

  /** 测试场景：缓存的 one 以 two 为子根，整体隐藏再显示；父子都随缓存根触发 activated/deactivated，created/mounted 不重复且隐藏仅显示注释。 */
  test('should call lifecycle hooks on nested components', async () => {
    /** 将共享one fixture的根替换为two组件；缓存根停用/激活时用父子钩子计数核对传播。 */
    one.render = () => h(two)

    const toggle = ref(true)
    const App = {
      /** 渲染KeepAlive节点（渲染函数：toggle.value决定one节点或null）。 */
      render() {
        return h(KeepAlive, () => (toggle.value ? h(one) : null))
      },
    }
    render(h(App), root)

    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 1, 0, 0])
    assertHookCalls(two, [1, 1, 1, 0, 0])

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 1, 1, 0])
    assertHookCalls(two, [1, 1, 1, 1, 0])

    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 2, 1, 0])
    assertHookCalls(two, [1, 1, 2, 1, 0])

    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 2, 2, 0])
    assertHookCalls(two, [1, 1, 2, 2, 0])
  })

  // #1742
  /** 测试场景：缓存根 one 不注册 activated，内层 two 注册；首次挂载 two 正常显示且 activated 一次，验证子钩子提升不依赖根自身钩子。 */
  test('should call lifecycle hooks on nested components when root component no hooks', async () => {
    const two = {
      name: 'two',
      /** 初始化组件状态为{msg: 'two'}，供本例渲染和事件更新读取。 */
      data: () => ({ msg: 'two' }),
      /** 渲染'div'节点（this.msg）。 */
      render(this: any) {
        return h('div', this.msg)
      },
      activated: vi.fn(),
    }
    const one = {
      name: 'one',
      /** 初始化组件状态为{msg: 'one'}，供本例渲染和事件更新读取。 */
      data: () => ({ msg: 'one' }),
      /** 渲染two节点。 */
      render(this: any) {
        return h(two)
      },
    }

    const toggle = ref(true)
    const App = {
      /** 渲染KeepAlive节点（渲染函数：toggle.value决定one节点或null）。 */
      render() {
        return h(KeepAlive, () => (toggle.value ? h(one) : null))
      },
    }
    render(h(App), root)

    expect(serializeInner(root)).toBe(`<div>two</div>`)
    expect(two.activated).toHaveBeenCalledTimes(1)
  })

  /** 测试场景：内外 KeepAlive 分别控制 one/two；外层停用时父子停用，父停用期间切内层开关不会重复激活/停用子；外层恢复但内层仍关闭时子保持停用，核对钩子累计次数。 */
  test('should call correct hooks for nested keep-alive', async () => {
    const toggle2 = ref(true)
    /** 把one的根换成内层KeepAlive；toggle2决定是否展示two，让外层停用与内层开关可独立驱动。 */
    one.render = () => h(KeepAlive, () => (toggle2.value ? h(two) : null))

    const toggle1 = ref(true)
    const App = {
      /** 渲染KeepAlive节点（渲染函数：toggle1.value决定one节点或null）。 */
      render() {
        return h(KeepAlive, () => (toggle1.value ? h(one) : null))
      },
    }
    render(h(App), root)

    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 1, 0, 0])
    assertHookCalls(two, [1, 1, 1, 0, 0])

    toggle1.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 1, 1, 0])
    assertHookCalls(two, [1, 1, 1, 1, 0])

    toggle1.value = true
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 2, 1, 0])
    assertHookCalls(two, [1, 1, 2, 1, 0])

    // 切换内层缓存实例。
    toggle2.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 2, 1, 0])
    assertHookCalls(two, [1, 1, 2, 2, 0])

    toggle2.value = true
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 2, 1, 0])
    assertHookCalls(two, [1, 1, 3, 2, 0])

    toggle1.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 2, 2, 0])
    assertHookCalls(two, [1, 1, 3, 3, 0])

    // 切换内层缓存实例。 when parent is deactivated
    toggle2.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 2, 2, 0])
    assertHookCalls(two, [1, 1, 3, 3, 0]) // 父停用时不重复触发子 activated/deactivated。

    toggle2.value = true
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 2, 2, 0])
    assertHookCalls(two, [1, 1, 3, 3, 0]) // 父停用时不重复触发子 activated/deactivated。

    toggle1.value = true
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 3, 2, 0])
    assertHookCalls(two, [1, 1, 4, 3, 0])

    toggle1.value = false
    toggle2.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 3, 3, 0])
    assertHookCalls(two, [1, 1, 4, 4, 0])

    toggle1.value = true
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 4, 3, 0])
    assertHookCalls(two, [1, 1, 4, 4, 0]) // 内层开关仍关闭，two 保持停用。
  })

  /** 用给定 include/exclude 往返 one/two 两轮，再整体销毁；共享断言要求 one 缓存复用、two 普通卸载重建。 */
  async function assertNameMatch(props: KeepAliveProps) {
    const outerRef = ref(true)
    const viewRef = ref('one')
    const App = {
      /** 渲染outerRef.value决定KeepAlive节点（props；渲染函数：views[viewRef.value]节点）或null。 */
      render() {
        return outerRef.value
          ? h(KeepAlive, props, () => h(views[viewRef.value]))
          : null
      },
    }
    render(h(App), root)

    expect(serializeInner(root)).toBe(`<div>one</div>`)
    assertHookCalls(one, [1, 1, 1, 0, 0])
    assertHookCalls(two, [0, 0, 0, 0, 0])

    viewRef.value = 'two'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 1, 1, 0])
    assertHookCalls(two, [1, 1, 0, 0, 0])

    viewRef.value = 'one'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>one</div>`)
    assertHookCalls(one, [1, 1, 2, 1, 0])
    assertHookCalls(two, [1, 1, 0, 0, 1])

    viewRef.value = 'two'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 2, 2, 0])
    assertHookCalls(two, [2, 2, 0, 0, 1])

    // 卸载整棵 fixture。
    outerRef.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 2, 2, 1])
    assertHookCalls(two, [2, 2, 0, 0, 2])
  }

  /** 使用带 g 标志的 include 正则，连续访问 one/oneTest/two；断言两个匹配名字稳定缓存，two 每次普通重建及最终清理。 */
  async function assertNameMatchWithFlag(props: KeepAliveProps) {
    const outerRef = ref(true)
    const viewRef = ref('one')
    const App = {
      /** 渲染outerRef.value决定KeepAlive节点（props；渲染函数：views[viewRef.value]节点）或null。 */
      render() {
        return outerRef.value
          ? h(KeepAlive, props, () => h(views[viewRef.value]))
          : null
      },
    }
    render(h(App), root)

    expect(serializeInner(root)).toBe(`<div>one</div>`)
    assertHookCalls(one, [1, 1, 1, 0, 0])
    assertHookCalls(oneTest, [0, 0, 0, 0, 0])
    assertHookCalls(two, [0, 0, 0, 0, 0])

    viewRef.value = 'oneTest'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>oneTest</div>`)
    assertHookCalls(one, [1, 1, 1, 1, 0])
    assertHookCalls(oneTest, [1, 1, 1, 0, 0])
    assertHookCalls(two, [0, 0, 0, 0, 0])

    viewRef.value = 'two'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 1, 1, 0])
    assertHookCalls(oneTest, [1, 1, 1, 1, 0])
    assertHookCalls(two, [1, 1, 0, 0, 0])

    viewRef.value = 'one'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>one</div>`)
    assertHookCalls(one, [1, 1, 2, 1, 0])
    assertHookCalls(oneTest, [1, 1, 1, 1, 0])
    assertHookCalls(two, [1, 1, 0, 0, 1])

    viewRef.value = 'oneTest'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>oneTest</div>`)
    assertHookCalls(one, [1, 1, 2, 2, 0])
    assertHookCalls(oneTest, [1, 1, 2, 1, 0])
    assertHookCalls(two, [1, 1, 0, 0, 1])

    viewRef.value = 'two'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 2, 2, 0])
    assertHookCalls(oneTest, [1, 1, 2, 2, 0])
    assertHookCalls(two, [2, 2, 0, 0, 1])

    // 卸载整棵 fixture。
    outerRef.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [1, 1, 2, 2, 1])
    assertHookCalls(oneTest, [1, 1, 2, 2, 1])
    assertHookCalls(two, [2, 2, 0, 0, 2])
  }

  /** 使用带 g 标志的 exclude 正则，连续访问 one/oneTest/two；断言两个匹配名字稳定排除，two 缓存复用及最终清理。 */
  async function assertNameMatchWithFlagExclude(props: KeepAliveProps) {
    const outerRef = ref(true)
    const viewRef = ref('one')
    const App = {
      /** 渲染outerRef.value决定KeepAlive节点（props；渲染函数：views[viewRef.value]节点）或null。 */
      render() {
        return outerRef.value
          ? h(KeepAlive, props, () => h(views[viewRef.value]))
          : null
      },
    }
    render(h(App), root)

    expect(serializeInner(root)).toBe(`<div>one</div>`)
    assertHookCalls(one, [1, 1, 0, 0, 0])
    assertHookCalls(oneTest, [0, 0, 0, 0, 0])
    assertHookCalls(two, [0, 0, 0, 0, 0])

    viewRef.value = 'oneTest'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>oneTest</div>`)
    assertHookCalls(one, [1, 1, 0, 0, 1])
    assertHookCalls(oneTest, [1, 1, 0, 0, 0])
    assertHookCalls(two, [0, 0, 0, 0, 0])

    viewRef.value = 'two'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [1, 1, 0, 0, 1])
    assertHookCalls(oneTest, [1, 1, 0, 0, 1])
    assertHookCalls(two, [1, 1, 1, 0, 0])

    viewRef.value = 'one'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>one</div>`)
    assertHookCalls(one, [2, 2, 0, 0, 1])
    assertHookCalls(oneTest, [1, 1, 0, 0, 1])
    assertHookCalls(two, [1, 1, 1, 1, 0])

    viewRef.value = 'oneTest'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>oneTest</div>`)
    assertHookCalls(one, [2, 2, 0, 0, 2])
    assertHookCalls(oneTest, [2, 2, 0, 0, 1])
    assertHookCalls(two, [1, 1, 1, 1, 0])

    viewRef.value = 'two'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>two</div>`)
    assertHookCalls(one, [2, 2, 0, 0, 2])
    assertHookCalls(oneTest, [2, 2, 0, 0, 2])
    assertHookCalls(two, [1, 1, 2, 1, 0])

    // 卸载整棵 fixture。
    outerRef.value = false
    await nextTick()
    expect(serializeInner(root)).toBe(`<!---->`)
    assertHookCalls(one, [2, 2, 0, 0, 2])
    assertHookCalls(oneTest, [2, 2, 0, 0, 2])
    assertHookCalls(two, [1, 1, 2, 2, 1])
  }

  // 测试组：KeepAlive 的 include、exclude 与 max props 动态筛选缓存。
  describe('props', () => {
    /** 测试场景：include='one'；共享 helper 往返 one/two 两轮再卸载，one 只创建一次并重复激活，two 离开即卸载、重访重建，核对名字筛选和最终清理。 */
    test('include (string)', async () => {
      await assertNameMatch({ include: 'one' })
    })

    /** 测试场景：include=/^one$/；共享 helper 往返 one/two 两轮再卸载，one 只创建一次并重复激活，two 离开即卸载、重访重建，核对名字筛选和最终清理。 */
    test('include (regex)', async () => {
      await assertNameMatch({ include: /^one$/ })
    })

    /** 测试场景：include=/one/g，连续切换 one、oneTest、two 两轮后整体卸载；前两者都被复用、two 被重建，验证每次正则匹配重置 lastIndex 而非交替漏匹配。 */
    test('include (regex with g flag)', async () => {
      await assertNameMatchWithFlag({ include: /one/g })
    })

    /** 测试场景：include=['one']；共享 helper 往返 one/two 两轮再卸载，one 只创建一次并重复激活，two 离开即卸载、重访重建，核对名字筛选和最终清理。 */
    test('include (array)', async () => {
      await assertNameMatch({ include: ['one'] })
    })

    /** 测试场景：exclude='two'；共享 helper 往返 one/two 两轮再卸载，one 只创建一次并重复激活，two 离开即卸载、重访重建，核对名字筛选和最终清理。 */
    test('exclude (string)', async () => {
      await assertNameMatch({ exclude: 'two' })
    })

    /** 测试场景：exclude=/^two$/；共享 helper 往返 one/two 两轮再卸载，one 只创建一次并重复激活，two 离开即卸载、重访重建，核对名字筛选和最终清理。 */
    test('exclude (regex)', async () => {
      await assertNameMatch({ exclude: /^two$/ })
    })

    /** 测试场景：exclude=/one/g，连续切换 one、oneTest、two 两轮后整体卸载；前两者都普通卸载并重建，two 缓存复用，验证带 g 正则连续排除稳定。 */
    test('exclude (regex with a flag)', async () => {
      await assertNameMatchWithFlagExclude({ exclude: /one/g })
    })

    /** 测试场景：exclude=['two']；共享 helper 往返 one/two 两轮再卸载，one 只创建一次并重复激活，two 离开即卸载、重访重建，核对名字筛选和最终清理。 */
    test('exclude (array)', async () => {
      await assertNameMatch({ exclude: ['two'] })
    })

    /** 测试场景：include='one,two' 且 exclude='two'；共享 helper 往返 one/two 两轮再卸载，one 只创建一次并重复激活，two 离开即卸载、重访重建，核对名字筛选和最终清理。 */
    test('include + exclude', async () => {
      await assertNameMatch({ include: 'one,two', exclude: 'two' })
    })

    /** 测试场景：max=2，依次访问 A→B→C→B→A；C 加入时卸载最旧 A，重访 B 不重建且更新新旧顺序，再回 A 重建并淘汰 C，以四类生命周期计数验证 LRU。 */
    test('max', async () => {
      const spyAC = vi.fn()
      const spyBC = vi.fn()
      const spyCC = vi.fn()
      const spyAA = vi.fn()
      const spyBA = vi.fn()
      const spyCA = vi.fn()
      const spyADA = vi.fn()
      const spyBDA = vi.fn()
      const spyCDA = vi.fn()
      const spyAUM = vi.fn()
      const spyBUM = vi.fn()
      const spyCUM = vi.fn()

      /**
       * 按 A/B/C 各自 created、activated、deactivated、unmounted 顺序读取12项计数，核对容量淘汰与命中缓存刷新顺序。 在此fixture入口检查[
       *           spyAC.mock.calls.length,
       *           spyAA.mock.calls.length,
       *           spyADA.mock.calls.length,
       *           spyAUM.mock.calls.length,
       *           spyBC.mock.calls.length,
       *           spyBA.mock.calls.length,
       *           spyBDA.mock.calls.length,
       *           spyBUM.mock.calls.length,
       *           spyCC.mock.calls.length,
       *           spyCA.mock.calls.length,
       *           spyCDA.mock.calls.length,
       *           spyCUM.mock.calls.length,
       *         ]，失败直接由expect抛出。
       */
      function assertCount(calls: number[]) {
        expect([
          spyAC.mock.calls.length,
          spyAA.mock.calls.length,
          spyADA.mock.calls.length,
          spyAUM.mock.calls.length,
          spyBC.mock.calls.length,
          spyBA.mock.calls.length,
          spyBDA.mock.calls.length,
          spyBUM.mock.calls.length,
          spyCC.mock.calls.length,
          spyCA.mock.calls.length,
          spyCDA.mock.calls.length,
          spyCUM.mock.calls.length,
        ]).toEqual(calls)
      }

      const viewRef = ref('a')
      const views: Record<string, ComponentOptions> = {
        a: {
          /** 渲染`one`。 */
          render: () => `one`,
          created: spyAC,
          activated: spyAA,
          deactivated: spyADA,
          unmounted: spyAUM,
        },
        b: {
          /** 渲染`two`。 */
          render: () => `two`,
          created: spyBC,
          activated: spyBA,
          deactivated: spyBDA,
          unmounted: spyBUM,
        },
        c: {
          /** 渲染`three`。 */
          render: () => `three`,
          created: spyCC,
          activated: spyCA,
          deactivated: spyCDA,
          unmounted: spyCUM,
        },
      }

      const App = {
        /** 渲染KeepAlive节点（属性{max: 2}；渲染函数：views[viewRef.value]节点）。 */
        render() {
          return h(KeepAlive, { max: 2 }, () => {
            return h(views[viewRef.value])
          })
        },
      }
      render(h(App), root)
      assertCount([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])

      viewRef.value = 'b'
      await nextTick()
      assertCount([1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0])

      viewRef.value = 'c'
      await nextTick()
      // 加入 C 达到容量限制，淘汰最旧 A 并真实卸载。
      assertCount([1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0])

      viewRef.value = 'b'
      await nextTick()
      // 重访 B 复用实例，并刷新为最新缓存项。
      assertCount([1, 1, 1, 1, 1, 2, 1, 0, 1, 1, 1, 0])

      viewRef.value = 'a'
      await nextTick()
      // B 刚被使用，C 变为最旧缓存项；重建 A 时淘汰 C。
      assertCount([2, 2, 1, 1, 1, 2, 2, 0, 1, 1, 1, 1])
    })
  })

  // 测试组：缓存失效。
  describe('cache invalidation', () => {
    /** 建立viewRef=ref('one')、includeRef=ref('one,two')。setup返回{viewRef，includeRef}。 */
    function setup() {
      const viewRef = ref('one')
      const includeRef = ref('one,two')
      const App = {
        /** 渲染KeepAlive节点（属性{include: includeRef.value}；渲染函数：views[viewRef.value]节点）。 */
        render() {
          return h(
            KeepAlive,
            {
              include: includeRef.value,
            },
            () => h(views[viewRef.value]),
          )
        },
      }
      render(h(App), root)
      return { viewRef, includeRef }
    }

    /** 挂载初始展示 one、exclude 为空的 KeepAlive，返回视图和排除名单 refs，供动态淘汰场景驱动更新。 */
    function setupExclude() {
      const viewRef = ref('one')
      const excludeRef = ref('')
      const App = {
        /** 渲染KeepAlive节点（属性{exclude: excludeRef.value}；渲染函数：views[viewRef.value]节点）。 */
        render() {
          return h(
            KeepAlive,
            {
              exclude: excludeRef.value,
            },
            () => h(views[viewRef.value]),
          )
        },
      }
      render(h(App), root)
      return { viewRef, excludeRef }
    }

    /** 测试场景：include 初始 one,two，先切 two 停用 one，再缩为 two；one 立即真实卸载，后续切回 one 重新创建且不 activated，two 仅停用。 */
    test('on include change', async () => {
      const { viewRef, includeRef } = setup()

      viewRef.value = 'two'
      await nextTick()
      assertHookCalls(one, [1, 1, 1, 1, 0])
      assertHookCalls(two, [1, 1, 1, 0, 0])

      includeRef.value = 'two'
      await nextTick()
      assertHookCalls(one, [1, 1, 1, 1, 1])
      assertHookCalls(two, [1, 1, 1, 0, 0])

      viewRef.value = 'one'
      await nextTick()
      assertHookCalls(one, [2, 2, 1, 1, 1])
      assertHookCalls(two, [1, 1, 1, 1, 0])
    })

    /** 测试场景：exclude 初始空，先切 two 停用 one，再排除 one；缓存 one 被卸载，切回时普通重建、不 activated，确认动态排除清理。 */
    test('on exclude change', async () => {
      const { viewRef, excludeRef } = setupExclude()

      viewRef.value = 'two'
      await nextTick()
      assertHookCalls(one, [1, 1, 1, 1, 0])
      assertHookCalls(two, [1, 1, 1, 0, 0])

      excludeRef.value = 'one'
      await nextTick()
      assertHookCalls(one, [1, 1, 1, 1, 1])
      assertHookCalls(two, [1, 1, 1, 0, 0])

      viewRef.value = 'one'
      await nextTick()
      assertHookCalls(one, [2, 2, 1, 1, 1])
      assertHookCalls(two, [1, 1, 1, 1, 0])
    })

    /** 测试场景：先缓存 one 并展示 two，同一更新把 include 缩为 one 且切回 one；one 复用激活，two 停用后被淘汰并卸载，验证更新后缓存清理顺序。 */
    test('on include change + view switch', async () => {
      const { viewRef, includeRef } = setup()

      viewRef.value = 'two'
      await nextTick()
      assertHookCalls(one, [1, 1, 1, 1, 0])
      assertHookCalls(two, [1, 1, 1, 0, 0])

      includeRef.value = 'one'
      viewRef.value = 'one'
      await nextTick()
      assertHookCalls(one, [1, 1, 2, 1, 0])
      // two 已不匹配新名单，停用后清理其缓存并卸载。
      assertHookCalls(two, [1, 1, 1, 1, 1])
    })

    /** 测试场景：先缓存 one 并展示 two，同一更新把 exclude 设 two 且切回 one；one 复用激活，离开的 two 先停用后卸载，确认筛选与分支切换共同生效。 */
    test('on exclude change + view switch', async () => {
      const { viewRef, excludeRef } = setupExclude()

      viewRef.value = 'two'
      await nextTick()
      assertHookCalls(one, [1, 1, 1, 1, 0])
      assertHookCalls(two, [1, 1, 1, 0, 0])

      excludeRef.value = 'two'
      viewRef.value = 'one'
      await nextTick()
      assertHookCalls(one, [1, 1, 2, 1, 0])
      // two 已不匹配新名单，停用后清理其缓存并卸载。
      assertHookCalls(two, [1, 1, 1, 1, 1])
    })

    /** 测试场景：当前活动 one 时将 include 缩为 two；one 未立即卸载，切 two 才普通卸载 one 且无 deactivated，验证活动实例只清缓存标志。 */
    test('should not prune current active instance', async () => {
      const { viewRef, includeRef } = setup()

      includeRef.value = 'two'
      await nextTick()
      assertHookCalls(one, [1, 1, 1, 0, 0])
      assertHookCalls(two, [0, 0, 0, 0, 0])

      viewRef.value = 'two'
      await nextTick()
      assertHookCalls(one, [1, 1, 1, 0, 1])
      assertHookCalls(two, [1, 1, 1, 0, 0])
    })

    /** 在命名 one 和匿名 two 间往返，以 created 计数比较 include=one 与无 include 时匿名组件是否缓存。 */
    async function assertAnonymous(include: boolean) {
      const one = {
        name: 'one',
        created: vi.fn(),
        /** 渲染'one'。 */
        render: () => 'one',
      }

      const two = {
        // 此组件故意不声明 name。
        created: vi.fn(),
        /** 渲染'two'。 */
        render: () => 'two',
      }

      const views: any = { one, two }
      const viewRef = ref('one')

      const App = {
        /** 渲染KeepAlive节点（属性{include: include ? 'one' : undefined}；渲染函数：views[viewRef.value]节点）。 */
        render() {
          return h(
            KeepAlive,
            {
              include: include ? 'one' : undefined,
            },
            () => h(views[viewRef.value]),
          )
        },
      }
      render(h(App), root)

      /** 接收one/two各自预期created次数，与两个spy计数比较，判定匿名组件是否真正重建。 在此fixture入口检查one.created.mock.calls.length、two.created.mock.calls.length，失败直接由expect抛出。 */
      function assert(oneCreateCount: number, twoCreateCount: number) {
        expect(one.created.mock.calls.length).toBe(oneCreateCount)
        expect(two.created.mock.calls.length).toBe(twoCreateCount)
      }

      assert(1, 0)

      viewRef.value = 'two'
      await nextTick()
      assert(1, 1)

      viewRef.value = 'one'
      await nextTick()
      assert(1, 1)

      viewRef.value = 'two'
      await nextTick()
      // 指定 include 时匿名 two 无法按名匹配，再次进入应重建；
      // 未指定 include 则按组件类型缓存。
      assert(1, include ? 2 : 1)
    }

    // 2.x #6938
    /** 测试场景：include=one 时在命名 one 与匿名 two 间往返；one created 一次，匿名 two 再次进入 created 第二次，验证无法按名匹配时不缓存。 */
    test('should not cache anonymous component when include is specified', async () => {
      await assertAnonymous(true)
    })

    /** 测试场景：无 include 时在命名 one 与匿名 two 间往返；二者 created 均一次，确认匿名组件可按组件类型缓存。 */
    test('should cache anonymous components if include is not specified', async () => {
      await assertAnonymous(false)
    })

    // 2.x #7105
    /** 测试场景：匿名 Foo 始终为当前子组件，include 从 foo 扩为 foo,bar 再清空；Foo.unmounted 始终未调用，确认筛选变化不提前销毁当前实例。 */
    test('should not destroy active instance when pruning cache', async () => {
      const Foo = {
        /** 渲染'foo'。 */
        render: () => 'foo',
        unmounted: vi.fn(),
      }
      const includeRef = ref(['foo'])
      const App = {
        /** 渲染KeepAlive节点（属性{include: includeRef.value}；渲染函数：Foo节点）。 */
        render() {
          return h(
            KeepAlive,
            {
              include: includeRef.value,
            },
            () => h(Foo),
          )
        },
      }
      render(h(App), root)
      // 保持同一 Foo 为当前活动子组件，只改变 include。
      includeRef.value = ['foo', 'bar']
      await nextTick()
      includeRef.value = []
      await nextTick()
      expect(Foo.unmounted).not.toHaveBeenCalled()
    })

    /** 测试场景：缓存输出数字 props.n 的组件，初始0；隐藏后把 n 增至1再激活，显示1，确认复用节点仍 patch 最新 props。 */
    test('should update re-activated component if props have changed', async () => {
      /** 返回props.n。 */
      const Foo = (props: {
        /** 缓存fixture接收并直接输出的数值prop，重新激活时用于比较最新值。 */
        n: number
      }) => props.n

      const toggle = ref(true)
      const n = ref(0)

      const App = {
        /** setup返回渲染函数：KeepAlive节点（渲染函数：toggle.value决定Foo节点（属性{n: n.value}）或null）。 */
        setup() {
          return () =>
            h(KeepAlive, () => (toggle.value ? h(Foo, { n: n.value }) : null))
        },
      }

      render(h(App), root)
      expect(serializeInner(root)).toBe(`0`)

      toggle.value = false
      await nextTick()
      expect(serializeInner(root)).toBe(`<!---->`)

      n.value++
      await nextTick()
      toggle.value = true
      await nextTick()
      expect(serializeInner(root)).toBe(`1`)
    })
  })

  /** 测试场景：模拟 RouterView 克隆 KeepAlive 子 VNode 并附挂载/卸载钩子，Foo→Bar→Foo 后整体卸载；mounted 累计3，切换 unmounted 累计2，销毁时累计4，核对缓存路径的 VNode 钩子。 */
  it('should call correct vnode hooks', async () => {
    const Foo = markRaw({
      name: 'Foo',
      /** 渲染'Foo'节点。 */
      render() {
        return h('Foo')
      },
    })
    const Bar = markRaw({
      name: 'Bar',
      /** 渲染'Bar'节点。 */
      render() {
        return h('Bar')
      },
    })

    const spyMounted = vi.fn()
    const spyUnmounted = vi.fn()

    const RouterView = defineComponent({
      /** 注入当前component并建立refView；渲染默认插槽得到KeepAlive子树，再克隆内部组件VNode写入ref与mount/unmount hooks。返回修改后的子树，模拟RouterView对缓存VNode的包装。 */
      setup(_, { slots }) {
        const Component = inject<Ref<ComponentPublicInstance>>('component')
        const refView = ref()

        let componentProps = {
          ref: refView,
          /** 累计VNode挂载spy次数，观察KeepAlive首次挂载和再次激活的VNode钩子。 */
          onVnodeMounted() {
            spyMounted()
          },
          /** 累计VNode卸载spy次数，观察停用及最终销毁传递的VNode钩子。 */
          onVnodeUnmounted() {
            spyUnmounted()
          },
        }

        return () => {
          const child: any = slots.default!({
            Component: Component!.value,
          })[0]

          const innerChild = child.children[0]
          child.children[0] = cloneVNode(innerChild, componentProps)
          return child
        }
      },
    })

    /** 初始化外部可调用的空切换函数；App.setup随后用真正切换Foo/Bar的函数覆盖此绑定。 */
    let toggle: () => void = () => {}

    const App = defineComponent({
      /** 建立当前Foo组件ref并provide给RouterView；把外部toggle绑定为Foo/Bar类型切换函数，返回component和toggle供模板读取与调用。 */
      setup() {
        const component = ref(Foo)

        provide('component', component)

        /** 用Foo/Bar的类型身份翻转component ref，供RouterView克隆VNode钩子场景往返缓存分支。 */
        toggle = () => {
          component.value = component.value === Foo ? Bar : Foo
        }
        return {
          component,
          toggle,
        }
      },
      /** 渲染RouterView节点（null；插槽{default回调}）。 */
      render() {
        return h(RouterView, null, {
          /** 提供default插槽：KeepAlive节点（null；根数组[Component节点]）。 */
          default: ({ Component }: any) => h(KeepAlive, null, [h(Component)]),
        })
      },
    })

    render(h(App), root)
    await nextTick()
    expect(spyMounted).toHaveBeenCalledTimes(1)
    expect(spyUnmounted).toHaveBeenCalledTimes(0)

    toggle()
    await nextTick()

    expect(spyMounted).toHaveBeenCalledTimes(2)
    expect(spyUnmounted).toHaveBeenCalledTimes(1)

    toggle()
    await nextTick()
    expect(spyMounted).toHaveBeenCalledTimes(3)
    expect(spyUnmounted).toHaveBeenCalledTimes(2)

    render(null, root)
    await nextTick()
    expect(spyMounted).toHaveBeenCalledTimes(3)
    expect(spyUnmounted).toHaveBeenCalledTimes(4)
  })

  // #1511
  /** 测试场景：App 带 scopeId=foo，缓存 one 并修改 msg，再切 two 和回 one；每次元素均有 foo 且回 one 保留 changed，验证根克隆后的实际 VNode 被缓存。 */
  test('should work with cloned root due to scopeId / fallthrough attrs', async () => {
    const viewRef = ref('one')
    const instanceRef = ref<any>(null)
    const App = {
      __scopeId: 'foo',
      /** 渲染KeepAlive节点（null；插槽{default回调}）。 */
      render: () => {
        return h(KeepAlive, null, {
          /** 提供default插槽：views[viewRef.value]节点（属性{ref: instanceRef}）。 */
          default: () => h(views[viewRef.value], { ref: instanceRef }),
        })
      },
    }
    render(h(App), root)
    expect(serializeInner(root)).toBe(`<div foo>one</div>`)
    instanceRef.value.msg = 'changed'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div foo>changed</div>`)
    viewRef.value = 'two'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div foo>two</div>`)
    viewRef.value = 'one'
    await nextTick()
    expect(serializeInner(root)).toBe(`<div foo>changed</div>`)
  })

  /** 测试场景：include=Foo 的异步 wrapper 初始显示注释，解析命名 Foo 后显示 p0；修改实例 count 并隐藏再激活显示 p1，确认按解析后名称筛选及状态缓存。 */
  test('should work with async component', async () => {
    let resolve: (comp: Component) => void
    const AsyncComp = defineAsyncComponent(
      () =>
        new Promise(r => {
          resolve = r as any
        }),
    )

    const toggle = ref(true)
    const instanceRef = ref<any>(null)
    const App = {
      /** 渲染KeepAlive节点（属性{include: 'Foo'}；渲染函数：toggle.value决定AsyncComp节点（属性{ref: instanceRef}）或null）。 */
      render: () => {
        return h(KeepAlive, { include: 'Foo' }, () =>
          toggle.value ? h(AsyncComp, { ref: instanceRef }) : null,
        )
      },
    }

    render(h(App), root)
    // 异步定义尚未解析，当前为注释占位。
    expect(serializeInner(root)).toBe('<!---->')

    resolve!({
      name: 'Foo',
      /** 初始化组件状态为{count: 0}，供本例渲染和事件更新读取。 */
      data: () => ({ count: 0 }),
      /** 渲染'p'节点（this.count）。 */
      render() {
        return h('p', this.count)
      },
    })

    await timeout()
    // 异步定义已解析并显示内容。
    expect(serializeInner(root)).toBe('<p>0</p>')

    // 修改组件状态并停用。
    instanceRef.value.count++
    toggle.value = false
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // 再次激活，状态应保留。
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('<p>1</p>')
  })

  // #4976
  /** 测试场景：KeepAlive Child 的 onActivated 异步抛 Error(foo)；等待微任务后 app.errorHandler 收到同一错误、实例代理及 activated hook 信息，验证 Promise 拒绝统一处理。 */
  test('handle error in async onActivated', async () => {
    const err = new Error('foo')
    const handler = vi.fn()

    const app = createApp({
      /** setup返回渲染函数：KeepAlive节点（null；渲染函数：Child节点）。 */
      setup() {
        return () => h(KeepAlive, null, () => h(Child))
      },
    })

    const Child = {
      /** 注册onActivated。setup不返回渲染或公开状态。 */
      setup() {
        onActivated(async () => {
          throw err
        })
      },
      /** 提供空根组件，不返回VNode。 */
      render() {},
    }

    app.config.errorHandler = handler
    app.mount(nodeOps.createElement('div'))

    await nextTick()
    expect(handler).toHaveBeenCalledWith(err, {}, 'activated hook')
  })

  // #3648
  /** 测试场景：A 初始不在空 include，挂载时无 activated；将 A 加入 include 后切 B，A 不重建/卸载而 deactivated 一次，验证已挂载实例后来进入缓存。 */
  test('should avoid unmount later included components', async () => {
    const unmountedA = vi.fn()
    const mountedA = vi.fn()
    const activatedA = vi.fn()
    const deactivatedA = vi.fn()
    const unmountedB = vi.fn()
    const mountedB = vi.fn()

    const A = {
      name: 'A',
      /** 注册onMounted；onUnmounted；onActivated；onDeactivated。setup返回渲染函数：'A'。 */
      setup() {
        onMounted(mountedA)
        onUnmounted(unmountedA)
        onActivated(activatedA)
        onDeactivated(deactivatedA)
        return () => 'A'
      },
    }
    const B = {
      name: 'B',
      /** 注册onMounted；onUnmounted。setup返回渲染函数：'B'。 */
      setup() {
        onMounted(mountedB)
        onUnmounted(unmountedB)
        return () => 'B'
      },
    }

    const include = reactive<string[]>([])
    const current = shallowRef(A)
    const app = createApp({
      /** setup返回渲染函数：根数组[KeepAlive节点（属性{include}；current.value节点）]。 */
      setup() {
        return () => {
          return [
            h(
              KeepAlive,
              {
                include,
              },
              h(current.value),
            ),
          ]
        }
      },
    })

    app.mount(root)

    expect(serializeInner(root)).toBe(`A`)
    expect(mountedA).toHaveBeenCalledTimes(1)
    expect(unmountedA).toHaveBeenCalledTimes(0)
    expect(activatedA).toHaveBeenCalledTimes(0)
    expect(deactivatedA).toHaveBeenCalledTimes(0)
    expect(mountedB).toHaveBeenCalledTimes(0)
    expect(unmountedB).toHaveBeenCalledTimes(0)

    include.push('A') // 把已挂载 A 纳入 include。
    await nextTick()
    current.value = B // 切换到 B。
    await nextTick()
    expect(serializeInner(root)).toBe(`B`)
    expect(mountedA).toHaveBeenCalledTimes(1)
    expect(unmountedA).toHaveBeenCalledTimes(0)
    expect(activatedA).toHaveBeenCalledTimes(0)
    expect(deactivatedA).toHaveBeenCalledTimes(1)
    expect(mountedB).toHaveBeenCalledTimes(1)
    expect(unmountedB).toHaveBeenCalledTimes(0)
  })

  // #11717
  /** 测试场景：Home 初始在 include 并已 activated，先删除其名字再切 About；Home unmounted 一次而 deactivated 不调用，确认缓存资格解除后的普通卸载。 */
  test('remove component from include then switching child', async () => {
    const About = {
      name: 'About',
      /** 渲染'h1'节点（'About'）。 */
      render() {
        return h('h1', 'About')
      },
    }
    const mountedHome = vi.fn()
    const unmountedHome = vi.fn()
    const activatedHome = vi.fn()
    const deactivatedHome = vi.fn()
    const Home = {
      name: 'Home',
      /** 注册Home的mounted/unmounted/activated/deactivated spies；返回函数虽然构造h1却未return VNode，实际为空根，此例只检查缓存资格解除后的生命周期。 */
      setup() {
        onMounted(mountedHome)
        onUnmounted(unmountedHome)
        onDeactivated(deactivatedHome)
        onActivated(activatedHome)
        return () => {
          h('h1', 'Home')
        }
      },
    }
    const activeViewName = ref('Home')
    const cacheList = reactive(['Home'])
    const App = createApp({
      /** setup返回渲染函数：根数组[KeepAlive节点（属性{include: cacheList}；根数组[activeViewName.value === 'Home'决定Home节点或About节点]）]。 */
      setup() {
        return () => {
          return [
            h(
              KeepAlive,
              {
                include: cacheList,
              },
              [activeViewName.value === 'Home' ? h(Home) : h(About)],
            ),
          ]
        }
      },
    })
    App.mount(nodeOps.createElement('div'))
    expect(mountedHome).toHaveBeenCalledTimes(1)
    expect(activatedHome).toHaveBeenCalledTimes(1)
    cacheList.splice(0, 1)
    await nextTick()
    activeViewName.value = 'About'
    await nextTick()
    expect(deactivatedHome).toHaveBeenCalledTimes(0)
    expect(unmountedHome).toHaveBeenCalledTimes(1)
  })

  /** 测试场景：异步 Foo 解析并显示 p0 后递增 count，同时隐藏且把 include 替换为同名新数组；再激活仍 p1，验证筛选更新不会误淘汰匹配的异步实例。 */
  test('should work with async component when update `include` props', async () => {
    let resolve: (comp: Component) => void
    const AsyncComp = defineAsyncComponent(
      () =>
        new Promise(r => {
          resolve = r as any
        }),
    )

    const toggle = ref(true)
    const instanceRef = ref<any>(null)
    const keepaliveInclude = ref(['Foo'])
    const App = {
      /** 渲染KeepAlive节点（属性{include: keepaliveInclude.value}；渲染函数：toggle.value决定AsyncComp节点（属性{ref: instanceRef}）或null）。 */
      render: () => {
        return h(KeepAlive, { include: keepaliveInclude.value }, () =>
          toggle.value ? h(AsyncComp, { ref: instanceRef }) : null,
        )
      },
    }

    render(h(App), root)
    // 异步定义尚未解析，当前为注释占位。
    expect(serializeInner(root)).toBe('<!---->')

    resolve!({
      name: 'Foo',
      /** 初始化组件状态为{count: 0}，供本例渲染和事件更新读取。 */
      data: () => ({ count: 0 }),
      /** 渲染'p'节点（this.count）。 */
      render() {
        return h('p', this.count)
      },
    })

    await timeout()
    // 异步定义已解析并显示内容。
    expect(serializeInner(root)).toBe('<p>0</p>')

    // 修改组件状态并停用。 + update `include` props
    instanceRef.value.count++
    toggle.value = false
    keepaliveInclude.value = ['Foo']
    await nextTick()
    expect(serializeInner(root)).toBe('<!---->')

    // 再次激活，状态应保留。
    toggle.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('<p>1</p>')
  })
})
