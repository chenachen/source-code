import * as error from 'lib0/error'
import * as encoding from 'lib0/encoding'

/** 把 ID 集绝对时钟与长度直接写入单一字节流的 V1 编码器。 */
export class IdSetEncoderV1 {
  /** 创建承载全部字段的基础编码器。 */
  constructor () {
    this.restEncoder = encoding.createEncoder()
  }

  /** 返回已编码字节。 */
  toUint8Array () {
    return encoding.toUint8Array(this.restEncoder)
  }

  /** V1 使用绝对值，无需重置差分游标。 */
  resetIdSetCurVal () {
    // 空操作：线格式没有跨区间累积状态。
  }

  /**
   * 写入区间绝对起始时钟。
   *
   * @param {number} clock
   */
  writeIdSetClock (clock) {
    encoding.writeVarUint(this.restEncoder, clock)
  }

  /**
   * 写入区间绝对长度。
   *
   * @param {number} len
   */
  writeIdSetLen (len) {
    encoding.writeVarUint(this.restEncoder, len)
  }
}

/** 按调用顺序把 V1 更新的全部结构字段写入单一字节流。 */
export class UpdateEncoderV1 extends IdSetEncoderV1 {
  /**
   * 写入左来源 ID。
   *
   * @param {ID} id
   */
  writeLeftID (id) {
    encoding.writeVarUint(this.restEncoder, id.client)
    encoding.writeVarUint(this.restEncoder, id.clock)
  }

  /**
   * 写入右来源 ID。
   *
   * @param {ID} id
   */
  writeRightID (id) {
    encoding.writeVarUint(this.restEncoder, id.client)
    encoding.writeVarUint(this.restEncoder, id.clock)
  }

  /**
   * 写入客户端标识；只需 client 时避免构造临时 ID。
   *
   * @param {number} client
   */
  writeClient (client) {
    encoding.writeVarUint(this.restEncoder, client)
  }

  /**
   * 写入结构信息字节。
   *
   * @param {number} info 无符号 8 位标志。
   */
  writeInfo (info) {
    encoding.writeUint8(this.restEncoder, info)
  }

  /**
   * 写入变长字符串。
   *
   * @param {string} s
   */
  writeString (s) {
    encoding.writeVarString(this.restEncoder, s)
  }

  /**
   * 写入父引用类型：1 表示顶层键，0 表示父 Item ID。
   *
   * @param {boolean} isYKey
   */
  writeParentInfo (isYKey) {
    encoding.writeVarUint(this.restEncoder, isYKey ? 1 : 0)
  }

  /**
   * 写入嵌套共享类型引用号。
   *
   * @param {number} info 无符号类型引用号。
   */
  writeTypeRef (info) {
    encoding.writeVarUint(this.restEncoder, info)
  }

  /**
   * 写入结构或内容长度。
   *
   * @param {number} len
   */
  writeLen (len) {
    encoding.writeVarUint(this.restEncoder, len)
  }

  /**
   * 写入 lib0 any 值。
   *
   * @param {any} any
   */
  writeAny (any) {
    encoding.writeAny(this.restEncoder, any)
  }

  /**
   * 写入带长度前缀的字节数组。
   *
   * @param {Uint8Array} buf
   */
  writeBuf (buf) {
    encoding.writeVarUint8Array(this.restEncoder, buf)
  }

  /**
   * 为 V1 兼容格式把对象 JSON 字符串化后写入。
   *
   * @param {any} embed
   */
  writeJSON (embed) {
    encoding.writeVarString(this.restEncoder, JSON.stringify(embed))
  }

  /**
   * 写入未做缓存的格式键。
   *
   * @param {string} key
   */
  writeKey (key) {
    encoding.writeVarString(this.restEncoder, key)
  }
}

/** 用递增差值编码区间时钟的 V2 ID 集编码器。 */
export class IdSetEncoderV2 {
  /** 初始化通用字节流与当前客户端的差分游标。 */
  constructor () {
    this.restEncoder = encoding.createEncoder() // 承载未使用专用列压缩的其余字段。
    this.dsCurrVal = 0
  }

  /** 返回 ID 集通用流字节。 */
  toUint8Array () {
    return encoding.toUint8Array(this.restEncoder)
  }

  /** 开始写新客户端前把差分基准归零。 */
  resetIdSetCurVal () {
    this.dsCurrVal = 0
  }

  /**
   * 写入相对上一个区间末端的起始时钟差值。
   *
   * @param {number} clock
   */
  writeIdSetClock (clock) {
    const diff = clock - this.dsCurrVal
    this.dsCurrVal = clock
    encoding.writeVarUint(this.restEncoder, diff)
  }

  /**
   * 写入 `len - 1` 并把游标推进到区间末端。
   *
   * 零长区间违反 ID 集规范，直接抛错；正长度减一可压缩常见长度 1。
   *
   * @param {number} len
   */
  writeIdSetLen (len) {
    if (len === 0) {
      error.unexpectedCase()
    }
    encoding.writeVarUint(this.restEncoder, len - 1)
    this.dsCurrVal += len
  }
}

/**
 * 按字段统计特性把 V2 更新写入多条专用压缩列。
 *
 * client、左右时钟、info、字符串、父标志、类型号和长度分别 RLE/差分编码；无法
 * 稳定预测的 any 与二进制值留在 `restEncoder`。最终布局顺序是协议不变量。
 */
export class UpdateEncoderV2 extends IdSetEncoderV2 {
  /** 初始化全部专用编码列与格式键缓存。 */
  constructor () {
    super()
    /**
     * 格式键到协议引用号的缓存。
     *
     * @type {Map<string,number>}
     */
    this.keyMap = new Map()
    /**
     * 下一个格式键引用号；只允许单调递增。
     *
     * 具体兼容限制见 `writeKey()`。
     *
     * @type {number}
     */
    this.keyClock = 0
    this.keyClockEncoder = new encoding.IntDiffOptRleEncoder()
    this.clientEncoder = new encoding.UintOptRleEncoder()
    this.leftClockEncoder = new encoding.IntDiffOptRleEncoder()
    this.rightClockEncoder = new encoding.IntDiffOptRleEncoder()
    this.infoEncoder = new encoding.RleEncoder(encoding.writeUint8)
    this.stringEncoder = new encoding.StringEncoder()
    this.parentInfoEncoder = new encoding.RleEncoder(encoding.writeUint8)
    this.typeRefEncoder = new encoding.UintOptRleEncoder()
    this.lenEncoder = new encoding.UintOptRleEncoder()
  }

  /**
   * 按固定协议顺序封装所有压缩列，再直接追加通用尾流。
   *
   * 前九列均带长度前缀；`restEncoder` 故意不带外层长度并占据余下全部字节，
   * 解码器依赖这一边界。
   */
  toUint8Array () {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, 0) // 预留功能标志，当前协议固定为 0。
    encoding.writeVarUint8Array(encoder, this.keyClockEncoder.toUint8Array())
    encoding.writeVarUint8Array(encoder, this.clientEncoder.toUint8Array())
    encoding.writeVarUint8Array(encoder, this.leftClockEncoder.toUint8Array())
    encoding.writeVarUint8Array(encoder, this.rightClockEncoder.toUint8Array())
    encoding.writeVarUint8Array(encoder, encoding.toUint8Array(this.infoEncoder))
    encoding.writeVarUint8Array(encoder, this.stringEncoder.toUint8Array())
    encoding.writeVarUint8Array(encoder, encoding.toUint8Array(this.parentInfoEncoder))
    encoding.writeVarUint8Array(encoder, this.typeRefEncoder.toUint8Array())
    encoding.writeVarUint8Array(encoder, this.lenEncoder.toUint8Array())
    // 注意：通用尾流直接追加，不写长度前缀。
    encoding.writeUint8Array(encoder, encoding.toUint8Array(this.restEncoder))
    return encoding.toUint8Array(encoder)
  }

  /**
   * 把左来源 ID 分拆写入共享 client 列与左时钟差分列。
   *
   * @param {ID} id
   */
  writeLeftID (id) {
    this.clientEncoder.write(id.client)
    this.leftClockEncoder.write(id.clock)
  }

  /**
   * 把右来源 ID 分拆写入共享 client 列与右时钟差分列。
   *
   * @param {ID} id
   */
  writeRightID (id) {
    this.clientEncoder.write(id.client)
    this.rightClockEncoder.write(id.clock)
  }

  /**
   * 写入 client RLE 列。
   *
   * @param {number} client
   */
  writeClient (client) {
    this.clientEncoder.write(client)
  }

  /**
   * 写入结构信息 RLE 列。
   *
   * @param {number} info 无符号 8 位标志。
   */
  writeInfo (info) {
    this.infoEncoder.write(info)
  }

  /**
   * 写入共享字符串列。
   *
   * @param {string} s
   */
  writeString (s) {
    this.stringEncoder.write(s)
  }

  /**
   * 把父引用类型写入布尔 RLE 列。
   *
   * @param {boolean} isYKey
   */
  writeParentInfo (isYKey) {
    this.parentInfoEncoder.write(isYKey ? 1 : 0)
  }

  /**
   * 写入嵌套共享类型引用列。
   *
   * @param {number} info 无符号类型引用号。
   */
  writeTypeRef (info) {
    this.typeRefEncoder.write(info)
  }

  /**
   * 写入结构或内容长度 RLE 列。
   *
   * @param {number} len
   */
  writeLen (len) {
    this.lenEncoder.write(len)
  }

  /**
   * 把任意值写入通用尾流。
   *
   * @param {any} any
   */
  writeAny (any) {
    encoding.writeAny(this.restEncoder, any)
  }

  /**
   * 把带长度前缀的字节数组写入通用尾流。
   *
   * @param {Uint8Array} buf
   */
  writeBuf (buf) {
    encoding.writeVarUint8Array(this.restEncoder, buf)
  }

  /**
   * 使用 lib0 any 编码写入兼容 JSON 内容。
   *
   * 方法名沿用旧协议；V2 不再做 JSON 字符串往返。
   *
   * @param {any} embed
   */
  writeJSON (embed) {
    encoding.writeAny(this.restEncoder, embed)
  }

  /**
   * 写入可复用的格式键引用。
   *
   * 格式键通常高频重复（如 `bold`、`position`），协议预留用编号缓存它们。但
   * 当前兼容实现没有写入 `keyMap`：每次仍分配新编号并写字符串，避免旧客户端
   * 因历史编码/解码不一致而无法读取更新。
   *
   * @param {string} key
   */
  writeKey (key) {
    const clock = this.keyMap.get(key)
    if (clock === undefined) {
      /**
       * @todo 若重新启用键去重，必须通过功能标志协商。历史解码器曾用
       * `readString()` 读取 `ContentFormat`，且旧编码没有维护 keyClock；直接启用
       * `keyMap` 会生成旧客户端无法读取的更新。
       */
      // this.keyMap.set(key, this.keyClock)
      this.keyClockEncoder.write(this.keyClock++)
      this.stringEncoder.write(key)
    } else {
      this.keyClockEncoder.write(clock)
    }
  }
}

/**
 * ID 集编码器的兼容联合类型。
 *
 * @typedef {IdSetEncoderV1 | IdSetEncoderV2} IdSetEncoder
 */
/**
 * 完整更新编码器的兼容联合类型。
 *
 * @typedef {UpdateEncoderV1 | UpdateEncoderV2} UpdateEncoder
 */
