/**
 * 测试阅读说明：本文件验证 `runtime-dom/customizedBuiltIn` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import type { MockInstance } from 'vitest'
import { h, render } from '@vue/runtime-dom'

// 测试组：自定义内置元素支持。
describe('customized built-in elements support', () => {
  let createElement: MockInstance
  afterEach(() => {
    createElement.mockRestore()
  })

  // 测试场景：应该使用 is 选项创建元素。
  test('should created element with is option', () => {
    const root = document.createElement('div')
    createElement = vi.spyOn(document, 'createElement')
    render(h('button', { is: 'plastic-button' }), root)
    expect(createElement.mock.calls[0]).toMatchObject([
      'button',
      { is: 'plastic-button' },
    ])
    // should also render the attribute
    expect(root.innerHTML).toBe(`<button is="plastic-button"></button>`)
  })
})
