import * as math from 'lib0/math'
import * as error from 'lib0/error'
import * as map from 'lib0/map'
import * as set from 'lib0/set'

import { createID } from './ID.js'

/** 本模块提供结构集成、区间切分、回收与格式清理所共享的底层事务辅助函数。 */

/**
 * 在按 clock 连续排序的 client 结构数组中，定位覆盖目标 clock 的结构。
 *
 * 不变量：调用方必须先确认目标 clock 小于该 client 的当前 state；否则“找不到”属于内部错误。初始按 clock 比例选 pivot，后续退化为普通二分。
 *
 * @param {Array<Item|GC|Skip>} structs - 同一 client 的有序结构数组。
 * @param {number} clock - 必须落在某个结构半开区间内的逻辑时钟。
 * @return {number} 覆盖该 clock 的结构索引。
 *
 * @private
 * @function
 */
export const findIndexSS = (structs, clock) => {
  let left = 0
  let right = structs.length - 1
  let mid = structs[right]
  let midclock = mid.id.clock
  if (midclock === clock) {
    return right
  }
  // 比例 pivot 只在目标分布接近均匀时可能首轮命中；失败后仍按区间中点二分，其收益尚待验证。
  let midindex = math.floor((clock / (midclock + mid.length - 1)) * right) // 按时钟比例选首次 pivot。
  while (left <= right) {
    mid = structs[midindex]
    midclock = mid.id.clock
    if (midclock <= clock) {
      if (clock < midclock + mid.length) {
        return midindex
      }
      left = midindex + 1
    } else {
      right = midindex - 1
    }
    midindex = math.floor((left + right) / 2)
  }
  // StructStore 查询前应先检查 state，因此走到这里表示调用方破坏了目标存在性前提。
  throw error.unexpectedCase()
}

/**
 * 返回以目标 clock 起始的结构索引；若 clock 落在结构中间，先原地切分。
 *
 * @param {Transaction?} transaction - 可选事务，用于登记切分后待合并结构。
 * @param {Array<Item|GC|Skip>} structs - 同一 client 的结构数组。
 * @param {number} clock - 期望成为结构起点的 clock。
 */
export const findIndexCleanStart = (transaction, structs, clock) => {
  const index = findIndexSS(structs, clock)
  const struct = structs[index]
  if (struct.id.clock < clock) {
    structs.splice(index + 1, 0, splitStruct(transaction, struct, clock - struct.id.clock))
    return index + 1
  }
  return index
}

/**
 * 取得从给定 ID 起始的 Item，必要时先切分原结构。
 *
 * 前置条件：ID 已存在于 store；调用方必须先做 state 检查，否则会抛出内部错误。
 *
 * @param {Transaction} transaction
 * @param {ID} id
 * @return {Item}
 *
 * @private
 * @function
 */
export const getItemCleanStart = (transaction, id) => {
  const structs = /** @type {Array<Item>} */ (transaction.doc.store.clients.get(id.client))
  return structs[findIndexCleanStart(transaction, structs, id.clock)]
}

/**
 * 取得以给定 ID 结束的 Item，必要时在 ID 后切分原结构。
 *
 * 前置条件：ID 已存在于 store；返回结构的最后一个 clock 必定等于 `id.clock`。
 *
 * @param {Transaction} transaction
 * @param {StructStore} store
 * @param {ID} id
 * @return {Item}
 *
 * @private
 * @function
 */
export const getItemCleanEnd = (transaction, store, id) => {
  const structs = store.clients.get(id.client) || []
  const index = findIndexSS(structs, id.clock)
  const struct = structs[index]
  if (id.clock !== struct.id.clock + struct.length - 1 && struct.isItem) {
    structs.splice(index + 1, 0, /** @type {Item} */ (struct).split(transaction, id.clock - struct.id.clock + 1))
  }
  return /** @type {Item} */ (struct)
}

/**
 * 用新结构替换 store 中同起点结构，并登记 cleanup 阶段的相邻合并。
 *
 * @param {Transaction} tr - 当前事务。
 * @param {GC|Item} struct - 已存在且决定数组位置的旧结构。
 * @param {GC|Item} newStruct - ID 起点与旧结构一致的替代结构。
 *
 * @private
 * @function
 */
export const replaceStruct = (tr, struct, newStruct) => {
  const structs = /** @type {Array<GC|Item>} */ (tr.doc.store.clients.get(struct.id.client))
  structs[findIndexSS(structs, struct.id.clock)] = newStruct
  tr._mergeStructs.push(newStruct)
}

/**
 * 遍历精确覆盖指定半开 clock 区间的结构，并在两端必要处切分。
 *
 * @param {Transaction} transaction
 * @param {Array<Item|GC>} structs
 * @param {number} clockStart - 包含的起始 clock。
 * @param {number} len - 区间长度；零直接返回。
 * @param {function(GC|Item):void} f - 对区间内每个完整结构调用的回调。
 *
 * @function
 */
export const iterateStructs = (transaction, structs, clockStart, len, f) => {
  if (len === 0) {
    return
  }
  const clockEnd = clockStart + len
  let index = findIndexCleanStart(transaction, structs, clockStart)
  let struct
  do {
    struct = structs[index++]
    if (clockEnd < struct.id.clock + struct.length) {
      findIndexCleanStart(transaction, structs, clockEnd)
    }
    f(struct)
  } while (index < structs.length && structs[index].id.clock < clockEnd)
}

/**
 * 不切分结构地遍历指定 clock 区间，并用 offset/len 标出每个结构实际命中的片段。
 *
 * WHY：只读编码等路径无需改变 store；回调必须遵守片段边界，不能把整块内容误当成目标区间。
 *
 * @param {Array<Item|GC>} structs
 * @param {number} clockStart - 包含的起始 clock。
 * @param {number} len - 目标区间长度。
 * @param {(struct: GC|Item|Skip, offset:number, len:number)=>void} f - 接收原结构、结构内偏移与命中长度。
 *
 * @function
 */
export const iterateStructsWithoutSplits = (structs, clockStart, len, f) => {
  if (len === 0) {
    return
  }
  const clockEnd = clockStart + len
  for (
    let index = findIndexSS(structs, clockStart), struct = structs[index], clock = struct.id.clock;
    clock < clockEnd;
    struct = structs[++index], clock = struct.id.clock
  ) {
    const offset = clock < clockStart ? clockStart - clock : 0
    f(struct, offset, math.min(clock + struct.length, clockEnd) - clock)
    if (index + 1 === structs.length) break
  }
}

/**
 * 在 `diff` 处把任意 Item/GC/Skip 切成左右结构，并返回右半段。
 *
 * 有事务时把右半段加入 `_mergeStructs`，允许 cleanup 在临时边界不再需要时重新合并。
 * @param {Transaction?} transaction
 * @param {Item|GC|Skip} leftStruct
 * @param {number} diff
 * @return {GC|Item|Skip}
 *
 * @function
 * @private
 */
export const splitStruct = (transaction, leftStruct, diff) => {
  if (leftStruct.isItem) {
    return /** @type {Item} */ (leftStruct).split(transaction, diff)
  } else {
    const rightItem = leftStruct.splice(diff)
    transaction?._mergeStructs.push(rightItem)
    return rightItem
  }
}

/**
 * 根据文档当前 client clock 生成下一项 ID；只分配标识，不推进 state。
 *
 * @param {Transaction} transaction - 提供文档与 store 的当前事务。
 *
 * @private
 * @function
 */
export const nextID = transaction => {
  const y = transaction.doc
  return createID(y.clientID, y.store.getClock(y.clientID))
}

/**
 * 把已存在类型登记为直接变更；若其承载 Item 正在本事务中新增，则跳过类型自身事件。
 *
 * WHY：新子树的内部状态属于“插入该子树”的一个原子结果，再对其子类型发 change 会重复描述同一修改。
 *
 * @param {Transaction} transaction
 * @param {YType} type
 * @param {string|null} parentSub
 */
export const addChangedTypeToTransaction = (transaction, type, parentSub) => {
  const item = type._item
  if (item === null || !transaction.insertSet.hasId(item.id)) {
    map.setIfUndefined(transaction.changed, type, set.create).add(parentSub)
  }
}

/**
 * 从指定位置向左连续合并同删除状态、同构造类型且 `mergeWith` 兼容的结构。
 *
 * Map 当前值若指向被吞并的右 Item，必须改指向左 Item；最后一次性 splice 掉所有右结构。
 *
 * @param {Array<GC | Item | Skip>} structs - 将被原地压缩的结构数组。
 * @param {number} pos - 首个作为右操作数的索引。
 * @return {number} 被合并并移除的结构数。
 */
export const tryToMergeWithLefts = (structs, pos) => {
  let right = structs[pos]
  let left = structs[pos - 1]
  let i = pos
  for (; i > 0; right = left, left = structs[--i - 1]) {
    if (left.deleted === right.deleted && left.constructor === right.constructor) {
      if (left.mergeWith(/** @type {any} */ (right))) {
        if (right.isItem && /** @type {Item} */ (right).parentSub !== null && /** @type {YType} */ (/** @type {Item} */ (right).parent)._map.get(/** @type {Item} */ (right).parentSub) === right) {
          /** @type {YType} */ (right.parent)._map.set(right.parentSub, /** @type {Item} */ (left))
        }
        continue
      }
    }
    break
  }
  const merged = pos - i
  if (merged) {
    // 所有 mergeWith 已更新左结构内容，最后统一移除被吞并的右结构。
    structs.splice(pos + 1 - merged, merged)
  }
  return merged
}

/**
 * 扫描给定删除区间，把允许回收且未被 `keep` 固定的已删除 Item 转为 GC。
 *
 * 逆序处理删除区间，避免后续压缩相关工作遗漏更右侧结构；实际结构合并由 `tryMerge` 负责。
 *
 * @param {Transaction} tr - 提供 store 与 GC 变更记录的事务。
 * @param {IdSet} ds - 待尝试回收的删除 ID 区间。
 * @param {function(Item):boolean} gcFilter - 文档级回收许可函数。
 */
export const tryGcDeleteSet = (tr, ds, gcFilter) => {
  for (const [client, _deleteItems] of ds.clients.entries()) {
    const deleteItems = _deleteItems.getIds()
    const structs = /** @type {Array<Item>} */ (tr.doc.store.clients.get(client))
    for (let di = deleteItems.length - 1; di >= 0; di--) {
      const deleteItem = deleteItems[di]
      const endDeleteItemClock = deleteItem.clock + deleteItem.len
      for (
        let si = findIndexSS(structs, deleteItem.clock), struct = structs[si];
        si < structs.length && struct.id.clock < endDeleteItemClock;
        struct = structs[++si]
      ) {
        const struct = structs[si]
        if (deleteItem.clock + deleteItem.len <= struct.id.clock) {
          break
        }
        if (struct.isItem && struct.deleted && !(struct).keep && gcFilter(/** @type {Item} */ (struct))) {
          /** @type {Item} */ (struct).gc(tr, false)
        }
      }
    }
  }
}

/**
 * 在删除区间及其右邻接处合并兼容结构，压缩 store 的分段数量。
 *
 * @param {IdSet} ds - 决定需要检查哪些 client/clock 区间。
 * @param {StructStore} store - 将被原地压缩的结构存储。
 */
export const tryMerge = (ds, store) => {
  // 从右向左合并删除/已 GC 结构；数组收缩只影响已检查的右侧，且不会漏掉新形成的左邻接候选。
  ds.clients.forEach((_deleteItems, client) => {
    const deleteItems = _deleteItems.getIds()
    const structs = /** @type {Array<GC|Item>} */ (store.clients.get(client))
    for (let di = deleteItems.length - 1; di >= 0; di--) {
      const deleteItem = deleteItems[di]
      // 从删除区间末项的右邻居开始，才能同时覆盖删除边界两侧的新合并机会。
      const mostRightIndexToCheck = math.min(structs.length - 1, 1 + findIndexSS(structs, deleteItem.clock + deleteItem.len - 1))
      for (
        let si = mostRightIndexToCheck, struct = structs[si];
        si > 0 && struct.id.clock >= deleteItem.clock;
        struct = structs[si]
      ) {
        si -= 1 + tryToMergeWithLefts(structs, si)
      }
    }
  })
}

/**
 * 先回收给定删除区间，再合并相邻结构。
 *
 * @param {Transaction} tr - 当前事务。
 * @param {IdSet} idset - 待回收和压缩的 ID 区间。
 * @param {function(Item):boolean} gcFilter - 回收过滤器。
 */
export const tryGc = (tr, idset, gcFilter) => {
  tryGcDeleteSet(tr, idset, gcFilter)
  tryMerge(idset, tr.doc.store)
}

/**
 * 从删除位置附近反向删除同一属性键的重复格式项，无需计算完整格式上下文。
 *
 * 先向右越过删除/非 countable 项找到内容边界，再向左扫描间隙；每个键只保留最靠右、最终生效的格式项。
 *
 * @param {Transaction} transaction - 接收清理删除记录的事务。
 * @param {Item | null} item - 删除位置附近的起始项。
 */
export const cleanupContextlessFormattingGap = (transaction, item) => {
  if (!transaction.doc.cleanupFormatting) return 0
  // 向右越过格式/删除项，确定间隙的内容边界。
  while (item && item.right && (item.right.deleted || !item.right.countable)) {
    item = item.right
  }
  const attrs = new Set()
  // 向左回扫间隙；同键第二次出现即被右侧值覆盖。
  while (item && (item.deleted || !item.countable)) {
    if (!item.deleted && item.content.getRef() === 6) { // `ContentFormat` 的编码引用号为 6。
      const key = /** @type {ContentFormat} */ (item.content).key
      if (attrs.has(key)) {
        item.delete(transaction)
        transaction.cleanUps.add(item.id.client, item.id.clock, item.length)
      } else {
        attrs.add(key)
      }
    }
    item = item.left
  }
}

/**
 * 把一个格式项折叠进当前位置的有效格式映射；`null` 表示取消该键。
 *
 * @param {Map<string,any>} currentFormats - 将被原地更新的有效格式。
 * @param {ContentFormat} format - 待应用的键值变化。
 *
 * @private
 * @function
 */
export const updateCurrentFormats = (currentFormats, { key, value }) => {
  if (value === null) {
    currentFormats.delete(key)
  } else {
    currentFormats.set(key, value)
  }
}

/**
 * 删除字符串内容后清理间隙内被覆盖或与起点上下文等价的格式项。
 *
 * 不变量：`startFormats` 表示间隙左侧状态，`endFormats` 表示右侧最终生效项；删除 `curr` 之前的格式时同步修正 `currFormats`，让调用方后续扫描仍看到正确上下文。
 *
 * @param {Transaction} transaction
 * @param {Item} start
 * @param {Item|null} curr - 调用方扫描位置的排他端；函数会继续找到下一个内容项。
 * @param {Map<string,any>} startFormats
 * @param {Map<string,any>} currFormats
 * @return {number} 删除的格式项数量。
 *
 * @function
 */
export const cleanupFormattingGap = (transaction, start, curr, startFormats, currFormats) => {
  if (!transaction.doc.cleanupFormatting) return 0
  /**
   * @type {Item|null}
   */
  let end = start
  /**
   * @type {Map<string,ContentFormat>}
   */
  const endFormats = map.create()
  while (end && (!end.countable || end.deleted)) {
    if (!end.deleted && end.content.getRef() === 6) {
      const cf = /** @type {ContentFormat} */ (end.content)
      endFormats.set(cf.key, cf)
    }
    end = end.right
  }
  let cleanups = 0
  let reachedCurr = false
  while (start !== end) {
    if (curr === start) {
      reachedCurr = true
    }
    if (!start.deleted) {
      const content = start.content
      if (content.getRef() === 6) { // 引用号 6 已把内容缩窄为 ContentFormat。
        const { key, value } = /** @type {ContentFormat} */ (content)
        const startFormatValue = startFormats.get(key) ?? null
        if (endFormats.get(key) !== content || startFormatValue === value) {
          // 右侧有同键最终项，或左侧已具同值：当前格式不会改变可见结果，删除安全。
          start.delete(transaction)
          transaction.cleanUps.add(start.id.client, start.id.clock, start.length)
          cleanups++
          if (!reachedCurr && (currFormats.get(key) ?? null) === value && startFormatValue !== value) {
            if (startFormatValue === null) {
              currFormats.delete(key)
            } else {
              currFormats.set(key, startFormatValue)
            }
          }
        }
        if (!reachedCurr && !start.deleted) {
          updateCurrentFormats(currFormats, /** @type {ContentFormat} */ (content))
        }
      }
    }
    start = /** @type {Item} */ (start.right)
  }
  return cleanups
}
