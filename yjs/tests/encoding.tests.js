import * as t from 'lib0/testing'

import {
  contentRefs,
  readContentDeleted,
  readContentBinary,
  readContentString,
  readContentJSON,
  readContentEmbed,
  readContentType,
  readContentFormat,
  readContentAny,
  readContentDoc
} from '../src/ytype.js'

import * as Y from '../src/index.js'

/**
 * Given：更新协议预留 0..10 共 11 个内容引用槽。
 * When：读取 `contentRefs` 的稳定编号映射。
 * Then：1..9 分别指向对应内容解码器，10 保留给 Skip。
 *
 * 验证机制：逐项比较函数引用，证明 `Item.write()` 的低五位编号能由接收端按同一
 * 协议分派，而不只是数组长度偶然正确。
 *
 * @param {t.TestCase} _tc
 */
export const testStructReferences = _tc => {
  t.assert(contentRefs.length === 11)
  t.assert(contentRefs[1] === readContentDeleted)
  t.assert(contentRefs[2] === readContentJSON) // TODO：评估废弃旧 ContentJSON 格式。
  t.assert(contentRefs[3] === readContentBinary)
  t.assert(contentRefs[4] === readContentString)
  t.assert(contentRefs[5] === readContentEmbed)
  t.assert(contentRefs[6] === readContentFormat)
  t.assert(contentRefs[7] === readContentType)
  t.assert(contentRefs[8] === readContentAny)
  t.assert(contentRefs[9] === readContentDoc)
  // contentRefs[10] 为 Skip 结构保留。
}

/**
 * Given：单条更新从时钟 1 开始，缺少同客户端时钟 0 的前缀。
 * When：从该更新推导状态向量。
 * Then：得到空向量，而非错误宣称已连续掌握到时钟 2。
 *
 * 验证机制：断言编码仅含零客户端计数字节；覆盖 yjs/yjs#308 的非零起点分支。
 *
 * @param {t.TestCase} _tc
 */
export const testDiffStateVectorOfUpdateIsEmpty = _tc => {
  const ydoc = new Y.Doc()
  /**
   * @type {any}
   */
  let sv = null
  ydoc.get().insert(0, 'a')
  ydoc.on('update', update => {
    sv = Y.encodeStateVectorFromUpdate(update)
  })
  // 前置操作缺失，因此不能形成任何连续状态向量条目。
  ydoc.get().insert(0, 'a')
  t.assert(sv !== null && sv.byteLength === 1 && sv[0] === 0)
}

/**
 * Given：合并同客户端第 1 与第 3 条更新，中间形成 Skip。
 * When：从合并更新推导状态向量。
 * Then：该客户端 nextClock 只能为 1，不能越过缺口。
 *
 * 验证机制：同时断言时钟值与客户端数量，证明 `encodeStateVectorFromUpdateV2()`
 * 遇到 Skip 后停止扩展连续前缀；覆盖 yjs/yjs#308。
 *
 * @param {t.TestCase} _tc
 */
export const testDiffStateVectorOfUpdateIgnoresSkips = _tc => {
  const ydoc = new Y.Doc()
  /**
   * @type {Array<Uint8Array<ArrayBuffer>>}
   */
  const updates = []
  ydoc.on('update', update => {
    updates.push(update)
  })
  ydoc.get().insert(0, 'a')
  ydoc.get().insert(0, 'b')
  ydoc.get().insert(0, 'c')
  const update13 = Y.mergeUpdates([updates[0], updates[2]])
  const sv = Y.encodeStateVectorFromUpdate(update13)
  const state = Y.decodeStateVector(sv)
  t.assert(state.get(ydoc.clientID) === 1)
  t.assert(state.size === 1)
}
