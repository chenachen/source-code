import * as math from 'lib0/math'
import * as traits from 'lib0/traits'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as buf from 'lib0/buffer'
import * as rabin from 'lib0/hash/rabin'
import * as array from 'lib0/array'
import * as map from 'lib0/map'

import { iterateStructs, findIndexSS, iterateStructsWithoutSplits, tryGc } from './transaction-helpers.js'
import { UpdateEncoderV2, IdSetEncoderV2 } from './UpdateEncoder.js'
import { IdSetDecoderV2 } from './UpdateDecoder.js'

/**
 * 一次更新涉及的插入与删除 ID 区间。
 *
 * @typedef {{ inserts: IdSet, deletes: IdSet }} ContentIds
 */

/**
 * 一次更新涉及的带属性插入与删除区间。
 *
 * @typedef {{ inserts: IdMap<any>, deletes: IdMap<any> }} ContentMap
 */

/** 表示单个客户端上的半开时钟区间 `[clock, clock + len)`。 */
export class IdRange {
  /**
   * 创建起始时钟与长度组成的区间。
   *
   * @param {number} clock
   * @param {number} len
   */
  constructor (clock, len) {
    /**
     * 区间首个逻辑时钟。
     *
     * @type {number}
     */
    this.clock = clock
    /**
     * 区间包含的逻辑时钟数量。
     *
     * @type {number}
     */
    this.len = len
  }

  /**
   * 复用当前区间类型创建新边界，供通用集合算法保留子区间。
   *
   * @param {number} clock
   * @param {number} len
   */
  copyWith (clock, len) {
    return new IdRange(clock, len)
  }

  /**
   * 返回空属性列表，使普通区间可参与 IdMap 的通用交集逻辑。
   *
   * @return {Array<ContentAttribute<any>>}
   */
  get attrs () {
    return []
  }
}

/** 表示切片中一段存在或缺失的连续 ID 区间。 */
export class MaybeIdRange {
  /**
   * 创建带存在性标记的半开区间。
   *
   * @param {number} clock
   * @param {number} len
   * @param {boolean} exists
   */
  constructor (clock, len, exists) {
    /**
     * 区间首时钟。
     *
     * @type {number}
     */
    this.clock = clock
    /**
     * 区间长度。
     *
     * @type {number}
     */
    this.len = len
    /**
     * true 表示该段包含在源 IdSet 中。
     *
     * @type {boolean}
     */
    this.exists = exists
  }
}

/**
 * 创建切片结果区间。
 *
 * @param {number} clock
 * @param {number} len
 * @param {boolean} exists
 * @return {MaybeIdRange}
 */
export const createMaybeIdRange = (clock, len, exists) => new MaybeIdRange(clock, len, exists)

/**
 * 保存一个客户端的区间列表，并按需排序、归并为最大不重叠区间。
 *
 * 常见追加路径允许原地扩展尾区间；一旦 `getIds()` 暴露数组，下一次尾部扩展会
 * copy-on-write，避免修改调用方已经持有的 `IdRange` 对象。
 */
export class IdRanges {
  /**
   * 接管区间数组；调用方随后不应直接改写它。
   *
   * @param {Array<IdRange>} ids
   */
  constructor (ids) {
    this.sorted = false
    /**
     * 尾区间是否已通过 `getIds()` 或 `copy()` 暴露；为 true 时禁止原地扩长。
     */
    this._lastIsUsed = false
    /**
     * @private
     */
    this._ids = ids
  }

  /**
   * 浅复制区间容器并保留排序状态。
   *
   * 原容器尾项被标记已暴露，后续追加必须替换对象，保证副本看到稳定边界。
   */
  copy () {
    const cpy = new IdRanges(this._ids.slice())
    cpy.sorted = this.sorted
    this._lastIsUsed = true
    return cpy
  }

  /**
   * 追加一个区间；与尾区间首尾相接时走 O(1) 扩展路径。
   *
   * @param {number} clock
   * @param {number} length
   */
  add (clock, length) {
    const last = this._ids[this._ids.length - 1]
    if (last != null && last.clock + last.len === clock) {
      if (this._lastIsUsed) {
        this._ids[this._ids.length - 1] = new IdRange(last.clock, last.len + length)
        this._lastIsUsed = false
      } else {
        this._ids[this._ids.length - 1].len += length
      }
    } else {
      this.sorted = false
      this._ids.push(new IdRange(clock, length))
    }
  }

  /**
   * 返回按时钟排序、重叠或相邻均已归并的最大区间数组。
   *
   * 归并使用读写双指针原地压缩数组；返回后尾区间视为外部可见，后续追加不能
   * 原地修改它。
   */
  getIds () {
    const ids = this._ids
    this._lastIsUsed = true
    if (!this.sorted) {
      this.sorted = true
      ids.sort((a, b) => a.clock - b.clock)
      // 读指针 i 扫描，写指针 j 原地压缩：尽量并入 ids[j-1]，否则写到 ids[j]。
      let i, j
      for (i = 1, j = 1; i < ids.length; i++) {
        const left = ids[j - 1]
        const right = ids[i]
        if (left.clock + left.len >= right.clock) {
          const r = right.clock + right.len - left.clock
          if (left.len < r) {
            ids[j - 1] = new IdRange(left.clock, r)
          }
        } else if (left.len === 0) {
          ids[j - 1] = right
        } else {
          if (j < i) {
            ids[j] = right
          }
          j++
        }
      }
      ids.length = ids[j - 1].len === 0 ? j - 1 : j
    }
    return ids
  }
}

/**
 * 表示多个客户端逻辑时钟区间的集合。
 *
 * 每个客户端独立维护最大不重叠半开区间；集合常用于事务插入集、删除集、缺口集
 * 与更新筛选。所有查询先触发该客户端区间排序归并。
 *
 * @implements {traits.EqualityTrait}
 */
export class IdSet {
  /** 创建空客户端区间映射。 */
  constructor () {
    /**
     * @type {Map<number,IdRanges>}
     */
    this.clients = new Map()
  }

  /** 返回集合是否没有任何客户端区间。 */
  isEmpty () {
    return this.clients.size === 0
  }

  /**
   * 按客户端遍历归并后的每个 ID 区间。
   *
   * @param {(idrange:IdRange, client:number) => void} f
   */
  forEach (f) {
    this.clients.forEach((ranges, client) => {
      ranges.getIds().forEach((range) => {
        f(range, client)
      })
    })
  }

  /**
   * 判断单个 ID 是否属于集合。
   *
   * @param {ID} id
   * @return {boolean}
   */
  hasId (id) {
    return this.has(id.client, id.clock)
  }

  /**
   * 判断指定客户端时钟是否属于任一区间。
   *
   * @param {number} client
   * @param {number} clock
   */
  has (client, clock) {
    const dr = this.clients.get(client)
    if (dr) {
      return findIndexInIdRanges(dr.getIds(), clock) !== null
    }
    return false
  }

  /**
   * 判断查询半开区间是否与集合有任意交集。
   *
   * 先二分首个可能命中的范围，无需构造切片。
   *
   * @param {number} client
   * @param {number} clock
   * @param {number} len
   * @return {boolean}
   */
  intersects (client, clock, len) {
    const dr = this.clients.get(client)
    if (dr) {
      const ranges = dr.getIds()
      const index = findRangeStartInIdRanges(ranges, clock)
      return index !== null && ranges[index].clock < clock + len
    }
    return false
  }

  /**
   * 判断查询半开区间是否被集合完整覆盖。
   *
   * `getIds()` 返回最大归并区间，因此完整覆盖必定位于单个区间内；一次二分即可，
   * 无需分配切片。
   *
   * @param {number} client
   * @param {number} clock
   * @param {number} len
   * @return {boolean}
   */
  covers (client, clock, len) {
    const dr = this.clients.get(client)
    if (dr) {
      const ranges = dr.getIds()
      const index = findIndexInIdRanges(ranges, clock)
      if (index !== null) {
        const r = ranges[index]
        return clock + len <= r.clock + r.len
      }
    }
    return false
  }

  /**
   * 统计查询半开区间内属于集合的 ID 数量。
   *
   * 二分到首个候选区间后线性扫描重叠段，结果等价于对 `slice()` 中 `exists=true`
   * 的长度求和，但不分配中间对象。
   *
   * @param {number} client
   * @param {number} clock
   * @param {number} len
   * @return {number}
   */
  coveredLength (client, clock, len) {
    const dr = this.clients.get(client)
    let covered = 0
    if (dr) {
      const ranges = dr.getIds()
      const end = clock + len
      let index = findRangeStartInIdRanges(ranges, clock)
      if (index !== null) {
        for (; index < ranges.length; index++) {
          const r = ranges[index]
          if (r.clock >= end) break
          const from = r.clock < clock ? clock : r.clock
          const rEnd = r.clock + r.len
          const to = rEnd > end ? end : rEnd
          covered += to - from
        }
      }
    }
    return covered
  }

  /**
   * 把查询区间切成存在与缺失交替的完整分段。
   *
   * 返回段严格覆盖 `[clock, clock + len)`，无重叠、无空洞；边界命中源区间内部时
   * 会创建裁剪后的临时范围。
   *
   * @param {number} client
   * @param {number} clock
   * @param {number} len
   * @return {Array<MaybeIdRange>}
   */
  slice (client, clock, len) {
    const dr = this.clients.get(client)
    /**
     * @type {Array<MaybeIdRange>}
     */
    const res = []
    if (dr) {
      /**
       * @type {Array<IdRange>}
       */
      const ranges = dr.getIds()
      let index = findRangeStartInIdRanges(ranges, clock)
      if (index !== null) {
        let prev = null
        while (index < ranges.length) {
          let r = ranges[index]
          if (r.clock < clock) {
            r = new IdRange(clock, r.len - (clock - r.clock))
          }
          if (r.clock + r.len > clock + len) {
            r = new IdRange(r.clock, clock + len - r.clock)
          }
          if (r.len <= 0) break
          const prevEnd = prev != null ? prev.clock + prev.len : clock
          if (prevEnd < r.clock) {
            res.push(createMaybeIdRange(prevEnd, r.clock - prevEnd, false))
          }
          prev = r
          res.push(createMaybeIdRange(r.clock, r.len, true))
          index++
        }
      }
    }
    if (res.length > 0) {
      const last = res[res.length - 1]
      const end = last.clock + last.len
      if (end < clock + len) {
        res.push(createMaybeIdRange(end, clock + len - end, false))
      }
    } else {
      res.push(createMaybeIdRange(clock, len, false))
    }
    return res
  }

  /**
   * 向指定客户端加入非零半开区间。
   *
   * 新范围允许暂时无序或重叠；查询时由 `IdRanges.getIds()` 规范化。
   *
   * @param {number} client
   * @param {number} clock
   * @param {number} len
   */
  add (client, clock, len) {
    if (len === 0) return
    const idRanges = this.clients.get(client)
    if (idRanges) {
      idRanges.add(clock, len)
    } else {
      this.clients.set(client, new IdRanges([new IdRange(clock, len)]))
    }
  }

  /**
   * 从集合删除指定半开区间。
   *
   * @param {number} client
   * @param {number} clock
   * @param {number} len
   */
  delete (client, clock, len) {
    _deleteRangeFromIdSet(this, client, clock, len)
  }

  /**
   * 实现 lib0 相等性协议，按规范化区间做值比较。
   *
   * @param {any} other
   */
  [traits.EqualityTraitSymbol] (other) {
    return equalIdSets(this, other)
  }
}

/**
 * 比较两个 IdSet 的客户端键及规范化区间是否完全相同。
 *
 * @param {IdSet} ds1
 * @param {IdSet} ds2
 */
export const equalIdSets = (ds1, ds2) => {
  if (ds1.clients.size !== ds2.clients.size) return false
  for (const [client, _deleteItems1] of ds1.clients.entries()) {
    const deleteItems1 = _deleteItems1.getIds()
    const deleteItems2 = ds2.clients.get(client)?.getIds()
    if (deleteItems2 === undefined || deleteItems1.length !== deleteItems2.length) return false
    for (let i = 0; i < deleteItems1.length; i++) {
      const di1 = deleteItems1[i]
      const di2 = deleteItems2[i]
      if (di1.clock !== di2.clock || di1.len !== di2.len) {
        return false
      }
    }
  }
  return true
}

/**
 * 从 IdSet 或 IdMap 原地删除一个半开区间。
 *
 * 算法二分到首个候选范围，再按重叠形态保留左段、右段、两段或删除整段。若某
 * 客户端最后一个范围被移除，也删除客户端键，保持 `isEmpty()` 语义。
 *
 * @param {IdSet | IdMap<any>} set
 * @param {number} client
 * @param {number} clock
 * @param {number} len
 */
export const _deleteRangeFromIdSet = (set, client, clock, len) => {
  const dr = set.clients.get(client)
  if (dr && len > 0) {
    const ids = dr.getIds()
    let index = findRangeStartInIdRanges(ids, clock)
    if (index != null) {
      for (let r = ids[index]; index < ids.length && r.clock < clock + len; r = ids[++index]) {
        if (r.clock < clock) {
          ids[index] = r.copyWith(r.clock, clock - r.clock)
          if (clock + len < r.clock + r.len) {
            ids.splice(index + 1, 0, r.copyWith(clock + len, r.clock + r.len - clock - len))
          }
        } else if (clock + len < r.clock + r.len) {
          // 删除覆盖左侧，只保留原范围尾段。
          ids[index] = r.copyWith(clock + len, r.clock + r.len - clock - len)
        } else if (ids.length === 1) {
          set.clients.delete(client)
          return
        } else {
          ids.splice(index--, 1)
        }
      }
    }
  }
}

/**
 * 遍历 IdSet 命中的结构，并在边界处按需切分 Item。
 *
 * 事务删除与精确 GC 使用此入口；切分副作用会登记到事务合并队列。
 *
 * @param {Transaction} transaction
 * @param {IdSet} ds
 * @param {function(GC|Item):void} f
 *
 * @function
 */
export const iterateStructsByIdSet = (transaction, ds, f) =>
  ds.clients.forEach((idRanges, clientid) => {
    const ranges = idRanges.getIds()
    const structs = /** @type {Array<GC|Item>} */ (transaction.doc.store.clients.get(clientid))
    if (structs != null) {
      for (let i = 0; i < ranges.length; i++) {
        const del = ranges[i]
        iterateStructs(transaction, structs, del.clock, del.len, f)
      }
    }
  })

/**
 * 仅垃圾回收 IdSet 指定的已删除内容。
 *
 * 用于在 `gc:false` 文档中回收已不再被快照或 UndoManager 引用的历史内容，而不必
 * 全局开启 GC。先在区间边界切分结构，再调用事务 GC；活内容、已回收结构、keep
 * Item 与被 `gcFilter` 拒绝的 Item 都会跳过。
 *
 * @param {Doc} doc
 * @param {IdSet} ids
 * @param {function(Item):boolean} [gcFilter]
 */
export const gcIdSet = (doc, ids, gcFilter = doc.gcFilter) =>
  doc.transact(tr => {
    // 任意 IdSet 不一定与结构边界对齐；先精确切分，避免回收范围外内容。
    iterateStructsByIdSet(tr, ids, () => {})
    tryGc(tr, ids, gcFilter)
  })

/**
 * 遍历 IdSet 命中的结构片段，但不切分存储内结构。
 *
 * 回调同时获得结构内偏移和命中长度，适合只读分析与更新筛选。
 *
 * @param {StructStore} store
 * @param {IdSet} ds
 * @param {(struct: GC|Item|Skip, offset:number, len:number)=>void} f
 */
export const iterateStructsByIdSetWithoutSplits = (store, ds, f) =>
  ds.clients.forEach((idRanges, clientid) => {
    const ranges = idRanges.getIds()
    const structs = /** @type {Array<GC|Item>} */ (store.clients.get(clientid))
    if (structs != null) {
      const lastStruct = structs[structs.length - 1]
      const nextClock = lastStruct.id.clock + lastStruct.length
      for (let i = 0; i < ranges.length; i++) {
        const del = ranges[i]
        if (del.clock < nextClock) {
          iterateStructsWithoutSplits(structs, del.clock, del.len, f)
        }
      }
    }
  })

/**
 * 二分查找包含指定时钟的区间索引。
 *
 * 输入必须已按时钟排序且互不重叠；未命中返回 null。
 *
 * @param {Array<IdRange>} dis
 * @param {number} clock
 * @return {number|null}
 *
 * @private
 * @function
 */
export const findIndexInIdRanges = (dis, clock) => {
  let left = 0
  let right = dis.length - 1
  while (left <= right) {
    const midindex = math.floor((left + right) / 2)
    const mid = dis[midindex]
    const midclock = mid.clock
    if (midclock <= clock) {
      if (clock < midclock + mid.len) {
        return midindex
      }
      left = midindex + 1
    } else {
      right = midindex - 1
    }
  }
  return null
}

/**
 * 二分查找包含指定时钟或位于其后的首个区间。
 *
 * 与 `findIndexInIdRanges()` 不同，时钟落在空洞时返回下一范围索引；末尾之后仍
 * 返回 null。
 *
 * @param {Array<IdRange>} dis
 * @param {number} clock
 * @return {number|null}
 *
 * @private
 * @function
 */
export const findRangeStartInIdRanges = (dis, clock) => {
  let left = 0
  let right = dis.length - 1
  while (left <= right) {
    const midindex = math.floor((left + right) / 2)
    const mid = dis[midindex]
    const midclock = mid.clock
    if (midclock <= clock) {
      if (clock < midclock + mid.len) {
        return midindex
      }
      left = midindex + 1
    } else {
      right = midindex - 1
    }
  }
  return left < dis.length ? left : null
}

/**
 * 合并多个 IdSet，返回新的惰性规范化集合。
 *
 * 每个客户端只在首次遇到时收集所有后续集合的区间；容器标记为未排序，真正的
 * 排序与重叠归并延迟到查询，避免逐次合并成本。
 *
 * @param {Array<IdSet>} idSets
 * @return {IdSet} A fresh IdSet
 */
export const mergeIdSets = idSets => {
  const merged = new IdSet()
  for (let dssI = 0; dssI < idSets.length; dssI++) {
    idSets[dssI].clients.forEach((rangesLeft, client) => {
      if (!merged.clients.has(client)) {
        // 客户端首次出现时一次收集当前及后续全部区间；已有键说明此前已收集。
        const ids = rangesLeft.getIds().slice()
        for (let i = dssI + 1; i < idSets.length; i++) {
          const nextIds = idSets[i].clients.get(client)
          if (nextIds) {
            array.appendTo(ids, nextIds.getIds())
          }
        }
        merged.clients.set(client, new IdRanges(ids))
      }
    })
  }
  return merged
}

/**
 * 把源集合所有客户端区间追加进目标 IdSet/IdMap。
 *
 * 已有客户端仅拼接并标记待排序；新客户端复制容器，避免目标后续规范化改写源。
 *
 * @template {IdSet | IdMap<any>} S
 * @param {S} dest
 * @param {S} src
 */
const _insertIntoIdSet = (dest, src) => {
  src.clients.forEach((srcRanges, client) => {
    const targetRanges = dest.clients.get(client)
    if (targetRanges) {
      array.appendTo(targetRanges.getIds(), srcRanges.getIds())
      targetRanges.sorted = false
    } else {
      // 复制前先规范化，确保新容器可安全继承顺序。
      srcRanges.getIds()
      dest.clients.set(client, /** @type {any} */ (srcRanges.copy()))
    }
  })
}

/**
 * 把源 IdSet 的全部区间并入目标 IdSet。
 *
 * @param {IdSet} dest
 * @param {IdSet} src
 */
export const insertIntoIdSet = _insertIntoIdSet

/**
 * 把源 IdSet/IdMap 的全部区间并入目标 IdMap。
 *
 * @param {IdMap<any>} dest
 * @param {IdMap<any>|IdSet} src
 */
export const insertIntoIdMap = _insertIntoIdSet

/**
 * 返回 `set \ exclude`，并保留左操作数的集合种类与属性。
 *
 * 对同客户端两组有序最大区间使用双游标：不重叠时推进相应侧，重叠时按左右边界
 * 裁剪当前源范围。结果是新集合，不修改任一输入。
 *
 * @todo 重命名为 `excludeIdSet` / `excludeIdMap` 以表达语义。
 *
 * @template {IdSet | IdMap<any>} Set
 * @param {Set} set
 * @param {IdSet | IdMap<any>} exclude
 * @return {Set}
 */
export const _diffSet = (set, exclude) => {
  /**
   * @type {Set}
   */
  const res = /** @type {any } */ (set instanceof IdSet ? new IdSet() : new IdMap())
  const Ranges = set instanceof IdSet ? IdRanges : AttrRanges
  set.clients.forEach((_setRanges, client) => {
    /**
     * @type {Array<IdRange>}
     */
    let resRanges = []
    const _excludedRanges = exclude.clients.get(client)
    const setRanges = _setRanges.getIds()
    if (_excludedRanges == null) {
      resRanges = setRanges.slice()
    } else {
      const excludedRanges = _excludedRanges.getIds()
      let i = 0; let j = 0
      let currRange = setRanges[0]
      while (i < setRanges.length && j < excludedRanges.length) {
        const e = excludedRanges[j]
        if (currRange.clock + currRange.len <= e.clock) { // 源范围在排除范围左侧，直接保留。
          if (currRange.len > 0) resRanges.push(currRange)
          currRange = setRanges[++i]
        } else if (e.clock + e.len <= currRange.clock) { // 排除范围已结束，推进排除游标。
          j++
        } else if (e.clock <= currRange.clock) { // 排除范围覆盖源范围左端，保留可能的尾段。
          const newClock = e.clock + e.len
          const newLen = currRange.clock + currRange.len - newClock
          if (newLen > 0) {
            currRange = currRange.copyWith(newClock, newLen)
            j++
          } else {
            // 源范围被完全覆盖，推进源游标。
            currRange = setRanges[++i]
          }
        } else { // 源范围先开始，先保留不重叠左段。
          const nextLen = e.clock - currRange.clock
          resRanges.push(currRange.copyWith(currRange.clock, nextLen))
          // 当前源范围继续表示排除段右侧余量。
          currRange = currRange.copyWith(currRange.clock + e.len + nextLen, math.max(currRange.len - e.len - nextLen, 0))
          if (currRange.len === 0) currRange = setRanges[++i]
          else j++
        }
      }
      if (currRange != null) {
        resRanges.push(currRange)
      }
      i++
      while (i < setRanges.length) {
        resRanges.push(setRanges[i++])
      }
    }
    // @ts-ignore
    if (resRanges.length > 0) res.clients.set(client, /** @type {any} */ (new Ranges(resRanges)))
  })
  return res
}

/**
 * 返回 IdSet 差集；委托通用 `_diffSet()`。
 *
 * @type {(idSet: IdSet, exclude: IdSet|IdMap<any>) => IdSet}
 */
export const diffIdSet = _diffSet

/**
 * 返回两集合的区间交集，并保留左操作数集合种类。
 *
 * 每客户端用双游标求半开区间重叠。普通 IdSet 产生 `IdRange`；IdMap 以左范围为
 * 基础并连接两侧属性，因此 `intersectMaps(a,b)` 的范围对称但属性顺序由参数决定。
 *
 * @template {IdSet | IdMap<any>} SetA
 * @template {IdSet | IdMap<any>} SetB
 * @param {SetA} setA
 * @param {SetB} setB
 * @return {SetA extends IdMap<infer A> ? (SetB extends IdMap<infer B> ? IdMap<A | B> : IdMap<A>) : IdSet}
 */
export const _intersectSets = (setA, setB) => {
  /**
   * @type {IdMap<any> | IdSet}
   */
  const res = /** @type {any } */ (setA instanceof IdSet ? new IdSet() : new IdMap())
  const Ranges = setA instanceof IdSet ? IdRanges : AttrRanges
  setA.clients.forEach((_aRanges, client) => {
    /**
     * @type {Array<IdRange>}
     */
    const resRanges = []
    const _bRanges = setB.clients.get(client)
    const aRanges = _aRanges.getIds()
    if (_bRanges != null) {
      const bRanges = _bRanges.getIds()
      for (let a = 0, b = 0; a < aRanges.length && b < bRanges.length;) {
        const aRange = aRanges[a]
        const bRange = bRanges[b]
        // 半开区间交集起点取最大值，长度取两侧剩余长度最小值。
        const clock = math.max(aRange.clock, bRange.clock)
        const len = math.min(aRange.len - (clock - aRange.clock), bRange.len - (clock - bRange.clock))
        if (len > 0) {
          resRanges.push(aRange instanceof AttrRange
            ? new AttrRange(clock, len, /** @type {Array<any>} */ (aRange.attrs).concat(bRange.attrs))
            : new IdRange(clock, len)
          )
        }
        if (aRange.clock + aRange.len < bRange.clock + bRange.len) {
          a++
        } else {
          b++
        }
      }
    }
    // @ts-ignore
    if (resRanges.length > 0) res.clients.set(client, /** @type {any} */ (new Ranges(resRanges)))
  })
  return /** @type {any} */ (res)
}

/** 返回两个 IdSet/IdMap 的通用区间交集。 */
export const intersectSets = _intersectSets

/** 创建空 IdSet。 */
export const createIdSet = () => new IdSet()

/**
 * 扫描结构存储并构造所有已删除结构的最大连续区间。
 *
 * 相邻 GC 与已删除 Item 只要时钟连续就合并；Skip 的 `deleted=false` 会自然断开
 * 范围。
 *
 * @param {StructStore} ss
 * @return {IdSet}
 *
 * @private
 * @function
 */
export const createDeleteSetFromStructStore = ss => {
  const ds = createIdSet()
  ss.clients.forEach((structs, client) => {
    /**
     * @type {Array<IdRange>}
     */
    const dsitems = []
    for (let i = 0; i < structs.length; i++) {
      const struct = structs[i]
      if (struct.deleted) {
        const clock = struct.id.clock
        let len = struct.length
        if (i + 1 < structs.length) {
          for (let next = structs[i + 1]; i + 1 < structs.length && next.deleted; next = structs[++i + 1]) {
            len += next.length
          }
        }
        dsitems.push(new IdRange(clock, len))
      }
    }
    if (dsitems.length > 0) {
      ds.clients.set(client, new IdRanges(dsitems))
    }
  })
  return ds
}

/**
 * 把结构数组压缩为插入 ID 区间。
 *
 * `filterDeleted=true` 时删除结构形成空洞；否则所有连续结构合成范围。该函数不
 * 修改输入结构。
 *
 * @param {Array<GC | Item | Skip>} structs
 * @param {boolean} filterDeleted
 *
 */
export const _createInsertSliceFromStructs = (structs, filterDeleted) => {
  /**
   * @type {Array<IdRange>}
   */
  const iditems = []
  for (let i = 0; i < structs.length; i++) {
    const struct = structs[i]
    if (!(filterDeleted && struct.deleted)) {
      const clock = struct.id.clock
      let len = struct.length
      if (i + 1 < structs.length) {
        // eslint-disable-next-line
        for (let next = structs[i + 1]; i + 1 < structs.length && !(filterDeleted && next.deleted); next = structs[++i + 1]) {
          len += next.length
        }
      }
      iditems.push(new IdRange(clock, len))
    }
  }
  return iditems
}

/**
 * 从整个结构存储构造插入集，可选择排除已删除结构。
 *
 * @param {StructStore} ss
 * @param {boolean} filterDeleted
 */
export const createInsertSetFromStructStore = (ss, filterDeleted) => {
  const idset = createIdSet()
  ss.clients.forEach((structs, client) => {
    const iditems = _createInsertSliceFromStructs(structs, filterDeleted)
    if (iditems.length !== 0) {
      idset.clients.set(client, new IdRanges(iditems))
    }
  })
  return idset
}

/**
 * 以确定性 client ID 降序编码 IdSet。
 *
 * 每个客户端先重置差分游标，再写客户端、范围数以及规范化范围。V1 写绝对值，
 * V2 由编码器把起点相对前一范围末端做差并编码 `len - 1`。
 *
 * @param {IdSetEncoderV1 | IdSetEncoderV2} encoder
 * @param {IdSet} idSet
 *
 * @private
 * @function
 */
export const writeIdSet = (encoder, idSet) => {
  encoding.writeVarUint(encoder.restEncoder, idSet.clients.size)
  // client ID 降序保证相同集合产生稳定字节。
  array.from(idSet.clients.entries())
    .sort((a, b) => b[0] - a[0])
    .forEach(([client, _idRanges]) => {
      const idRanges = _idRanges.getIds()
      encoder.resetIdSetCurVal()
      encoding.writeVarUint(encoder.restEncoder, client)
      const len = idRanges.length
      encoding.writeVarUint(encoder.restEncoder, len)
      for (let i = 0; i < len; i++) {
        const item = idRanges[i]
        encoder.writeIdSetClock(item.clock)
        encoder.writeIdSetLen(item.len)
      }
    })
}

/**
 * 从 V1/V2 ID 集解码器读取规范化客户端区间。
 *
 * 每个客户端开始前重置差分游标；V2 的 readClock/readLen 会共同推进它。
 *
 * @param {IdSetDecoderV1 | IdSetDecoderV2} decoder
 * @return {IdSet}
 *
 * @private
 * @function
 */
export const readIdSet = decoder => {
  const ds = new IdSet()
  const numClients = decoding.readVarUint(decoder.restDecoder)
  for (let i = 0; i < numClients; i++) {
    decoder.resetDsCurVal()
    const client = decoding.readVarUint(decoder.restDecoder)
    const numberOfDeletes = decoding.readVarUint(decoder.restDecoder)
    if (numberOfDeletes > 0) {
      /**
       * @type {Array<IdRange>}
       */
      const dsRanges = []
      for (let i = 0; i < numberOfDeletes; i++) {
        dsRanges.push(new IdRange(decoder.readDsClock(), decoder.readDsLen()))
      }
      ds.clients.set(client, new IdRanges(dsRanges))
    }
  }
  return ds
}

/**
 * 使用 V2 差分格式编码 IdSet。
 *
 * @param {IdSet} idSet
 * @return {Uint8Array<ArrayBuffer>}
 */
export const encodeIdSet = idSet => {
  const encoder = new IdSetEncoderV2()
  writeIdSet(encoder, idSet)
  return encoder.toUint8Array()
}

/**
 * 从 V2 差分格式解码 IdSet。
 *
 * @param {Uint8Array} data
 * @return {IdSet}
 */
export const decodeIdSet = data => readIdSet(new IdSetDecoderV2(decoding.createDecoder(data)))

/**
 * @todo 更新解码器还持有字符串等无关列，可考虑为删除集拆出独立序列化接口。
 */

/**
 * 读取删除集并尽可能应用到当前结构存储。
 *
 * 已到达区间会在删除边界切分 Item 并调用 `Item.delete()`；命中 Skip 或超出本地
 * `nextClock` 的部分加入 `unappliedDS`。若仍有余量，返回“零结构 + 删除集”的 V2
 * 更新供 `StructStore.pendingDs` 后续重试，否则返回 null。
 *
 * @param {IdSetDecoderV1 | IdSetDecoderV2} decoder
 * @param {Transaction} transaction
 * @param {StructStore} store
 * @return {Uint8Array<ArrayBuffer>|null} 尚未应用删除组成的 V2 更新；全部成功时为 null。
 *
 * @private
 * @function
 */
export const readAndApplyDeleteSet = (decoder, transaction, store) => {
  const unappliedDS = new IdSet()
  const numClients = decoding.readVarUint(decoder.restDecoder)
  for (let i = 0; i < numClients; i++) {
    decoder.resetDsCurVal()
    const client = decoding.readVarUint(decoder.restDecoder)
    const numberOfDeletes = decoding.readVarUint(decoder.restDecoder)
    const structs = store.clients.get(client) || []
    const state = store.getClock(client)
    for (let i = 0; i < numberOfDeletes; i++) {
      const clock = decoder.readDsClock()
      const clockEnd = clock + decoder.readDsLen()
      if (clock < state) {
        if (state < clockEnd) {
          unappliedDS.add(client, state, clockEnd - state)
        }
        let index = findIndexSS(structs, clock)
        /**
         * 当前扫描结构；已删除 Item 与 GC 会直接跳过，不重复产生事务副作用。
         * @type {Item | GC | Skip}
         */
        let struct = structs[index]
        // 让首个删除边界与 Item 边界对齐。
        if (!struct.deleted && struct.id.clock < clock && struct.isItem) {
          // split 返回右段并插到下一索引，删除从该右段开始。
          structs.splice(++index, 0, /** @type {Item} */ (struct).split(transaction, clock - struct.id.clock))
        }
        while (index < structs.length) {
          // @ts-ignore
          struct = structs[index++]
          if (struct.id.clock < clockEnd) {
            if (!struct.deleted) {
              if (struct.isItem) {
                if (clockEnd < struct.id.clock + struct.length) {
                  structs.splice(index, 0, /** @type {Item} */ (struct).split(transaction, clockEnd - struct.id.clock))
                }
                struct.delete(transaction)
              } else { // Skip 表示真实结构尚未到达，保留交叠删除待重试。
                const c = math.max(struct.id.clock, clock)
                unappliedDS.add(client, c, math.min(struct.length, clockEnd - c))
              }
            }
          } else {
            break
          }
        }
      } else {
        unappliedDS.add(client, clock, clockEnd - clock)
      }
    }
  }
  if (unappliedDS.clients.size > 0) {
    const ds = new UpdateEncoderV2()
    encoding.writeVarUint(ds.restEncoder, 0) // pending 删除更新不携带结构。
    writeIdSet(ds, unappliedDS)
    return ds.toUint8Array()
  }
  return null
}

/**
 * 表示带一组规范化属性引用的半开 ID 区间。
 *
 * @template Attrs
 */
export class AttrRange {
  /**
   * 创建区间与其适用属性。
   *
   * @param {number} clock
   * @param {number} len
   * @param {Array<ContentAttribute<Attrs>>} attrs
   */
  constructor (clock, len, attrs) {
    /**
     * 区间首时钟，构造后只读。
     *
     * @readonly
     */
    this.clock = clock
    /**
     * 区间长度，构造后只读。
     *
     * @readonly
     */
    this.len = len
    /**
     * 该区间的属性引用数组，构造后只读。
     *
     * @readonly
     */
    this.attrs = attrs
  }

  /**
   * 保留属性引用并创建新边界的区间。
   *
   * @param {number} clock
   * @param {number} len
   */
  copyWith (clock, len) {
    return new AttrRange(clock, len, this.attrs)
  }
}

/**
 * 表示可去重的属性名值定义。
 *
 * @todo 重命名为 `Attribute`。
 * @template V
 */
export class ContentAttribute {
  /**
   * 创建属性名和值。
   *
   * @param {string} name
   * @param {V} val
   */
  constructor (name, val) {
    this.name = name
    this.val = val
  }

  /**
   * 计算属性名值的稳定 Rabin 指纹。
   *
   * IdMap 用该指纹复用值相同但对象不同的属性定义，降低编码重复；哈希命中时
   * 当前实现直接视为同一属性。
   */
  hash () {
    const encoder = encoding.createEncoder()
    encoding.writeVarString(encoder, this.name)
    encoding.writeAny(encoder, /** @type {any} */ (this.val))
    return buf.toBase64(rabin.fingerprint(rabin.StandardIrreducible128, encoding.toUint8Array(encoder)))
  }
}

/**
 * 创建一个属性定义。
 *
 * @template V
 * @param {string} name
 * @param {V} val
 * @return {ContentAttribute<V>}
 */
export const createContentAttribute = (name, val) => new ContentAttribute(name, val)

/**
 * 表示 IdMap 切片中的一段；`attrs=null` 表示源映射没有覆盖该段。
 *
 * @template Attrs
 * @typedef {{ clock: number, len: number, attrs: Array<ContentAttribute<Attrs>>? }} MaybeAttrRange
 */

/**
 * 创建带可空属性的切片结果区间。
 *
 * @template Attrs
 *
 * @param {number} clock
 * @param {number} len
 * @param {Array<ContentAttribute<Attrs>>?} attrs
 * @return {MaybeAttrRange<Attrs>}
 */
export const createMaybeAttrRange = (clock, len, attrs) => new AttrRange(clock, len, /** @type {any} */ (attrs))

/**
 * 合并两个属性引用数组，并保持左侧顺序且只追加新引用。
 *
 * @template T
 * @param {Array<T>} a
 * @param {Array<T>} b
 */
const idmapAttrRangeJoin = (a, b) => a.concat(b.filter(attr => !idmapAttrsHas(a, attr)))

/**
 * 保存一个客户端的带属性区间，并按需拆分重叠、合并等属性相邻段。
 *
 * 构造时必须接管全新的区间数组，不能与其他容器共享；规范化会原地排序、插入和
 * 替换元素。
 *
 * @template Attrs
 */
export class AttrRanges {
  /**
   * 接管尚未规范化的属性区间数组。
   *
   * @param {Array<AttrRange<Attrs>>} ids
   */
  constructor (ids) {
    this.sorted = false
    /**
     * @private
     */
    this._ids = ids
  }

  /** 浅复制区间数组及排序状态。 */
  copy () {
    const cpy = new AttrRanges(this._ids.slice())
    cpy.sorted = this.sorted
    return cpy
  }

  /**
   * 追加非零属性区间并标记待规范化。
   *
   * @param {number} clock
   * @param {number} length
   * @param {Array<ContentAttribute<Attrs>>} attrs
   */
  add (clock, length, attrs) {
    if (length === 0) return
    this.sorted = false
    this._ids.push(new AttrRange(clock, length, attrs))
  }

  /**
   * 返回按时钟排序、无重叠且相邻等属性段已合并的区间。
   *
   * 重叠属性区间先按边界切成互不重叠片段，重叠片段的属性做引用并集；再线性
   * 合并属性引用数组相等的连续片段。不变量：输出覆盖输入区间并集且每一时钟的
   * 属性等于所有覆盖输入属性的并集。
   */
  getIds () {
    const ids = this._ids
    if (!this.sorted) {
      this.sorted = true
      ids.sort((a, b) => a.clock - b.clock)
      /**
       * 算法从左到右观察相邻范围。若左范围跨入右范围，先在右起点切分并把余段
       * 插回有序位置；起点相同时把短段属性合并，长段余量继续参与后续比较。
       * 最后再用读写双指针合并属性完全相同的相邻段。
       */
      for (let i = 0; i < ids.length - 1;) {
        const range = ids[i]
        const nextRange = ids[i + 1]
        // 先让相邻范围起点对齐；左范围跨界时在右起点切分。
        if (range.clock < nextRange.clock) {
          if (range.clock + range.len > nextRange.clock) {
            // 左余段与右范围从同一时钟开始，下一轮合并属性。
            const diff = nextRange.clock - range.clock
            ids[i] = new AttrRange(range.clock, diff, range.attrs)
            ids.splice(i + 1, 0, new AttrRange(nextRange.clock, range.len - diff, range.attrs))
          }
          i++
          continue
        }
        // 起点相同：短长度范围取得两侧属性并集，长范围余量保留原属性。
        const largerRange = range.len > nextRange.len ? range : nextRange
        const smallerLen = range.len < nextRange.len ? range.len : nextRange.len
        ids[i] = new AttrRange(range.clock, smallerLen, idmapAttrRangeJoin(range.attrs, nextRange.attrs))
        if (range.len === nextRange.len) {
          ids.splice(i + 1, 1)
        } else {
          ids[i + 1] = new AttrRange(range.clock + smallerLen, largerRange.len - smallerLen, largerRange.attrs)
          array.bubblesortItem(ids, i + 1, (a, b) => a.clock - b.clock)
        }
        if (smallerLen === 0) i++
      }
      while (ids.length > 0 && ids[0].len === 0) {
        ids.splice(0, 1)
      }
      // 读指针 i、写指针 j 原地合并连续且属性引用数组相等的范围。
      let i, j
      for (i = 1, j = 1; i < ids.length; i++) {
        const left = ids[j - 1]
        const right = ids[i]
        if (left.clock + left.len === right.clock && idmapAttrsEqual(left.attrs, right.attrs)) {
          ids[j - 1] = new AttrRange(left.clock, left.len + right.len, left.attrs)
        } else if (right.len !== 0) {
          if (j < i) {
            ids[j] = right
          }
          j++
        }
      }
      ids.length = ids.length === 0 ? 0 : (ids[j - 1].len === 0 ? j - 1 : j)
    }
    return ids
  }
}

/**
 * 把多个客户端 ID 区间映射到去重属性集合。
 *
 * `clients` 保存规范化区间；`attrs` 保存规范属性对象；`attrsH` 以稳定哈希复用
 * 等值属性。一个已覆盖区间即使属性数组为空，也仍属于映射。
 *
 * @template Attrs
 */
export class IdMap {
  /** 初始化空区间映射与属性驻留表。 */
  constructor () {
    /**
     * 客户端到属性区间容器的映射。
     *
     * @type {Map<number,AttrRanges<Attrs>>}
     */
    this.clients = new Map()
    /**
     * 稳定属性哈希到规范属性对象的索引。
     *
     * @type {Map<string, ContentAttribute<Attrs>>}
     */
    this.attrsH = new Map()
    /**
     * 当前映射驻留的规范属性对象集合。
     *
     * @type {Set<ContentAttribute<Attrs>>}
     */
    this.attrs = new Set()
  }

  /**
   * 按客户端遍历规范化后的属性区间。
   *
   * @param {(attrRange:AttrRange<Attrs>, client:number) => void} f
   */
  forEach (f) {
    this.clients.forEach((ranges, client) => {
      ranges.getIds().forEach((range) => {
        f(range, client)
      })
    })
  }

  /** 返回映射是否没有任何客户端区间。 */
  isEmpty () {
    return this.clients.size === 0
  }

  /**
   * 判断指定 ID 是否存在属性区间覆盖。
   *
   * @param {ID} id
   * @return {boolean}
   */
  hasId (id) {
    return this.has(id.client, id.clock)
  }

  /**
   * 判断指定客户端时钟是否存在映射覆盖。
   *
   * @param {number} client
   * @param {number} clock
   * @return {boolean}
   */
  has (client, clock) {
    const dr = this.clients.get(client)
    if (dr) {
      return findIndexInIdRanges(dr.getIds(), clock) !== null
    }
    return false
  }

  /**
   * 统计查询半开区间内被映射覆盖的 ID 数量。
   *
   * 空属性数组仍表示已覆盖；只有切片结果 `attrs=null` 才是空洞。实现二分后线性
   * 扫描，等价于切片求和但不分配对象。
   *
   * @param {number} client
   * @param {number} clock
   * @param {number} len
   * @return {number}
   */
  coveredLength (client, clock, len) {
    const dr = this.clients.get(client)
    let covered = 0
    if (dr) {
      const ranges = dr.getIds()
      const end = clock + len
      let index = findRangeStartInIdRanges(ranges, clock)
      if (index !== null) {
        for (; index < ranges.length; index++) {
          const r = ranges[index]
          if (r.clock >= end) break
          const from = r.clock < clock ? clock : r.clock
          const rEnd = r.clock + r.len
          const to = rEnd > end ? end : rEnd
          covered += to - from
        }
      }
    }
    return covered
  }

  /**
   * 按 ID 起点返回指定长度的属性切片。
   *
   * @param {ID} id
   * @param {number} len
   * @return {Array<MaybeAttrRange<Attrs>>}
   */
  sliceId (id, len) {
    return this.slice(id.client, id.clock, len)
  }

  /**
   * 把查询区间切成属性段与未覆盖段。
   *
   * 返回值严格覆盖完整查询区间；未映射空洞以 `attrs=null` 表示，已映射空属性以
   * `attrs=[]` 表示，两者不可混淆。
   *
   * @param {number} client
   * @param {number} clock
   * @param {number} len
   * @return {Array<MaybeAttrRange<Attrs>>}
   */
  slice (client, clock, len) {
    const dr = this.clients.get(client)
    /**
     * @type {Array<MaybeAttrRange<Attrs>>}
     */
    const res = []
    if (dr) {
      /**
       * @type {Array<AttrRange<Attrs>>}
       */
      const ranges = dr.getIds()
      let index = findRangeStartInIdRanges(ranges, clock)
      if (index !== null) {
        let prev = null
        while (index < ranges.length) {
          let r = ranges[index]
          if (r.clock < clock) {
            r = new AttrRange(clock, r.len - (clock - r.clock), r.attrs)
          }
          if (r.clock + r.len > clock + len) {
            r = new AttrRange(r.clock, clock + len - r.clock, r.attrs)
          }
          if (r.len <= 0) break
          const prevEnd = prev != null ? prev.clock + prev.len : clock
          if (prevEnd < r.clock) {
            res.push(createMaybeAttrRange(prevEnd, r.clock - prevEnd, null))
          }
          prev = r
          res.push(r)
          index++
        }
      }
    }
    if (res.length > 0) {
      const last = res[res.length - 1]
      const end = last.clock + last.len
      if (end < clock + len) {
        res.push(createMaybeAttrRange(end, clock + len - end, null))
      }
    } else {
      res.push(createMaybeAttrRange(clock, len, null))
    }
    return res
  }

  /**
   * 加入带属性的非零 ID 区间。
   *
   * 属性先经哈希驻留为当前 IdMap 的规范对象，再追加到客户端区间容器。
   *
   * @param {number} client
   * @param {number} clock
   * @param {number} len
   * @param {Array<ContentAttribute<Attrs>>} attrs
   */
  add (client, clock, len, attrs) {
    if (len === 0) return
    attrs = _ensureAttrs(this, attrs)
    const ranges = this.clients.get(client)
    if (ranges == null) {
      this.clients.set(client, new AttrRanges([new AttrRange(clock, len, attrs)]))
    } else {
      ranges.add(clock, len, attrs)
    }
  }

  /**
   * 从映射删除指定半开区间，但保留属性驻留表供其他范围复用。
   *
   * @param {number} client
   * @param {number} clock
   * @param {number} len
   */
  delete (client, clock, len) {
    _deleteRangeFromIdSet(this, client, clock, len)
  }
}

/**
 * 按对象引用判断属性数组是否包含指定属性。
 *
 * @template T
 * @param {Array<T>} attrs
 * @param {T} attr
 *
 */
const idmapAttrsHas = (attrs, attr) => attrs.find(a => a === attr)

/**
 * 比较两个规范属性引用数组是否表示同一无序集合。
 *
 * @template T
 * @param {Array<T>} a
 * @param {Array<T>} b
 */
export const idmapAttrsEqual = (a, b) => a.length === b.length && a.every(v => idmapAttrsHas(b, v))

/**
 * 合并多个 IdMap，并在结果内重新驻留属性定义。
 *
 * 每个客户端一次收集所有输入范围，再把属性对象映射到结果 IdMap 的规范引用；
 * 后续 `AttrRanges.getIds()` 负责重叠拆分与属性并集。输入顺序不改变覆盖和属性集。
 *
 * @template T
 * @param {Array<IdMap<T>>} ams
 * @return {IdMap<T>} 新 IdMap。
 */
export const mergeIdMaps = ams => {
  /**
   * 输入属性对象到结果规范属性对象的映射。
   *
   * @type {Map<ContentAttribute<any>,ContentAttribute<any>>}
   */
  const attrMapper = new Map()
  const merged = createIdMap()
  for (let amsI = 0; amsI < ams.length; amsI++) {
    ams[amsI].clients.forEach((rangesLeft, client) => {
      if (!merged.clients.has(client)) {
        // 客户端首次出现时一次收集当前及后续全部范围。
        let ids = rangesLeft.getIds().slice()
        for (let i = amsI + 1; i < ams.length; i++) {
          const nextIds = ams[i].clients.get(client)
          if (nextIds) {
            array.appendTo(ids, nextIds.getIds())
          }
        }
        ids = ids.map(id => new AttrRange(id.clock, id.len, id.attrs.map(attr =>
          map.setIfUndefined(attrMapper, attr, () =>
            _ensureAttrs(merged, [attr])[0]
          )
        )))
        merged.clients.set(client, new AttrRanges(ids))
      }
    })
  }
  return merged
}

/**
 * 为 IdSet 的每个区间附加同一组属性，生成 IdMap。
 *
 * 属性先在目标映射中驻留并按引用去重；源 IdSet 已规范化，映射后的 AttrRanges
 * 可直接标记为有序。
 *
 * @param {IdSet} idset
 * @param {Array<ContentAttribute<any>>} attrs
 */
export const createIdMapFromIdSet = (idset, attrs) => {
  const idmap = createIdMap()
  // 把外部属性映射为目标 IdMap 的规范引用。
  attrs = _ensureAttrs(idmap, attrs)
  // 同一属性引用只保留一次。
  /**
   * @type {Array<ContentAttribute<any>>}
   */
  const checkedAttrs = []
  attrs.forEach(attr => {
    if (!idmapAttrsHas(checkedAttrs, attr)) {
      checkedAttrs.push(attr)
    }
  })
  idset.clients.forEach((ranges, client) => {
    const attrRanges = new AttrRanges(ranges.getIds().map(range => new AttrRange(range.clock, range.len, checkedAttrs)))
    attrRanges.sorted = true // 源 IdSet 已规范化，映射不会改变区间顺序。
    idmap.clients.set(client, attrRanges)
  })
  return idmap
}

/**
 * 丢弃 IdMap 属性并构造覆盖同一区间并集的 IdSet。
 *
 * `IdRanges.add()` 会把相邻属性段合并，故结果只保留覆盖信息。
 *
 * @param {IdMap<any>} idmap
 * @return {IdSet}
 */
export const createIdSetFromIdMap = idmap => {
  const idset = createIdSet()
  idmap.clients.forEach((ranges, client) => {
    const idRanges = new IdRanges([])
    ranges.getIds().forEach(range => idRanges.add(range.clock, range.len))
    idset.clients.set(client, idRanges)
  })
  return idset
}

/**
 * 确定性编码 IdMap，并对属性名与完整属性定义建立反向引用。
 *
 * client ID 升序且以差值编码；每个客户端范围复用 ID 集差分游标。属性第一次出现
 * 时写定义，其中名称也按编号去重；之后只写属性编号。编号由首次遍历顺序决定，
 * 所以规范区间和 client 排序共同保证稳定字节。
 *
 * @template Attr
 * @param {IdSetEncoderV1 | IdSetEncoderV2} encoder
 * @param {IdMap<Attr>} idmap
 *
 * @private
 * @function
 */
export const writeIdMap = (encoder, idmap) => {
  encoding.writeVarUint(encoder.restEncoder, idmap.clients.size)
  let lastWrittenClientId = 0
  /**
   * @type {Map<ContentAttribute<Attr>, number>}
   */
  const visitedAttributions = map.create()
  /**
   * @type {Map<string, number>}
   */
  const visitedAttrNames = map.create()
  // client ID 升序，既支持非负差值又保证确定性。
  array.from(idmap.clients.entries())
    .sort((a, b) => a[0] - b[0])
    .forEach(([client, _idRanges]) => {
      const attrRanges = _idRanges.getIds()
      encoder.resetIdSetCurVal()
      const diff = client - lastWrittenClientId
      encoding.writeVarUint(encoder.restEncoder, diff)
      lastWrittenClientId = client
      const len = attrRanges.length
      encoding.writeVarUint(encoder.restEncoder, len)
      for (let i = 0; i < len; i++) {
        const item = attrRanges[i]
        const attrs = item.attrs
        const attrLen = attrs.length
        encoder.writeIdSetClock(item.clock)
        encoder.writeIdSetLen(item.len)
        encoding.writeVarUint(encoder.restEncoder, attrLen)
        for (let j = 0; j < attrLen; j++) {
          const attr = attrs[j]
          const attrId = visitedAttributions.get(attr)
          if (attrId != null) {
            encoding.writeVarUint(encoder.restEncoder, attrId)
          } else {
            const newAttrId = visitedAttributions.size
            visitedAttributions.set(attr, newAttrId)
            encoding.writeVarUint(encoder.restEncoder, newAttrId)
            const attrNameId = visitedAttrNames.get(attr.name)
            // 属性名独立去重，多个不同值可共享同一名称编号。
            if (attrNameId != null) {
              encoding.writeVarUint(encoder.restEncoder, attrNameId)
            } else {
              const newAttrNameId = visitedAttrNames.size
              encoding.writeVarUint(encoder.restEncoder, newAttrNameId)
              encoding.writeVarString(encoder.restEncoder, attr.name)
              visitedAttrNames.set(attr.name, newAttrNameId)
            }
            encoding.writeAny(encoder.restEncoder, /** @type {any} */ (attr.val))
          }
        }
      }
    })
}

/**
 * 使用 V2 ID 集差分编码器序列化 IdMap。
 *
 * @param {IdMap<any>} idmap
 */
export const encodeIdMap = idmap => {
  const encoder = new IdSetEncoderV2()
  writeIdMap(encoder, idmap)
  return encoder.toUint8Array()
}

/**
 * 解码 IdMap，并重建属性编号、名称编号及驻留索引。
 *
 * client ID 由非负差值累积；属性编号首次出现时必须同时解码名称引用与值。所有
 * 区间完成后再为属性计算哈希，恢复 `attrs`/`attrsH` 不变量。
 *
 * @param {IdSetDecoderV1 | IdSetDecoderV2} decoder
 * @return {IdMap<any>}
 *
 * @private
 * @function
 */
export const readIdMap = decoder => {
  const idmap = new IdMap()
  const numClients = decoding.readVarUint(decoder.restDecoder)
  /**
   * @type {Array<ContentAttribute<any>>}
   */
  const visitedAttributions = []
  /**
   * @type {Array<string>}
   */
  const visitedAttrNames = []
  let lastClientId = 0
  for (let i = 0; i < numClients; i++) {
    decoder.resetDsCurVal()
    const client = lastClientId + decoding.readVarUint(decoder.restDecoder)
    lastClientId = client
    const numberOfDeletes = decoding.readVarUint(decoder.restDecoder)
    /**
     * @type {Array<AttrRange<any>>}
     */
    const attrRanges = []
    for (let i = 0; i < numberOfDeletes; i++) {
      const rangeClock = decoder.readDsClock()
      const rangeLen = decoder.readDsLen()
      /**
       * @type {Array<ContentAttribute<any>>}
       */
      const attrs = []
      const attrsLen = decoding.readVarUint(decoder.restDecoder)
      for (let j = 0; j < attrsLen; j++) {
        const attrId = decoding.readVarUint(decoder.restDecoder)
        if (attrId >= visitedAttributions.length) {
          // 新属性编号：先解析或复用名称，再读取值并登记。
          const attrNameId = decoding.readVarUint(decoder.restDecoder)
          if (attrNameId >= visitedAttrNames.length) {
            visitedAttrNames.push(decoding.readVarString(decoder.restDecoder))
          }
          visitedAttributions.push(new ContentAttribute(visitedAttrNames[attrNameId], decoding.readAny(decoder.restDecoder)))
        }
        attrs.push(visitedAttributions[attrId])
      }
      attrRanges.push(new AttrRange(rangeClock, rangeLen, attrs))
    }
    idmap.clients.set(client, new AttrRanges(attrRanges))
  }
  visitedAttributions.forEach(attr => {
    idmap.attrs.add(attr)
    idmap.attrsH.set(attr.hash(), attr)
  })
  return idmap
}

/**
 * 从 V2 差分字节解码 IdMap。
 *
 * @param {Uint8Array} data
 * @return {IdMap<any>}
 */
export const decodeIdMap = data => readIdMap(new IdSetDecoderV2(decoding.createDecoder(data)))

/**
 * 把属性数组驻留为指定 IdMap 内的规范对象引用。
 *
 * 已属于映射的对象原样复用；否则按稳定哈希查找或登记。返回顺序与输入一致。
 *
 * @template Attrs
 * @param {IdMap<Attrs>} idmap
 * @param {Array<ContentAttribute<Attrs>>} attrs
 * @return {Array<ContentAttribute<Attrs>>}
 */
const _ensureAttrs = (idmap, attrs) => attrs.map(attr =>
  idmap.attrs.has(attr)
    ? attr
    : map.setIfUndefined(idmap.attrsH, attr.hash(), () => {
      idmap.attrs.add(attr)
      return attr
    }))

/** 创建空 IdMap。 */
export const createIdMap = () => new IdMap()

/**
 * 返回 IdMap 差集并复用源映射的属性驻留表。
 *
 * 区间容器是新的；属性定义不可变且可安全共享。结果后续新增属性时仍能与源映射
 * 使用相同规范引用。
 *
 * @todo 重命名为 `excludeIdMap`。
 *
 * @template {IdMap<any>} ISet
 * @param {ISet} set
 * @param {IdSet | IdMap<any>} exclude
 * @return {ISet}
 */
export const diffIdMap = (set, exclude) => {
  const diffed = _diffSet(set, exclude)
  diffed.attrs = set.attrs
  diffed.attrsH = set.attrsH
  return diffed
}

/** 返回两个 IdMap/IdSet 的区间交集，并以左侧属性为结果基础。 */
export const intersectMaps = _intersectSets

/**
 * 按属性数组谓词筛选 IdMap 区间。
 *
 * 命中区间复制边界并把其属性重新登记到结果驻留表；未命中客户端不会创建空键。
 *
 * @template Attrs
 * @param {IdMap<Attrs>} idmap
 * @param {(attr: Array<ContentAttribute<Attrs>>) => boolean} predicate
 * @return {IdMap<Attrs>}
 */
export const filterIdMap = (idmap, predicate) => {
  const filtered = createIdMap()
  idmap.clients.forEach((ranges, client) => {
    /**
     * @type {Array<AttrRange<Attrs>>}
     */
    const attrRanges = []
    ranges.getIds().forEach((range) => {
      if (predicate(range.attrs)) {
        const rangeCpy = range.copyWith(range.clock, range.len)
        attrRanges.push(rangeCpy)
        rangeCpy.attrs.forEach(attr => {
          filtered.attrs.add(attr)
          filtered.attrsH.set(attr.hash(), attr)
        })
      }
    })
    if (attrRanges.length > 0) {
      filtered.clients.set(client, new AttrRanges(attrRanges))
    }
  })
  return filtered
}
