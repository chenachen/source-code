import * as buffer from 'lib0/buffer'
import * as decoding from 'lib0/decoding'

import { ID, createID } from './ID.js'

/**
 * 删除集/ID 集解码器的兼容联合类型。
 *
 * @typedef {IdSetDecoderV1 | IdSetDecoderV2} IdSetDecoder
 */

/** 直接从单一字节流读取绝对时钟与长度的 V1 ID 集解码器。 */
export class IdSetDecoderV1 {
  /**
   * 复用调用方提供的基础解码器。
   *
   * @param {decoding.Decoder} decoder
   */
  constructor (decoder) {
    this.restDecoder = decoder
  }

  /** V1 使用绝对值，无需重置差分基准。 */
  resetDsCurVal () {
    // 空操作：线格式没有跨区间累积状态。
  }

  /**
   * 读取一个绝对起始时钟。
   *
   * @return {number}
   */
  readDsClock () {
    return decoding.readVarUint(this.restDecoder)
  }

  /**
   * 读取一个绝对区间长度。
   *
   * @return {number}
   */
  readDsLen () {
    return decoding.readVarUint(this.restDecoder)
  }
}

/** 从 V1 单一字节流按写入顺序解码结构字段。 */
export class UpdateDecoderV1 extends IdSetDecoderV1 {
  /**
   * 读取左来源 ID。
   *
   * @return {ID}
   */
  readLeftID () {
    return createID(decoding.readVarUint(this.restDecoder), decoding.readVarUint(this.restDecoder))
  }

  /**
   * 读取右来源 ID。
   *
   * @return {ID}
   */
  readRightID () {
    return createID(decoding.readVarUint(this.restDecoder), decoding.readVarUint(this.restDecoder))
  }

  /**
   * 读取下一个客户端标识。
   *
   * 调用方只需 client 时避免创建临时 ID，降低批量更新解码分配。
   */
  readClient () {
    return decoding.readVarUint(this.restDecoder)
  }

  /**
   * 读取结构信息字节。
   *
   * @return {number} 无符号 8 位标志。
   */
  readInfo () {
    return decoding.readUint8(this.restDecoder)
  }

  /**
   * 读取变长字符串。
   *
   * @return {string}
   */
  readString () {
    return decoding.readVarString(this.restDecoder)
  }

  /**
   * 读取父引用类型：true 表示顶层键，false 表示父 Item ID。
   *
   * @return {boolean} 是否为顶层键。
   */
  readParentInfo () {
    return decoding.readVarUint(this.restDecoder) === 1
  }

  /**
   * 读取嵌套共享类型引用号。
   *
   * @return {number} 无符号类型引用号。
   */
  readTypeRef () {
    return decoding.readVarUint(this.restDecoder)
  }

  /**
   * 读取结构或内容长度。
   *
   * @return {number} len
   */
  readLen () {
    return decoding.readVarUint(this.restDecoder)
  }

  /**
   * 读取 lib0 any 值。
   *
   * @return {any}
   */
  readAny () {
    return decoding.readAny(this.restDecoder)
  }

  /**
   * 读取带长度前缀的字节数组并复制所有权。
   *
   * @return {Uint8Array}
   */
  readBuf () {
    return buffer.copyUint8Array(decoding.readVarUint8Array(this.restDecoder))
  }

  /**
   * 读取 V1 以字符串保存的 JSON 值。
   *
   * V2 已改用 any 编码；此处保留 `JSON.parse` 以兼容历史更新。
   *
   * @return {any}
   */
  readJSON () {
    return JSON.parse(decoding.readVarString(this.restDecoder))
  }

  /**
   * 读取未做键缓存的格式键。
   *
   * @return {string}
   */
  readKey () {
    return decoding.readVarString(this.restDecoder)
  }
}

/** 通过递增差值还原区间时钟的 V2 ID 集解码器。 */
export class IdSetDecoderV2 {
  /**
   * 初始化基础字节流和当前客户端的差分游标。
   *
   * @param {decoding.Decoder} decoder
   */
  constructor (decoder) {
    /**
     * 上一个区间结束位置；读取 clock 和 len 时连续推进。
     *
     * @private
     */
    this.dsCurrVal = 0
    this.restDecoder = decoder
  }

  /** 开始解码新客户端前把差分基准归零。 */
  resetDsCurVal () {
    this.dsCurrVal = 0
  }

  /**
   * 读取相对差值并还原当前区间起始时钟。
   *
   * @return {number}
   */
  readDsClock () {
    this.dsCurrVal += decoding.readVarUint(this.restDecoder)
    return this.dsCurrVal
  }

  /**
   * 读取 `len - 1`，还原非零长度并把游标推进到区间末端。
   *
   * 不变量：V2 不编码零长区间，因此加一既节省常见小长度空间又保证正长度。
   *
   * @return {number}
   */
  readDsLen () {
    const diff = decoding.readVarUint(this.restDecoder) + 1
    this.dsCurrVal += diff
    return diff
  }
}

/**
 * 从 V2 的多条压缩列与尾部通用流解码结构字段。
 *
 * 构造顺序必须与 `UpdateEncoderV2.toUint8Array()` 写出的列顺序严格一致；每个
 * `read*` 方法只消费对应列，任一字段错位都会污染后续全部结构。
 */
export class UpdateDecoderV2 extends IdSetDecoderV2 {
  /**
   * 从更新头拆出各专用 RLE/差分解码器。
   *
   * @param {decoding.Decoder} decoder
   */
  constructor (decoder) {
    super(decoder)
    /**
     * 已解码格式键缓存；引用号等于数组下标，首次出现时再从字符串列读取。
     *
     * @type {Array<string>}
     */
    this.keys = []
    decoding.readVarUint(decoder) // 读取预留功能标志；当前版本固定为 0。
    this.keyClockDecoder = new decoding.IntDiffOptRleDecoder(decoding.readVarUint8Array(decoder))
    this.clientDecoder = new decoding.UintOptRleDecoder(decoding.readVarUint8Array(decoder))
    this.leftClockDecoder = new decoding.IntDiffOptRleDecoder(decoding.readVarUint8Array(decoder))
    this.rightClockDecoder = new decoding.IntDiffOptRleDecoder(decoding.readVarUint8Array(decoder))
    this.infoDecoder = new decoding.RleDecoder(decoding.readVarUint8Array(decoder), decoding.readUint8)
    this.stringDecoder = new decoding.StringDecoder(decoding.readVarUint8Array(decoder))
    this.parentInfoDecoder = new decoding.RleDecoder(decoding.readVarUint8Array(decoder), decoding.readUint8)
    this.typeRefDecoder = new decoding.UintOptRleDecoder(decoding.readVarUint8Array(decoder))
    this.lenDecoder = new decoding.UintOptRleDecoder(decoding.readVarUint8Array(decoder))
  }

  /**
   * 从共享 client 列和左时钟差分列读取左来源 ID。
   *
   * @return {ID}
   */
  readLeftID () {
    return new ID(this.clientDecoder.read(), this.leftClockDecoder.read())
  }

  /**
   * 从共享 client 列和右时钟差分列读取右来源 ID。
   *
   * @return {ID}
   */
  readRightID () {
    return new ID(this.clientDecoder.read(), this.rightClockDecoder.read())
  }

  /**
   * 从 client RLE 列读取客户端标识，不创建临时 ID。
   */
  readClient () {
    return this.clientDecoder.read()
  }

  /**
   * 从信息 RLE 列读取结构标志。
   *
   * @return {number} 无符号 8 位标志。
   */
  readInfo () {
    return /** @type {number} */ (this.infoDecoder.read())
  }

  /**
   * 从共享字符串列读取下一个字符串。
   *
   * @return {string}
   */
  readString () {
    return this.stringDecoder.read()
  }

  /**
   * 从父引用 RLE 列读取父引用类型。
   *
   * @return {boolean}
   */
  readParentInfo () {
    return this.parentInfoDecoder.read() === 1
  }

  /**
   * 从类型引用列读取嵌套共享类型编号。
   *
   * @return {number} 无符号类型引用号。
   */
  readTypeRef () {
    return this.typeRefDecoder.read()
  }

  /**
   * 从长度 RLE 列读取结构或内容长度。
   *
   * @return {number}
   */
  readLen () {
    return this.lenDecoder.read()
  }

  /**
   * 从未专门压缩的尾部流读取 any 值。
   *
   * @return {any}
   */
  readAny () {
    return decoding.readAny(this.restDecoder)
  }

  /**
   * 从尾部流读取带长度前缀的字节数组。
   *
   * @return {Uint8Array}
   */
  readBuf () {
    return decoding.readVarUint8Array(this.restDecoder)
  }

  /**
   * 从尾部流读取兼容 JSON 内容的 any 值。
   *
   * 方法名保留旧内容协议语义；V2 实际使用更快的 lib0 any 编码。
   *
   * @return {any}
   */
  readJSON () {
    return decoding.readAny(this.restDecoder)
  }

  /**
   * 按引用号读取或登记格式键。
   *
   * 已知编号直接复用缓存；新编号必须恰好等于下一个数组位置，并从字符串列消费
   * 一个新键，与编码器的单调 `keyClock` 保持同步。
   *
   * @return {string}
   */
  readKey () {
    const keyClock = this.keyClockDecoder.read()
    if (keyClock < this.keys.length) {
      return this.keys[keyClock]
    } else {
      const key = this.stringDecoder.read()
      this.keys.push(key)
      return key
    }
  }
}
