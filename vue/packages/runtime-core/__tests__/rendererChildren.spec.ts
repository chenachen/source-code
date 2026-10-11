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

  // 逐步缩小尚未洗牌的前缀。
  while (currentIndex !== 0) {
    // 从剩余前缀中随机选一项。
    randomIndex = Math.floor(Math.random() * currentIndex)
    currentIndex -= 1
    // 与当前前缀末项交换。
    temporaryValue = array[currentIndex]
    array[currentIndex] = array[randomIndex]
    array[randomIndex] = temporaryValue
  }
  return array
}

/** 先渲染 div 的空数组，再更新为 hello 文本数组；检查两次输出，验证空数组到非空数组的挂载。 */
test('should patch previously empty children', () => {
  const root = nodeOps.createElement('div')

  render(h('div', []), root)
  expect(inner(root)).toBe('<div></div>')

  render(h('div', ['hello']), root)
  expect(inner(root)).toBe('<div>hello</div>')
})

/** 先渲染没有 children 的 div，再传 hello 数组；检查文本出现，验证空 children 到数组的转换。 */
test('should patch previously null children', () => {
  const root = nodeOps.createElement('div')

  render(h('div'), root)
  expect(inner(root)).toBe('<div></div>')

  render(h('div', ['hello']), root)
  expect(inner(root)).toBe('<div>hello</div>')
})

/** 先挂载 div 子元素数组，再改为 hello 文本；检查旧子元素消失且文本写入，验证数组到文本的转换。 */
test('array children -> text children', () => {
  const root = nodeOps.createElement('div')
  render(h('div', [h('div')]), root)
  expect(inner(root)).toBe('<div><div></div></div>')

  render(h('div', 'hello'), root)
  expect(inner(root)).toBe('<div>hello</div>')
})

/** 将普通 foo 对象放入 children 数组，检查无无效 VNode 警告且输出[object Object]，验证原始对象的文本归一化。 */
test('plain object child', () => {
  const root = nodeOps.createElement('div')
  const foo = { foo: '1' }
  // @ts-expect-error
  render(h('div', null, [foo]), root)
  expect('Invalid VNode type').not.toHaveBeenWarned()
  expect(inner(root)).toBe('<div>[object Object]</div>')
})

// renderer 的 keyed children diff、移动与复用。
describe('renderer: keyed children', () => {
  let root: TestElement
  let elm: TestElement
  /** 把数字列表转为同 key 的 span 并渲染到本例 root，返回 div 宿主方便检查 children。 */
  const renderChildren = (arr: number[]) => {
    render(h('div', arr.map(toSpan)), root)
    return root.children[0] as TestElement
  }

  beforeEach(() => {
    root = nodeOps.createElement('div')
    render(h('div', { id: 1 }, 'hello'), root)
  })

  /** key列表[1]更新为[1,2,3]，检查长度与新增2/3文本，验证尾部追加。 */
  test('append', () => {
    elm = renderChildren([1])
    expect(elm.children.length).toBe(1)

    elm = renderChildren([1, 2, 3])
    expect(elm.children.length).toBe(3)
    expect(serialize(elm.children[1])).toBe('<span>2</span>')
    expect(serialize(elm.children[2])).toBe('<span>3</span>')
  })

  /** key列表[4,5]更新为[1,2,3,4,5]，检查全部文本顺序，验证头部新增。 */
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

  /** key列表[1,2,4,5]更新为[1,2,3,4,5]，检查长度与顺序，验证中间插入。 */
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

  /** key列表[2,3,4]更新为[1,2,3,4,5]，检查顺序，验证同时在首尾新增。 */
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

  /** 空 key 列表更新为[1,2,3,4,5]，检查全部子项，验证空父容器挂载。 */
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

  /** key列表[1,2,3,4,5]改为无 children 的 div，检查原宿主元素没有子节点，验证清空整个数组。 */
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

  /** key列表[1,2,3,4,5]更新为[3,4,5]，检查长度和顺序，验证删除头部。 */
  test('remove from beginning', () => {
    elm = renderChildren([1, 2, 3, 4, 5])
    expect(elm.children.length).toBe(5)

    elm = renderChildren([3, 4, 5])
    expect(elm.children.length).toBe(3)
    expect((elm.children as TestElement[]).map(inner)).toEqual(['3', '4', '5'])
  })

  /** key列表[1,2,3,4,5]更新为[1,2,3]，检查长度和顺序，验证删除尾部。 */
  test('remove from end', () => {
    elm = renderChildren([1, 2, 3, 4, 5])
    expect(elm.children.length).toBe(5)

    elm = renderChildren([1, 2, 3])
    expect(elm.children.length).toBe(3)
    expect((elm.children as TestElement[]).map(inner)).toEqual(['1', '2', '3'])
  })

  /** key列表[1,2,3,4,5]更新为[1,2,4,5]，检查长度和顺序，验证中间删除。 */
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

  /** key列表[1,2,3,4]更新为[2,3,1,4]，检查顺序，验证前部节点向后移动。 */
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

  /** key列表[1,2,3,4]更新为[1,4,2,3]，检查顺序，验证尾部节点向前移动。 */
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

  /** key列表[1,2,3]更新为[2,3,1]，检查顺序，验证首节点移到末尾。 */
  test('moving single child to end', () => {
    elm = renderChildren([1, 2, 3])
    expect(elm.children.length).toBe(3)

    elm = renderChildren([2, 3, 1])
    expect(elm.children.length).toBe(3)
    expect((elm.children as TestElement[]).map(inner)).toEqual(['2', '3', '1'])
  })

  /** key列表[1,2,3,4]更新为[4,2,3,1]，检查顺序，验证首尾交换。 */
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

  /** key列表[1,2,3,4,5]更新为[4,1,2,3,6]，检查顺序，验证节点移动与删除/新增同时发生。 */
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

  /** key列表[1,4,5]更新为[4,6]，检查输出4/6，验证保留中间节点并删除两侧、新增尾项。 */
  test('move to left and leaves hold', () => {
    elm = renderChildren([1, 4, 5])
    expect(elm.children.length).toBe(3)

    elm = renderChildren([4, 6])
    expect((elm.children as TestElement[]).map(inner)).toEqual(['4', '6'])
  })

  /** key列表[2,4,5]更新为[4,5,3]，检查顺序，验证删除头项同时新增尾项。 */
  test('moved and set to undefined element ending at the end', () => {
    elm = renderChildren([2, 4, 5])
    expect(elm.children.length).toBe(3)

    elm = renderChildren([4, 5, 3])
    expect(elm.children.length).toBe(3)
    expect((elm.children as TestElement[]).map(inner)).toEqual(['4', '5', '3'])
  })

  /** key列表1至8整体反转，检查全部逆序文本，验证多节点重排。 */
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

  /** key列表[0,1,2,3,4,5]更新为[4,3,2,1,5,0]，检查复杂新顺序，验证非单向重排。 */
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

  /** 对14个 key 做5轮随机洗牌，同时按新位置设置 opacity；逐项检查文本与样式，验证重排和 props 更新同时正确。 */
  test('random shuffle', () => {
    const elms = 14
    const samples = 5
    const arr = [...Array(elms).keys()]
    const opacities: string[] = []

    /** 以 n 为 key/文本并写入指定 opacity，供随机重排同时更新样式。 */
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

  /** 四个 div 的 key1至4反转，其中 key2/3 改为 span；检查新标签与文本顺序，验证同 key 不同类型仍替换节点。 */
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

  /** 同位置 div 从 class:hi/one 改为无 class/four，检查 class:null 与新文本，验证旧 prop 删除；两次节点均没有显式 key。 */
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
        // DOM 宿主清除 class 时最终显示为空字符串。
        // 测试宿主保存收到的 null，不额外模拟 DOM 的字符串转换。
        class: null,
      },
    })
    expect(serialize(elm.children[0])).toBe(`<div>four</div>`)
  })

  /** key列表[1,2,3,4,5]改为含两个6的数组，检查 Duplicate keys 警告，验证未知序列的重复键诊断。 */
  test('should warn with duplicate keys', () => {
    renderChildren([1, 2, 3, 4, 5])
    renderChildren([1, 6, 6, 3, 5])
    expect(`Duplicate keys`).toHaveBeenWarned()
  })
})

// 手写数组中无 key 或混合 key 节点的更新与复用。
describe('renderer: unkeyed children', () => {
  let root: TestElement
  let elm: TestElement
  /** 数字项带 key、字符串项不带 key，将混合列表渲染到 root 后返回 div 宿主。 */
  const renderChildren = (arr: Array<number | string>) => {
    render(h('div', arr.map(toSpan)), root)
    return root.children[0] as TestElement
  }

  beforeEach(() => {
    root = nodeOps.createElement('div')
    render(h('div', { id: 1 }, 'hello'), root)
  })

  /** 混合列表[1,a,b,c]改为[d,a,b,c,1,e]，检查长度与新文本顺序，验证有/无 key 混排增大。 */
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

  /** 无 key 文本列表[hello]更新为[hello,world]，检查文本顺序，验证尾部扩展。 */
  test('append elements with updating children without keys', () => {
    elm = renderChildren(['hello'])
    expect((elm.children as TestElement[]).map(inner)).toEqual(['hello'])

    elm = renderChildren(['hello', 'world'])
    expect((elm.children as TestElement[]).map(inner)).toEqual([
      'hello',
      'world',
    ])
  })

  /** 相同 text 与 span/hello 子树连续渲染两次，检查首文本仍为 text，验证无 key 文本更新。 */
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

  /** 首文本 text 改为 text2，后面的 span/hello 不变；检查首节点文本，验证文本内容更新。 */
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

  /** 无 key 的 span/world 前新增 span/hello，检查两个文本顺序，验证同类型位置更新与尾部挂载。 */
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

  /** span/world 前新增 div/hello，检查标签 div/span 与文本顺序，验证不同类型的无 key 更新。 */
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

  /** 三个无 key span/one,two,three 改为 one,three 两项，检查文本序列，验证位置更新及尾部删除。 */
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

  /** div 的单文本数组 one 改为无 children，检查为空，验证文本节点删除。 */
  test('remove a single text node with updating children without keys', () => {
    render(h('div', ['one']), root)
    elm = root.children[0] as TestElement
    expect(serializeInner(elm)).toBe('one')

    render(h('div'), root)
    expect(serializeInner(elm)).toBe('')
  })

  /** 单文本 one 更新为 div/two 与 span/three，检查两项文本，验证文本到元素数组转换。 */
  test('remove a single text node when children are updated', () => {
    render(h('div', ['one']), root)
    elm = root.children[0] as TestElement
    expect(serializeInner(elm)).toBe('one')

    render(h('div', [h('div', ['two']), h('span', ['three'])]), root)
    elm = root.children[0] as TestElement
    expect((elm.children as TestElement[]).map(inner)).toEqual(['two', 'three'])
  })

  /** 混合文本 one 与 span/two 更新为一个 div/three，检查唯一子节点及序列化输出，验证混合 children 清理。 */
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

  /** 无 key 的 span/one、div/two、b/three 反转，检查文本顺序，验证不同标签序列重排。 */
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
  /** 首尾 null 更新为 p，中间 div 类型不变；比较中间宿主身份，验证首尾变化不会阻止中间复用。 */
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
