import {
  type TestElement,
  h,
  serializeInner as inner,
  nodeOps,
  render,
} from '@vue/runtime-test'

// 宿主元素的挂载、替换与 props 更新。
describe('renderer: element', () => {
  let root: TestElement

  beforeEach(() => {
    root = nodeOps.createElement('div')
  })

  /** 向空宿主根渲染 div，检查序列化结果只有空 div，验证元素首次挂载。 */
  it('should create an element', () => {
    render(h('div'), root)
    expect(inner(root)).toBe('<div></div>')
  })

  /** 向空根渲染带 id:foo 与 class:bar 的 div，检查两个属性，验证挂载时提交 props。 */
  it('should create an element with props', () => {
    render(h('div', { id: 'foo', class: 'bar' }), root)
    expect(inner(root)).toBe('<div id="foo" class="bar"></div>')
  })

  /** 渲染包含 foo、空格、bar 三段文本的 div，检查拼接顺序，验证数组文本 children 的挂载。 */
  it('should create an element with direct text children', () => {
    render(h('div', ['foo', ' ', 'bar']), root)
    expect(inner(root)).toBe('<div>foo bar</div>')
  })

  /** 渲染带 id:foo 与 bar 文本数组的 div，检查属性和内容同时存在，验证 props 与 children 都被提交。 */
  it('should create an element with direct text children and props', () => {
    render(h('div', { id: 'foo' }, ['bar']), root)
    expect(inner(root)).toBe('<div id="foo">bar</div>')
  })

  /** 先渲染 div/foo 再渲染 span/foo，检查两次标签与相同文本，验证类型变化时替换元素。 */
  it('should update an element tag which is already mounted', () => {
    render(h('div', ['foo']), root)
    expect(inner(root)).toBe('<div>foo</div>')

    render(h('span', ['foo']), root)
    expect(inner(root)).toBe('<span>foo</span>')
  })

  /** 先渲染 id:bar 的 div，再改为 id:baz 并新增 class:bar，检查最终属性与原 foo 内容，验证同类型元素的 props 更新。 */
  it('should update element props which is already mounted', () => {
    render(h('div', { id: 'bar' }, ['foo']), root)
    expect(inner(root)).toBe('<div id="bar">foo</div>')

    render(h('div', { id: 'baz', class: 'bar' }, ['foo']), root)
    expect(inner(root)).toBe('<div id="baz" class="bar">foo</div>')
  })
})
