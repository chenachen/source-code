import * as t from 'lib0/testing'
import * as ids from '../src/utils/ids.js'
import * as prng from 'lib0/prng'
import * as math from 'lib0/math'
import { compareIdmaps as compareIdMaps, createIdMap, ID, createRandomIdSet, createRandomIdMap, createContentAttribute } from './testHelper.js'
import * as YY from '../src/index.js'
import * as time from 'lib0/time'

/**
 * 用紧凑四元组 fixture 构造带匿名属性值的 IdMap。
 *
 * @template T
 * @param {Array<[number, number, number, Array<T>]>} ops
 */
const simpleConstructAttrs = ops => {
  const attrs = createIdMap()
  ops.forEach(op => {
    attrs.add(op[0], op[1], op[2], op[3].map(v => createContentAttribute('', v)))
  })
  return attrs
}

/**
 * Given：零长、相邻、重叠且属性相同或不同的手工区间。
 * When：`AttrRanges.getIds()` 随比较被规范化。
 * Then：零长段消失；同属性连续段合并；重叠异属性段按边界切分并取属性并集。
 *
 * 验证机制：逐个边界比较规范化 IdMap，覆盖 `AttrRanges.getIds()` 的切分、冒泡
 * 重排和最终相邻归并。
 *
 * @param {t.TestCase} _tc
 */
export const testAmMerge = _tc => {
  const attrs = [42]
  t.group('filter out empty items (1))', () => {
    compareIdMaps(
      simpleConstructAttrs([[0, 1, 0, attrs]]),
      simpleConstructAttrs([])
    )
  })
  t.group('filter out empty items (2))', () => {
    compareIdMaps(
      simpleConstructAttrs([[0, 1, 0, attrs], [0, 2, 0, attrs]]),
      simpleConstructAttrs([])
    )
  })
  t.group('filter out empty items (3 - end))', () => {
    compareIdMaps(
      simpleConstructAttrs([[0, 1, 1, attrs], [0, 2, 0, attrs]]),
      simpleConstructAttrs([[0, 1, 1, attrs]])
    )
  })
  t.group('filter out empty items (4 - middle))', () => {
    compareIdMaps(
      simpleConstructAttrs([[0, 1, 1, attrs], [0, 2, 0, attrs], [0, 3, 1, attrs]]),
      simpleConstructAttrs([[0, 1, 1, attrs], [0, 3, 1, attrs]])
    )
  })
  t.group('filter out empty items (5 - beginning))', () => {
    compareIdMaps(
      simpleConstructAttrs([[0, 1, 0, attrs], [0, 2, 1, attrs], [0, 3, 1, attrs]]),
      simpleConstructAttrs([[0, 2, 1, attrs], [0, 3, 1, attrs]])
    )
  })
  t.group('merge of overlapping id ranges', () => {
    compareIdMaps(
      simpleConstructAttrs([[0, 1, 2, attrs], [0, 0, 2, attrs]]),
      simpleConstructAttrs([[0, 0, 3, attrs]])
    )
  })
  t.group('construct without hole', () => {
    compareIdMaps(
      simpleConstructAttrs([[0, 1, 2, attrs], [0, 3, 1, attrs]]),
      simpleConstructAttrs([[0, 1, 3, attrs]])
    )
  })
  t.group('no merge of overlapping id ranges with different attributes', () => {
    compareIdMaps(
      simpleConstructAttrs([[0, 1, 2, [1]], [0, 0, 2, [2]]]),
      simpleConstructAttrs([[0, 0, 1, [2]], [0, 1, 1, [1, 2]], [0, 2, 1, [1]]])
    )
  })
}

/**
 * 随机验证多个 IdMap 合并与输入顺序无关，且等价于逐 ID 重建。
 *
 * 验证机制：同时比较正反输入的合并值、逐时钟存在性与逐切片重建结果，证明覆盖
 * 并集和属性集合都保持，而非只验证范围边界。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatMergingMultipleIdMaps = tc => {
  const clients = 4
  const clockRange = 5
  /**
   * @type {Array<IdMap<number>>}
   */
  const sets = []
  for (let i = 0; i < 3; i++) {
    sets.push(createRandomIdMap(tc.prng, clients, clockRange, [1, 2, 3]))
  }
  const merged = ids.mergeIdMaps(sets)
  const mergedReverse = ids.mergeIdMaps(sets.reverse())
  compareIdMaps(merged, mergedReverse)
  const composed = ids.createIdMap()
  for (let iclient = 0; iclient < clients; iclient++) {
    for (let iclock = 0; iclock < clockRange + 42; iclock++) {
      const mergedHas = merged.hasId(new ID(iclient, iclock))
      const oneHas = sets.some(ids => ids.hasId(new ID(iclient, iclock)))
      t.assert(mergedHas === oneHas)
      const mergedAttrs = merged.sliceId(new ID(iclient, iclock), 1)
      mergedAttrs.forEach(a => {
        if (a.attrs != null) {
          composed.add(iclient, a.clock, a.len, a.attrs)
        }
      })
    }
  }
  compareIdMaps(merged, composed)
}

/**
 * 随机验证 `A \ B` 等于 `(A ∪ B) \ B`，并验证差集可无损编解码。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatRandomDiffing = tc => {
  const clients = 4
  const clockRange = 100
  const attrs = [1, 2, 3]
  const idset1 = createRandomIdMap(tc.prng, clients, clockRange, attrs)
  const idset2 = createRandomIdMap(tc.prng, clients, clockRange, attrs)
  const merged = ids.mergeIdMaps([idset1, idset2])
  const e1 = ids.diffIdMap(idset1, idset2)
  const e2 = ids.diffIdMap(merged, idset2)
  compareIdMaps(e1, e2)
  const copy = YY.decodeIdMap(YY.encodeIdMap(e1))
  compareIdMaps(e1, copy)
}

/**
 * 随机验证“先合并再排除”等于“分别排除再合并”，并验证结果可无损编解码。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatRandomDiffing2 = tc => {
  const clients = 4
  const clockRange = 100
  const attrs = [1, 2, 3]
  const idmap1 = createRandomIdMap(tc.prng, clients, clockRange, attrs)
  const idmap2 = createRandomIdMap(tc.prng, clients, clockRange, attrs)
  const idsExclude = createRandomIdSet(tc.prng, clients, clockRange)
  const merged = ids.mergeIdMaps([idmap1, idmap2])
  const mergedExcluded = ids.diffIdMap(merged, idsExclude)
  const e1 = ids.diffIdMap(idmap1, idsExclude)
  const e2 = ids.diffIdMap(idmap2, idsExclude)
  const excludedMerged = ids.mergeIdMaps([e1, e2])
  compareIdMaps(mergedExcluded, excludedMerged)
  const copy = YY.decodeIdMap(YY.encodeIdMap(mergedExcluded))
  compareIdMaps(mergedExcluded, copy)
}

/**
 * 随机验证原地 `delete()` 与纯函数 `diffIdMap()` 产生同一范围结果。
 *
 * 删除长度允许越过已生成范围，覆盖尾端裁剪和整客户端键移除边界。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatRandomDeletes = tc => {
  const clients = 1
  const clockRange = 100
  const idset = createRandomIdMap(tc.prng, clients, clockRange, [])
  const client = Array.from(idset.clients.keys())[0]
  const clock = prng.int31(tc.prng, 0, clockRange)
  const len = prng.int31(tc.prng, 0, math.round((clockRange - clock) * 1.2)) // 允许越界以覆盖尾端删除分支。
  const idsetOfDeletes = ids.createIdMap()
  idsetOfDeletes.add(client, clock, len, [])
  const diffed = ids.diffIdMap(idset, idsetOfDeletes)
  idset.delete(client, clock, len)
  for (let i = 0; i < len; i++) {
    t.assert(!idset.has(client, clock + i))
  }
  compareIdMaps(idset, diffed)
}

/**
 * 随机逐 ID 验证 IdMap 交集只保留双方覆盖，并连接双方属性。
 *
 * 另比较 `A \ B` 与 `A \ (A ∩ B)`，证明交集范围恰好代表需从 A 排除的重叠。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatRandomIntersects = tc => {
  const clients = 4
  const clockRange = 100
  const ids1 = createRandomIdMap(tc.prng, clients, clockRange, [1])
  const ids2 = createRandomIdMap(tc.prng, clients, clockRange, ['two'])
  const intersected = ids.intersectMaps(ids1, ids2)
  for (let client = 0; client < clients; client++) {
    for (let clock = 0; clock < clockRange; clock++) {
      t.assert((ids1.has(client, clock) && ids2.has(client, clock)) === intersected.has(client, clock))
      /**
       * @type {Array<any>?}
       */
      const slice1 = ids1.slice(client, clock, 1)[0].attrs
      /**
       * @type {Array<any>?}
       */
      const slice2 = ids2.slice(client, clock, 1)[0].attrs
      /**
       * @type {Array<any>?}
       */
      const expectedAttrs = (slice1 != null && slice2 != null) ? slice1.concat(slice2) : null
      const attrs = intersected.slice(client, clock, 1)[0].attrs
      t.assert(attrs?.length === expectedAttrs?.length)
    }
  }
  const diffed1 = ids.diffIdMap(ids1, ids2)
  const altDiffed1 = ids.diffIdMap(ids1, intersected)
  compareIdMaps(diffed1, altDiffed1)
}

/**
 * 基准化事务插入/删除归因的收集与 IdMap 编码体积。
 *
 * 此用例记录性能和每次变更字节数，不建立时间阈值；机制目标是覆盖真实事务产生
 * 的大量重叠归因区间及属性去重编码。
 *
 * @param {t.TestCase} tc
 */
export const testUserAttributionEncodingBenchmark = tc => {
  /**
   * @todo 分析当前方案为何每项约需 30 字节。
   * @todo 可考虑只用一个 IdMap，并在属性条目中编码相对前项的增删差值。
   */
  const attributions = createIdMap()
  const currentTime = time.getUnixTime()
  const ydoc = new YY.Doc()
  ydoc.on('afterTransaction', tr => {
    ids.insertIntoIdMap(attributions, ids.createIdMapFromIdSet(tr.insertSet, [createContentAttribute('insert', 'userX'), createContentAttribute('insertAt', currentTime)]))
    ids.insertIntoIdMap(attributions, ids.createIdMapFromIdSet(tr.deleteSet, [createContentAttribute('delete', 'userX'), createContentAttribute('deleteAt', currentTime)]))
  })
  const ytext = ydoc.get()
  const N = 10000
  t.measureTime(`time to attribute ${N / 1000}k changes`, () => {
    for (let i = 0; i < N; i++) {
      if (i % 2 > 0 && ytext.length > 0) {
        const pos = prng.int31(tc.prng, 0, ytext.length)
        const delLen = prng.int31(tc.prng, 0, ytext.length - pos)
        ytext.delete(pos, delLen)
      } else {
        ytext.insert(prng.int31(tc.prng, 0, ytext.length), prng.word(tc.prng))
      }
    }
  })
  t.measureTime('time to encode attributions map', () => {
    /**
     * @todo 可仅编码相对前一项的属性差值以进一步压缩。
     */
    const encAttributions = ids.encodeIdMap(attributions)
    t.info('encoded size: ' + encAttributions.byteLength)
    t.info('size per change: ' + math.floor((encAttributions.byteLength / N) * 100) / 100 + ' bytes')
  })
}
