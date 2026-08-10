/**
 * 测试阅读说明：本文件验证 `runtime-core/helpers/renderSlot` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
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

// 测试组：renderSlot 选择 slot/fallback、维护 key，并过滤无效 slot 内容。
describe('renderSlot', () => {
  beforeEach(() => {
    setCurrentRenderingInstance({ type: {} } as any)
  })

  afterEach(() => {
    setCurrentRenderingInstance(null)
  })

  // 测试场景：renderSlot 能渲染已解析的 slot 内容并生成正确的 Fragment。
  it('should render slot', () => {
    let child
    const vnode = renderSlot(
      { default: () => [(child = h('child'))] },
      'default',
      { key: 'foo' },
    )
    expect(vnode.children).toEqual([child])
    expect(vnode.key).toBe('foo')
  })

  // 测试场景：用户传入的 slot props 允许使用 Symbol 作为 key。
  it('should allow symbol values for slot prop key', () => {
    const key = Symbol()
    const vnode = renderSlot({ default: () => [h('div')] }, 'default', { key })
    expect(vnode.key).toBe('_default')
  })

  // 测试场景：应该允许编译器注入的 slot 键的符号值。
  it('should allow symbol values for compiler-injected slot keys', () => {
    const key = Symbol()
    const vnode = renderSlot(
      { default: () => [h('div')] },
      'default',
      {},
      undefined,
      undefined,
      key,
    )
    expect(vnode.key).toBe('_default')
  })

  // 测试场景：不应将编译器注入的 slot key暴露给 slot props。
  it('should not expose compiler-injected slot keys to slot props', () => {
    let receivedProps: any
    const props = ['foo', 'bar']
    const vnode = renderSlot(
      {
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

  // 测试场景：用户提供的 slot key 优先于编译器注入的内部 key。
  it('should prefer user-provided slot prop keys over compiler-injected keys', () => {
    let receivedProps: any
    const props = { key: 'user' }
    const vnode = renderSlot(
      {
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

  // 测试场景：应该在自定义元素模式下保留编译器注入的 slot 键。
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

  // 测试场景：应该处理无效的props。
  it('should handle nullish props', () => {
    for (const props of [null, undefined]) {
      let receivedProps: any
      const vnode = renderSlot(
        {
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

  // 测试场景：应该使用编译器注入的 slot key处理空 props。
  it('should handle nullish props with a compiler-injected slot key', () => {
    for (const props of [null, undefined]) {
      const vnode = renderSlot(
        { default: () => [h('div')] },
        'default',
        props,
        undefined,
        undefined,
        'branch',
      )
      expect(vnode.key).toBe('branch')
    }
  })

  // 测试场景：应该在自定义元素模式下处理 nullish props。
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

  // 测试场景：应该渲染 slot 后备。
  it('should render slot fallback', () => {
    const vnode = renderSlot({}, 'default', { key: 'foo' }, () => ['fallback'])
    expect(vnode.children).toEqual(['fallback'])
    // should attach fallback key postfix
    expect(vnode.key).toBe('foo_fb')
  })

  // 测试场景：应该警告渲染 ssr slot。
  it('should warn render ssr slot', () => {
    renderSlot({ default: (_a, _b, _c) => [h('child')] }, 'default')
    expect('SSR-optimized slot function detected').toHaveBeenWarned()
  })

  // #1745
  // 测试场景：应该强制启用跟踪。
  it('should force enable tracking', () => {
    const slot = withCtx(
      () => {
        return [createVNode('div', null, 'foo', PatchFlags.TEXT)]
      },
      // mock instance
      { type: {}, appContext: {} } as any,
    ) as Slot

    // manual invocation should not track
    const manual = (openBlock(), createBlock(Fragment, null, slot()))
    expect(manual.dynamicChildren!.length).toBe(0)

    // renderSlot should track
    const templateRendered = renderSlot({ default: slot }, 'default')
    expect(templateRendered.dynamicChildren!.length).toBe(1)
  })

  // #2347 #2461
  // 测试组：仅渲染有效的slot内容。
  describe('only render valid slot content', () => {
    // 测试场景：应该忽略slots，这些都是注释。
    it('should ignore slots that are all comments', () => {
      let fallback
      const vnode = renderSlot(
        { default: () => [createCommentVNode('foo')] },
        'default',
        undefined,
        () => [(fallback = h('fallback'))],
      )
      expect(vnode.children).toEqual([fallback])
      expect(vnode.patchFlag).toBe(PatchFlags.BAIL)
    })

    // 测试场景：应忽略嵌套 slot 生成的无效 slot 内容。
    it('should ignore invalid slot content generated by nested slot', () => {
      let fallback
      const vnode = renderSlot(
        { default: () => [renderSlot({}, 'foo')] },
        'default',
        undefined,
        () => [(fallback = h('fallback'))],
      )
      expect(vnode.children).toEqual([fallback])
      expect(vnode.patchFlag).toBe(PatchFlags.BAIL)
    })
  })
})
