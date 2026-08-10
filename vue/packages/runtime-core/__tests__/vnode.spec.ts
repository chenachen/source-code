/**
 * 测试阅读说明：本文件验证 `runtime-core/vnode` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import {
  Comment,
  Fragment,
  Text,
  type VNode,
  cloneVNode,
  createBlock,
  createVNode,
  isBlockTreeEnabled,
  mergeProps,
  normalizeVNode,
  openBlock,
  transformVNodeArgs,
} from '../src/vnode'
import type { Data } from '../src/component'
import { PatchFlags, ShapeFlags } from '@vue/shared'
import {
  Teleport,
  h,
  isReactive,
  reactive,
  ref,
  setBlockTracking,
  withCtx,
} from '../src'
import { createApp, nodeOps, serializeInner } from '@vue/runtime-test'
import { setCurrentRenderingInstance } from '../src/componentRenderContext'

// 测试组：VNode 的创建、规范化、克隆、props 合并和 block 追踪。
describe('vnode', () => {
  // 测试场景：仅使用标签创建。
  test('create with just tag', () => {
    const vnode = createVNode('p')
    expect(vnode.type).toBe('p')
    expect(vnode.props).toBe(null)
  })

  // 测试场景：用标签和props创建。
  test('create with tag and props', () => {
    const vnode = createVNode('p', {})
    expect(vnode.type).toBe('p')
    expect(vnode.props).toMatchObject({})
  })

  // 测试场景：使用标签、props 和子项创建。
  test('create with tag, props and children', () => {
    const vnode = createVNode('p', {}, ['foo'])
    expect(vnode.type).toBe('p')
    expect(vnode.props).toMatchObject({})
    expect(vnode.children).toMatchObject(['foo'])
  })

  // 测试场景：用 0 创建为 props。
  test('create with 0 as props', () => {
    const vnode = createVNode('p', null)
    expect(vnode.type).toBe('p')
    expect(vnode.props).toBe(null)
  })

  // 测试场景：使用无效类型创建时显示警告。
  test('show warn when create with invalid type', () => {
    const vnode = createVNode('')
    expect('Invalid vnode type when creating vnode').toHaveBeenWarned()
    expect(vnode.type).toBe(Comment)
  })

  // 测试场景：从现有的vnode创建。
  test('create from an existing vnode', () => {
    const vnode1 = createVNode('p', { id: 'foo' })
    const vnode2 = createVNode(vnode1, { class: 'bar' }, 'baz')
    expect(vnode2).toMatchObject({
      type: 'p',
      props: {
        id: 'foo',
        class: 'bar',
      },
      children: 'baz',
      shapeFlag: ShapeFlags.ELEMENT | ShapeFlags.TEXT_CHILDREN,
    })
  })

  // 测试场景：以已有文本 VNode 为输入时，createVNode 能正确复用或规范化它。
  test('create from an existing text vnode', () => {
    const vnode1 = createVNode('div', null, 'text', PatchFlags.TEXT)
    const vnode2 = createVNode(vnode1)
    expect(vnode2).toMatchObject({
      type: 'div',
      patchFlag: PatchFlags.BAIL,
      children: 'text',
      shapeFlag: ShapeFlags.ELEMENT | ShapeFlags.TEXT_CHILDREN,
    })
  })

  // 测试场景：VNode key 从 props 读取并规范化为允许的 key 类型。
  test('vnode keys', () => {
    for (const key of ['', 'a', 0, 1, NaN]) {
      expect(createVNode('div', { key }).key).toBe(key)
    }
    expect(createVNode('div').key).toBe(null)
    expect(createVNode('div', { key: undefined }).key).toBe(null)
    expect(`VNode created with invalid key (NaN)`).toHaveBeenWarned()
  })

  // #5081
  // 测试组：被 innerHTML / textContent 覆盖的子级。
  describe('children overridden by innerHTML / textContent', () => {
    // 测试场景：innerHTML/textContent 会覆盖文本 children，因此开发模式需要给出警告。
    test('warn on text children', () => {
      createVNode('div', { innerHTML: '<span/>' }, 'hello')
      expect(
        `The \`innerHTML\` prop on <div> will override its children`,
      ).toHaveBeenWarned()
    })

    // 测试场景：对数组子项发出警告。
    test('warn on array children', () => {
      createVNode('div', { innerHTML: '<span/>' }, [createVNode('span')])
      expect(
        `The \`innerHTML\` prop on <div> will override its children`,
      ).toHaveBeenWarned()
    })

    // 测试场景：对 textContent 发出警告。
    test('warn on textContent', () => {
      createVNode('div', { textContent: 'text' }, 'hello')
      expect(
        `The \`textContent\` prop on <div> will override its children`,
      ).toHaveBeenWarned()
    })

    // 测试场景：当props为空时没有警告。
    test('no warning when the prop is nullish', () => {
      createVNode('div', { innerHTML: undefined }, 'hello')
      createVNode('div', { innerHTML: null }, 'hello')
      createVNode('div', { textContent: undefined }, 'hello')
      expect(`will override its children`).not.toHaveBeenWarned()
    })

    // 测试场景：没有可渲染子项时没有警告。
    test('no warning without renderable children', () => {
      createVNode('div', { innerHTML: '<span/>' })
      createVNode('div', { innerHTML: '<span/>' }, '')
      createVNode('div', { innerHTML: '<span/>' }, [])
      expect(`will override its children`).not.toHaveBeenWarned()
    })

    // 测试场景：组件 vnode 没有警告。
    test('no warning for component vnodes', () => {
      const Comp = { props: ['innerHTML'], render: () => null }
      createVNode(Comp, { innerHTML: '<span/>' }, { default: () => 'slot' })
      expect(`will override its children`).not.toHaveBeenWarned()
    })
  })

  // 测试场景：用类组件创建。
  test('create with class component', () => {
    class Component {
      $props: any
      static __vccOpts = { template: '<div />' }
    }
    const vnode = createVNode(Component)
    expect(vnode.type).toEqual(Component.__vccOpts)
  })

  // 测试组：类别标准化。
  describe('class normalization', () => {
    // 测试场景：字符串。
    test('string', () => {
      const vnode = createVNode('p', { class: 'foo baz' })
      expect(vnode.props).toMatchObject({ class: 'foo baz' })
    })

    // 测试场景：数组<string>。
    test('array<string>', () => {
      const vnode = createVNode('p', { class: ['foo', 'baz'] })
      expect(vnode.props).toMatchObject({ class: 'foo baz' })
    })

    // 测试场景：数组<object>。
    test('array<object>', () => {
      const vnode = createVNode('p', {
        class: [{ foo: 'foo' }, { baz: 'baz' }],
      })
      expect(vnode.props).toMatchObject({ class: 'foo baz' })
    })

    // 测试场景：对象。
    test('object', () => {
      const vnode = createVNode('p', { class: { foo: 'foo', baz: 'baz' } })
      expect(vnode.props).toMatchObject({ class: 'foo baz' })
    })
  })

  // 测试组：style props 的规范化。
  describe('style normalization', () => {
    // 测试场景：数组。
    test('array', () => {
      const vnode = createVNode('p', {
        style: [{ foo: 'foo' }, { baz: 'baz' }],
      })
      expect(vnode.props).toMatchObject({ style: { foo: 'foo', baz: 'baz' } })
    })

    // 测试场景：对象。
    test('object', () => {
      const vnode = createVNode('p', { style: { foo: 'foo', baz: 'baz' } })
      expect(vnode.props).toMatchObject({ style: { foo: 'foo', baz: 'baz' } })
    })
  })

  // 测试组：VNode children 的规范化。
  describe('children normalization', () => {
    // 测试场景：空。
    test('null', () => {
      const vnode = createVNode('p', null, null)
      expect(vnode.children).toBe(null)
      expect(vnode.shapeFlag).toBe(ShapeFlags.ELEMENT)
    })

    // 测试场景：数组。
    test('array', () => {
      const vnode = createVNode('p', null, ['foo'])
      expect(vnode.children).toMatchObject(['foo'])
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.ELEMENT | ShapeFlags.ARRAY_CHILDREN,
      )
    })

    // 测试场景：对象。
    test('object', () => {
      const vnode = createVNode({}, null, { foo: 'foo' })
      expect(vnode.children).toMatchObject({ foo: 'foo' })
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.STATEFUL_COMPONENT | ShapeFlags.SLOTS_CHILDREN,
      )
    })

    // 测试场景：组件上的功能。
    test('function on component', () => {
      const slot = vi.fn()
      const vnode = createVNode({}, null, slot)
      expect(vnode.children).toMatchObject({ default: slot })
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.STATEFUL_COMPONENT | ShapeFlags.SLOTS_CHILDREN,
      )
    })

    // 测试场景：元素 VNode 收到函数 children 时按约定处理并给出必要提示。
    test('function on element', () => {
      const vnode = createVNode('p', null, () => 'foo')
      expect(vnode.children).toBe('foo')
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.ELEMENT | ShapeFlags.TEXT_CHILDREN,
      )
    })

    // 测试场景：Teleport 上的功能。
    test('function on Teleport', () => {
      const vnode = createVNode(Teleport, { to: '#target' }, () => 'foo')
      expect(vnode.children).toMatchObject([{ type: Text, children: 'foo' }])
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.TELEPORT | ShapeFlags.ARRAY_CHILDREN,
      )
    })

    // 测试场景：字符串。
    test('string', () => {
      const vnode = createVNode('p', null, 'foo')
      expect(vnode.children).toBe('foo')
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.ELEMENT | ShapeFlags.TEXT_CHILDREN,
      )
    })

    // 测试场景：带有slots的元素。
    test('element with slots', () => {
      const children = [createVNode('span', null, 'hello')]
      const vnode = createVNode('div', null, {
        default: () => children,
      })

      expect(vnode.children).toBe(children)
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.ELEMENT | ShapeFlags.ARRAY_CHILDREN,
      )
    })
  })

  // 测试场景：normalizeVNode 将 null、布尔值、数组、对象和原始值归一化为对应 VNode。
  test('normalizeVNode', () => {
    // null / undefined -> Comment
    expect(normalizeVNode(null)).toMatchObject({ type: Comment })
    expect(normalizeVNode(undefined)).toMatchObject({ type: Comment })

    // boolean -> Comment
    // this is for usage like `someBoolean && h('div')` and behavior consistency
    // with 2.x (#574)
    expect(normalizeVNode(true)).toMatchObject({ type: Comment })
    expect(normalizeVNode(false)).toMatchObject({ type: Comment })

    // array -> Fragment
    expect(normalizeVNode(['foo'])).toMatchObject({ type: Fragment })

    // VNode -> VNode
    const vnode = createVNode('div')
    expect(normalizeVNode(vnode)).toBe(vnode)

    // mounted VNode -> cloned VNode
    const mounted = createVNode('div')
    mounted.el = {}
    const normalized = normalizeVNode(mounted)
    expect(normalized).not.toBe(mounted)
    expect(normalized).toEqual(mounted)

    // primitive types
    expect(normalizeVNode('foo')).toMatchObject({ type: Text, children: `foo` })
    expect(normalizeVNode(1)).toMatchObject({ type: Text, children: `1` })
  })

  // 测试场景：类型 shapeFlag 推理。
  test('type shapeFlag inference', () => {
    expect(createVNode('div').shapeFlag).toBe(ShapeFlags.ELEMENT)
    expect(createVNode({}).shapeFlag).toBe(ShapeFlags.STATEFUL_COMPONENT)
    expect(createVNode(() => {}).shapeFlag).toBe(
      ShapeFlags.FUNCTIONAL_COMPONENT,
    )
    expect(createVNode(Text).shapeFlag).toBe(0)
  })

  // 测试场景：cloneVNode 复制结构、props 和内部标记，同时保持原 VNode 不变。
  test('cloneVNode', () => {
    const node1 = createVNode('div', { foo: 1 }, null)
    expect(cloneVNode(node1)).toEqual(node1)

    const node2 = createVNode({}, null, [node1])
    const cloned2 = cloneVNode(node2)
    expect(cloned2).toEqual(node2)
    expect(cloneVNode(node2)).toEqual(cloned2)
  })

  // 测试场景：cloneVNode key标准化。
  test('cloneVNode key normalization', () => {
    // #1041 should use resolved key/ref
    expect(cloneVNode(createVNode('div', { key: 1 })).key).toBe(1)
    expect(cloneVNode(createVNode('div', { key: 1 }), { key: 2 }).key).toBe(2)
    expect(cloneVNode(createVNode('div'), { key: 2 }).key).toBe(2)
  })

  // ref normalizes to [currentRenderingInstance, ref]
  // 测试场景：cloneVNode ref归一化。
  test('cloneVNode ref normalization', () => {
    const mockInstance1 = { type: {} } as any
    const mockInstance2 = { type: {} } as any

    setCurrentRenderingInstance(mockInstance1)
    const original = createVNode('div', { ref: 'foo' })
    expect(original.ref).toMatchObject({
      i: mockInstance1,
      r: 'foo',
      f: false,
    })

    // clone and preserve original ref
    const cloned1 = cloneVNode(original)
    expect(cloned1.ref).toMatchObject({ i: mockInstance1, r: 'foo', f: false })

    // cloning with new ref, but with same context instance
    const cloned2 = cloneVNode(original, { ref: 'bar' })
    expect(cloned2.ref).toMatchObject({ i: mockInstance1, r: 'bar', f: false })

    // cloning and adding ref to original that has no ref
    const original2 = createVNode('div')
    const cloned3 = cloneVNode(original2, { ref: 'bar' })
    expect(cloned3.ref).toMatchObject({ i: mockInstance1, r: 'bar', f: false })

    // cloning with different context instance
    setCurrentRenderingInstance(mockInstance2)

    // clone and preserve original ref
    const cloned4 = cloneVNode(original)
    // #1311 should preserve original context instance!
    expect(cloned4.ref).toMatchObject({ i: mockInstance1, r: 'foo', f: false })

    // cloning with new ref, but with same context instance
    const cloned5 = cloneVNode(original, { ref: 'bar' })
    // new ref should use current context instance and overwrite original
    expect(cloned5.ref).toMatchObject({ i: mockInstance2, r: 'bar', f: false })

    // cloning and adding ref to original that has no ref
    const cloned6 = cloneVNode(original2, { ref: 'bar' })
    expect(cloned6.ref).toMatchObject({ i: mockInstance2, r: 'bar', f: false })

    const original3 = createVNode('div', { ref: 'foo', ref_for: true })
    expect(original3.ref).toMatchObject({
      i: mockInstance2,
      r: 'foo',
      f: true,
    })
    const cloned7 = cloneVNode(original3, { ref: 'bar', ref_for: true })
    expect(cloned7.ref).toMatchObject({ i: mockInstance2, r: 'bar', f: true })

    const r = ref()
    const original4 = createVNode('div', { ref: r, ref_key: 'foo' })
    expect(original4.ref).toMatchObject({
      i: mockInstance2,
      r,
      k: 'foo',
    })
    const cloned8 = cloneVNode(original4)
    expect(cloned8.ref).toMatchObject({ i: mockInstance2, r, k: 'foo' })

    // @ts-expect-error #8230
    const original5 = createVNode('div', { ref: 111, ref_key: 'foo' })
    expect(original5.ref).toMatchObject({
      i: mockInstance2,
      r: '111',
      k: 'foo',
    })
    const cloned9 = cloneVNode(original5)
    expect(cloned9.ref).toMatchObject({ i: mockInstance2, r: '111', k: 'foo' })

    setCurrentRenderingInstance(null)
  })

  // 测试场景：cloneVNode ref 合并。
  test('cloneVNode ref merging', () => {
    const mockInstance1 = { type: {} } as any
    const mockInstance2 = { type: {} } as any

    setCurrentRenderingInstance(mockInstance1)
    const original = createVNode('div', { ref: 'foo' })
    expect(original.ref).toMatchObject({ i: mockInstance1, r: 'foo', f: false })

    // clone and preserve original ref
    setCurrentRenderingInstance(mockInstance2)
    const cloned1 = cloneVNode(original, { ref: 'bar' }, true)
    expect(cloned1.ref).toMatchObject([
      { i: mockInstance1, r: 'foo', f: false },
      { i: mockInstance2, r: 'bar', f: false },
    ])

    setCurrentRenderingInstance(null)
  })

  // 测试场景：cloneVNode 类归一化。
  test('cloneVNode class normalization', () => {
    const vnode = createVNode('div')
    const expectedProps = {
      class: 'a b',
    }
    expect(cloneVNode(vnode, { class: 'a b' }).props).toMatchObject(
      expectedProps,
    )
    expect(cloneVNode(vnode, { class: ['a', 'b'] }).props).toMatchObject(
      expectedProps,
    )
    expect(
      cloneVNode(vnode, { class: { a: true, b: true } }).props,
    ).toMatchObject(expectedProps)
    expect(
      cloneVNode(vnode, { class: [{ a: true, b: true }] }).props,
    ).toMatchObject(expectedProps)
  })

  // 测试场景：cloneVNode 样式标准化。
  test('cloneVNode style normalization', () => {
    const vnode = createVNode('div')
    const expectedProps = {
      style: {
        color: 'blue',
        width: '300px',
      },
    }
    expect(
      cloneVNode(vnode, { style: 'color: blue; width: 300px;' }).props,
    ).toMatchObject(expectedProps)
    expect(
      cloneVNode(vnode, {
        style: {
          color: 'blue',
          width: '300px',
        },
      }).props,
    ).toMatchObject(expectedProps)
    expect(
      cloneVNode(vnode, {
        style: [
          {
            color: 'blue',
            width: '300px',
          },
        ],
      }).props,
    ).toMatchObject(expectedProps)
  })

  // 测试组：mergeProps 合并 class、style、事件监听器及普通 props。
  describe('mergeProps', () => {
    // 测试场景：类。
    test('class', () => {
      let props1: Data = { class: { c: true } }
      let props2: Data = { class: ['cc'] }
      let props3: Data = { class: [{ ccc: true }] }
      let props4: Data = { class: { cccc: true } }
      expect(mergeProps(props1, props2, props3, props4)).toMatchObject({
        class: 'c cc ccc cccc',
      })
    })

    // 测试场景：对象与数组形式的 style 被规范化为稳定结构。
    test('style', () => {
      let props1: Data = {
        style: [
          {
            color: 'red',
            fontSize: 10,
          },
        ],
      }
      let props2: Data = {
        style: [
          {
            color: 'blue',
            width: '200px',
          },
          {
            width: '300px',
            height: '300px',
            fontSize: 30,
          },
        ],
      }
      expect(mergeProps(props1, props2)).toMatchObject({
        style: {
          color: 'blue',
          width: '300px',
          height: '300px',
          fontSize: 30,
        },
      })
    })

    // 测试场景：style 为字符串时，VNode props 规范化不能错误地按对象处理。
    test('style w/ strings', () => {
      let props1: Data = {
        style: 'width:100px;right:10;top:10',
      }
      let props2: Data = {
        style: [
          {
            color: 'blue',
            width: '200px',
          },
          {
            width: '300px',
            height: '300px',
            fontSize: 30,
          },
        ],
      }
      expect(mergeProps(props1, props2)).toMatchObject({
        style: {
          color: 'blue',
          width: '300px',
          height: '300px',
          fontSize: 30,
          right: '10',
          top: '10',
        },
      })
    })

    // 测试场景：处理程序。
    test('handlers', () => {
      let clickHandler1 = function () {}
      let clickHandler2 = function () {}
      let focusHandler2 = function () {}

      let props1: Data = { onClick: clickHandler1 }
      let props2: Data = { onClick: clickHandler2, onFocus: focusHandler2 }
      expect(mergeProps(props1, props2)).toMatchObject({
        onClick: [clickHandler1, clickHandler2],
        onFocus: focusHandler2,
      })
      let props3: Data = { onClick: undefined }
      expect(mergeProps(props1, props3)).toMatchObject({
        onClick: clickHandler1,
      })
      const props4: Data = { onClick: undefined }
      expect(mergeProps(props4)).toHaveProperty('onClick', undefined)
      expect(mergeProps({ onClick: null })).toMatchObject({
        onClick: null,
      })
      expect(
        mergeProps({ 'onUpdate:modelValue': undefined }),
      ).not.toHaveProperty('onUpdate:modelValue')
      expect(mergeProps({ 'onUpdate:modelValue': null })).not.toHaveProperty(
        'onUpdate:modelValue',
      )
    })

    // 测试场景：默认。
    test('default', () => {
      let props1: Data = { foo: 'c' }
      let props2: Data = { foo: {}, bar: ['cc'] }
      let props3: Data = { baz: { ccc: true } }
      expect(mergeProps(props1, props2, props3)).toMatchObject({
        foo: {},
        bar: ['cc'],
        baz: { ccc: true },
      })
    })
  })

  // 测试组：block tree 的 dynamicChildren 收集与优化追踪。
  describe('dynamic children', () => {
    // 测试场景：携带 patchFlag 的 VNode 按编译器优化信息进入动态节点追踪。
    test('with patchFlags', () => {
      const hoist = createVNode('div')
      let vnode1
      const vnode =
        (openBlock(),
        createBlock('div', null, [
          hoist,
          (vnode1 = createVNode('div', null, 'text', PatchFlags.TEXT)),
        ]))
      expect(vnode.dynamicChildren).toStrictEqual([vnode1])
    })

    // 测试场景：不应跟踪仅带有 NEED_HYDRATION 标志的 vnode。
    test('should not track vnodes with only NEED_HYDRATION flag', () => {
      const hoist = createVNode('div')
      const vnode =
        (openBlock(),
        createBlock('div', null, [
          hoist,
          createVNode('div', null, 'text', PatchFlags.NEED_HYDRATION),
        ]))
      expect(vnode.dynamicChildren).toStrictEqual([])
    })

    // 测试场景：多次拨打openBlock。
    test('many times call openBlock', () => {
      const hoist = createVNode('div')
      let vnode1, vnode2, vnode3
      const vnode =
        (openBlock(),
        createBlock('div', null, [
          hoist,
          (vnode1 = createVNode('div', null, 'text', PatchFlags.TEXT)),
          (vnode2 =
            (openBlock(),
            createBlock('div', null, [
              hoist,
              (vnode3 = createVNode('div', null, 'text', PatchFlags.TEXT)),
            ]))),
        ]))
      expect(vnode.dynamicChildren).toStrictEqual([vnode1, vnode2])
      expect(vnode2.dynamicChildren).toStrictEqual([vnode3])
    })

    // 测试场景：有状态组件。
    test('with stateful component', () => {
      const hoist = createVNode('div')
      let vnode1
      const vnode =
        (openBlock(),
        createBlock('div', null, [
          hoist,
          (vnode1 = createVNode({}, null, 'text')),
        ]))
      expect(vnode.dynamicChildren).toStrictEqual([vnode1])
    })

    // 测试场景：函数式组件参与 block 动态节点追踪。
    test('with functional component', () => {
      const hoist = createVNode('div')
      let vnode1
      const vnode =
        (openBlock(),
        createBlock('div', null, [
          hoist,
          (vnode1 = createVNode(() => {}, null, 'text')),
        ]))
      expect(vnode.dynamicChildren).toStrictEqual([vnode1])
    })

    // #1039
    // <component :is="foo">{{ bar }}</component>
    // - content is compiled as slot
    // - dynamic component resolves to plain element, but as a block
    // - block creation disables its own tracking, accidentally causing the
    //   slot content (called during the block node creation) to be missed
    // 测试场景：元素块应该跟踪规范化的slot子元素。
    test('element block should track normalized slot children', () => {
      const hoist = createVNode('div')
      let vnode1: any
      const vnode =
        (openBlock(),
        createBlock('div', null, {
          default: () => {
            return [
              hoist,
              (vnode1 = createVNode('div', null, 'text', PatchFlags.TEXT)),
            ]
          },
        }))
      expect(vnode.dynamicChildren).toStrictEqual([vnode1])
    })

    // 测试场景：openBlock 带 disableTracking：正确。
    test('openBlock w/ disableTracking: true', () => {
      const hoist = createVNode('div')
      let vnode1
      const vnode =
        (openBlock(),
        createBlock('div', null, [
          // a v-for fragment block generated by the compiler
          // disables tracking because it always diffs its
          // children.
          (vnode1 =
            (openBlock(true),
            createBlock(Fragment, null, [
              hoist,
              /*vnode2*/ createVNode(() => {}, null, 'text'),
            ]))),
        ]))
      expect(vnode.dynamicChildren).toStrictEqual([vnode1])
      expect(vnode1.dynamicChildren).toStrictEqual([])
    })

    // 测试场景：openBlock 不带 disableTracking：正确。
    test('openBlock without disableTracking: true', () => {
      const hoist = createVNode('div')
      let vnode1, vnode2
      const vnode =
        (openBlock(),
        createBlock('div', null, [
          (vnode1 =
            (openBlock(),
            createBlock(Fragment, null, [
              hoist,
              (vnode2 = createVNode(() => {}, null, 'text')),
            ]))),
        ]))
      expect(vnode.dynamicChildren).toStrictEqual([vnode1])
      expect(vnode1.dynamicChildren).toStrictEqual([vnode2])
    })

    // 测试场景：禁用跟踪时不应跟踪 openBlock()。
    test('should not track openBlock() when tracking is disabled', () => {
      let vnode1
      const vnode =
        (openBlock(),
        createBlock('div', null, [
          setBlockTracking(-1, true),
          (vnode1 = (openBlock(), createBlock('div'))),
          setBlockTracking(1),
          vnode1,
        ]))
      const expected: VNode['dynamicChildren'] = []
      expected.hasOnce = true
      expect(vnode.dynamicChildren).toStrictEqual(expected)
    })
    // #5657
    // 测试场景：slot函数执行错误不应影响块跟踪。
    test('error of slot function execution should not affect block tracking', () => {
      expect(isBlockTreeEnabled).toStrictEqual(1)
      const slotFn = withCtx(
        () => {
          throw new Error('slot execution error')
        },
        { type: {}, appContext: {} } as any,
      )
      const Parent = {
        setup(_: any, { slots }: any) {
          return () => {
            try {
              slots.default()
            } catch (e) {}
          }
        },
      }
      const vnode =
        (openBlock(), createBlock(Parent, null, { default: slotFn }))
      createApp(vnode).mount(nodeOps.createElement('div'))
      expect(isBlockTreeEnabled).toStrictEqual(1)
    })
  })

  // 测试组：transformVNodeArgs 为运行时 VNode 创建参数安装全局转换钩子。
  describe('transformVNodeArgs', () => {
    afterEach(() => {
      // reset
      transformVNodeArgs()
    })

    // 测试场景：无操作通过。
    test('no-op pass through', () => {
      transformVNodeArgs(args => args)
      const vnode = createVNode('div', { id: 'foo' }, 'hello')
      expect(vnode).toMatchObject({
        type: 'div',
        props: { id: 'foo' },
        children: 'hello',
        shapeFlag: ShapeFlags.ELEMENT | ShapeFlags.TEXT_CHILDREN,
      })
    })

    // 测试场景：直接覆盖。
    test('direct override', () => {
      transformVNodeArgs(() => ['div', { id: 'foo' }, 'hello'])
      const vnode = createVNode('p')
      expect(vnode).toMatchObject({
        type: 'div',
        props: { id: 'foo' },
        children: 'hello',
        shapeFlag: ShapeFlags.ELEMENT | ShapeFlags.TEXT_CHILDREN,
      })
    })

    // 测试场景：接收组件实例作为第二个参数。
    test('receive component instance as 2nd arg', () => {
      transformVNodeArgs((args, instance) => {
        if (instance) {
          return ['h1', null, instance.type.name]
        } else {
          return args
        }
      })
      const App = {
        // this will be the name of the component in the h1
        name: 'Root Component',
        render() {
          return h('p') // this will be overwritten by the transform
        },
      }
      const root = nodeOps.createElement('div')
      createApp(App).mount(root)
      expect(serializeInner(root)).toBe('<h1>Root Component</h1>')
    })

    // 测试场景：不应被观察到。
    test('should not be observable', () => {
      const a = createVNode('div')
      const b = reactive(a)
      expect(b).toBe(a)
      expect(isReactive(b)).toBe(false)
    })
  })
})
