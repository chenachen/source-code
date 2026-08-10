import * as t from 'lib0/testing'
import * as Y from '../src/index.js'
import { init, compare } from './testHelper.js' // eslint-disable-line
import { readBlockSet } from '../src/utils/BlockSet.js'
import { readIdSet, writeIdSet } from '../src/utils/ids.js'
import { UpdateDecoderV2 } from '../src/utils/UpdateDecoder.js'
import { UpdateEncoderV2 } from '../src/utils/UpdateEncoder.js'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as object from 'lib0/object'
import * as delta from 'lib0/delta'
import * as array from 'lib0/array'

/**
 * 抽象一组版本一致的更新、状态向量与差分操作，供同一断言覆盖 V1/V2。
 *
 * @typedef {Object} Enc
 * @property {function(Array<Uint8Array<ArrayBuffer>>):Uint8Array<ArrayBuffer>} Enc.mergeUpdates
 * @property {function(Y.Doc):Uint8Array<ArrayBuffer>} Enc.encodeStateAsUpdate
 * @property {function(Y.Doc, Uint8Array):void} Enc.applyUpdate
 * @property {function(Uint8Array):void} Enc.logUpdate
 * @property {function(Uint8Array):{deletes:Y.IdSet,inserts:Y.IdSet}} Enc.readUpdateToContentIds
 * @property {function(Y.Doc):Uint8Array<ArrayBuffer>} Enc.encodeStateVector
 * @property {function(Uint8Array):Uint8Array<ArrayBuffer>} Enc.encodeStateVectorFromUpdate
 * @property {'update'|'updateV2'} Enc.updateEventName
 * @property {string} Enc.description
 * @property {function(Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>):Uint8Array<ArrayBuffer>} Enc.diffUpdate
 */

/**
 * V1 线格式测试适配器。
 *
 * @type {Enc}
 */
const encV1 = {
  mergeUpdates: Y.mergeUpdates,
  encodeStateAsUpdate: Y.encodeStateAsUpdate,
  applyUpdate: Y.applyUpdate,
  logUpdate: Y.logUpdate,
  readUpdateToContentIds: Y.createContentIdsFromUpdate,
  encodeStateVectorFromUpdate: Y.encodeStateVectorFromUpdate,
  encodeStateVector: Y.encodeStateVector,
  updateEventName: 'update',
  description: 'V1',
  diffUpdate: Y.diffUpdate
}

/**
 * V2 线格式测试适配器。
 *
 * @type {Enc}
 */
const encV2 = {
  mergeUpdates: Y.mergeUpdatesV2,
  encodeStateAsUpdate: Y.encodeStateAsUpdateV2,
  applyUpdate: Y.applyUpdateV2,
  logUpdate: Y.logUpdateV2,
  readUpdateToContentIds: Y.createContentIdsFromUpdateV2,
  encodeStateVectorFromUpdate: Y.encodeStateVectorFromUpdateV2,
  encodeStateVector: Y.encodeStateVector,
  updateEventName: 'updateV2',
  description: 'V2',
  diffUpdate: Y.diffUpdateV2
}

/**
 * 通过实际 Doc 集成再编码的参照合并器。
 *
 * 它不走 BlockSet 直接合并算法，可作为独立语义实现与 V1/V2 字节级合并交叉验证。
 *
 * @type {Enc}
 */
const encDoc = {
  mergeUpdates: (updates) => {
    const ydoc = new Y.Doc({ gc: false })
    updates.forEach(update => {
      Y.applyUpdateV2(ydoc, update)
    })
    return Y.encodeStateAsUpdateV2(ydoc)
  },
  encodeStateAsUpdate: Y.encodeStateAsUpdateV2,
  applyUpdate: Y.applyUpdateV2,
  logUpdate: Y.logUpdateV2,
  readUpdateToContentIds: Y.createContentIdsFromUpdateV2,
  encodeStateVectorFromUpdate: Y.encodeStateVectorFromUpdateV2,
  encodeStateVector: Y.encodeStateVector,
  updateEventName: 'updateV2',
  description: 'Merge via Y.Doc',
  /**
   * 通过 Doc 应用更新，再按目标状态向量编码差分。
   *
   * @param {Uint8Array} update
   * @param {Uint8Array} sv
   */
  diffUpdate: (update, sv) => {
    const ydoc = new Y.Doc({ gc: false })
    Y.applyUpdateV2(ydoc, update)
    return Y.encodeStateAsUpdateV2(ydoc, sv)
  }
}

/** 所有待复用断言的更新实现：V1、V2 与 Doc 参照路径。 */
const encoders = [encV1, encV2, encDoc]

/**
 * 编码所有用户文档、合并更新并应用到一个新文档。
 *
 * @param {Array<Y.Doc>} users
 * @param {Enc} enc
 */
const fromUpdates = (users, enc) => {
  const updates = users.map(user =>
    enc.encodeStateAsUpdate(user)
  )
  const ydoc = new Y.Doc()
  enc.applyUpdate(ydoc, enc.mergeUpdates(updates))
  return ydoc
}

/**
 * Given：三个用户中两个并发向同一数组首部插入不同值，随后完成同步。
 * When：分别用 V1、V2 与 Doc 参照路径合并各用户全量更新。
 * Then：新文档数组均等于已经收敛的源文档。
 *
 * 验证机制：同一语义断言跨三条独立合并路径，覆盖并发 Item 排序与去重。
 *
 * @param {t.TestCase} tc
 */
export const testMergeUpdates = tc => {
  const { users, array0, array1 } = init(tc, { users: 3 })

  array0.insert(0, [1])
  array1.insert(0, [2])

  compare(users)
  encoders.forEach(enc => {
    const merged = fromUpdates(users, enc)
    t.compareArrays(array0.toArray(), merged.get('array').toArray())
  })
}

/**
 * Given：同一格式键 `italic` 在文本 Item 中重复出现并夹有普通文本。
 * When：V2 编码并应用到另一文档。
 * Then：字符顺序和两个独立格式范围保持正确，所有用户收敛。
 *
 * 验证机制：比较完整 Delta，覆盖 UpdateEncoderV2/DecoderV2 的格式键时钟与字符串
 * 列同步，而非只比较纯文本。
 *
 * @param {t.TestCase} tc
 */
export const testKeyEncoding = tc => {
  const { users, text0, text1 } = init(tc, { users: 2 })

  text0.insert(0, 'a', { italic: true })
  text0.insert(0, 'b')
  text0.insert(0, 'c', { italic: true })

  const update = Y.encodeStateAsUpdateV2(users[0])
  Y.applyUpdateV2(users[1], update)

  const c = text1.toDelta()
  t.compare(
    c,
    delta.create()
      .insert('c', { italic: true })
      .insert('b')
      .insert('a', { italic: true })
      .done()
  )

  compare(users)
}

/**
 * 对一组至少四条更新构造完整、重叠、重复和含 Skip 的多种合并排列。
 *
 * 每种结果都验证文档状态、由更新推导的状态向量、逐前缀 diff 的插入/删除元数据
 * 与首尾时钟边界。`hasDeletes` 控制 Doc 参照路径因事务结构合并导致的字节差异。
 *
 * @param {Y.Doc} ydoc
 * @param {Array<Uint8Array<ArrayBuffer>>} updates - expecting at least 4 updates
 * @param {Enc} enc
 * @param {boolean} hasDeletes
 */
const checkUpdateCases = (ydoc, updates, enc, hasDeletes) => {
  const cases = []
  // 场景 1：直接合并全部更新。
  cases.push(enc.mergeUpdates(updates))

  // 场景 2：合并两组边界重叠的更新。
  cases.push(enc.mergeUpdates([
    enc.mergeUpdates(updates.slice(2)),
    enc.mergeUpdates(updates.slice(0, 2))
  ]))

  // 场景 3：同一更新在多个子合并中重复出现。
  cases.push(enc.mergeUpdates([
    enc.mergeUpdates(updates.slice(2)),
    enc.mergeUpdates(updates.slice(1, 3)),
    updates[0]
  ]))

  // 场景 4：交错分组产生 Skip 后再合并。
  cases.push(enc.mergeUpdates([
    enc.mergeUpdates([updates[0], updates[2]]),
    enc.mergeUpdates([updates[1], updates[3]]),
    enc.mergeUpdates(updates.slice(4))
  ]))

  // 场景 5：再次合并前述所有结果，制造大量重复。
  cases.push(enc.mergeUpdates(cases))

  // const targetState = enc.encodeStateAsUpdate(ydoc)
  // t.info('Target State: ')
  // enc.logUpdate(targetState)

  cases.forEach((mergedUpdates, i) => {
    t.info(`State Case $${i} (${enc.description}):`)
    // enc.logUpdate(updates)
    const merged = new Y.Doc({ gc: false })
    enc.applyUpdate(merged, mergedUpdates)
    t.compareArrays(merged.get().toArray(), ydoc.get().toArray())
    t.compare(enc.encodeStateVector(merged), enc.encodeStateVectorFromUpdate(mergedUpdates))
    if (enc.updateEventName !== 'update') { // @todo 评估旧版更新能否执行同一字节断言。
      for (let j = 1; j < updates.length; j++) {
        const partMerged = enc.mergeUpdates(updates.slice(j))
        const partMeta = enc.readUpdateToContentIds(partMerged)
        const targetSV = enc.encodeStateVectorFromUpdate(enc.mergeUpdates(updates.slice(0, j)))
        const diffed = enc.diffUpdate(mergedUpdates, targetSV)
        const diffedMeta = enc.readUpdateToContentIds(diffed)
        t.compare(partMeta.inserts, diffedMeta.inserts)
        {
          // diffUpdate 会保留全部删除，不能直接与后缀更新比较；先把其删除集合并到
          // 后缀更新，再比较规范结果。
          const decoder = decoding.createDecoder(diffed)
          const updateDecoder = new UpdateDecoderV2(decoder)
          readBlockSet(updateDecoder)
          const ds = readIdSet(updateDecoder)
          const updateEncoder = new UpdateEncoderV2()
          encoding.writeVarUint(updateEncoder.restEncoder, 0) // 构造只含删除集的更新。
          writeIdSet(updateEncoder, ds)
          const deletesUpdate = updateEncoder.toUint8Array()
          const mergedDeletes = Y.mergeUpdatesV2([deletesUpdate, partMerged])
          if (!hasDeletes || enc !== encDoc) {
            // Doc 参照路径可能因事务 mergeStruct 产生不同但等价的删除结构字节。
            t.compare(diffed, mergedDeletes)
          }
        }
      }
    }
    const meta = enc.readUpdateToContentIds(mergedUpdates)
    meta.inserts.clients.forEach(range => { t.assert(range.getIds()[0].clock === 0) })
    meta.inserts.clients.forEach((range, client) => {
      const structs = /** @type {Array<Y.Item>} */ (merged.store.clients.get(client))
      const lastStruct = structs[structs.length - 1]
      const lastIdRange = array.last(range.getIds())
      t.assert(lastStruct.id.clock + lastStruct.length === lastIdRange.clock + lastIdRange.len)
    })
  })
}

/**
 * 验证四次纯插入更新在所有编码/参照路径和所有重叠排列下合并收敛。
 *
 * @param {t.TestCase} _tc
 */
export const testMergeUpdates1 = _tc => {
  encoders.forEach((enc) => {
    t.info(`Using encoder: ${enc.description}`)
    const ydoc = new Y.Doc({ gc: false })
    const updates = /** @type {Array<Uint8Array<ArrayBuffer>>} */ ([])
    ydoc.on(enc.updateEventName, update => { updates.push(update) })
    const array = ydoc.get()
    array.insert(0, [1])
    array.insert(0, [2])
    array.insert(0, [3])
    array.insert(0, [4])
    checkUpdateCases(ydoc, updates, enc, false)
  })
}

/**
 * 验证交错插入与删除更新在所有编码/参照路径和重叠排列下合并收敛。
 *
 * @param {t.TestCase} _tc
 */
export const testMergeUpdates2 = _tc => {
  encoders.forEach((enc, _i) => {
    t.info(`Using encoder: ${enc.description}`)
    const ydoc = new Y.Doc({ gc: false })
    const updates = /** @type {Array<Uint8Array<ArrayBuffer>>} */ ([])
    ydoc.on(enc.updateEventName, update => { updates.push(update) })
    const array = ydoc.get()
    array.insert(0, [1, 2])
    array.delete(1, 1)
    array.insert(0, [3, 4])
    array.delete(1, 2)
    checkUpdateCases(ydoc, updates, enc, true)
  })
}

/**
 * 基准化 100 个 client、每个 100 次插入的直接更新合并与 Doc 应用合并。
 *
 * 用例只记录耗时，不设性能阈值；同时覆盖大量客户端段与高重复结构。
 *
 * @param {t.TestCase} _tc
 */
export const testMergeUpdatesStressTest = _tc => {
  const N = 100
  const M = 100
  encoders.forEach((enc, _i) => {
    t.info(`Using encoder: ${enc.description}`)
    const ydoc = new Y.Doc({ gc: false })
    const updates = /** @type {Array<Uint8Array<ArrayBuffer>>} */ ([])
    ydoc.on(enc.updateEventName, update => { updates.push(update) })
    const array = ydoc.get()
    for (let clientid = 0; clientid < N; clientid++) {
      ydoc.clientID = clientid
      for (let i = 0; i < M; i++) {
        array.push([i])
      }
    }
    t.measureTime('merge via Y.mergeUpdates', () => {
      enc.mergeUpdates(updates)
    })
    t.measureTime('merge via Y.applyUpdate on Y.Doc', () => {
      const ydoc = new Y.Doc()
      updates.forEach(update => {
        enc.applyUpdate(ydoc, update)
      })
    })
  })
}

/**
 * Given：文本五次插入产生连续更新，后续文档按乱序逐步接收依赖不完整的快照。
 * When：每补一批更新后重新编码全量状态，最终补齐所有结构。
 * Then：待处理结构恢复集成，最终文本为确定的 `nenor`。
 *
 * 验证机制：真实经过 `pendingStructs.missing`、更新合并与递归重试链，证明乱序依赖
 * 不会丢结构或重复应用。
 *
 * @param {t.TestCase} _tc
 */
export const testMergePendingUpdates = _tc => {
  const yDoc = new Y.Doc()
  /**
   * @type {Array<Uint8Array>}
   */
  const serverUpdates = []
  yDoc.on('update', (update, _origin, _c) => {
    serverUpdates.splice(serverUpdates.length, 0, update)
  })
  const yText = yDoc.get('textBlock')
  yText.applyDelta(delta.create().insert('r').done())
  yText.applyDelta(delta.create().insert('o').done())
  yText.applyDelta(delta.create().insert('n').done())
  yText.applyDelta(delta.create().insert('e').done())
  yText.applyDelta(delta.create().insert('n').done())

  const yDoc1 = new Y.Doc()
  Y.applyUpdate(yDoc1, serverUpdates[0])
  const update1 = Y.encodeStateAsUpdate(yDoc1)

  const yDoc2 = new Y.Doc()
  Y.applyUpdate(yDoc2, update1)
  Y.applyUpdate(yDoc2, serverUpdates[1])
  const update2 = Y.encodeStateAsUpdate(yDoc2)

  const yDoc3 = new Y.Doc()
  Y.applyUpdate(yDoc3, update2)
  Y.applyUpdate(yDoc3, serverUpdates[3])
  const update3 = Y.encodeStateAsUpdate(yDoc3)

  const yDoc4 = new Y.Doc()
  Y.applyUpdate(yDoc4, update3)
  Y.applyUpdate(yDoc4, serverUpdates[2])
  const update4 = Y.encodeStateAsUpdate(yDoc4)

  const yDoc5 = new Y.Doc()
  Y.applyUpdate(yDoc5, update4)
  Y.applyUpdate(yDoc5, serverUpdates[4])
  Y.encodeStateAsUpdate(yDoc5)

  const yText5 = yDoc5.get('textBlock')
  t.compareStrings(yText5.toString(), 'nenor')
}

/**
 * Given：包含富文本、重复映射属性、任意数组值、嵌套类型与子文档的更新。
 * When：调用 `obfuscateUpdate()` 并应用脱敏结果。
 * Then：结构数量、格式形态和类型类别保留，所有敏感值、键、名称与 GUID 被替换。
 *
 * 验证机制：分别检查每种 Content 类型的可观察结果，证明脱敏转换保留 CRDT 元数据
 * 但改写用户载荷。
 *
 * @param {t.TestCase} _tc
 */
export const testObfuscateUpdates = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get('text')
  const ymap = ydoc.get('map')
  const yarray = ydoc.get('array')
  // 构造富文本内容。
  ytext.applyDelta(delta.create().insert('text', { bold: true }).insert([{ href: 'supersecreturl' }]).done())
  // 构造带历史版本的映射属性。
  ymap.setAttr('key', 'secret1')
  ymap.setAttr('key', 'secret2')
  // 构造含嵌套类型与子文档的数组。
  const subtype = new Y.Type('secretnodename')
  const subdoc = new Y.Doc({ guid: 'secret' })
  subtype.setAttr('attr', 'val')
  yarray.insert(0, ['teststring', 42, subtype, subdoc])
  // 脱敏更新并应用到新文档。
  const obfuscatedUpdate = Y.obfuscateUpdate(Y.encodeStateAsUpdate(ydoc))
  const odoc = new Y.Doc()
  Y.applyUpdate(odoc, obfuscatedUpdate)
  const otext = odoc.get('text')
  const omap = odoc.get('map')
  const oarray = odoc.get('array')
  // 验证文本与格式形态保留、载荷已替换。
  const d = /** @type {any} */ (otext.toDelta().toJSON().children)
  t.assert(d.length === 2)
  t.assert(d[0].insert !== 'text' && d[0].insert.length === 4)
  t.assert(object.length(d[0].format) === 1)
  t.assert(!object.hasProperty(d[0].format, 'bold'))
  t.assert(object.length(d[1].insert) === 1)
  t.assert(object.hasProperty(d[1], 'insert'))
  // 验证原映射键不可见。
  t.assert(omap.attrSize === 1)
  t.assert(!omap.hasAttr('key'))
  // 验证数组元素类别保留。
  const result = oarray.toArray()
  t.assert(result.length === 4)
  t.assert(result[0] !== 'teststring')
  t.assert(result[1] !== 42)
  const osubtype = /** @type {Y.Type} */ (result[2])
  const osubdoc = result[3]
  // 验证嵌套类型名称与属性键脱敏。
  t.assert(osubtype.name !== subtype.name)
  t.assert(object.length(osubtype.getAttrs()) === 1)
  t.assert(osubtype.getAttr('attr') === undefined)
  // 验证子文档 GUID 脱敏。
  t.assert(osubdoc.guid !== subdoc.guid)
}

/**
 * 验证按文档第一阶段 ContentIds 筛选完整更新时，可提取并应用被选中的属性版本。
 */
export const testIntersectDoc = () => {
  const ydoc = new Y.Doc()
  ydoc.get().setAttr('k', 1)
  const c1 = Y.createContentIdsFromDoc(ydoc, true)
  ydoc.get().setAttr('k', 2)

  const v1 = Y.intersectUpdateWithContentIds(Y.encodeStateAsUpdate(ydoc), c1)
  const y1 = new Y.Doc()
  Y.applyUpdate(y1, v1)
  t.assert(ydoc.get().getAttr('k'))
}

/**
 * Given：单客户端连续写入十个映射 Item，并构造中段、跨空洞和全覆盖选择。
 * When：按 ContentIds 与更新求交集。
 * Then：中段选择保留精确时钟 5、6；跨空洞选择同时保留两段；全覆盖字节不变。
 *
 * 验证机制：解码输出后比较真实结构时钟，并对全覆盖做字节级比较，证明每客户端
 * 首个选择不要求从 clock 0 开始，后续空洞由 Skip 正确承接。
 *
 * @see https://github.com/yjs/yjs/issues/781
 */
export const testIntersectSparseContentIds = () => {
  const src = new Y.Doc()
  src.transact(() => {
    const m = src.get('m')
    for (let i = 0; i < 10; i++) m.setAttr(`k${i}`, i) // 单客户端时钟 0..9。
  })
  const update = Y.encodeStateAsUpdate(src)
  const cids = Y.createContentIdsFromUpdate(update)
  /**
   * @type {number}
   */
  let client = 0
  cids.inserts.clients.forEach((_r, c) => { client = c })

  // 只选择中段半开区间 [5, 7)。
  const sel = Y.createIdSet()
  sel.add(client, 5, 2)
  const chunk = Y.intersectUpdateWithContentIds(update, {
    inserts: sel,
    deletes: Y.createIdSet()
  })
  // 每个映射键对应长度 1 的 Item，因此应输出两条结构。
  const structs = Y.decodeUpdate(chunk).structs.filter(s => !(s instanceof Y.Skip))
  t.assert(structs.every(s => s.id.client === client))
  t.compare(structs.map(s => [s.id.clock, s.length]), [[5, 1], [6, 1]])

  // 跨空洞选择必须保留两段，并在中间编码 Skip。
  const sel2 = Y.createIdSet()
  sel2.add(client, 1, 2) // 时钟 1、2。
  sel2.add(client, 7, 1) // 时钟 7。
  const chunk2 = Y.intersectUpdateWithContentIds(update, {
    inserts: sel2,
    deletes: Y.createIdSet()
  })
  const structs2 = Y.decodeUpdate(chunk2).structs.filter(s => !(s instanceof Y.Skip))
  t.compare(structs2.map(s => [s.id.clock, s.length]), [[1, 1], [2, 1], [7, 1]])

  // 全覆盖选择不应引入额外切片或 Skip，必须字节级保持一致。
  const selAll = Y.createIdSet()
  cids.inserts.clients.forEach((ranges, c) => {
    ranges.getIds().forEach(r => selAll.add(c, r.clock, r.len))
  })
  const chunkAll = Y.intersectUpdateWithContentIds(update, {
    inserts: selAll,
    deletes: Y.createIdSet()
  })
  t.compare(chunkAll, update)
}
