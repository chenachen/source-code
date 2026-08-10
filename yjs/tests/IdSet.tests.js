import * as t from 'lib0/testing'
import * as Y from '../src/index.js'
import * as d from '../src/utils/ids.js'
import * as math from 'lib0/math'
import * as prng from 'lib0/prng'
import { compareIdSets, createRandomIdSet, ID } from './testHelper.js'

/**
 * 用紧凑三元组 fixture 构造 IdSet。
 *
 * @param {Array<[number, number, number]>} ops
 */
const simpleConstructIdSet = ops => {
  const idset = d.createIdSet()
  ops.forEach(op => {
    idset.add(op[0], op[1], op[2])
  })
  return idset
}

/**
 * Given：零长、相邻与重叠的手工 ID 区间。
 * When：比较触发 `IdRanges.getIds()` 规范化。
 * Then：零长段消失，相邻/重叠段合成最大连续范围，空洞保持分离。
 *
 * 验证机制：逐个边界比较规范化集合，覆盖原地双指针归并。
 *
 * @param {t.TestCase} _tc
 */
export const testIdsetMerge = _tc => {
  t.group('filter out empty items (1))', () => {
    compareIdSets(
      simpleConstructIdSet([[0, 1, 0]]),
      simpleConstructIdSet([])
    )
  })
  t.group('filter out empty items (2))', () => {
    compareIdSets(
      simpleConstructIdSet([[0, 1, 0], [0, 2, 0]]),
      simpleConstructIdSet([])
    )
  })
  t.group('filter out empty items (3 - end))', () => {
    compareIdSets(
      simpleConstructIdSet([[0, 1, 1], [0, 2, 0]]),
      simpleConstructIdSet([[0, 1, 1]])
    )
  })
  t.group('filter out empty items (4 - middle))', () => {
    compareIdSets(
      simpleConstructIdSet([[0, 1, 1], [0, 2, 0], [0, 3, 1]]),
      simpleConstructIdSet([[0, 1, 1], [0, 3, 1]])
    )
  })
  t.group('filter out empty items (5 - beginning))', () => {
    compareIdSets(
      simpleConstructIdSet([[0, 1, 0], [0, 2, 1], [0, 3, 1]]),
      simpleConstructIdSet([[0, 2, 1], [0, 3, 1]])
    )
  })
  t.group('merge of overlapping id ranges', () => {
    compareIdSets(
      simpleConstructIdSet([[0, 1, 2], [0, 0, 2]]),
      simpleConstructIdSet([[0, 0, 3]])
    )
  })
  t.group('construct without hole', () => {
    compareIdSets(
      simpleConstructIdSet([[0, 1, 2], [0, 3, 1]]),
      simpleConstructIdSet([[0, 1, 3]])
    )
  })
}

/**
 * Given：源范围与排除范围的分离、包含、左右重叠及跨多段组合。
 * When：计算 `diffIdSet(source, exclude)`。
 * Then：结果只保留源集合未被排除的精确子区间。
 *
 * 验证机制：手工期望覆盖 `_diffSet()` 的每种游标/裁剪分支。
 *
 * @param {t.TestCase} _tc
 */
export const testDiffing = _tc => {
  t.group('simple case (1))', () => {
    compareIdSets(
      d.diffIdSet(
        simpleConstructIdSet([[0, 1, 1], [0, 3, 1]]),
        simpleConstructIdSet([[0, 3, 1]])
      ),
      simpleConstructIdSet([[0, 1, 1]])
    )
  })
  t.group('subset left', () => {
    compareIdSets(
      d.diffIdSet(
        simpleConstructIdSet([[0, 1, 3]]),
        simpleConstructIdSet([[0, 1, 1]])
      ),
      simpleConstructIdSet([[0, 2, 2]])
    )
  })
  t.group('subset right', () => {
    compareIdSets(
      d.diffIdSet(
        simpleConstructIdSet([[0, 1, 3]]),
        simpleConstructIdSet([[0, 3, 1]])
      ),
      simpleConstructIdSet([[0, 1, 2]])
    )
  })
  t.group('subset middle', () => {
    compareIdSets(
      d.diffIdSet(
        simpleConstructIdSet([[0, 1, 3]]),
        simpleConstructIdSet([[0, 2, 1]])
      ),
      simpleConstructIdSet([[0, 1, 1], [0, 3, 1]])
    )
  })
  t.group('overlapping left', () => {
    compareIdSets(
      d.diffIdSet(
        simpleConstructIdSet([[0, 1, 3]]),
        simpleConstructIdSet([[0, 0, 2]])
      ),
      simpleConstructIdSet([[0, 2, 2]])
    )
  })
  t.group('overlapping right', () => {
    compareIdSets(
      d.diffIdSet(
        simpleConstructIdSet([[0, 1, 3]]),
        simpleConstructIdSet([[0, 3, 5]])
      ),
      simpleConstructIdSet([[0, 1, 2]])
    )
  })
  t.group('overlapping completely', () => {
    compareIdSets(
      d.diffIdSet(
        simpleConstructIdSet([[0, 1, 3]]),
        simpleConstructIdSet([[0, 0, 5]])
      ),
      simpleConstructIdSet([])
    )
  })
  t.group('overlapping into new range', () => {
    compareIdSets(
      d.diffIdSet(
        simpleConstructIdSet([[0, 1, 3], [0, 5, 2]]),
        simpleConstructIdSet([[0, 0, 6]])
      ),
      simpleConstructIdSet([[0, 6, 1]])
    )
  })
}

/**
 * 随机验证 `A \ B` 等于 `(A ∪ B) \ B`。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatRandomDiffing = tc => {
  const clients = 4
  const clockRange = 100
  const ds1 = createRandomIdSet(tc.prng, clients, clockRange)
  const ds2 = createRandomIdSet(tc.prng, clients, clockRange)
  const merged = d.mergeIdSets([ds1, ds2])
  const e1 = d.diffIdSet(ds1, ds2)
  const e2 = d.diffIdSet(merged, ds2)
  compareIdSets(e1, e2)
}

/**
 * 随机验证原地 `delete()` 与纯函数 `diffIdSet()` 结果一致。
 *
 * 删除长度允许越过生成范围，覆盖尾端裁剪与客户端键移除。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatRandomDeletes = tc => {
  const clients = 1
  const clockRange = 100
  const idset = createRandomIdSet(tc.prng, clients, clockRange)
  const client = Array.from(idset.clients.keys())[0]
  const clock = prng.int31(tc.prng, 0, clockRange)
  const len = prng.int31(tc.prng, 0, math.round((clockRange - clock) * 1.2)) // 允许越界以覆盖尾端分支。
  const idsetOfDeletes = d.createIdSet()
  idsetOfDeletes.add(client, clock, len)
  const diffed = d.diffIdSet(idset, idsetOfDeletes)
  idset.delete(client, clock, len)
  for (let i = 0; i < len; i++) {
    t.assert(!idset.has(client, clock + i))
  }
  compareIdSets(idset, diffed)
}

/**
 * 随机验证多个 IdSet 合并与输入顺序无关，并等价于逐 ID 并集重建。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatMergingMultipleIdsets = tc => {
  const clients = 4
  const clockRange = 100
  /**
   * @type {Array<d.IdSet>}
   */
  const idss = []
  for (let i = 0; i < 3; i++) {
    idss.push(createRandomIdSet(tc.prng, clients, clockRange))
  }
  const merged = d.mergeIdSets(idss)
  const mergedReverse = d.mergeIdSets(idss.reverse())
  compareIdSets(merged, mergedReverse)
  const composed = d.createIdSet()
  for (let iclient = 0; iclient < clients; iclient++) {
    for (let iclock = 0; iclock < clockRange + 42; iclock++) {
      const mergedHas = merged.hasId(new ID(iclient, iclock))
      const oneHas = idss.some(ids => ids.hasId(new ID(iclient, iclock)))
      t.assert(mergedHas === oneHas)
      if (oneHas) {
        composed.add(iclient, iclock, 1)
      }
    }
  }
  compareIdSets(merged, composed)
}

/**
 * 随机验证“先合并再排除”等于“分别排除再合并”。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatRandomDiffing2 = tc => {
  const clients = 4
  const clockRange = 100
  const ids1 = createRandomIdSet(tc.prng, clients, clockRange)
  const ids2 = createRandomIdSet(tc.prng, clients, clockRange)
  const idsExclude = createRandomIdSet(tc.prng, clients, clockRange)
  const merged = d.mergeIdSets([ids1, ids2])
  const mergedExcluded = d.diffIdSet(merged, idsExclude)
  const e1 = d.diffIdSet(ids1, idsExclude)
  const e2 = d.diffIdSet(ids2, idsExclude)
  const excludedMerged = d.mergeIdSets([e1, e2])
  compareIdSets(mergedExcluded, excludedMerged)
}

/**
 * 随机逐 ID 验证交集只包含双方共同覆盖，并验证差集排除交集等价于排除右集合。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatRandomIntersects = tc => {
  const clients = 4
  const clockRange = 100
  const ids1 = createRandomIdSet(tc.prng, clients, clockRange)
  const ids2 = createRandomIdSet(tc.prng, clients, clockRange)
  const intersected = d.intersectSets(ids1, ids2)
  for (let client = 0; client < clients; client++) {
    for (let clock = 0; clock < clockRange; clock++) {
      t.assert((ids1.has(client, clock) && ids2.has(client, clock)) === intersected.has(client, clock))
    }
  }
  const diffed1 = d.diffIdSet(ids1, ids2)
  const altDiffed1 = d.diffIdSet(ids1, intersected)
  compareIdSets(diffed1, altDiffed1)
}

/**
 * Given：随机 IdSet 与可能越过生成边界的随机查询范围。
 * When：调用无分配 `covers()` / `coveredLength()`。
 * Then：结果分别等于逐 ID `has()` 扫描与分配式 `slice()` 求和。
 *
 * 验证机制：三个独立实现交叉校验二分首范围和跨范围累加边界。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatRandomCoversAndCoveredLength = tc => {
  const clients = 4
  const clockRange = 100
  const ids = createRandomIdSet(tc.prng, clients, clockRange)
  for (let iter = 0; iter < 300; iter++) {
    const client = prng.int31(tc.prng, 0, clients - 1)
    const clock = prng.int31(tc.prng, 0, clockRange)
    const len = prng.int31(tc.prng, 1, clockRange - clock + 5) // 允许越界以覆盖查询尾端。
    // 逐 ID 扫描作为简单参考实现。
    let refCovered = 0
    let refCovers = true
    for (let c = clock; c < clock + len; c++) {
      if (ids.has(client, c)) refCovered++
      else refCovers = false
    }
    t.assert(ids.covers(client, clock, len) === refCovers)
    t.assert(ids.coveredLength(client, clock, len) === refCovered)
    // 再与分配式切片实现交叉校验。
    const sliceCovered = ids.slice(client, clock, len).reduce((s, r) => r.exists ? s + r.len : s, 0)
    t.assert(ids.coveredLength(client, clock, len) === sliceCovered)
  }
}

/**
 * 返回覆盖本地客户端指定时钟的结构，供 GC 断言检查内容类型。
 *
 * @param {Y.Doc} doc
 * @param {number} clock
 * @return {any}
 */
const structAt = (doc, clock) => {
  const structs = /** @type {Array<any>} */ (doc.store.clients.get(doc.clientID))
  return structs[Y.findIndexSS(structs, clock)]
}

/**
 * Given：`gc:false` 文档中保留载荷的已删除数组元素。
 * When：用存储删除集调用 `gcIdSet()`。
 * Then：可见数组不变；可回收墓碑变为 `ContentDeleted`；全量更新仍与新副本收敛。
 *
 * 验证机制：同时断言 API 状态、内部内容类型与跨文档同步，证明回收只丢载荷、不
 * 改删除语义或因果编码。
 *
 * @param {t.TestCase} _tc
 */
export const testGcIdSetBasic = _tc => {
  const doc = new Y.Doc({ gc: false })
  const yarr = doc.get('array')
  yarr.insert(0, ['a', 'b', 'c', 'd'])
  yarr.delete(1, 2) // 删除时钟 1、2 的 b、c。
  // GC 关闭，删除 Item 仍保留原 ContentAny 载荷。
  t.assert(structAt(doc, 1).content instanceof Y.ContentAny)

  Y.gcIdSet(doc, Y.createDeleteSetFromStructStore(doc.store))

  // 可观察状态不变。
  t.compare(yarr.toArray(), ['a', 'd'])
  // 所有允许回收的删除 Item 都只保留长度占位。
  doc.store.clients.forEach(structs => {
    structs.forEach(struct => {
      if (struct.constructor === Y.Item && struct.deleted && !struct.keep) {
        t.assert(struct.content instanceof Y.ContentDeleted)
      }
    })
  })
  // 回收后生成的更新仍可让新副本收敛。
  const peer = new Y.Doc()
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
  t.compare(peer.get('array').toArray(), ['a', 'd'])
}

/**
 * Given：一个保留载荷的连续删除结构，只选择其中间时钟范围。
 * When：调用 `gcIdSet()`。
 * Then：仅命中中段变为 `ContentDeleted`，两侧删除载荷仍保留。
 *
 * 验证机制：分别按边界内外时钟检查内容类型，证明预切分精确限定 GC 范围。
 *
 * @param {t.TestCase} _tc
 */
export const testGcIdSetPartialRange = _tc => {
  const doc = new Y.Doc({ gc: false })
  const yarr = doc.get('array')
  yarr.insert(0, ['a', 'b', 'c', 'd', 'e'])
  yarr.delete(1, 4) // 删除时钟 1..4 的 b、c、d、e；GC 关闭故保留载荷。

  // 只回收删除段中部时钟 2..3（c、d）。
  const ids = d.createIdSet()
  ids.add(doc.clientID, 2, 2)
  Y.gcIdSet(doc, ids)

  t.compare(yarr.toArray(), ['a'])
  // 时钟 1 的 b 与时钟 4 的 e 在 IdSet 外，仍保留载荷。
  t.assert(structAt(doc, 1).deleted && structAt(doc, 1).content instanceof Y.ContentAny)
  t.assert(structAt(doc, 4).deleted && structAt(doc, 4).content instanceof Y.ContentAny)
  // 时钟 2..3 的 c、d 位于 IdSet 内，已经回收。
  t.assert(structAt(doc, 2).content instanceof Y.ContentDeleted)
}

/**
 * 验证 `gcIdSet()` 跳过 IdSet 中仍存活的内容，只回收已删除 Item。
 *
 * @param {t.TestCase} _tc
 */
export const testGcIdSetSkipsLiveContent = _tc => {
  const doc = new Y.Doc({ gc: false })
  const yarr = doc.get('array')
  yarr.insert(0, ['a', 'b', 'c'])
  yarr.delete(1, 1) // 只删除 b。

  // 传入存活与删除的全部 ID；只有删除项可回收。
  Y.gcIdSet(doc, Y.createInsertSetFromStructStore(doc.store, false))

  t.compare(yarr.toArray(), ['a', 'c'])
  t.assert(structAt(doc, 0).content instanceof Y.ContentAny) // a 存活，不改动。
  t.assert(structAt(doc, 2).content instanceof Y.ContentAny) // c 存活，不改动。
  t.assert(structAt(doc, 1).content instanceof Y.ContentDeleted) // b 已删除，完成回收。
}

/**
 * 验证重复调用 `gcIdSet()` 幂等：第二次不改变可见值或编码状态。
 *
 * @param {t.TestCase} _tc
 */
export const testGcIdSetIdempotent = _tc => {
  const doc = new Y.Doc({ gc: false })
  const yarr = doc.get('array')
  yarr.insert(0, ['a', 'b', 'c'])
  yarr.delete(0, 2)
  const ds = Y.createDeleteSetFromStructStore(doc.store)
  Y.gcIdSet(doc, ds)
  const encoded = Y.encodeStateAsUpdate(doc)
  Y.gcIdSet(doc, ds) // 第二次回收不产生变化。
  t.compare(yarr.toArray(), ['c'])
  t.compare(Y.encodeStateAsUpdate(doc), encoded)
}

/**
 * 验证带 `keep` 位（例如受 UndoManager 保护）的删除 Item 不被回收。
 *
 * @param {t.TestCase} _tc
 */
export const testGcIdSetRespectsKeep = _tc => {
  const doc = new Y.Doc({ gc: false })
  const yarr = doc.get('array')
  yarr.insert(0, ['a', 'b', 'c'])
  yarr.delete(1, 1) // 删除时钟 1 的 b。
  structAt(doc, 1).keep = true // 设置 GC 保护。

  Y.gcIdSet(doc, Y.createDeleteSetFromStructStore(doc.store))

  // b 受 keep 保护，仍保留原内容。
  t.assert(structAt(doc, 1).deleted && structAt(doc, 1).content instanceof Y.ContentAny)
}
