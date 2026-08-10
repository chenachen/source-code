import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as error from 'lib0/error'

/**
 * 标识一个客户端逻辑时钟上的唯一位置。
 *
 * 不变量：同一客户端的结构按 `clock` 连续排列；结构 ID 指向区间首位，区间内
 * 其余位置由 `clock + offset` 推导。
 */
export class ID {
  /**
   * 创建客户端与逻辑时钟组成的地址。
   *
   * @param {number} client 客户端标识。
   * @param {number} clock 该客户端内连续递增的逻辑时钟。
   */
  constructor (client, clock) {
    /**
     * 客户端标识。
     * @type {number}
     */
    this.client = client
    /**
     * 客户端内唯一且连续的逻辑时钟。
     * @type {number}
     */
    this.clock = clock
  }
}

/**
 * 按客户端与时钟比较两个可空 ID 的值相等性。
 *
 * @param {ID | null} a
 * @param {ID | null} b
 * @return {boolean}
 *
 * @function
 */
export const compareIDs = (a, b) => a === b || (a !== null && b !== null && a.client === b.client && a.clock === b.clock)

/**
 * 创建一个 ID；集中该薄包装便于调用方表达领域含义。
 *
 * @param {number} client
 * @param {number} clock
 *
 * @private
 * @function
 */
export const createID = (client, clock) => new ID(client, clock)

/**
 * 依次写入 ID 的客户端与时钟 VarUint。
 *
 * @param {encoding.Encoder} encoder
 * @param {ID} id
 *
 * @private
 * @function
 */
export const writeID = (encoder, id) => {
  encoding.writeVarUint(encoder, id.client)
  encoding.writeVarUint(encoder, id.clock)
}

/**
 * 从连续两个 VarUint 读取客户端与时钟并创建 ID。
 *
 * @param {decoding.Decoder} decoder
 * @return {ID}
 *
 * @private
 * @function
 */
export const readID = decoder =>
  createID(decoding.readVarUint(decoder), decoding.readVarUint(decoder))

/**
 * 反向查找顶层共享类型在 `doc.share` 中的键。
 *
 * 顶层类型本身不保存键名，编码一个没有左右来源的 Item 时必须写出该键，故只能
 * 扫描 `doc.share` 恢复映射；找不到表示类型不属于当前文档，直接抛错。
 *
 * @param {YType<any>} type
 * @return {string}
 *
 * @private
 * @function
 */
export const findRootTypeKey = type => {
  // @ts-ignore _y must be defined, otherwise unexpected case
  for (const [key, value] of type.doc.share.entries()) {
    if (value === type) {
      return key
    }
  }
  throw error.unexpectedCase()
}
