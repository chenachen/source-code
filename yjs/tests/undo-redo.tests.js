import * as Y from '../src/index.js'
import { init } from './testHelper.js' // eslint-disable-line
import * as t from 'lib0/testing'
import * as delta from 'lib0/delta'

/**
 * 测试场景：gc=false 文档拼成带 bold/type/italic 的 Merge Test After；另一路从完整 update 重建同样初态。
 * 触发操作：两路径均移除前六字符 bold，再把索引 6 起的四字符 Test 的 type 设为 text。
 * 预期结果：都得到 Merge Test 的 type=text 分段和 After 的 type=text/italic=true 分段；本例没有调用 undo。
 *
 */
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
 * 测试场景：三副本夹具的 array0 安装 captureTimeout=Number.MAX_VALUE 的管理器。
 * 触发操作：写 [1,2,3]，stopCapturing 后再写 [4,5,6]，执行一次 undo。
 * 预期结果：仅撤销第二批，剩 [1,2,3]；本例未进行副本同步比较。
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
 * 测试场景：三副本文本夹具，text0 安装默认 UndoManager。
 * 触发操作：先测同段插入又删除及 redone 链，再与 text1 并发写 abc/xyz，远端删除 a，最后格式化并 undo/redo。
 * 预期结果：同段增删撤销为空；远端 xyz 保留，远端已删 a 不恢复，最后 bold 区间 cxy 随格式步骤正确往返。
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
 * 测试场景：用显式 doc 创建空 scope 管理器。
 * 触发操作：动态 addToScope 根类型，插入 [1] 后 undo。
 * 预期结果：根长度回到 0；覆盖 issue #241 的延迟设置作用域。
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
 * 测试场景：两份 update 分别带 restricted/public 新增与另一 public 新增；目标已有 restricted 根。
 * 触发操作：临时管理器跟踪 remote change，在应用后撤销受限步骤、销毁管理器并恢复原 pending 状态。
 * 预期结果：restricted 长度 0、public 长度 2；初态没有构造真实 pending 缺口，因此 pending 恢复分支是示例代码，未由断言独立覆盖。
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
   * 模拟入站 update 处理器，以 restricted 类型为 scope 捕获指定远端 origin。
   *
   * 先缓存 pending 状态，再应用 update；finally 尝试撤销受限步骤、销毁管理器、恢复 pendingDs 并重放原 pendingStructs。这里的撤销会生成新的 CRDT 操作，不能从 store 中抹去已接收的历史。
   *
   * @param {Uint8Array} update - 待审查入站 update。
   */
  const updateHandler = (update) => {
    // 捕获 remote change；管理器自身也自动进入 trackedOrigins，因此 undo 的逆操作会写入 redo 栈。
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
 * 测试场景：空 Doc 作为 UndoManager scope。
 * 触发操作：在根类型插入 [1] 后 undo。
 * 预期结果：根长度为 0，Doc scope 可捕获该根变化。
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
 * 测试场景：文本先有 1221，再安装管理器。
 * 触发操作：连续插入两个 3，undo 两次，再在索引 2 插入 3。
 * 预期结果：最终 12321；首轮两插入合并为一步，第二次空栈 undo 不影响后续定位。
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
 * 测试场景：两副本 map0 属性 a=0，随后安装管理器。
 * 触发操作：修改标量并 undo/redo，再替换为含 x=42 的子类型；远端覆盖 a=44 后尝试 undo/redo，最后连续写 b 两次并 undo。
 * 预期结果：子类型与内属性整体恢复，远端 44 不被默认策略覆盖，合并写 b 恢复 initial。
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
 * 测试场景：两副本文本包含 button 子类型，带 type=button/test=true 和 Click me 内容，已同步。
 * 触发操作：同一捕获步骤把 type 改为 paragraph 并删除父嵌入项，再 undo 并同步。
 * 预期结果：本地与远端恢复节点属性均为 type=button/test=true；断言未比较 Click me 内容。
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
 * 测试场景：三副本夹具，array0 管理器与 array1 交错编辑。
 * 触发操作：并发插入两批数字、远端删除首个本地数字，再分步插入子类型及本地属性 a，远端添加 b，反复 undo/redo。
 * 预期结果：远端数字和 b 保留；本地已被远端删除的 1 不恢复；嵌入项、a 属性分别往返，最终含 a=1/b=2。
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
 * 测试场景：XML 根插入 p 子类型，内部文本为 content。
 * 触发操作：独立步骤给 tent 加 bold 并 undo/redo，再删除 p 并 undo。
 * 预期结果：每个格式阶段精确比较深层 Delta；删除变空，再恢复带 bold 的整棵子树。
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
 * 测试场景：text0 管理器监听 added/popped，added 逐项写入递增 meta。
 * 触发操作：插入 abc，undo，再 redo。
 * 预期结果：事件 type 非空且 changedParentTypes 含 text0；popped 恢复的 meta 依次为 0、1。
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
 * 测试场景：普通编辑捕获规则配置为 Number 构造器；管理器自身也自动加入 trackedOrigins。
 * 触发操作：以数值 origin=42 的事务写 abc，再 undo。
 * 预期结果：先为 abc 后为空，origin.constructor 可命中 Number 规则。
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
 * 测试场景：数组包含两个 sibling 文本；分别安装只覆盖 text0 和覆盖两者的管理器。
 * 触发操作：仅给 text1 写 abc，先调用单类型管理器 undo，再调用双类型管理器 undo。
 * 预期结果：单类型栈为空且 text1 保留 abc；双类型有一项并能把 text1 撤销为空。
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
 * 测试场景：根文本管理器与未集成的 initial text 子类型。
 * 触发操作：独立插入带 bold 的子类型，再独立把其文本替换为 other text，undo 两次。
 * 预期结果：第一次恢复内部 initial text；第二次删除承载子类型，根长度 0。
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
 * 测试场景：数组同时插入带 hi 属性的子类型与空子类型，管理器仅允许删除空 ContentType 项。
 * 触发操作：执行 undo。
 * 预期结果：保留一项且该项有一个属性键；过滤器阻止撤销删除带属性的嵌入项。
 *
 * @param {t.TestCase} tc
 */
export const testUndoDeleteFilter = tc => {
  const array0 = init(tc, { users: 3 }).array0
  const undoManager = new Y.UndoManager(array0, {
    /**
     * 撤销删除前按 Item 载荷筛选；带属性的嵌入类型必须保留，空类型允许删除。
     *
     * @param {Y.Item} item - popStackItem 准备删除的作用域内 Item。
     * @return {boolean} 非 Item 或属性表为空的 ContentType 为 true；其他载荷为 false。
     */
    deleteFilter: item => !(item instanceof Y.Item) || (item.content instanceof Y.ContentType && item.content.type._map.size === 0)
  })
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
 * 测试场景：两文档即时双向同步，数组含两个属性子类型，两管理器对普通编辑仅跟踪各自 clientID origin，另自动跟踪自身。
 * 触发操作：本地依次改两个子类型属性，远端删除第一个后再 undo，随后本地 undo。
 * 预期结果：第二个子类型 key 回到 value，证明失效栈项可继续弹出直到出现实际变化。
 *
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
 * 测试场景：gc=false 根管理器 captureTimeout=0。
 * 触发操作：三事务创建并连续替换 text.blocks 引用，三次 undo 后三次 redo。
 * 预期结果：每步深层 Delta 从 Something Else 回退至 Something、Type Something、空，再按原顺序恢复（issue #317）。
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
 * 测试场景：根属性 a 为坐标子类型，x/y=0，按 stopCapturing 切分步骤。
 * 触发操作：依次改为 100、200、300，四次 undo，再四次 redo；首次 redo 后从根重新取得新子类型实例。
 * 预期结果：逐步恢复坐标与空值，最后为 300/300，没有丢失属性（issue #355）。
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
 * 测试场景：XML 根管理器 captureTimeout=0，普通编辑仅跟踪 origin；管理器自身另自动加入。
 * 触发操作：三事务依次创建 a=100/b=0 节点、改 a=200、改 a=180/b=50，再三次 undo/redo。
 * 预期结果：最终序列化为 <test-node a="180" b="50" />；未逐步断言中间状态（issue #304）。
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
 * 测试场景：gc=false 文档根管理器 captureTimeout=0。
 * 触发操作：四事务连续替换嵌套 block text 为 1、2、3、4，四次 undo 后四次 redo。
 * 预期结果：最终嵌套 JSON 恢复 text=4；中间状态只写在注释中，没有各步断言（issue #343）。
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
  undoManager.undo() // 恢复 blocks.text=3。
  undoManager.undo() // {"text":{"blocks":{"text":"2"}}}
  undoManager.undo() // {"text":{"blocks":{"text":"1"}}}
  undoManager.undo() // {}
  undoManager.redo() // {"text":{"blocks":{"text":"1"}}}
  undoManager.redo() // {"text":{"blocks":{"text":"2"}}}
  undoManager.redo() // {"text":{"blocks":{"text":"3"}}}
  undoManager.redo() // 恢复 blocks.text=4。
  t.compare(design.toJSON().attrs, { text: { attrs: { blocks: { attrs: { text: '4' } } } } })
}

/**
 * 测试场景：两文档共享 Attack ships… 文本，本地安装管理器。
 * 触发操作：给 on fire 加 bold 并同步；移除其中 fire 的 bold 并同步，再 undo 并同步。
 * 预期结果：本地与远端 Delta 都完整恢复 on fire 的 bold 区间（issue #392）。
 *
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
 * 测试场景：两文档即时双向同步，本地管理器 ignoreRemoteAttributeChanges=true。
 * 触发操作：交错写 x=本地1、远端2、本地3、远端4，再 undo 合并的本地步骤。
 * 预期结果：两份文档均为 2；捕获删除集保留被本地 3 替换的远端 2，并允许越过最新远端 4。
 *
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
 * 测试场景：普通编辑仅跟踪 undoable origin，管理器自身另自动加入；初始 test 节点 a=1/b=2 由未跟踪事务创建。
 * 触发操作：一个受跟踪事务把 b 改 3 后删掉节点，再 undo。
 * 预期结果：先为空，撤销后恢复 a=1/b=2，跳过同一步骤的中间 b=3（issue #447）。
 *
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
 * 测试场景：map0 管理器 captureTimeout=0，每次属性写删独立捕获。
 * 触发操作：a 键交替写 a/b/c/d 与删除，再逐步 undo 六次。
 * 预期结果：值按空、c、空、b、空、a 回退，正确重做每次属性删除（issue #500）。
 *
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
 * 测试场景：管理器 added 事件在栈项 meta 写字符串 42，文本 observer 分别记录 undoing/redoing 的 currStackItem。
 * 触发操作：插入 abc，undo，再 redo。
 * 预期结果：两个 observer 都读到 42，事务返回后 currStackItem=null；函数声明 async，但主体没有 await。
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
