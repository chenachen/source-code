import * as decoding from 'lib0/decoding'
import * as binary from 'lib0/binary'
import * as map from 'lib0/map'
import * as array from 'lib0/array'
import * as math from 'lib0/math'
import * as encoding from 'lib0/encoding'
import * as number from 'lib0/number'

import { createID, ID } from './ID.js'
import { Item } from '../structs/Item.js'
import { readItemContent } from '../ytype.js'
import { findIndexCleanStart } from './transaction-helpers.js'
import { Skip } from '../structs/Skip.js'
import { createIdSet, IdRange } from './ids.js'
import { sliceStruct } from './updates.js'
import { GC } from '../structs/GC.js'
import { writeStructs } from './encoding-helpers.js'

/**
 * 从更新的结构段解码按客户端分组的 `BlockSet`。
 *
 * 每个客户端先给出结构数量与起始时钟，后续结构长度连续推进 `clock`。info 低五位
 * 选择 GC、Skip 或 Item 内容；Item 的左右锚点决定父信息能否从邻居复制。
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder 结构更新解码器。
 * 解码只创建未集成结构，left/right 仍为空；不检查依赖、不改 Doc，也不应用尾部删除集。
 * 完成后 decoder 的通用流位于删除集起点，调用方必须继续消费它。
 *
 * @return {BlockSet} 每个 client 的 refs 按 clock 连续排列，消费游标初始为 0。
 *
 * @private
 * @function
 */
export const readBlockSet = (decoder) => {
  const clientRefs = new BlockSet()
  const numOfStateUpdates = decoding.readVarUint(decoder.restDecoder)
  for (let i = 0; i < numOfStateUpdates; i++) {
    const numberOfBlocks = decoding.readVarUint(decoder.restDecoder)
    /**
     * @type {Array<GC|Item|Skip>}
     */
    const refs = new Array(numberOfBlocks)
    const client = decoder.readClient()
    let clock = decoding.readVarUint(decoder.restDecoder)
    clientRefs.clients.set(client, new BlockRange(refs))
    for (let i = 0; i < numberOfBlocks; i++) {
      const info = decoder.readInfo()
      switch (binary.BITS5 & info) {
        case 0: { // 已回收区间。
          const len = decoder.readLen()
          refs[i] = new GC(createID(client, clock), len)
          clock += len
          break
        }
        case 10: { // 当前更新不携带的时钟缺口。
          // @todo 可利用 Skip 提前标记缺失依赖，减少后续重复检查。
          const len = decoding.readVarUint(decoder.restDecoder)
          refs[i] = new Skip(createID(client, clock), len)
          clock += len
          break
        }
        default: { // 带内容的 Item。
          /**
           * 按 info 位决定哪些定位字段存在。
           *
           * 不变量：只有 origin 与 rightOrigin 都缺失时才显式携带 parent；否则集成
           * 阶段会从相邻 Item 恢复父上下文。
           */
          const cantCopyParentInfo = (info & (binary.BIT7 | binary.BIT8)) === 0
          // 无左右锚点时，父引用只能是 doc.share 顶层键或父 Item ID。
          // @type {string|null}
          const block = new Item(
            createID(client, clock),
            null, // 当前左邻在集成时解析。
            (info & binary.BIT8) === binary.BIT8 ? decoder.readLeftID() : null, // 原始左锚点。
            null, // 当前右邻在集成时解析。
            (info & binary.BIT7) === binary.BIT7 ? decoder.readRightID() : null, // 原始右锚点。
            cantCopyParentInfo ? (decoder.readParentInfo() ? decoder.readString() : decoder.readLeftID()) : null, // 父键或父 Item ID。
            cantCopyParentInfo && (info & binary.BIT6) === binary.BIT6 ? decoder.readString() : null, // 父映射键。
            readItemContent(decoder, info) // 按低五位解码内容。
          )
          refs[i] = block
          clock += block.length
        }
      }
    }
  }
  return clientRefs
}

/**
 * 把 `BlockSet` 编码为按客户端分组的结构段。
 *
 * 客户端按 ID 降序输出；每个客户端交给 `writeStructs()` 写完整时钟范围。
 *
 * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
 * @param {BlockSet} blocks 每个 client 至少有一个 refs；i 是接收消费游标，编码仍写 refs 的全量范围。
 */
export const writeBlockSet = (encoder, blocks) => {
  // 写入携带结构的客户端数量。
  encoding.writeVarUint(encoder.restEncoder, blocks.clients.size)
  // 按 client ID 降序输出客户端结构段。
  array.from(blocks.clients.entries()).sort((a, b) => b[0] - a[0]).forEach(([client, blockrange]) => {
    writeStructs(encoder, blockrange.refs, client, [new IdRange(0, number.MAX_SAFE_INTEGER)])
  })
}

/** 保存一个客户端的解码结构数组及当前消费游标。 */
class BlockRange {
  /**
   * 创建尚未消费的结构范围。
   *
   * @param {Array<Item|GC|Skip>} refs 一次更新中某 client 的按 clock 排序结构；构造器保留数组身份。
   */
  constructor (refs) {
    /** 下一待消费 refs 的索引；因果算法预取时递增，转入 pending 前可回退。 */
    this.i = 0
    /**
     * 解码结构及 Skip 占位的原数组，排除/合并会原地切分或整体替换。
     * @type {Array<Item | GC | Skip>}
     */
    this.refs = refs
  }
}

/**
 * 按客户端保存更新中解码出的结构块。
 *
 * 它是更新字节与 `StructStore` 之间的中间表示：可先排除本地已知区间、合并重复
 * 更新，再交给因果集成算法逐客户端消费。
 */
export class BlockSet {
  /** 创建空客户端结构映射。 */
  constructor () {
    /**
     * 解码 client 到结构范围的索引；范围与结构可由合并输入直接共享，不是深拷贝。
     * @type {Map<number, BlockRange>}
     */
    this.clients = map.create()
  }

  /**
   * 把所有非 Skip 结构归并为插入 ID 集。
   *
   * 相邻结构合并为最大连续范围；Skip 断开范围，不会被误报为当前更新携带内容。
   * 不读取 BlockRange.i，因此已经消费的 refs 仍参与提取。
   *
   * @return {IdSet} 新建插入集，包含 Item/GC 的结构 ID，不表达可见内容或删除。
   */
  toIdSet () {
    const inserts = createIdSet()
    this.clients.forEach((ranges, clientid) => {
      let lastClock = 0
      let lastLen = 0
      ranges.refs.forEach(block => {
        if (block instanceof Skip) return
        if (lastClock + lastLen === block.id.clock) {
          // 常见连续路径：扩展前一范围。
          lastLen += block.length
        } else {
          lastLen > 0 && inserts.add(clientid, lastClock, lastLen)
          lastClock = block.id.clock
          lastLen = block.length
        }
      })
      inserts.add(clientid, lastClock, lastLen)
    })
    return inserts
  }

  /**
   * 从更新结构中排除指定 ID 区间，并以 Skip 保留时钟间距。
   *
   * 排除边界落在现有结构内部时，`findIndexCleanStart()` 先切分；相交结构随后
   * 换成一个 Skip。Skip 使用排除区间本身的起点和长度，故排除范围越过更新首尾
   * 时也会保留这段边界，而非只取交集。剩余真实结构的绝对 ID 不变。
   * 按较小的客户端键集合遍历；遇到任一侧不存在的客户端会直接 return，结束整个方法。
   *
   * @param {IdSet} exclude 已知真实结构的 ID 集；不要把本地 Skip 缺口放进该集合。
   */
  exclude (exclude) {
    const clientids = this.clients.size < exclude.clients.size ? this.clients.keys() : exclude.clients.keys()
    for (const client of clientids) {
      const range = exclude.clients.get(client)
      const structs = this.clients.get(client)?.refs
      if (range == null || structs == null) return
      const firstStruct = structs[0]
      const lastStruct = structs[structs.length - 1]
      const idranges = range.getIds()
      for (let i = 0; i < idranges.length; i++) {
        const range = idranges[i]
        let startIndex = 0
        if (range.clock >= lastStruct.id.clock + lastStruct.length) continue
        if (range.clock > firstStruct.id.clock) {
          startIndex = findIndexCleanStart(null, structs, range.clock)
        }
        let endIndex = structs.length // 必须在起点切分可能修改数组后再计算。
        if (range.clock + range.len <= firstStruct.id.clock) continue
        if (range.clock + range.len < lastStruct.id.clock + lastStruct.length) {
          endIndex = findIndexCleanStart(null, structs, range.clock + range.len)
        }
        if (startIndex < endIndex) {
          structs[startIndex] = new Skip(new ID(client, range.clock), range.len)
          const d = endIndex - startIndex
          if (d > 1) {
            structs.splice(startIndex + 1, d - 1)
          }
        }
      }
    }
  }

  /**
   * 把另一个 BlockSet 的结构并入当前集合并清空输入集合。
   *
   * 不重叠时直接拼接并按需补 Skip；重叠时双游标过滤 Skip 和已覆盖区间，再对
   * 部分重叠结构调用 sliceStruct。当前裁剪实参是剩余长度，而 sliceStruct 按左侧
   * offset 解释；非对称重叠可能丢失覆盖，并在输出中形成原输入没有的 Skip。
   *
   * 输入是可消费的临时解码结构：重叠裁剪调用 `sliceStruct`，会修改传入 Item.content；
   * 没有已有 client 时复用输入 BlockRange。完成后清空 inserts.clients，调用者不得再把它当独立副本。
   *
   * @param {BlockSet} inserts 会被消费并清空的输入集合，不能传入已挂入 Doc 的结构。
   */
  insertInto (inserts) {
    inserts.clients.forEach((newranges, clientid) => {
      const ranges = this.clients.get(clientid)
      if (ranges == null) {
        this.clients.set(clientid, newranges)
      } else {
        const localIsLeft = ranges.refs[0].id.clock < newranges.refs[0].id.clock
        const leftRanges = (localIsLeft ? ranges : newranges).refs
        const rightRanges = (localIsLeft ? newranges : ranges).refs
        const lastBlockLeft = array.last(leftRanges)
        const firstBlockRight = rightRanges[0]
        const gapSize = firstBlockRight.id.clock - lastBlockLeft.id.clock - lastBlockLeft.length
        if (gapSize >= 0) {
          // 两组不重叠，可线性拼接。
          if (gapSize > 0) {
            leftRanges.push(new Skip(new ID(clientid, lastBlockLeft.id.clock + lastBlockLeft.length), gapSize))
          }
          for (let i = 0; i < rightRanges.length; i++) {
            leftRanges.push(rightRanges[i])
          }
          ranges.refs = leftRanges
        } else {
          // 两组重叠，必须过滤重复并裁剪边界。
          /**
           * 合并结果的暂存数组；真实区段按 nextExpectedClock 连续追加，主循环在缺口处补 Skip。
           *
           * @type {Array<GC|Item|Skip>}
           */
          const result = []
          let nextExpectedClock = leftRanges[0].id.clock
          /**
           * 追加一个已裁剪的真实结构，并推进下一期望时钟。
           *
           * @param {Item|GC|Skip} block
           */
          const addToResult = block => {
            result.push(block)
            nextExpectedClock = block.id.clock + block.length
          }
          let li = 0
          let ri = 0
          /**
           * @type {Item|GC|Skip|undefined}
           */
          let lblock = leftRanges[li]
          /**
           * @type {Item|GC|Skip|undefined}
           */
          let rblock = rightRanges[ri]
          /** 过滤左侧已覆盖区间，以剩余长度为实参切片，再追加恰好接续结果的结构。 */
          const applyLeft = () => {
            if (lblock === undefined) return
            // 跳过左侧缺口及已经被结果覆盖的结构。
            while (lblock !== undefined && (lblock.constructor === Skip || lblock.id.clock + lblock.length <= nextExpectedClock)) {
              lblock = leftRanges[++li]
            }
            // 当前实参是区间末端到 nextExpectedClock 的长度，并非应排除的前缀长度。
            if (lblock !== undefined && lblock.id.clock < nextExpectedClock && lblock.id.clock + lblock.length > nextExpectedClock) {
              lblock = sliceStruct(lblock, lblock.id.clock + lblock.length - nextExpectedClock)
            }
            // 连续真实结构可直接追加，遇到缺口或错位停止。
            while (lblock !== undefined && lblock.id.clock === nextExpectedClock && lblock.constructor !== Skip) {
              addToResult(lblock)
              lblock = leftRanges[++li]
            }
          }
          /** 对右侧输入执行与 `applyLeft` 对称的过滤、裁剪和追加。 */
          const applyRight = () => {
            // 跳过右侧缺口及已经被结果覆盖的结构。
            while (rblock !== undefined && (rblock.constructor === Skip || rblock.id.clock + rblock.length <= nextExpectedClock)) {
              rblock = rightRanges[++ri]
            }
            // 与左侧一样传入剩余长度；sliceStruct 会把它解释为左侧 offset。
            if (rblock !== undefined && rblock.id.clock < nextExpectedClock && rblock.id.clock + rblock.length > nextExpectedClock) {
              rblock = sliceStruct(rblock, rblock.id.clock + rblock.length - nextExpectedClock)
            }
            // 连续真实结构可直接追加。
            while (rblock !== undefined && rblock.id.clock === nextExpectedClock && rblock.constructor !== Skip) {
              addToResult(rblock)
              rblock = rightRanges[++ri]
            }
          }
          for (; li < leftRanges.length && ri < rightRanges.length;) {
            applyLeft()
            applyRight()
            // 两侧下一真实结构都晚于期望时钟时，显式保留空洞。
            const minNextClock = math.min(lblock?.id.clock || 0, rblock?.id.clock || 0)
            const gapSize = minNextClock - nextExpectedClock
            if (gapSize > 0) {
              addToResult(new Skip(new ID(clientid, nextExpectedClock), gapSize))
            }
          }
          while (li < leftRanges.length) {
            applyLeft()
            if (lblock !== undefined) {
              const gapSize = lblock.id.clock - nextExpectedClock
              if (gapSize > 0) {
                addToResult(new Skip(new ID(clientid, nextExpectedClock), gapSize))
              }
            }
          }
          while (ri < rightRanges.length) {
            applyRight()
            if (rblock !== undefined) {
              const gapSize = rblock.id.clock - nextExpectedClock
              if (gapSize > 0) {
                addToResult(new Skip(new ID(clientid, nextExpectedClock), gapSize))
              }
            }
          }
          ranges.refs = result
        }
      }
    })
    inserts.clients.clear()
  }
}
