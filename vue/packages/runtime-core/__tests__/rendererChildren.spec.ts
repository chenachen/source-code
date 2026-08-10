/**
 * 测试阅读说明：本文件验证 `runtime-core/rendererChildren` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
// reference: https://github.com/vuejs/vue/blob/dev/test/unit/modules/vdom/patch/children.spec.js
import {
  type TestElement,
  TestNodeTypes,
  h,
  nodeOps,
  render,
  serialize,
  serializeInner,
} from '@vue/runtime-test'
/** 把测试数据转成 span VNode；非字符串值同时作为 key，以驱动 keyed diff。 */
function toSpan(content: any) {
  if (typeof content === 'string') {
    return h('span', content.toString())
  } else {
    return h('span', { key: content }, content.toString())
  }
}

/** 将测试渲染器容器的子树序列化为便于断言的字符串。 */
const inner = (c: TestElement) => serializeInner(c)

/** Fisher–Yates 洗牌，用随机排列压力测试 keyed children 的移动与复用。 */
function shuffle(array: Array<any>) {
  let currentIndex = array.length
  let temporaryValue
  let randomIndex

  // while there remain elements to shuffle...
  while (currentIndex !== 0) {
    // pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex)
    currentIndex -= 1
    // and swap it with the current element.
    temporaryValue = array[currentIndex]
    array[currentIndex] = array[randomIndex]
    array[randomIndex] = temporaryValue
  }
  return array
}

// 测试场景：应该修补以前空的子项。
test('should patch previously empty children', () => {
  const root = nodeOps.createElement('div')

  render(h('div', []), root)
  expect(inner(root)).toBe('<div></div>')

  render(h('div', ['hello']), root)
  expect(inner(root)).toBe('<div>hello</div>')
})

// 测试场景：应该修补之前为空的子项。
test('should patch previously null children', () => {
  const root = nodeOps.createElement('div')

  render(h('div'), root)
  expect(inner(root)).toBe('<div></div>')

  render(h('div', ['hello']), root)
  expect(inner(root)).toBe('<div>hello</div>')
})

// 测试场景：数组子项 -> 文本子项。
test('array children -> text children', () => {
  const root = nodeOps.createElement('div')
  render(h('div', [h('div')]), root)
  expect(inner(root)).toBe('<div><div></div></div>')

  render(h('div', 'hello'), root)
  expect(inner(root)).toBe('<div>hello</div>')
})

// 测试场景：普通对象作为 children 时执行必要规范化。
test('plain object child', () => {
  const root = nodeOps.createElement('div')
  const foo = { foo: '1' }
  // @ts-expect-error
  render(h('div', null, [foo]), root)
  expect('Invalid VNode type').not.toHaveBeenWarned()
  expect(inner(root)).toBe('<div>[object Object]</div>')
})

// 测试组：renderer 的 keyed children diff、移动与复用。
describe('renderer: keyed children', () => {
  let root: TestElement
  let elm: TestElement
  const renderChildren = (arr: number[]) => {
    render(h('div', arr.map(toSpan)), root)
    return root.children[0] as TestElement
  }

  beforeEach(() => {
    root = nodeOps.createElement('div')
    render(h('div', { id: 1 }, 'hello'), root)
  })

  // 测试场景：追加。
  test('append', () => {
    elm = renderChildren([1])
    expect(elm.children.length).toBe(1)

    elm = renderChildren([1, 2, 3])
    expect(elm.children.length).toBe(3)
    expect(serialize(elm.children[1])).toBe('<span>2</span>')
    expect(serialize(elm.children[2])).toBe('<span>3</span>')
  })

  // 测试场景：前置。
  test('prepend', () => {
    elm = renderChildren([4, 5])
    expect(elm.children.length).toBe(2)

    elm = renderChildren([1, 2, 3, 4, 5])
    expect(elm.children.length).toBe(5)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ])
  })

  // 测试场景：插入中间。
  test('insert in middle', () => {
    elm = renderChildren([1, 2, 4, 5])
    expect(elm.children.length).toBe(4)

    elm = renderChildren([1, 2, 3, 4, 5])
    expect(elm.children.length).toBe(5)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ])
  })

  // 测试场景：在开头和结尾插入。
  test('insert at beginning and end', () => {
    elm = renderChildren([2, 3, 4])
    expect(elm.children.length).toBe(3)

    elm = renderChildren([1, 2, 3, 4, 5])
    expect(elm.children.length).toBe(5)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ])
  })

  // 测试场景：插入到空父级。
  test('insert to empty parent', () => {
    elm = renderChildren([])
    expect(elm.children.length).toBe(0)

    elm = renderChildren([1, 2, 3, 4, 5])
    expect(elm.children.length).toBe(5)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ])
  })

  // 测试场景：从父级中删除所有子级。
  test('remove all children from parent', () => {
    elm = renderChildren([1, 2, 3, 4, 5])
    expect(elm.children.length).toBe(5)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ])

    render(h('div'), root)
    expect(elm.children.length).toBe(0)
  })

  // 测试场景：从头开始删除。
  test('remove from beginning', () => {
    elm = renderChildren([1, 2, 3, 4, 5])
    expect(elm.children.length).toBe(5)

    elm = renderChildren([3, 4, 5])
    expect(elm.children.length).toBe(3)
    expect((elm.children as TestElement[]).map(inner)).toEqual(['3', '4', '5'])
  })

  // 测试场景：从末尾删除。
  test('remove from end', () => {
    elm = renderChildren([1, 2, 3, 4, 5])
    expect(elm.children.length).toBe(5)

    elm = renderChildren([1, 2, 3])
    expect(elm.children.length).toBe(3)
    expect((elm.children as TestElement[]).map(inner)).toEqual(['1', '2', '3'])
  })

  // 测试场景：从中间删除。
  test('remove from middle', () => {
    elm = renderChildren([1, 2, 3, 4, 5])
    expect(elm.children.length).toBe(5)

    elm = renderChildren([1, 2, 4, 5])
    expect(elm.children.length).toBe(4)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '1',
      '2',
      '4',
      '5',
    ])
  })

  // 测试场景：推动独生子女前进。
  test('moving single child forward', () => {
    elm = renderChildren([1, 2, 3, 4])
    expect(elm.children.length).toBe(4)

    elm = renderChildren([2, 3, 1, 4])
    expect(elm.children.length).toBe(4)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '2',
      '3',
      '1',
      '4',
    ])
  })

  // 测试场景：让独生子女倒退。
  test('moving single child backwards', () => {
    elm = renderChildren([1, 2, 3, 4])
    expect(elm.children.length).toBe(4)

    elm = renderChildren([1, 4, 2, 3])
    expect(elm.children.length).toBe(4)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '1',
      '4',
      '2',
      '3',
    ])
  })

  // 测试场景：终结独生子女。
  test('moving single child to end', () => {
    elm = renderChildren([1, 2, 3])
    expect(elm.children.length).toBe(3)

    elm = renderChildren([2, 3, 1])
    expect(elm.children.length).toBe(3)
    expect((elm.children as TestElement[]).map(inner)).toEqual(['2', '3', '1'])
  })

  // 测试场景：交换第一个和最后一个。
  test('swap first and last', () => {
    elm = renderChildren([1, 2, 3, 4])
    expect(elm.children.length).toBe(4)

    elm = renderChildren([4, 2, 3, 1])
    expect(elm.children.length).toBe(4)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '4',
      '2',
      '3',
      '1',
    ])
  })

  // 测试场景：向左移动并替换。
  test('move to left & replace', () => {
    elm = renderChildren([1, 2, 3, 4, 5])
    expect(elm.children.length).toBe(5)

    elm = renderChildren([4, 1, 2, 3, 6])
    expect(elm.children.length).toBe(5)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '4',
      '1',
      '2',
      '3',
      '6',
    ])
  })

  // 测试场景：向左移动并离开按住。
  test('move to left and leaves hold', () => {
    elm = renderChildren([1, 4, 5])
    expect(elm.children.length).toBe(3)

    elm = renderChildren([4, 6])
    expect((elm.children as TestElement[]).map(inner)).toEqual(['4', '6'])
  })

  // 测试场景：移动并设置为以末尾结尾的未定义元素。
  test('moved and set to undefined element ending at the end', () => {
    elm = renderChildren([2, 4, 5])
    expect(elm.children.length).toBe(3)

    elm = renderChildren([4, 5, 3])
    expect(elm.children.length).toBe(3)
    expect((elm.children as TestElement[]).map(inner)).toEqual(['4', '5', '3'])
  })

  // 测试场景：反转元素。
  test('reverse element', () => {
    elm = renderChildren([1, 2, 3, 4, 5, 6, 7, 8])
    expect(elm.children.length).toBe(8)

    elm = renderChildren([8, 7, 6, 5, 4, 3, 2, 1])
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '8',
      '7',
      '6',
      '5',
      '4',
      '3',
      '2',
      '1',
    ])
  })

  // 测试场景：随机打乱 keyed children，多轮验证节点移动、插入和删除结果。
  test('something', () => {
    elm = renderChildren([0, 1, 2, 3, 4, 5])
    expect(elm.children.length).toBe(6)

    elm = renderChildren([4, 3, 2, 1, 5, 0])
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '4',
      '3',
      '2',
      '1',
      '5',
      '0',
    ])
  })

  // 测试场景：随机洗牌。
  test('random shuffle', () => {
    const elms = 14
    const samples = 5
    const arr = [...Array(elms).keys()]
    const opacities: string[] = []

    function spanNumWithOpacity(n: number, o: string) {
      return h('span', { key: n, style: { opacity: o } }, n.toString())
    }

    for (let n = 0; n < samples; ++n) {
      render(
        h(
          'span',
          arr.map(n => spanNumWithOpacity(n, '1')),
        ),
        root,
      )
      elm = root.children[0] as TestElement

      for (let i = 0; i < elms; ++i) {
        expect(serializeInner(elm.children[i] as TestElement)).toBe(
          i.toString(),
        )
        opacities[i] = Math.random().toFixed(5).toString()
      }

      const shufArr = shuffle(arr.slice(0))
      render(
        h(
          'span',
          arr.map(n => spanNumWithOpacity(shufArr[n], opacities[n])),
        ),
        root,
      )
      elm = root.children[0] as TestElement
      for (let i = 0; i < elms; ++i) {
        expect(serializeInner(elm.children[i] as TestElement)).toBe(
          shufArr[i].toString(),
        )
        expect(elm.children[i]).toMatchObject({
          props: {
            style: {
              opacity: opacities[i],
            },
          },
        })
      }
    }
  })

  // 测试场景：具有相同key但具有不同标签的子级。
  test('children with the same key but with different tag', () => {
    render(
      h('div', [
        h('div', { key: 1 }, 'one'),
        h('div', { key: 2 }, 'two'),
        h('div', { key: 3 }, 'three'),
        h('div', { key: 4 }, 'four'),
      ]),
      root,
    )
    elm = root.children[0] as TestElement
    expect((elm.children as TestElement[]).map(c => c.tag)).toEqual([
      'div',
      'div',
      'div',
      'div',
    ])
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      'one',
      'two',
      'three',
      'four',
    ])

    render(
      h('div', [
        h('div', { key: 4 }, 'four'),
        h('span', { key: 3 }, 'three'),
        h('span', { key: 2 }, 'two'),
        h('div', { key: 1 }, 'one'),
      ]),
      root,
    )
    expect((elm.children as TestElement[]).map(c => c.tag)).toEqual([
      'div',
      'span',
      'span',
      'div',
    ])
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      'four',
      'three',
      'two',
      'one',
    ])
  })

  // 测试场景：具有相同标签、相同key的子级，但一个有数据，一个没有数据。
  test('children with the same tag, same key, but one with data and one without data', () => {
    render(h('div', [h('div', { class: 'hi' }, 'one')]), root)
    elm = root.children[0] as TestElement
    expect(elm.children[0]).toMatchObject({
      props: {
        class: 'hi',
      },
    })

    render(h('div', [h('div', 'four')]), root)
    elm = root.children[0] as TestElement
    expect(elm.children[0] as TestElement).toMatchObject({
      props: {
        // in the DOM renderer this will be ''
        // but the test renderer simply sets whatever value it receives.
        class: null,
      },
    })
    expect(serialize(elm.children[0])).toBe(`<div>four</div>`)
  })

  // 测试场景：应该警告重复的键。
  test('should warn with duplicate keys', () => {
    renderChildren([1, 2, 3, 4, 5])
    renderChildren([1, 6, 6, 3, 5])
    expect(`Duplicate keys`).toHaveBeenWarned()
  })
})

// 测试组：renderer 的 unkeyed children 按位置更新行为。
describe('renderer: unkeyed children', () => {
  let root: TestElement
  let elm: TestElement
  const renderChildren = (arr: Array<number | string>) => {
    render(h('div', arr.map(toSpan)), root)
    return root.children[0] as TestElement
  }

  beforeEach(() => {
    root = nodeOps.createElement('div')
    render(h('div', { id: 1 }, 'hello'), root)
  })

  // 测试场景：在非键控节点中移动尺寸增大的键。
  test('move a key in non-keyed nodes with a size up', () => {
    elm = renderChildren([1, 'a', 'b', 'c'])
    expect(elm.children.length).toBe(4)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      '1',
      'a',
      'b',
      'c',
    ])

    elm = renderChildren(['d', 'a', 'b', 'c', 1, 'e'])
    expect(elm.children.length).toBe(6)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      'd',
      'a',
      'b',
      'c',
      '1',
      'e',
    ])
  })

  // 测试场景：附加元素并更新没有键的子元素。
  test('append elements with updating children without keys', () => {
    elm = renderChildren(['hello'])
    expect((elm.children as TestElement[]).map(inner)).toEqual(['hello'])

    elm = renderChildren(['hello', 'world'])
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      'hello',
      'world',
    ])
  })

  // 测试场景：未移动的文本节点，更新没有键的子节点。
  test('unmoved text nodes with updating children without keys', () => {
    render(h('div', ['text', h('span', ['hello'])]), root)

    elm = root.children[0] as TestElement
    expect(elm.children[0]).toMatchObject({
      type: TestNodeTypes.TEXT,
      text: 'text',
    })

    render(h('div', ['text', h('span', ['hello'])]), root)

    elm = root.children[0] as TestElement
    expect(elm.children[0]).toMatchObject({
      type: TestNodeTypes.TEXT,
      text: 'text',
    })
  })

  // 测试场景：更改文本子项并更新子项而无需键。
  test('changing text children with updating children without keys', () => {
    render(h('div', ['text', h('span', ['hello'])]), root)

    elm = root.children[0] as TestElement
    expect(elm.children[0]).toMatchObject({
      type: TestNodeTypes.TEXT,
      text: 'text',
    })

    render(h('div', ['text2', h('span', ['hello'])]), root)

    elm = root.children[0] as TestElement
    expect(elm.children[0]).toMatchObject({
      type: TestNodeTypes.TEXT,
      text: 'text2',
    })
  })

  // 测试场景：在元素前面添加更新没有键的子元素。
  test('prepend element with updating children without keys', () => {
    render(h('div', [h('span', ['world'])]), root)
    elm = root.children[0] as TestElement
    expect((elm.children as TestElement[]).map(inner)).toEqual(['world'])

    render(h('div', [h('span', ['hello']), h('span', ['world'])]), root)
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      'hello',
      'world',
    ])
  })

  // 测试场景：在不同标签类型的元素前面加上更新没有键的子元素。
  test('prepend element of different tag type with updating children without keys', () => {
    render(h('div', [h('span', ['world'])]), root)
    elm = root.children[0] as TestElement
    expect((elm.children as TestElement[]).map(inner)).toEqual(['world'])

    render(h('div', [h('div', ['hello']), h('span', ['world'])]), root)
    expect((elm.children as TestElement[]).map(c => c.tag)).toEqual([
      'div',
      'span',
    ])
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      'hello',
      'world',
    ])
  })

  // 测试场景：删除元素并更新没有键的子元素。
  test('remove elements with updating children without keys', () => {
    render(
      h('div', [h('span', ['one']), h('span', ['two']), h('span', ['three'])]),
      root,
    )
    elm = root.children[0] as TestElement
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      'one',
      'two',
      'three',
    ])

    render(h('div', [h('span', ['one']), h('span', ['three'])]), root)
    elm = root.children[0] as TestElement
    expect((elm.children as TestElement[]).map(inner)).toEqual(['one', 'three'])
  })

  // 测试场景：删除单个文本节点并更新没有键的子节点。
  test('remove a single text node with updating children without keys', () => {
    render(h('div', ['one']), root)
    elm = root.children[0] as TestElement
    expect(serializeInner(elm)).toBe('one')

    render(h('div'), root)
    expect(serializeInner(elm)).toBe('')
  })

  // 测试场景：更新子节点时删除单个文本节点。
  test('remove a single text node when children are updated', () => {
    render(h('div', ['one']), root)
    elm = root.children[0] as TestElement
    expect(serializeInner(elm)).toBe('one')

    render(h('div', [h('div', ['two']), h('span', ['three'])]), root)
    elm = root.children[0] as TestElement
    expect((elm.children as TestElement[]).map(inner)).toEqual(['two', 'three'])
  })

  // 测试场景：删除其他元素中的文本节点。
  test('remove a text node among other elements', () => {
    render(h('div', ['one', h('span', ['two'])]), root)
    elm = root.children[0] as TestElement
    expect((elm.children as TestElement[]).map(c => serialize(c))).toEqual([
      'one',
      '<span>two</span>',
    ])

    render(h('div', [h('div', ['three'])]), root)
    elm = root.children[0] as TestElement
    expect(elm.children.length).toBe(1)
    expect(serialize(elm.children[0])).toBe('<div>three</div>')
  })

  // 测试场景：重新排序元素。
  test('reorder elements', () => {
    render(
      h('div', [h('span', ['one']), h('div', ['two']), h('b', ['three'])]),
      root,
    )
    elm = root.children[0] as TestElement
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      'one',
      'two',
      'three',
    ])

    render(
      h('div', [h('b', ['three']), h('div', ['two']), h('span', ['one'])]),
      root,
    )
    elm = root.children[0] as TestElement
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      'three',
      'two',
      'one',
    ])
  })

  // #6502
  // 测试场景：头部和尾部均发生变化时不应取消选择。
  test('should not de-opt when both head and tail change', () => {
    render(h('div', [null, h('div'), null]), root)
    elm = root.children[0] as TestElement
    const original = elm.children[1]

    render(h('div', [h('p'), h('div'), h('p')]), root)
    elm = root.children[0] as TestElement
    const postPatch = elm.children[1]

    expect(postPatch).toBe(original)
  })
})
