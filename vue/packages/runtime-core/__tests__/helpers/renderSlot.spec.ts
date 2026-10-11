/**
 * 模拟 currentRenderingInstance 后直接调用 renderSlot，检查 Fragment、分支 key 和 fallback。
 * withCtx 与 block 夹具检查动态节点收集；自定义元素夹具检查生成的真实 slot VNode。
 */
import { renderSlot } from '../../src/helpers/renderSlot'
import {
  Fragment,
  type Slot,
  createBlock,
  createCommentVNode,
  createVNode,
  h,
  openBlock,
  withCtx,
} from '../../src'
import { PatchFlags } from '@vue/shared'
import { setCurrentRenderingInstance } from '../../src/componentRenderContext'

// renderSlot 选择 slot/fallback、维护 key，并过滤无效 slot 内容。
describe('renderSlot', () => {
  beforeEach(() => {
    setCurrentRenderingInstance({ type: {} } as any)
  })

  afterEach(() => {
    setCurrentRenderingInstance(null)
  })

  /** 模拟渲染实例，default 插槽返回 child，props 指定 key:foo；检查 children 与 key，验证插槽内容和用户身份键进入 Fragment。 */
  it('should render slot', () => {
    let child
    const vnode = renderSlot(
      {
        /** 返回并保存 child VNode，供 children 身份断言。 */
        default: () => [(child = h('child'))]
      },
      'default',
      { key: 'foo' },
    )
    expect(vnode.children).toEqual([child])
    expect(vnode.key).toBe('foo')
  })

  /** 用户 props.key 传 Symbol，default 返回 div；检查 Fragment key 为 _default，验证 Symbol 不参与字符串分支键拼接。 */
  it('should allow symbol values for slot prop key', () => {
    const key = Symbol()
    const vnode = renderSlot(
      {
        /** 返回 div，供用户 Symbol key 回退断言。 */
        default: () => [h('div')]
      },
      'default',
      { key }
    )
    expect(vnode.key).toBe('_default')
  })

  /** 把 Symbol 作为编译分支 key 传入，检查 Fragment key 回退 _default，验证编译器身份键同样排除 Symbol。 */
  it('should allow symbol values for compiler-injected slot keys', () => {
    const key = Symbol()
    const vnode = renderSlot(
      {
        /** 返回 div，供编译 Symbol key 回退断言。 */
        default: () => [h('div')]
      },
      'default',
      {},
      undefined,
      undefined,
      key,
    )
    expect(vnode.key).toBe('_default')
  })

  /** 把数组 props 与 branchKey:branch 传入并记录插槽实参；检查原数组身份、无 key 属性及 Fragment key，验证内部键不污染用户 props。 */
  it('should not expose compiler-injected slot keys to slot props', () => {
    let receivedProps: any
    const props = ['foo', 'bar']
    const vnode = renderSlot(
      {
        /** 保存收到的原 props 引用并返回 div，检查 branchKey 没有写入 props。 */
        default: props => {
          receivedProps = props
          return [h('div')]
        },
      },
      'default',
      props as any,
      undefined,
      undefined,
      'branch',
    )

    expect(receivedProps).toBe(props)
    expect(receivedProps).not.toHaveProperty('key')
    expect(vnode.key).toBe('branch')
  })

  /** 同时提供 props.key:user 与 branchKey:branch，检查插槽实参身份与 Fragment key:user，验证用户键优先。 */
  it('should prefer user-provided slot prop keys over compiler-injected keys', () => {
    let receivedProps: any
    const props = { key: 'user' }
    const vnode = renderSlot(
      {
        /** 保存原 props 引用并返回 div，检查用户 key 优先级。 */
        default: props => {
          receivedProps = props
          return [h('div')]
        },
      },
      'default',
      props,
      undefined,
      undefined,
      'branch',
    )

    expect(receivedProps).toBe(props)
    expect(vnode.key).toBe('user')
  })

  /** 模拟自定义元素实例，先传 branchKey:0 再同时传用户键；检查真实 slot 节点、0键、BAIL 与用户键优先，验证 CE 分支保留零值键。 */
  it('should preserve compiler-injected slot keys in custom element mode', () => {
    setCurrentRenderingInstance({ type: {}, ce: {} } as any)

    let vnode = renderSlot({}, 'default', {}, undefined, undefined, 0)
    let slot = (vnode.children as any[])[0]
    expect(slot.type).toBe('slot')
    expect(slot.key).toBe(0)
    expect(vnode.patchFlag).toBe(PatchFlags.BAIL)

    vnode = renderSlot(
      {},
      'default',
      { key: 'user' },
      undefined,
      undefined,
      'branch',
    )
    slot = (vnode.children as any[])[0]
    expect(slot.key).toBe('user')
  })

  /** 循环传入 null 与 undefined props，记录 default 插槽实参；检查都变为空对象且 key 为 _default，验证两种空输入归一化一致。 */
  it('should handle nullish props', () => {
    for (const props of [null, undefined]) {
      let receivedProps: any
      const vnode = renderSlot(
        {
          /** 记录归一化后的 props 并返回 div，分别检查 null/undefined 输入。 */
          default: props => {
            receivedProps = props
            return [h('div')]
          },
        },
        'default',
        props,
      )
      expect(receivedProps).toEqual({})
      expect(vnode.key).toBe('_default')
    }
  })

  /** 循环传入 null 与 undefined props 并指定 branchKey:branch，检查 Fragment 键，验证空 props 不丢失编译分支身份。 */
  it('should handle nullish props with a compiler-injected slot key', () => {
    for (const props of [null, undefined]) {
      const vnode = renderSlot(
        {
          /** 返回 div，供空 props 与编译分支键组合测试。 */
          default: () => [h('div')]
        },
        'default',
        props,
        undefined,
        undefined,
        'branch',
      )
      expect(vnode.key).toBe('branch')
    }
  })

  /** 在自定义元素模式循环传 null/undefined，渲染具名 foo 插槽并指定 branch；检查真实 slot 的类型、键和 name，验证空 props 的 CE 分支。 */
  it('should handle nullish props in custom element mode', () => {
    setCurrentRenderingInstance({ type: {}, ce: {} } as any)

    for (const props of [null, undefined]) {
      const vnode = renderSlot({}, 'foo', props, undefined, undefined, 'branch')
      const slot = (vnode.children as any[])[0]
      expect(slot.type).toBe('slot')
      expect(slot.key).toBe('branch')
      expect(slot.props.name).toBe('foo')
    }
  })

  /** 未提供 default 插槽，传 fallback 与用户 key:foo；检查 fallback children 及 foo_fb，验证回退内容使用不同身份。 */
  it('should render slot fallback', () => {
    const vnode = renderSlot({}, 'default', { key: 'foo' }, () => ['fallback'])
    expect(vnode.children).toEqual(['fallback'])
    // fallback 使用带 _fb 后缀的身份键。
    expect(vnode.key).toBe('foo_fb')
  })

  /** 把三参数 SSR 插槽当客户端 default 使用，检查 SSR-optimized 警告，验证运行时识别不适合直接调用的服务端插槽。 */
  it('should warn render ssr slot', () => {
    renderSlot(
      {
        /** 模拟三参数 SSR 插槽，供客户端检测签名并警告。 */
        default: (_a, _b, _c) => [h('child')]
      },
      'default'
    )
    expect('SSR-optimized slot function detected').toHaveBeenWarned()
  })

  // #1745
  /** 用 withCtx 包装带 TEXT 节点的编译插槽，分别手动调用与经 renderSlot 调用；检查 dynamicChildren 为0和1，验证 renderSlot 临时启用块跟踪。 */
  it('should force enable tracking', () => {
    const slot = withCtx(
      () => {
        return [createVNode('div', null, 'foo', PatchFlags.TEXT)]
      },
      // 模拟渲染实例。
      { type: {}, appContext: {} } as any,
    ) as Slot

    // 手动调用编译插槽不收集动态子节点。
    const manual = (openBlock(), createBlock(Fragment, null, slot()))
    expect(manual.dynamicChildren!.length).toBe(0)

    // renderSlot 调用期间启用动态收集。
    const templateRendered = renderSlot({ default: slot }, 'default')
    expect(templateRendered.dynamicChildren!.length).toBe(1)
  })

  // #2347 #2461
  // 仅渲染有效的slot内容。
  describe('only render valid slot content', () => {
    /** default 只返回注释节点，提供 fallback；检查实际 children 来自 fallback 且 patchFlag 为 BAIL，验证全注释内容视为无效插槽。 */
    it('should ignore slots that are all comments', () => {
      let fallback
      const vnode = renderSlot(
        {
          /** 只返回注释 VNode，构造无有效内容的插槽。 */
          default: () => [createCommentVNode('foo')]
        },
        'default',
        undefined,
        () => [(fallback = h('fallback'))],
      )
      expect(vnode.children).toEqual([fallback])
      expect(vnode.patchFlag).toBe(PatchFlags.BAIL)
    })

    /** default 返回嵌套空插槽的 Fragment，提供外层 fallback；检查回退内容与 BAIL，验证无效内容检测会深入 Fragment。 */
    it('should ignore invalid slot content generated by nested slot', () => {
      let fallback
      const vnode = renderSlot(
        {
          /** 返回嵌套空插槽 Fragment，构造递归无效内容检查。 */
          default: () => [renderSlot({}, 'foo')]
        },
        'default',
        undefined,
        () => [(fallback = h('fallback'))],
      )
      expect(vnode.children).toEqual([fallback])
      expect(vnode.patchFlag).toBe(PatchFlags.BAIL)
    })
  })
})
