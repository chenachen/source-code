import { h } from '../src/h'
import { createVNode } from '../src/vnode'
import type { RawSlots } from '../src/componentSlots'

// h 的参数消歧：区分 props、普通 children、单个 VNode 和 slots。
describe('renderer: h', () => {
  /** 只传 div 类型并与 createVNode 的默认结果比较，验证 h 省略参数时不增加 props 或 children。 */
  test('type only', () => {
    expect(h('div')).toMatchObject(createVNode('div'))
  })

  /** 向 h 传入 div 与 id:foo 普通对象，对比 createVNode 的 props，验证二参对象被识别为属性。 */
  test('type + props', () => {
    expect(h('div', { id: 'foo' })).toMatchObject(
      createVNode('div', { id: 'foo' }),
    )
  })

  /** 分别把数组、默认插槽函数、单个 VNode 和文本放在第二参数，与 createVNode 对照；单个 VNode 应包装成数组，其余按 children 传递。 */
  test('type + omit props', () => {
    // 数组 children
    expect(h('div', ['foo'])).toMatchObject(createVNode('div', null, ['foo']))
    // 默认插槽。
    const Component = { template: '<br />' }
    /** 不输出内容的插槽夹具，仅用函数身份检验 h 对插槽参数的识别。 */
    const slot = () => {}
    expect(h(Component, slot)).toMatchObject(createVNode(Component, null, slot))
    // 单个 VNode。
    const vnode = h('div')
    expect(h('div', vnode)).toMatchObject(createVNode('div', null, [vnode]))
    // 文本 children
    expect(h('div', 'foo')).toMatchObject(createVNode('div', null, 'foo'))
  })

  /** 显式传入 props，再分别传数组、插槽对象/函数、单个 VNode 和文本；逐项对比 createVNode，验证三参调用的 children 处理。 */
  test('type + props + children', () => {
    // 数组 children
    expect(h('div', {}, ['foo'])).toMatchObject(createVNode('div', {}, ['foo']))
    // 插槽对象
    const slots = {} as RawSlots
    expect(h('div', {}, slots)).toMatchObject(createVNode('div', {}, slots))
    const Component = { template: '<br />' }
    expect(h(Component, {}, slots)).toMatchObject(
      createVNode(Component, {}, slots),
    )
    // 默认插槽。
    /** 不输出内容的插槽夹具，仅用函数身份检验 h 对插槽参数的识别。 */
    const slot = () => {}
    expect(h(Component, {}, slot)).toMatchObject(
      createVNode(Component, {}, slot),
    )
    // 单个 VNode。
    const vnode = h('div')
    expect(h('div', {}, vnode)).toMatchObject(createVNode('div', {}, [vnode]))
    // 文本 children
    expect(h('div', {}, 'foo')).toMatchObject(createVNode('div', {}, 'foo'))
  })

  /** 组件使用 null 占据 props 参数，把 foo 插槽放到第三参数；对比 createVNode 的插槽记录，验证具名插槽的调用位置。 */
  test('named slots with null props', () => {
    const Component = { template: '<br />' }
    /** 不输出内容的插槽夹具，仅用函数身份检验 h 对插槽参数的识别。 */
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

  /** 运行时向 h 连续传两个 span VNode，检查 children 按顺序包含二者，验证编译 JSX 所需的可变参数收集；该签名由类型错误标记说明。 */
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
