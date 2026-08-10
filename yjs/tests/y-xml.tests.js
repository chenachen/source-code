import * as Y from '../src/index.js'
import { init, compare } from './testHelper.js'
import * as t from 'lib0/testing'
import * as delta from 'lib0/delta'

/** 验证具名 XML 风格 `Y.Type` 的属性泛型可精确推导已知键与索引签名。 */
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
 * 验证 XML 属性本地 set/get 后可同步到远端。
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
 * 验证 XML 属性存在性随 set/delete 在本地和远端一致变化。
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
 * 验证匿名文本类型也支持属性事件、读取与批量导出。
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
 * 验证嵌套子节点的 `parent` 指向宿主，而根片段没有父级。
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
 * 验证 XML 风格共享树克隆后拥有独立 CRDT 身份但相同深层 JSON。
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
 * 验证交叠 `em`/`strong` 格式边界可无损往返 Delta。
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
 * 验证具名子元素按插入顺序保存在匿名片段中。
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
 * 验证片段删除/插入子类型时，父子 Renderer 都传播对应 attribution。
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
    // renderer = new AttributionsRenderer(createIdMapFromIdSet(tr.insertSet, [new Y.Attribution('insertAt', 42), new Y.Attribution('insert', 'kevin')]), createIdMapFromIdSet(tr.deleteSet, [new Y.Attribution('delete', 'kevin')]))
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
 * 验证具名元素的深层子节点和属性变化均携带插入/删除 attribution。
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
    // renderer = new AttributionsRenderer(createIdMapFromIdSet(tr.insertSet, [new Y.Attribution('insertAt', 42), new Y.Attribution('insert', 'kevin')]), createIdMapFromIdSet(tr.deleteSet, [new Y.Attribution('delete', 'kevin')]))
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
 * 验证 DiffRenderer 随两文档演进自动更新深层子树、属性及归因。
 *
 * @param {t.TestCase} _tc
 */
export const testElementAttributedContentViaDiffer = _tc => {
  const ydocV1 = new Y.Doc()
  ydocV1.get('p').insert(0, [delta.create().insert('hello'), delta.create('span')])
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(ydocV1))
  const yelement = ydoc.get('p')
  const elem2 = yelement.get(1) // new Y.XmlElement('span')
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
 * 以最小 XML/文本树演示 DiffRenderer 对格式、文本和节点插入的深层输出。
 *
 * @param {t.TestCase} _tc
 */
export const testRendererSimpleExample = _tc => {
  const ydoc = new Y.Doc()
  ydoc.clientID = 0
  // Given：基线文档含一个 `hello world` 文本子节点。
  ydoc.get().insert(0, [delta.create().insert('hello world')])
  const ydocFork = new Y.Doc()
  ydocFork.clientID = 1
  Y.applyUpdate(ydocFork, Y.encodeStateAsUpdate(ydoc))
  // When：分叉文档追加 span、格式化 hello、插入后立即删除一段文本并追加感叹号。
  ydocFork.get().insert(1, [new Y.Type('span')])
  const ytext = ydocFork.get().get(0)
  // 给 `hello` 添加 italic。
  ytext.format(0, 5, { italic: true })
  ytext.insert(11, 'deleteme')
  ytext.delete(11, 8)
  ytext.insert(11, '!')
  // Then：DiffRenderer 深层输出只高亮真实格式、文本和节点插入。
  console.log(JSON.stringify(ydocFork.get().toDeltaDeep({ renderer: Y.createDiffRenderer(ydoc, ydocFork) }), null, 2))
/* =>
{
  "children": {
    "ops": [
      {
        "insert": [
          {
            "ops": [
              {
                "insert": "hello",
                "attributes": {
                  "italic": true
                },
                "attribution": {
                  "attributes": {
                    "italic": []     -- `italic` 属性发生变化
                  }
                }
              },
              {
                "insert": " world"   -- `world` 保持不变
              },
              {
                "insert": "!",
                "attribution": {
                  "insert": []       -- `!` 为新增内容
                }
              }
            ]
          }
        ]
      },
      {
        "insert": [
          {
            "nodeName": "span",
            "children": {
              "ops": []
            },
            "attributes": {}
          }
        ],
        "attribution": {
          "insert": []               -- 新增一个 <span/> 节点
        }
      }
    ]
  }
}
*/
}

/**
 * 递归遍历 Delta 属性和子操作，收集构造器名属于禁用集合的 op，并记录可定位的树路径。
 *
 * @param {any} d
 * @param {Array<string>} forbidden - 不允许出现的构造器名。
 * @param {string} [path]
 * @param {Array<{path:string, opType:string, op:any}>} [acc]
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
 * 回归 y-prosemirror#247：软删除父节点的深层视图只能输出带归因正向 op。
 *
 * Given：基线片段含具名子元素、属性和文本，分叉文档软删除整个子元素。
 * When：用 DiffRenderer 调用 `parent.toDeltaDeep({ renderer })`。
 * Then：所有层级都不得出现 `DeleteAttrOp`/`DeleteOp`，而应以携带 attribution 的
 * `SetAttrOp`/`InsertOp` 表达仍可见 tombstone。
 *
 * 验证机制：`collectForbiddenOps` 同时遍历 attrs、children、嵌套 insert 与 modify value，覆盖
 * lib0/delta `diff` 和 y-prosemirror 映射器不能接受的原始删除 op。
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

  // 递归检查级联结果只能含带 attribution 的正向 op。
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
 * 验证显式删除属性在 diff 视图中输出旧值 `SetAttrOp` 与 delete attribution。
 *
 * 与上方级联用例互补：无论属性因父节点删除而级联 tombstone，还是直接 `deleteAttr`，DiffRenderer
 * 都必须把旧值渲染为带 `{ delete: [] }` 的正向 `SetAttrOp`，不能输出 `DeleteAttrOp`。
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
