/**
 * 测试阅读说明：本文件验证 `runtime-dom/createApp` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { createApp, h } from '../src'

// 测试组：runtime-dom createApp 在 HTML、SVG 和 MathML 容器中的平台挂载行为。
describe('createApp for dom', () => {
  // #2926
  // 测试场景：挂载到SVG容器。
  test('mount to SVG container', () => {
    const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    createApp({
      render() {
        return h('g')
      },
    }).mount(root)
    expect(root.children.length).toBe(1)
    expect(root.children[0]).toBeInstanceOf(SVGElement)
  })

  // #4398
  // 测试场景：不应改变原始根组件选项对象。
  test('should not mutate original root component options object', () => {
    const originalObj = {
      data() {
        return {
          counter: 0,
        }
      },
    }

    const handler = vi.fn(msg => {
      expect(msg).toMatch(`Component is missing template or render function`)
    })

    const Root = { ...originalObj }

    const app = createApp(Root)
    app.config.warnHandler = handler
    app.mount(document.createElement('div'))

    // ensure mount is based on a copy of Root object rather than Root object itself
    expect(app._component).not.toBe(Root)

    // ensure no mutation happened to Root object
    expect(originalObj).toMatchObject(Root)
  })
})
