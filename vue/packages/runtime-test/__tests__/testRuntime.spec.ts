import {
  NodeOpTypes,
  type TestElement,
  TestNodeTypes,
  type TestText,
  dumpOps,
  h,
  nextTick,
  nodeOps,
  reactive,
  ref,
  render,
  resetOps,
  serialize,
  triggerEvent,
} from '../src'

/** runtime-test宿主把元素、文本和事件保存在普通对象树中；本组直接比较序列化结果，并用triggerEvent驱动单个/数组监听器产生响应式更新。 */
describe('test renderer', () => {
  /** 测试场景：空测试root渲染带id和hello文本的div，断言节点种类、props和单文本child；核对内存宿主基础树。 */
  it('should work', () => {
    const root = nodeOps.createElement('div')
    render(
      h(
        'div',
        {
          id: 'test',
        },
        'hello',
      ),
      root,
    )

    expect(root.children.length).toBe(1)

    const el = root.children[0] as TestElement
    expect(el.type).toBe(TestNodeTypes.ELEMENT)
    expect(el.props.id).toBe('test')
    expect(el.children.length).toBe(1)

    const text = el.children[0] as TestText
    expect(text.type).toBe(TestNodeTypes.TEXT)
    expect(text.text).toBe('hello')
  })

  /** 测试场景：清日志后挂响应式div，四条日志顺序为CREATE/SET_ELEMENT_TEXT/PATCH/INSERT；更新id/text后只有两条更新且目标身份相同，核对增量渲染操作。 */
  it('should record ops', async () => {
    const state = reactive({
      id: 'test',
      text: 'hello',
    })

    const App = {
      /** 渲染'div'节点（属性{id: state.id}；state.text）。 */
      render() {
        return h(
          'div',
          {
            id: state.id,
          },
          state.text,
        )
      },
    }
    const root = nodeOps.createElement('div')

    resetOps()
    render(h(App), root)
    const ops = dumpOps()

    expect(ops.length).toBe(4)

    expect(ops[0]).toEqual({
      type: NodeOpTypes.CREATE,
      nodeType: TestNodeTypes.ELEMENT,
      tag: 'div',
      targetNode: root.children[0],
    })

    expect(ops[1]).toEqual({
      type: NodeOpTypes.SET_ELEMENT_TEXT,
      text: 'hello',
      targetNode: root.children[0],
    })

    expect(ops[2]).toEqual({
      type: NodeOpTypes.PATCH,
      targetNode: root.children[0],
      propKey: 'id',
      propPrevValue: null,
      propNextValue: 'test',
    })

    expect(ops[3]).toEqual({
      type: NodeOpTypes.INSERT,
      targetNode: root.children[0],
      parentNode: root,
      refNode: null,
    })

    // 更新文本与 id 后只应记录两次更新，不再创建或插入元素。
    state.id = 'foo'
    state.text = 'bar'
    await nextTick()

    const updateOps = dumpOps()
    expect(updateOps.length).toBe(2)

    expect(updateOps[0]).toEqual({
      type: NodeOpTypes.SET_ELEMENT_TEXT,
      targetNode: root.children[0],
      text: 'bar',
    })

    expect(updateOps[1]).toEqual({
      type: NodeOpTypes.PATCH,
      targetNode: root.children[0],
      propKey: 'id',
      propPrevValue: 'test',
      propNextValue: 'foo',
    })
  })

  /** 测试场景：div含裸布尔prop、span与文本，普通和两空格缩进序列化分别断言完整字符串，核对属性编码与递归层级。 */
  it('should be able to serialize nodes', () => {
    const App = {
      /** 渲染'div'节点（属性{id: 'test'，boolean: ''}；根数组['span'节点（'foo'）、'hello']）。 */
      render() {
        return h(
          'div',
          {
            id: 'test',
            boolean: '',
          },
          [h('span', 'foo'), 'hello'],
        )
      },
    }
    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serialize(root)).toEqual(
      `<div><div id="test" boolean><span>foo</span>hello</div></div>`,
    )
    // 启用两空格缩进，验证递归层级与节点间换行。
    expect(serialize(root, 2)).toEqual(
      `<div>
  <div id="test" boolean>
    <span>
      foo
    </span>
    hello
  </div>
</div>`,
    )
  })

  /** 测试场景：span click递增ref，triggerEvent同步改变count，nextTick后宿主文本更新；核对内存事件与响应式调度边界。 */
  it('should be able to trigger events', async () => {
    const count = ref(0)

    /** 返回'span'节点（属性{onClick回调}；count.value）。 */
    const App = () => {
      return h(
        'span',
        {
          /** 点击时递增count ref，触发测试宿主span文本在下一轮更新。 */
          onClick: () => {
            count.value++
          },
        },
        count.value,
      )
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    triggerEvent(root.children[0] as TestElement, 'click')
    expect(count.value).toBe(1)
    await nextTick()
    expect(serialize(root)).toBe(`<div><span>1</span></div>`)
  })

  /** 测试场景：span click数组有两个函数，各自递增不同ref；一次triggerEvent后两值都变，nextTick后输出1,2，核对数组顺序分发。 */
  it('should be able to trigger events with multiple listeners', async () => {
    const count = ref(0)
    const count2 = ref(1)

    /** 返回'span'节点（属性{onClick: [ () => { count.value++ }, () => { count2.value++ }, ]}；`${count.value}, ${count2.value}`）。 */
    const App = () => {
      return h(
        'span',
        {
          onClick: [
            () => {
              count.value++
            },
            () => {
              count2.value++
            },
          ],
        },
        `${count.value}, ${count2.value}`,
      )
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    triggerEvent(root.children[0] as TestElement, 'click')
    expect(count.value).toBe(1)
    expect(count2.value).toBe(2)
    await nextTick()
    expect(serialize(root)).toBe(`<div><span>1, 2</span></div>`)
  })
})
