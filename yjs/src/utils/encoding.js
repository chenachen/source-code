/**
 * Yjs 更新、状态向量与文档快照的编解码及集成入口。
 *
 * @module encoding
 */
/*
 * info 标志低五位决定结构/内容类型：
 *
 * 0: GC
 * 1: 带 Deleted 内容的 Item
 * 2: 带 JSON 内容的 Item
 * 3: 带 Binary 内容的 Item
 * 4: 带 String 内容的 Item
 * 5: 带 Embed 富文本内容的 Item
 * 6: 带 Format 富文本标记的 Item
 * 7: 带嵌套 Type 的 Item
 */

import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as map from 'lib0/map'
import * as math from 'lib0/math'
import * as array from 'lib0/array'

import { getStateVector, StructStore } from './StructStore.js'
import { getItemCleanStart, getItemCleanEnd } from './transaction-helpers.js'
import { createIdSet, IdRange, readAndApplyDeleteSet, readIdSet, mergeIdSets, writeIdSet } from './ids.js'
import { createID, ID } from './ID.js'
import { UpdateDecoderV1, UpdateDecoderV2, IdSetDecoderV1 } from './UpdateDecoder.js'
import { UpdateEncoderV1, UpdateEncoderV2, IdSetEncoderV1, IdSetEncoderV2 } from './UpdateEncoder.js'
import { convertUpdateFormatV2ToV1, LazyStructReader, LazyStructWriter, writeStructToLazyStructWriter, finishLazyStructWriting } from './updates.js'
import { readBlockSet, writeBlockSet } from './BlockSet.js'
import { Skip } from '../structs/Skip.js'
import { Item } from '../structs/Item.js'
import { GC } from '../structs/GC.js'
import { Doc } from './Doc.js'
import { writeStructs } from './encoding-helpers.js'

/**
 * 按目标状态向量写出文档中对端尚未知的结构。
 *
 * 先过滤没有新增结构的客户端，再补入目标向量未提及的本地客户端；客户端按 ID
 * 降序写出。每个范围从目标 `nextClock` 开始，到本地连续末钟结束。
 *
 * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
 * @param {StructStore} store
 * @param {Map<number,number>} _sm
 *
 * @private
 * @function
 */
export const writeClientsStructs = (encoder, store, _sm) => {
  // 只保留本地确有新结构的目标向量条目。
  const sm = new Map()
  _sm.forEach((clock, client) => {
    // 本地 nextClock 更大才存在可发送后缀。
    if (store.getClock(client) > clock) {
      sm.set(client, clock)
    }
  })
  getStateVector(store).forEach((_clock, client) => {
    if (!_sm.has(client)) {
      sm.set(client, 0)
    }
  })
  // 写入携带结构的客户端数量。
  encoding.writeVarUint(encoder.restEncoder, sm.size)
  // 高 client ID 优先，降低接收侧并发位置解析成本。
  array.from(sm.entries()).sort((a, b) => b[0] - a[0]).forEach(([client, clock]) => {
    const structs = /** @type {Array<GC|Item>} */ (store.clients.get(client))
    const lastStruct = structs[structs.length - 1]
    writeStructs(encoder, structs, client, [new IdRange(clock, lastStruct.id.clock + lastStruct.length - clock)])
  })
}

/**
 * 按因果依赖把解码结构集成进存储，并返回仍不可应用的 V2 更新。
 *
 * 调度顺序：优先处理依赖栈顶，否则消费当前客户端下一结构，再切到下一客户端。
 * 当结构依赖另一客户端时，先压栈当前结构并切去依赖客户端；找到无缺失依赖的
 * 结构后再逐层退栈。
 *
 * 同一依赖链不会再次进入已在栈中的客户端；检测到缺失数据、自依赖或客户端环时，
 * 把该链及其剩余结构重新编码到 `pendingStructs`，并记录每个客户端最早缺失时钟。
 * 因此新更新到达后可以从精确边界恢复，而不重复集成已成功部分。
 *
 * @param {Transaction} transaction
 * @param {StructStore} store
 * @param {BlockSet} clientsStructRefs
 * @return { null | { update: Uint8Array<ArrayBuffer>, missing: Map<number,number> } }
 *
 * @private
 * @function
 */
const integrateStructs = (transaction, store, clientsStructRefs) => {
  /**
   * @type {Array<Item | GC | Skip>}
   */
  const stack = []
  // 从较高 client ID 开始；并发仲裁通常可减少较低 ID 结构的冲突扫描。
  let clientsStructRefsIds = array.from(clientsStructRefs.clients.keys()).sort((a, b) => a - b)
  if (clientsStructRefsIds.length === 0) {
    return null
  }
  /** 返回下一个仍有未消费结构的客户端范围，并移除耗尽范围。 */
  const getNextStructTarget = () => {
    if (clientsStructRefsIds.length === 0) {
      return null
    }
    let nextStructsTarget = /** @type {{i:number,refs:Array<GC|Item>}} */ (clientsStructRefs.clients.get(clientsStructRefsIds[clientsStructRefsIds.length - 1]))
    while (nextStructsTarget.refs.length === nextStructsTarget.i) {
      clientsStructRefsIds.pop()
      if (clientsStructRefsIds.length > 0) {
        nextStructsTarget = /** @type {{i:number,refs:Array<GC|Item>}} */ (clientsStructRefs.clients.get(clientsStructRefsIds[clientsStructRefsIds.length - 1]))
      } else {
        return null
      }
    }
    return nextStructsTarget
  }
  let curStructsTarget = getNextStructTarget()
  if (curStructsTarget === null) {
    return null
  }

  /**
   * 保存本轮仍无法集成的结构；最终会重新编码为 V2 pending 更新。
   *
   * @type {StructStore}
   */
  const restStructs = new StructStore()
  const missingSV = new Map()
  /**
   * 记录指定客户端最早缺失的时钟，避免后出现的较大时钟覆盖恢复下界。
   *
   * @param {number} client
   * @param {number} clock
   */
  const updateMissingSv = (client, clock) => {
    const mclock = missingSV.get(client)
    if (mclock == null || mclock > clock) {
      missingSV.set(client, clock)
    }
  }
  /**
   * @type {GC|Item|Skip}
   */
  let stackHead = /** @type {any} */ (curStructsTarget).refs[/** @type {any} */ (curStructsTarget).i++]
  // 缓存每个客户端集成进度，避免热循环反复扫描 StructStore 尾端。
  const state = new Map()

  // 以下插入集缓存方案尚未启用。
  // const currentInsertSet = createIdSet()
  // clientsStructRefsIds.forEach(clientId => {
  //   currentInsertSet.clients.set(clientid, new IdRanges(_createInsertSliceFromStructs(store.clients.get(clientId) ?? [], false)))
  // })

  /**
   * 把当前依赖栈及对应客户端余量转移到待处理存储。
   *
   * 已预取但未应用的结构先回退游标；同一客户端随后整体移出活动集合，防止本轮
   * 再次消费。栈清空后调度器可继续集成不依赖它们的其他客户端。
   */
  const addStackToRestSS = () => {
    for (const item of stack) {
      const client = item.id.client
      const inapplicableItems = clientsStructRefs.clients.get(client)
      if (inapplicableItems) {
        // 回退此前预取但未能应用的结构。
        inapplicableItems.i--
        restStructs.clients.set(client, inapplicableItems.refs.slice(inapplicableItems.i))
        clientsStructRefs.clients.delete(client)
        inapplicableItems.i = 0
        inapplicableItems.refs = []
      } else {
        // 客户端范围已耗尽并清除，只需保留栈中这一项。
        restStructs.clients.set(client, [item])
      }
      // 从活动客户端列表移除，避免本轮重复应用。
      clientsStructRefsIds = clientsStructRefsIds.filter(c => c !== client)
    }
    stack.length = 0
  }

  // 持续消费活动范围，直到全部集成或转入 pending。
  while (true) {
    if (stackHead.constructor !== Skip) {
      const localClock = map.setIfUndefined(state, stackHead.id.client, () => store.getClock(stackHead.id.client))
      const offset = localClock - stackHead.id.clock
      const missing = getMissing(/** @type {any} */ (stackHead), transaction, store)
      if (missing !== null) {
        stack.push(stackHead)
        // 切换到可能提供缺失依赖的客户端范围。
        /**
         * @type {{ refs: Array<GC|Item|Skip>, i: number }}
         */
        const structRefs = clientsStructRefs.clients.get(/** @type {number} */ (missing)) || { refs: [], i: 0 }
        if (structRefs.refs.length === structRefs.i || missing === stackHead.id.client || stack.some(s => s.id.client === missing)) { // @todo 可优化重复客户端检测。
          // 当前更新无法提供依赖，保存整条依赖链等待后续更新。
          updateMissingSv(/** @type {number} */ (missing), store.getClock(missing))
          addStackToRestSS()
        } else {
          stackHead = structRefs.refs[structRefs.i++]
          continue
        }
      } else {
        // 依赖齐全；若本地连续前缀落后于结构首钟，先集成显式 Skip 保留空洞。
        if (offset < 0) {
          const skip = new Skip(createID(stackHead.id.client, localClock), -offset)
          skip.integrate(transaction, 0)
        }
        stackHead.integrate(transaction, 0)
        state.set(stackHead.id.client, math.max(stackHead.id.clock + stackHead.length, localClock))
      }
    }
    // 优先退栈，然后消费当前范围，最后切换客户端。
    if (stack.length > 0) {
      stackHead = /** @type {GC|Item} */ (stack.pop())
    } else if (curStructsTarget !== null && curStructsTarget.i < curStructsTarget.refs.length) {
      stackHead = /** @type {GC|Item} */ (curStructsTarget.refs[curStructsTarget.i++])
    } else {
      curStructsTarget = getNextStructTarget()
      if (curStructsTarget === null) {
        // 所有活动范围处理完毕。
        break
      } else {
        stackHead = /** @type {GC|Item} */ (curStructsTarget.refs[curStructsTarget.i++])
      }
    }
  }
  if (restStructs.clients.size > 0) {
    const encoder = new UpdateEncoderV2()
    writeClientsStructs(encoder, restStructs, new Map())
    // pending 更新只含结构；直接写零客户端删除集。
    encoding.writeVarUint(encoder.restEncoder, 0)
    return { missing: missingSV, update: encoder.toUint8Array() }
  }
  return null
}

/**
 * 从解码器读取并应用一个文档更新。
 *
 * 事务内先解码 BlockSet、排除本地已知且非 Skip 的区间，再按因果顺序集成结构；
 * 不可集成结构与删除分别合并进 `pendingStructs`/`pendingDs`。若本次更新补齐旧结构
 * 依赖，则清空旧槽并递归重试其 V2 更新。
 *
 * 更新固定先读结构段、后读删除集。`transaction.local=false` 保证观察者把它识别为
 * 远端变更。
 *
 * @param {decoding.Decoder} decoder
 * @param {Doc} ydoc
 * @param {any} [transactionOrigin] 写入事务来源并随 update 事件传出。
 * @param {UpdateDecoderV1 | UpdateDecoderV2} [structDecoder]
 *
 * @function
 */
export const readUpdateV2 = (decoder, ydoc, transactionOrigin, structDecoder = new UpdateDecoderV2(decoder)) =>
  ydoc.transact(transaction => {
    // 接收更新必须标记为非本地事务。
    transaction.local = false
    let retry = false
    const doc = transaction.doc
    const store = doc.store
    // let start = performance.now()
    const ss = readBlockSet(structDecoder)
    const knownState = createIdSet()
    ss.clients.forEach((_, client) => {
      const storeStructs = store.clients.get(client)
      if (storeStructs) {
        const last = storeStructs[storeStructs.length - 1]
        knownState.add(client, 0, last.id.clock + last.length)
        // Skip 不属于连续已知前缀，不能从接收更新中排除。
        store.skips.clients.get(client)?.getIds().forEach(idrange => {
          knownState.delete(client, idrange.clock, idrange.len)
        })
      }
    })
    // 已知真实结构不必重复集成，转换为 Skip 保留后续时钟位置。
    ss.exclude(knownState)
    // console.log('time to read structs: ', performance.now() - start) // @todo 删除调试代码。
    // start = performance.now()
    // console.log('time to merge: ', performance.now() - start) // @todo 删除调试代码。
    // start = performance.now()
    const restStructs = integrateStructs(transaction, store, ss)
    const pending = store.pendingStructs
    if (pending) {
      // 本次携带缺失客户端，或本地时钟已越过缺口时，旧 pending 值得重试。
      for (const [client, clock] of pending.missing) {
        if (ss.clients.has(client) || clock < store.getClock(client)) {
          retry = true
          break
        }
      }
      if (restStructs) {
        // 合并本次与历史 pending，并保留每客户端最早缺失时钟。
        for (const [client, clock] of restStructs.missing) {
          const mclock = pending.missing.get(client)
          if (mclock == null || mclock > clock) {
            pending.missing.set(client, clock)
          }
        }
        pending.update = mergeUpdatesV2([pending.update, restStructs.update])
      }
    } else {
      store.pendingStructs = restStructs
    }
    // console.log('time to integrate: ', performance.now() - start) // @todo 删除调试代码。
    // start = performance.now()
    const dsRest = readAndApplyDeleteSet(structDecoder, transaction, store)
    if (store.pendingDs) {
      // @todo 可像 pendingStructs 一样用状态向量下界判断是否值得重试。
      const pendingDSUpdate = new UpdateDecoderV2(decoding.createDecoder(store.pendingDs))
      decoding.readVarUint(pendingDSUpdate.restDecoder) // pendingDs 固定以零结构段开头。
      const dsRest2 = readAndApplyDeleteSet(pendingDSUpdate, transaction, store)
      if (dsRest && dsRest2) {
        // 两批仍有未应用删除，合并保存。
        store.pendingDs = mergeUpdatesV2([dsRest, dsRest2])
      } else {
        // 至多一批有余量；均完成时结果为 null。
        store.pendingDs = dsRest || dsRest2
      }
    } else {
      // 没有历史 pending，直接保存本批余量或 null。
      store.pendingDs = dsRest
    }
    // console.log('time to cleanup: ', performance.now() - start) // @todo 删除调试代码。
    // start = performance.now()

    // console.log('time to resume delete readers: ', performance.now() - start) // @todo 删除调试代码。
    // start = performance.now()
    if (retry) {
      const update = /** @type {{update: Uint8Array}} */ (store.pendingStructs).update
      store.pendingStructs = null
      applyUpdateV2(transaction.doc, update)
    }
  }, transactionOrigin, false)

/**
 * 使用 V1 结构解码器读取并应用更新。
 *
 * 这是 `readUpdateV2()` 的线格式兼容薄包装。
 *
 * @param {decoding.Decoder} decoder
 * @param {Doc} ydoc
 * @param {any} [transactionOrigin] 写入事务来源并随 update 事件传出。
 *
 * @function
 */
export const readUpdate = (decoder, ydoc, transactionOrigin) => readUpdateV2(decoder, ydoc, transactionOrigin, new UpdateDecoderV1(decoder))

/**
 * 从字节数组应用 V2 更新。
 *
 * 该入口只负责创建基础解码器与选定结构解码器；事务、pending 与删除处理委托给
 * `readUpdateV2()`。
 *
 * @param {Doc} ydoc
 * @param {Uint8Array} update
 * @param {any} [transactionOrigin] 写入事务来源并随 update 事件传出。
 * @param {typeof UpdateDecoderV1 | typeof UpdateDecoderV2} [YDecoder]
 *
 * @function
 */
export const applyUpdateV2 = (ydoc, update, transactionOrigin, YDecoder = UpdateDecoderV2) => {
  const decoder = decoding.createDecoder(update)
  readUpdateV2(decoder, ydoc, transactionOrigin, new YDecoder(decoder))
}

/**
 * 从字节数组应用 V1 更新。
 *
 * 这是 `applyUpdateV2()` 选择 `UpdateDecoderV1` 的兼容薄包装。
 *
 * @param {Doc} ydoc
 * @param {Uint8Array} update
 * @param {any} [transactionOrigin] 写入事务来源并随 update 事件传出。
 *
 * @function
 */
export const applyUpdate = (ydoc, update, transactionOrigin) => applyUpdateV2(ydoc, update, transactionOrigin, UpdateDecoderV1)

/**
 * 把文档相对目标状态向量缺失的结构与完整删除集写成更新。
 *
 * 状态向量只裁剪结构前缀；删除集始终完整发送，因为目标可能缺少任意历史墓碑。
 *
 * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
 * @param {Doc} doc
 * @param {Map<number,number>} [targetStateVector] 接收方每客户端的下一期望时钟；空映射表示发送全部结构。
 *
 * @function
 */
export const writeStateAsUpdate = (encoder, doc, targetStateVector = new Map()) => {
  writeClientsStructs(encoder, doc.store, targetStateVector)
  writeIdSet(encoder, doc.store.ds)
}

/**
 * 编码一个可直接应用的 V2 文档差分更新。
 *
 * 除当前存储外，还纳入未应用删除与因果 pending 结构；后者先按目标状态向量做差。
 * 多段结果按实际编码器版本合并，确保 V1 调用方不会混入 V2 pending 字节。
 *
 * @param {Doc} doc
 * @param {Uint8Array} [encodedTargetStateVector] 接收方编码状态向量；默认空向量。
 * @param {UpdateEncoderV1 | UpdateEncoderV2} [encoder]
 * @return {Uint8Array<ArrayBuffer>}
 *
 * @function
 */
export const encodeStateAsUpdateV2 = (doc, encodedTargetStateVector = new Uint8Array([0]), encoder = new UpdateEncoderV2()) => {
  const targetStateVector = decodeStateVector(encodedTargetStateVector)
  writeStateAsUpdate(encoder, doc, targetStateVector)
  const updates = [encoder.toUint8Array()]
  // pending 数据也是文档已知状态的一部分，快照不能遗漏。
  if (doc.store.pendingDs) {
    updates.push(doc.store.pendingDs)
  }
  if (doc.store.pendingStructs) {
    updates.push(diffUpdateV2(doc.store.pendingStructs.update, encodedTargetStateVector))
  }
  if (updates.length > 1) {
    if (encoder.constructor === UpdateEncoderV1) {
      return mergeUpdates(updates.map((update, i) => i === 0 ? update : convertUpdateFormatV2ToV1(update)))
    } else if (encoder.constructor === UpdateEncoderV2) {
      return mergeUpdatesV2(updates)
    }
  }
  return updates[0]
}

/**
 * 编码一个可直接应用的 V1 文档差分更新。
 *
 * 这是 `encodeStateAsUpdateV2()` 选择 V1 编码器的兼容薄包装。
 *
 * @param {Doc} doc
 * @param {Uint8Array} [encodedTargetStateVector] 接收方编码状态向量。
 * @return {Uint8Array<ArrayBuffer>}
 *
 * @function
 */
export const encodeStateAsUpdate = (doc, encodedTargetStateVector) => encodeStateAsUpdateV2(doc, encodedTargetStateVector, new UpdateEncoderV1())

/**
 * 从解码器读取状态向量 `client → nextClock`。
 *
 * 状态向量只描述每客户端连续已知前缀，不表达删除或内部空洞。
 *
 * @param {IdSetDecoderV1 | IdSetDecoderV2} decoder
 * @return {Map<number,number>} 客户端到下一期望时钟的映射。
 *
 * @function
 */
export const readStateVector = decoder => {
  const ss = new Map()
  const ssLength = decoding.readVarUint(decoder.restDecoder)
  for (let i = 0; i < ssLength; i++) {
    const client = decoding.readVarUint(decoder.restDecoder)
    const clock = decoding.readVarUint(decoder.restDecoder)
    ss.set(client, clock)
  }
  return ss
}

/**
 * 不创建 Doc，直接合并多份更新的结构段与删除集。
 *
 * BlockSet 合并会过滤重复、裁剪重叠并保留 Skip；删除集做区间并集。空输入编码空
 * Doc，单输入原样返回，避免无意义解码重编码。
 *
 * @param {Array<Uint8Array<ArrayBuffer>>} updates
 * @param {typeof UpdateDecoderV1 | typeof UpdateDecoderV2} [YDecoder]
 * @param {typeof UpdateEncoderV1 | typeof UpdateEncoderV2} [YEncoder]
 * @return {Uint8Array<ArrayBuffer>}
 */
export const mergeUpdatesV2 = (updates, YDecoder = UpdateDecoderV2, YEncoder = UpdateEncoderV2) => {
  if (updates.length === 1) {
    return updates[0]
  } else if (updates.length === 0) {
    return encodeStateAsUpdateV2(new Doc(), new Uint8Array([0]), new YEncoder())
  }
  const updateDecoders = updates.map(update => new YDecoder(decoding.createDecoder(update)))
  const blocksets = updateDecoders.map(dec => readBlockSet(dec))

  const mergedBlockset = blocksets[0]
  for (let i = 1; i < blocksets.length; i++) {
    mergedBlockset.insertInto(blocksets[i])
  }
  const updateEncoder = new YEncoder()
  writeBlockSet(updateEncoder, mergedBlockset)
  const dss = updateDecoders.map(decoder => readIdSet(decoder))
  const ds = mergeIdSets(dss)
  writeIdSet(updateEncoder, ds)
  return updateEncoder.toUint8Array()
}

/**
 * 合并多份 V1 更新；委托通用合并器选择 V1 编解码器。
 *
 * @param {Array<Uint8Array<ArrayBuffer>>} updates
 * @return {Uint8Array<ArrayBuffer>}
 */
export const mergeUpdates = updates => mergeUpdatesV2(updates, UpdateDecoderV1, UpdateEncoderV1)

/**
 * 按目标状态向量从已有更新中裁出结构后缀。
 *
 * 每个客户端跳过 `endClock <= svClock` 的结构；首个部分重叠结构按 offset 裁剪，
 * 随后写完同客户端余量。删除集不受状态向量过滤并完整保留。
 *
 * @deprecated
 * @param {Uint8Array} update
 * @param {Uint8Array} sv
 * @param {typeof UpdateDecoderV1 | typeof UpdateDecoderV2} [YDecoder]
 * @param {typeof UpdateEncoderV1 | typeof UpdateEncoderV2} [YEncoder]
 */
export const diffUpdateV2 = (update, sv, YDecoder = UpdateDecoderV2, YEncoder = UpdateEncoderV2) => {
  const state = decodeStateVector(sv)
  const encoder = new YEncoder()
  const lazyStructWriter = new LazyStructWriter(encoder)
  const decoder = new YDecoder(decoding.createDecoder(update))
  const reader = new LazyStructReader(decoder, false)
  while (reader.curr) {
    const curr = reader.curr
    const currClient = curr.id.client
    const svClock = state.get(currClient) || 0
    if (reader.curr.constructor === Skip) {
      // 每客户端输出不能以 Skip 开头；起始时钟已在头部表达。
      reader.next()
      continue
    }
    if (curr.id.clock + curr.length > svClock) {
      writeStructToLazyStructWriter(lazyStructWriter, curr, math.max(svClock - curr.id.clock, 0), 0)
      reader.next()
      while (reader.curr && reader.curr.id.client === currClient) {
        writeStructToLazyStructWriter(lazyStructWriter, reader.curr, 0, 0)
        reader.next()
      }
    } else {
      // 快进到首个超出目标连续前缀的结构。
      while (reader.curr && reader.curr.id.client === currClient && reader.curr.id.clock + reader.curr.length <= svClock) {
        reader.next()
      }
    }
  }
  finishLazyStructWriting(lazyStructWriter)
  // 状态向量不证明目标已知删除，故完整保留删除集。
  const ds = readIdSet(decoder)
  writeIdSet(encoder, ds)
  return encoder.toUint8Array()
}

/**
 * 按状态向量裁剪 V1 更新。
 *
 * @deprecated
 * @todo 用内容 ID 交集更新接口替代。
 *
 * @param {Uint8Array<ArrayBuffer>} update
 * @param {Uint8Array<ArrayBuffer>} sv
 */
export const diffUpdate = (update, sv) => diffUpdateV2(update, sv, UpdateDecoderV1, UpdateEncoderV1)

/**
 * 从 V1 编码字节读取状态向量。
 *
 * @param {Uint8Array} decodedState
 * @return {Map<number,number>} 客户端到下一期望时钟的映射。
 *
 * @function
 */
// export const decodeStateVectorV2 = decodedState => readStateVector(new DSDecoderV2(decoding.createDecoder(decodedState)))

/**
 * 从 V1 编码字节读取状态向量。
 *
 * @param {Uint8Array} decodedState
 * @return {Map<number,number>} 客户端到下一期望时钟的映射。
 *
 * @function
 */
export const decodeStateVector = decodedState => readStateVector(new IdSetDecoderV1(decoding.createDecoder(decodedState)))

/**
 * 按 client ID 降序写出状态向量。
 *
 * 确定性顺序保证同一状态生成稳定字节；该格式使用绝对 client 与 clock，不依赖
 * V2 ID 集差分列。
 *
 * @param {IdSetEncoderV1 | IdSetEncoderV2} encoder
 * @param {Map<number,number>} sv
 * @function
 */
export const writeStateVector = (encoder, sv) => {
  encoding.writeVarUint(encoder.restEncoder, sv.size)
  array.from(sv.entries()).sort((a, b) => b[0] - a[0]).forEach(([client, clock]) => {
    encoding.writeVarUint(encoder.restEncoder, client) // @todo 可增加基于映射的专用 client 编解码器。
    encoding.writeVarUint(encoder.restEncoder, clock)
  })
  return encoder
}

/**
 * 计算文档存储的连续状态向量并写入编码器。
 *
 * @param {IdSetEncoderV1 | IdSetEncoderV2} encoder
 * @param {Doc} doc
 *
 * @function
 */
export const writeDocumentStateVector = (encoder, doc) => writeStateVector(encoder, getStateVector(doc.store))

/**
 * 把 Doc 或状态向量 Map 编码为 V2 ID 集格式字节。
 *
 * @param {Doc|Map<number,number>} doc
 * @param {IdSetEncoderV1 | IdSetEncoderV2} [encoder]
 * @return {Uint8Array<ArrayBuffer>}
 *
 * @function
 */
export const encodeStateVectorV2 = (doc, encoder = new IdSetEncoderV2()) => {
  if (doc instanceof Map) {
    writeStateVector(encoder, doc)
  } else {
    writeDocumentStateVector(encoder, doc)
  }
  return encoder.toUint8Array()
}

/**
 * 把 Doc 或状态向量 Map 编码为 V1 状态向量字节。
 *
 * @param {Doc|Map<number,number>} doc
 * @return {Uint8Array<ArrayBuffer>}
 *
 * @function
 */
export const encodeStateVector = doc => encodeStateVectorV2(doc, new IdSetEncoderV1())

/**
 * 检查 Item 的因果依赖并解析当前左右邻与父类型。
 *
 * 若 origin、rightOrigin 或父 Item 超出本地连续时钟（或落在 Skip），返回缺失
 * 依赖的 client ID，且不得继续访问可能在解析中被替换的原字段。依赖齐全时按
 * 精确边界取得邻居：若邻居/父已 GC，则把 parent 置空；否则从邻居、父 Item 或
 * 顶层键恢复真实 YType。
 *
 * @param {Item} struct
 * @param {Transaction} transaction
 * @param {StructStore} store
 * @return {null | number}
 */
const getMissing = (struct, transaction, store) => {
  if (struct.constructor !== Item) return null
  // 先缓存解码态字段；后续解析会原位改写 struct，不能再混用旧值。
  const origin = struct.origin
  const rightOrigin = struct.rightOrigin
  const parent = struct.parent
  if (origin && (origin.clock >= store.getClock(origin.client) || store.skips.hasId(origin))) {
    return origin.client
  }
  if (rightOrigin && (rightOrigin.clock >= store.getClock(rightOrigin.client) || store.skips.hasId(rightOrigin))) {
    return rightOrigin.client
  }
  if (parent && parent.constructor === ID && (parent.clock >= store.getClock(parent.client) || store.skips.hasId(parent))) {
    return parent.client
  }
  // 所有 ID 均存在，现在可安全切分边界并解析对象引用。
  if (origin) {
    struct.left = getItemCleanEnd(transaction, store, origin)
    // 改用规范化后的左段末 ID，使原始锚点对象可释放。
    struct.origin = struct.left.lastId
  }
  if (rightOrigin) {
    struct.right = getItemCleanStart(transaction, rightOrigin)
    struct.rightOrigin = struct.right.id
  }
  if ((struct.left && struct.left.constructor === GC) || (struct.right && struct.right.constructor === GC)) {
    struct.parent = null
  } else if (parent == null) {
    // 无显式父引用时从可用邻居继承；两侧都不可用则保持 null 并转为 GC。
    if (struct.left && struct.left.constructor === Item) {
      struct.parent = struct.left.parent
      struct.parentSub = struct.left.parentSub
    } else if (struct.right && struct.right.constructor === Item) {
      struct.parent = struct.right.parent
      struct.parentSub = struct.right.parentSub
    }
  } else if (parent.constructor === ID) {
    const parentItem = store.getItem(parent)
    if (parentItem.constructor === GC) {
      struct.parent = null
    } else {
      struct.parent = /** @type {ContentType} */ (parentItem.content).type
    }
  } else if (typeof parent === 'string') {
    struct.parent = transaction.doc.get(parent)
  }
  return null
}

/**
 * 从 V1 更新创建并填充新文档。
 *
 * @param {Uint8Array} update
 * @param {import('./Doc.js').DocOpts} opts
 */
export const createDocFromUpdate = (update, opts = {}) => {
  const ydoc = new Doc(opts)
  applyUpdate(ydoc, update)
  return ydoc
}

/**
 * 从 V2 更新创建并填充新文档。
 *
 * @param {Uint8Array} update
 * @param {import('./Doc.js').DocOpts} opts
 */
export const createDocFromUpdateV2 = (update, opts = {}) => {
  const ydoc = new Doc(opts)
  applyUpdateV2(ydoc, update)
  return ydoc
}

/**
 * 通过 V1 全量更新复制文档可同步状态。
 *
 * 新 Doc 使用传入选项；监听器、Undo 历史等本地运行时状态不会复制。
 *
 * @param {Doc} ydoc
 * @param {import('./Doc.js').DocOpts} [opts]
 */
export const cloneDoc = (ydoc, opts) => {
  const clone = new Doc(opts)
  applyUpdate(clone, encodeStateAsUpdate(ydoc))
  return clone
}
