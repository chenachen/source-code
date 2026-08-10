/**
 * 测试阅读说明：本文件验证 `runtime-core/rendererElement` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import {
  type TestElement,
  h,
  serializeInner as inner,
  nodeOps,
  render,
} from '@vue/runtime-test'

// 测试组：renderer：元素。
describe('renderer: element', () => {
  let root: TestElement

  beforeEach(() => {
    root = nodeOps.createElement('div')
  })

  // 测试场景：应该创建一个元素。
  it('should create an element', () => {
    render(h('div'), root)
    expect(inner(root)).toBe('<div></div>')
  })

  // 测试场景：应该创建一个带有 props 的元素。
  it('should create an element with props', () => {
    render(h('div', { id: 'foo', class: 'bar' }), root)
    expect(inner(root)).toBe('<div id="foo" class="bar"></div>')
  })

  // 测试场景：应该创建一个带有直接文本子元素的元素。
  it('should create an element with direct text children', () => {
    render(h('div', ['foo', ' ', 'bar']), root)
    expect(inner(root)).toBe('<div>foo bar</div>')
  })

  // 测试场景：应该创建一个带有直接文本子元素和 props 的元素。
  it('should create an element with direct text children and props', () => {
    render(h('div', { id: 'foo' }, ['bar']), root)
    expect(inner(root)).toBe('<div id="foo">bar</div>')
  })

  // 测试场景：应该更新已经挂载的元素标签。
  it('should update an element tag which is already mounted', () => {
    render(h('div', ['foo']), root)
    expect(inner(root)).toBe('<div>foo</div>')

    render(h('span', ['foo']), root)
    expect(inner(root)).toBe('<span>foo</span>')
  })

  // 测试场景：应该更新已经挂载的元素props。
  it('should update element props which is already mounted', () => {
    render(h('div', { id: 'bar' }, ['foo']), root)
    expect(inner(root)).toBe('<div id="bar">foo</div>')

    render(h('div', { id: 'baz', class: 'bar' }, ['foo']), root)
    expect(inner(root)).toBe('<div id="baz" class="bar">foo</div>')
  })
})
