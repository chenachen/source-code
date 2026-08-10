/**
 * 测试阅读说明：本文件验证 `runtime-dom/nodeOps` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { defineComponent, h, nextTick, ref } from 'vue'
import { mathmlNS, nodeOps, svgNS } from '../src/nodeOps'
import { render } from '@vue/runtime-dom'
// 测试组：运行时dom：节点操作。
describe('runtime-dom: node-ops', () => {
  // 测试场景：<select>的多重属性应该在createElement中设置。
  test("the <select>'s multiple attr should be set in createElement", () => {
    const el = nodeOps.createElement('select', undefined, undefined, {
      multiple: '',
    }) as HTMLSelectElement
    const option1 = nodeOps.createElement('option') as HTMLOptionElement
    const option2 = nodeOps.createElement('option') as HTMLOptionElement
    option1.selected = true
    option2.selected = true
    nodeOps.insert(option1, el)
    nodeOps.insert(option2, el)

    expect(el.multiple).toBe(true)
    expect(option1.selected).toBe(true)
    expect(option2.selected).toBe(true)
  })

  // 测试场景：创建自定义元素。
  test('create custom elements', () => {
    const spyCreateElement = vi.spyOn(document, 'createElement')

    nodeOps.createElement('custom-element')
    expect(spyCreateElement).toHaveBeenLastCalledWith('custom-element')

    nodeOps.createElement('custom-element', undefined, 'li')
    expect(spyCreateElement).toHaveBeenLastCalledWith('custom-element', {
      is: 'li',
    })

    spyCreateElement.mockClear()
  })

  // 测试组：insertStaticContent 解析、克隆并插入编译器提升的静态 HTML 片段。
  describe('insertStaticContent', () => {
    // 测试场景：新鲜插入。
    test('fresh insertion', () => {
      const content = `<div>one</div><div>two</div>three`
      const parent = document.createElement('div')
      const nodes = nodeOps.insertStaticContent!(
        content,
        parent,
        null,
        undefined,
      )
      expect(parent.innerHTML).toBe(content)
      expect(nodes[0]).toBe(parent.firstChild)
      expect(nodes[1]).toBe(parent.lastChild)
    })

    // 测试场景：带锚点的新鲜插入。
    test('fresh insertion with anchor', () => {
      const content = `<div>one</div><div>two</div>three`
      const existing = `<div>existing</div>`
      const parent = document.createElement('div')
      parent.innerHTML = existing
      const anchor = parent.firstChild
      const nodes = nodeOps.insertStaticContent!(
        content,
        parent,
        anchor,
        undefined,
      )
      expect(parent.innerHTML).toBe(content + existing)
      expect(nodes[0]).toBe(parent.firstChild)
      expect(nodes[1]).toBe(parent.childNodes[parent.childNodes.length - 2])
    })

    // 测试场景：新鲜插入为svg。
    test('fresh insertion as svg', () => {
      const content = `<text>hello</text><circle cx="100" cy="100" r="80"></circle>`
      const parent = document.createElementNS(svgNS, 'svg')
      const [first, last] = nodeOps.insertStaticContent!(
        content,
        parent,
        null,
        'svg',
      )
      expect(parent.innerHTML).toBe(content)
      expect(first).toBe(parent.firstChild)
      expect(last).toBe(parent.lastChild)
      expect((first as Element).namespaceURI).toMatch('svg')
      expect((last as Element).namespaceURI).toMatch('svg')
    })

    // 测试场景：新鲜插入为 svg，带锚点。
    test('fresh insertion as svg, with anchor', () => {
      const content = `<text>hello</text><circle cx="100" cy="100" r="80"></circle>`
      const existing = `<path></path>`
      const parent = document.createElementNS(svgNS, 'svg')
      parent.innerHTML = existing
      const anchor = parent.firstChild
      const [first, last] = nodeOps.insertStaticContent!(
        content,
        parent,
        anchor,
        'svg',
      )
      expect(parent.innerHTML).toBe(content + existing)
      expect(first).toBe(parent.firstChild)
      expect(last).toBe(parent.childNodes[parent.childNodes.length - 2])
      expect((first as Element).namespaceURI).toMatch('svg')
      expect((last as Element).namespaceURI).toMatch('svg')
    })

    // 测试场景：缓存插入。
    test('cached insertion', () => {
      const content = `<div>one</div><div>two</div>three`
      const existing = `<div>existing</div>`
      const parent = document.createElement('div')
      parent.innerHTML = existing
      const anchor = parent.firstChild

      const cached = document.createElement('div')
      cached.innerHTML = content

      const nodes = nodeOps.insertStaticContent!(
        content,
        parent,
        anchor,
        undefined,
        cached.firstChild,
        cached.lastChild,
      )
      expect(parent.innerHTML).toBe(content + existing)
      expect(nodes[0]).toBe(parent.firstChild)
      expect(nodes[1]).toBe(parent.childNodes[parent.childNodes.length - 2])
    })

    // 测试场景：插入静态内容时，MathML 元素保持 MathML 命名空间。
    test('The math elements should keep their MathML namespace', async () => {
      let root = document.createElement('div') as any

      let countRef: any
      const component = defineComponent({
        data() {
          return { value: 0 }
        },
        setup() {
          const count = ref(0)
          countRef = count
          return {
            count,
          }
        },
        template: `
          <div>
            <math>
              <mrow class="bar" v-if="count % 2">Bar</mrow>
              <msup class="foo" v-else>Foo</msup>
            </math>
          </div>
        `,
      })
      render(h(component), root)
      const foo = root.querySelector('.foo')
      expect(foo.namespaceURI).toBe(mathmlNS)
      countRef.value++
      await nextTick()
      const bar = root.querySelector('.bar')
      expect(bar.namespaceURI).toBe(mathmlNS)
    })
  })
})
