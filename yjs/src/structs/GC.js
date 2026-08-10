import { AbstractStruct, addStructToIdSet } from './AbstractStruct.js'
import { createID } from '../utils/ID.js'

/** 更新中表示已垃圾回收区间的结构引用号。 */
export const structGCRefNumber = 0

/**
 * 表示内容已被永久回收、仅保留因果时钟占位的连续区间。
 *
 * GC 结构始终视为已删除；它保留 ID 与长度，使远端仍能解析依赖和删除集。
 * @private
 */
export class GC extends AbstractStruct {
  /** GC 区间始终代表已删除且已回收的内容。 */
  get deleted () {
    return true
  }

  /** GC 已处于删除终态，因此删除操作为空。 */
  delete () {}

  /**
   * 合并右侧连续的 GC 区间。
   *
   * @param {GC | Skip | Item} right
   * @return {boolean}
   */
  mergeWith (right) {
    if (this.constructor !== right.constructor) {
      return false
    }
    this.length += right.length
    return true
  }

  /**
   * 把 GC 区间加入删除集、插入集与结构存储。
   *
   * `offset` 会裁掉已知前缀；集成后剩余区间同时存在于三个索引中，保证同步与
   * 后续状态向量计算看到相同边界。
   *
   * @param {Transaction} transaction
   * @param {number} offset - @todo remove offset parameter
   */
  integrate (transaction, offset) {
    if (offset > 0) {
      this.id.clock += offset
      this.length -= offset
    }
    transaction.deleteSet.add(this.id.client, this.id.clock, this.length)
    addStructToIdSet(transaction.insertSet, this)
    transaction.doc.store.add(this)
  }

  /**
   * 编码 GC 引用号与当前切片长度。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   * @param {number} offsetEnd
   */
  write (encoder, offset, offsetEnd) {
    encoder.writeInfo(structGCRefNumber)
    encoder.writeLen(this.length - offset - offsetEnd)
  }

  /**
   * 在指定时钟偏移处分割 GC 区间并返回右半段。
   *
   * 本方法只调整两个结构的 ID/长度，不维护存储数组；`splitStruct()` 的调用方负责
   * 插入右段，并在事务内登记后续合并。
   *
   * @param {number} diff
   */
  splice (diff) {
    const other = new GC(createID(this.id.client, this.id.clock + diff), this.length - diff)
    this.length = diff
    return other
  }
}

/**
 * 声明 GC 的稳定线格式引用号。
 *
 * @type {0}
 */
GC.prototype.ref = structGCRefNumber

/**
 * 标记 GC 不是可承载用户内容的 `Item`。
 *
 * @type {false}
 */
GC.prototype.isItem = false
