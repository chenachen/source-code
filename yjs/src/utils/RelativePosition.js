import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as error from 'lib0/error'

import { Item, followRedone, ContentType } from '../structs/Item.js'
import { writeID, readID, compareIDs, findRootTypeKey, createID } from './ID.js'
import { rendererContentLength } from './renderer-helpers.js'

/**
 * 用稳定结构 ID 或类型端点表示随编辑重新解析的 Yjs 位置。
 *
 * 数值索引无法表达插入发生后光标应黏附哪一侧；相对位置把锚点关联到指定字符，或关联到类型开头/末尾。例如 `Insert(0, 'x')('a|bc') = 'xa|bc'` 中 `|` 仍指向原字符边界。
 *
 * 有效位置的 `item`、`tname`、`type` 至少一个不为 null；空字符串也是合法根键。`item` 定位内容；无 item 时，`tname` 标识根类型，`type` 标识嵌套类型。
 *
 * @example
 *   import * as Y from '@y/y'
 *   import assert from 'node:assert/strict'
 *   const ydoc = new Y.Doc()
 *   const yText = ydoc.get('text')
 *   yText.insert(0, '0123456789!')
 *   // 当前光标位于索引 10，即 ! 之前。
 *   const relativePosition = Y.createRelativePositionFromTypeIndex(yText, 10)
 *   // 修改 yText。
 *   yText.insert(0, 'abc')
 *   yText.delete(3, 10)
 *   // 在新文档状态上重新解析光标。
 *   const absolutePosition = Y.createAbsolutePositionFromRelativePosition(relativePosition, ydoc)
 *   assert.equal(absolutePosition.type, yText)
 *   assert.equal(absolutePosition.index, 3)
 *   console.log('cursor location is ' + absolutePosition.index) // => cursor location is 3
 *   ydoc.destroy()
 *
 */
export class RelativePosition {
  /**
   * 创建稳定锚点；调用方必须提供 item，或提供根/嵌套类型标识作为端点锚点。
   *
   * 这里只保存字段，不检查锚点是否已同步；相同值可在不同 Doc 上解析，结构可用性在解析时判定。
   *
   * @param {ID|null} type - 承载嵌套类型的 Item ID。
   * @param {string|null} tname - 根类型键。
   * @param {ID|null} item - 锚定的内容 ID；可指向 Item 内部 clock。
   * @param {number} assoc - 非负关联右侧，负数关联左侧。
   */
  constructor (type, tname, item, assoc = 0) {
    /** 嵌套类型所属 Item 的 ID；根类型或内容锚点可为空。
     * @type {ID|null} */
    this.type = type
    /** 根类型键；嵌套类型或内容锚点可为空。
     * @type {string|null} */
    this.tname = tname
    /** 锚定内容的结构 ID；端点位置为空。
     * @type {ID | null} */
    this.item = item
    /**
     * 锚点黏附方向：`assoc >= 0` 关联目标边界右侧字符（`ab` 的位置 1 关联 `b`）；`assoc < 0` 关联左侧字符。
     *
     * @type {number}
     */
    this.assoc = assoc
  }
}

/**
 * 把相对位置转换为可 JSON 序列化的稀疏对象。
 *
 * 当前实现按 truthy 判断锚点字段：空字符串根键不会写入。因此无名根类型的端点位置应使用二进制编解码往返。
 * ID 字段仍引用原 ID 对象；此函数构造外层对象，不给它们分配新的结构地址。
 *
 * @param {RelativePosition} rpos - 待序列化位置。
 *
 * @return {any} 包含 truthy 锚点字段及非 null assoc 的对象。
 */
export const relativePositionToJSON = rpos => {
  const json = {}
  if (rpos.type) {
    json.type = rpos.type
  }
  if (rpos.tname) {
    json.tname = rpos.tname
  }
  if (rpos.item) {
    json.item = rpos.item
  }
  if (rpos.assoc != null) {
    json.assoc = rpos.assoc
  }
  return json
}

/**
 * 从 JSON 对象重建相对位置，并把 ID 字面量规范化为 `ID` 实例。
 *
 * @param {any} json - `relativePositionToJSON` 兼容对象。
 * @return {RelativePosition} 重建的位置；缺失 assoc 时兼容为零。
 *
 * @function
 */
export const createRelativePositionFromJSON = json => new RelativePosition(json.type == null ? null : createID(json.type.client, json.type.clock), json.tname ?? null, json.item == null ? null : createID(json.item.client, json.item.clock), json.assoc == null ? 0 : json.assoc)

/**
 * 相对位置在某份具体文档状态中的解析结果。
 *
 * `index` 只在对应 `type` 内有效；`assoc` 保留原锚点黏附方向，供后续选择逻辑使用。
 */
export class AbsolutePosition {
  /**
   * 创建绝对位置值对象。
   *
   * @param {YType<any>} type - 位置所属类型。
   * @param {number} index - 当前类型中的数值索引。
   * @param {number} [assoc] - 原相对位置的关联方向。
   */
  constructor (type, index, assoc = 0) {
    /** 位置所属共享类型。
     * @type {YType<any>} */
    this.type = type
    /** 内容锚点按 renderer 计算的当前索引；类型末尾端点取 type._length。
     * @type {number} */
    this.index = index
    /** 原相对锚点的黏附方向；负值向左关联，零或正值向右关联，不参与 index 校验。 */
    this.assoc = assoc
  }
}

/**
 * 创建绝对位置值对象的便捷函数。
 *
 * 不查询 store，也不校验 index；需要从稳定 ID 重新定位时应调用 `createAbsolutePositionFromRelativePosition()`。
 *
 * @param {YType<any>} type - 位置所属类型。
 * @param {number} index - 当前索引。
 * @param {number} [assoc] - 黏附方向。
 *
 * @function
 */
export const createAbsolutePosition = (type, index, assoc = 0) => new AbsolutePosition(type, index, assoc)

/**
 * 根据类型身份和可选内容 ID 创建相对位置。
 *
 * 根类型用 share 键标识，嵌套类型用其承载 Item ID 标识；两种形式可跨文档副本解析到同一逻辑类型。
 * 类型必须已集成：独立 YType 没有可编码的根键或宿主 ID。内容锚点存在时，二进制编码优先写 item ID，解析由其 parent 找回类型。
 *
 * @param {YType<any>} type - 锚点所属类型。
 * @param {ID|null} item - 内容锚点；`null` 表示由 assoc 决定类型开头或末尾。
 * @param {number} [assoc] - 黏附方向。
 *
 * @function
 */
export const createRelativePosition = (type, item, assoc) => {
  let typeid = null
  let tname = null
  if (type._item === null) {
    tname = findRootTypeKey(type)
  } else {
    typeid = createID(type._item.id.client, type._item.id.clock)
  }
  return new RelativePosition(typeid, tname, item, assoc)
}

/**
 * 把类型中的绝对索引转换为 renderer 感知的稳定相对位置。
 *
 * 负 assoc 锚定左字符：索引 0 使用类型起点端点，其余索引先左移一位；非负 assoc 锚定右字符。扫描长度来自 renderer，可把它展示的删除内容也纳入索引。
 * 左关联扫描越过末尾且链非空时使用最后一个 Item 的 lastId；否则返回类型端点。
 * 位置扫描与之后解析需使用相同 Renderer 计长规则；普通视图跳过不计长的格式/删除项，ID clock 偏移仍按原结构单位计算。
 *
 * @param {YType} type - 基础类型，如文本或数组。
 * @param {number} index - renderer 视图中的绝对位置。
 * @param {number} [assoc] - 黏附方向。
 * @param {import('../utils/Renderer.js').AbstractRenderer?} renderer - 决定每项可见长度的 renderer。
 * @return {RelativePosition} 内容锚点或类型端点；左关联且链非空时，越过末尾会锚定链尾 ID。
 *
 * @function
 */
export const createRelativePositionFromTypeIndex = (type, index, assoc = 0, renderer = null) => {
  let t = type._start
  if (assoc < 0) {
    // 左关联位置锚定前一字符；索引 0 没有左字符，使用类型起点端点。
    if (index === 0) {
      return createRelativePosition(type, null, assoc)
    }
    index--
  }
  while (t !== null) {
    const len = rendererContentLength(renderer, t)
    if (len > index) {
      // 目标落在当前结构内；ID clock 偏移可精确定位到结构内部。
      return createRelativePosition(type, createID(t.id.client, t.id.clock + index), assoc)
    }
    index -= len
    if (t.right === null && assoc < 0) {
      // 左关联越过末尾时直接取链尾 lastId；此处不再检查链尾的 renderer 可见长度。
      return createRelativePosition(type, t.lastId, assoc)
    }
    t = t.right
  }
  return createRelativePosition(type, null, assoc)
}

/**
 * 按判别标签写入相对位置：0=内容 ID，1=根类型名，2=嵌套类型 ID，末尾追加 assoc。
 *
 * item ID 优先于两种类型身份；字段全部为空会抛 unexpectedCase。assoc 使用带符号整数，所以左关联的负值能往返。
 *
 * @param {encoding.Encoder} encoder - 目标编码器。
 * @param {RelativePosition} rpos - 满足至少一个锚点字段非空的不变量位置。
 *
 * @function
 */
export const writeRelativePosition = (encoder, rpos) => {
  const { type, tname, item, assoc } = rpos
  if (item !== null) {
    encoding.writeVarUint(encoder, 0)
    writeID(encoder, item)
  } else if (tname !== null) {
    // 根类型端点以 share 键编码。
    encoding.writeUint8(encoder, 1)
    encoding.writeVarString(encoder, tname)
  } else if (type !== null) {
    // 嵌套类型端点以承载类型的 Item ID 编码。
    encoding.writeUint8(encoder, 2)
    writeID(encoder, type)
  } else {
    throw error.unexpectedCase()
  }
  encoding.writeVarInt(encoder, assoc)
  return encoder
}

/**
 * 把相对位置编码为独立字节数组。
 *
 * @param {RelativePosition} rpos - 待编码位置。
 * @return {Uint8Array} 可由 `decodeRelativePosition` 读取的载荷。
 */
export const encodeRelativePosition = rpos => {
  const encoder = encoding.createEncoder()
  writeRelativePosition(encoder, rpos)
  return encoding.toUint8Array(encoder)
}

/**
 * 从当前位置读取一个相对位置；旧载荷若不含 assoc，则默认使用零。
 *
 * @param {decoding.Decoder} decoder - 输入解码器。
 * @return {RelativePosition} 解码位置。
 *
 * @function
 */
export const readRelativePosition = decoder => {
  let type = null
  let tname = null
  let itemID = null
  switch (decoding.readVarUint(decoder)) {
    case 0:
      // 内容链中的结构 ID。
      itemID = readID(decoder)
      break
    case 1:
      // 根类型端点。
      tname = decoding.readVarString(decoder)
      break
    case 2: {
      // 嵌套类型端点。
      type = readID(decoder)
    }
  }
  const assoc = decoding.hasContent(decoder) ? decoding.readVarInt(decoder) : 0
  return new RelativePosition(type, tname, itemID, assoc)
}

/**
 * 从独立字节数组解码一个相对位置。
 *
 * @param {Uint8Array} uint8Array - 编码载荷。
 * @return {RelativePosition} 解码位置。
 */
export const decodeRelativePosition = uint8Array => readRelativePosition(decoding.createDecoder(uint8Array))

/**
 * 取得覆盖 ID clock 的结构及结构内偏移，但不追随 undo 产生的 redone 链。
 *
 * store 的查找可能返回 Skip/GC；本函数只返回原结构与偏移，是否能作为内容锚点由上游 instanceof Item 判断。
 *
 * @param {StructStore} store - 目标文档 store。
 * @param {ID} id - 可位于结构内部的 ID。
 */
const getItemWithOffset = (store, id) => {
  const item = store.getItem(id)
  const diff = id.clock - item.id.clock
  return {
    item, diff
  }
}

/**
 * 在给定文档状态和 renderer 视图中解析相对位置。
 *
 * 默认追随 undo 创建的 `redone` 链，让执行撤销的本地用户看到锚点恢复到重建内容；该映射不会随 update 持久化，跨用户共享位置时应传 `false`，否则客户端可能解析出不同索引。参见 https://github.com/yjs/yjs/issues/638 。
 *
 * 内容 ID 尚未同步或已被替换为 GC 时返回 null；只把载荷回收为 ContentDeleted 的 Item 仍可作为折叠锚点。嵌套类型端点须保留 ContentType，否则也返回 null。
 * 内容锚点累计左侧 Item 的 renderer 可见长度；其父类型已删除但 Item 仍可解析时返回该类型的索引 0。类型端点则按 assoc 返回 0 或 type._length，末尾值不经过 renderer。
 *
 * @param {RelativePosition} rpos - 待解析锚点。
 * @param {Doc} doc - 目标文档副本。
 * @param {boolean} followUndoneDeletions - 是否追随本地 undo 的 redone 链。
 * @param {import('../utils/Renderer.js').AbstractRenderer?} renderer - 决定可见长度的 renderer。
 * @return {AbsolutePosition|null} 当前绝对位置；锚点结构或类型身份不可解析时为 null。
 *
 * @function
 */
export const createAbsolutePositionFromRelativePosition = (rpos, doc, followUndoneDeletions = true, renderer = null) => {
  const store = doc.store
  const rightID = rpos.item
  const typeID = rpos.type
  const tname = rpos.tname
  const assoc = rpos.assoc
  let type = null
  let index = 0
  if (rightID !== null) {
    if (store.getClock(rightID.client) <= rightID.clock) {
      return null
    }
    const res = followUndoneDeletions ? followRedone(store, rightID) : getItemWithOffset(store, rightID)
    const right = res.item
    if (!(right instanceof Item)) {
      return null
    }
    type = /** @type {YType<any>} */ (right.parent)
    if (type._item === null || !type._item.deleted) {
      index = rendererContentLength(renderer, right) === 0 ? 0 : (res.diff + (assoc >= 0 ? 0 : 1)) // 左关联锚点位于该 ID 之后，因此额外前进一个单位。
      let n = right.left
      while (n !== null) {
        index += rendererContentLength(renderer, n)
        n = n.left
      }
    }
  } else {
    if (tname !== null) {
      type = doc.get(tname)
    } else if (typeID !== null) {
      if (store.getClock(typeID.client) <= typeID.clock) {
        // 承载嵌套类型的结构尚未同步到本副本。
        return null
      }
      const { item } = followUndoneDeletions ? followRedone(store, typeID) : { item: store.getItem(typeID) }
      if (item instanceof Item && item.content instanceof ContentType) {
        type = item.content.type
      } else {
        // 承载类型的内容已经被 GC，无法恢复类型身份。
        return null
      }
    } else {
      throw error.unexpectedCase()
    }
    if (assoc >= 0) {
      index = type._length
    } else {
      index = 0
    }
  }
  return createAbsolutePosition(type, index, rpos.assoc)
}

/**
 * 按根/嵌套类型身份、内容 ID 与 assoc 比较两个相对位置。
 *
 * @param {RelativePosition|null} a - 左位置。
 * @param {RelativePosition|null} b - 右位置。
 * @return {boolean} 引用相同，或全部结构字段相等时为 `true`。
 *
 * @function
 */
export const compareRelativePositions = (a, b) => a === b || (
  a !== null && b !== null && a.tname === b.tname && compareIDs(a.item, b.item) && compareIDs(a.type, b.type) && a.assoc === b.assoc
)
