import { createApp, h } from '../src'

// 测试组：把根组件挂入SVG或内含模板的div；比较命名空间、容器内容和原始组件选项。
describe('createApp for dom', () => {
  // #2926
  /** 测试场景：SVG根容器挂载g子树，断言一个子元素且为SVGElement；核对mount推导根namespace。 */
  test('mount to SVG container', () => {
    const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    createApp({
      /** 渲染'g'节点。 */
      render() {
        return h('g')
      },
    }).mount(root)
    expect(root.children.length).toBe(1)
    expect(root.children[0]).toBeInstanceOf(SVGElement)
  })

  // #4398
  /** 测试场景：只含data的原组件对象挂载到空容器，触发缺render/template告警；app._component为副本，原Root仍匹配原选项，核对组件定义保护。 */
  test('should not mutate original root component options object', () => {
    const originalObj = {
      /** 初始化组件状态为{counter: 0}，供本例渲染和事件更新读取。 */
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

    // 挂载基于 Root 选项副本，以当前容器内容作为模板。
    expect(app._component).not.toBe(Root)

    // 原始 Root 选项对象未被写入 template。
    expect(originalObj).toMatchObject(Root)
  })
})
