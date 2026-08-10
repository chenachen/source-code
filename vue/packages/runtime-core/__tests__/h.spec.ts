/**
 * 测试阅读说明：本文件验证 `runtime-core/h` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { h } from '../src/h'
import { createVNode } from '../src/vnode'
import type { RawSlots } from '../src/componentSlots'

// Since h is a thin layer on top of createVNode, we are only testing its
// own logic here. Details of vnode creation is tested in vnode.spec.ts.
// 测试组：h 函数各重载对 type、props、children 和 slot 参数的消歧。
describe('renderer: h', () => {
  // 测试场景：仅输入。
  test('type only', () => {
    expect(h('div')).toMatchObject(createVNode('div'))
  })

  // 测试场景：类型+props。
  test('type + props', () => {
    expect(h('div', { id: 'foo' })).toMatchObject(
      createVNode('div', { id: 'foo' }),
    )
  })

  // 测试场景：类型 + 省略 props。
  test('type + omit props', () => {
    // array
    expect(h('div', ['foo'])).toMatchObject(createVNode('div', null, ['foo']))
    // default slot
    const Component = { template: '<br />' }
    const slot = () => {}
    expect(h(Component, slot)).toMatchObject(createVNode(Component, null, slot))
    // single vnode
    const vnode = h('div')
    expect(h('div', vnode)).toMatchObject(createVNode('div', null, [vnode]))
    // text
    expect(h('div', 'foo')).toMatchObject(createVNode('div', null, 'foo'))
  })

  // 测试场景：h(type, props, children) 三参数重载。
  test('type + props + children', () => {
    // array
    expect(h('div', {}, ['foo'])).toMatchObject(createVNode('div', {}, ['foo']))
    // slots
    const slots = {} as RawSlots
    expect(h('div', {}, slots)).toMatchObject(createVNode('div', {}, slots))
    const Component = { template: '<br />' }
    expect(h(Component, {}, slots)).toMatchObject(
      createVNode(Component, {}, slots),
    )
    // default slot
    const slot = () => {}
    expect(h(Component, {}, slot)).toMatchObject(
      createVNode(Component, {}, slot),
    )
    // single vnode
    const vnode = h('div')
    expect(h('div', {}, vnode)).toMatchObject(createVNode('div', {}, [vnode]))
    // text
    expect(h('div', {}, 'foo')).toMatchObject(createVNode('div', {}, 'foo'))
  })

  // 测试场景：命名为 slots，props 为空。
  test('named slots with null props', () => {
    const Component = { template: '<br />' }
    const slot = () => {}
    expect(
      h(Component, null, {
        foo: slot,
      }),
    ).toMatchObject(
      createVNode(Component, null, {
        foo: slot,
      }),
    )
  })

  // for simple JSX compat
  // note this signature is not supported in types; it's purely for usage with
  // compiled code.
  // 测试场景：支持可变子项。
  test('support variadic children', () => {
    // @ts-expect-error
    const vnode = h('div', null, h('span'), h('span'))
    expect(vnode.children).toMatchObject([
      {
        type: 'span',
      },
      {
        type: 'span',
      },
    ])
  })
})
