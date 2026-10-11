import * as Y from '../src/index.js'
import * as t from 'lib0/testing'
import { init } from './testHelper.js'
import * as delta from 'lib0/delta'

/**
 * 测试场景：gc=false 文档写 world! 后取快照。
 * 触发操作：前插 hello ，再用当前 store 恢复旧快照。
 * 预期结果：恢复 Delta 仍只含 world!，排除快照之后的新增 ID。
 *
 * @param {t.TestCase} _tc
 */
export const testBasic = _tc => {
  const ydoc = new Y.Doc({ gc: false })
  ydoc.get().insert(0, 'world!')
  const snapshot = Y.snapshot(ydoc)
  ydoc.get().insert(0, 'hello ')
  const restored = Y.createDocFromSnapshot(ydoc, snapshot)
  t.assert(restored.get().toDelta().equals(delta.create().insert('world!').done()))
}

/**
 * 测试场景：gc=false 文档有 div 子类型；在设置属性前与 a=1 后分别取快照。
 * 触发操作：把当前属性改为 a=2，再按当前状态及两个快照读取。
 * 预期结果：依次为 {a: "2"}、{a: "1"} 和空属性对象，历史赋值由快照边界区分。
 *
 * @param {t.TestCase} _tc
 */
export const testBasicXmlAttributes = _tc => {
  const ydoc = new Y.Doc({ gc: false })
  const yxml = ydoc.get().setAttr('el', new Y.Type('div'))
  const snapshot1 = Y.snapshot(ydoc)
  yxml.setAttr('a', '1')
  const snapshot2 = Y.snapshot(ydoc)
  yxml.setAttr('a', '2')
  t.compare(yxml.getAttrs(), { a: '2' })
  t.compare(yxml.getAttrs(snapshot2), { a: '1' })
  t.compare(yxml.getAttrs(snapshot1), {})
}

/**
 * 测试场景：gc=false 数组写 hello 后取快照。
 * 触发操作：追加 world，再恢复旧快照。
 * 预期结果：目标只有 hello，源仍为 hello/world；允许编码期间结构切分，不能改变源的可见内容。
 *
 * @param {t.TestCase} _tc
 */
export const testBasicRestoreSnapshot = _tc => {
  const doc = new Y.Doc({ gc: false })
  doc.get('array').insert(0, ['hello'])
  const snap = Y.snapshot(doc)
  doc.get('array').insert(1, ['world'])

  const docRestored = Y.createDocFromSnapshot(doc, snap)

  t.compare(docRestored.get('array').toArray(), ['hello'])
  t.compare(doc.get('array').toJSON().children, ['hello', 'world'])
}

/**
 * 测试场景：空文档快照额外带 client=9999、clock=0。
 * 触发操作：写 world，恢复空快照，再对最新快照进行恢复。
 * 预期结果：旧快照目标为空且源保留 world；最新快照目标包含 world。
 *
 * @param {t.TestCase} _tc
 */
export const testEmptyRestoreSnapshot = _tc => {
  const doc = new Y.Doc({ gc: false })
  const snap = Y.snapshot(doc)
  snap.sv.set(9999, 0)
  doc.get().insert(0, ['world'])

  const docRestored = Y.createDocFromSnapshot(doc, snap)

  t.compare(docRestored.get().toArray(), [])
  t.compare(doc.get().toArray(), ['world'])

  // 最新快照覆盖当前 state，仍应正常恢复完整内容。
  const snap2 = Y.snapshot(doc)
  const docRestored2 = Y.createDocFromSnapshot(doc, snap2)
  t.compare(docRestored2.get().toArray(), ['world'])
}

/**
 * 测试场景：gc=false 数组包含子类型，其属性 key1=value1 已写入并取快照。
 * 触发操作：新增 key2=value2 后恢复旧快照。
 * 预期结果：目标子类型仅有 key1，源仍有两属性，嵌套内容同样受 sv 约束。
 *
 * @param {t.TestCase} _tc
 */
export const testRestoreSnapshotWithSubType = _tc => {
  const doc = new Y.Doc({ gc: false })
  doc.get('array').insert(0, [new Y.Type()])
  const subMap = doc.get('array').get(0)
  subMap.setAttr('key1', 'value1')

  const snap = Y.snapshot(doc)
  subMap.setAttr('key2', 'value2')

  const docRestored = Y.createDocFromSnapshot(doc, snap)

  t.compare(docRestored.get('array').toJSON().children, [{
    attrs: {
      key1: 'value1'
    }
  }])
  t.compare(doc.get('array').toJSON().children, [{
    attrs: {
      key1: 'value1',
      key2: 'value2'
    }
  }])
}

/**
 * 测试场景：gc=false 数组含 item1/item2，删除前取快照。
 * 触发操作：删除首项后恢复该快照。
 * 预期结果：目标恢复两项，源只剩 item2；删除后载荷仍由旧 store 提供。
 *
 * @param {t.TestCase} _tc
 */
export const testRestoreDeletedItem1 = _tc => {
  const doc = new Y.Doc({ gc: false })
  doc.get('array').insert(0, ['item1', 'item2'])

  const snap = Y.snapshot(doc)
  doc.get('array').delete(0)

  const docRestored = Y.createDocFromSnapshot(doc, snap)

  t.compare(docRestored.get('array').toArray(), ['item1', 'item2'])
  t.compare(doc.get('array').toArray(), ['item2'])
}

/**
 * 测试场景：数组写 item1，中间另一根属性占用 clock，再头插 item0 后取快照。
 * 触发操作：删除索引 1 的 item1，再恢复。
 * 预期结果：目标为 item0/item1，源为 item0；跨根的 clock 间隔不改变数组左右关系。
 *
 * @param {t.TestCase} _tc
 */
export const testRestoreLeftItem = _tc => {
  const doc = new Y.Doc({ gc: false })
  doc.get('array').insert(0, ['item1'])
  doc.get('map').setAttr('test', 1)
  doc.get('array').insert(0, ['item0'])

  const snap = Y.snapshot(doc)
  doc.get('array').delete(1)

  const docRestored = Y.createDocFromSnapshot(doc, snap)

  t.compare(docRestored.get('array').toArray(), ['item0', 'item1'])
  t.compare(doc.get('array').toArray(), ['item0'])
}

/**
 * 测试场景：gc=false 数组的 item1 在取快照前已删除。
 * 触发操作：快照后头插 item0，再恢复旧状态。
 * 预期结果：目标为空：删除集排除 item1，sv 排除 item0；源仍含 item0。
 *
 * @param {t.TestCase} _tc
 */
export const testDeletedItemsBase = _tc => {
  const doc = new Y.Doc({ gc: false })
  doc.get('array').insert(0, ['item1'])
  doc.get('array').delete(0)
  const snap = Y.snapshot(doc)
  doc.get('array').insert(0, ['item0'])

  const docRestored = Y.createDocFromSnapshot(doc, snap)

  t.compare(docRestored.get('array').toArray(), [])
  t.compare(doc.get('array').toArray(), ['item0'])
}

/**
 * 测试场景：数组有 item1/item2/item3，删除中间项后取快照。
 * 触发操作：头插 item0，再恢复旧快照。
 * 预期结果：目标为 item1/item3，源为 item0/item1/item3；同时验证删除集和新增上界。
 *
 * @param {t.TestCase} _tc
 */
export const testDeletedItems2 = _tc => {
  const doc = new Y.Doc({ gc: false })
  doc.get('array').insert(0, ['item1', 'item2', 'item3'])
  doc.get('array').delete(1)
  const snap = Y.snapshot(doc)
  doc.get('array').insert(0, ['item0'])

  const docRestored = Y.createDocFromSnapshot(doc, snap)

  t.compare(docRestored.get('array').toArray(), ['item1', 'item3'])
  t.compare(doc.get('array').toArray(), ['item0', 'item1', 'item3'])
}

/**
 * 测试场景：两个同步副本关闭 GC，各写第一项并同步后取同一快照。
 * 触发操作：两客户端再各写第二项并同步，用两份最终 store 分别恢复。
 * 预期结果：两个恢复结果都按相同顺序保留 user1item1/user2item1，排除后续两项。
 *
 * @param {t.TestCase} tc
 */
export const testDependentChanges = tc => {
  const { array0, array1, testConnector } = init(tc, { users: 2 })

  if (!array0.doc) {
    throw new Error('no document 0')
  }
  if (!array1.doc) {
    throw new Error('no document 1')
  }

  /**
   * @type {Y.Doc}
   */
  const doc0 = array0.doc
  /**
   * @type {Y.Doc}
   */
  const doc1 = array1.doc

  doc0.gc = false
  doc1.gc = false

  array0.insert(0, ['user1item1'])
  testConnector.syncAll()
  array1.insert(1, ['user2item1'])
  testConnector.syncAll()

  const snap = Y.snapshot(array0.doc)

  array0.insert(2, ['user1item2'])
  testConnector.syncAll()
  array1.insert(3, ['user2item2'])
  testConnector.syncAll()

  const docRestored0 = Y.createDocFromSnapshot(array0.doc, snap)
  t.compare(docRestored0.get('array').toArray(), ['user1item1', 'user2item1'])

  const docRestored1 = Y.createDocFromSnapshot(array1.doc, snap)
  t.compare(docRestored1.get('array').toArray(), ['user1item1', 'user2item1'])
}

/**
 * 测试场景：新文档记录 update，依次取空、插入 [1] 后、删除后快照。
 * 触发操作：交叉查询各快照是否包含插入 update 和删除 update。
 * 预期结果：空快照不含插入；插入后快照不含删除但包含插入；最终快照包含两者。
 *
 * @param {t.TestCase} _tc
 */
export const testContainsUpdate = _tc => {
  const ydoc = new Y.Doc()
  /**
   * @type {Array<Uint8Array>}
   */
  const updates = []
  ydoc.on('update', update => {
    updates.push(update)
  })
  const yarr = ydoc.get()
  const snapshot1 = Y.snapshot(ydoc)
  yarr.insert(0, [1])
  const snapshot2 = Y.snapshot(ydoc)
  yarr.delete(0, 1)
  const snapshotFinal = Y.snapshot(ydoc)
  t.assert(!Y.snapshotContainsUpdate(snapshot1, updates[0]))
  t.assert(!Y.snapshotContainsUpdate(snapshot2, updates[1]))
  t.assert(Y.snapshotContainsUpdate(snapshot2, updates[0]))
  t.assert(Y.snapshotContainsUpdate(snapshotFinal, updates[0]))
  t.assert(Y.snapshotContainsUpdate(snapshotFinal, updates[1]))
}

/**
 * 测试场景：本地写 abcdefghij、删除前三字符，远端同步后取快照。
 * 触发操作：本地再删前三个当前字符，编码完整状态并查询远端旧快照。
 * 预期结果：返回 false；新增结构已在旧快照中，缺失的是较晚的删除事实（issue #767）。
 *
 * @param {t.TestCase} _tc
 */
export const testContainsUpdate2 = _tc => {
  const local = new Y.Doc()
  const remote = new Y.Doc()
  local.get('t').insert(0, 'abcdefghij')
  local.get('t').delete(0, 3)
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(local))
  const snap = Y.snapshot(remote)
  local.get('t').delete(0, 3)
  const update = Y.encodeStateAsUpdate(local)
  t.assert(!Y.snapshotContainsUpdate(snap, update))
}
