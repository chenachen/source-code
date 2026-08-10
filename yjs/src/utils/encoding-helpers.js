import * as encoding from 'lib0/encoding'
import * as math from 'lib0/math'
import * as array from 'lib0/array'

import { findIndexSS } from './transaction-helpers.js'
import { Skip } from '../structs/Skip.js'
import { createID } from './ID.js'
import { writeIdSet } from './ids.js'

/**
 * 写出某客户端由 ID 范围选中的结构切片。
 *
 * 先把半开时钟范围映射为结构索引，并预计算结构记录数；多个不连续范围之间写入
 * Skip，首尾部分命中则通过 `offset`/`offsetEnd` 裁剪。协议头中的记录数包含这些
 * Skip，因此必须在写字节前确定。
 *
 * 前置条件：`idranges` 非空，且每个范围都与该客户端结构区间相交；调用方先按
 * `StructStore` 状态构造这些范围。
 *
 * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
 * @param {Array<GC|Item|Skip>} structs 指定客户端的全部有序结构。
 * @param {number} client
 * @param {Array<IdRange>} idranges
 *
 * @function
 */
export const writeStructs = (encoder, structs, client, idranges) => {
  let structsToWrite = 0 // 同时计入范围间生成的 Skip。
  /**
   * @type {Array<{ start: number, end: number, startClock: number, endClock: number }>}
   */
  const indexRanges = []
  const firstPossibleClock = structs[0].id.clock
  const lastStruct = array.last(structs)
  const lastPossibleClock = lastStruct.id.clock + lastStruct.length
  idranges.forEach(idrange => {
    const startClock = math.max(idrange.clock, firstPossibleClock)
    const endClock = math.min(idrange.clock + idrange.len, lastPossibleClock)
    if (startClock >= endClock) return // 该范围与本地结构区间无交集。
    // 起始索引包含命中结构。
    const start = findIndexSS(structs, startClock)
    // 结束索引不包含其后结构。
    const end = findIndexSS(structs, endClock - 1) + 1
    structsToWrite += end - start
    indexRanges.push({
      start,
      end,
      startClock,
      endClock
    })
  })
  structsToWrite += idranges.length - 1
  // `clock` 始终表示下一条应写出的绝对时钟。
  let clock = indexRanges[0].startClock
  // 写入结构记录数（含人工 Skip）。
  encoding.writeVarUint(encoder.restEncoder, structsToWrite)
  encoder.writeClient(client)
  // 写入该客户端首条记录的起始时钟。
  encoding.writeVarUint(encoder.restEncoder, clock)
  indexRanges.forEach(indexRange => {
    const skipLen = indexRange.startClock - clock
    if (skipLen > 0) {
      new Skip(createID(client, clock), skipLen).write(encoder, 0)
      clock += skipLen
    }
    for (let i = indexRange.start; i < indexRange.end; i++) {
      const struct = structs[i]
      const structEnd = struct.id.clock + struct.length
      const offsetEnd = math.max(structEnd - indexRange.endClock, 0)
      struct.write(encoder, clock - struct.id.clock, offsetEnd)
      clock = structEnd - offsetEnd
    }
  })
}

/**
 * 按 ID 集从结构存储写出插入结构段。
 *
 * 客户端数量直接取集合键数；client ID 降序能改善接收侧并发冲突扫描。调用方须
 * 保证集合中的每个客户端在存储中存在。
 *
 * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
 * @param {StructStore} store
 * @param {IdSet} idset
 *
 * @todo 当前会写出每个选中区间覆盖的完整结构切片。
 *
 * @private
 * @function
 */
export const writeStructsFromIdSet = (encoder, store, idset) => {
  // 写入携带结构的客户端数量。
  encoding.writeVarUint(encoder.restEncoder, idset.clients.size)
  // 高 client ID 优先，降低并发位置解析成本。
  array.from(idset.clients.entries()).sort((a, b) => b[0] - a[0]).forEach(([client, ids]) => {
    const idRanges = ids.getIds()
    const structs = /** @type {Array<GC|Item>} */ (store.clients.get(client))
    writeStructs(encoder, structs, client, idRanges)
  })
}

/**
 * 写出本事务插入集对应的结构段。
 *
 * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
 * @param {Transaction} transaction
 *
 * @private
 * @function
 */
export const writeStructsFromTransaction = (encoder, transaction) => writeStructsFromIdSet(encoder, transaction.doc.store, transaction.insertSet)

/**
 * 若事务产生结构或删除，写出完整更新消息。
 *
 * 消息固定先写结构段、后写删除集；空事务返回 false，避免生成无意义更新事件。
 *
 * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
 * @param {Transaction} transaction
 * @return {boolean} 是否实际写入数据。
 */
export const writeUpdateMessageFromTransaction = (encoder, transaction) => {
  if (transaction.deleteSet.clients.size === 0 && transaction.insertSet.clients.size === 0) {
    return false
  }
  writeStructsFromTransaction(encoder, transaction)
  writeIdSet(encoder, transaction.deleteSet)
  return true
}
