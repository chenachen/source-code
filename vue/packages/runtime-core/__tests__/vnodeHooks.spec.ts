/**
 * 测试阅读说明：本文件验证 `runtime-core/vnodeHooks` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import {
  type TestElement,
  TestNodeTypes,
  type VNode,
  type VNodeProps,
  h,
  nodeOps,
  render,
} from '@vue/runtime-test'

// 测试组：renderer 的 VNode 生命周期钩子。
describe('renderer: vnode hooks', () => {
  function assertHooks(hooks: VNodeProps, vnode1: VNode, vnode2: VNode) {
    const root = nodeOps.createElement('div')
    render(vnode1, root)
    expect(hooks.onVnodeBeforeMount).toHaveBeenCalledWith(vnode1, null)
    expect(hooks.onVnodeMounted).toHaveBeenCalledWith(vnode1, null)
    expect(hooks.onVnodeBeforeUpdate).not.toHaveBeenCalled()
    expect(hooks.onVnodeUpdated).not.toHaveBeenCalled()
    expect(hooks.onVnodeBeforeUnmount).not.toHaveBeenCalled()
    expect(hooks.onVnodeUnmounted).not.toHaveBeenCalled()

    // update
    render(vnode2, root)
    expect(hooks.onVnodeBeforeMount).toHaveBeenCalledTimes(1)
    expect(hooks.onVnodeMounted).toHaveBeenCalledTimes(1)
    expect(hooks.onVnodeBeforeUpdate).toHaveBeenCalledWith(vnode2, vnode1)
    expect(hooks.onVnodeUpdated).toHaveBeenCalledWith(vnode2, vnode1)
    expect(hooks.onVnodeBeforeUnmount).not.toHaveBeenCalled()
    expect(hooks.onVnodeUnmounted).not.toHaveBeenCalled()

    // unmount
    render(null, root)
    expect(hooks.onVnodeBeforeMount).toHaveBeenCalledTimes(1)
    expect(hooks.onVnodeMounted).toHaveBeenCalledTimes(1)
    expect(hooks.onVnodeBeforeUpdate).toHaveBeenCalledTimes(1)
    expect(hooks.onVnodeUpdated).toHaveBeenCalledTimes(1)
    expect(hooks.onVnodeBeforeUnmount).toHaveBeenCalledWith(vnode2, null)
    expect(hooks.onVnodeUnmounted).toHaveBeenCalledWith(vnode2, null)
  }

  // 测试场景：应该在元素上工作。
  test('should work on element', () => {
    const hooks: VNodeProps = {
      onVnodeBeforeMount: vi.fn<(vnode: VNode) => void>(),
      onVnodeMounted: vi.fn<(vnode: VNode) => void>(),
      onVnodeBeforeUpdate: vi.fn(vnode => {
        expect((vnode.el as TestElement).children[0]).toMatchObject({
          type: TestNodeTypes.TEXT,
          text: 'foo',
        })
      }),
      onVnodeUpdated: vi.fn(vnode => {
        expect((vnode.el as TestElement).children[0]).toMatchObject({
          type: TestNodeTypes.TEXT,
          text: 'bar',
        })
      }),
      onVnodeBeforeUnmount: vi.fn<(vnode: VNode) => void>(),
      onVnodeUnmounted: vi.fn<(vnode: VNode) => void>(),
    }

    assertHooks(hooks, h('div', hooks, 'foo'), h('div', hooks, 'bar'))
  })

  // 测试场景：VNode 生命周期钩子同样能够作用于组件 VNode。
  test('should work on component', () => {
    const Comp = (props: { msg: string }) => props.msg

    const hooks: VNodeProps = {
      onVnodeBeforeMount: vi.fn<(vnode: VNode) => void>(),
      onVnodeMounted: vi.fn<(vnode: VNode) => void>(),
      onVnodeBeforeUpdate: vi.fn(vnode => {
        expect(vnode.el as TestElement).toMatchObject({
          type: TestNodeTypes.TEXT,
          text: 'foo',
        })
      }),
      onVnodeUpdated: vi.fn(vnode => {
        expect(vnode.el as TestElement).toMatchObject({
          type: TestNodeTypes.TEXT,
          text: 'bar',
        })
      }),
      onVnodeBeforeUnmount: vi.fn<(vnode: VNode) => void>(),
      onVnodeUnmounted: vi.fn<(vnode: VNode) => void>(),
    }

    assertHooks(
      hooks,
      h(Comp, {
        ...hooks,
        msg: 'foo',
      }),
      h(Comp, {
        ...hooks,
        msg: 'bar',
      }),
    )
  })
})
