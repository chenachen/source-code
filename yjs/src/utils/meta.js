/** 用 ID 集合及其属性映射描述 Yjs 文档内容，供差异、渲染与归因流程复用。 */

import * as decoding from 'lib0/decoding'

import {
  createIdSetFromIdMap,
  createDeleteSetFromStructStore,
  createInsertSetFromStructStore,
  diffIdMap,
  mergeIdMaps,
  createIdSet,
  createIdMap,
  mergeIdSets,
  diffIdSet,
  createIdMapFromIdSet,
  writeIdSet,
  readIdSet,
  writeIdMap,
  readIdMap,
  intersectMaps,
  intersectSets,
  filterIdMap
} from './ids.js'
import { IdSetEncoderV2 } from './UpdateEncoder.js'
import { IdSetDecoderV2 } from './UpdateDecoder.js'

/**
 * 组合插入 ID 集与删除 ID 集，形成不携带属性的内容描述。
 *
 * @param {IdSet} inserts 文档已插入的结构区间。
 * @param {IdSet} deletes 文档已删除的结构区间。
 * @return {ContentIds} 保留两个集合所有权的内容描述。
 */
export const createContentIds = (inserts = createIdSet(), deletes = createIdSet()) => ({ inserts, deletes })

/**
 * 丢弃内容映射中的属性，只保留插入与删除 ID 范围。
 *
 * @param {ContentMap} contentMap 带属性的内容映射。
 */
export const createContentIdsFromContentMap = contentMap => createContentIds(
  createIdSetFromIdMap(contentMap.inserts),
  createIdSetFromIdMap(contentMap.deletes)
)

/**
 * 从文档结构存储构造插入与删除 ID 集。
 *
 * @param {import('./Doc.js').Doc} ydoc 要描述的文档。
 * @param {boolean} insertsContainDeletes 返回的 `inserts` 是否包含已被文档删除的内容；
 * `true` 形成含全部已插入 ID 的结构快照，`false` 只保留当前可见内容
 *（`inserts - deletes`），适合定义渲染范围。
 */
export const createContentIdsFromDoc = (ydoc, insertsContainDeletes) => createContentIds(
  createInsertSetFromStructStore(ydoc.store, !insertsContainDeletes),
  createDeleteSetFromStructStore(ydoc.store)
)

/**
 * 计算后一个文档相对前一个文档新增的插入与删除事实。
 *
 * @param {import('./Doc.js').Doc} ydocPrev 基准文档。
 * @param {import('./Doc.js').Doc} ydocNext 目标文档。
 */
export const createContentIdsFromDocDiff = (ydocPrev, ydocNext) =>
  excludeContentIds(createContentIdsFromDoc(ydocPrev, true), createContentIdsFromDoc(ydocNext, true))

/**
 * 从内容 ID 描述中分别扣除另一描述的插入集与删除集。
 *
 * @param {ContentIds} content 被筛选的内容描述。
 * @param {ContentIds} excludeContent 要排除的 ID 范围。
 */
export const excludeContentIds = (content, excludeContent) =>
  createContentIds(diffIdSet(content.inserts, excludeContent.inserts), diffIdSet(content.deletes, excludeContent.deletes))

/**
 * 从内容映射中分别扣除另一描述覆盖的插入与删除范围，并保留剩余属性。
 *
 * @param {ContentMap} content 被筛选的属性映射。
 * @param {ContentIds | ContentMap} excludeContent 要排除的 ID 范围或属性映射。
 */
export const excludeContentMap = (content, excludeContent) => createContentMap(
  diffIdMap(content.inserts, excludeContent.inserts),
  diffIdMap(content.deletes, excludeContent.deletes)
)

/**
 * 合并多份内容映射；同一 ID 上的属性由底层 `mergeIdMaps` 统一归并。
 *
 * @param {Array<ContentMap>} contents 待合并的内容映射。
 */
export const mergeContentMaps = contents => createContentMap(
  mergeIdMaps(contents.map(c => c.inserts)),
  mergeIdMaps(contents.map(c => c.deletes))
)

/**
 * 合并多份内容 ID 描述的插入集与删除集。
 *
 * @param {Array<ContentIds>} contents 待合并的内容描述。
 */
export const mergeContentIds = contents => createContentIds(
  mergeIdSets(contents.map(c => c.inserts)),
  mergeIdSets(contents.map(c => c.deletes))
)

/**
 * 组合插入属性映射与删除属性映射，形成带元数据的内容描述。
 *
 * @param {IdMap<any>} [inserts] 按插入 ID 索引的属性。
 * @param {IdMap<any>} [deletes] 按删除 ID 索引的属性。
 * @return {ContentMap} 保留两个映射所有权的内容描述。
 */
export const createContentMap = (inserts = createIdMap(), deletes = createIdMap()) => ({ inserts, deletes })

/**
 * 为内容 ID 描述的每个范围附加插入与删除属性。
 *
 * @param {ContentIds} contentIds 要附加属性的内容范围。
 * @param {Array<ContentAttribute<any>>} insertAttrs 插入范围共享的属性列表。
 * @param {Array<ContentAttribute<any>>} [deleteAttrs] 删除范围共享的属性列表；默认复用插入属性。
 */
export const createContentMapFromContentIds = (contentIds, insertAttrs, deleteAttrs = insertAttrs) => createContentMap(
  createIdMapFromIdSet(contentIds.inserts, insertAttrs),
  createIdMapFromIdSet(contentIds.deletes, deleteAttrs)
)

/**
 * 按“插入集、删除集”顺序写入内容 ID，读取端必须保持相同顺序。
 *
 * @param {import('./UpdateEncoder.js').IdSetEncoder} encoder 目标 ID 集编码器。
 * @param {ContentIds} contentIds 要写入的内容范围。
 */
export const writeContentIds = (encoder, contentIds) => {
  writeIdSet(encoder, contentIds.inserts)
  writeIdSet(encoder, contentIds.deletes)
}

/**
 * 使用 V2 ID 集编码器把内容 ID 描述序列化为字节数组。
 *
 * @param {ContentIds} contentIds 要序列化的内容范围。
 */
export const encodeContentIds = contentIds => {
  const encoder = new IdSetEncoderV2()
  writeContentIds(encoder, contentIds)
  return encoder.toUint8Array()
}

/**
 * 按写入顺序读取插入集与删除集并重建内容 ID 描述。
 *
 * @todo 投入生产前仍需显著优化此编码格式。
 * @param {import('./UpdateDecoder.js').IdSetDecoder} decoder 已定位到内容描述起点的解码器。
 * @return {ContentIds} 解码出的插入与删除范围。
 */
export const readContentIds = decoder => createContentIds(
  readIdSet(decoder),
  readIdSet(decoder)
)

/**
 * 从 V2 编码字节中还原内容 ID 描述。
 *
 * @param {Uint8Array<any>} buf `encodeContentIds` 产生的字节数组。
 */
export const decodeContentIds = buf => readContentIds(new IdSetDecoderV2(decoding.createDecoder(buf)))

/**
 * 按“插入映射、删除映射”顺序写入带属性内容，读取端必须保持相同顺序。
 *
 * @todo 投入生产前仍需显著优化此编码格式。
 * @param {import('./UpdateEncoder.js').IdSetEncoder} encoder 目标 ID 映射编码器。
 * @param {ContentMap} contentMap 要写入的带属性内容。
 */
export const writeContentMap = (encoder, contentMap) => {
  writeIdMap(encoder, contentMap.inserts)
  writeIdMap(encoder, contentMap.deletes)
}

/**
 * 按写入顺序读取插入映射与删除映射并重建内容映射。
 *
 * @todo 投入生产前仍需显著优化此编码格式。
 * @param {import('./UpdateDecoder.js').IdSetDecoder} decoder 已定位到内容映射起点的解码器。
 * @return {ContentMap} 解码出的内容映射。
 */
export const readContentMap = (decoder) => createContentMap(
  readIdMap(decoder),
  readIdMap(decoder)
)

/**
 * 使用 V2 ID 集编码器把内容映射序列化为字节数组。
 *
 * @param {ContentMap} contentMap 要序列化的带属性内容。
 */
export const encodeContentMap = contentMap => {
  const encoder = new IdSetEncoderV2()
  writeContentMap(encoder, contentMap)
  return encoder.toUint8Array()
}

/**
 * 分别求两份内容描述在插入与删除范围上的交集，并保留 `mapA` 的属性切片。
 *
 * @param {ContentMap} mapA 提供返回属性的主映射。
 * @param {ContentMap|ContentIds} mapB 用来限定范围的内容描述。
 */
export const intersectContentMap = (mapA, mapB) => createContentMap(
  intersectMaps(mapA.inserts, mapB.inserts),
  intersectMaps(mapA.deletes, mapB.deletes)
)

/**
 * 分别求两份内容描述在插入与删除 ID 上的交集。
 *
 * @param {ContentIds} setA 主 ID 集。
 * @param {ContentIds|ContentMap} setB 用来限定范围的内容描述。
 */
export const intersectContentIds = (setA, setB) => createContentIds(
  intersectSets(setA.inserts, setB.inserts),
  intersectSets(setA.deletes, setB.deletes)
)

/**
 * 从 V2 编码字节中还原带属性的内容映射。
 *
 * @param {Uint8Array<any>} buf `encodeContentMap` 产生的字节数组。
 */
export const decodeContentMap = buf => readContentMap(new IdSetDecoderV2(decoding.createDecoder(buf)))

/**
 * 用独立谓词筛选插入与删除属性，只保留谓词接受的 ID 区间。
 *
 * @todo 后续改为按内容数组筛选，避免接口被两套属性谓词绑定。
 * @param {ContentMap} contentMap 被筛选的内容映射。
 * @param {(c:Array<ContentAttribute<any>>)=>boolean} insertPredicate 插入属性判定函数。
 * @param {(c:Array<ContentAttribute<any>>)=>boolean} deletePredicate 删除属性判定函数。
 */
export const filterContentMap = (contentMap, insertPredicate, deletePredicate) => createContentMap(filterIdMap(contentMap.inserts, insertPredicate), filterIdMap(contentMap.deletes, deletePredicate))
