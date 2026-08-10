/**
 * 测试阅读说明：本文件验证 `runtime-dom/rendererStaticNode` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { createStaticVNode, h, render } from '../src'

// 测试组：静态vnode处理。
describe('static vnode handling', () => {
  const content = `<div>hello</div><p>world</p>`
  const content2 = `<p>foo</p><div>bar</div><span>baz</span>`

  const s = createStaticVNode(content, 2)
  const s2 = createStaticVNode(content2, 3)

  // 测试场景：应该从字符串挂载。
  test('should mount from string', () => {
    const root = document.createElement('div')
    render(h('div', [s]), root)
    expect(root.innerHTML).toBe(`<div>${content}</div>`)
  })

  // 测试场景：应该支持重用相同的提升节点。
  test('should support reusing the same hoisted node', () => {
    const root = document.createElement('div')
    render(h('div', [s, s]), root)
    expect(root.innerHTML).toBe(`<div>${content}${content}</div>`)
  })

  // the rest only happens during HMR but needs to be correctly supported
  // 测试场景：应该更新。
  test('should update', () => {
    const root = document.createElement('div')
    render(h('div', [s]), root)
    expect(root.innerHTML).toBe(`<div>${content}</div>`)
    render(h('div', [s2]), root)
    expect(root.innerHTML).toBe(`<div>${content2}</div>`)
  })

  // 测试场景：应该移动。
  test('should move', () => {
    const root = document.createElement('div')
    render(h('div', [h('b'), s, h('b')]), root)
    expect(root.innerHTML).toBe(`<div><b></b>${content}<b></b></div>`)
    render(h('div', [s, h('b'), h('b')]), root)
    expect(root.innerHTML).toBe(`<div>${content}<b></b><b></b></div>`)
    render(h('div', [h('b'), h('b'), s]), root)
    expect(root.innerHTML).toBe(`<div><b></b><b></b>${content}</div>`)
  })

  // 测试场景：应该删除。
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
