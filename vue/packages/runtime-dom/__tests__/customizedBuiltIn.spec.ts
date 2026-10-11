import type { MockInstance } from 'vitest'
import { h, render } from '@vue/runtime-dom'

// 测试组：监视document.createElement，再render带is选项的button；核对创建参数与最终is attribute。
describe('customized built-in elements support', () => {
  let createElement: MockInstance
  afterEach(() => {
    createElement.mockRestore()
  })

  /** 测试场景：渲染button并传is=plastic-button，createElement第二参数含同一is，DOM还保留is attribute；核对创建与prop修补协作。 */
  test('should created element with is option', () => {
    const root = document.createElement('div')
    createElement = vi.spyOn(document, 'createElement')
    render(h('button', { is: 'plastic-button' }), root)
    expect(createElement.mock.calls[0]).toMatchObject([
      'button',
      { is: 'plastic-button' },
    ])
    // 同时检查原生 is attribute 写入。
    expect(root.innerHTML).toBe(`<button is="plastic-button"></button>`)
  })
})
