import * as encoding from 'lib0/encoding'

import { AbstractStruct } from './AbstractStruct.js'
import { createID } from '../utils/ID.js'

/** 更新中表示“本段未携带任何结构”的保留引用号。 */
export const structSkipRefNumber = 10

/**
 * 表示更新流中的时钟空洞，而不是文档删除内容。
 *
 * Skip 允许差分与合并更新保留后续结构的绝对时钟，同时明确某段数据未包含在
 * 当前更新中。集成后登记到 `store.skips`：依赖落在缺口内时暂缓对应 Item，
 * 状态向量停在最早缺口；缺口之后不依赖它的结构仍可先集成。
 * @private
 */
export class Skip extends AbstractStruct {
  /** Skip 不是删除标记。 */
  get deleted () {
    return false
  }

  /** Skip 不承载内容，因此删除操作为空。 */
  delete () {}

  /**
   * 合并右侧同类 Skip 区间；同客户端、时钟连续由调用方保证。
   *
   * @param {Skip} right 同 client 且紧邻的缺口；构造器不同时拒绝合并。
   * @return {boolean} 是否把右段长度累加到当前段；结构数组删除由调用方负责。
   */
  mergeWith (right) {
    if (this.constructor !== right.constructor) {
      return false
    }
    this.length += right.length
    return true
  }

  /**
   * 把缺口区间登记进 `store.skips` 与结构存储。
   *
   * `offset` 裁掉已经消费的前缀；缺口必须保留，后续真实结构到达时
   * `StructStore.add()` 会按精确边界替换它。
   *
   * 输入更新中的 Skip 在 `integrateStructs` 中跳过；这个方法接收的是为补齐 store 尾部空洞而新建的 Skip。
   * 它不登记事务 insertSet/deleteSet，缺口尚不代表已收到内容或删除。
   *
   * @param {Transaction} transaction 提供 store 与缺口索引的事务。
   * @param {number} offset 省略缺口左端的 clock 数；调用方须保留正长度。
   */
  integrate (transaction, offset) {
    if (offset > 0) {
      this.id.clock += offset
      this.length -= offset
    }
    const store = transaction.doc.store
    store.skips.add(this.id.client, this.id.clock, this.length)
    store.add(this)
  }

  /**
   * 编码 Skip 引用号与剩余长度。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset 左端省略的 clock 数；此方法没有尾裁参数，调用方若要截短须先切分。
   */
  write (encoder, offset) {
    encoder.writeInfo(structSkipRefNumber)
    // Skip 的长度不参与结构长度 RLE 预测，因此直接写为 VarUint。
    encoding.writeVarUint(encoder.restEncoder, this.length - offset)
  }

  /**
   * 在指定时钟偏移处分割 Skip 并返回右半段。
   *
   * 本方法只调整结构边界；存储数组插入与事务合并登记由 `splitStruct()` 调用链负责。
   *
   * @param {number} diff 相对起点的内部 clock 边界，原对象成为左段。
   * @return {Skip} 新建的右缺口对象；仅改变结构边界，不改 `store.skips`。
   */
  splice (diff) {
    const other = new Skip(createID(this.id.client, this.id.clock + diff), this.length - diff)
    this.length = diff
    return other
  }
}

/**
 * 声明 Skip 的稳定线格式引用号。
 *
 * @type {10}
 */
Skip.prototype.ref = structSkipRefNumber

/**
 * 标记 Skip 不是可承载用户内容的 `Item`。
 *
 * @type {false}
 */
Skip.prototype.isItem = false
