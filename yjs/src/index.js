/// <reference types="../global.d.ts" />
/** eslint-env browser */

// 导出顺序必须与内部依赖方向一致，避免模块初始化阶段触发循环依赖。

export { IdSet, equalIdSets, createDeleteSetFromStructStore, createInsertSetFromStructStore, diffIdSet, createIdSet, mergeIdSets, insertIntoIdSet, iterateStructsByIdSet, gcIdSet, readIdSet, writeIdSet, encodeIdSet, decodeIdSet, IdMap, createIdMap, createContentAttribute, ContentAttribute, diffIdMap, encodeIdMap, createIdMapFromIdSet, createIdSetFromIdMap, insertIntoIdMap, mergeIdMaps, readIdMap, writeIdMap, decodeIdMap, filterIdMap, intersectSets, intersectMaps } from './utils/ids.js'
export { Doc } from './utils/Doc.js'
export { UpdateDecoderV1, UpdateDecoderV2 } from './utils/UpdateDecoder.js'
export { UpdateEncoderV1, UpdateEncoderV2 } from './utils/UpdateEncoder.js'
export { applyUpdate, applyUpdateV2, readUpdate, readUpdateV2, encodeStateAsUpdate, encodeStateAsUpdateV2, encodeStateVector, decodeStateVector, diffUpdate, diffUpdateV2, mergeUpdates, mergeUpdatesV2, createDocFromUpdate, createDocFromUpdateV2, cloneDoc } from './utils/encoding.js'
export { ID, createID, compareIDs, findRootTypeKey } from './utils/ID.js'
export { isParentOf } from './utils/isParentOf.js'
export { logType } from './utils/logging.js'
export { createRelativePositionFromTypeIndex, createRelativePositionFromJSON, createAbsolutePositionFromRelativePosition, compareRelativePositions, AbsolutePosition, RelativePosition, relativePositionToJSON, encodeRelativePosition, decodeRelativePosition } from './utils/RelativePosition.js'
export { Snapshot, createSnapshot, snapshot, emptySnapshot, createDocFromSnapshot, decodeSnapshot, encodeSnapshot, decodeSnapshotV2, encodeSnapshotV2, equalSnapshots, snapshotContainsUpdate } from './utils/Snapshot.js'
export { findIndexSS, getItemCleanStart, getItemCleanEnd, tryGc } from './utils/transaction-helpers.js'
export { Transaction, transact, cleanupYTextFormatting } from './utils/Transaction.js'
export { UndoManager, undoContentIds } from './utils/UndoManager.js'
export { logUpdate, logUpdateV2, decodeUpdate, decodeUpdateV2, encodeStateVectorFromUpdate, encodeStateVectorFromUpdateV2, convertUpdateFormatV1ToV2, convertUpdateFormatV2ToV1, obfuscateUpdate, obfuscateUpdateV2, createContentIdsFromUpdate, createContentIdsFromUpdateV2, intersectUpdateWithContentIds, intersectUpdateWithContentIdsV2 } from './utils/updates.js'
export { YEvent, getPathTo } from './utils/YEvent.js'
export { AttributionsRenderer, createAttributionsRenderer, AbstractRenderer, createDiffRenderer, DiffRenderer, createSnapshotRenderer, SnapshotRenderer, $renderer } from './utils/Renderer.js'
export { diffDocsToDelta } from './utils/delta-helpers.js'
export { YType as Type, getTypeChildren, typeMapGetSnapshot, typeMapGetAllSnapshot, $ytype, $ytypeAny } from './ytype.js'
export { AbstractStruct } from './structs/AbstractStruct.js'
export { GC } from './structs/GC.js'
export { Item, ContentBinary, ContentDeleted, ContentDoc, ContentEmbed, ContentFormat, ContentJSON, ContentAny, ContentString, ContentType } from './structs/Item.js'
export { Skip } from './structs/Skip.js'

export * from './utils/meta.js'

/**
 * @typedef {import('./utils/ids.js').ContentIds} ContentIds
 */
/**
 * @typedef {import('./utils/ids.js').ContentMap} ContentMap
 */

/** 统一取得当前运行时的全局对象，用于跨浏览器与 Node.js 检测重复加载。 */
const glo = /** @type {any} */ (typeof globalThis !== 'undefined'
  ? globalThis
  : typeof window !== 'undefined'
    ? window
    // @ts-ignore
    : typeof global !== 'undefined' ? global : {})

/** Yjs 14 在全局对象上登记的版本级哨兵键。 */
const importIdentifier = '__ $YJS14$ __'

if (glo[importIdentifier] === true) {
  /**
   * 同一 JavaScript 运行时只能加载一份 Yjs 14 实例。
   *
   * 包管理器可能为不同依赖安装多份 Yjs，也可能让 CommonJS 与 ESM 构建同时进入应用。
   * 这些副本拥有不同的构造器身份。
   *
   * 内部会执行 `struct instanceof GC` 一类构造器检查；跨副本对象无法通过检查，进而可能
   * 破坏 CRDT 集成分派。此处只报告错误并写入哨兵，不中止模块初始化。
   *
   * https://github.com/yjs/yjs/issues/438
   */
  console.error('Yjs was already imported. This breaks constructor checks and will lead to issues! - https://github.com/yjs/yjs/issues/438')
}
glo[importIdentifier] = true
