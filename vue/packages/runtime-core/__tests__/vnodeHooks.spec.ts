import {
  type TestElement,
  TestNodeTypes,
  type VNode,
  type VNodeProps,
  h,
  nodeOps,
  render,
} from '@vue/runtime-test'

// VNode 钩子的执行阶段与新旧 VNode 参数。
describe('renderer: vnode hooks', () => {
  /** 依次挂载 vnode1、更新到 vnode2、卸载，检查六种 hooks 的阶段、调用次数和新旧 VNode 实参；本夹具没有过渡动画。 */
  function assertHooks(hooks: VNodeProps, vnode1: VNode, vnode2: VNode) {
    const root = nodeOps.createElement('div')
    render(vnode1, root)
    expect(hooks.onVnodeBeforeMount).toHaveBeenCalledWith(vnode1, null)
    expect(hooks.onVnodeMounted).toHaveBeenCalledWith(vnode1, null)
    expect(hooks.onVnodeBeforeUpdate).not.toHaveBeenCalled()
    expect(hooks.onVnodeUpdated).not.toHaveBeenCalled()
    expect(hooks.onVnodeBeforeUnmount).not.toHaveBeenCalled()
    expect(hooks.onVnodeUnmounted).not.toHaveBeenCalled()

    // 更新到 vnode2
    render(vnode2, root)
    expect(hooks.onVnodeBeforeMount).toHaveBeenCalledTimes(1)
    expect(hooks.onVnodeMounted).toHaveBeenCalledTimes(1)
    expect(hooks.onVnodeBeforeUpdate).toHaveBeenCalledWith(vnode2, vnode1)
    expect(hooks.onVnodeUpdated).toHaveBeenCalledWith(vnode2, vnode1)
    expect(hooks.onVnodeBeforeUnmount).not.toHaveBeenCalled()
    expect(hooks.onVnodeUnmounted).not.toHaveBeenCalled()

    // 卸载 vnode2
    render(null, root)
    expect(hooks.onVnodeBeforeMount).toHaveBeenCalledTimes(1)
    expect(hooks.onVnodeMounted).toHaveBeenCalledTimes(1)
    expect(hooks.onVnodeBeforeUpdate).toHaveBeenCalledTimes(1)
    expect(hooks.onVnodeUpdated).toHaveBeenCalledTimes(1)
    expect(hooks.onVnodeBeforeUnmount).toHaveBeenCalledWith(vnode2, null)
    expect(hooks.onVnodeUnmounted).toHaveBeenCalledWith(vnode2, null)
  }

  // 元素 VNode 的 beforeUpdate 看到旧文本，updated 看到新文本；挂载和卸载钩子只执行对应阶段。
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

  // 组件 VNode 同样触发这些钩子，beforeUpdate 和 updated 分别看到旧、新宿主文本。
  test('should work on component', () => {
    /** 直接返回 props.msg 文本的函数组件，供比较组件 VNode 钩子的宿主文本。 */
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
