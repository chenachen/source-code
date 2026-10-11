/**
 * mount 创建可切换的宿主树；mockProps 保存 enter/leave 的 done，由用例手动决定完成时刻。
 * 共享切换用例分别运行于原生元素、组件/HOC 和 KeepAlive，比较取消与 mode 的钩子时序。
 */
import {
  BaseTransition,
  type BaseTransitionProps,
  KeepAlive,
  Teleport,
  type TestElement,
  type VNodeProps,
  h,
  nextTick,
  nodeOps,
  ref,
  render,
  serialize,
  serializeInner,
} from '@vue/runtime-test'

/**
 * 挂载最小 BaseTransition 场景，并返回关闭当前分支的方法。
 * withKeepAlive 用来复用同一套断言覆盖缓存组件路径。
 */
function mount(
  props: BaseTransitionProps<TestElement>,
  slot: () => any,
  withKeepAlive = false,
) {
  const root = nodeOps.createElement('div')
  const show = ref(true)
  /** 将mount fixture的show设false，让下一轮渲染移除整个BaseTransition子树；返回赋值后的false。 */
  const unmount = () => (show.value = false)
  const App = {
    /** 渲染show.value决定BaseTransition节点（props；渲染函数：withKeepAlive决定KeepAlive节点（null；slot()）或slot()）或null。 */
    render() {
      return show.value
        ? h(BaseTransition, props, () => {
            return withKeepAlive ? h(KeepAlive, null, slot()) : slot()
          })
        : null
    },
  }
  render(h(App), root)

  return { root, unmount }
}

/**
 * 创建一组可观测的过渡钩子，并保存 enter/leave 的完成回调。
 * 用例可以手动完成动画，从而精确验证取消、切换和卸载时序。
 */
function mockProps(
  extra: BaseTransitionProps<TestElement> = {},
  withKeepAlive = false,
) {
  const cbs: {
    /** 按元素序列化结果保存入场/首次入场done，由测试显式决定完成时刻。 */
    doneEnter: Record<string, () => void>
    /** 按元素序列化结果保存离场done，由测试显式决定移除时刻。 */
    doneLeave: Record<string, () => void>
  } = {
    doneEnter: {},
    doneLeave: {},
  }
  const props: BaseTransitionProps<TestElement> = {
    onBeforeEnter: vi.fn(el => {
      if (!extra.persisted && !withKeepAlive) {
        expect(el.parentNode).toBeNull()
      }
    }),
    onEnter: vi.fn((el, done) => {
      cbs.doneEnter[serialize(el as TestElement)] = done
    }),
    onAfterEnter: vi.fn<(el: TestElement) => void>(),
    onEnterCancelled: vi.fn<(el: TestElement) => void>(),
    onBeforeLeave: vi.fn<(el: TestElement) => void>(),
    onLeave: vi.fn((el, done) => {
      cbs.doneLeave[serialize(el as TestElement)] = done
    }),
    onAfterLeave: vi.fn<(el: TestElement) => void>(),
    onLeaveCancelled: vi.fn<(el: TestElement) => void>(),
    onBeforeAppear: vi.fn<(el: TestElement) => void>(),
    onAppear: vi.fn((el, done) => {
      cbs.doneEnter[serialize(el as TestElement)] = done
    }),
    onAfterAppear: vi.fn<(el: TestElement) => void>(),
    onAppearCancelled: vi.fn<(el: TestElement) => void>(),
    ...extra,
  }
  return {
    props,
    cbs,
  }
}

/** 按钩子名批量断言调用次数，突出用例关注的生命周期差异。 */
function assertCalls(
  props: BaseTransitionProps<TestElement>,
  calls: Record<string, number>,
) {
  Object.keys(calls).forEach(key => {
    expect(props[key as keyof BaseTransitionProps]).toHaveBeenCalledTimes(
      calls[key],
    )
  })
}

/** 断言某次过渡钩子接收到的测试元素具有预期序列化结构。 */
function assertCalledWithEl(fn: any, expected: string, callIndex = 0) {
  expect(serialize(fn.mock.calls[callIndex][0])).toBe(expected)
}

/** 在两个分支间切换时，公共测试逻辑所需的 VNode 工厂和期望 DOM。 */
interface ToggleOptions {
  /** toggle为true时创建VNode的工厂，每次切换调用产生分支输入。 */
  trueBranch: () => any
  /** toggle为false时创建VNode或空分支的工厂。 */
  falseBranch: () => any
  /** true分支的预期宿主序列化文本，同时作为done回调记录键。 */
  trueSerialized: string
  /** false分支的预期宿主序列化文本，同时作为done回调记录键。 */
  falseSerialized: string
}

/** 可复用于原生元素、组件和 KeepAlive 分支的过渡测试函数签名。 */
type TestFn = (o: ToggleOptions, withKeepAlive?: boolean) => void

/** 把div/span分支工厂及预期空标签文本传给tester，返回该过渡测试的Promise；同一时序测试由此覆盖原生元素根。 */
function runTestWithElements(tester: TestFn) {
  return tester({
    /** 返回'div'节点。 */
    trueBranch: () => h('div'),
    /** 返回'span'节点。 */
    falseBranch: () => h('span'),
    trueSerialized: `<div></div>`,
    falseSerialized: `<span></span>`,
  })
}

/** 把输出foo div与bar span的组件分支及预期文本传给tester，返回测试Promise；B经C透传msg，用于覆盖高阶组件根。 */
function runTestWithComponents(tester: TestFn) {
  /** 读取msg并输出div文本，作为true分支的组件根。 */
  const CompA = ({
    msg
  }: {
    /** 过渡fixture组件接收并渲染到div/span的字符串内容。 */
    msg: string
  }) => h('div', msg)
  // 用 HOC 包装一层组件。
  /** 把msg透传给CompC，高阶组件自身不创建宿主元素。 */
  const CompB = ({
    msg
  }: {
    /** 过渡fixture组件接收并渲染到div/span的字符串内容。 */
    msg: string
  }) => h(CompC, { msg })
  /** 读取msg并输出span文本，提供高阶组件最终的宿主根。 */
  const CompC = ({
    msg
  }: {
    /** 过渡fixture组件接收并渲染到div/span的字符串内容。 */
    msg: string
  }) => h('span', msg)
  return tester({
    /** 返回CompA节点（属性{msg: 'foo'}）。 */
    trueBranch: () => h(CompA, { msg: 'foo' }),
    /** 返回CompB节点（属性{msg: 'bar'}）。 */
    falseBranch: () => h(CompB, { msg: 'bar' }),
    trueSerialized: `<div>foo</div>`,
    falseSerialized: `<span>bar</span>`,
  })
}

/** 返回tester( { trueBranch: () => h(trueComp), falseBranch: () => h(falseComp), trueSerialized: `<div>0</div>`, falseSerialized: `<span>0</span>`, }, true , )。 */
function runTestWithKeepAlive(tester: TestFn) {
  const trueComp = {
    /** 建立count=ref(0)。setup返回渲染函数：'div'节点（count.value）。 */
    setup() {
      const count = ref(0)
      return () => h('div', count.value)
    },
  }
  const falseComp = {
    /** 建立count=ref(0)。setup返回渲染函数：'span'节点（count.value）。 */
    setup() {
      const count = ref(0)
      return () => h('span', count.value)
    },
  }
  return tester(
    {
      /** 返回trueComp节点。 */
      trueBranch: () => h(trueComp),
      /** 返回falseComp节点。 */
      falseBranch: () => h(falseComp),
      trueSerialized: `<div>0</div>`,
      falseSerialized: `<span>0</span>`,
    },
    true /* withKeepAlive=true：测试缓存组件路径 */,
  )
}

// 测试组：BaseTransition 的 enter/leave/appear 钩子、模式切换与取消时序。
describe('BaseTransition', () => {
  /** 测试场景：首次挂载 div 并开启 appear，分别提供 appear/enter 钩子；只触发 beforeAppear、appear，手动 done 后触发 afterAppear，普通 enter 钩子始终未调用。 */
  test('appear: true w/ appear hooks', () => {
    const { props, cbs } = mockProps({
      appear: true,
    })
    mount(props, () => h('div'))
    expect(props.onBeforeAppear).toHaveBeenCalledTimes(1)
    expect(props.onAppear).toHaveBeenCalledTimes(1)
    expect(props.onAfterAppear).not.toHaveBeenCalled()

    // 首次挂载走 appear，普通 enter 钩子未调用。
    expect(props.onBeforeEnter).not.toHaveBeenCalled()
    expect(props.onEnter).not.toHaveBeenCalled()
    expect(props.onAfterEnter).not.toHaveBeenCalled()

    cbs.doneEnter[`<div></div>`]()
    expect(props.onAfterAppear).toHaveBeenCalledTimes(1)
    expect(props.onAfterEnter).not.toHaveBeenCalled()
  })

  /** 测试场景：首次挂载 div 开启 appear 但未提供 appear 钩子；回退到 beforeEnter/enter，手动 done 才触发 afterEnter，确认首次入场的钩子回退。 */
  test('appear: true w/ fallback to enter hooks', () => {
    const { props, cbs } = mockProps({
      appear: true,
      onBeforeAppear: undefined,
      onAppear: undefined,
      onAfterAppear: undefined,
      onAppearCancelled: undefined,
    })
    mount(props, () => h('div'))
    expect(props.onBeforeEnter).toHaveBeenCalledTimes(1)
    expect(props.onEnter).toHaveBeenCalledTimes(1)
    expect(props.onAfterEnter).not.toHaveBeenCalled()
    cbs.doneEnter[`<div></div>`]()
    expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
  })

  // 测试组：persisted=true，由调用方控制显示切换。
  describe('persisted: true', () => {
    // 用 VNode 钩子模拟 v-show 主动调用 persisted 过渡的协议，
    // 这里维护可观察 show 状态，不操作真实 display。
    /** 用 VNode 挂载/更新钩子模拟 persisted 显示协议：id 改变时主动调用 transition；leave 完成才写 state.show=false，入场先恢复为 true。返回 toggle、可观察状态及钩子，不操作 DOM display。 */
    function mockPersistedHooks() {
      const state = { show: true }
      const toggle = ref(true)
      const hooks: VNodeProps = {
        /** 由persisted显示控制方主动在宿主插入前调用beforeEnter，渲染器不自动处理该过渡。 */
        onVnodeBeforeMount(vnode) {
          vnode.transition!.beforeEnter(vnode.el!)
        },
        /** 由persisted显示控制方在宿主挂载后主动调用enter，done由mockProps保存。 */
        onVnodeMounted(vnode) {
          vnode.transition!.enter(vnode.el!)
        },
        /** 只在id真值改变时处理显示：入场先beforeEnter再show=true/enter，离场在leave完成回调里才show=false；其他更新不触发。 */
        onVnodeUpdated(vnode, oldVnode) {
          if (oldVnode.props!.id !== vnode.props!.id) {
            if (vnode.props!.id) {
              vnode.transition!.beforeEnter(vnode.el!)
              state.show = true
              vnode.transition!.enter(vnode.el!)
            } else {
              vnode.transition!.leave(vnode.el!, () => {
                state.show = false
              })
            }
          }
        },
      }
      return { state, toggle, hooks }
    }

    /** 测试场景：persisted div 用 id 更新模拟显示协议，首次挂载不开 appear；false 更新仅开始 leave，done 前 state.show 仍为 true，done 后变 false；再设 true 立即恢复 show 并等待 enter done。 */
    test('w/ appear: false', async () => {
      const { props, cbs } = mockProps({ persisted: true })
      const { toggle, state, hooks } = mockPersistedHooks()

      mount(props, () => h('div', { id: toggle.value, ...hooks }))
      // 未开启 appear，首次挂载不调用 enter 钩子。
      expect(props.onBeforeEnter).not.toHaveBeenCalled()
      expect(props.onEnter).not.toHaveBeenCalled()
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      toggle.value = false
      await nextTick()
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(1)
      expect(props.onLeave).toHaveBeenCalledTimes(1)
      expect(props.onAfterLeave).not.toHaveBeenCalled()
      expect(state.show).toBe(true) // leave 尚未完成，show 仍为 true。
      cbs.doneLeave[`<div id=false></div>`]()
      expect(state.show).toBe(false) // leave 完成后 show 变为 false。
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)

      toggle.value = true
      await nextTick()
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(1)
      expect(props.onEnter).toHaveBeenCalledTimes(1)
      expect(props.onAfterEnter).not.toHaveBeenCalled()
      expect(state.show).toBe(true) // 开始 enter 前已恢复 show=true。
      cbs.doneEnter[`<div id=true></div>`]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
    })

    /** 测试场景：persisted div 在首次挂载开启 appear；VNode 钩子主动调用过渡，验证 appear 钩子开始但 afterAppear 等待手动 done，未检查真实 CSS display。 */
    test('w/ appear: true', () => {
      const { props, cbs } = mockProps({ persisted: true, appear: true })
      const { hooks } = mockPersistedHooks()
      mount(props, () => h('div', hooks))

      expect(props.onBeforeAppear).toHaveBeenCalledTimes(1)
      expect(props.onAppear).toHaveBeenCalledTimes(1)
      expect(props.onAfterAppear).not.toHaveBeenCalled()
      cbs.doneEnter[`<div></div>`]()
      expect(props.onAfterAppear).toHaveBeenCalledTimes(1)
    })

    // #14031
    /** 测试场景：persisted A 在 KeepAlive 中与 B 切换再切回；首次挂载、停用搬入存储容器和激活搬回都不自动调用 enter/leave，显示控制仍归 VNode 钩子协议。 */
    test('w/ KeepAlive activate/deactivate should not call enter/leave hooks', async () => {
      const { props } = mockProps({ persisted: true })
      const { hooks } = mockPersistedHooks()
      const which = ref<'A' | 'B'>('A')
      const CompA = {
        name: 'CompA',
        /** 渲染'div'节点（属性{id: 'A'，...hooks}）。 */
        render: () => h('div', { id: 'A', ...hooks }),
      }
      const CompB = {
        name: 'CompB',
        /** 渲染'span'节点（属性{id: 'B'}）。 */
        render: () => h('span', { id: 'B' }),
      }
      const root = nodeOps.createElement('div')
      const App = {
        /** 渲染BaseTransition节点（props；渲染函数：KeepAlive节点（null；which.value === 'A'决定CompA节点或CompB节点））。 */
        render() {
          return h(BaseTransition, props, () =>
            h(KeepAlive, null, which.value === 'A' ? h(CompA) : h(CompB)),
          )
        },
      }
      render(h(App), root)

      // 首次挂载 persisted 节点，渲染器不自动执行 enter。
      expect(props.onBeforeEnter).not.toHaveBeenCalled()
      expect(props.onEnter).not.toHaveBeenCalled()
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      // 切到 B 时 A 停用并移入存储容器；
      // A 的 div 是 persisted 过渡，搬运不自动执行 leave。
      which.value = 'B'
      await nextTick()
      expect(props.onBeforeLeave).not.toHaveBeenCalled()
      expect(props.onLeave).not.toHaveBeenCalled()
      expect(props.onAfterLeave).not.toHaveBeenCalled()

      // 切回 A 时从存储容器搬回并激活；
      // persisted 过渡仍不自动执行 enter。
      which.value = 'A'
      await nextTick()
      expect(props.onBeforeEnter).not.toHaveBeenCalled()
      expect(props.onEnter).not.toHaveBeenCalled()
      expect(props.onAfterEnter).not.toHaveBeenCalled()
    })
  })

  // 测试组：切换开关。
  describe('toggle on-off', () => {
    /** 接收可见/隐藏分支工厂，依次切换 false、true 并手动结束离场/入场；断言占位立即挂载、旧节点延迟移除及每种钩子的元素和次数。 */
    async function testToggleOnOff(
      {
        trueBranch,
        trueSerialized,
        falseBranch,
        falseSerialized,
      }: ToggleOptions,
      mode?: BaseTransitionProps['mode'],
    ) {
      const toggle = ref(true)
      const { props, cbs } = mockProps({ mode })
      const { root } = mount(props, () =>
        toggle.value ? trueBranch() : falseBranch(),
      )

      // 未开启 appear，首次挂载不调用 enter 钩子。
      expect(props.onBeforeEnter).not.toHaveBeenCalled()
      expect(props.onEnter).not.toHaveBeenCalled()
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      toggle.value = false
      await nextTick()
      // 空分支的注释立即插入，不等待旧节点 leave。
      expect(serializeInner(root)).toBe(`${trueSerialized}${falseSerialized}`)
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeLeave, trueSerialized)
      expect(props.onLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onLeave, trueSerialized)
      expect(props.onAfterLeave).not.toHaveBeenCalled()
      cbs.doneLeave[trueSerialized]()
      expect(serializeInner(root)).toBe(falseSerialized)
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterLeave, trueSerialized)

      toggle.value = true
      await nextTick()
      expect(serializeInner(root)).toBe(trueSerialized)
      // beforeEnter spy 检查新宿主尚无 parentNode。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeEnter, trueSerialized)
      expect(props.onEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onEnter, trueSerialized)
      expect(props.onAfterEnter).not.toHaveBeenCalled()
      cbs.doneEnter[trueSerialized]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterEnter, trueSerialized)

      assertCalls(props, {
        onBeforeEnter: 1,
        onEnter: 1,
        onAfterEnter: 1,
        onEnterCancelled: 0,
        onBeforeLeave: 1,
        onLeave: 1,
        onAfterLeave: 1,
        onLeaveCancelled: 0,
      })
    }

    /** 测试场景：原生 div 与注释从显示切到隐藏再显示；注释立即进入，旧节点保留至 leave done，重新显示后 afterEnter 等待 enter done；各入离场一轮且无取消。 */
    test('w/ element', async () => {
      await testToggleOnOff({
        /** 返回'div'节点。 */
        trueBranch: () => h('div'),
        trueSerialized: `<div></div>`,
        /** 返回null。 */
        falseBranch: () => null,
        falseSerialized: `<!---->`,
      })
    })

    /** 测试场景：返回 div 的组件与注释从显示切到隐藏再显示；注释立即进入，旧节点保留至 leave done，重新显示后 afterEnter 等待 enter done；各入离场一轮且无取消。 */
    test('w/ component', async () => {
      /** 返回'div'节点（msg）。 */
      const Comp = ({
        msg
      }: {
        /** 过渡fixture组件接收并渲染到div/span的字符串内容。 */
        msg: string
      }) => h('div', msg)
      await testToggleOnOff({
        /** 返回Comp节点（属性{msg: 'hello'}）。 */
        trueBranch: () => h(Comp, { msg: 'hello' }),
        trueSerialized: `<div>hello</div>`,
        /** 返回null。 */
        falseBranch: () => null,
        falseSerialized: `<!---->`,
      })
    })

    /** 测试场景：in-out 模式下原生 div 与注释从显示切到隐藏再显示；注释立即进入，旧节点保留至 leave done，重新显示后 afterEnter 等待 enter done；各入离场一轮且无取消。 */
    test('w/ mode: "in-out', async () => {
      await testToggleOnOff(
        {
          /** 返回'div'节点。 */
          trueBranch: () => h('div'),
          trueSerialized: `<div></div>`,
          /** 返回null。 */
          falseBranch: () => null,
          falseSerialized: `<!---->`,
        },
        'in-out',
      )
    })
  })

  // 测试组：过渡尚未完成便反向切换时，旧钩子取消和新钩子衔接正确。
  describe('toggle on-off before finish', () => {
    /** 从注释分支入场后快速隐藏并再次显示，验证 enter 取消、旧 done 幂等、同 type/key 旧节点提前移除与新入场的完成顺序。 在此fixture入口检查serializeInner(root)、props.onBeforeEnter、props.onEnter、serializeInner(root)、props.onEnterCancelled、props.onBeforeLeave、props.onLeave、props.onAfterLeave、props.onAfterEnter、props.onBeforeEnter、props.onEnter、serializeInner(root)、props.onAfterLeave、props.onAfterLeave、props.onAfterEnter，失败直接由expect抛出。 */
    async function testToggleOnOffBeforeFinish({
      trueBranch,
      trueSerialized,
      falseBranch = () => null,
      falseSerialized = `<!---->`,
    }: ToggleOptions) {
      const toggle = ref(false)
      const { props, cbs } = mockProps()
      const { root } = mount(props, () =>
        toggle.value ? trueBranch() : falseBranch(),
      )

      // 开始入场。
      toggle.value = true
      await nextTick()
      expect(serializeInner(root)).toBe(trueSerialized)
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(1)
      expect(props.onEnter).toHaveBeenCalledTimes(1)

      // 入场尚未完成就切换为离场。
      toggle.value = false
      await nextTick()
      expect(serializeInner(root)).toBe(`${trueSerialized}${falseSerialized}`)
      expect(props.onEnterCancelled).toHaveBeenCalled()
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(1)
      expect(props.onLeave).toHaveBeenCalledTimes(1)
      expect(props.onAfterLeave).not.toHaveBeenCalled()
      // 取消后再次调用旧 doneEnter 不再产生副作用。
      cbs.doneEnter[trueSerialized]()
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      // 离场尚未完成就再次入场。
      toggle.value = true
      await nextTick()
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(2)
      expect(props.onEnter).toHaveBeenCalledTimes(2)
      // 同 type/key 的旧离场 div 提前移除，只保留新 div；
      // 隐藏分支的注释占位也被替换。
      expect(serializeInner(root)).toBe(trueSerialized)
      // 旧副本走提前移除而非 leave 取消，
      // 因此调用 onAfterLeave，不调用 onLeaveCancelled。
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      // 已完成后旧 doneLeave 再调用无效。
      cbs.doneLeave[trueSerialized]()
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      cbs.doneEnter[trueSerialized]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)

      assertCalls(props, {
        onBeforeEnter: 2,
        onEnter: 2,
        onAfterEnter: 1,
        onEnterCancelled: 1,
        onBeforeLeave: 1,
        onLeave: 1,
        onAfterLeave: 1,
        onLeaveCancelled: 0,
      })
    }

    /** 测试场景：原生 div 与注释初始隐藏，显示后未完成 enter 就隐藏，旧 enter 被取消且迟到 done 无效；离场未完又显示时提前移除旧副本并完成 afterLeave，再完成新 enter。 */
    test('w/ element', async () => {
      await testToggleOnOffBeforeFinish({
        /** 返回'div'节点。 */
        trueBranch: () => h('div'),
        trueSerialized: `<div></div>`,
        /** 返回null。 */
        falseBranch: () => null,
        falseSerialized: `<!---->`,
      })
    })

    /** 测试场景：返回 div 的组件与注释初始隐藏，显示后未完成 enter 就隐藏，旧 enter 被取消且迟到 done 无效；离场未完又显示时提前移除旧副本并完成 afterLeave，再完成新 enter。 */
    test('w/ component', async () => {
      /** 返回'div'节点（msg）。 */
      const Comp = ({
        msg
      }: {
        /** 过渡fixture组件接收并渲染到div/span的字符串内容。 */
        msg: string
      }) => h('div', msg)
      await testToggleOnOffBeforeFinish({
        /** 返回Comp节点（属性{msg: 'hello'}）。 */
        trueBranch: () => h(Comp, { msg: 'hello' }),
        trueSerialized: `<div>hello</div>`,
        /** 返回null。 */
        falseBranch: () => null,
        falseSerialized: `<!---->`,
      })
    })
  })

  // 测试组：在分支之间切换。
  describe('toggle between branches', () => {
    /** 两轮切换不同分支，分别先完成 enter 和先完成 leave；比较共存宿主结构、钩子参数和最终只保留活动节点的状态。 在此fixture入口检查props.onBeforeEnter、props.onEnter、props.onAfterEnter、serializeInner(root)、props.onBeforeLeave、props.onLeave、props.onAfterLeave、props.onBeforeEnter、props.onEnter、props.onAfterEnter、serializeInner(root)、props.onAfterEnter、props.onAfterLeave、serializeInner(root)、props.onAfterLeave、serializeInner(root)、props.onBeforeLeave、props.onLeave、props.onAfterLeave、props.onBeforeEnter、props.onEnter、props.onAfterEnter、serializeInner(root)、props.onAfterLeave、props.onAfterEnter、serializeInner(root)、props.onAfterEnter，失败直接由expect抛出。 */
    async function testToggleBranches(
      {
        trueBranch,
        falseBranch,
        trueSerialized,
        falseSerialized,
      }: ToggleOptions,
      withKeepAlive = false,
    ) {
      const toggle = ref(true)
      const { props, cbs } = mockProps({}, withKeepAlive)
      const { root } = mount(
        props,
        () => (toggle.value ? trueBranch() : falseBranch()),
        withKeepAlive,
      )

      // 未开启 appear，首次挂载不调用 enter 钩子。
      expect(props.onBeforeEnter).not.toHaveBeenCalled()
      expect(props.onEnter).not.toHaveBeenCalled()
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      // 切换到另一分支。
      toggle.value = false
      await nextTick()
      expect(serializeInner(root)).toBe(`${trueSerialized}${falseSerialized}`)
      // 旧分支开始 leave。
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeLeave, trueSerialized)
      expect(props.onLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onLeave, trueSerialized)
      expect(props.onAfterLeave).not.toHaveBeenCalled()
      // 新分支同时开始 enter。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeEnter, falseSerialized)
      expect(props.onEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onEnter, falseSerialized)
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      // 手动完成 enter。
      cbs.doneEnter[falseSerialized]()
      expect(serializeInner(root)).toBe(`${trueSerialized}${falseSerialized}`)
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterEnter, falseSerialized)
      expect(props.onAfterLeave).not.toHaveBeenCalled()
      // 手动完成 leave。
      cbs.doneLeave[trueSerialized]()
      expect(serializeInner(root)).toBe(`${falseSerialized}`)
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterLeave, trueSerialized)

      // 再次切换分支。
      toggle.value = true
      await nextTick()
      expect(serializeInner(root)).toBe(`${falseSerialized}${trueSerialized}`)
      // 旧分支开始 leave。
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onBeforeLeave, falseSerialized, 1)
      expect(props.onLeave).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onLeave, falseSerialized, 1)
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      // 新分支同时开始 enter。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onBeforeEnter, trueSerialized, 1)
      expect(props.onEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onEnter, trueSerialized, 1)
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)

      // 手动完成 leave。 first
      cbs.doneLeave[falseSerialized]()
      expect(serializeInner(root)).toBe(`${trueSerialized}`)
      expect(props.onAfterLeave).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onAfterLeave, falseSerialized, 1)
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
      // 手动完成 enter。
      cbs.doneEnter[trueSerialized]()
      expect(serializeInner(root)).toBe(`${trueSerialized}`)
      expect(props.onAfterEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onAfterEnter, trueSerialized, 1)

      assertCalls(props, {
        onBeforeEnter: 2,
        onEnter: 2,
        onAfterEnter: 2,
        onBeforeLeave: 2,
        onLeave: 2,
        onAfterLeave: 2,
        onEnterCancelled: 0,
        onLeaveCancelled: 0,
      })
    }

    /** 测试场景：div/span 元素：先切 false 并先完成 enter 再完成 leave，再切 true 并反转完成顺序；新旧节点暂时共存，最终只留新分支，两轮钩子完整且无取消。 */
    test('w/ elements', async () => {
      await runTestWithElements(testToggleBranches)
    })

    /** 测试场景：普通组件与 HOC 组件：先切 false 并先完成 enter 再完成 leave，再切 true 并反转完成顺序；新旧节点暂时共存，最终只留新分支，两轮钩子完整且无取消。 */
    test('w/ components', async () => {
      await runTestWithComponents(testToggleBranches)
    })

    /** 测试场景：KeepAlive 缓存的 div/span 组件：先切 false 并先完成 enter 再完成 leave，再切 true 并反转完成顺序；新旧节点暂时共存，最终只留新分支，两轮钩子完整且无取消。 */
    test('w/ KeepAlive', async () => {
      await runTestWithKeepAlive(testToggleBranches)
    })
  })

  // 测试组：完成前在分支之间切换。
  describe('toggle between branches before finish', () => {
    /** 连续反向切换三次后才完成过渡，分别断言普通副本提前移除与 KeepAlive 节点复用取消离场的差异，并检查过期 done 无效。 */
    async function testToggleBranchesBeforeFinish(
      {
        trueBranch,
        falseBranch,
        trueSerialized,
        falseSerialized,
      }: ToggleOptions,
      withKeepAlive = false,
    ) {
      const toggle = ref(true)
      const { props, cbs } = mockProps({}, withKeepAlive)
      const { root } = mount(
        props,
        () => (toggle.value ? trueBranch() : falseBranch()),
        withKeepAlive,
      )

      // 切换到另一分支。
      toggle.value = false
      await nextTick()
      expect(serializeInner(root)).toBe(`${trueSerialized}${falseSerialized}`)
      // 旧分支开始 leave。
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeLeave, trueSerialized)
      expect(props.onLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onLeave, trueSerialized)
      expect(props.onAfterLeave).not.toHaveBeenCalled()
      // 新分支同时开始 enter。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeEnter, falseSerialized)
      expect(props.onEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onEnter, falseSerialized)
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      // 再次切换分支。 before transition finishes
      toggle.value = true
      await nextTick()
      // 普通节点旧 true 副本提前移除；KeepAlive 路径复用节点并取消 leave。
      expect(serializeInner(root)).toBe(`${falseSerialized}${trueSerialized}`)
      if (!withKeepAlive) {
        expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
        assertCalledWithEl(props.onAfterLeave, trueSerialized)
      } else {
        expect(props.onLeaveCancelled).toHaveBeenCalledTimes(1)
        assertCalledWithEl(props.onLeaveCancelled, trueSerialized)
      }
      // false 分支 enter 被取消。
      expect(props.onEnterCancelled).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onEnterCancelled, falseSerialized)
      // 调用已取消 false 的旧 enter done 不再影响状态。
      cbs.doneEnter[falseSerialized]()
      expect(props.onAfterEnter).not.toHaveBeenCalled()
      // false 分支开始 leave。
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onBeforeLeave, falseSerialized, 1)
      expect(props.onLeave).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onLeave, falseSerialized, 1)
      // true 分支开始 enter。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onBeforeEnter, trueSerialized, 1)
      expect(props.onEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onEnter, trueSerialized, 1)
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      // 再次切换分支。
      toggle.value = false
      await nextTick()
      // 普通节点旧 false 副本提前移除；KeepAlive 路径复用节点并取消 leave。
      expect(serializeInner(root)).toBe(`${trueSerialized}${falseSerialized}`)
      if (!withKeepAlive) {
        expect(props.onAfterLeave).toHaveBeenCalledTimes(2)
        assertCalledWithEl(props.onAfterLeave, falseSerialized, 1)
      } else {
        expect(props.onLeaveCancelled).toHaveBeenCalledTimes(2)
        assertCalledWithEl(props.onLeaveCancelled, falseSerialized, 1)
      }
      // true 分支 enter 被取消。
      expect(props.onEnterCancelled).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onEnterCancelled, trueSerialized, 1)
      // 已取消 true 的旧 enter done 不再影响状态。
      cbs.doneEnter[trueSerialized]()
      expect(props.onAfterEnter).not.toHaveBeenCalled()
      // true 分支再次开始 leave。
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(3)
      assertCalledWithEl(props.onBeforeLeave, trueSerialized, 2)
      expect(props.onLeave).toHaveBeenCalledTimes(3)
      assertCalledWithEl(props.onLeave, trueSerialized, 2)
      // false 分支再次开始 enter。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(3)
      assertCalledWithEl(props.onBeforeEnter, falseSerialized, 2)
      expect(props.onEnter).toHaveBeenCalledTimes(3)
      assertCalledWithEl(props.onEnter, falseSerialized, 2)
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      cbs.doneEnter[falseSerialized]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterEnter, falseSerialized)

      cbs.doneLeave[trueSerialized]()
      if (!withKeepAlive) {
        expect(props.onAfterLeave).toHaveBeenCalledTimes(3)
        assertCalledWithEl(props.onAfterLeave, trueSerialized, 2)
      } else {
        expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
        assertCalledWithEl(props.onAfterLeave, trueSerialized)
      }

      assertCalls(props, {
        onBeforeEnter: 3,
        onEnter: 3,
        onAfterEnter: 1,
        onEnterCancelled: 2,
        onBeforeLeave: 3,
        onLeave: 3,
        onAfterLeave: withKeepAlive ? 1 : 3,
        onLeaveCancelled: withKeepAlive ? 2 : 0,
      })
    }

    /** 测试场景：div/span 元素：在过渡未完时 true→false→true→false；两次 enter 被取消，迟到 done 不改变最终节点；同 type/key 的旧副本提前移除并完成 afterLeave，leave 不按取消结算。 */
    test('w/ elements', async () => {
      await runTestWithElements(testToggleBranchesBeforeFinish)
    })

    /** 测试场景：普通组件与 HOC 组件：在过渡未完时 true→false→true→false；两次 enter 被取消，迟到 done 不改变最终节点；同 type/key 的旧副本提前移除并完成 afterLeave，leave 不按取消结算。 */
    test('w/ components', async () => {
      await runTestWithComponents(testToggleBranchesBeforeFinish)
    })

    /** 测试场景：KeepAlive 缓存的 div/span 组件：在过渡未完时 true→false→true→false；两次 enter 被取消，迟到 done 不改变最终节点；缓存节点复用取消两次 leave，仅最终 leave 完成。 */
    test('w/ KeepAlive', async () => {
      await runTestWithKeepAlive(testToggleBranchesBeforeFinish)
    })
  })

  // 测试组：out-in，旧分支离场完成后新分支进入。
  describe('mode: "out-in"', () => {
    /** 以给定两分支往返两轮out-in：旧leave未完时保留旧节点和注释，done触发下一更新才让新节点enter；比较钩子参数、次数及DOM。 在此fixture入口检查serializeInner(root)、props.onBeforeLeave、props.onLeave、props.onAfterLeave、props.onBeforeEnter、props.onEnter、props.onAfterEnter、props.onAfterLeave、serializeInner(root)、props.onBeforeEnter、props.onEnter、props.onAfterEnter、props.onAfterEnter、serializeInner(root)、props.onBeforeLeave、props.onLeave、props.onAfterLeave、props.onBeforeEnter、props.onEnter、props.onAfterEnter、props.onAfterLeave、serializeInner(root)、props.onBeforeEnter、props.onEnter、props.onAfterEnter、props.onAfterEnter，失败直接由expect抛出。 */
    async function testOutIn(
      {
        trueBranch,
        falseBranch,
        trueSerialized,
        falseSerialized,
      }: ToggleOptions,
      withKeepAlive = false,
    ) {
      const toggle = ref(true)
      const { props, cbs } = mockProps({ mode: 'out-in' }, withKeepAlive)
      const { root } = mount(
        props,
        () => (toggle.value ? trueBranch() : falseBranch()),
        withKeepAlive,
      )

      // 触发分支切换。
      toggle.value = false
      await nextTick()
      // leave 未完时，新分支位置先放注释占位。
      expect(serializeInner(root)).toBe(`${trueSerialized}<!---->`)
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeLeave, trueSerialized)
      expect(props.onLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onLeave, trueSerialized)
      expect(props.onAfterLeave).not.toHaveBeenCalled()
      // 旧分支 leave 未完，新 enter 尚未启动。
      expect(props.onBeforeEnter).not.toHaveBeenCalled()
      expect(props.onEnter).not.toHaveBeenCalled()
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      cbs.doneLeave[trueSerialized]()
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterLeave, trueSerialized)
      // leave 完成触发组件更新，等待 nextTick 才观察新分支。
      await nextTick()
      expect(serializeInner(root)).toBe(falseSerialized)
      // 新分支此时开始 enter。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeEnter, falseSerialized)
      expect(props.onEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onEnter, falseSerialized)
      expect(props.onAfterEnter).not.toHaveBeenCalled()
      // 手动完成 enter。
      cbs.doneEnter[falseSerialized]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterEnter, falseSerialized)

      // 再次切换分支。
      toggle.value = true
      await nextTick()
      expect(serializeInner(root)).toBe(`${falseSerialized}<!---->`)
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onBeforeLeave, falseSerialized, 1)
      expect(props.onLeave).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onLeave, falseSerialized, 1)
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      // 旧分支 leave 未完，新 enter 尚未启动。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(1)
      expect(props.onEnter).toHaveBeenCalledTimes(1)
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)

      cbs.doneLeave[falseSerialized]()
      expect(props.onAfterLeave).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onAfterLeave, falseSerialized, 1)
      await nextTick()
      expect(serializeInner(root)).toBe(trueSerialized)
      // 新分支此时开始 enter。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onBeforeEnter, trueSerialized, 1)
      expect(props.onEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onEnter, trueSerialized, 1)
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
      // 手动完成 enter。
      cbs.doneEnter[trueSerialized]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onAfterEnter, trueSerialized, 1)

      assertCalls(props, {
        onBeforeEnter: 2,
        onEnter: 2,
        onAfterEnter: 2,
        onEnterCancelled: 0,
        onBeforeLeave: 2,
        onLeave: 2,
        onAfterLeave: 2,
        onLeaveCancelled: 0,
      })
    }

    /** 测试场景：div/span 元素：out-in 切换两轮；旧分支与注释占位共存，leave done 并等待更新后才挂载新分支、启动 enter，每轮入离场各完成一次。 */
    test('w/ elements', async () => {
      await runTestWithElements(testOutIn)
    })

    /** 测试场景：普通组件与 HOC 组件：out-in 切换两轮；旧分支与注释占位共存，leave done 并等待更新后才挂载新分支、启动 enter，每轮入离场各完成一次。 */
    test('w/ components', async () => {
      await runTestWithComponents(testOutIn)
    })

    /** 测试场景：KeepAlive 缓存的 div/span 组件：out-in 切换两轮；旧分支与注释占位共存，leave done 并等待更新后才挂载新分支、启动 enter，每轮入离场各完成一次。 */
    test('w/ KeepAlive', async () => {
      await runTestWithKeepAlive(testOutIn)
    })
  })

  // #6835
  // 测试组：out-in 完成一次切换后卸载，再修改分支状态不再触发过渡或更新。
  describe('mode: "out-in" toggle again after unmounted', () => {
    /** 先完成一次out-in切换，再关闭整个过渡组件并改toggle；断言只留注释且所有钩子次数不增加，检查卸载后update防护。 */
    async function testOutIn(
      {
        trueBranch,
        falseBranch,
        trueSerialized,
        falseSerialized,
      }: ToggleOptions,
      withKeepAlive = false,
    ) {
      const toggle = ref(true)
      const { props, cbs } = mockProps({ mode: 'out-in' }, withKeepAlive)
      const { root, unmount } = mount(
        props,
        () => (toggle.value ? trueBranch() : falseBranch()),
        withKeepAlive,
      )

      // 触发分支切换。
      toggle.value = false
      await nextTick()
      // leave 未完时，新分支位置先放注释占位。
      expect(serializeInner(root)).toBe(`${trueSerialized}<!---->`)
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeLeave, trueSerialized)
      expect(props.onLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onLeave, trueSerialized)
      expect(props.onAfterLeave).not.toHaveBeenCalled()
      // 旧分支 leave 未完，新 enter 尚未启动。
      expect(props.onBeforeEnter).not.toHaveBeenCalled()
      expect(props.onEnter).not.toHaveBeenCalled()
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      cbs.doneLeave[trueSerialized]()
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterLeave, trueSerialized)
      // leave 完成触发组件更新，等待 nextTick 才观察新分支。
      await nextTick()
      expect(serializeInner(root)).toBe(falseSerialized)
      // 新分支此时开始 enter。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeEnter, falseSerialized)
      expect(props.onEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onEnter, falseSerialized)
      expect(props.onAfterEnter).not.toHaveBeenCalled()
      // 手动完成 enter。
      cbs.doneEnter[falseSerialized]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterEnter, falseSerialized)

      unmount()
      // 再次切换分支。 after unmounted should not throw error
      toggle.value = true
      await nextTick()
      expect(serializeInner(root)).toBe(`<!---->`)

      assertCalls(props, {
        onBeforeEnter: 1,
        onEnter: 1,
        onAfterEnter: 1,
        onEnterCancelled: 0,
        onBeforeLeave: 1,
        onLeave: 1,
        onAfterLeave: 1,
        onLeaveCancelled: 0,
      })
    }

    /** 测试场景：div/span 元素：out-in 先完成 true→false 切换再卸载整个过渡组件，随后修改 toggle；只剩注释且钩子次数不增加，验证卸载后状态更新不再驱动过渡。 */
    test('w/ elements', async () => {
      await runTestWithElements(testOutIn)
    })

    /** 测试场景：普通组件与 HOC 组件：out-in 先完成 true→false 切换再卸载整个过渡组件，随后修改 toggle；只剩注释且钩子次数不增加，验证卸载后状态更新不再驱动过渡。 */
    test('w/ components', async () => {
      await runTestWithComponents(testOutIn)
    })

    /** 测试场景：KeepAlive 缓存的 div/span 组件：out-in 先完成 true→false 切换再卸载整个过渡组件，随后修改 toggle；只剩注释且钩子次数不增加，验证卸载后状态更新不再驱动过渡。 */
    test('w/ KeepAlive', async () => {
      await runTestWithKeepAlive(testOutIn)
    })
  })

  // 测试组：out-in 离场未完成便反向切换，等待结束后进入最新分支。
  describe('mode: "out-in" toggle before finish', () => {
    /** out-in 离场期间反向切回原分支；断言旧节点和占位保持、新入场延后，并在 leave done 后进入最新分支。 */
    async function testOutInBeforeFinish(
      { trueBranch, falseBranch, trueSerialized }: ToggleOptions,
      withKeepAlive = false,
    ) {
      const toggle = ref(true)
      const { props, cbs } = mockProps({ mode: 'out-in' }, withKeepAlive)
      const { root } = mount(
        props,
        () => (toggle.value ? trueBranch() : falseBranch()),
        withKeepAlive,
      )

      // 触发分支切换。
      toggle.value = false
      await nextTick()
      // 再次切换分支。 before finish
      toggle.value = true
      await nextTick()
      // 旧 true 离场节点暂时保留，
      // 替换位置为注释占位。
      // 即使切回同一分支，也先等待旧 leave 完成，
      // 再用新节点替换。
      expect(serializeInner(root)).toBe(`${trueSerialized}<!---->`)
      // 等待 leave 期间，两分支都不启动 enter。
      expect(props.onBeforeEnter).not.toHaveBeenCalled()
      expect(props.onEnter).not.toHaveBeenCalled()
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      // 手动完成 leave。
      cbs.doneLeave[trueSerialized]()
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterLeave, trueSerialized)
      await nextTick()
      // 旧离场节点和占位已移除，新入场节点插入。
      expect(serializeInner(root)).toBe(trueSerialized)
      // 新分支此时开始 enter。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeEnter, trueSerialized)
      expect(props.onEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onEnter, trueSerialized)
      expect(props.onAfterEnter).not.toHaveBeenCalled()
      // 手动完成 enter。
      cbs.doneEnter[trueSerialized]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterEnter, trueSerialized)

      assertCalls(props, {
        onBeforeEnter: 1,
        onEnter: 1,
        onAfterEnter: 1,
        onEnterCancelled: 0,
        onBeforeLeave: 1,
        onLeave: 1,
        onAfterLeave: 1,
        onLeaveCancelled: 0,
      })
    }

    /** 测试场景：div/span 元素：out-in 离场未完便 true→false→true；旧 true 与占位保持且尚无 enter，leave done 后移除旧节点/占位并让最新 true 入场。 */
    test('w/ elements', async () => {
      await runTestWithElements(testOutInBeforeFinish)
    })

    /** 测试场景：普通组件与 HOC 组件：out-in 离场未完便 true→false→true；旧 true 与占位保持且尚无 enter，leave done 后移除旧节点/占位并让最新 true 入场。 */
    test('w/ components', async () => {
      await runTestWithComponents(testOutInBeforeFinish)
    })

    /** 测试场景：KeepAlive 缓存的 div/span 组件：out-in 离场未完便 true→false→true；旧 true 与占位保持且尚无 enter，leave done 后移除旧节点/占位并让最新 true 入场。 */
    test('w/ KeepAlive', async () => {
      await runTestWithKeepAlive(testOutInBeforeFinish)
    })
  })

  // 测试组：out-in 离场未完成便连续切换，旧离场节点保留到完成。
  describe('mode: "out-in" double quick toggle', () => {
    /** out-in 离场期间连续切换三次，确认只保留原离场节点与占位；leave done 后仅挂载最后选中的 false 分支。 在此fixture入口检查serializeInner(root)、props.onBeforeEnter、props.onEnter、props.onAfterEnter、props.onAfterLeave、serializeInner(root)、props.onBeforeEnter、props.onEnter、props.onAfterEnter、props.onAfterEnter，失败直接由expect抛出。 */
    async function testOutInDoubleToggle(
      {
        trueBranch,
        falseBranch,
        trueSerialized,
        falseSerialized,
      }: ToggleOptions,
      withKeepAlive = false,
    ) {
      const toggle = ref(true)
      const { props, cbs } = mockProps({ mode: 'out-in' }, withKeepAlive)
      const { root } = mount(
        props,
        () => (toggle.value ? trueBranch() : falseBranch()),
        withKeepAlive,
      )

      // 在 leave 未完时连续切换三次。
      toggle.value = false
      await nextTick()
      toggle.value = true
      await nextTick()
      toggle.value = false
      await nextTick()

      // leave 未完期间，最初的 true 离场节点一直保留，
      // 后续切换只更新等待中的目标分支；
      // 该位置仍以注释占位。
      expect(serializeInner(root)).toBe(`${trueSerialized}<!---->`)
      // 等待 leave 期间，两分支都不启动 enter。
      expect(props.onBeforeEnter).not.toHaveBeenCalled()
      expect(props.onEnter).not.toHaveBeenCalled()
      expect(props.onAfterEnter).not.toHaveBeenCalled()

      // 手动完成 leave。
      cbs.doneLeave[trueSerialized]()
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterLeave, trueSerialized)
      await nextTick()
      // 旧离场节点和占位已移除，新入场节点插入。
      expect(serializeInner(root)).toBe(falseSerialized)
      // 新分支此时开始 enter。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeEnter, falseSerialized)
      expect(props.onEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onEnter, falseSerialized)
      expect(props.onAfterEnter).not.toHaveBeenCalled()
      // 手动完成 enter。
      cbs.doneEnter[falseSerialized]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterEnter, falseSerialized)

      assertCalls(props, {
        onBeforeEnter: 1,
        onEnter: 1,
        onAfterEnter: 1,
        onEnterCancelled: 0,
        onBeforeLeave: 1,
        onLeave: 1,
        onAfterLeave: 1,
        onLeaveCancelled: 0,
      })
    }

    /** 测试场景：div/span 元素：out-in 在旧 true 离场期间连续 true→false→true→false；旧节点一直保留，done 后只让最新 false 入场，入离场各一轮。 */
    test('w/ elements', async () => {
      await runTestWithElements(testOutInDoubleToggle)
    })

    /** 测试场景：普通组件与 HOC 组件：out-in 在旧 true 离场期间连续 true→false→true→false；旧节点一直保留，done 后只让最新 false 入场，入离场各一轮。 */
    test('w/ components', async () => {
      await runTestWithComponents(testOutInDoubleToggle)
    })

    /** 测试场景：KeepAlive 缓存的 div/span 组件：out-in 在旧 true 离场期间连续 true→false→true→false；旧节点一直保留，done 后只让最新 false 入场，入离场各一轮。 */
    test('w/ KeepAlive', async () => {
      await runTestWithKeepAlive(testOutInDoubleToggle)
    })
  })

  // 测试组：in-out，新分支入场完成后旧分支离场。
  describe('mode: "in-out"', () => {
    /** 用两轮切换验证 in-out 的延迟离场：新 enter 完成前旧 leave 不启动，完成 leave 后才移除旧宿主。 在此fixture入口检查serializeInner(root)、props.onBeforeEnter、props.onEnter、props.onAfterEnter、props.onBeforeLeave、props.onLeave、props.onAfterLeave、props.onAfterEnter、props.onBeforeLeave、props.onLeave、props.onAfterLeave、props.onAfterLeave、serializeInner(root)、props.onBeforeEnter、props.onEnter、props.onAfterEnter、props.onBeforeLeave、props.onLeave、props.onAfterLeave、props.onAfterEnter、props.onBeforeLeave、props.onLeave、props.onAfterLeave、props.onAfterLeave，失败直接由expect抛出。 */
    async function testInOut(
      {
        trueBranch,
        falseBranch,
        trueSerialized,
        falseSerialized,
      }: ToggleOptions,
      withKeepAlive = false,
    ) {
      const toggle = ref(true)
      const { props, cbs } = mockProps({ mode: 'in-out' }, withKeepAlive)
      const { root } = mount(
        props,
        () => (toggle.value ? trueBranch() : falseBranch()),
        withKeepAlive,
      )

      toggle.value = false
      await nextTick()
      expect(serializeInner(root)).toBe(`${trueSerialized}${falseSerialized}`)
      // 新分支此时开始 enter。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeEnter, falseSerialized)
      expect(props.onEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onEnter, falseSerialized)
      expect(props.onAfterEnter).not.toHaveBeenCalled()
      // in-out 的新 enter 未完成，旧 leave 尚未开始。
      expect(props.onBeforeLeave).not.toHaveBeenCalled()
      expect(props.onLeave).not.toHaveBeenCalled()
      expect(props.onAfterLeave).not.toHaveBeenCalled()

      // 手动完成 enter。
      cbs.doneEnter[falseSerialized]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterEnter, falseSerialized)

      // 新 enter 完成，现在才开始旧 leave。
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeLeave, trueSerialized)
      expect(props.onLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onLeave, trueSerialized)
      expect(props.onAfterLeave).not.toHaveBeenCalled()
      // 手动完成 leave。
      cbs.doneLeave[trueSerialized]()
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterLeave, trueSerialized)

      // 再次切换分支。
      toggle.value = true
      await nextTick()
      expect(serializeInner(root)).toBe(`${falseSerialized}${trueSerialized}`)
      // 新分支此时开始 enter。
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onBeforeEnter, trueSerialized, 1)
      expect(props.onEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onEnter, trueSerialized, 1)
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
      // in-out 的新 enter 未完成，旧 leave 尚未开始。
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(1)
      expect(props.onLeave).toHaveBeenCalledTimes(1)
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)

      // 手动完成 enter。
      cbs.doneEnter[trueSerialized]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onAfterEnter, trueSerialized, 1)

      // 新 enter 完成，现在才开始旧 leave。
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onBeforeLeave, falseSerialized, 1)
      expect(props.onLeave).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onLeave, falseSerialized, 1)
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      // 手动完成 leave。
      cbs.doneLeave[falseSerialized]()
      expect(props.onAfterLeave).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onAfterLeave, falseSerialized, 1)

      assertCalls(props, {
        onBeforeEnter: 2,
        onEnter: 2,
        onAfterEnter: 2,
        onEnterCancelled: 0,
        onBeforeLeave: 2,
        onLeave: 2,
        onAfterLeave: 2,
        onLeaveCancelled: 0,
      })
    }

    /** 测试场景：div/span 元素：in-out 切换两轮，新旧分支共存；先启动新 enter，enter done 才启动旧 leave，leave done 才移除旧节点，两轮均无取消。 */
    test('w/ elements', async () => {
      await runTestWithElements(testInOut)
    })

    /** 测试场景：普通组件与 HOC 组件：in-out 切换两轮，新旧分支共存；先启动新 enter，enter done 才启动旧 leave，leave done 才移除旧节点，两轮均无取消。 */
    test('w/ components', async () => {
      await runTestWithComponents(testInOut)
    })

    /** 测试场景：KeepAlive 缓存的 div/span 组件：in-out 切换两轮，新旧分支共存；先启动新 enter，enter done 才启动旧 leave，leave done 才移除旧节点，两轮均无取消。 */
    test('w/ KeepAlive', async () => {
      await runTestWithKeepAlive(testInOut)
    })
  })

  // 测试组：in-out 入场未完成便反向切换，提前移除旧副本并取消过期延迟离场。
  describe('mode: "in-out" toggle before finish', () => {
    /** in-out 新节点未完成入场时反向切换，断言旧副本提前移除、过期延迟 leave 失效，以及最后一次 enter 触发对应旧分支离场。 */
    async function testInOutBeforeFinish(
      {
        trueBranch,
        falseBranch,
        trueSerialized,
        falseSerialized,
      }: ToggleOptions,
      withKeepAlive = false,
    ) {
      const toggle = ref(true)
      const { props, cbs } = mockProps({ mode: 'in-out' }, withKeepAlive)
      const { root } = mount(
        props,
        () => (toggle.value ? trueBranch() : falseBranch()),
        withKeepAlive,
      )

      toggle.value = false
      await nextTick()
      expect(serializeInner(root)).toBe(`${trueSerialized}${falseSerialized}`)

      // 新分支 enter 未完成即反向切回。
      toggle.value = true
      await nextTick()
      // 旧 true 副本提前移除，取消其延迟 leave。
      expect(serializeInner(root)).toBe(`${falseSerialized}${trueSerialized}`)
      expect(props.onBeforeEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onBeforeEnter, falseSerialized)
      assertCalledWithEl(props.onBeforeEnter, trueSerialized, 1)
      expect(props.onEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onEnter, falseSerialized)
      assertCalledWithEl(props.onEnter, trueSerialized, 1)
      expect(props.onAfterEnter).not.toHaveBeenCalled()
      expect(props.onEnterCancelled).not.toHaveBeenCalled()

      // false 的旧 enter done 仍触发 afterEnter，
      // 但旧 true 副本已经移除，
      // 不再启动它的延迟离场。
      cbs.doneEnter[falseSerialized]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterEnter, falseSerialized)

      // in-out 的新 enter 未完成，旧 leave 尚未开始。 for either branch
      expect(props.onBeforeLeave).not.toHaveBeenCalled()
      expect(props.onLeave).not.toHaveBeenCalled()
      expect(props.onAfterLeave).not.toHaveBeenCalled()

      cbs.doneEnter[trueSerialized]()
      expect(props.onAfterEnter).toHaveBeenCalledTimes(2)
      assertCalledWithEl(props.onAfterEnter, trueSerialized, 1)
      // true enter 完成后开始 false leave。
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onBeforeLeave, falseSerialized)
      expect(props.onLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onLeave, falseSerialized)
      expect(props.onAfterLeave).not.toHaveBeenCalled()
      // 手动完成 leave。
      cbs.doneLeave[falseSerialized]()
      expect(serializeInner(root)).toBe(trueSerialized)
      expect(props.onAfterLeave).toHaveBeenCalledTimes(1)
      assertCalledWithEl(props.onAfterLeave, falseSerialized)

      assertCalls(props, {
        onBeforeEnter: 2,
        onEnter: 2,
        onAfterEnter: 2,
        onEnterCancelled: 0,
        onBeforeLeave: 1,
        onLeave: 1,
        onAfterLeave: 1,
        onLeaveCancelled: 0,
      })
    }

    /** 测试场景：div/span 元素：in-out 新 false 入场未完就反向切 true；提前移除旧 true，false 的迟到 enter done 只触发 afterEnter、不再启动旧延迟 leave；true enter done 才让 false leave，最终仅留 true。 */
    test('w/ elements', async () => {
      await runTestWithElements(testInOutBeforeFinish)
    })

    /** 测试场景：普通组件与 HOC 组件：in-out 新 false 入场未完就反向切 true；提前移除旧 true，false 的迟到 enter done 只触发 afterEnter、不再启动旧延迟 leave；true enter done 才让 false leave，最终仅留 true。 */
    test('w/ components', async () => {
      await runTestWithComponents(testInOutBeforeFinish)
    })

    /** 测试场景：KeepAlive 缓存的 div/span 组件：in-out 新 false 入场未完就反向切 true；提前移除旧 true，false 的迟到 enter done 只触发 afterEnter、不再启动旧延迟 leave；true enter done 才让 false leave，最终仅留 true。 */
    test('w/ KeepAlive', async () => {
      await runTestWithKeepAlive(testInOutBeforeFinish)
    })
  })

  // #10719
  /** 测试场景：KeepAlive 插槽自身返回函数，再交给 BaseTransition 提取内部节点；挂载不得抛错，验证函数 children 的兼容路径。 */
  test('should not error on KeepAlive w/ function children', () => {
    expect(() => mount({}, () => () => h('div'), true)).not.toThrow()
  })

  // #12465
  /** 测试场景：生产模式下 out-in 包裹 KeepAlive，class=test 从过渡组件透传到 div/span；切换先触发旧 div leave，done 后显示带同一 class 的 span，离场期间不启动新 enter。 */
  test('mode: "out-in" w/ KeepAlive + fallthrough attrs (prod mode)', async () => {
    __DEV__ = false
    /** 在生产模式以class=test包裹KeepAlive，切div→span；断言旧div leave和新span均保留透传class，leave完成前新enter不启动。 */
    async function testOutIn({ trueBranch, falseBranch }: ToggleOptions) {
      const toggle = ref(true)
      const { props, cbs } = mockProps({ mode: 'out-in' }, true)
      const root = nodeOps.createElement('div')
      const App = {
        /** 渲染BaseTransition节点（属性{...props，class: 'test'}；渲染函数：KeepAlive节点（null；toggle.value决定trueBranch()或falseBranch()））。 */
        render() {
          return h(
            BaseTransition,
            {
              ...props,
              class: 'test',
            },
            () =>
              h(KeepAlive, null, toggle.value ? trueBranch() : falseBranch()),
          )
        },
      }
      render(h(App), root)

      expect(serializeInner(root)).toBe(`<div class="test">0</div>`)

      // 触发分支切换。
      toggle.value = false
      await nextTick()
      expect(props.onBeforeLeave).toHaveBeenCalledTimes(1)
      expect(serialize((props.onBeforeLeave as any).mock.calls[0][0])).toBe(
        `<div class="test">0</div>`,
      )
      expect(props.onLeave).toHaveBeenCalledTimes(1)
      expect(serialize((props.onLeave as any).mock.calls[0][0])).toBe(
        `<div class="test">0</div>`,
      )
      expect(props.onAfterLeave).not.toHaveBeenCalled()
      // 旧分支 leave 未完，新 enter 尚未启动。
      expect(props.onBeforeEnter).not.toHaveBeenCalled()
      expect(props.onEnter).not.toHaveBeenCalled()
      expect(props.onAfterEnter).not.toHaveBeenCalled()
      cbs.doneLeave[`<div class="test">0</div>`]()
      expect(serializeInner(root)).toBe(`<span class="test">0</span>`)
    }
    await runTestWithKeepAlive(testOutIn)
    __DEV__ = true
  })

  /** 测试场景：组件以 KeepAlive 为根且初始隐藏；切换 show 为 true 后出现 content div，onBeforeEnter 恰调用一次，验证过渡钩子能传到缓存子根。 */
  test('should preserve transition for component with KeepAlive root', async () => {
    const root = nodeOps.createElement('div')
    const show = ref(false)
    const onBeforeEnter = vi.fn()
    const Child = {
      /** 渲染'div'节点（'content'）。 */
      render: () => h('div', 'content')
    }
    const Comp = {
      /** 渲染KeepAlive节点（null；插槽{default回调}）。 */
      render: () =>
        h(KeepAlive, null, {
          /** 提供default插槽：Child节点。 */
          default: () => h(Child)
        }),
    }
    /** 返回BaseTransition节点（属性{onBeforeEnter}；渲染函数：show.value决定Comp节点或null）。 */
    const App = () =>
      h(BaseTransition, { onBeforeEnter }, () => (show.value ? h(Comp) : null))

    render(h(App), root)

    show.value = true
    await nextTick()
    expect(serializeInner(root)).toBe('<div>content</div>')
    expect(onBeforeEnter).toHaveBeenCalledTimes(1)
  })

  /** 测试场景：过渡组件的子组件返回空 Teleport；挂载不抛错，主树仅有 Teleport 双注释、target 为空，并报告非元素根警告。 */
  test('should not error on component with empty Teleport root', () => {
    const root = nodeOps.createElement('div')
    const target = nodeOps.createElement('div')
    /** 返回Teleport节点（属性{to: target}；根数组[]）。 */
    const Comp = () => h(Teleport, { to: target }, [])

    expect(() =>
      render(
        h(BaseTransition, null, () => h(Comp)),
        root,
      ),
    ).not.toThrow()
    expect(serializeInner(root)).toBe(
      '<!--teleport start--><!--teleport end-->',
    )
    expect(serializeInner(target)).toBe('')
    expect(
      'Component inside <Transition> renders non-element root node',
    ).toHaveBeenWarned()
  })

  /** 测试场景：子组件以 Teleport 为根，先替换响应式 beforeLeave 回调再隐藏；旧回调未执行、新回调执行一次，验证更新钩子传到目标元素。 */
  test('should update transition hooks for component with Teleport root', async () => {
    const root = nodeOps.createElement('div')
    const target = nodeOps.createElement('div')
    const show = ref(true)
    const firstBeforeLeave = vi.fn()
    const nextBeforeLeave = vi.fn()
    const beforeLeave = ref(firstBeforeLeave)
    /** 返回Teleport节点（属性{to: target}；'div'节点（'content'））。 */
    const Comp = () => h(Teleport, { to: target }, h('div', 'content'))
    /** 返回BaseTransition节点（属性{onBeforeLeave: beforeLeave.value}；渲染函数：show.value决定Comp节点或null）。 */
    const App = () =>
      h(BaseTransition, { onBeforeLeave: beforeLeave.value }, () =>
        show.value ? h(Comp) : null,
      )

    render(h(App), root)

    beforeLeave.value = nextBeforeLeave
    show.value = false
    await nextTick()

    expect(firstBeforeLeave).not.toHaveBeenCalled()
    expect(nextBeforeLeave).toHaveBeenCalledTimes(1)
  })
})
