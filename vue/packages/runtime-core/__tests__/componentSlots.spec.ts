/**
 * 检查 initSlots/updateSlots 的归一化结果、旧 slot 清理、稳定标记与调用时机警告。
 */
import {
  createApp,
  getCurrentInstance,
  h,
  nextTick,
  nodeOps,
  ref,
  render,
  serializeInner,
  useSlots,
} from '@vue/runtime-test'
import { createBlock, normalizeVNode } from '../src/vnode'
import { createSlots } from '../src/helpers/createSlots'

// slot 对象的初始化、更新和调用时机。
describe('component: slots', () => {
  /**
   * 通过手写 h 挂载最小组件并捕获内部实例，返回它供各用例读取 slots；slots 参数可为对象或普通 children，不人为启用 optimized 模式。
   */
  function renderWithSlots(slots: any): any {
    let instance: any
    const Comp = {
      /**
       * 渲染一个 div 作为最小宿主子树；调用方只通过捕获的内部实例检查 slots 标准化结果。
       */
      render() {
        instance = getCurrentInstance()
        return h('div')
      },
    }

    render(h(Comp, null, slots), nodeOps.createElement('div'))
    return instance
  }

  // 通过 createBlock 传入带 _ 标记的编译 slot，检查 instance.slots 保留其内容。
  test('initSlots: instance.slots should be set correctly', () => {
    let instance: any
    const Comp = {
      /**
       * 渲染结果为 `h('div')`；同时记录 `instance` 供 render 后的断言检查。
       */
      render() {
        instance = getCurrentInstance()
        return h('div')
      },
    }
    const slots = {
      /** 空 foo slot 函数，供初始化时比较函数身份；本例不以返回内容验证渲染。 */ foo: () => {},
      _: 1
    }
    render(createBlock(Comp, null, slots), nodeOps.createElement('div'))
    expect(instance.slots).toMatchObject(slots)
  })

  // 手写 h 传入只有 _ 编译标记的 slots，覆盖非优化挂载时跳过内部键的分支；toMatchObject({}) 不检查对象是否仍含 _，因此不能单独证明标记已移除。
  test('initSlots: instance.slots should remove compiler marker if parent is using manual render function', () => {
    const { slots } = renderWithSlots({ _: 1 })
    expect(slots).toMatchObject({})
  })

  // 编译 slot 的 _ 标记存在但不可枚举，Object.keys 只列出用户定义的 foo。
  test('initSlots: ensure compiler marker non-enumerable', () => {
    const Comp = {
      /**
       * 渲染结果为 `h('div')`。
       */
      render() {
        const slots = useSlots()
        // 只枚举用户 slot 名 foo，不显示内部稳定性标记。
        expect(Object.keys(slots)).toEqual(['foo'])

        // 优化更新仍需要 _，所以它应存在但不可枚举。
        expect(slots).toHaveProperty('_')
        expect(Object.getOwnPropertyDescriptor(slots, '_')!.enumerable).toBe(
          false,
        )
        return h('div')
      },
    }
    const slots = {
      /** 空 foo 夹具，保留本例的选项/回调形状；函数自身不产生副作用。 */ foo: () => {},
      _: 1
    }
    render(createBlock(Comp, null, slots), nodeOps.createElement('div'))
  })

  // 空 slot 不建立函数；字符串与数组被包装为返回 VNode 数组的函数，并发出非函数 slot 警告。
  test('initSlots: should normalize object slots (when value is null, string, array)', () => {
    const { slots } = renderWithSlots({
      _inner: '_inner',
      foo: null,
      header: 'header',
      footer: ['f1', 'f2'],
    })

    expect(
      '[Vue warn]: Non-function value encountered for slot "_inner". Prefer function slots for better performance.',
    ).toHaveBeenWarned()

    expect(
      '[Vue warn]: Non-function value encountered for slot "header". Prefer function slots for better performance.',
    ).toHaveBeenWarned()

    expect(
      '[Vue warn]: Non-function value encountered for slot "footer". Prefer function slots for better performance.',
    ).toHaveBeenWarned()

    expect(slots).not.toHaveProperty('foo')
    expect(slots._inner()).toMatchObject([normalizeVNode('_inner')])
    expect(slots.header()).toMatchObject([normalizeVNode('header')])
    expect(slots.footer()).toMatchObject([
      normalizeVNode('f1'),
      normalizeVNode('f2'),
    ])
  })

  // header 函数返回字符串，归一化后的 slot 函数返回对应的 VNode 数组。
  test('initSlots: should normalize object slots (when value is function)', () => {
    let proxy: any
    const Comp = {
      /**
       * 渲染结果为 `h('div')`；同时记录 `proxy` 供 render 后的断言检查。
       */
      render() {
        proxy = getCurrentInstance()
        return h('div')
      },
    }

    render(
      h(Comp, null, {
        /**
         * 返回 `'header'`。
         */
        header: () => 'header',
      }),
      nodeOps.createElement('div'),
    )

    expect(proxy.slots.header()).toMatchObject([normalizeVNode('header')])
  })

  // 直接传入 VNode 数组时，建立返回该数组的 default slot，并警告非函数输入。
  test('initSlots: instance.slots should be set correctly (when vnode.shapeFlag is not SLOTS_CHILDREN)', () => {
    const { slots } = renderWithSlots([h('span')])

    expect(
      '[Vue warn]: Non-function value encountered for default slot. Prefer function slots for better performance.',
    ).toHaveBeenWarned()

    expect(slots.default()).toMatchObject([normalizeVNode(h('span'))])
  })

  // 使用动态编译 slot 标记与 createSlots；条件切换后删除 one 并添加 two。
  test('updateSlots: instance.slots should be updated correctly (when slotType is number)', async () => {
    const flag1 = ref(true)

    let instance: any
    /**
     * 修改或记录 `instance`；返回 `'child'`。
     */
    const Child = () => {
      instance = getCurrentInstance()
      return 'child'
    }

    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `[ h(Child, null, createSlots({ _: 2 as any }, [ flag1.value ? { name: 'one', fn: () => [h('span')], } : { name: 'two', fn: () => [h('div')], }, ])), ]`。
       */
      setup() {
        return () => [
          h(
            Child,
            null,
            createSlots({ _: 2 as any }, [
              flag1.value
                ? {
                    name: 'one',
                    /**
                     * 返回 `[h('span')]`。
                     */
                    fn: () => [h('span')],
                  }
                : {
                    name: 'two',
                    /**
                     * 返回 `[h('div')]`。
                     */
                    fn: () => [h('div')],
                  },
            ]),
          ),
        ]
      },
    }
    render(h(Comp), nodeOps.createElement('div'))

    expect(instance.slots).toHaveProperty('one')
    expect(instance.slots).not.toHaveProperty('two')

    flag1.value = false
    await nextTick()

    expect(instance.slots).not.toHaveProperty('one')
    expect(instance.slots).toHaveProperty('two')
  })

  // 未带编译标记的 slot 对象从 header 切换为 footer，检查旧键删除与新值归一化。
  test('updateSlots: instance.slots should be updated correctly (when slotType is null)', async () => {
    const flag1 = ref(true)

    let instance: any
    /**
     * 修改或记录 `instance`；返回 `'child'`。
     */
    const Child = () => {
      instance = getCurrentInstance()
      return 'child'
    }

    const oldSlots = {
      header: 'header',
      footer: undefined,
    }
    const newSlots = {
      header: undefined,
      footer: 'footer',
    }

    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `[ h(Child, { n: flag1.value }, flag1.value ? oldSlots : newSlots), ]`。
       */
      setup() {
        return () => [
          h(Child, { n: flag1.value }, flag1.value ? oldSlots : newSlots),
        ]
      },
    }
    render(h(Comp), nodeOps.createElement('div'))

    expect(instance.slots).toHaveProperty('header')
    expect(instance.slots).not.toHaveProperty('footer')

    flag1.value = false
    await nextTick()

    expect(
      '[Vue warn]: Non-function value encountered for slot "header". Prefer function slots for better performance.',
    ).toHaveBeenWarned()

    expect(
      '[Vue warn]: Non-function value encountered for slot "footer". Prefer function slots for better performance.',
    ).toHaveBeenWarned()

    expect(instance.slots).not.toHaveProperty('header')
    expect(instance.slots.footer()).toMatchObject([normalizeVNode('footer')])
  })

  // 数组 children 从 header 切换为 footer，default slot 随之更新并发出非函数输入警告。
  test('updateSlots: instance.slots should be update correctly (when vnode.shapeFlag is not SLOTS_CHILDREN)', async () => {
    const flag1 = ref(true)

    let instance: any
    /**
     * 修改或记录 `instance`；返回 `'child'`。
     */
    const Child = () => {
      instance = getCurrentInstance()
      return 'child'
    }

    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `[ h(Child, { n: flag1.value }, flag1.value ? ['header'] : ['footer']), ]`。
       */
      setup() {
        return () => [
          h(Child, { n: flag1.value }, flag1.value ? ['header'] : ['footer']),
        ]
      },
    }
    render(h(Comp), nodeOps.createElement('div'))

    expect(instance.slots.default()).toMatchObject([normalizeVNode('header')])

    flag1.value = false
    await nextTick()

    expect(
      '[Vue warn]: Non-function value encountered for default slot. Prefer function slots for better performance.',
    ).toHaveBeenWarned()

    expect(instance.slots.default()).toMatchObject([normalizeVNode('footer')])
  })

  // $stable: true 时，父级只更新无关状态不增加子组件渲染次数；子组件 prop 改变仍会更新。
  test('should respect $stable flag with a value of true', async () => {
    const flag1 = ref(1)
    const flag2 = ref(2)
    const spy = vi.fn()

    /**
     * 返回 `'child'`。
     */
    const Child = () => {
      spy()
      return 'child'
    }

    const App = {
      /**
       * 返回渲染闭包，执行时产出 `[ flag1.value, h(Child, { n: flag2.value }, { foo: () => 'foo', $stable: true, }), ]`。
       */
      setup() {
        return () => [
          flag1.value,
          h(
            Child,
            { n: flag2.value },
            {
              /**
               * 返回 `'foo'`。
               */
              foo: () => 'foo',
              $stable: true,
            },
          ),
        ]
      },
    }

    render(h(App), nodeOps.createElement('div'))
    expect(spy).toHaveBeenCalledTimes(1)

    // 父级无关状态变化，传给 Child 的 n 未变且 slots 声明稳定。
    // Child render 次数应保持不变。
    flag1.value++
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)

    // 父级改变传给 Child 的 n，即使 slot 稳定也应更新。
    // Child render 次数应增加一次。
    flag2.value++
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  // $stable: false 时，父级无关状态或子组件 prop 改变都会让子组件重新渲染。
  test('should respect $stable flag with a value of false', async () => {
    const flag1 = ref(1)
    const flag2 = ref(2)
    const spy = vi.fn()

    /**
     * 返回 `'child'`。
     */
    const Child = () => {
      spy()
      return 'child'
    }

    const App = {
      /**
       * 返回渲染闭包，执行时产出 `[ flag1.value, h(Child, { n: flag2.value }, { foo: () => 'foo', $stable: false, }), ]`。
       */
      setup() {
        return () => [
          flag1.value,
          h(
            Child,
            { n: flag2.value },
            {
              /**
               * 返回 `'foo'`。
               */
              foo: () => 'foo',
              $stable: false,
            },
          ),
        ]
      },
    }

    render(h(App), nodeOps.createElement('div'))
    expect(spy).toHaveBeenCalledTimes(1)

    // 父级无关状态变化，n 未变但 slots 未声明稳定，应强制更新 Child。
    // Child render 次数应增加一次。
    flag1.value++
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(2)

    // 父级改变传给 Child 的 n，即使 slot 稳定也应更新。
    // Child render 次数应增加一次。
    flag2.value++
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(3)
  })

  // 外层 App.setup 挂载另一应用，其内部 Comp 在渲染函数中调用 slot，不触发调用时机警告。
  test('should not warn when mounting another app in setup', () => {
    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `slots.default?.()`。
       */
      setup(_: any, { slots }: any) {
        return () => slots.default?.()
      },
    }

    /**
     * 在当前调用栈中挂载独立 App，其内部组件在 render 调用 default slot，供跨应用实例窗口的警告断言使用。
     */
    const mountComp = () => {
      createApp({
        /**
         * 返回渲染闭包，执行时产出 `h(Comp, () => 'msg')`。
         */
        setup() {
          return () => h(Comp, () => 'msg')
        },
      }).mount(nodeOps.createElement('div'))
    }

    const App = {
      /**
       * 调用 `mountComp()` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        mountComp()
        return () => null
      },
    }

    createApp(App).mount(nodeOps.createElement('div'))
    expect(
      'Slot "default" invoked outside of the render function',
    ).not.toHaveBeenWarned()
  })

  // 直接在 Comp.setup 调用 default slot，触发“在渲染函数外调用”的警告。
  test('basic warn', () => {
    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `null`。
       */
      setup(_: any, { slots }: any) {
        slots.default && slots.default()
        return () => null
      },
    }

    const App = {
      /**
       * 返回渲染闭包，执行时产出 `h(Comp, () => h('div'))`。
       */
      setup() {
        return () => h(Comp, () => h('div'))
      },
    }

    createApp(App).mount(nodeOps.createElement('div'))
    expect(
      'Slot "default" invoked outside of the render function',
    ).toHaveBeenWarned()
  })

  // 外层 App.setup 挂载另一应用，其内部 Comp 在 setup 调用 slot，仍应触发调用时机警告。
  test('basic warn when mounting another app in setup', () => {
    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `null`。
       */
      setup(_: any, { slots }: any) {
        slots.default?.()
        return () => null
      },
    }

    /**
     * 同步挂载独立 App，其内部组件在 setup 调用 default slot，确保跨应用也保留 render 外调用警告。
     */
    const mountComp = () => {
      createApp({
        /**
         * 返回渲染闭包，执行时产出 `h(Comp, () => 'msg')`。
         */
        setup() {
          return () => h(Comp, () => 'msg')
        },
      }).mount(nodeOps.createElement('div'))
    }

    const App = {
      /**
       * 调用 `mountComp()` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        mountComp()
        return () => null
      },
    }

    createApp(App).mount(nodeOps.createElement('div'))
    expect(
      'Slot "default" invoked outside of the render function',
    ).toHaveBeenWarned()
  })

  // 外层 setup 调用 render 挂载组件，slot 随后在该组件的渲染函数中调用，不触发警告。
  test('should not warn when render in setup', () => {
    const container = {
      /**
       * 返回渲染闭包，执行时产出 `slots.default && slots.default()`。
       */
      setup(_: any, { slots }: any) {
        return () => slots.default && slots.default()
      },
    }

    const comp = h(container, null, () => h('div'))

    const App = {
      /**
       * 调用 `render(h(comp), nodeOps.createElement('div'))` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        render(h(comp), nodeOps.createElement('div'))
        return () => null
      },
    }

    createApp(App).mount(nodeOps.createElement('div'))
    expect(
      'Slot "default" invoked outside of the render function',
    ).not.toHaveBeenWarned()
  })

  // 外层 setup 调用 render 挂载组件，该组件在自身 setup 调用 slot，触发调用时机警告。
  test('basic warn when render in setup', () => {
    const container = {
      /**
       * 返回渲染闭包，执行时产出 `null`。
       */
      setup(_: any, { slots }: any) {
        slots.default && slots.default()
        return () => null
      },
    }

    const comp = h(container, null, () => h('div'))

    const App = {
      /**
       * 调用 `render(h(comp), nodeOps.createElement('div'))` 完成本例的初始化登记或读取；返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        render(h(comp), nodeOps.createElement('div'))
        return () => null
      },
    }

    createApp(App).mount(nodeOps.createElement('div'))
    expect(
      'Slot "default" invoked outside of the render function',
    ).toHaveBeenWarned()
  })

  // _foo 仍是可调用的用户 slot；以下划线开头不会让它被当成内部标记跳过。
  test('slot name starts with underscore', () => {
    const Comp = {
      /**
       * 返回渲染闭包，执行时产出 `slots._foo()`。
       */
      setup(_: any, { slots }: any) {
        return () => slots._foo()
      },
    }

    const App = {
      /**
       * 返回渲染闭包，执行时产出 `h(Comp, null, { _foo: () => 'foo' })`。
       */
      setup() {
        return () => h(Comp, null, {
          /** 返回 `'foo'`，供验证以下划线开头的用户插槽仍可被访问。 */
          _foo: () => 'foo'
        })
      },
    }

    const root = nodeOps.createElement('div')
    createApp(App).mount(root)
    expect(serializeInner(root)).toBe('foo')
  })
})
