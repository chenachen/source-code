import * as t from 'lib0/testing'
import * as Y from '../src/index.js'
import * as d from '../src/utils/ids.js'
import * as math from 'lib0/math'
import * as prng from 'lib0/prng'
import { compareIdSets, createRandomIdSet, ID } from './testHelper.js'

/**
 * 按 `[client, clock, len]` 构造 IdSet。
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
 * 比较手工构造的 IdSet 与预期区间：零长度输入在 `IdSet.add()` 时即被忽略；
 * 比较时触发 `IdRanges.getIds()`，相邻/重叠段合并，空洞保持分离。
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
 * 用手工期望检查 `diffIdSet(source, exclude)` 的区间边界，覆盖分离、包含、
 * 左右重叠以及一个排除范围跨越多段的组合。
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
 * 初始：PRNG 生成四个 client、clock 范围 100 的两个集合。触发：分别求 A\B 与 (A∪B)\B。预期：逐 client 的规范区间边界相同；重复轮次由测试运行器的 Repeat 规则控制。
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
 * 初始：一个 client 的随机集合与可越过尾端的随机删除范围。触发：先计算纯差集，再原地 delete。预期：删除区间逐 clock 查询均为 false，且完整结果与差集一致。
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
 * 初始：四 client 的三个随机集合。触发：正序、反序合并，并扫描 clock 0..141 重建逐 ID 并集。预期：两种合并及重建结果边界相同；检查范围包含生成区间之外的空尾部。
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
 * 初始：同一四 client/100 clock 空间的 A、B、排除集合 E。触发：比较 (A∪B)\E 与 (A\E)∪(B\E)。预期：规范区间完全一致。
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
 * 初始：四 client/100 clock 的两个随机集合。触发：求交集后在该空间逐 ID 检查，并计算两个差集。预期：交集覆盖恰为双方同时 has，A\B 等于 A\(A∩B)。
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
 * 对随机查询范围比较 `covers()`、`coveredLength()` 与逐 ID `has()` 扫描，
 * 再比较 `coveredLength()` 与 `slice()` 中存在段的长度之和。查询允许越过
 * 生成边界，检查尾端裁剪。
 *
 * 初始：四 client/100 clock 随机集合。触发：同一调用内做 300 次正长度范围查询，允许末端越界。预期：covers 与 coveredLength 同逐 ID 参考扫描一致，长度也等于 slice 存在段之和。
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
 * 在 `gc:false` 文档中删除数组元素，再用存储删除集调用 `gcIdSet()`。检查墓碑
 * 载荷变为 `ContentDeleted`、可见数组保持不变，并把回收后的全量更新应用到
 * 新副本，比较双方数组。
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
 * 仅回收连续墓碑的中间时钟范围；检查中段变为 `ContentDeleted`，两侧仍保留
 * `ContentAny`。该输入需要先切分墓碑，才能把回收限定在选中的区间。
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
 * 初始：关闭自动 GC，插入 a/b/c 后只删除 b。触发：以包括存活项的全部 ID 集手动 gcIdSet。预期：可见 a/c 不变且保留 ContentAny，b 的载荷变为 ContentDeleted。
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
 * 初始：关闭自动 GC，删除 a/b 留下 c。触发：用同一个删除集调用 gcIdSet 两次。预期：第二次后可见数组与第一次编码字节完全不变。
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
 * 初始：关闭自动 GC，删除 b 后手工置 keep=true。触发：按完整删除集手动回收。预期：b 保持 deleted 且仍保留 ContentAny；此例未创建 UndoManager。
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
