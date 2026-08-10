/**
 * 测试阅读说明：本文件验证 `runtime-core/componentSlots` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
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

// 测试组：组件：slots。
describe('component: slots', () => {
  function renderWithSlots(slots: any): any {
    let instance: any
    const Comp = {
      render() {
        instance = getCurrentInstance()
        return h('div')
      },
    }

    render(h(Comp, null, slots), nodeOps.createElement('div'))
    return instance
  }

  // 测试场景：initSlots：instance.slots应该正确设置。
  test('initSlots: instance.slots should be set correctly', () => {
    let instance: any
    const Comp = {
      render() {
        instance = getCurrentInstance()
        return h('div')
      },
    }
    const slots = { foo: () => {}, _: 1 }
    render(createBlock(Comp, null, slots), nodeOps.createElement('div'))
    expect(instance.slots).toMatchObject(slots)
  })

  // 测试场景：initSlots：如果父级正在使用手动渲染函数，instance.slots 应该删除编译器标记。
  test('initSlots: instance.slots should remove compiler marker if parent is using manual render function', () => {
    const { slots } = renderWithSlots({ _: 1 })
    expect(slots).toMatchObject({})
  })

  // 测试场景：initSlots：确保编译器标记不可枚举。
  test('initSlots: ensure compiler marker non-enumerable', () => {
    const Comp = {
      render() {
        const slots = useSlots()
        // Only user-defined slots should be enumerable
        expect(Object.keys(slots)).toEqual(['foo'])

        // Internal compiler markers must still exist but be non-enumerable
        expect(slots).toHaveProperty('_')
        expect(Object.getOwnPropertyDescriptor(slots, '_')!.enumerable).toBe(
          false,
        )
        return h('div')
      },
    }
    const slots = { foo: () => {}, _: 1 }
    render(createBlock(Comp, null, slots), nodeOps.createElement('div'))
  })

  // 测试场景：initSlots：应该规范化对象slots（当值为空、字符串、数组时）。
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

  // 测试场景：initSlots：应该规范化对象slots（当值为函数时）。
  test('initSlots: should normalize object slots (when value is function)', () => {
    let proxy: any
    const Comp = {
      render() {
        proxy = getCurrentInstance()
        return h('div')
      },
    }

    render(
      h(Comp, null, {
        header: () => 'header',
      }),
      nodeOps.createElement('div'),
    )

    expect(proxy.slots.header()).toMatchObject([normalizeVNode('header')])
  })

  // 测试场景：initSlots：instance.slots应该正确设置（当vnode.shapeFlag不是SLOTS_CHILDREN时）。
  test('initSlots: instance.slots should be set correctly (when vnode.shapeFlag is not SLOTS_CHILDREN)', () => {
    const { slots } = renderWithSlots([h('span')])

    expect(
      '[Vue warn]: Non-function value encountered for default slot. Prefer function slots for better performance.',
    ).toHaveBeenWarned()

    expect(slots.default()).toMatchObject([normalizeVNode(h('span'))])
  })

  // 测试场景：updateSlots：instance.slots应该正确更新（当slotType是数字时）。
  test('updateSlots: instance.slots should be updated correctly (when slotType is number)', async () => {
    const flag1 = ref(true)

    let instance: any
    const Child = () => {
      instance = getCurrentInstance()
      return 'child'
    }

    const Comp = {
      setup() {
        return () => [
          h(
            Child,
            null,
            createSlots({ _: 2 as any }, [
              flag1.value
                ? {
                    name: 'one',
                    fn: () => [h('span')],
                  }
                : {
                    name: 'two',
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

  // 测试场景：updateSlots：instance.slots应该正确更新（当slotType为空时）。
  test('updateSlots: instance.slots should be updated correctly (when slotType is null)', async () => {
    const flag1 = ref(true)

    let instance: any
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

  // 测试场景：updateSlots：instance.slots应该正确更新（当vnode.shapeFlag不是SLOTS_CHILDREN时）。
  test('updateSlots: instance.slots should be update correctly (when vnode.shapeFlag is not SLOTS_CHILDREN)', async () => {
    const flag1 = ref(true)

    let instance: any
    const Child = () => {
      instance = getCurrentInstance()
      return 'child'
    }

    const Comp = {
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

  // 测试场景：应遵守值为 true 的 $stable 标志。
  test('should respect $stable flag with a value of true', async () => {
    const flag1 = ref(1)
    const flag2 = ref(2)
    const spy = vi.fn()

    const Child = () => {
      spy()
      return 'child'
    }

    const App = {
      setup() {
        return () => [
          flag1.value,
          h(
            Child,
            { n: flag2.value },
            {
              foo: () => 'foo',
              $stable: true,
            },
          ),
        ]
      },
    }

    render(h(App), nodeOps.createElement('div'))
    expect(spy).toHaveBeenCalledTimes(1)

    // parent re-render, props didn't change, slots are stable
    // -> child should not update
    flag1.value++
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)

    // parent re-render, props changed
    // -> child should update
    flag2.value++
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  // 测试场景：应遵守值为 false 的 $stable 标志。
  test('should respect $stable flag with a value of false', async () => {
    const flag1 = ref(1)
    const flag2 = ref(2)
    const spy = vi.fn()

    const Child = () => {
      spy()
      return 'child'
    }

    const App = {
      setup() {
        return () => [
          flag1.value,
          h(
            Child,
            { n: flag2.value },
            {
              foo: () => 'foo',
              $stable: false,
            },
          ),
        ]
      },
    }

    render(h(App), nodeOps.createElement('div'))
    expect(spy).toHaveBeenCalledTimes(1)

    // parent re-render, props didn't change, slots are not stable
    // -> child should update
    flag1.value++
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(2)

    // parent re-render, props changed
    // -> child should update
    flag2.value++
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(3)
  })

  // 测试场景：在 setup 中挂载另一个应用程序时不应发出警告。
  test('should not warn when mounting another app in setup', () => {
    const Comp = {
      setup(_: any, { slots }: any) {
        return () => slots.default?.()
      },
    }

    const mountComp = () => {
      createApp({
        setup() {
          return () => h(Comp, () => 'msg')
        },
      }).mount(nodeOps.createElement('div'))
    }

    const App = {
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

  // 测试场景：基本警告。
  test('basic warn', () => {
    const Comp = {
      setup(_: any, { slots }: any) {
        slots.default && slots.default()
        return () => null
      },
    }

    const App = {
      setup() {
        return () => h(Comp, () => h('div'))
      },
    }

    createApp(App).mount(nodeOps.createElement('div'))
    expect(
      'Slot "default" invoked outside of the render function',
    ).toHaveBeenWarned()
  })

  // 测试场景：在 setup 中挂载另一个应用程序时的基本警告。
  test('basic warn when mounting another app in setup', () => {
    const Comp = {
      setup(_: any, { slots }: any) {
        slots.default?.()
        return () => null
      },
    }

    const mountComp = () => {
      createApp({
        setup() {
          return () => h(Comp, () => 'msg')
        },
      }).mount(nodeOps.createElement('div'))
    }

    const App = {
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

  // 测试场景：在 setup 中渲染时不应发出警告。
  test('should not warn when render in setup', () => {
    const container = {
      setup(_: any, { slots }: any) {
        return () => slots.default && slots.default()
      },
    }

    const comp = h(container, null, () => h('div'))

    const App = {
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

  // 测试场景：在 setup 中渲染时的基本警告。
  test('basic warn when render in setup', () => {
    const container = {
      setup(_: any, { slots }: any) {
        slots.default && slots.default()
        return () => null
      },
    }

    const comp = h(container, null, () => h('div'))

    const App = {
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

  // 测试场景：slot 名称以下划线开头。
  test('slot name starts with underscore', () => {
    const Comp = {
      setup(_: any, { slots }: any) {
        return () => slots._foo()
      },
    }

    const App = {
      setup() {
        return () => h(Comp, null, { _foo: () => 'foo' })
      },
    }

    const root = nodeOps.createElement('div')
    createApp(App).mount(root)
    expect(serializeInner(root)).toBe('foo')
  })
})
