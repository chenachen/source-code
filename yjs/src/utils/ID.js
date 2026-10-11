import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as error from 'lib0/error'

/**
 * 标识一个客户端逻辑时钟上的唯一位置。
 *
 * `clock` 是该客户端创建内容时累计占用的时钟位置，不是时间戳或可见索引。
 * 结构 ID 指向区间首位，区间内其余位置由 `clock + offset` 推导；删除不重排 ID。
 * 格式标记等不计可见长度的结构也占用逻辑时钟，所以 ID 范围长度不能直接当作当前文本长度。
 */
export class ID {
  /**
   * 创建客户端与逻辑时钟组成的地址。
   *
   * @param {number} client 写入者的数值标识，决定 StructStore 的客户端分组。
   * @param {number} clock 该客户端的非负逻辑位置；文本按 UTF-16 单位、列表按元素占用位置。
   */
  constructor (client, clock) {
    /**
     * 客户端标识。
     * @type {number}
     */
    this.client = client
    /**
     * 该客户端时钟序列中的位置。
     * @type {number}
     */
    this.clock = clock
  }
}

/**
 * 按客户端与时钟比较两个可空 ID 的值相等性。
 *
 * 两个 null 相等；不同对象也可代表同一位置。此比较不判断内容相等、因果先后或文档中的左右顺序。
 *
 * @param {ID | null} a
 * @param {ID | null} b
 * @return {boolean}
 *
 * @function
 */
export const compareIDs = (a, b) => a === b || (a !== null && b !== null && a.client === b.client && a.clock === b.clock)

/**
 * 创建客户端时钟地址；本函数不分配或推进客户端时钟。
 *
 * 调用者可用同一 client 加 clock 偏移定位复合 Item 内的一位，真正占用新时钟发生在结构集成时。
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
 * 不编码区间长度或空值标记；读取方必须在相同游标位置调用 `readID()`，空锚点由外围格式另行表示。
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
 * 扫描 `doc.share` 恢复映射；调用方必须传入已集成的顶层类型，找不到对应键时抛错。
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
