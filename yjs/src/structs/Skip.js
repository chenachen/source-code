import * as encoding from 'lib0/encoding'

import { AbstractStruct } from './AbstractStruct.js'
import { createID } from '../utils/ID.js'

/** 更新中表示“本段未携带任何结构”的保留引用号。 */
export const structSkipRefNumber = 10

/**
 * 表示更新流中的时钟空洞，而不是文档删除内容。
 *
 * Skip 允许差分、交集与合并更新保持客户端时钟连续，同时明确某段数据未包含在
 * 当前更新中；集成后会登记到 `store.skips`，供依赖检查阻止越过缺口。
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
   * 合并右侧连续的 Skip 区间。
   *
   * @param {Skip} right
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
   * 把缺口区间登记进 `store.skips` 与结构存储。
   *
   * `offset` 裁掉已经消费的前缀；缺口必须保留，后续真实结构到达时
   * `StructStore.add()` 会按精确边界替换它。
   *
   * @param {Transaction} transaction
   * @param {number} offset
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
   * @param {number} offset
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
   * @param {number} diff
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
