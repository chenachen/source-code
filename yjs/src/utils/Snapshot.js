import * as map from 'lib0/map'
import * as set from 'lib0/set'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'

import { createID } from './ID.js'
import { createDeleteSetFromStructStore, createIdSet, iterateStructsByIdSet, equalIdSets, mergeIdSets, writeIdSet, readIdSet } from './ids.js'
import { getStateVector } from './StructStore.js'
import { findIndexSS, getItemCleanStart } from './transaction-helpers.js'
import { writeStateVector, readStateVector, applyUpdateV2 } from './encoding.js'
import { UpdateDecoderV1, UpdateDecoderV2, IdSetDecoderV1, IdSetDecoderV2 } from './UpdateDecoder.js'
import { UpdateEncoderV2, IdSetEncoderV1, IdSetEncoderV2 } from './UpdateEncoder.js'
import { LazyStructReader } from './updates.js'
import { Doc } from './Doc.js'

/**
 * 用 state vector 与当时的 delete set 描述文档历史切面。
 *
 * `sv` 限定每个 client 在快照时已知的结构 clock 上界，`ds` 再标出这些已知结构中当时已删除的区间；两者缺一都无法重建可见状态。
 */
export class Snapshot {
  /**
   * 保存删除集与 state vector 的引用，不复制或冻结；修改传入集合也会改变此快照。
   *
   * @param {IdSet} ds - 快照时已删除的 ID 区间。
   * @param {Map<number,number>} sv - 快照时各 client 的下一个 clock。
   */
  constructor (ds, sv) {
    /** 快照时的删除区间。
     * @type {IdSet} */
    this.ds = ds
    /** 快照 state vector：client 到排他 clock 上界。
     * @type {Map<number,number>} */
    this.sv = sv
  }
}

/**
 * 比较两个快照的 state vector 与 delete set 是否结构相等。
 *
 * state vector 严格比较键数量和值，显式的 client→0 项与缺省项不会被视为相等，即使两者都不包含该 client 的插入。
 *
 * @param {Snapshot} snap1 - 左快照。
 * @param {Snapshot} snap2 - 右快照。
 * @return {boolean} 两部分均相等时为 `true`。
 */
export const equalSnapshots = (snap1, snap2) => {
  const sv1 = snap1.sv
  const sv2 = snap2.sv
  if (sv1.size !== sv2.size) {
    return false
  }
  for (const [key, value] of sv1.entries()) {
    if (sv2.get(key) !== value) {
      return false
    }
  }
  return equalIdSets(snap1.ds, snap2.ds)
}

/**
 * 以指定 V1/V2 ID-set 编码器依次写入 delete set 与 state vector。
 *
 * 这里编码的是边界元数据而非 Item 内容；格式版本由调用方选择，没有独立版本标志可供 decode 自动识别。
 *
 * @param {Snapshot} snapshot - 待编码快照。
 * @param {IdSetEncoderV1 | IdSetEncoderV2} [encoder] - 默认使用 V2。
 * @return {Uint8Array} 版本匹配的快照载荷。
 */
export const encodeSnapshotV2 = (snapshot, encoder = new IdSetEncoderV2()) => {
  writeIdSet(encoder, snapshot.ds)
  writeStateVector(encoder, snapshot.sv)
  return encoder.toUint8Array()
}

/**
 * 使用兼容旧协议的 V1 ID-set 编码器编码快照。
 *
 * @param {Snapshot} snapshot - 待编码快照。
 * @return {Uint8Array} V1 快照载荷。
 */
export const encodeSnapshot = snapshot => encodeSnapshotV2(snapshot, new IdSetEncoderV1())

/**
 * 按写入顺序从载荷读取 delete set 和 state vector。
 *
 * 若显式传入 decoder，就直接从该 decoder 当前游标读；buf 只用于默认 decoder 的构造，不能靠它覆盖已有解码器游标。
 *
 * @param {Uint8Array} buf - 快照字节。
 * @param {IdSetDecoderV1 | IdSetDecoderV2} [decoder] - 默认使用 V2。
 * @return {Snapshot} 解码快照。
 */
export const decodeSnapshotV2 = (buf, decoder = new IdSetDecoderV2(decoding.createDecoder(buf))) => {
  return new Snapshot(readIdSet(decoder), readStateVector(decoder))
}

/**
 * 使用 V1 ID-set 解码器读取旧协议快照。
 *
 * @param {Uint8Array} buf - V1 快照字节。
 * @return {Snapshot} 解码快照。
 */
export const decodeSnapshot = buf => decodeSnapshotV2(buf, new IdSetDecoderV1(decoding.createDecoder(buf)))

/**
 * 从删除区间与 state vector 创建快照。
 *
 * @param {IdSet} ds - 删除区间。
 * @param {Map<number,number>} sm - client state 映射。
 * @return {Snapshot} 快照值对象。
 */
export const createSnapshot = (ds, sm) => new Snapshot(ds, sm)

/** 不含已知结构/删除区间的共享空快照；其集合可变，修改它会影响所有引用此常量的调用方。 */
export const emptySnapshot = createSnapshot(createIdSet(), new Map())

/**
 * 从文档当前 store 同时捕获完整 delete set 与 state vector。
 *
 * @param {Doc} doc - 来源文档。
 * @return {Snapshot} 当前历史切面。
 */
export const snapshot = doc => createSnapshot(createDeleteSetFromStructStore(doc.store), getStateVector(doc.store))

/**
 * 把受快照边界影响的结构切开，使后续可见性判断能按整结构处理。
 *
 * state vector 上界与 delete-set 区间端点都可能落在 Item 内部；先切分可保证每个结构整体属于快照内/外或删除/未删。事务 meta 按快照去重，避免同一事务重复改变结构分段。
 * 去重依据 Snapshot 对象身份，不是 equalSnapshots；这里只改变物理分段并登记合并候选，不新增插入或删除事实。
 *
 * @param {Transaction} transaction - 允许登记切分与后续合并的事务。
 * @param {Snapshot} snapshot - 决定切分边界的快照。
 */
export const splitSnapshotAffectedStructs = (transaction, snapshot) => {
  const meta = map.setIfUndefined(transaction.meta, splitSnapshotAffectedStructs, set.create)
  const store = transaction.doc.store
  // 同一事务、同一快照只需切分一次；meta 的函数键避免与其他用途冲突。
  if (!meta.has(snapshot)) {
    snapshot.sv.forEach((clock, client) => {
      if (clock < store.getClock(client)) {
        getItemCleanStart(transaction, createID(client, clock))
      }
    })
    iterateStructsByIdSet(transaction, snapshot.ds, _item => {})
    meta.add(snapshot)
  }
}

/**
 * 从禁用 GC 的源文档中编码快照以内的历史，并应用到新文档以重建该切面。
 *
 * 快照只保存边界，不保存内容；源 store 必须仍含每个 client 在 `sv` 之前的结构与载荷。此前已被 GC 的内容不能通过后来设置 `gc=false` 补回。
 * 恢复通过 applyUpdateV2 应用历史前缀和快照删除集；目标应为空，非空目标已有的后续结构不会被回滚。
 * 编码在源文档的同步事务内执行，必要时临时切开 Item；它可触发源 Doc 的事务生命周期，但不改变源文档可见内容。
 *
 * @example
 *  const ydoc = new Y.Doc({ gc: false })
 *  ydoc.get().insert(0, 'world!')
 *  const snapshot = Y.snapshot(ydoc)
 *  ydoc.get().insert(0, 'hello ')
 *  const restored = Y.createDocFromSnapshot(ydoc, snapshot)
 *  assert(restored.get().toString() === 'world!')
 *
 * @param {Doc} originDoc - `gc=false` 且仍持有历史内容的源文档。
 * @param {Snapshot} snapshot - 待恢复切面。
 * @param {Doc} [newDoc] - 可选目标文档；精确恢复旧切面时需为空，默认新建空文档。
 * @return {Doc} 应用快照 update 后的目标文档。
 */
export const createDocFromSnapshot = (originDoc, snapshot, newDoc = new Doc()) => {
  if (originDoc.gc) {
    // GC 可能已清空快照需要恢复的 Content，只有结构 ID 不足以重建值。
    throw new Error('Garbage-collection must be disabled in `originDoc`!')
  }
  const { sv, ds } = snapshot

  const encoder = new UpdateEncoderV2()
  originDoc.transact(transaction => {
    let size = 0
    sv.forEach(clock => {
      if (clock > 0) {
        size++
      }
    })
    encoding.writeVarUint(encoder.restEncoder, size)
    // state vector 可能落在结构内部；先切开，随后才能按完整结构数编码精确前缀。
    for (const [client, clock] of sv) {
      if (clock === 0) {
        continue
      }
      if (clock < originDoc.store.getClock(client)) {
        getItemCleanStart(transaction, createID(client, clock))
      }
      const structs = originDoc.store.clients.get(client) || []
      const lastStructIndex = findIndexSS(structs, clock - 1)
      // 写入该 client 从 clock 0 到快照上界的结构数。
      encoding.writeVarUint(encoder.restEncoder, lastStructIndex + 1)
      encoder.writeClient(client)
      // 每个 client 都从 clock 0 写起，形成自包含历史前缀。
      encoding.writeVarUint(encoder.restEncoder, 0)
      for (let i = 0; i <= lastStructIndex; i++) {
        structs[i].write(encoder, 0, 0)
      }
    }
    writeIdSet(encoder, ds)
  })

  applyUpdateV2(newDoc, encoder.toUint8Array(), 'snapshot')
  return newDoc
}

/**
 * 判断 update 编码的全部结构 ID 区间与删除事实是否已被快照覆盖；不比较结构载荷。
 *
 * 每个结构末端必须不超过快照对应 client 的 state；把 update delete set 合并进快照后仍与原集合相等，才能证明 update 未引入快照之外的删除事实。
 *
 * @param {Snapshot} snapshot - 被检查的历史切面。
 * @param {Uint8Array} update - V1/V2 update 载荷。
 * @param {typeof UpdateDecoderV2 | typeof UpdateDecoderV1} [YDecoder] - 与载荷版本匹配的解码器类。
 * @return {boolean} update 所有事实均已包含时为 `true`。
 */
export const snapshotContainsUpdateV2 = (snapshot, update, YDecoder = UpdateDecoderV2) => {
  const structs = []
  const updateDecoder = new YDecoder(decoding.createDecoder(update))
  const lazyDecoder = new LazyStructReader(updateDecoder, false)
  for (let curr = lazyDecoder.curr; curr !== null; curr = lazyDecoder.next()) {
    structs.push(curr)
    if ((snapshot.sv.get(curr.id.client) || 0) < curr.id.clock + curr.length) {
      return false
    }
  }
  const mergedDS = mergeIdSets([snapshot.ds, readIdSet(updateDecoder)])
  return equalIdSets(snapshot.ds, mergedDS)
}

/**
 * 使用 V1 update 解码器执行快照包含性判断。
 *
 * @param {Snapshot} snapshot - 被检查快照。
 * @param {Uint8Array} update - V1 update 载荷。
 * @return {boolean} update 是否完全包含于快照。
 */
export const snapshotContainsUpdate = (snapshot, update) => snapshotContainsUpdateV2(snapshot, update, UpdateDecoderV1)
