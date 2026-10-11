import { createStaticVNode, h, render } from '../src'

// 测试组：render挂载含Static VNode的真实DOM树，再替换静态文本、切分支或重排列表；比较innerHTML及静态首尾节点定位。
describe('static vnode handling', () => {
  const content = `<div>hello</div><p>world</p>`
  const content2 = `<p>foo</p><div>bar</div><span>baz</span>`

  const s = createStaticVNode(content, 2)
  const s2 = createStaticVNode(content2, 3)

  /** 测试场景：div children中挂编译器静态VNode s，innerHTML为完整content；核对静态范围首次插入。 */
  test('should mount from string', () => {
    const root = document.createElement('div')
    render(h('div', [s]), root)
    expect(root.innerHTML).toBe(`<div>${content}</div>`)
  })

  /** 测试场景：同一个已提升静态VNode s在同父出现两次，两份content均显示；核对已有范围克隆而非共享宿主位置。 */
  test('should support reusing the same hoisted node', () => {
    const root = document.createElement('div')
    render(h('div', [s, s]), root)
    expect(root.innerHTML).toBe(`<div>${content}${content}</div>`)
  })

  // 后续静态内容更新/移动是 HMR 可触发的路径，分别检查宿主复用与替换。
  /** 测试场景：已有静态content换为s2/content2，整范围更新；该替换路径对应HMR用法。 */
  test('should update', () => {
    const root = document.createElement('div')
    render(h('div', [s]), root)
    expect(root.innerHTML).toBe(`<div>${content}</div>`)
    render(h('div', [s2]), root)
    expect(root.innerHTML).toBe(`<div>${content2}</div>`)
  })

  /** 测试场景：静态多根范围在两b兄弟之间、之前、之后依次重排，断言整段HTML顺序，核对首尾范围一起移动。 */
  test('should move', () => {
    const root = document.createElement('div')
    render(h('div', [h('b'), s, h('b')]), root)
    expect(root.innerHTML).toBe(`<div><b></b>${content}<b></b></div>`)
    render(h('div', [s, h('b'), h('b')]), root)
    expect(root.innerHTML).toBe(`<div>${content}<b></b><b></b></div>`)
    render(h('div', [h('b'), h('b'), s]), root)
    expect(root.innerHTML).toBe(`<div><b></b><b></b>${content}</div>`)
  })

  /** 测试场景：静态范围先在两b之间，移除后只剩b，再加回末尾显示完整content；核对整范围删除/再挂载。 */
  test('should remove', () => {
    const root = document.createElement('div')
    render(h('div', [h('b'), s, h('b')]), root)
    expect(root.innerHTML).toBe(`<div><b></b>${content}<b></b></div>`)
    render(h('div', [h('b'), h('b')]), root)
    expect(root.innerHTML).toBe(`<div><b></b><b></b></div>`)
    render(h('div', [h('b'), h('b'), s]), root)
    expect(root.innerHTML).toBe(`<div><b></b><b></b>${content}</div>`)
  })
})
