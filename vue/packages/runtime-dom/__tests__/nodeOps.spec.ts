import { defineComponent, h, nextTick, ref } from 'vue'
import { mathmlNS, nodeOps, svgNS } from '../src/nodeOps'
import { render } from '@vue/runtime-dom'
// 测试组：直接创建select/自定义元素或向DOM容器插静态HTML；比较multiple属性、构造结果及克隆后节点身份。
describe('runtime-dom: node-ops', () => {
  /** 测试场景：创建multiple为空串的select后插入两个selected option，两者保持选中；multiple必须先于option插入设置。 */
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

  /** 测试场景：监视document.createElement，普通custom-element无第二参数，带is时传{is:li}；核对customized built-in创建选项。 */
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
    /** 测试场景：空div追加多根静态HTML，内容相同且返回首尾正好是新范围端点。 */
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

    /** 测试场景：div已有anchor前插入多根静态HTML，内容排在existing前，返回末端不是原anchor。 */
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

    /** 测试场景：SVG容器解析text/circle静态串，首尾节点与容器一致且都属SVG namespace。 */
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

    /** 测试场景：SVG容器已有path anchor，静态范围插在其前，首尾仍为SVG节点；核对wrapper拆除与插入定位。 */
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

    /** 测试场景：缓存容器保存已解析静态首尾，向新容器anchor前克隆插入；断言内容和新首尾，核对缓存范围路径。 */
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

    /** 测试场景：带v-if的MathML模板首次和响应式更新后查询msup/mrow，namespace均MathML；核对静态插入与动态创建命名空间。 */
    test('The math elements should keep their MathML namespace', async () => {
      let root = document.createElement('div') as any

      let countRef: any
      const component = defineComponent({
        /** 初始化组件状态为{value: 0}，供本例渲染和事件更新读取。 */
        data() {
          return { value: 0 }
        },
        /** 建立count=ref(0)；执行countRef=count。setup返回{count}。 */
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
