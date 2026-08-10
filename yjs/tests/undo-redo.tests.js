import * as Y from '../src/index.js'
import { init } from './testHelper.js' // eslint-disable-line
import * as t from 'lib0/testing'
import * as delta from 'lib0/delta'

/** 验证本地构建与 update 重建文档在跨分段清除/设置格式后得到相同规范 Delta。 */
export const testInconsistentFormat = () => {
  /**
   * 对目标文档执行跨格式边界变更，并断言合并后的格式结果。
   *
   * @param {Y.Doc} ydoc - 本地或 update 重建文档。
   */
  const testYjsMerge = ydoc => {
    const content = ydoc.get('text')
    content.format(0, 6, { bold: null })
    content.format(6, 4, { type: 'text' })
    t.compare(content.toDelta(), delta.create().insert('Merge Test', { type: 'text' }).insert(' After', { type: 'text', italic: true }).done())
  }
  /** 创建包含相邻 bold/type/italic 分段的固定初始文档。 */
  const initializeYDoc = () => {
    const yDoc = new Y.Doc({ gc: false })
    const content = yDoc.get('text')
    content.insert(0, ' After', { type: 'text', italic: true })
    content.insert(0, 'Test', { type: 'text' })
    content.insert(0, 'Merge ', { type: 'text', bold: true })
    return yDoc
  }
  {
    const yDoc = initializeYDoc()
    testYjsMerge(yDoc)
  }
  {
    const initialYDoc = initializeYDoc()
    const yDoc = new Y.Doc({ gc: false })
    Y.applyUpdate(yDoc, Y.encodeStateAsUpdate(initialYDoc))
    testYjsMerge(yDoc)
  }
}

/**
 * 验证即使 captureTimeout 极大，`stopCapturing()` 仍强制下一次编辑建立独立栈项。
 *
 * @param {t.TestCase} tc
 */
export const testInfiniteCaptureTimeout = tc => {
  const { array0 } = init(tc, { users: 3 })
  const undoManager = new Y.UndoManager(array0, { captureTimeout: Number.MAX_VALUE })
  array0.push([1, 2, 3])
  undoManager.stopCapturing()
  array0.push([4, 5, 6])
  undoManager.undo()
  t.compare(array0.toArray(), [1, 2, 3])
}

/**
 * 覆盖文本插入/删除/格式、redone 链及并发远端变更下的 undo/redo 语义。
 *
 * Given：本地与远端交错编辑同一文本，部分本地结构随后被远端删除。
 * When：多次撤销、重做并同步。
 * Then：只反转本地作用域内仍可应用的结构，远端内容保留，格式可往返。
 *
 * 验证机制：字符串与 Delta 断言同时覆盖 `popStackItem()` 的 delete、redo 与冲突跳过分支。
 *
 * @param {t.TestCase} tc
 */
export const testUndoText = tc => {
  const { testConnector, text0, text1 } = init(tc, { users: 3 })
  const undoManager = new Y.UndoManager(text0)

  // 同一捕获区间内新增又删除的 Item 没有前态，撤销不应重做。
  text0.insert(0, 'test')
  text0.delete(0, 4)
  undoManager.undo()
  t.assert(text0.toString() === '')

  // 后续撤销必须追随先前恢复产生的 redone 链。
  text0.insert(0, 'a')
  undoManager.stopCapturing()
  text0.delete(0, 1)
  undoManager.stopCapturing()
  undoManager.undo()
  t.assert(text0.toString() === 'a')
  undoManager.undo()
  t.assert(text0.toString() === '')

  text0.insert(0, 'abc')
  text1.insert(0, 'xyz')
  testConnector.syncAll()
  undoManager.undo()
  t.assert(text0.toString() === 'xyz')
  undoManager.redo()
  t.assert(text0.toString() === 'abcxyz')
  testConnector.syncAll()
  text1.delete(0, 1)
  testConnector.syncAll()
  undoManager.undo()
  t.assert(text0.toString() === 'xyz')
  undoManager.redo()
  t.assert(text0.toString() === 'bcxyz')
  // 格式 Item 也应作为独立撤销内容往返。
  text0.format(1, 3, { bold: true })
  t.compare(text0.toDelta(), delta.create().insert('b').insert('cxy', { bold: true }).insert('z').done())
  undoManager.undo()
  t.compare(text0.toDelta(), delta.create().insert('bcxyz').done())
  undoManager.redo()
  t.compare(text0.toDelta(), delta.create().insert('b').insert('cxy', { bold: true }).insert('z').done())
}

/**
 * 回归验证 #241：可先用显式 doc 创建空 scope UndoManager，再动态加入类型并撤销。
 *
 * @param {t.TestCase} _tc
 */
export const testEmptyTypeScope = _tc => {
  const ydoc = new Y.Doc()
  const um = new Y.UndoManager([], { doc: ydoc })
  const yarray = ydoc.get()
  um.addToScope(yarray)
  yarray.insert(0, [1])
  um.undo()
  t.assert(yarray.length === 0)
}

/**
 * 验证用临时 UndoManager 拒绝 update 中受限类型，同时保留公开类型和既有 pending update 状态。
 *
 * @param {t.TestCase} _tc
 */
export const testRejectUpdateExample = _tc => {
  const tmpydoc1 = new Y.Doc()
  tmpydoc1.get('restricted').insert(0, [1])
  tmpydoc1.get('public').insert(0, [1])
  const update1 = Y.encodeStateAsUpdate(tmpydoc1)
  const tmpydoc2 = new Y.Doc()
  tmpydoc2.get('public').insert(0, [2])
  const update2 = Y.encodeStateAsUpdate(tmpydoc2)

  const ydoc = new Y.Doc()
  const restrictedType = ydoc.get('restricted')

  /**
   * 模拟 WebSocket 等通道的入站 update 处理器，拒绝 `restricted` 类型及后代变化。
   *
   * 顺序不变量：先缓存 pending 状态并创建只跟踪远端 origin 的 UndoManager；再应用 update；finally 中撤销所有受限变化、销毁管理器、恢复并重放原 pending update。这样异常也不能绕过回滚。
   *
   * @param {Uint8Array} update - 待审查入站 update。
   */
  const updateHandler = (update) => {
    // 只跟踪 `remote change`，回滚事务以 UndoManager 自身为 origin，不会再次入栈。
    const um = new Y.UndoManager(restrictedType, { trackedOrigins: new Set(['remote change']) })
    const beforePendingDs = ydoc.store.pendingDs
    const beforePendingStructs = ydoc.store.pendingStructs?.update
    try {
      Y.applyUpdate(ydoc, update, 'remote change')
    } finally {
      while (um.undoStack.length) {
        um.undo()
      }
      um.destroy()
      ydoc.store.pendingDs = beforePendingDs
      ydoc.store.pendingStructs = null
      if (beforePendingStructs) {
        Y.applyUpdateV2(ydoc, beforePendingStructs)
      }
    }
  }
  updateHandler(update1)
  updateHandler(update2)
  t.assert(restrictedType.length === 0)
  t.assert(ydoc.get('public').length === 2)
}

/**
 * 回归验证 #241：以 Doc 为全局 scope 时可撤销其任意根类型变更。
 *
 * @param {t.TestCase} _tc
 */
export const testGlobalScope = _tc => {
  const ydoc = new Y.Doc()
  const um = new Y.UndoManager(ydoc)
  const yarray = ydoc.get()
  yarray.insert(0, [1])
  um.undo()
  t.assert(yarray.length === 0)
}

/**
 * 回归验证 #241：连续调用 undo 不会把两个栈项合并或破坏后续插入位置。
 *
 * @param {t.TestCase} _tc
 */
export const testDoubleUndo = _tc => {
  const doc = new Y.Doc()
  const text = doc.get()
  text.insert(0, '1221')

  const manager = new Y.UndoManager(text)

  text.insert(2, '3')
  text.insert(3, '3')

  manager.undo()
  manager.undo()

  text.insert(2, '3')

  t.compareStrings(text.toString(), '12321')
}

/**
 * 验证 Map 属性值、嵌套类型、连续赋值与远端覆盖下的撤销/重做。
 *
 * @param {t.TestCase} tc
 */
export const testUndoMap = tc => {
  const { testConnector, map0, map1 } = init(tc, { users: 2 })
  map0.setAttr('a', 0)
  const undoManager = new Y.UndoManager(map0)
  map0.setAttr('a', 1)
  undoManager.undo()
  t.assert(map0.getAttr('a') === 0)
  undoManager.redo()
  t.assert(map0.getAttr('a') === 1)
  // 嵌套类型应作为整体恢复，连同内部属性内容。
  const subType = new Y.Type()
  map0.setAttr('a', subType)
  subType.setAttr('x', 42)
  t.compare(map0.toJSON().attrs, /** @type {any} */ ({ a: { attrs: { x: 42 } } }))
  undoManager.undo()
  t.assert(map0.getAttr('a') === 1)
  undoManager.redo()
  t.compare(map0.toJSON().attrs, /** @type {any} */ ({ a: { attrs: { x: 42 } } }))
  testConnector.syncAll()
  // 远端已覆盖属性时，默认冲突策略应跳过本地 undo/redo。
  map1.setAttr('a', 44)
  testConnector.syncAll()
  undoManager.undo()
  t.assert(map0.getAttr('a') === 44)
  undoManager.redo()
  t.assert(map0.getAttr('a') === 44)

  // capture 窗口内多次设置同一键应合并为一步，恢复窗口前值。
  map0.setAttr('b', 'initial')
  undoManager.stopCapturing()
  map0.setAttr('b', 'val1')
  map0.setAttr('b', 'val2')
  undoManager.stopCapturing()
  undoManager.undo()
  t.assert(map0.getAttr('b') === 'initial')
}

/**
 * 回归验证：同一步撤销嵌套类型删除及其属性变化时，恢复属性必须在远端同步后仍一致。
 *
 * 历史缺陷中，重做属性 Item 沿用了已删除父项的 origin，导致本地值正确但同步后丢失。
 *
 * @param {t.TestCase} tc
 */
export const testUndoEmbeddedTypeAttribute = tc => {
  const { testConnector, text0, text1 } = init(tc, { users: 2 })
  const button = new Y.Type()
  button.setAttr('type', 'button')
  button.setAttr('test', true)
  button.insert(0, 'Click me')
  text0.insert(0, [button])
  testConnector.syncAll()

  const undoManager = new Y.UndoManager(text0)
  undoManager.stopCapturing()
  // 同一捕获区间先改属性，再删除嵌套类型。
  button.setAttr('type', 'paragraph')
  text0.delete(0, 1)
  // 一次 undo 同时恢复父类型与旧属性。
  undoManager.undo()

  const expected = { type: 'button', test: true }
  t.compare(text0.get(0).getAttrs(), expected)
  testConnector.syncAll()
  // 远端必须收敛到相同属性，证明新 Item 的集成来源合法。
  t.compare(text1.get(0).getAttrs(), expected)
}

/**
 * 验证数组并发插入、远端删除、嵌套属性与多步 undo/redo 只反转本地作用域内容。
 *
 * @param {t.TestCase} tc
 */
export const testUndoArray = tc => {
  const { testConnector, array0, array1 } = init(tc, { users: 3 })
  const undoManager = new Y.UndoManager(array0)
  array0.insert(0, [1, 2, 3])
  array1.insert(0, [4, 5, 6])
  testConnector.syncAll()
  t.compare(array0.toArray(), [1, 2, 3, 4, 5, 6])
  undoManager.undo()
  t.compare(array0.toArray(), [4, 5, 6])
  undoManager.redo()
  t.compare(array0.toArray(), [1, 2, 3, 4, 5, 6])
  testConnector.syncAll()
  array1.delete(0, 1) // 远端删除本地首项。
  testConnector.syncAll()
  undoManager.undo()
  t.compare(array0.toArray(), [4, 5, 6])
  undoManager.redo()
  t.compare(array0.toArray(), [2, 3, 4, 5, 6])
  array0.delete(0, 5)
  // 嵌套类型与其内部属性分成独立捕获步骤。
  const ymap = new Y.Type()
  array0.insert(0, [ymap])
  t.compare(array0.toJSON().children, [{}])
  undoManager.stopCapturing()
  ymap.setAttr('a', 1)
  t.compare(array0.toJSON().children, [{ attrs: { a: 1 } }])
  undoManager.undo()
  t.compare(array0.toJSON().children, [{}])
  undoManager.undo()
  t.compare(array0.toJSON().children, [2, 3, 4, 5, 6])
  undoManager.redo()
  t.compare(array0.toJSON().children, [{}])
  undoManager.redo()
  t.compare(array0.toJSON().children, [{ attrs: { a: 1 } }])
  testConnector.syncAll()
  array1.get(0).setAttr('b', 2)
  testConnector.syncAll()
  t.compare(array0.toJSON().children, [{ attrs: { a: 1, b: 2 } }])
  undoManager.undo()
  t.compare(array0.toJSON().children, [{ attrs: { b: 2 } }])
  undoManager.undo()
  t.compare(array0.toJSON().children, [2, 3, 4, 5, 6])
  undoManager.redo()
  t.compare(array0.toJSON().children, [{ attrs: { b: 2 } }])
  undoManager.redo()
  t.compare(array0.toJSON().children, [{ attrs: { a: 1, b: 2 } }])
}

/**
 * 验证嵌套 XML/文本格式、节点删除均能通过深层 Delta 完整撤销与重做。
 *
 * @param {t.TestCase} tc
 */
export const testUndoXml = tc => {
  const { xml0 } = init(tc, { users: 3 })
  const undoManager = new Y.UndoManager(xml0)
  const child = new Y.Type('p')
  xml0.insert(0, [child])
  const textchild = Y.Type.from(delta.create().insert('content'))
  child.insert(0, [textchild])
  // 格式变更应独立往返，不破坏嵌套节点结构。
  undoManager.stopCapturing()
  textchild.format(3, 4, { bold: true })
  const v1 = delta.create().insert([delta.create('p').insert([delta.create().insert('con').insert('tent', { bold: true }).done()]).done()]).done()
  const v2 = delta.create().insert([delta.create('p').insert([delta.create().insert('content').done()]).done()]).done()
  t.compare(xml0.toDeltaDeep(), v1)
  undoManager.undo()
  t.compare(xml0.toDeltaDeep(), v2)
  undoManager.redo()
  t.compare(xml0.toDeltaDeep(), v1)
  xml0.delete(0, 1)
  t.compare(xml0.toDeltaDeep(), delta.create().done())
  undoManager.undo()
  t.compare(xml0.toDeltaDeep(), v1)
}

/**
 * 验证 stack-item-added/popped 事件携带类型、changedParentTypes，并通过 meta 往返用户数据。
 *
 * @param {t.TestCase} tc
 */
export const testUndoEvents = tc => {
  const { text0 } = init(tc, { users: 3 })
  const undoManager = new Y.UndoManager(text0)
  let counter = 0
  let receivedMetadata = -1
  undoManager.on('stack-item-added', /** @param {any} event */ event => {
    t.assert(event.type != null)
    t.assert(event.changedParentTypes != null && event.changedParentTypes.has(text0))
    event.stackItem.meta.set('test', counter++)
  })
  undoManager.on('stack-item-popped', /** @param {any} event */ event => {
    t.assert(event.type != null)
    t.assert(event.changedParentTypes != null && event.changedParentTypes.has(text0))
    receivedMetadata = event.stackItem.meta.get('test')
  })
  text0.insert(0, 'abc')
  undoManager.undo()
  t.assert(receivedMetadata === 0)
  undoManager.redo()
  t.assert(receivedMetadata === 1)
}

/**
 * 验证 trackedOrigins 可登记构造器，并匹配 Number 实例 origin。
 *
 * @param {t.TestCase} tc
 */
export const testTrackClass = tc => {
  const { users, text0 } = init(tc, { users: 3 })
  // trackedOrigins 命中 origin.constructor，因此数值 42 被 Number 规则捕获。
  const undoManager = new Y.UndoManager(text0, { trackedOrigins: new Set([Number]) })
  users[0].transact(() => {
    text0.insert(0, 'abc')
  }, 42)
  t.assert(text0.toString() === 'abc')
  undoManager.undo()
  t.assert(text0.toString() === '')
}

/**
 * 验证单类型与多类型 scope 只捕获各自类型及后代变更。
 *
 * @param {t.TestCase} tc
 */
export const testTypeScope = tc => {
  const { array0 } = init(tc, { users: 3 })
  // 两个 sibling 类型用于区分 scope 命中。
  const text0 = new Y.Type()
  const text1 = new Y.Type()
  array0.insert(0, [text0, text1])
  const undoManager = new Y.UndoManager(text0)
  const undoManagerBoth = new Y.UndoManager([text0, text1])
  text1.insert(0, 'abc')
  t.assert(undoManager.undoStack.length === 0)
  t.assert(undoManagerBoth.undoStack.length === 1)
  t.assert(text1.toString() === 'abc')
  undoManager.undo()
  t.assert(text1.toString() === 'abc')
  undoManagerBoth.undo()
  t.assert(text1.toString() === '')
}

/**
 * 验证嵌套文本内部编辑与承载嵌套类型的插入可按两个栈项依次撤销。
 *
 * @param {t.TestCase} tc
 */
export const testUndoInEmbed = tc => {
  const { text0 } = init(tc, { users: 3 })
  const undoManager = new Y.UndoManager(text0)
  const nestedText = Y.Type.from(delta.create().insert('initial text'))
  undoManager.stopCapturing()
  text0.insert(0, [nestedText], { bold: true })
  t.assert(nestedText.toString() === 'initial text')
  undoManager.stopCapturing()
  nestedText.delete(0, nestedText.length)
  nestedText.insert(0, 'other text')
  t.assert(nestedText.toString() === 'other text')
  undoManager.undo()
  t.assert(nestedText.toString() === 'initial text')
  undoManager.undo()
  t.assert(text0.length === 0)
}

/**
 * 验证 deleteFilter 可阻止删除带属性的嵌套 Item，同时允许删除空嵌套项。
 *
 * @param {t.TestCase} tc
 */
export const testUndoDeleteFilter = tc => {
  const array0 = init(tc, { users: 3 }).array0
  const undoManager = new Y.UndoManager(array0, { deleteFilter: item => !(item instanceof Y.Item) || (item.content instanceof Y.ContentType && item.content.type._map.size === 0) })
  const map0 = new Y.Type()
  map0.setAttr('hi', 1)
  const map1 = new Y.Type()
  array0.insert(0, [map0, map1])
  undoManager.undo()
  t.assert(array0.length === 1)
  array0.get(0)
  t.assert(Array.from(array0.get(0).attrKeys()).length === 1)
}

/**
 * 回归验证外部更新场景：顶端栈项因远端覆盖成为 no-op 时，undo 会继续弹栈直到实际产生变化。
 *
 * 来源：https://discuss.yjs.dev/t/undomanager-with-external-updates/454/6
 * @param {t.TestCase} _tc
 */
export const testUndoUntilChangePerformed = _tc => {
  const doc = new Y.Doc()
  const doc2 = new Y.Doc()
  doc.on('update', update => Y.applyUpdate(doc2, update))
  doc2.on('update', update => Y.applyUpdate(doc, update))

  const yArray = doc.get('array')
  const yArray2 = doc2.get('array')
  const yMap = new Y.Type()
  yMap.setAttr('hello', 'world')
  yArray.push([yMap])
  const yMap2 = new Y.Type()
  yMap2.setAttr('key', 'value')
  yArray.push([yMap2])

  const undoManager = new Y.UndoManager([yArray], { trackedOrigins: new Set([doc.clientID]) })
  const undoManager2 = new Y.UndoManager([doc2.get('array')], { trackedOrigins: new Set([doc2.clientID]) })

  Y.transact(doc, () => yMap2.setAttr('key', 'value modified'), doc.clientID)
  undoManager.stopCapturing()
  Y.transact(doc, () => yMap.setAttr('hello', 'world modified'), doc.clientID)
  Y.transact(doc2, () => yArray2.delete(0), doc2.clientID)
  undoManager2.undo()
  undoManager.undo()
  t.compareStrings(yMap2.getAttr('key'), 'value')
}

/**
 * 回归验证 issue #317：多层 Map-like 嵌套属性替换可逐级 undo/redo，且每一步恢复正确历史子树。
 *
 * @param {t.TestCase} _tc
 */
export const testUndoNestedUndoIssue = _tc => {
  const doc = new Y.Doc({ gc: false })
  const design = doc.get()
  const undoManager = new Y.UndoManager(design, { captureTimeout: 0 })

  const text = new Y.Type()

  const blocks1 = new Y.Type()
  const blocks1block = new Y.Type()

  doc.transact(() => {
    blocks1block.setAttr('text', 'Type Something')
    blocks1.push([blocks1block])
    text.setAttr('blocks', blocks1block)
    design.setAttr('text', text)
  })

  const blocks2 = new Y.Type()
  const blocks2block = new Y.Type()
  doc.transact(() => {
    blocks2block.setAttr('text', 'Something')
    blocks2.push([blocks2block])
    text.setAttr('blocks', blocks2block)
  })

  const blocks3 = new Y.Type()
  const blocks3block = new Y.Type()
  doc.transact(() => {
    blocks3block.setAttr('text', 'Something Else')
    blocks3.push([blocks3block])
    text.setAttr('blocks', blocks3block)
  })
  t.compare(design.toDeltaDeep(), delta.from({ text: delta.from({ blocks: delta.from({ text: 'Something Else' }) }) }))
  undoManager.undo()
  t.compare(design.toDeltaDeep(), delta.from({ text: delta.from({ blocks: delta.from({ text: 'Something' }) }) }))
  undoManager.undo()
  t.compare(design.toDeltaDeep(), delta.from({ text: delta.from({ blocks: delta.from({ text: 'Type Something' }) }) }))
  undoManager.undo()
  t.compare(design.toDeltaDeep(), delta.from({}))
  undoManager.redo()
  t.compare(design.toDeltaDeep(), delta.from({ text: delta.from({ blocks: delta.from({ text: 'Type Something' }) }) }))
  undoManager.redo()
  t.compare(design.toDeltaDeep(), delta.from({ text: delta.from({ blocks: delta.from({ text: 'Something' }) }) }))
  undoManager.redo()
  t.compare(design.toDeltaDeep(), delta.from({ text: delta.from({ blocks: delta.from({ text: 'Something Else' }) }) }))
}

/**
 * 回归验证 issue #355：连续重做嵌套点对象的多轮属性修改，最后一步不得把对象变成空值。
 *
 * @param {t.TestCase} _tc
 */
export const testConsecutiveRedoBug = _tc => {
  const doc = new Y.Doc()
  const yRoot = doc.get()
  const undoMgr = new Y.UndoManager(yRoot)

  let yPoint = new Y.Type()
  yPoint.setAttr('x', 0)
  yPoint.setAttr('y', 0)
  yRoot.setAttr('a', yPoint)
  undoMgr.stopCapturing()

  yPoint.setAttr('x', 100)
  yPoint.setAttr('y', 100)
  undoMgr.stopCapturing()

  yPoint.setAttr('x', 200)
  yPoint.setAttr('y', 200)
  undoMgr.stopCapturing()

  yPoint.setAttr('x', 300)
  yPoint.setAttr('y', 300)
  undoMgr.stopCapturing()

  t.compare(yPoint.toJSON().attrs, { x: 300, y: 300 })

  undoMgr.undo() // x=200, y=200
  t.compare(yPoint.toJSON().attrs, { x: 200, y: 200 })
  undoMgr.undo() // x=100, y=100
  t.compare(yPoint.toJSON().attrs, { x: 100, y: 100 })
  undoMgr.undo() // x=0, y=0
  t.compare(yPoint.toJSON().attrs, { x: 0, y: 0 })
  undoMgr.undo() // 已撤销到空值。
  t.compare(yRoot.getAttr('a'), undefined)

  undoMgr.redo() // x=0, y=0
  yPoint = yRoot.getAttr('a')

  t.compare(yPoint.toJSON().attrs, { x: 0, y: 0 })
  undoMgr.redo() // x=100, y=100
  t.compare(yPoint.toJSON().attrs, { x: 100, y: 100 })
  undoMgr.redo() // x=200, y=200
  t.compare(yPoint.toJSON().attrs, { x: 200, y: 200 })
  undoMgr.redo() // 历史缺陷此步期望 300/300，实际曾变为 nil。
  t.compare(yPoint.toJSON().attrs, { x: 300, y: 300 })
}

/**
 * 回归验证 issue #304：XML 节点多轮属性修改在三次 undo/redo 后恢复最终两个属性值。
 *
 * @param {t.TestCase} _tc
 */
export const testUndoXmlBug = _tc => {
  const origin = 'origin'
  const doc = new Y.Doc()
  const fragment = doc.get('t')
  const undoManager = new Y.UndoManager(fragment, {
    captureTimeout: 0,
    trackedOrigins: new Set([origin])
  })

  // 第一步创建元素。
  doc.transact(() => {
    const e = new Y.Type('test-node')
    e.setAttr('a', '100')
    e.setAttr('b', '0')
    fragment.insert(fragment.length, [e])
  }, origin)

  // 第二步修改一个属性。
  doc.transact(() => {
    const e = fragment.get(0)
    e.setAttr('a', '200')
  }, origin)

  // 第三步同时修改两个属性。
  doc.transact(() => {
    const e = fragment.get(0)
    e.setAttr('a', '180')
    e.setAttr('b', '50')
  }, origin)

  undoManager.undo()
  undoManager.undo()
  undoManager.undo()

  undoManager.redo()
  undoManager.redo()
  undoManager.redo()
  t.compare(fragment.toString(), '<test-node a="180" b="50" />')
}

/**
 * 回归验证 issue #343：连续替换深层 block 引用后，四次 redo 必须恢复最后 block 内容。
 *
 * @param {t.TestCase} _tc
 */
export const testUndoBlockBug = _tc => {
  const doc = new Y.Doc({ gc: false })
  const design = doc.get()

  const undoManager = new Y.UndoManager(design, { captureTimeout: 0 })

  const text = new Y.Type()

  const blocks1 = new Y.Type()
  const blocks1block = new Y.Type()
  doc.transact(() => {
    blocks1block.setAttr('text', '1')
    blocks1.push([blocks1block])

    text.setAttr('blocks', blocks1block)
    design.setAttr('text', text)
  })

  const blocks2 = new Y.Type()
  const blocks2block = new Y.Type()
  doc.transact(() => {
    blocks2block.setAttr('text', '2')
    blocks2.push([blocks2block])
    text.setAttr('blocks', blocks2block)
  })

  const blocks3 = new Y.Type()
  const blocks3block = new Y.Type()
  doc.transact(() => {
    blocks3block.setAttr('text', '3')
    blocks3.push([blocks3block])
    text.setAttr('blocks', blocks3block)
  })

  const blocks4 = new Y.Type()
  const blocks4block = new Y.Type()
  doc.transact(() => {
    blocks4block.setAttr('text', '4')
    blocks4.push([blocks4block])
    text.setAttr('blocks', blocks4block)
  })

  // {"text":{"blocks":{"text":"4"}}}
  undoManager.undo() // {"text":{"blocks":{"3"}}}
  undoManager.undo() // {"text":{"blocks":{"text":"2"}}}
  undoManager.undo() // {"text":{"blocks":{"text":"1"}}}
  undoManager.undo() // {}
  undoManager.redo() // {"text":{"blocks":{"text":"1"}}}
  undoManager.redo() // {"text":{"blocks":{"text":"2"}}}
  undoManager.redo() // {"text":{"blocks":{"text":"3"}}}
  undoManager.redo() // {"text":{}}
  t.compare(design.toJSON().attrs, { text: { attrs: { blocks: { attrs: { text: '4' } } } } })
}

/**
 * 回归验证 issue #392：撤销文本格式删除后，本地与同步 peer 的 Delta 必须一致且格式区间正确。
 *
 * @see https://github.com/yjs/yjs/issues/392
 * @param {t.TestCase} _tc
 */
export const testUndoDeleteTextFormat = _tc => {
  const doc = new Y.Doc()
  const text = doc.get()
  text.insert(0, 'Attack ships on fire off the shoulder of Orion.')
  const doc2 = new Y.Doc()
  const text2 = doc2.get()
  Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc))
  const undoManager = new Y.UndoManager(text)

  text.format(13, 7, { bold: true })
  undoManager.stopCapturing()
  Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc))

  text.format(16, 4, { bold: null })
  undoManager.stopCapturing()
  Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc))

  undoManager.undo()
  Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc))

  const expect = delta.create()
    .insert('Attack ships ')
    .insert('on fire', { bold: true })
    .insert(' off the shoulder of Orion.')
  t.compare(text.toDelta(), expect)
  t.compare(text2.toDelta(), expect)
}

/**
 * 验证 `ignoreRemoteAttributeChanges=true` 允许本地 undo 越过较新的远端属性值，恢复本地捕获前值并同步收敛。
 *
 * @see https://github.com/yjs/yjs/issues/392
 * @param {t.TestCase} _tc
 */
export const testBehaviorOfIgnoreRemoteAttributeChangesProperty = _tc => {
  const doc = new Y.Doc()
  const doc2 = new Y.Doc()
  doc.on('update', update => Y.applyUpdate(doc2, update, doc))
  doc2.on('update', update => Y.applyUpdate(doc, update, doc2))
  const map1 = doc.get()
  const map2 = doc2.get()
  const um1 = new Y.UndoManager(map1, { ignoreRemoteAttributeChanges: true })
  map1.setAttr('x', 1)
  map2.setAttr('x', 2)
  map1.setAttr('x', 3)
  map2.setAttr('x', 4)
  um1.undo()
  t.assert(map1.getAttr('x') === 2)
  t.assert(map2.getAttr('x') === 2)
}

/**
 * 回归验证 issue #447：同一事务修改节点属性后删除节点，undo 应恢复删除前而非中间属性值。
 *
 * @see https://github.com/yjs/yjs/issues/447
 * @param {t.TestCase} _tc
 */
export const testSpecialDeletionCase = _tc => {
  const origin = 'undoable'
  const doc = new Y.Doc()
  const fragment = doc.get()
  const undoManager = new Y.UndoManager(fragment, { trackedOrigins: new Set([origin]) })
  doc.transact(() => {
    const e = new Y.Type('test')
    e.setAttr('a', '1')
    e.setAttr('b', '2')
    fragment.insert(0, [e])
  })
  t.compareStrings(fragment.toString(), '<test a="1" b="2" />')
  doc.transact(() => {
    // 同一捕获步骤修改属性 `b` 并删除节点。
    const e = fragment.get(0)
    e.setAttr('b', '3')
    fragment.delete(0)
  }, origin)
  t.compareStrings(fragment.toString(), '')
  undoManager.undo()
  t.compareStrings(fragment.toString(), '<test a="1" b="2" />')
}

/**
 * 回归验证 issue #500：Map 键交替 set/delete 后逐步 undo，应在空值与每个历史值之间正确切换。
 *
 * @see https://github.com/yjs/yjs/issues/500
 * @param {t.TestCase} tc
 */
export const testUndoDeleteInMap = (tc) => {
  const { map0 } = init(tc, { users: 3 })
  const undoManager = new Y.UndoManager(map0, { captureTimeout: 0 })
  map0.setAttr('a', 'a')
  map0.deleteAttr('a')
  map0.setAttr('a', 'b')
  map0.deleteAttr('a')
  map0.setAttr('a', 'c')
  map0.deleteAttr('a')
  map0.setAttr('a', 'd')
  t.compare(map0.toJSON().attrs, { a: 'd' })
  undoManager.undo()
  t.compare(map0.toJSON(), {})
  undoManager.undo()
  t.compare(map0.toJSON().attrs, { a: 'c' })
  undoManager.undo()
  t.compare(map0.toJSON(), {})
  undoManager.undo()
  t.compare(map0.toJSON().attrs, { a: 'b' })
  undoManager.undo()
  t.compare(map0.toJSON(), {})
  undoManager.undo()
  t.compare(map0.toJSON().attrs, { a: 'a' })
}

/**
 * 验证 `currStackItem` 只在 undo/redo 事务及 observer 期间暴露当前 meta，事务结束后恢复为 null。
 *
 * Given：栈项 added 事件写入 meta。
 * When：observer 在 undoing/redoing 标志下读取 `currStackItem`。
 * Then：两次均读到同一元数据，操作结束后字段清空。
 *
 * @param {t.TestCase} _tc
 */
export const testUndoDoingStackItem = async (_tc) => {
  const doc = new Y.Doc()
  const text = doc.get('text')
  const undoManager = new Y.UndoManager([text])
  undoManager.on('stack-item-added', /** @param {any} event */ event => {
    event.stackItem.meta.set('str', '42')
  })
  let metaUndo = /** @type {any} */ (null)
  let metaRedo = /** @type {any} */ (null)
  text.observe((event) => {
    const /** @type {Y.UndoManager} */ origin = event.transaction.origin
    if (origin === undoManager && origin.undoing) {
      metaUndo = origin.currStackItem?.meta.get('str')
    } else if (origin === undoManager && origin.redoing) {
      metaRedo = origin.currStackItem?.meta.get('str')
    }
  })
  text.insert(0, 'abc')
  undoManager.undo()
  undoManager.redo()
  t.compare(metaUndo, '42', 'currStackItem is accessible while undoing')
  t.compare(metaRedo, '42', 'currStackItem is accessible while redoing')
  t.compare(undoManager.currStackItem, null, 'currStackItem is null after observe/transaction')
}
