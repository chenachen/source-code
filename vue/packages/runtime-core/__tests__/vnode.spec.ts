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

// VNode 的创建、children 标准化、克隆、props 合并和 block 追踪。
describe('vnode', () => {
  // 只传标签时，type 保留标签，props 默认为 null。
  test('create with just tag', () => {
    const vnode = createVNode('p')
    expect(vnode.type).toBe('p')
    expect(vnode.props).toBe(null)
  })

  // 标签和 props 原样写入 VNode。
  test('create with tag and props', () => {
    const vnode = createVNode('p', {})
    expect(vnode.type).toBe('p')
    expect(vnode.props).toMatchObject({})
  })

  // 创建时保留传入的 children 数组。
  test('create with tag, props and children', () => {
    const vnode = createVNode('p', {}, ['foo'])
    expect(vnode.type).toBe('p')
    expect(vnode.props).toMatchObject({})
    expect(vnode.children).toMatchObject(['foo'])
  })

  // 显式传入 null props 时，VNode.props 仍为 null。
  test('create with 0 as props', () => {
    const vnode = createVNode('p', null)
    expect(vnode.type).toBe('p')
    expect(vnode.props).toBe(null)
  })

  // 空字符串是无效类型：开发环境警告，并改为 Comment 占位。
  test('show warn when create with invalid type', () => {
    const vnode = createVNode('')
    expect('Invalid vnode type when creating vnode').toHaveBeenWarned()
    expect(vnode.type).toBe(Comment)
  })

  // 已有 VNode 作为 type 时先克隆，再合并额外 props 并替换 children。
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

  // 以已有文本 children 的元素 VNode 创建新节点时，保留内容并将 patchFlag 设为 BAIL。
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

  // key 原样保留，缺失时归为 null；NaN 保留但会触发开发警告。
  test('vnode keys', () => {
    for (const key of ['', 'a', 0, 1, NaN]) {
      expect(createVNode('div', { key }).key).toBe(key)
    }
    expect(createVNode('div').key).toBe(null)
    expect(createVNode('div', { key: undefined }).key).toBe(null)
    expect(`VNode created with invalid key (NaN)`).toHaveBeenWarned()
  })

  // #5081
  // 元素的 innerHTML/textContent 与有内容的 children 并用时给出开发警告。
  describe('children overridden by innerHTML / textContent', () => {
    // innerHTML 会覆盖文本 children，因此开发模式给出警告。
    test('warn on text children', () => {
      createVNode('div', { innerHTML: '<span/>' }, 'hello')
      expect(
        `The \`innerHTML\` prop on <div> will override its children`,
      ).toHaveBeenWarned()
    })

    // innerHTML 与非空 children 数组并用时也会警告。
    test('warn on array children', () => {
      createVNode('div', { innerHTML: '<span/>' }, [createVNode('span')])
      expect(
        `The \`innerHTML\` prop on <div> will override its children`,
      ).toHaveBeenWarned()
    })

    // textContent 与文本 children 并用时给出警告。
    test('warn on textContent', () => {
      createVNode('div', { textContent: 'text' }, 'hello')
      expect(
        `The \`textContent\` prop on <div> will override its children`,
      ).toHaveBeenWarned()
    })

    // innerHTML/textContent 为 null 或 undefined 时不警告。
    test('no warning when the prop is nullish', () => {
      createVNode('div', { innerHTML: undefined }, 'hello')
      createVNode('div', { innerHTML: null }, 'hello')
      createVNode('div', { textContent: undefined }, 'hello')
      expect(`will override its children`).not.toHaveBeenWarned()
    })

    // 没有 children、空字符串或空数组都不构成内容冲突。
    test('no warning without renderable children', () => {
      createVNode('div', { innerHTML: '<span/>' })
      createVNode('div', { innerHTML: '<span/>' }, '')
      createVNode('div', { innerHTML: '<span/>' }, [])
      expect(`will override its children`).not.toHaveBeenWarned()
    })

    // 组件上的 innerHTML 是普通 prop，不触发元素内容覆盖警告。
    test('no warning for component vnodes', () => {
      const Comp = {
        props: ['innerHTML'],
        /** 返回 null 的组件 render，供组件 innerHTML prop 不产生元素覆盖警告。 */
        render: () => null
      }
      createVNode(
        Comp,
        { innerHTML: '<span/>' },
        {
          /** 返回 slot 文本，作为组件对象 children 的有效输入。 */
          default: () => 'slot'
        }
      )
      expect(`will override its children`).not.toHaveBeenWarned()
    })
  })

  // 类组件使用静态 __vccOpts 作为实际 VNode.type。
  test('create with class component', () => {
    /** 最小类组件类型，靠静态 __vccOpts 提供实际组件选项，用于 createVNode 类型归一化。 */
    class Component {
      /** 提供类组件/JSX 虚拟 props 类型，测试不创建类实例。 */
      $props: any
      /** 类组件真实选项对象，createVNode 应把它设为 vnode.type。 */
      static __vccOpts = { template: '<div />' }
    }
    const vnode = createVNode(Component)
    expect(vnode.type).toEqual(Component.__vccOpts)
  })

  // class 字符串、数组和对象统一成 class 字符串。
  describe('class normalization', () => {
    // 已有 class 字符串保持不变。
    test('string', () => {
      const vnode = createVNode('p', { class: 'foo baz' })
      expect(vnode.props).toMatchObject({ class: 'foo baz' })
    })

    // 字符串数组合并成以空格分隔的 class。
    test('array<string>', () => {
      const vnode = createVNode('p', { class: ['foo', 'baz'] })
      expect(vnode.props).toMatchObject({ class: 'foo baz' })
    })

    // 数组中的对象贡献值为真的 class 键。
    test('array<object>', () => {
      const vnode = createVNode('p', {
        class: [{ foo: 'foo' }, { baz: 'baz' }],
      })
      expect(vnode.props).toMatchObject({ class: 'foo baz' })
    })

    // 对象中值为真的键合并为 class 字符串。
    test('object', () => {
      const vnode = createVNode('p', { class: { foo: 'foo', baz: 'baz' } })
      expect(vnode.props).toMatchObject({ class: 'foo baz' })
    })
  })

  // style 数组的合并与普通对象输入。
  describe('style normalization', () => {
    // style 数组中的属性合并到一个对象。
    test('array', () => {
      const vnode = createVNode('p', {
        style: [{ foo: 'foo' }, { baz: 'baz' }],
      })
      expect(vnode.props).toMatchObject({ style: { foo: 'foo', baz: 'baz' } })
    })

    // 普通 style 对象的属性和值保持不变。
    test('object', () => {
      const vnode = createVNode('p', { style: { foo: 'foo', baz: 'baz' } })
      expect(vnode.props).toMatchObject({ style: { foo: 'foo', baz: 'baz' } })
    })
  })

  // children 形态决定 TEXT_CHILDREN、ARRAY_CHILDREN 或 SLOTS_CHILDREN 标记。
  describe('children normalization', () => {
    // null children 不增加任何 children 类型标记。
    test('null', () => {
      const vnode = createVNode('p', null, null)
      expect(vnode.children).toBe(null)
      expect(vnode.shapeFlag).toBe(ShapeFlags.ELEMENT)
    })

    // children 数组保留为数组，并设置 ARRAY_CHILDREN。
    test('array', () => {
      const vnode = createVNode('p', null, ['foo'])
      expect(vnode.children).toMatchObject(['foo'])
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.ELEMENT | ShapeFlags.ARRAY_CHILDREN,
      )
    })

    // 组件的对象 children 保留为 slots，并设置 SLOTS_CHILDREN。
    test('object', () => {
      const vnode = createVNode({}, null, { foo: 'foo' })
      expect(vnode.children).toMatchObject({ foo: 'foo' })
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.STATEFUL_COMPONENT | ShapeFlags.SLOTS_CHILDREN,
      )
    })

    // 组件接收函数 children 时，将函数包装为 default slot。
    test('function on component', () => {
      const slot = vi.fn()
      const vnode = createVNode({}, null, slot)
      expect(vnode.children).toMatchObject({ default: slot })
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.STATEFUL_COMPONENT | ShapeFlags.SLOTS_CHILDREN,
      )
    })

    // 元素接收函数 children 时立即调用，返回字符串成为文本 children。
    test('function on element', () => {
      const vnode = createVNode('p', null, () => 'foo')
      expect(vnode.children).toBe('foo')
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.ELEMENT | ShapeFlags.TEXT_CHILDREN,
      )
    })

    // Teleport 调用函数 children 后，把文本结果包装为 Text VNode 数组。
    test('function on Teleport', () => {
      const vnode = createVNode(Teleport, { to: '#target' }, () => 'foo')
      expect(vnode.children).toMatchObject([{ type: Text, children: 'foo' }])
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.TELEPORT | ShapeFlags.ARRAY_CHILDREN,
      )
    })

    // 字符串 children 设置 TEXT_CHILDREN 标记。
    test('string', () => {
      const vnode = createVNode('p', null, 'foo')
      expect(vnode.children).toBe('foo')
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.ELEMENT | ShapeFlags.TEXT_CHILDREN,
      )
    })

    // 元素调用 default slot，并直接使用它返回的 children 数组。
    test('element with slots', () => {
      const children = [createVNode('span', null, 'hello')]
      const vnode = createVNode('div', null, {
        /** 原样返回 children 数组，供元素 default slot 展开后的引用身份比较。 */
        default: () => children,
      })

      expect(vnode.children).toBe(children)
      expect(vnode.shapeFlag).toBe(
        ShapeFlags.ELEMENT | ShapeFlags.ARRAY_CHILDREN,
      )
    })
  })

  // normalizeVNode 将空值和布尔值转成 Comment、数组转成 Fragment、原始值转成 Text；已挂载 VNode 先克隆。
  test('normalizeVNode', () => {
    // null/undefined 归一化为 Comment。
    expect(normalizeVNode(null)).toMatchObject({ type: Comment })
    expect(normalizeVNode(undefined)).toMatchObject({ type: Comment })

    // 布尔值归一化为 Comment。
    // 支持 someBoolean && h(...) 条件写法。
    // 布尔占位行为与 Vue 2 一致（#574）。
    expect(normalizeVNode(true)).toMatchObject({ type: Comment })
    expect(normalizeVNode(false)).toMatchObject({ type: Comment })

    // 数组归一化为 Fragment。
    expect(normalizeVNode(['foo'])).toMatchObject({ type: Fragment })

    // 未使用 VNode 保留原引用。
    const vnode = createVNode('div')
    expect(normalizeVNode(vnode)).toBe(vnode)

    // 已挂载 VNode 先克隆。
    const mounted = createVNode('div')
    mounted.el = {}
    const normalized = normalizeVNode(mounted)
    expect(normalized).not.toBe(mounted)
    expect(normalized).toEqual(mounted)

    // 原始字符串/数字转换为 Text。
    expect(normalizeVNode('foo')).toMatchObject({ type: Text, children: `foo` })
    expect(normalizeVNode(1)).toMatchObject({ type: Text, children: `1` })
  })

  // 根据标签、对象组件、函数组件和内置节点类型推导 shapeFlag。
  test('type shapeFlag inference', () => {
    expect(createVNode('div').shapeFlag).toBe(ShapeFlags.ELEMENT)
    expect(createVNode({}).shapeFlag).toBe(ShapeFlags.STATEFUL_COMPONENT)
    expect(createVNode(() => {}).shapeFlag).toBe(
      ShapeFlags.FUNCTIONAL_COMPONENT,
    )
    expect(createVNode(Text).shapeFlag).toBe(0)
  })

  // 分别克隆元素 VNode 与含数组 children 的组件 VNode，检查字段深相等，验证克隆保留结构内容。
  test('cloneVNode', () => {
    const node1 = createVNode('div', { foo: 1 }, null)
    expect(cloneVNode(node1)).toEqual(node1)

    const node2 = createVNode({}, null, [node1])
    const cloned2 = cloneVNode(node2)
    expect(cloned2).toEqual(node2)
    expect(cloneVNode(node2)).toEqual(cloned2)
  })

  // 克隆时从合并后的 props 提取 key，额外 key 覆盖原 key。
  test('cloneVNode key normalization', () => {
    // #1041：从最终 props 解析 key/ref。
    expect(cloneVNode(createVNode('div', { key: 1 })).key).toBe(1)
    expect(cloneVNode(createVNode('div', { key: 1 }), { key: 2 }).key).toBe(2)
    expect(cloneVNode(createVNode('div'), { key: 2 }).key).toBe(2)
  })

  // ref 记录当前所有者实例与原始目标。
  // 保留原 ref 时也保留 owner；追加 ref 时使用当前渲染实例，并携带 ref_for/ref_key。
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

    // 克隆时保留原 ref。
    const cloned1 = cloneVNode(original)
    expect(cloned1.ref).toMatchObject({ i: mockInstance1, r: 'foo', f: false })

    // 同一所有者上下文中替换 ref。
    const cloned2 = cloneVNode(original, { ref: 'bar' })
    expect(cloned2.ref).toMatchObject({ i: mockInstance1, r: 'bar', f: false })

    // 向原本没有 ref 的 VNode 添加引用。
    const original2 = createVNode('div')
    const cloned3 = cloneVNode(original2, { ref: 'bar' })
    expect(cloned3.ref).toMatchObject({ i: mockInstance1, r: 'bar', f: false })

    // 切换到另一个渲染实例上下文。
    setCurrentRenderingInstance(mockInstance2)

    // 保留原 ref 时保留原所有者。
    const cloned4 = cloneVNode(original)
    // #1311：保留原 ref 的所有者实例。
    expect(cloned4.ref).toMatchObject({ i: mockInstance1, r: 'foo', f: false })

    // 新上下文中替换 ref。
    const cloned5 = cloneVNode(original, { ref: 'bar' })
    // 新 ref 使用当前实例作为所有者，覆盖原 ref。
    expect(cloned5.ref).toMatchObject({ i: mockInstance2, r: 'bar', f: false })

    // 向原本没有 ref 的 VNode 添加当前所有者引用。
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

  // mergeRef 同时保留原 ref 与新 ref，各自保持声明时的 owner。
  test('cloneVNode ref merging', () => {
    const mockInstance1 = { type: {} } as any
    const mockInstance2 = { type: {} } as any

    setCurrentRenderingInstance(mockInstance1)
    const original = createVNode('div', { ref: 'foo' })
    expect(original.ref).toMatchObject({ i: mockInstance1, r: 'foo', f: false })

    // 克隆时同时保留合并的原始 ref。
    setCurrentRenderingInstance(mockInstance2)
    const cloned1 = cloneVNode(original, { ref: 'bar' }, true)
    expect(cloned1.ref).toMatchObject([
      { i: mockInstance1, r: 'foo', f: false },
      { i: mockInstance2, r: 'bar', f: false },
    ])

    setCurrentRenderingInstance(null)
  })

  // 克隆时，额外 class 的字符串、数组和对象输入都标准化为 class 字符串。
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

  // 克隆时，额外 style 字符串和对象输入都能形成对应的样式属性。
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

  // mergeProps 分别处理 class、style、事件监听器和普通 props。
  describe('mergeProps', () => {
    // 多组 class 输入按顺序合并。
    test('class', () => {
      let props1: Data = { class: { c: true } }
      let props2: Data = { class: ['cc'] }
      let props3: Data = { class: [{ ccc: true }] }
      let props4: Data = { class: { cccc: true } }
      expect(mergeProps(props1, props2, props3, props4)).toMatchObject({
        class: 'c cc ccc cccc',
      })
    })

    // style 对象和数组按顺序合并，同名属性由后值覆盖。
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

    // style 字符串先解析成属性，再与数组中的对象合并。
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

    // 不同事件处理器合并，后续空值不覆盖已有处理器；单独的空 model listener 不保留键。
    test('handlers', () => {
      /** 空 click 处理器，以函数身份观察 mergeProps 监听器合并。 */
      let clickHandler1 = function () {}
      /** 第二个空 click 处理器，供两个不同监听器形成数组。 */
      let clickHandler2 = function () {}
      /** 空 focus 处理器，供未重复的事件保持单函数。 */
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

    // 普通 props 由后值覆盖前值，不同键都保留。
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

  // block tree 收集需要更新的 VNode，并让嵌套 block 各自维护 dynamicChildren。
  describe('dynamic children', () => {
    // 带正 patchFlag 的元素进入 dynamicChildren，无动态标记的提升节点不进入。
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

    // 仅带 NEED_HYDRATION 标记的节点不进入动态更新列表。
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

    // 嵌套 openBlock 时，父 block 收集嵌套 block 根；后者收集自己的动态后代。
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

    // 有状态组件即使没有正 patchFlag，也进入 dynamicChildren。
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

    // 函数式组件即使没有正 patchFlag，也进入 dynamicChildren。
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
    // 动态组件 children 编译为插槽。
    // 动态类型解析为元素后，仍以 block 创建。
    // block 创建期间不会收集自身。
    // 元素调用插槽时，仍需收集插槽内的动态后代。
    // 元素 block 展开 default slot 时，插槽内创建的动态 children 仍被收集。
    test('element block should track normalized slot children', () => {
      const hoist = createVNode('div')
      let vnode1: any
      const vnode =
        (openBlock(),
        createBlock('div', null, {
          /** 返回 hoist 与 TEXT 动态 VNode，并保存动态节点引用，供元素 block 的插槽收集比较。 */
          default: () => {
            return [
              hoist,
              (vnode1 = createVNode('div', null, 'text', PatchFlags.TEXT)),
            ]
          },
        }))
      expect(vnode.dynamicChildren).toStrictEqual([vnode1])
    })

    // openBlock(true) 禁用本层收集，父 block 仍收集该 block 根。
    test('openBlock w/ disableTracking: true', () => {
      const hoist = createVNode('div')
      let vnode1
      const vnode =
        (openBlock(),
        createBlock('div', null, [
          // 编译器生成的 v-for Fragment 会完整 diff 列表。
          // 因此可关闭该层动态后代收集。

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

    // 普通 openBlock 收集本层动态 children，父 block 收集该 block 根。
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

    // v-once 禁用期间创建的嵌套 block 不被父 block 收集，父 block 保留 hasOnce 标记。
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
    // 插槽抛错后恢复 block tracking 计数，不污染后续渲染。
    test('error of slot function execution should not affect block tracking', () => {
      expect(isBlockTreeEnabled).toStrictEqual(1)
      const slotFn = withCtx(
        () => {
          throw new Error('slot execution error')
        },
        { type: {}, appContext: {} } as any,
      )
      const Parent = {
        /** 返回调用插槽并捕获其异常的 render，使测试继续检查 block tracking 的恢复值。 */
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

  // transformVNodeArgs 在开发构建中为 createVNode 注册全局参数转换器。
  describe('transformVNodeArgs', () => {
    afterEach(() => {
      // 清除全局 VNode 参数转换器
      transformVNodeArgs()
    })

    // 原样返回参数时，VNode 仍使用调用者传入的 type、props 和 children。
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

    // 转换器可以直接替换 type、props 和 children。
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

    // 转换器在组件 render 中收到当前实例，可用组件名生成 children。
    test('receive component instance as 2nd arg', () => {
      transformVNodeArgs((args, instance) => {
        if (instance) {
          return ['h1', null, instance.type.name]
        } else {
          return args
        }
      })
      const App = {
        // 组件名将成为转换后 h1 的文本。
        name: 'Root Component',
        /** 创建 p VNode 交给全局参数转换器，转换器会用当前实例替换成 h1。 */
        render() {
          return h('p') // 参数转换器会覆盖此 p 类型。
        },
      }
      const root = nodeOps.createElement('div')
      createApp(App).mount(root)
      expect(serializeInner(root)).toBe('<h1>Root Component</h1>')
    })

    // reactive 不代理 VNode，返回原对象且 isReactive 为 false。
    test('should not be observable', () => {
      const a = createVNode('div')
      const b = reactive(a)
      expect(b).toBe(a)
      expect(isReactive(b)).toBe(false)
    })
  })
})
