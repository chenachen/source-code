import * as Y from '../src/index.js'
import { init, compare } from './testHelper.js'
import * as t from 'lib0/testing'
import * as delta from 'lib0/delta'

/**
 * 根属性内集成具名 test 子类型，但子属性尚未写入；用已知键与索引签名读取属性，并赋给显式类型变量。静态检查约束属性类型，运行时只打印 undefined 与空属性对象。
 * 没有运行时断言。
 */
export const testCustomTypings = () => {
  const ydoc = new Y.Doc()
  const ymap = ydoc.get()
  /**
   * @type {Y.Type<{ attrs: { num: number, str: string, [k:string]: number|string } }>}
   */
  const yxml = ymap.setAttr('yxml', new Y.Type('test'))
  /**
   * @type {number|undefined}
   */
  const num = yxml.getAttr('num')
  /**
   * @type {string|undefined}
   */
  const str = yxml.getAttr('str')
  /**
   * @type {object|number|string|undefined}
   */
  const dtrn = yxml.getAttr('dtrn')
  const attrs = yxml.getAttrs()
  /**
   * @type {object|number|string|undefined}
   */
  const any = attrs.shouldBeAny
  console.log({ num, str, dtrn, attrs, any })
}

/**
 * 两个空 XML 风格根类型；第一端设置 height=10 后同步。两端 getAttr 均为字符串 10，最终副本收敛。
 *
 * @param {t.TestCase} tc
 */
export const testSetProperty = tc => {
  const { testConnector, users, xml0, xml1 } = init(tc, { users: 2 })
  xml0.setAttr('height', '10')
  t.assert(xml0.getAttr('height') === '10', 'Simple set+get works')
  testConnector.flushAllMessages()
  t.assert(xml1.getAttr('height') === '10', 'Simple set+get works (remote)')
  compare(users)
}

/**
 * 两个空 XML 风格根类型；第一端设置 height 并同步，再删除并同步。两端 hasAttr 先为 true、后为 false，最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testHasProperty = tc => {
  const { testConnector, users, xml0, xml1 } = init(tc, { users: 2 })
  xml0.setAttr('height', '10')
  t.assert(xml0.hasAttr('height'), 'Simple set+has works')
  testConnector.flushAllMessages()
  t.assert(xml1.hasAttr('height'), 'Simple set+has works (remote)')
  xml0.deleteAttr('height')
  t.assert(!xml0.hasAttr('height'), 'Simple set+remove+has works')
  testConnector.flushAllMessages()
  t.assert(!xml1.hasAttr('height'), 'Simple set+remove+has works (remote)')
  compare(users)
}

/**
 * 匿名空根类型注册浅层 observer；设置 test=42。事件 attrs.test 是 insert，单键读取为 42，getAttrs 为 `{test:42}`。
 *
 * @param {t.TestCase} _tc
 */
export const testYtextAttributes = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get('')
  ytext.observe(event => {
    t.assert(event.delta.attrs.test?.type === 'insert')
  })
  ytext.setAttr('test', 42)
  t.compare(ytext.getAttr('test'), 42)
  t.compare(ytext.getAttrs(), { test: 42 })
}

/**
 * 匿名根片段为空；插入一个匿名子类型和一个 p 子类型。首个子类型 parent 指向根，根 parent 为 null。
 * 没有读取或比较兄弟指针。
 *
 * @param {t.TestCase} _tc
 */
export const testSiblings = _tc => {
  const ydoc = new Y.Doc()
  const yxml = ydoc.get()
  const first = new Y.Type()
  const second = new Y.Type('p')
  yxml.insert(0, [first, second])
  t.assert(first.parent === /** @type {Y.Type<any>} */ (yxml))
  t.assert(yxml.parent === null)
}

/**
 * 根片段已有 text、p、p 三个子节点；克隆完整树并把克隆挂入 copyarr。克隆长度为 3，深层 JSON 与原树相同。
 * 没有断言具体 ID 或修改后两树独立性。
 *
 * @param {t.TestCase} _tc
 */
export const testClone = _tc => {
  const ydoc = new Y.Doc()
  const yxml = ydoc.get()
  const first = new Y.Type('text')
  const second = new Y.Type('p')
  const third = new Y.Type('p')
  yxml.push([first, second, third])
  t.compareArrays(yxml.toArray(), [first, second, third])
  const cloneYxml = yxml.clone()
  ydoc.get('copyarr').insert(0, [cloneYxml])
  t.assert(cloneYxml.length === 3)
  t.compare(cloneYxml.toJSON(), yxml.toJSON())
}

/**
 * 空片段准备 A/C 带 em+strong、B 仅带 em 的 Delta；应用后再读取 toDelta。三段交叠格式与输入 Delta 相等。
 *
 * @param {t.TestCase} _tc
 */
export const testFormattingBug = _tc => {
  const ydoc = new Y.Doc()
  const yxml = ydoc.get()
  const q = delta.create()
    .insert('A', { em: {}, strong: {} })
    .insert('B', { em: {} })
    .insert('C', { em: {}, strong: {} })
  yxml.applyDelta(q)
  t.compare(yxml.toDelta(), q)
}

/**
 * 匿名根片段为空；一次插入 text1 与 text2 两个具名子节点。toArray 按原顺序返回同两个对象。
 *
 * @param {t.TestCase} _tc
 */
export const testElement = _tc => {
  const ydoc = new Y.Doc()
  const yxmlel = ydoc.get()
  const text1 = new Y.Type('text1')
  const text2 = new Y.Type('text2')
  yxmlel.insert(0, [text1, text2])
  t.compareArrays(yxmlel.toArray(), [text1, text2])
}

/**
 * 关闭 GC 的已集成片段含 hello 子类型与空子类型；一事务删 hello 子类型并追加 world 子类型，用本轮 ID 集建 Renderer。父层旧/新子分别带 delete/insert，直接渲染旧 hello 内容也带 delete。
 *
 * @param {t.TestCase} _tc
 */
export const testFragmentAttributedContent = _tc => {
  const ydoc = new Y.Doc({ gc: false })
  const yfragment = new Y.Type()
  const elem1 = Y.Type.from(delta.create().insert('hello'))
  const elem2 = new Y.Type()
  const elem3 = Y.Type.from(delta.create().insert('world'))
  yfragment.insert(0, [elem1, elem2])
  ydoc.get().insert(0, [yfragment])
  let renderer = /** @type {AbstractRenderer?} */ (null)
  ydoc.on('afterTransaction', tr => {
    // 空属性数组也标记插入/删除归因，只是不提供作者名。
    renderer = new Y.AttributionsRenderer(Y.createContentMap(Y.createIdMapFromIdSet(tr.insertSet, []), Y.createIdMapFromIdSet(tr.deleteSet, [])))
  })
  t.group('insert / delete', () => {
    ydoc.transact(() => {
      yfragment.delete(0, 1)
      yfragment.insert(1, [elem3])
    })
    const expectedContent = delta.create().insert([elem1], null, { delete: [] }).insert([elem2]).insert([elem3], null, { insert: [] })
    const attributedContent = yfragment.toDelta({ renderer })
    console.log(attributedContent.toJSON())
    t.assert(attributedContent.equals(expectedContent))
    t.compare(elem1.toDelta({ renderer }).toJSON(), delta.create().insert('hello', null, { delete: [] }).toJSON())
  })
}

/**
 * 关闭 GC 的根键 p 含 hello 与 span 两个 Delta 子节点；一事务删 hello、追加 world 并设 key=42，再深层渲染。旧/新子节点及其文本分别带 delete/insert，key 的正向 setAttr 带 insert 归因。
 *
 * @param {t.TestCase} _tc
 */
export const testElementAttributedContent = _tc => {
  const ydoc = new Y.Doc({ gc: false })
  const yelement = ydoc.get('p')
  const elem1 = delta.create().insert('hello').done()
  const elem2 = delta.create('span').done()
  const elem3 = delta.create().insert('world').done()
  yelement.insert(0, [elem1, elem2])
  let renderer = /** @type {AbstractRenderer?} */ (null)
  ydoc.on('afterTransaction', tr => {
    // 每次事务用它的插入/删除集合构造当前归因视图。
    renderer = new Y.AttributionsRenderer(Y.createContentMap(Y.createIdMapFromIdSet(tr.insertSet, []), Y.createIdMapFromIdSet(tr.deleteSet, [])))
  })
  t.group('insert / delete', () => {
    ydoc.transact(() => {
      yelement.delete(0, 1)
      yelement.insert(1, [elem3])
      yelement.setAttr('key', '42')
    })
    const expectedContent = delta.create()
      .insert([delta.create().insert('hello', null, { delete: [] })], null, { delete: [] })
      .insert([elem2])
      .insert([delta.create().insert('world', null, { insert: [] })], null, { insert: [] })
      .setAttr('key', '42', { insert: [] })
    const attributedContent = yelement.toDeltaDeep({ renderer })
    console.log('retrieved content', attributedContent.toJSON())
    t.assert(attributedContent.equals(expectedContent))
    t.compare(attributedContent.toJSON().attrs, { key: { type: 'insert', value: '42', attribution: { insert: [] } } })
  })
}

/**
 * 基线键 p 含 hello 和 span，目标文档已复制它；目标删 hello、加 world 与 key=42，再建 DiffRenderer；随后 world 前插 big，最终把目标同步回基线。深层视图随编辑显示 bigworld 的插入归因，两端同步后删除旧子消失且插入/属性归因清除。
 * 根键 p 是访问名，输出节点 name 仍为 null。
 *
 * @param {t.TestCase} _tc
 */
export const testElementAttributedContentViaDiffer = _tc => {
  const ydocV1 = new Y.Doc()
  ydocV1.get('p').insert(0, [delta.create().insert('hello'), delta.create('span')])
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(ydocV1))
  const yelement = ydoc.get('p')
  const elem2 = yelement.get(1) // 具名 `span` Y.Type 子节点。
  const elem3 = Y.Type.from(delta.create().insert('world'))
  ydoc.transact(() => {
    yelement.delete(0, 1)
    yelement.insert(1, [elem3])
    yelement.setAttr('key', '42')
  })
  const renderer = Y.createDiffRenderer(ydocV1, ydoc)
  const expectedContent = delta.create().insert([delta.create().insert('hello')], null, { delete: [] }).insert([elem2.toDeltaDeep()]).insert([delta.create().insert('world', null, { insert: [] })], null, { insert: [] }).setAttr('key', '42', { insert: [] })
  const attributedContent = yelement.toDeltaDeep({ renderer })
  console.log('children', attributedContent.toJSON().children)
  console.log('attributes', attributedContent.toJSON().attrs)
  t.compare(attributedContent.toJSON(), expectedContent.toJSON())
  t.assert(attributedContent.equals(expectedContent))
  t.compare(attributedContent.toJSON().attrs, { key: { type: 'insert', value: '42', attribution: { insert: [] } } })
  t.group('test getContentDeep', () => {
    const expectedContent = delta.create()
      .insert(
        [delta.create().insert('hello')],
        null,
        { delete: [] }
      )
      .insert([delta.create('span')])
      .insert([
        delta.create().insert('world', null, { insert: [] })
      ], null, { insert: [] })
      .setAttr('key', '42', { insert: [] })
    const attributedContent = yelement.toDeltaDeep({ renderer })
    console.log('children', JSON.stringify(attributedContent.toJSON().children, null, 2))
    console.log('cs expec', JSON.stringify(expectedContent.toJSON(), null, 2))
    console.log('attributes', attributedContent.toJSON().attrs)
    t.assert(attributedContent.equals(expectedContent))
    t.compare(attributedContent.toJSON().attrs, { key: { type: 'insert', value: '42', attribution: { insert: [] } } })
    t.assert(attributedContent.name === null)
  })
  ydoc.transact(() => {
    elem3.insert(0, 'big')
  })
  t.group('test getContentDeep after some more updates', () => {
    t.info('expecting DiffRenderer to auto update itself')
    const expectedContent = delta.create()
      .insert(
        [delta.create().insert('hello')],
        null,
        { delete: [] }
      )
      .insert([delta.create('span')])
      .insert([
        delta.create().insert('bigworld', null, { insert: [] })
      ], null, { insert: [] })
      .setAttr('key', '42', { insert: [] })
    const attributedContent = yelement.toDeltaDeep({ renderer })
    console.log('children', JSON.stringify(attributedContent.toJSON().children, null, 2))
    console.log('cs expec', JSON.stringify(expectedContent.toJSON(), null, 2))
    console.log('attributes', attributedContent.toJSON().attrs)
    t.assert(attributedContent.equals(expectedContent))
    t.compare(attributedContent.toJSON().attrs, { key: { type: 'insert', value: '42', attribution: { insert: [] } } })
    t.assert(attributedContent.name === null)
  })
  Y.applyUpdate(ydocV1, Y.encodeStateAsUpdate(ydoc))
  t.group('test getContentDeep both docs synced', () => {
    t.info('expecting DiffRenderer to auto update itself')
    const expectedContent = delta.create().insert([delta.create('span')]).insert([
      delta.create().insert('bigworld')
    ]).setAttr('key', '42')
    const attributedContent = yelement.toDeltaDeep({ renderer })
    console.log('children', JSON.stringify(attributedContent.toJSON().children, null, 2))
    console.log('cs expec', JSON.stringify(expectedContent.toJSON(), null, 2))
    console.log('attributes', attributedContent.toJSON().attrs)
    t.assert(attributedContent.equals(expectedContent))
    t.compare(attributedContent.toJSON().attrs, { key: { type: 'insert', value: '42' } })
    t.assert(attributedContent.name === null)
  })
}

/**
 * 基线 client0 有 hello world 子文本，client1 分叉已复制它；分叉加 span、给 hello 设 italic、插入后删 deleteme，再加感叹号。打印带格式/插入归因的深层 DiffRenderer 示例。
 * deleteme 未进入基线而被排除；注释示例展示输出，但用例没有断言。
 *
 * @param {t.TestCase} _tc
 */
export const testRendererSimpleExample = _tc => {
  const ydoc = new Y.Doc()
  ydoc.clientID = 0
  // 基线文档含一个 `hello world` 文本子节点。
  ydoc.get().insert(0, [delta.create().insert('hello world')])
  const ydocFork = new Y.Doc()
  ydocFork.clientID = 1
  Y.applyUpdate(ydocFork, Y.encodeStateAsUpdate(ydoc))
  // 分叉文档追加 span、格式化 hello、插入后删除一段文本并追加感叹号。
  ydocFork.get().insert(1, [new Y.Type('span')])
  const ytext = ydocFork.get().get(0)
  // 给 `hello` 添加 italic。
  ytext.format(0, 5, { italic: true })
  ytext.insert(11, 'deleteme')
  ytext.delete(11, 8)
  ytext.insert(11, '!')
  // `deleteme` 只存在于分叉历史中，插入后又删除，不进入可见差异；其余变化渲染如下。
  console.log(JSON.stringify(ydocFork.get().toDeltaDeep({ renderer: Y.createDiffRenderer(ydoc, ydocFork) }), null, 2))
/* =>
{
  "type": "delta",
  "children": [
    {
      "type": "insert",
      "insert": [
        {
          "type": "delta",
          "children": [
            {
              "type": "insert",
              "insert": "hello",
              "format": { "italic": true },
              "attribution": { "format": { "italic": [] } }
            },
            { "type": "insert", "insert": " world" },
            {
              "type": "insert",
              "insert": "!",
              "attribution": { "insert": [] }
            }
          ]
        }
      ]
    },
    {
      "type": "insert",
      "insert": [{ "type": "delta", "name": "span" }],
      "attribution": { "insert": [] }
    }
  ]
}
*/
}

/**
 * 递归遍历 Delta 属性和子操作，收集构造器名属于禁用集合的 op，并记录可定位的树路径。
 *
 * @param {any} d - 当前 Delta 节点；属性操作仅检查自身，不递归其 value。
 * @param {Array<string>} forbidden - 不允许出现的构造器名。
 * @param {string} [path] - 当前节点路径，默认从 `$` 开始。
 * @param {Array<{path:string, opType:string, op:any}>} [acc] - 原地追加的共享收集数组。
 * @return {Array<{path:string, opType:string, op:any}>} 同一收集数组；子列表 insert 数组和值式 modify 会继续递归。
 */
const collectForbiddenOps = (d, forbidden, path = '$', acc = []) => {
  if (d == null || typeof d !== 'object') return acc
  if (d.attrs != null) {
    for (const attrOp of d.attrs) {
      const name = attrOp?.constructor?.name
      if (name && forbidden.includes(name)) {
        acc.push({ path: `${path}.attrs[${attrOp.key}]`, opType: name, op: attrOp })
      }
    }
  }
  if (d.children?.start != null) {
    let op = d.children.start
    let i = 0
    while (op != null) {
      const name = op.constructor?.name
      if (name && forbidden.includes(name)) {
        acc.push({ path: `${path}.children[${i}]`, opType: name, op })
      }
      if (op.insert && Array.isArray(op.insert)) {
        op.insert.forEach((/** @type {any} */ nested, /** @type {number} */ j) => collectForbiddenOps(nested, forbidden, `${path}.children[${i}].insert[${j}]`, acc))
      }
      if (op.value != null) {
        collectForbiddenOps(op.value, forbidden, `${path}.children[${i}].value`, acc)
      }
      op = op.next
      i++
    }
  }
  return acc
}

/**
 * 关闭 GC 的基线片段含 item 子元素、id=C 属性和 hello 嵌套文本，目标已复制；目标删除整个 item 子元素后以 DiffRenderer 深层渲染。collectForbiddenOps 在本用例遍历路径内未找到 DeleteOp/DeleteAttrOp。
 * 回归 y-prosemirror#247；只禁止这两种指令，不单独断言旧值、归因或所有操作种类。
 *
 * @param {t.TestCase} _tc
 */
export const testToDeltaDeepEmitsNoDeleteOpsForSoftDeletedParent = _tc => {
  // 基线文档：片段含一个带 `id` 属性和嵌套文本的元素。
  const ydocV1 = new Y.Doc({ gc: false })
  const parentV1 = ydocV1.get('frag')
  const childV1 = new Y.Type('item')
  childV1.setAttr('id', 'C')
  childV1.insert(0, [delta.create().insert('hello')])
  parentV1.insert(0, [childV1])

  // 分叉文档删除该元素；diff attribution 下它仍作为软删除节点可见，其 `id` Item 会级联 tombstone。
  const ydoc = new Y.Doc({ gc: false })
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(ydocV1))
  const parent = ydoc.get('frag')
  ydoc.transact(() => {
    parent.delete(0, 1)
  })

  const renderer = Y.createDiffRenderer(ydocV1, ydoc)
  const rendered = parent.toDeltaDeep({ renderer })

  // 检查本 fixture 的级联结果没有再次执行删除的指令；不单独比较旧值或 attribution。
  const offenders = collectForbiddenOps(rendered, ['DeleteAttrOp', 'DeleteOp'])
  if (offenders.length > 0) {
    console.log('Forbidden delete ops in toDeltaDeep output:')
    for (const o of offenders) {
      console.log(`  ${o.opType} at ${o.path}`)
    }
    console.log('Full delta:', JSON.stringify(rendered.toJSON(), null, 2))
  }
  t.assert(
    offenders.length === 0,
    `toDeltaDeep(renderer) emitted ${offenders.length} forbidden delete op(s) for a soft-deleted parent (issue #247 / y-prosemirror)`
  )
}

/**
 * 关闭 GC 的基线 p 有 id=C，目标已复制；目标直接删除 id 后用 DiffRenderer 深层渲染。没有 DeleteOp/DeleteAttrOp，attrs.id 仍是旧值 C 的正向 setAttr 且带 `{delete:[]}`。
 *
 * @param {t.TestCase} _tc
 */
export const testToDeltaDeepRendersExplicitDeleteAttrAsSetAttrWithAttribution = _tc => {
  const ydocV1 = new Y.Doc({ gc: false })
  ydocV1.get('p').setAttr('id', 'C')
  const ydoc = new Y.Doc({ gc: false })
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(ydocV1))
  ydoc.transact(() => {
    ydoc.get('p').deleteAttr('id')
  })
  const renderer = Y.createDiffRenderer(ydocV1, ydoc)
  const rendered = ydoc.get('p').toDeltaDeep({ renderer })

  const offenders = collectForbiddenOps(rendered, ['DeleteAttrOp', 'DeleteOp'])
  t.assert(offenders.length === 0, 'no DeleteAttrOp / DeleteOp from explicit deleteAttr under diff AM')
  t.compare(
    rendered.toJSON().attrs,
    { id: { type: 'insert', value: 'C', attribution: { delete: [] } } },
    'explicit deleteAttr surfaces as SetAttrOp with prior value and delete attribution'
  )
}
