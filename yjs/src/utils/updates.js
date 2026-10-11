import * as binary from 'lib0/binary'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as error from 'lib0/error'
import * as f from 'lib0/function'
import * as logging from 'lib0/logging'
import * as map from 'lib0/map'
import * as string from 'lib0/string'

import { readIdSet, writeIdSet, createIdSet, intersectSets } from './ids.js'

import { createID } from './ID.js'
import { IdSetEncoderV1, IdSetEncoderV2, UpdateEncoderV1, UpdateEncoderV2 } from './UpdateEncoder.js'
import { UpdateDecoderV1, UpdateDecoderV2 } from './UpdateDecoder.js'
import { GC } from '../structs/GC.js'
import {
  Item,
  ContentAny,
  ContentBinary,
  ContentDeleted,
  ContentDoc,
  ContentEmbed,
  ContentFormat,
  ContentJSON,
  ContentString,
  ContentType
} from '../structs/Item.js'
import {
  readItemContent
} from '../ytype.js'
import { Skip } from '../structs/Skip.js'

/**
 * 按更新顺序惰性解码结构记录。
 *
 * 每个客户端段携带结构数、client 与首时钟；生成器按每条结构长度推进绝对时钟，
 * 并根据 info 还原 Skip、Item 或 GC。它只构建结构对象，不解析因果依赖或应用
 * 删除集。
 *
 * 完全消费结构段后才保证 decoder 到删除集起点；提前停止迭代时不能直接读取尾部 ID 集。
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 */
function * lazyStructReaderGenerator (decoder) {
  const numOfStateUpdates = decoding.readVarUint(decoder.restDecoder)
  for (let i = 0; i < numOfStateUpdates; i++) {
    const numberOfStructs = decoding.readVarUint(decoder.restDecoder)
    const client = decoder.readClient()
    let clock = decoding.readVarUint(decoder.restDecoder)
    for (let i = 0; i < numberOfStructs; i++) {
      const info = decoder.readInfo()
      // @todo 可改为 switch，与 BlockSet 解码保持同一分派结构。
      if (info === 10) {
        const len = decoding.readVarUint(decoder.restDecoder)
        yield new Skip(createID(client, clock), len)
        clock += len
      } else if ((binary.BITS5 & info) !== 0) {
        const cantCopyParentInfo = (info & (binary.BIT7 | binary.BIT8)) === 0
        // 无左右锚点时，父引用只能是 doc.share 顶层键或父 Item ID。
        // @type {string|null}
        const struct = new Item(
          createID(client, clock),
          null, // 当前左邻只在真正集成时解析。
          (info & binary.BIT8) === binary.BIT8 ? decoder.readLeftID() : null, // 原始左锚点。
          null, // 当前右邻只在真正集成时解析。
          (info & binary.BIT7) === binary.BIT7 ? decoder.readRightID() : null, // 原始右锚点。
          // @ts-ignore 父引用联合类型由 info 位决定。
          cantCopyParentInfo ? (decoder.readParentInfo() ? decoder.readString() : decoder.readLeftID()) : null, // 父键或父 Item ID。
          cantCopyParentInfo && (info & binary.BIT6) === binary.BIT6 ? decoder.readString() : null, // 父映射键。
          readItemContent(decoder, info) // 按低五位解码内容。
        )
        yield struct
        clock += struct.length
      } else {
        const len = decoder.readLen()
        yield new GC(createID(client, clock), len)
        clock += len
      }
    }
  }
}

/**
 * 为更新转换、裁剪与日志提供单步结构读取游标。
 *
 * 构造即预取第一项；`curr=null` 表示结构段耗尽，此时底层 decoder 正位于删除集
 * 起点。可选择透明跳过 Skip。
 */
export class LazyStructReader {
  /**
   * 创建惰性生成器并预取首个结构。
   *
   * filterSkips=true 只影响游标可见项，Skip 仍被解码并推进各客户端绝对 clock；不修改任何 Doc。
   *
   * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
   * @param {boolean} filterSkips
   */
  constructor (decoder, filterSkips) {
    /** 持有并消费同一 decoder 的生成器，按记录长度累计各 client 绝对 clock。 */
    this.gen = lazyStructReaderGenerator(decoder)
    /**
     * 当前预取结构；耗尽时为 null，且底层 decoder 处于删除集起点。
     * @type {null | Item | Skip | GC}
     */
    this.curr = null
    /** 保留的兼容字段；当前 next 实现不维护它，应以 curr===null 判断结束。 */
    this.done = false
    /** 是否把解码到的 Skip 对调用方隐藏。 */
    this.filterSkips = filterSkips
    this.next()
  }

  /**
   * 前进到下一结构；启用过滤时持续跳过 Skip。
   *
   * @return {Item | GC | Skip |null}
   */
  next () {
    // Skip 仅表达更新空洞，筛选调用方可选择不观察它。
    do {
      this.curr = this.gen.next().value || null
    } while (this.filterSkips && this.curr !== null && this.curr.constructor === Skip)
    return this.curr
  }
}

/**
 * 以 V1 解码器打印更新结构与删除集。
 *
 * @param {Uint8Array} update
 */
export const logUpdate = update => logUpdateV2(update, UpdateDecoderV1)

/**
 * 解码并打印更新的结构数组与删除集，供调试使用。
 *
 * @param {Uint8Array} update
 * @param {typeof UpdateDecoderV2 | typeof UpdateDecoderV1} [YDecoder]
 */
export const logUpdateV2 = (update, YDecoder = UpdateDecoderV2) => {
  const structs = []
  const updateDecoder = new YDecoder(decoding.createDecoder(update))
  const lazyDecoder = new LazyStructReader(updateDecoder, false)
  for (let curr = lazyDecoder.curr; curr !== null; curr = lazyDecoder.next()) {
    structs.push(curr)
  }
  logging.print('Structs: ', structs)
  const ds = readIdSet(updateDecoder)
  logging.print('DeleteSet: ', ds)
}

/**
 * 把 V1 更新解码为结构数组与 IdSet，不集成文档。
 *
 * @param {Uint8Array} update
 */
export const decodeUpdate = (update) => decodeUpdateV2(update, UpdateDecoderV1)

/**
 * 把指定版本更新解码为结构数组与 IdSet，不解析因果依赖。
 *
 * 结构读取结束后，同一 decoder 已准确停在删除集起点。
 * 返回 {structs, ds}；包含 Item、GC、Skip 的解码对象及删除 ID 集。对象未挂入 Doc，可供检查或转换。
 *
 * @param {Uint8Array} update
 * @param {typeof UpdateDecoderV2 | typeof UpdateDecoderV1} [YDecoder]
 *
 */
export const decodeUpdateV2 = (update, YDecoder = UpdateDecoderV2) => {
  const structs = []
  const updateDecoder = new YDecoder(decoding.createDecoder(update))
  const lazyDecoder = new LazyStructReader(updateDecoder, false)
  for (let curr = lazyDecoder.curr; curr !== null; curr = lazyDecoder.next()) {
    structs.push(curr)
  }
  return {
    structs,
    ds: readIdSet(updateDecoder)
  }
}

/**
 * 分客户端暂存惰性写出的结构片段。
 *
 * 更新协议要求先写客户端数量和每客户端结构数，但转换流程事前不知道这些值；
 * 因而先把每客户端的 restEncoder 片段缓存，结束时再补协议头并拼接。
 */
export class LazyStructWriter {
  /**
   * 初始化当前客户端计数与片段缓存。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   */
  constructor (encoder) {
    /** 当前已开始片段的 client，written=0 时该值还不表示有效片段。 */
    this.currClient = 0
    /** 保留字段，当前写入路径直接把首 clock 写入 restEncoder，未读取此值。 */
    this.startClock = 0
    /** 当前 client 片段已写记录数，含 Skip，flush 后归零。 */
    this.written = 0
    /** 共用目标编码器；flush 只替换其通用流，V2 各专用列保持连续。 */
    this.encoder = encoder
    /**
     * 已完成客户端的结构数与 restEncoder 片段。
     *
     * 专用 V2 列仍持续写入原 encoder；这里只分片必须在结构前写元信息的通用流。
     *
     * @type {Array<{ written: number, restEncoder: Uint8Array }>}
     */
    this.clientStructs = []
  }
}

/**
 * 仅从更新结构段推导连续状态向量。
 *
 * 每个客户端必须从 clock 0 开始且中间没有 Skip；一旦遇到非零起点或 Skip，该
 * 客户端后续都不能证明连续前缀。只有 `currClock>0` 的客户端写入结果。
 *
 * @param {Uint8Array} update
 * @param {typeof IdSetEncoderV1 | typeof IdSetEncoderV2} YEncoder
 * @param {typeof UpdateDecoderV1 | typeof UpdateDecoderV2} YDecoder
 * @return {Uint8Array<ArrayBuffer>}
 */
export const encodeStateVectorFromUpdateV2 = (update, YEncoder = IdSetEncoderV2, YDecoder = UpdateDecoderV2) => {
  const encoder = new YEncoder()
  const updateDecoder = new LazyStructReader(new YDecoder(decoding.createDecoder(update)), false)
  let curr = updateDecoder.curr
  if (curr !== null) {
    let size = 0
    let currClient = curr.id.client
    let stopCounting = curr.id.clock !== 0 // 连续状态必须从时钟 0 开始。
    let currClock = stopCounting ? 0 : curr.id.clock + curr.length
    for (; curr !== null; curr = updateDecoder.next()) {
      if (currClient !== curr.id.client) {
        if (currClock !== 0) {
          size++
          // 客户端结束：写入已证实的连续 nextClock。
          encoding.writeVarUint(encoder.restEncoder, currClient)
          encoding.writeVarUint(encoder.restEncoder, currClock)
        }
        currClient = curr.id.client
        currClock = 0
        stopCounting = curr.id.clock !== 0
      }
      // Skip 之后的结构不再构成可证明的连续前缀。
      if (curr.constructor === Skip) {
        stopCounting = true
      }
      if (!stopCounting) {
        currClock = curr.id.clock + curr.length
      }
    }
    // 写入最后一个客户端。
    if (currClock !== 0) {
      size++
      encoding.writeVarUint(encoder.restEncoder, currClient)
      encoding.writeVarUint(encoder.restEncoder, currClock)
    }
    // 客户端数量必须位于正文之前，另建编码器补头。
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, size)
    encoding.writeBinaryEncoder(enc, encoder.restEncoder)
    encoder.restEncoder = enc
    return encoder.toUint8Array()
  } else {
    encoding.writeVarUint(encoder.restEncoder, 0)
    return encoder.toUint8Array()
  }
}

/**
 * 从 V1 更新推导连续状态向量。
 *
 * @param {Uint8Array} update
 * @return {Uint8Array<ArrayBuffer>}
 */
export const encodeStateVectorFromUpdate = update => encodeStateVectorFromUpdateV2(update, IdSetEncoderV1, UpdateDecoderV1)

/**
 * 从更新提取实际携带的插入区间与删除集。
 *
 * Skip 被过滤；同客户端相邻真实结构合并成最大插入范围。结构段消费完后直接读取
 * 尾部删除集，得到可用于更新交集的 `ContentIds`。
 *
 * @param {Uint8Array} update
 * @param {typeof UpdateDecoderV2 | typeof UpdateDecoderV1} [YDecoder]
 * @return {ContentIds}
 */
export const createContentIdsFromUpdateV2 = (update, YDecoder = UpdateDecoderV2) => {
  const updateDecoder = new YDecoder(decoding.createDecoder(update))
  const lazyDecoder = new LazyStructReader(updateDecoder, true)
  const inserts = createIdSet()
  let lastClientId = -1
  let lastClock = 0
  let lastLen = 0
  for (let curr = lazyDecoder.curr; curr !== null; curr = lazyDecoder.next()) {
    const currId = curr.id
    if (lastClientId === currId.client && lastClock + lastLen === currId.clock) {
      // 常见连续路径：扩展前一插入范围。
      lastLen += curr.length
    } else {
      if (lastClientId >= 0) {
        inserts.add(lastClientId, lastClock, lastLen)
      }
      lastClientId = currId.client
      lastClock = currId.clock
      lastLen = curr.length
    }
  }
  if (lastClientId >= 0) {
    inserts.add(lastClientId, lastClock, lastLen)
  }
  const deletes = readIdSet(updateDecoder)
  return { inserts, deletes }
}

/**
 * 从 V1 更新提取插入与删除 ID 集。
 *
 * @param {Uint8Array} update
 * @return {ContentIds}
 */
export const createContentIdsFromUpdate = update => createContentIdsFromUpdateV2(update, UpdateDecoderV1)

/**
 * 取得结构从偏移开始的右侧切片，不将返回结构接入文档。
 *
 * GC/Skip 只重算 ID 与长度；Item 复用父上下文与右锚点，并切分内容。它不修复
 * 文档链、不登记事务；`Content.splice()` 会截短传入 Item 的内容而不更新其 `length`，因此只允许
 * 用于已解码、尚未集成的惰性编码结构。
 *
 * diff 表示从左端排除的 clock 数，返回范围为 [left.id.clock+diff, 原末端)；不是剩余长度或字节偏移。调用方需保证边界合法。
 *
 * @param {Item | GC | Skip} left
 * @param {number} diff
 * @return {Item | GC | Skip}
 */
export const sliceStruct = (left, diff) => {
  if (left.constructor === GC) {
    const { client, clock } = left.id
    return new GC(createID(client, clock + diff), left.length - diff)
  } else if (left.constructor === Skip) {
    const { client, clock } = left.id
    return new Skip(createID(client, clock + diff), left.length - diff)
  } else {
    const leftItem = /** @type {Item} */ (left)
    const { client, clock } = leftItem.id
    return new Item(
      createID(client, clock + diff),
      null,
      createID(client, clock + diff - 1),
      null,
      leftItem.rightOrigin,
      leftItem.parent,
      leftItem.parentSub,
      leftItem.content.splice(diff)
    )
  }
}

/**
 * 把当前客户端已写结构的通用流固化为片段。
 *
 * flush 后为同一更新编码器换一个空 `restEncoder`，专用 V2 列不受影响。
 *
 * @param {LazyStructWriter} lazyWriter
 */
const flushLazyStructWriter = lazyWriter => {
  if (lazyWriter.written > 0) {
    lazyWriter.clientStructs.push({ written: lazyWriter.written, restEncoder: encoding.toUint8Array(lazyWriter.encoder.restEncoder) })
    lazyWriter.encoder.restEncoder = encoding.createEncoder()
    lazyWriter.written = 0
  }
}

/**
 * 向惰性写入器追加一个结构切片。
 *
 * client 变化前先 flush；每个新客户端片段先写 client 与切片后的起始时钟，再写
 * 结构正文。调用方必须按客户端成组且时钟有序地提供结构。
 *
 * offset/offsetEnd 分别从原结构左/右排除的 clock 数；Skip.write 不接受右侧裁剪，调用方需先把 Skip 长度限定好。
 *
 * @param {LazyStructWriter} lazyWriter
 * @param {Item | GC | Skip} struct
 * @param {number} offset
 * @param {number} offsetEnd
 */
export const writeStructToLazyStructWriter = (lazyWriter, struct, offset, offsetEnd) => {
  // 客户端切换前结束当前片段。
  if (lazyWriter.written > 0 && lazyWriter.currClient !== struct.id.client) {
    flushLazyStructWriter(lazyWriter)
  }
  if (lazyWriter.written === 0) {
    lazyWriter.currClient = struct.id.client
    // 新片段先写客户端。
    lazyWriter.encoder.writeClient(struct.id.client)
    // 起始时钟需包含首结构的前缀裁剪。
    encoding.writeVarUint(lazyWriter.encoder.restEncoder, struct.id.clock + offset)
  }
  struct.write(lazyWriter.encoder, offset, offsetEnd)
  lazyWriter.written++
}
/**
 * 完成惰性结构段，补写客户端/结构计数并拼接所有片段。
 *
 * 调用后底层 UpdateEncoder 仍可继续写删除集；这正是更新“结构段后接删除集”的
 * 协议边界。
 *
 * 只应在一轮结构写入末尾调用一次；clientStructs 缓存不清空，重复调用会再写同一批片段。
 *
 * @param {LazyStructWriter} lazyWriter
 */
export const finishLazyStructWriting = (lazyWriter) => {
  flushLazyStructWriter(lazyWriter)

  // flush 后 restEncoder 为空，可安全从结构段头开始重建。
  const restEncoder = lazyWriter.encoder.restEncoder

  /**
   * 依次拼装片段，布局与 `writeClientsStructs()` 相同。
   */

  // 写入携带结构的客户端数量。
  encoding.writeVarUint(restEncoder, lazyWriter.clientStructs.length)

  for (let i = 0; i < lazyWriter.clientStructs.length; i++) {
    const partStructs = lazyWriter.clientStructs[i]
    /**
     * 单个片段布局与 `writeStructs()` 相同。
     */
    // 写入该客户端结构记录数。
    encoding.writeVarUint(restEncoder, partStructs.written)
    // 片段已含 client、起始时钟和结构正文。
    encoding.writeUint8Array(restEncoder, partStructs.restEncoder)
  }
}

/**
 * 逐结构转换更新线格式或内容，并原样保留删除集。
 *
 * 惰性 reader/writer 避免集成 Doc；`blockTransformer` 可改写每个解码结构。转换
 * 完成后同一输入 decoder 位于删除集起点，故能用目标编码器重新写出。
 *
 * 回调逐个接触未集成结构并可原位改写；异常立即中断编码，不返回半成品，也不对输入字节创建事务。
 *
 * @param {Uint8Array} update
 * @param {function(Item|GC|Skip):Item|GC|Skip} blockTransformer
 * @param {typeof UpdateDecoderV2 | typeof UpdateDecoderV1} YDecoder
 * @param {typeof UpdateEncoderV2 | typeof UpdateEncoderV1 } YEncoder
 */
export const convertUpdateFormat = (update, blockTransformer, YDecoder, YEncoder) => {
  const updateDecoder = new YDecoder(decoding.createDecoder(update))
  const lazyDecoder = new LazyStructReader(updateDecoder, false)
  const updateEncoder = new YEncoder()
  const lazyWriter = new LazyStructWriter(updateEncoder)
  for (let curr = lazyDecoder.curr; curr !== null; curr = lazyDecoder.next()) {
    writeStructToLazyStructWriter(lazyWriter, blockTransformer(curr), 0, 0)
  }
  finishLazyStructWriting(lazyWriter)
  const ds = readIdSet(updateDecoder)
  writeIdSet(updateEncoder, ds)
  return updateEncoder.toUint8Array()
}

/**
 * 控制更新脱敏时是否改写格式、子文档与类型/键名称。
 *
 * @typedef {Object} ObfuscatorOptions
 * @property {boolean} [ObfuscatorOptions.formatting=true] 是否替换 ContentFormat 的键和值；null 仍保留为格式取消标记。
 * @property {boolean} [ObfuscatorOptions.subdocs=true] 是否替换 ContentDoc.guid 并清空其 opts；false 保留子文档元信息。
 * @property {boolean} [ObfuscatorOptions.name=true] 是否替换 ContentType.type.name；Item.parentSub 键名始终替换，不受此开关控制。
 */

/**
 * 创建保持 CRDT 元数据不变的内容脱敏转换器。
 *
 * 同一原键/名称/格式值通过缓存映射到同一占位值，保留相等关系与结构形态；每个
 * Item 使用单调序号生成替代内容。GC、Skip 与 ContentDeleted 原样返回。
 *
 * 返回的闭包原位改写 Item 内容；每个转换批次独立缓存映射。ContentString 保持 UTF-16 长度，ContentBinary 替换为单字节但仍只占一个 clock。
 *
 * @param {ObfuscatorOptions} obfuscator
 */
const createObfuscator = ({ formatting = true, subdocs = true, name = true } = {}) => {
  let i = 0
  const mapKeyCache = map.create()
  const nodeNameCache = map.create()
  const formattingKeyCache = map.create()
  const formattingValueCache = map.create()
  formattingValueCache.set(null, null) // null 必须继续表示格式范围结束。
  /**
   * @param {Item|GC|Skip} block
   * @return {Item|GC|Skip}
   */
  return block => {
    switch (block.constructor) {
      case GC:
      case Skip:
        return block
      case Item: {
        const item = /** @type {Item} */ (block)
        const content = item.content
        switch (content.constructor) {
          case ContentDeleted:
            break
          case ContentType: {
            if (name) {
              const type = /** @type {ContentType} */ (content).type
              if (type.name != null) {
                type.name = map.setIfUndefined(nodeNameCache, type.name, () => 'typename-' + i)
              }
            }
            break
          }
          case ContentAny: {
            const c = /** @type {ContentAny} */ (content)
            c.arr = c.arr.map(() => i)
            break
          }
          case ContentBinary: {
            const c = /** @type {ContentBinary} */ (content)
            c.content = new Uint8Array([i])
            break
          }
          case ContentDoc: {
            const c = /** @type {ContentDoc} */ (content)
            if (subdocs) {
              c.opts = {}
              c.guid = i + ''
            }
            break
          }
          case ContentEmbed: {
            const c = /** @type {ContentEmbed} */ (content)
            c.embed = {}
            break
          }
          case ContentFormat: {
            const c = /** @type {ContentFormat} */ (content)
            if (formatting) {
              c.key = map.setIfUndefined(formattingKeyCache, c.key, () => i + '')
              c.value = map.setIfUndefined(formattingValueCache, c.value, () => ({ i }))
            }
            break
          }
          case ContentJSON: {
            const c = /** @type {ContentJSON} */ (content)
            c.arr = c.arr.map(() => i)
            break
          }
          case ContentString: {
            const c = /** @type {ContentString} */ (content)
            c.str = string.repeat((i % 10) + '', c.str.length)
            break
          }
          default:
            // 未知内容类型不能安全转换。
            error.unexpectedCase()
        }
        if (item.parentSub) {
          item.parentSub = map.setIfUndefined(mapKeyCache, item.parentSub, () => i + '')
        }
        i++
        return block
      }
      default:
        // 未知结构类型不能安全转换。
        error.unexpectedCase()
    }
  }
}

/**
 * 脱敏 V1 更新的用户内容，同时保留可复现 CRDT 结构。
 *
 * 适合分享故障更新；它替换文本、值、键名、子文档等载荷，但完整保留 ID、长度、
 * 锚点与删除元数据。攻击者仍可能从文档形态和编辑时序推断信息，不能视为强匿名。
 *
 * @param {Uint8Array} update
 * @param {ObfuscatorOptions} [opts]
 */
export const obfuscateUpdate = (update, opts) => convertUpdateFormat(update, createObfuscator(opts), UpdateDecoderV1, UpdateEncoderV1)

/**
 * 脱敏 V2 更新的用户内容，同时保留可复现 CRDT 结构。
 *
 * @param {Uint8Array} update
 * @param {ObfuscatorOptions} [opts]
 */
export const obfuscateUpdateV2 = (update, opts) => convertUpdateFormat(update, createObfuscator(opts), UpdateDecoderV2, UpdateEncoderV2)

/**
 * 不改结构内容，把 V1 更新转码为 V2。
 *
 * @param {Uint8Array} update
 */
export const convertUpdateFormatV1ToV2 = update => convertUpdateFormat(update, f.id, UpdateDecoderV1, UpdateEncoderV2)

/**
 * 不改结构内容，把 V2 更新转码为 V1。
 *
 * @param {Uint8Array} update
 */
export const convertUpdateFormatV2ToV1 = update => convertUpdateFormat(update, f.id, UpdateDecoderV2, UpdateEncoderV1)

/**
 * 按 `ContentIds` 求更新的结构与删除区间交集。
 *
 * 每个结构用 `IdSet.slice()` 分成命中片段；部分命中通过首尾 offset 编码。不连续
 * 命中之间在已经开始输出后插入 Skip，以保持后段绝对时钟；每客户端首个命中片段
 * 直接把时钟写在段头，不能以前导 Skip 开始。删除集独立做区间交集。
 *
 * @param {Uint8Array} update
 * @param {ContentIds} contentIds 要保留的插入与删除区间。
 * @param {typeof UpdateDecoderV1 | typeof UpdateDecoderV2} [YDecoder]
 * @param {typeof UpdateEncoderV1 | typeof UpdateEncoderV2} [YEncoder]
 * @return {Uint8Array<ArrayBuffer>}
 */
export const intersectUpdateWithContentIdsV2 = (update, contentIds, YDecoder = UpdateDecoderV2, YEncoder = UpdateEncoderV2) => {
  const { inserts, deletes } = contentIds
  const encoder = new YEncoder()
  const lazyStructWriter = new LazyStructWriter(encoder)
  const decoder = new YDecoder(decoding.createDecoder(update))
  const reader = new LazyStructReader(decoder, true)

  while (reader.curr) {
    const currClientId = reader.curr.id.client
    let nextClock = reader.curr.id.clock
    let firstWrite = false
    while (reader.curr != null && reader.curr.id.client === currClientId) {
      const curr = reader.curr
      for (const slice of inserts.slice(currClientId, curr.id.clock, curr.length)) {
        if (slice.exists) {
          const skipLen = slice.clock - nextClock
          if (skipLen > 0 && firstWrite) {
            // 已输出过真实结构后，用 Skip 表达命中片段间空洞。
            writeStructToLazyStructWriter(lazyStructWriter, new Skip(createID(currClientId, nextClock), skipLen), 0, 0)
          }
          // 通过首尾裁剪只写当前命中子区间。
          writeStructToLazyStructWriter(lazyStructWriter, curr, slice.clock - curr.id.clock, (curr.id.clock + curr.length) - (slice.clock + slice.len))
          nextClock = slice.clock + slice.len
          firstWrite = true
        }
      }
      reader.next()
    }
  }
  finishLazyStructWriting(lazyStructWriter)
  // 删除集与结构段独立筛选。
  const ds = readIdSet(decoder)
  const filteredDs = intersectSets(ds, deletes)
  writeIdSet(encoder, filteredDs)
  return encoder.toUint8Array()
}

/**
 * 按 `ContentIds` 筛选 V1 更新。
 *
 * 这是通用交集实现选择 V1 编解码器的兼容薄包装。
 *
 * @param {Uint8Array} update
 * @param {ContentIds} contentIds 要保留的插入与删除区间。
 * @return {Uint8Array<ArrayBuffer>}
 */
export const intersectUpdateWithContentIds = (update, contentIds) =>
  intersectUpdateWithContentIdsV2(update, contentIds, UpdateDecoderV1, UpdateEncoderV1)
