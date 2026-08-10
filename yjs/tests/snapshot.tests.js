import * as Y from '../src/index.js'
import * as t from 'lib0/testing'
import { init } from './testHelper.js'
import * as delta from 'lib0/delta'

/**
 * Given：关闭 GC 的文档在写入 `world!` 后取快照，再前插 `hello `。
 * When：从当前 store 与旧快照重建文档。
 * Then：目标只包含快照时的 `world!`。
 *
 * 验证机制：证明 state vector 截断后续插入，而源 store 提供快照内容。
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
 * 验证属性读取传入不同快照时，分别返回空、历史值和当前值。
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
 * 验证恢复快照不会修改源文档，目标只接收快照 state vector 以内的数组项。
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
 * 验证空快照（含 clock=0 client 项）可恢复为空，最新快照仍可完整恢复当前内容。
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
 * 验证快照 state vector 同时约束嵌套类型内的后续属性变更。
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
 * 验证快照后删除的首个数组项可从 `gc=false` 历史中恢复。
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
 * 验证快照恢复保留被后续删除项与其左邻居的原顺序，覆盖结构切分边界。
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
 * 验证快照创建前已删除的内容保持不可见，快照后的新插入也不会进入恢复结果。
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
 * 验证 delete set 能精确排除快照前删除的中间项，同时 state vector 排除快照后头插项。
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
 * 验证两个已同步 peer 从同一快照恢复时得到相同因果闭包，不包含双方后续依赖变更。
 *
 * Given：两个客户端各写一项并同步后取快照，再各写一项并同步。
 * When：分别从两个最终 store 恢复同一快照。
 * Then：两份恢复文档都只含前两项且顺序相同。
 *
 * 对应源码：`createDocFromSnapshot()` 按快照 sv 编码每个 client 的历史前缀。
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
 * 验证 `snapshotContainsUpdate` 同时检查新增结构上界与 delete set 包含关系。
 *
 * Given：依次取得空、插入后、删除后的三个快照与两条 update。
 * When：交叉检查每个快照是否包含对应 update。
 * Then：只有 state vector 已覆盖插入且 delete set 已覆盖删除时返回 true。
 *
 * 验证机制：插入与删除两类负例分别锁定函数的两个判定阶段。
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
 * 回归验证 issue #767：只含较早删除集的远端快照不能声称包含本地后续删除 update。
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
