/**
 * 通过 withDirectives 给元素或组件 VNode 绑定指令，在各钩子内检查宿主节点和 binding。
 * runtime-test 渲染夹具另行验证函数简写、组件根指令合并、暂停追踪及 expose 后的公开实例。
 */
import {
  type DirectiveBinding,
  type DirectiveHook,
  type VNode,
  defineComponent,
  h,
  nextTick,
  nodeOps,
  ref,
  render,
  withDirectives,
} from '@vue/runtime-test'
import {
  type ComponentInternalInstance,
  currentInstance,
} from '../src/component'

// 指令绑定快照与宿主元素生命周期。
describe('directives', () => {
  /** 为 div 绑定 count:0、arg:foo、ok 修饰符，挂载、递增后刷新、再卸载；各钩子检查节点插入/更新/删除时机及 binding/VNode 快照，验证元素指令的阶段顺序。 */
  it('should work', async () => {
    const count = ref(0)

    /** 检查 binding 的当前 count 值、foo 参数、ok 修饰符与所属组件公开代理；由多个生命周期钩子共用。 */
    function assertBindings(binding: DirectiveBinding) {
      expect(binding.value).toBe(count.value)
      expect(binding.arg).toBe('foo')
      expect(binding.instance).toBe(_instance && _instance.proxy)
      expect(binding.modifiers && binding.modifiers.ok).toBe(true)
    }

    const beforeMount = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      // 插入前节点还没有父容器。
      expect(el.parentNode).toBe(null)
      expect(root.children.length).toBe(0)

      assertBindings(binding)

      expect(vnode).toBe(_vnode)
      expect(prevVNode).toBe(null)
    }) as DirectiveHook)

    const mounted = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      // mounted 时节点已经插入。
      expect(el.parentNode).toBe(root)
      expect(root.children[0]).toBe(el)

      assertBindings(binding)

      expect(vnode).toBe(_vnode)
      expect(prevVNode).toBe(null)
    }) as DirectiveHook)

    const beforeUpdate = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      expect(el.parentNode).toBe(root)
      expect(root.children[0]).toBe(el)

      // beforeUpdate 仍应看到旧文本。
      expect(el.children[0].text).toBe(`${count.value - 1}`)

      assertBindings(binding)

      expect(vnode).toBe(_vnode)
      expect(prevVNode).toBe(_prevVnode)
    }) as DirectiveHook)

    const updated = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      expect(el.parentNode).toBe(root)
      expect(root.children[0]).toBe(el)

      // updated 应看到本轮新文本。
      expect(el.children[0].text).toBe(`${count.value}`)

      assertBindings(binding)

      expect(vnode).toBe(_vnode)
      expect(prevVNode).toBe(_prevVnode)
    }) as DirectiveHook)

    const beforeUnmount = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      // 删除前节点仍在父容器。
      expect(el.parentNode).toBe(root)
      expect(root.children[0]).toBe(el)

      assertBindings(binding)

      expect(vnode).toBe(_vnode)
      expect(prevVNode).toBe(null)
    }) as DirectiveHook)

    const unmounted = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      // unmounted 时该无过渡节点已删除。
      expect(el.parentNode).toBe(null)
      expect(root.children.length).toBe(0)

      assertBindings(binding)

      expect(vnode).toBe(_vnode)
      expect(prevVNode).toBe(null)
    }) as DirectiveHook)

    const dir = {
      beforeMount,
      mounted,
      beforeUpdate,
      updated,
      beforeUnmount,
      unmounted,
    }

    let _instance: ComponentInternalInstance | null = null
    let _vnode: VNode | null = null
    let _prevVnode: VNode | null = null
    const Comp = {
      /** 保存当前内部实例，供 binding.instance 身份比较。 */
      setup() {
        _instance = currentInstance
      },
      /** 保存新旧元素 VNode，并把 count、foo 与 ok 指令元组绑定 div，供各阶段比较快照。 */
      render() {
        _prevVnode = _vnode
        _vnode = withDirectives(h('div', count.value), [
          [
            dir,
            // 指令绑定值
            count.value,
            // 指令实参
            'foo',
            // 指令修饰符
            { ok: true },
          ],
        ])
        return _vnode
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect(beforeMount).toHaveBeenCalledTimes(1)
    expect(mounted).toHaveBeenCalledTimes(1)

    count.value++
    await nextTick()
    expect(beforeUpdate).toHaveBeenCalledTimes(1)
    expect(updated).toHaveBeenCalledTimes(1)

    render(null, root)
    expect(beforeUnmount).toHaveBeenCalledTimes(1)
    expect(unmounted).toHaveBeenCalledTimes(1)
  })

  /** 把函数指令绑定 div，挂载后递增 count 并刷新；检查函数共调用两次、binding 与前后 VNode 正确，验证简写只用于 mounted/updated。 */
  it('should work with a function directive', async () => {
    const count = ref(0)

    /** 检查函数指令收到的值、参数、修饰符与所属公开实例，供 mounted/updated 共用。 */
    function assertBindings(binding: DirectiveBinding) {
      expect(binding.value).toBe(count.value)
      expect(binding.arg).toBe('foo')
      expect(binding.instance).toBe(_instance && _instance.proxy)
      expect(binding.modifiers && binding.modifiers.ok).toBe(true)
    }

    const fn = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      expect(el.parentNode).toBe(root)

      assertBindings(binding)

      expect(vnode).toBe(_vnode)
      expect(prevVNode).toBe(_prevVnode)
    }) as DirectiveHook)

    let _instance: ComponentInternalInstance | null = null
    let _vnode: VNode | null = null
    let _prevVnode: VNode | null = null
    const Comp = {
      /** 保存当前内部实例，供函数指令 binding.instance 比较。 */
      setup() {
        _instance = currentInstance
      },
      /** 保存新旧 VNode 并把函数简写指令绑定 div，构造 mounted/updated 两次调用。 */
      render() {
        _prevVnode = _vnode
        _vnode = withDirectives(h('div', count.value), [
          [
            fn,
            // 指令绑定值
            count.value,
            // 指令实参
            'foo',
            // 指令修饰符
            { ok: true },
          ],
        ])
        return _vnode
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect(fn).toHaveBeenCalledTimes(1)

    count.value++
    await nextTick()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  /** 把指令绑定 Child 组件 VNode，Child 渲染 div；挂载、更新和卸载时检查真实元素、binding 与 VNode 类型，验证指令下传到组件单根。 */
  it('should work on component vnode', async () => {
    const count = ref(0)

    /** 检查组件 VNode 指令下传后的 binding 值、参数、修饰符和父组件公开实例。 */
    function assertBindings(binding: DirectiveBinding) {
      expect(binding.value).toBe(count.value)
      expect(binding.arg).toBe('foo')
      expect(binding.instance).toBe(_instance && _instance.proxy)
      expect(binding.modifiers && binding.modifiers.ok).toBe(true)
    }

    const beforeMount = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      // 插入前节点还没有父容器。
      expect(el.parentNode).toBe(null)
      expect(root.children.length).toBe(0)

      assertBindings(binding)

      expect(vnode.type).toBe(_vnode!.type)
      expect(prevVNode).toBe(null)
    }) as DirectiveHook)

    const mounted = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      // mounted 时节点已经插入。
      expect(el.parentNode).toBe(root)
      expect(root.children[0]).toBe(el)

      assertBindings(binding)

      expect(vnode.type).toBe(_vnode!.type)
      expect(prevVNode).toBe(null)
    }) as DirectiveHook)

    const beforeUpdate = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      expect(el.parentNode).toBe(root)
      expect(root.children[0]).toBe(el)

      // beforeUpdate 仍应看到旧文本。
      expect(el.children[0].text).toBe(`${count.value - 1}`)

      assertBindings(binding)

      expect(vnode.type).toBe(_vnode!.type)
      expect(prevVNode!.type).toBe(_prevVnode!.type)
    }) as DirectiveHook)

    const updated = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      expect(el.parentNode).toBe(root)
      expect(root.children[0]).toBe(el)

      // updated 应看到本轮新文本。
      expect(el.children[0].text).toBe(`${count.value}`)

      assertBindings(binding)

      expect(vnode.type).toBe(_vnode!.type)
      expect(prevVNode!.type).toBe(_prevVnode!.type)
    }) as DirectiveHook)

    const beforeUnmount = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      // 删除前节点仍在父容器。
      expect(el.parentNode).toBe(root)
      expect(root.children[0]).toBe(el)

      assertBindings(binding)

      expect(vnode.type).toBe(_vnode!.type)
      expect(prevVNode).toBe(null)
    }) as DirectiveHook)

    const unmounted = vi.fn(((el, binding, vnode, prevVNode) => {
      expect(el.tag).toBe('div')
      // unmounted 时该无过渡节点已删除。
      expect(el.parentNode).toBe(null)
      expect(root.children.length).toBe(0)

      assertBindings(binding)

      expect(vnode.type).toBe(_vnode!.type)
      expect(prevVNode).toBe(null)
    }) as DirectiveHook)

    const dir = {
      beforeMount,
      mounted,
      beforeUpdate,
      updated,
      beforeUnmount,
      unmounted,
    }

    let _instance: ComponentInternalInstance | null = null
    let _vnode: VNode | null = null
    let _prevVnode: VNode | null = null

    /** 按 count 渲染 div 并保存前后 VNode，使指令钩子检查真实子树类型。 */
    const Child = (props: { count: number }) => {
      _prevVnode = _vnode
      _vnode = h('div', props.count)
      return _vnode
    }

    const Comp = {
      /** 保存绑定指令的父组件内部实例。 */
      setup() {
        _instance = currentInstance
      },
      /** 把完整指令元组绑定 Child 组件 VNode，构造指令下传单根元素。 */
      render() {
        return withDirectives(h(Child, { count: count.value }), [
          [
            dir,
            // 指令绑定值
            count.value,
            // 指令实参
            'foo',
            // 指令修饰符
            { ok: true },
          ],
        ])
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect(beforeMount).toHaveBeenCalledTimes(1)
    expect(mounted).toHaveBeenCalledTimes(1)

    count.value++
    await nextTick()
    expect(beforeUpdate).toHaveBeenCalledTimes(1)
    expect(updated).toHaveBeenCalledTimes(1)

    render(null, root)
    expect(beforeUnmount).toHaveBeenCalledTimes(1)
    expect(unmounted).toHaveBeenCalledTimes(1)
  })

  // #2298
  /** 父把 d1 绑定 Comp，Comp 自己给根 div 绑定 d2；挂载后检查两个 mounted 都调用，验证组件根指令合并。 */
  it('directive merging on component root', () => {
    const d1 = {
      mounted: vi.fn(),
    }
    const d2 = {
      mounted: vi.fn(),
    }
    const Comp = {
      /** 给组件自身的 div 根绑定 d2，构造内部指令。 */
      render() {
        return withDirectives(h('div'), [[d2]])
      },
    }

    const App = {
      name: 'App',
      /** 给 Comp 绑定父级 d1 后放入 div，构造组件根指令合并。 */
      render() {
        return h('div', [withDirectives(h(Comp), [[d1]])])
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(d1.mounted).toHaveBeenCalled()
    expect(d2.mounted).toHaveBeenCalled()
  })

  /** App render 只读取 text，beforeUpdate 递增独立 count；text 改为 foo 后刷新，检查钩子只调用一次与 count:1，验证指令钩子不增加组件渲染依赖。 */
  test('should disable tracking inside directive lifecycle hooks', async () => {
    const count = ref(0)
    const text = ref('')
    const beforeUpdate = vi.fn(() => count.value++)

    const App = {
      /** 只读取 text 渲染 p，再绑定会修改独立 count 的 beforeUpdate 指令。 */
      render() {
        return withDirectives(h('p', text.value), [
          [
            {
              beforeUpdate,
            },
          ],
        ])
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(beforeUpdate).toHaveBeenCalledTimes(0)
    expect(count.value).toBe(0)

    text.value = 'foo'
    await nextTick()
    expect(beforeUpdate).toHaveBeenCalledTimes(1)
    expect(count.value).toBe(1)
  })

  /** App setup expose msg:Test，内部 p 的指令 mounted 读取 binding.instance.msg；检查结果为 Test，验证指令取得关闭实例的公开代理。 */
  test('should receive exposeProxy for closed instances', async () => {
    let res: string
    const App = defineComponent({
      /** 公开 msg:Test，返回带 mounted 指令的 p，使 binding.instance 读取 exposeProxy。 */
      setup(_, { expose }) {
        expose({
          msg: 'Test',
        })

        return () =>
          withDirectives(h('p', 'Lore Ipsum'), [
            [
              {
                /** 从指令公开实例读取 msg 并保存到 res，供 expose 值断言。 */
                mounted(el, { instance }) {
                  res = (instance as any).msg as string
                },
              },
            ],
          ])
      },
    })
    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(res!).toBe('Test')
  })

  /** withDirectives 的第一项为 undefined、第二项是有效 d1；挂载后检查 d1.mounted 调用，验证未知指令项不阻断有效项。 */
  test('should not throw with unknown directive', async () => {
    const d1 = {
      mounted: vi.fn(),
    }
    const App = {
      name: 'App',
      /** 将 undefined 与有效 d1 一同绑定 div，模拟未知指令的编译输出。 */
      render() {
        // 模拟编译器为未知指令生成的 undefined 项。
        return withDirectives(h('div'), [[undefined], [d1]])
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(d1.mounted).toHaveBeenCalled()
  })
})
