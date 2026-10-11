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
 * @property {function(Array<Uint8Array<ArrayBuffer>>):Uint8Array<ArrayBuffer>} Enc.mergeUpdates 合并同一适配器线格式的更新字节，Doc 参照路径则逐条集成后重新编码。
 * @property {function(Y.Doc):Uint8Array<ArrayBuffer>} Enc.encodeStateAsUpdate 把文档全量可同步状态编码为适配器的更新线格式。
 * @property {function(Y.Doc, Uint8Array):void} Enc.applyUpdate 把适配器的更新字节应用到目标 Doc，触发集成与 pending 处理。
 * @property {function(Uint8Array):void} Enc.logUpdate 按适配器版本解码更新并打印结构/删除集，供调试。
 * @property {function(Uint8Array):{deletes:Y.IdSet,inserts:Y.IdSet}} Enc.readUpdateToContentIds 从字节提取非 Skip 插入区间与删除集，不创建 Doc。
 * @property {function(Y.Doc):Uint8Array<ArrayBuffer>} Enc.encodeStateVector 从 Doc 的连续已知前缀生成通用状态向量字节。
 * @property {function(Uint8Array):Uint8Array<ArrayBuffer>} Enc.encodeStateVectorFromUpdate 仅从该更新结构段推导连续前缀，非零起点与 Skip 会截断计数。
 * @property {'update'|'updateV2'} Enc.updateEventName 监听产生本适配器更新字节的事件，V1 为 update，V2/Doc 为 updateV2。
 * @property {string} Enc.description 日志中的适配器名称，标识当前循环采用的实现。
 * @property {function(Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>):Uint8Array<ArrayBuffer>} Enc.diffUpdate 按目标状态向量裁出结构后缀并保留完整删除集；Doc 路径先集成再编码。
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
  /**
   * 在 gc=false 的新 Doc 中逐条应用 V2 更新，再导出全量 V2 状态。
   *
   * @param {Array<Uint8Array<ArrayBuffer>>} updates 同版本更新，顺序可包含重复或因果缺依赖。
   * @return {Uint8Array<ArrayBuffer>} 包含已集成结构、完整删除集及剩余 pending 的 V2 更新。
   */
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
   * 输入和输出都为 V2；状态向量仍使用通用 client/clock 编码。新文档保留删除载荷，作为字节级 diffUpdate 的集成后参照路径。
   *
   * @param {Uint8Array} update - 待集成的 V2 更新字节，允许携带删除集与缺依赖结构。
   * @param {Uint8Array} sv - 消费方已有连续前缀的编码状态向量。
   * @return {Uint8Array} V2 差分更新；省略消费方已具备的连续前缀，仍携带删除事实及未解决的 pending。
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
 * 将同步后的多副本状态汇总为一份目标，供同一组场景比较 V1、V2 与 Doc 参照合并器；不会修改传入用户。
 *
 * @param {Array<Y.Doc>} users - 夹具中的副本，逐个编码其完整结构与删除事实。
 * @param {Enc} enc - 同一线格式的编码、合并和应用函数集合。
 * @return {Y.Doc} 接收合并结果的新文档；调用方断言它与夹具最终内容一致。
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
 * 验证机制：同一并发场景覆盖两种线格式的 BlockSet 合并及 Doc 应用后再编码，比较可见数组结果。
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
 * 每种结果都验证文档状态、由更新推导的状态向量与插入范围的首尾时钟。V2 和 Doc
 * 参照路径还比较逐前缀 diff 的插入元数据及补齐删除后的更新字节；含删除时跳过
 * Doc 参照路径的字节比较，因为应用事务可合并结构、改变等价更新的分段。
 *
 * @param {Y.Doc} ydoc
 * @param {Array<Uint8Array<ArrayBuffer>>} updates - 至少四条更新。
 * @param {Enc} enc
 * @param {boolean} hasDeletes
 */
const checkUpdateCases = (ydoc, updates, enc, hasDeletes) => {
  const cases = []
  // 场景 1：直接合并全部更新。
  cases.push(enc.mergeUpdates(updates))

  // 场景 2：先分别合并首两条与剩余更新，再合并两组结果。
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
 * 初始：gc=false 的空数组，每个适配器各自监听其 update 事件。触发：四次首部插入 1/2/3/4，再执行 checkUpdateCases 的五种分组。预期：各合并结果为 [4,3,2,1]，状态向量及所述元数据/差分断言通过。
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
 * 初始：gc=false 的空数组。触发：插入 [1,2]、删除 2、插入 [3,4]、删除 [4,1]，再执行五种合并分组。预期：结果为 [3]，删除集保留；带删除的 Doc 参照路径跳过差分字节相等断言。
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
 * 用例记录 10,000 条插入更新的合并与逐条应用耗时，不设置性能阈值。
 *
 * 初始：同一 gc=false 文档依次改用 clientID 0..99。触发：每个 client 追加 100 个元素，三种适配器分别计时合并和逐条应用。目标：观察 10,000 条唯一插入更新的耗时；未检查接收结果或设置通过阈值。
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
 * 验证机制：固定乱序路径经过 `pendingStructs.missing`、更新合并与递归重试链，
 * 最后文本断言检查这组输入能补齐并得到正确顺序。
 *
 * 实际断言只比较最后文本；missing 水位、pending 清空、重试次数与中间文档状态没有独立断言，机制路径由乱序输入和源码调用链确定。
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
 * Then：所断言的格式/数组形态和类型类别保留，选定载荷、键、名称与 GUID 被替换。
 *
 * 验证机制：分别检查每种 Content 类型的可观察结果，证明脱敏转换保留 CRDT 元数据
 * 但改写用户载荷。
 *
 * 断言覆盖所列字符串/数值、键名、类型名及 GUID 的替换，并比较格式/元素类别数量；不比较所有原始字段，也不是匿名性保证。
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
 * 记录属性第一次写入后的 ContentIds，再从二次写入后的完整更新中筛选并应用到新文档。
 * 当前断言只检查源文档属性 `k` 为真值，没有检查接收文档的属性版本。
 * 初始：源属性 k 从 1 改成 2，选择集在第一次写入后记录。触发：对全量更新求交集并应用到 y1。实际预期：唯一断言只要求源 k 为真值；没有断言 y1，因此无法验证所选历史版本恢复结果。
 *
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
