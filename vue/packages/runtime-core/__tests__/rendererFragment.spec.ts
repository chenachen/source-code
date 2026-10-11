import {
  Fragment,
  NodeOpTypes,
  type TestElement,
  TestNodeTypes,
  type VNode,
  createBlock,
  createCommentVNode,
  createTextVNode,
  createVNode,
  dumpOps,
  h,
  nodeOps,
  openBlock,
  render,
  resetOps,
  serializeInner,
} from '@vue/runtime-test'
import { PatchFlags } from '@vue/shared'
import { renderList } from '../src/helpers/renderList'

// renderer 对 Fragment 的挂载、children diff、移动和卸载。
describe('renderer: fragment', () => {
  /** 组件返回 div/one 与文本 two 两根，检查序列化及首尾空文本锚点共四节点，验证数组根归一化为 Fragment。 */
  it('should allow returning multiple component root nodes', () => {
    const App = {
      /** 返回 div/one 与文本 two 数组根，构造 Fragment 的首尾锚点。 */
      render() {
        return [h('div', 'one'), 'two']
      },
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)

    expect(serializeInner(root)).toBe(`<div>one</div>two`)
    expect(root.children.length).toBe(4)
    expect(root.children[0]).toMatchObject({
      type: TestNodeTypes.TEXT,
      text: '',
    })
    expect(root.children[1]).toMatchObject({
      type: TestNodeTypes.ELEMENT,
      tag: 'div',
    })
    expect((root.children[1] as TestElement).children[0]).toMatchObject({
      type: TestNodeTypes.TEXT,
      text: 'one',
    })
    expect(root.children[2]).toMatchObject({
      type: TestNodeTypes.TEXT,
      text: 'two',
    })
    expect(root.children[3]).toMatchObject({
      type: TestNodeTypes.TEXT,
      text: '',
    })
  })

  /** 在 div 内显式渲染 Fragment 的 div/one 与 two，检查父内输出，验证不增加元素包装。 */
  it('explicitly create fragments', () => {
    const root = nodeOps.createElement('div')
    render(h('div', [h(Fragment, [h('div', 'one'), 'two'])]), root)
    const parent = root.children[0] as TestElement
    expect(serializeInner(parent)).toBe(`<div>one</div>two`)
  })

  /** 手写 keyed Fragment 的1/2两项交换，检查文本顺序及唯一 INSERT 操作，验证复用移动。 */
  it('patch fragment children (manual, keyed)', () => {
    const root = nodeOps.createElement('div')
    render(
      h(Fragment, [h('div', { key: 1 }, 'one'), h('div', { key: 2 }, 'two')]),
      root,
    )
    expect(serializeInner(root)).toBe(`<div>one</div><div>two</div>`)

    resetOps()
    render(
      h(Fragment, [h('div', { key: 2 }, 'two'), h('div', { key: 1 }, 'one')]),
      root,
    )
    expect(serializeInner(root)).toBe(`<div>two</div><div>one</div>`)
    const ops = dumpOps()
    // 操作日志应只有移动 INSERT。
    expect(ops).toMatchObject([
      {
        type: NodeOpTypes.INSERT,
      },
    ])
  })

  /** 手写无 key Fragment 的 one/two 两项交换，检查两次 SET_ELEMENT_TEXT，验证按位置更新。 */
  it('patch fragment children (manual, unkeyed)', () => {
    const root = nodeOps.createElement('div')
    render(h(Fragment, [h('div', 'one'), h('div', 'two')]), root)
    expect(serializeInner(root)).toBe(`<div>one</div><div>two</div>`)

    resetOps()
    render(h(Fragment, [h('div', 'two'), h('div', 'one')]), root)
    expect(serializeInner(root)).toBe(`<div>two</div><div>one</div>`)
    const ops = dumpOps()
    // 操作日志应为两次文本补丁。
    expect(ops).toMatchObject([
      {
        type: NodeOpTypes.SET_ELEMENT_TEXT,
      },
      {
        type: NodeOpTypes.SET_ELEMENT_TEXT,
      },
    ])
  })

  /** UNKEYED_FRAGMENT 从元素/文本两项变三项，再改文本/元素两项；检查各次输出，验证编译无 key 列表的增删与替换。 */
  it('patch fragment children (compiler generated, unkeyed)', () => {
    const root = nodeOps.createElement('div')
    render(
      createVNode(
        Fragment,
        null,
        [
          createVNode('div', null, 'one', PatchFlags.TEXT),
          createTextVNode('two'),
        ],
        PatchFlags.UNKEYED_FRAGMENT,
      ),
      root,
    )
    expect(serializeInner(root)).toBe(`<div>one</div>two`)

    render(
      createVNode(
        Fragment,
        null,
        [
          createVNode('div', null, 'foo', PatchFlags.TEXT),
          createTextVNode('bar'),
          createTextVNode('baz'),
        ],
        PatchFlags.UNKEYED_FRAGMENT,
      ),
      root,
    )
    expect(serializeInner(root)).toBe(`<div>foo</div>barbaz`)

    render(
      createVNode(
        Fragment,
        null,
        [
          createTextVNode('baz'),
          createVNode('div', null, 'foo', PatchFlags.TEXT),
        ],
        PatchFlags.UNKEYED_FRAGMENT,
      ),
      root,
    )
    expect(serializeInner(root)).toBe(`baz<div>foo</div>`)
  })

  /** KEYED_FRAGMENT 的1/2两项交换，检查顺序及 INSERT 操作，验证编译 key 列表走移动。 */
  it('patch fragment children (compiler generated, keyed)', () => {
    const root = nodeOps.createElement('div')

    render(
      createVNode(
        Fragment,
        null,
        [h('div', { key: 1 }, 'one'), h('div', { key: 2 }, 'two')],
        PatchFlags.KEYED_FRAGMENT,
      ),
      root,
    )
    expect(serializeInner(root)).toBe(`<div>one</div><div>two</div>`)

    resetOps()
    render(
      createVNode(
        Fragment,
        null,
        [h('div', { key: 2 }, 'two'), h('div', { key: 1 }, 'one')],
        PatchFlags.KEYED_FRAGMENT,
      ),
      root,
    )
    expect(serializeInner(root)).toBe(`<div>two</div><div>one</div>`)
    const ops = dumpOps()
    // 操作日志应只有移动 INSERT。
    expect(ops).toMatchObject([
      {
        type: NodeOpTypes.INSERT,
      },
    ])
  })

  /** 先交换 Fragment 内1/2，再把整段移到 outer 前；检查输出与内部移动加首尾锚点移动的五个 INSERT，验证完整范围迁移。 */
  it('move fragment', () => {
    const root = nodeOps.createElement('div')
    render(
      h('div', [
        h('div', { key: 1 }, 'outer'),
        h(Fragment, { key: 2 }, [
          h('div', { key: 1 }, 'one'),
          h('div', { key: 2 }, 'two'),
        ]),
      ]),
      root,
    )
    expect(serializeInner(root)).toBe(
      `<div><div>outer</div><div>one</div><div>two</div></div>`,
    )

    resetOps()
    render(
      h('div', [
        h(Fragment, { key: 2 }, [
          h('div', { key: 2 }, 'two'),
          h('div', { key: 1 }, 'one'),
        ]),
        h('div', { key: 1 }, 'outer'),
      ]),
      root,
    )
    expect(serializeInner(root)).toBe(
      `<div><div>two</div><div>one</div><div>outer</div></div>`,
    )
    const ops = dumpOps()
    // 重排通过 INSERT 移动既有节点。
    expect(ops).toMatchObject([
      // 1. 先调整 Fragment 内部顺序。
      { type: NodeOpTypes.INSERT, targetNode: { type: 'element' } },
      // 2. 再移动整个 Fragment，包括首尾锚点。
      // 此处逐节点移动整个范围。

      { type: NodeOpTypes.INSERT, targetNode: { type: 'text', text: '' } },
      { type: NodeOpTypes.INSERT, targetNode: { type: 'element' } },
      { type: NodeOpTypes.INSERT, targetNode: { type: 'element' } },
      { type: NodeOpTypes.INSERT, targetNode: { type: 'text', text: '' } },
    ])
  })

  /** 嵌套 Fragment 的内部和外部同时交换，检查五次 INSERT 与最终卸载为空，验证嵌套范围移动和删除。 */
  it('handle nested fragments', () => {
    const root = nodeOps.createElement('div')

    render(
      h(Fragment, [
        h('div', { key: 1 }, 'outer'),
        h(Fragment, { key: 2 }, [
          h('div', { key: 1 }, 'one'),
          h('div', { key: 2 }, 'two'),
        ]),
      ]),
      root,
    )
    expect(serializeInner(root)).toBe(
      `<div>outer</div><div>one</div><div>two</div>`,
    )

    resetOps()
    render(
      h(Fragment, [
        h(Fragment, { key: 2 }, [
          h('div', { key: 2 }, 'two'),
          h('div', { key: 1 }, 'one'),
        ]),
        h('div', { key: 1 }, 'outer'),
      ]),
      root,
    )
    expect(serializeInner(root)).toBe(
      `<div>two</div><div>one</div><div>outer</div>`,
    )
    const ops = dumpOps()
    // 通过 INSERT 移动嵌套范围。
    expect(ops).toMatchObject([
      { type: NodeOpTypes.INSERT, targetNode: { type: 'element' } },
      { type: NodeOpTypes.INSERT, targetNode: { type: 'text', text: '' } },
      { type: NodeOpTypes.INSERT, targetNode: { type: 'element' } },
      { type: NodeOpTypes.INSERT, targetNode: { type: 'element' } },
      { type: NodeOpTypes.INSERT, targetNode: { type: 'text', text: '' } },
    ])

    // 卸载后嵌套 Fragment 内容全部清空。
    render(null, root)
    expect(serializeInner(root)).toBe(``)
  })

  // #2080
  /** 每项 keyed template Fragment 含注释、共享提升 span 与动态 div，one/two 交换后检查完整输出，验证移动保留静态及注释节点。 */
  test('`template` keyed fragment w/ comment + hoisted node', () => {
    const root = nodeOps.createElement('div')
    const hoisted = h('span')

    /** 将 items 编译形态地展开为 KEYED_FRAGMENT，每项含注释、提升节点和 TEXT 动态 div，供重排。 */
    const renderFn = (items: string[]) => {
      return (
        openBlock(true),
        createBlock(
          Fragment,
          null,
          renderList(items, item => {
            return (
              openBlock(),
              createBlock(
                Fragment,
                { key: item },
                [
                  createCommentVNode('comment'),
                  hoisted,
                  createVNode('div', null, item, PatchFlags.TEXT),
                ],
                PatchFlags.STABLE_FRAGMENT,
              )
            )
          }),
          PatchFlags.KEYED_FRAGMENT,
        )
      )
    }

    render(renderFn(['one', 'two']), root)
    expect(serializeInner(root)).toBe(
      `<!--comment--><span></span><div>one</div><!--comment--><span></span><div>two</div>`,
    )

    render(renderFn(['two', 'one']), root)
    expect(serializeInner(root)).toBe(
      `<!--comment--><span></span><div>two</div><!--comment--><span></span><div>one</div>`,
    )
  })

  // #10547
  /** STABLE_FRAGMENT 包文本 text 与传入 VNode block，foo/bar/foo 往返；检查嵌套 children 输出，验证手写复用 VNode 的更新。 */
  test('`template` fragment w/ render function', () => {
    /** 把传入 VNode 变为嵌套 block，与固定 text 放入 STABLE_FRAGMENT，供 children 往返更新。 */
    const renderFn = (vnode: VNode) => {
      return (
        openBlock(),
        createBlock(
          Fragment,
          null,
          [createTextVNode('text'), (openBlock(), createBlock(vnode))],
          PatchFlags.STABLE_FRAGMENT,
        )
      )
    }

    const root = nodeOps.createElement('div')
    const foo = h('div', ['foo'])
    const bar = h('div', [h('div', 'bar')])

    render(renderFn(foo), root)
    expect(serializeInner(root)).toBe(`text<div>foo</div>`)

    render(renderFn(bar), root)
    expect(serializeInner(root)).toBe(`text<div><div>bar</div></div>`)

    render(renderFn(foo), root)
    expect(serializeInner(root)).toBe(`text<div>foo</div>`)
  })

  // #10547
  /** STABLE_FRAGMENT 包 key1/foo 与 key2/两项bar 往返，检查完整输出，验证不同 key 的 block 替换。 */
  test('`template` fragment w/ render function + keyed vnode', () => {
    /** 把带 key 的输入 VNode 包为嵌套 block，供不同身份的 STABLE_FRAGMENT 子树替换。 */
    const renderFn = (vnode: VNode) => {
      return (
        openBlock(),
        createBlock(
          Fragment,
          null,
          [createTextVNode('text'), (openBlock(), createBlock(vnode))],
          PatchFlags.STABLE_FRAGMENT,
        )
      )
    }

    const root = nodeOps.createElement('div')
    const foo = h('div', { key: 1 }, [h('div', 'foo')])
    const bar = h('div', { key: 2 }, [h('div', 'bar'), h('div', 'bar')])

    render(renderFn(foo), root)
    expect(serializeInner(root)).toBe(`text<div><div>foo</div></div>`)

    render(renderFn(bar), root)
    expect(serializeInner(root)).toBe(
      `text<div><div>bar</div><div>bar</div></div>`,
    )

    render(renderFn(foo), root)
    expect(serializeInner(root)).toBe(`text<div><div>foo</div></div>`)
  })

  // #6852
  /** keyed template 每项含静态 text 与动态 div，one/two 交换后检查顺序，验证静态文本跟随整段移动。 */
  test('`template` keyed fragment w/ text', () => {
    const root = nodeOps.createElement('div')

    /** 将 items 展开为 keyed template Fragment，每项保留固定 text 与动态 div，供静态文本移动。 */
    const renderFn = (items: string[]) => {
      return (
        openBlock(true),
        createBlock(
          Fragment,
          null,
          renderList(items, item => {
            return (
              openBlock(),
              createBlock(
                Fragment,
                { key: item },
                [
                  createTextVNode('text'),
                  createVNode('div', null, item, PatchFlags.TEXT),
                ],
                PatchFlags.STABLE_FRAGMENT,
              )
            )
          }),
          PatchFlags.KEYED_FRAGMENT,
        )
      )
    }

    render(renderFn(['one', 'two']), root)
    expect(serializeInner(root)).toBe(`text<div>one</div>text<div>two</div>`)

    render(renderFn(['two', 'one']), root)
    expect(serializeInner(root)).toBe(`text<div>two</div>text<div>one</div>`)
  })

  // #10007
  /** 创建没有 children 的 Fragment block，挂载后检查空输出，验证空范围可以正常建立。 */
  test('empty fragment', () => {
    const root = nodeOps.createElement('div')

    /** 打开禁用跟踪的 block 并返回无 children 的 Fragment，供空范围挂载。 */
    const renderFn = () => {
      return (openBlock(true), createBlock(Fragment, null))
    }

    render(renderFn(), root)
    expect(serializeInner(root)).toBe('')
  })
})
