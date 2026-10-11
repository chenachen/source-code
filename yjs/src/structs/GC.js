import { AbstractStruct, addStructToIdSet } from './AbstractStruct.js'
import { createID } from '../utils/ID.js'

/** 更新中表示已垃圾回收区间的结构引用号。 */
export const structGCRefNumber = 0

/**
 * 表示内容已被永久回收、仅保留因果时钟占位的连续区间。
 *
 * GC 结构始终视为已删除，只保留 ID 与长度，不再保存 Item 的父类型和左右锚点。
 * 依赖检查仍能确认该地址已到达；后续 Item 若需从这个地址恢复父上下文，会转为 GC。
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
   * 合并右侧同类 GC 区间；同客户端、时钟连续由调用方保证。
   *
   * @param {GC | Skip | Item} right 待并入的右区间；构造器不同则不修改当前长度。
   * @return {boolean} 同类时原地扩大左段并返回 true；调用方随后移除右段。
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
   * `offset` 会裁掉已知前缀；剩余区间既是本事务新获得的结构，也是已删除内容，
   * 因此同时登记 `insertSet` 和 `deleteSet`，再让存储记录剩余时钟区间。
   *
   * @param {Transaction} transaction 接收插入和删除 ID 范围的事务，store 随后接收同一结构对象。
   * @param {number} offset 从左端省略的已知 clock 数，须小于原长度；当前读取路径已先排除已知范围，传 0。
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
   * @param {number} offset 左端不发送的 clock 数。
   * @param {number} offsetEnd 右端不发送的 clock 数；两端裁剪之和须小于结构长度。
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
   * @param {number} diff 相对当前起点的切分 clock 数，左段长度改为 diff。
   * @return {GC} 右段使用新 ID，不自动加入 store。
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
