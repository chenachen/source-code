import * as binary from 'lib0/binary'
import * as array from 'lib0/array'
import * as delta from 'lib0/delta'
import * as error from 'lib0/error'
import * as iterator from 'lib0/iterator'
import * as log from 'lib0/logging'
import * as map from 'lib0/map'
import * as set from 'lib0/set'
import * as math from 'lib0/math'
import * as object from 'lib0/object'
import * as s from 'lib0/schema'
import * as traits from 'lib0/traits'
import { ObservableV2 } from 'lib0/observable'
import {
  Item,
  ContentAny,
  ContentBinary,
  ContentDeleted,
  ContentEmbed,
  ContentFormat,
  ContentJSON,
  ContentString,
  ContentType,
  YXmlFragmentRefID,
  YXmlElementRefID,
  YXmlHookRefID,
  ContentDoc,
  createContentDocFromDoc
} from './structs/Item.js'
import { AttributedContent, rendererContentLength } from './utils/renderer-helpers.js'
import { removeEventHandlerListener, callEventHandlerListeners, addEventHandlerListener, createEventHandler } from './utils/EventHandler.js'
import { createID } from './utils/ID.js'
import { createIdSet, iterateStructsByIdSetWithoutSplits } from './utils/ids.js'
import { getItemCleanStart, cleanupFormattingGap } from './utils/transaction-helpers.js'
import { transact } from './utils/Transaction.js'
import { YEvent } from './utils/YEvent.js'
import { $ydoc } from './utils/schemas.js'

/**
 * Yjs 共享类型可保存的值域；嵌套 `YType` 与普通 JSON/二进制值共享同一容器接口。
 *
 * @typedef {Object<string,any>|Array<any>|number|null|string|Uint8Array|BigInt|YType<any>} YValue
 */

/**
 * 警告调用方：共享类型尚未挂入文档，预存的 preliminary Delta 还未写入列表与属性结构，读取不包含这些内容。
 *
 * 参见 https://docs.yjs.dev/getting-started/working-with-shared-types#caveats
 */
export const warnPrematureAccess = () => { log.warn('Invalid access: Add Yjs type to a document before reading data.') }

/** 搜索标记缓存的容量上限；达到上限后复用最久未使用的标记，避免定位缓存无界增长。 */
const maxSearchMarker = 80

/**
 * 把 Renderer 属性条目折叠为 Delta attribution；忽略 `_` 开头的内部字段，`insert`/`delete` 按删除态择一累积。
 *
 * `undefined` 表示跳过并继承 builder 当前 attribution；不能换成 `null`，后者会显式清空上下文。
 * @todo 不应返回可变普通对象。
 * @param {Array<ContentAttribute<any>>?} attrs - Renderer 切片的来源属性；空数组仍产生空作者列表，`null` 不开启自身归因。
 * @param {boolean} deleted - 当前属性内容是否处于删除态。
 * @return {Attribution|undefined} 无属性时返回 `undefined`，即 lib0 三态语义中的“跳过/继承”。
 */
export const createAttributionFromAttributionItems = (attrs, deleted) => {
  if (attrs == null) {
    return undefined
  }
  /**
   * @type {Attribution}
   */
  const attribution = {}
  if (deleted) {
    attribution.delete = []
  } else {
    attribution.insert = []
  }
  attrs.forEach(attr => {
    switch (attr.name) {
      // eslint-disable-next-line no-fallthrough
      case 'insert':
      case 'delete': {
        // 插入与删除 attribution 必须和当前删除态一致，避免同一内容同时被解释成两种变化。
        attribution[attr.name]?.push(attr.val)
        break
      }
      default: {
        if (attr.name[0] !== '_') {
          /** @type {any} */ (attribution)[attr.name] = attr.val
        }
      }
    }
  })
  return attribution
}

/**
 * 搜索标记的进程内单调时钟，用于近似 LRU 淘汰；它只比较新旧，不代表墙上时间。
 *
 * @type {number}
 */
let globalSearchMarkerTimestamp = 0

/**
 * 文本/列表遍历游标，同时维护左右 Item、可见索引、当前位置格式和 Renderer 视图。
 *
 * 不变量：`left` 与 `right` 始终相邻；`index` 按 Renderer 可见长度计数；`currentFormats`
 * 表示 `right` 之前生效的格式集合。
 */
export class ItemTextListPosition {
  /**
   * 创建指向 `right` 之前位置的共享游标，不主动扫描或校验链表。
   *
   * @param {Item|null} left - 光标左侧 Item。
   * @param {Item|null} right - 光标右侧 Item。
   * @param {number} index - Renderer 视图中的可见位置。
   * @param {Map<string,any>} currentFormats - 当前位置已生效格式。
   * @param {AbstractRenderer?} renderer - 决定 Item 可见长度与归因切片的 Renderer。
   */
  constructor (left, right, index, currentFormats, renderer) {
    /** 当前插入/删除边界左侧的结构；链首为 null。 */
    this.left = left
    /** 下一步将扫描的结构；链尾为 null。 */
    this.right = right
    /** 已越过内容在 Renderer 视图中的长度，不计格式标记。 */
    this.index = index
    /** right 之前生效的格式表；扫描格式标记时原地维护。 */
    this.currentFormats = currentFormats
    /** 与游标坐标配套的可见性/归因视图；null 使用存活内容长度。 */
    this.renderer = renderer
  }

  /**
   * 越过当前 `right`，同步更新可见索引或格式状态；调用方必须保证 `right` 非空。
   */
  forward () {
    if (this.right === null) {
      error.unexpectedCase()
    }
    switch (this.right.content.constructor) {
      case ContentFormat:
        if (!this.right.deleted) {
          updateCurrentFormats(this.currentFormats, /** @type {ContentFormat} */ (this.right.content))
        }
        break
      default:
        this.index += rendererContentLength(this.renderer, this.right)
        break
    }
    this.left = this.right
    this.right = this.right.right
  }

  /**
   * 在当前位置向右格式化指定可见长度，并在末端恢复该位置原先应生效的格式。
   *
   * Renderer 可能把一个 Item 切成多个可见片段，因此分割点必须按渲染片段时钟定位，不能直接使用
   * 原始 Item 长度。扫描到末尾仍有未消费长度时抛错；此前已写入的格式不会自动回滚。
   *
   * @param {Transaction} transaction
   * @param {YType} parent
   * @param {number} length - 从当前游标消费的 Renderer 可见长度，字符串按 UTF-16 单元计。
   * @param {Object<string,any>} formats - 仅修改这些键；`null` 清除，未列出的键保留。
   *
   * @function
   */
  formatText (transaction, parent, length, formats) {
    minimizeFormatChanges(this, formats)
    const negatedFormats = insertFormats(transaction, parent, this, formats)
    // 扫过目标内容及其后的格式标记：删除被本次格式覆盖的标记，并复用后续已有的恢复标记，避免重复插入。
    // eslint-disable-next-line no-labels
    iterationLoop: while (
      this.right !== null &&
      (length > 0 ||
        (
          negatedFormats.size > 0 &&
          ((this.right.deleted && rendererContentLength(this.renderer, this.right) === 0) || this.right.content.constructor === ContentFormat)
        )
      )
    ) {
      switch (this.right.content.constructor) {
        case ContentFormat: {
          if (!this.right.deleted) {
            const { key, value } = /** @type {ContentFormat} */ (this.right.content)
            const attr = formats[key]
            if (attr !== undefined) {
              if (equalFormats(attr, value)) {
                negatedFormats.delete(key)
              } else {
                if (length === 0) {
                  // 内容范围已结束，遇到不匹配格式后无需继续扩张待恢复集合。
                  // eslint-disable-next-line no-labels
                  break iterationLoop
                }
                negatedFormats.set(key, value)
              }
              this.right.delete(transaction)
            } else {
              this.currentFormats.set(key, value)
            }
          }
          break
        }
        default: {
          const item = this.right
          const rightLen = rendererContentLength(this.renderer, item)
          if (length < rightLen) {
            if (this.renderer !== null && this.renderer.hasItem(item)) {
              /**
               * @type {Array<AttributedContent<any>>}
               */
              const contents = []
              this.renderer.readContent(contents, item.id.client, item.id.clock, item.deleted, item.content, 0)
              let i = 0
              for (; i < contents.length && length > 0; i++) {
                const c = contents[i]
                if ((!c.deleted || c.attrs != null) && c.content.isCountable()) {
                  length -= c.content.getLength()
                }
              }
              if (length < 0 || (length === 0 && i !== contents.length)) {
                const c = contents[--i]
                getItemCleanStart(transaction, createID(item.id.client, c.clock + c.content.getLength() + length))
              }
            } else {
              // 无 Renderer 的普通内容可直接按 Item 内偏移切分。
              getItemCleanStart(transaction, createID(item.id.client, item.id.clock + length))
              length = 0
            }
          } else {
            length -= rightLen
          }
          break
        }
      }
      this.forward()
    }
    if (length > 0) {
      throw new Error('Exceeded content range')
    }
    insertNegatedFormats(transaction, parent, this, negatedFormats)
  }
}

/**
 * 在范围末端写入恢复标记，使后续内容保持修改前在该位置应生效的格式。
 *
 * 先越过已表达恢复值的现有标记，只为仍缺失的键创建 Item。
 *
 * @param {Transaction} transaction
 * @param {YType} parent
 * @param {ItemTextListPosition} currPos - 待恢复边界的可变游标；写入后越过新标记。
 * @param {Map<string,any>} negatedFormats - 尚未恢复的格式键和值；已有恢复标记会从此 Map 中移除。
 *
 * @private
 * @function
 */
const insertNegatedFormats = (transaction, parent, currPos, negatedFormats) => {
  // 先确认哪些恢复格式已由右侧标记表达，避免写入冗余 Item。
  while (
    currPos.right !== null && (
      (currPos.right.deleted && rendererContentLength(currPos.renderer, currPos.right) === 0) || (
        currPos.right.content.constructor === ContentFormat &&
        equalFormats(negatedFormats.get(/** @type {ContentFormat} */ (currPos.right.content).key), /** @type {ContentFormat} */ (currPos.right.content).value)
      )
    )
  ) {
    if (!currPos.right.deleted) {
      negatedFormats.delete(/** @type {ContentFormat} */ (currPos.right.content).key)
    }
    currPos.forward()
  }
  const doc = transaction.doc
  const ownClientId = doc.clientID
  negatedFormats.forEach((val, key) => {
    const left = currPos.left
    const right = currPos.right
    const nextFormat = new Item(createID(ownClientId, doc.store.getClock(ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentFormat(key, val))
    nextFormat.integrate(transaction, 0)
    currPos.right = nextFormat
    currPos.forward()
  })
}

/**
 * 把一个格式标记应用到当前位置格式表；`null` 表示移除该键。
 *
 * @param {Map<string,any>} currentFormats
 * @param {ContentFormat} format
 *
 * @private
 * @function
 */
const updateCurrentFormats = (currentFormats, format) => {
  const { key, value } = format
  if (value === null) {
    currentFormats.delete(key)
  } else {
    currentFormats.set(key, value)
  }
}

/**
 * 向右跳过删除项和已表达目标值的格式标记，把真正需要变更的位置作为插入点。
 *
 * @param {ItemTextListPosition} currPos
 * @param {Object<string,any>} formats
 *
 * @private
 * @function
 */
const minimizeFormatChanges = (currPos, formats) => {
  // 已删除的零长度项以及与目标值相同的格式标记不会改变结果，可安全越过。
  while (true) {
    if (currPos.right === null) {
      break
    } else if (currPos.right.deleted ? (rendererContentLength(currPos.renderer, currPos.right) === 0) : (!currPos.right.deleted && currPos.right.content.constructor === ContentFormat && equalFormats(formats[(/** @type {ContentFormat} */ (currPos.right.content)).key] ?? null, /** @type {ContentFormat} */ (currPos.right.content).value))) {
      //
    } else {
      break
    }
    currPos.forward()
  }
}

/**
 * 写入与当前位置不同的格式起始标记，并返回范围末端应恢复的旧值集合。
 * 新标记集成后同步推进游标和 currentFormats；每个键的旧值取当前位置状态，缺失规范化为 null。
 *
 * @param {Transaction} transaction
 * @param {YType} parent
 * @param {ItemTextListPosition} currPos
 * @param {Object<string,any>} formats
 * @return {Map<string,any>} 新建的恢复值 Map，仅包含实际写入新起始标记的格式键。
 *
 * @private
 * @function
 **/
const insertFormats = (transaction, parent, currPos, formats) => {
  const doc = transaction.doc
  const ownClientId = doc.clientID
  const negatedFormats = new Map()
  // 每个发生变化的键各写一个格式起始 Item。
  for (const key in formats) {
    const val = formats[key]
    const currentVal = currPos.currentFormats.get(key) ?? null
    if (!equalFormats(currentVal, val)) {
      // 保存旧值供范围末端恢复；未设置的键规范化为 `null`。
      negatedFormats.set(key, currentVal)
      const { left, right } = currPos
      currPos.right = new Item(createID(ownClientId, doc.store.getClock(ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentFormat(key, val))
      currPos.right.integrate(transaction, 0)
      currPos.forward()
    }
  }
  return negatedFormats
}

/**
 * 插入一个已封装的 AbstractContent，并在两侧写入必要的格式起止标记。
 *
 * `formats` 表示新内容的完整格式：当前位置已有但参数缺失的键会被补为 `null`，因此不带格式的
 * 插入不会自动继承左侧格式。先写起始标记并更新搜索标记，再集成内容，最后恢复右侧原有格式。
 *
 * @param {Transaction} transaction
 * @param {YType} parent
 * @param {ItemTextListPosition} currPos
 * @param {import('./structs/Item.js').AbstractContent} content - 待集成内容；长度用于平移搜索标记。
 * @param {Object<string,any>} formats - 插入内容的完整格式对象；本函数会为缺失的当前格式键原地补 `null`。
 *
 * @private
 * @function
 **/
export const insertContent = (transaction, parent, currPos, content, formats) => {
  currPos.currentFormats.forEach((_val, key) => {
    if (formats[key] === undefined) {
      formats[key] = null
    }
  })
  const doc = transaction.doc
  const ownClientId = doc.clientID
  minimizeFormatChanges(currPos, formats)
  const negatedFormats = insertFormats(transaction, parent, currPos, formats)
  let { left, right, index } = currPos
  if (parent._searchMarker) {
    updateMarkerChanges(parent._searchMarker, currPos.index, content.getLength())
  }
  right = new Item(createID(ownClientId, doc.store.getClock(ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, content)
  right.integrate(transaction, 0)
  currPos.right = right
  currPos.index = index
  currPos.forward()
  insertNegatedFormats(transaction, parent, currPos, negatedFormats)
}

/**
 * 把字符串或混合值数组拆成合适的 Content 实现，再逐段交给 `insertContent` 集成。
 *
 * 普通值会连续打包为 `ContentAny`；嵌套共享类型与子文档必须独立成 Item，以保留各自生命周期。
 *
 * @param {Transaction} transaction
 * @param {YType} parent
 * @param {ItemTextListPosition} currPos
 * @param {Array<any>|string} insert - 文本或混合数组；数组中的 Delta 先转为 preliminary YType。
 * @param {Object<string,any>} formats
 */
export const insertContentHelper = (transaction, parent, currPos, insert, formats) => {
  if (s.$string.check(insert)) {
    insertContent(transaction, parent, currPos, new ContentString(insert), formats)
  } else {
    insert = insert.map(ins => delta.$deltaAny.check(ins) ? YType.from(ins) : ins)
    for (let i = 0; i < insert.length;) {
      const first = insert[i]
      if (first instanceof YType) {
        insertContent(transaction, parent, currPos, new ContentType(first), formats)
        i++
      } else if ($ydoc.check(first)) {
        insertContent(transaction, parent, currPos, createContentDocFromDoc(first), formats)
        i++
      } else {
        // 连续普通值共享一个 `ContentAny`，减少 Item 数量；遇到共享类型或子文档才切段。
        let j = i + 1
        for (; j < insert.length && !(insert[j] instanceof YType || $ydoc.check(insert[j])); j++) { /* 只推进连续区间。 */ }
        insertContent(transaction, parent, currPos, new ContentAny((i === 0 && j === insert.length) ? insert : insert.slice(i, j)), formats)
        i = j
      }
    }
  }
}

/**
 * 从游标开始删除内容，并返回移动后的同一游标。
 *
 * 对已删除但仍带 attribution 显示的片段，不再删除 CRDT Item，而把区间记入事务的
 * `attributedDeletes`，供 DiffRenderer 在关闭建议模式时向基线补发删除；普通 delete 不返回 inverse fix。
 * 存活可计数 Item 直接按原始长度删除，不经过 Renderer 片段处理，因此仍会删除被自定义视图隐藏的存活内容。
 *
 * @param {Transaction} transaction
 * @param {ItemTextListPosition} currPos
 * @param {number} length - 待删除额度；非空列表扫到链尾即结束，不因额度未耗尽而抛错。
 * @return {ItemTextListPosition} 同一可变游标，已越过删除范围及相应格式标记。
 *
 * @private
 * @function
 */
export const deleteText = (transaction, currPos, length) => {
  const startLength = length
  const startFormats = map.copy(currPos.currentFormats)
  const start = currPos.right
  while (length > 0 && currPos.right !== null) {
    const item = currPos.right
    if (!item.deleted && item.countable) {
      if (length < item.length) {
        getItemCleanStart(transaction, createID(item.id.client, item.id.clock + length))
      }
      length -= item.length
      item.delete(transaction)
    } else if (currPos.renderer !== null && currPos.renderer.hasItem(item)) {
      /**
       * @type {Array<AttributedContent<any>>}
       */
      const contents = []
      currPos.renderer.readContent(contents, item.id.client, item.id.clock, true, item.content, 0)
      let splitClock = -1
      for (let i = 0; i < contents.length; i++) {
        const c = contents[i]
        if (c.content.isCountable() && c.attrs != null) {
          if (length === 0) {
            // 删除额度已耗尽但 Item 仍渲染后续内容：必须在片段边界切开，游标才能只越过已消费部分；
            // 否则同一 Delta 的后续操作都会错误地落到更右侧。
            splitClock = c.clock
            break
          }
          // 内容在 CRDT 中已删除但 Renderer 仍显示：只记录归因删除元数据，不重复 tombstone。
          const pieceLen = c.content.getLength()
          const contentLen = math.min(pieceLen, length)
          map.setIfUndefined(transaction.meta, 'attributedDeletes', createIdSet).add(item.id.client, c.clock, contentLen)
          length -= contentLen
          if (contentLen < pieceLen) {
            splitClock = c.clock + contentLen
            break
          }
        }
      }
      if (splitClock >= 0) {
        getItemCleanStart(transaction, createID(item.id.client, splitClock))
      } else {
        const lastContent = contents.length > 0 ? contents[contents.length - 1] : null
        const nextItemClock = item.id.clock + item.length
        const nextContentClock = lastContent != null ? lastContent.clock + lastContent.content.getLength() : nextItemClock
        if (nextContentClock < nextItemClock) {
          getItemCleanStart(transaction, createID(item.id.client, nextContentClock))
        }
      }
    }
    currPos.forward()
  }
  if (start) {
    cleanupFormattingGap(transaction, start, currPos.right, startFormats, currPos.currentFormats)
  }
  const parent = /** @type {YType<any>} */ (/** @type {Item} */ (currPos.left || currPos.right).parent)
  if (parent._searchMarker) {
    updateMarkerChanges(parent._searchMarker, currPos.index, -startLength + length)
  }
  return currPos
}

/**
 * 共享列表的稀疏定位缓存，保存一个 Item 及其存活内容起始索引。
 *
 * 标记不参与 CRDT 结果计算；远端变更可直接清空，因此缓存失效只影响性能，不影响一致性。
 */
export class ArraySearchMarker {
  /**
   * 创建标记并设置目标 Item 的 `marker` 位，供缓存规范化时识别已有标记。
   * Item 仍可合并；`Item.mergeWith` 会把被合并右项上的搜索标记迁移到左项。
   *
   * @param {Item} p - 标记指向的 Item。
   * @param {number} index - Item 在可见列表中的起始索引。
   */
  constructor (p, index) {
    p.marker = true
    /** 缓存点对应的 Item；分割或合并时由定位/合并路径维护。 */
    this.p = p
    /** p 的存活列表起始索引，与 Renderer 无关。 */
    this.index = index
    /** 最近创建/命中的进程内逻辑时钟，供近似 LRU 淘汰。 */
    this.timestamp = globalSearchMarkerTimestamp++
  }
}

/**
 * 刷新标记的访问时钟，使淘汰策略保留近期命中的位置。
 *
 * @param {ArraySearchMarker} marker
 */
const refreshMarkerTimestamp = marker => { marker.timestamp = globalSearchMarkerTimestamp++ }

/**
 * 把既有标记移到新 Item，同时更新旧、新 Item 的 `marker` 位、索引和访问时钟。
 *
 * @param {ArraySearchMarker} marker
 * @param {Item} p
 * @param {number} index
 */
const overwriteMarker = (marker, p, index) => {
  marker.p.marker = false
  marker.p = p
  p.marker = true
  marker.index = index
  marker.timestamp = globalSearchMarkerTimestamp++
}

/**
 * 新建搜索标记；容量已满时覆盖最久未使用者，保持对象数不超过 `maxSearchMarker`。
 *
 * @param {Array<ArraySearchMarker>} searchMarker
 * @param {Item} p
 * @param {number} index
 */
const markPosition = (searchMarker, p, index) => {
  if (searchMarker.length >= maxSearchMarker) {
    // 容量已满：复用最旧对象，避免定位缓存持续分配。
    const marker = searchMarker.reduce((a, b) => a.timestamp < b.timestamp ? a : b)
    overwriteMarker(marker, p, index)
    return marker
  } else {
    // 尚有容量：为这个位置创建新标记。
    const pm = new ArraySearchMarker(p, index)
    searchMarker.push(pm)
    return pm
  }
}

/**
 * 找到距目标索引最近的搜索标记并沿 Item 链校准，返回刷新过访问时钟的标记。
 *
 * 标记最多 `maxSearchMarker` 个。校准后向左退到同 client、连续 clock 区间的起点并保存标记；
 * 真正合并时由 `Item.mergeWith` 更新标记。偏移较大时新增或淘汰标记，
 * 较近时原地覆盖。这里按存活可计数 Item 长度定位，不使用 Renderer 视图。
 *
 * @param {YType} yarray - 使用存活内容坐标的列表。
 * @param {number} index - 待查询索引；起点 0 不需要缓存。
 * @return {ArraySearchMarker|null} 校准后的标记；空列表、起点或禁用缓存时返回 `null`。
 */
export const findMarker = (yarray, index) => {
  if (yarray._start === null || index === 0 || yarray._searchMarker === null) {
    return null
  }
  const marker = yarray._searchMarker.length === 0 ? null : yarray._searchMarker.reduce((a, b) => math.abs(index - a.index) < math.abs(index - b.index) ? a : b)
  let p = yarray._start
  let pindex = 0
  if (marker !== null) {
    p = marker.p
    pindex = marker.index
    refreshMarkerTimestamp(marker) // 本次命中刷新热度，近期查询可继续复用。
  }
  // 先从最近缓存点向右逼近目标索引。
  while (p.right !== null && pindex < index) {
    if (!p.deleted && p.countable) {
      if (index < pindex + p.length) {
        break
      }
      pindex += p.length
    }
    p = p.right
  }
  // 缓存点也可能位于目标右侧，此时反向校准。
  while (p.left !== null && pindex > index) {
    p = p.left
    if (!p.deleted && p.countable) {
      pindex -= p.length
    }
  }
  // 退到同 client、连续 clock 区间的左端；这两个条件只是实际合并条件的一部分。
  while (p.left !== null && p.left.id.client === p.id.client && p.left.id.clock + p.left.length === p.id.clock) {
    p = p.left
    if (!p.deleted && p.countable) {
      pindex -= p.length
    }
  }
  if (marker !== null && math.abs(marker.index - pindex) < /** @type {any} */ (p.parent).length / maxSearchMarker) {
    // 新位置仍靠近旧标记时原地调整，减少缓存抖动。
    overwriteMarker(marker, p, pindex)
    return marker
  } else {
    // 距离足够大时保留旧热点，并为新区域分配标记。
    return markPosition(yarray._searchMarker, p, pindex)
  }
}

/**
 * 按一次插入或删除平移受影响搜索标记。插入前还会把删除/格式项上的标记移到左侧存活项；
 * 删除路径在 Item 已标为删除后调用，此时只修正索引，指向删除项的标记留待之后规范化。
 *
 * @param {Array<ArraySearchMarker>} searchMarker - 待原地维护的缓存数组，规范化可能删除条目。
 * @param {number} index - 变更前的存活列表起点。
 * @param {number} len - 插入为正长度，删除为负长度。
 */
export const updateMarkerChanges = (searchMarker, index, len) => {
  for (let i = searchMarker.length - 1; i >= 0; i--) {
    const m = searchMarker[i]
    if (len > 0) {
      /**
       * @type {Item|null}
       */
      let p = m.p
      p.marker = false
      // 插入前先把可能指向删除/格式 Item 的标记移到前一个可见 Item；只有规范化后才能可靠比较位置。
      while (p && (p.deleted || !p.countable)) {
        p = p.left
        if (p && !p.deleted && p.countable) {
          // `p` 的起点比原标记早一个 Item，因此同步减去该 Item 长度。
          m.index -= p.length
        }
      }
      if (p === null || p.marker === true) {
        // 无安全前驱或前驱已有标记时删除重复缓存。
        searchMarker.splice(i, 1)
        continue
      }
      m.p = p
      p.marker = true
    }
    if (index < m.index || (len > 0 && index === m.index)) { // 插入点处的标记也必须右移；删除点处则保持边界。
      m.index = math.max(index, m.index + len)
    }
  }
}

/**
 * 按结构顺序返回共享类型的全部列表 Item，包括已删除和不可计数项，供调试与结构级测试使用。
 *
 * @param {YType} t
 * @return {Array<Item>}
 */
export const getTypeChildren = t => {
  t.doc ?? warnPrematureAccess()
  let s = t._start
  const arr = []
  while (s) {
    arr.push(s)
    s = s.right
  }
  return arr
}

/**
 * 派发类型观察事件，并把同一事件登记到所有祖先的深度事件队列。
 *
 * 删除类型默认不触发自身 observer；但挂有 Renderer 时它仍可能可见，因此继续派发。无论自身是否派发，
 * 祖先登记都不能跳过，否则软删除子树内的变化无法到达 `observeDeep`、Delta 缓存和绑定层。
 *
 * @param {YType} type
 * @param {Transaction} transaction
 * @param {YEvent<any>} event - 同一事件先登记到祖先，再同步派发当前类型的浅层 observer。
 */
export const callTypeObservers = (type, transaction, event) => {
  const changedType = type
  const changedParentTypes = transaction.changedParentTypes
  // 无条件沿父链登记：自定义 Renderer 可显示 tombstone，活祖先仍需收到其内部变化。
  while (true) {
    // @ts-ignore
    map.setIfUndefined(changedParentTypes, type, () => []).push(event)
    if (type._item === null) {
      break
    }
    type = /** @type {YType} */ (type._item.parent)
  }
  // tombstone 类型挂有 Renderer 时仍派发自身 observer；实际可见内容由 Renderer 渲染决定。
  if (changedType._item === null || !changedType._item.deleted || changedType._renderer !== null) {
    callEventHandlerListeners(/** @type {any} */ (changedType._eH), event, transaction)
  }
}

/**
 * 统一承载列表、富文本和键值属性的 Yjs 共享类型，也是 lib0 Delta RDT 的适配层。
 *
 * `YType` 实现 lib0 `RDT`（replicated data type，见 `lib0/delta/rdt.js`）：状态变化时在
 * `'delta'` 通道发出变化及事务 origin，通过 {@link YType#applyDelta} 接收外部变化，并以
 * {@link YType#$delta} 暴露 schema。因而它可与另一 `YType`、内存 Delta 或 DOM 子树等 RDT
 * `bind()`。传统的 {@link YType#observe} / {@link YType#observeDeep} `YEvent` API 与此通道并存。
 *
 * @template {delta.DeltaConf} [DConf=any]
 * @extends {ObservableV2<{ delta: (delta: delta.Delta<DConf>, origin: any) => void, destroy: (type: YType<DConf>) => void }>}
 */
export class YType extends ObservableV2 {
  /**
   * 创建尚未集成的共享类型；列表、属性和事件状态为空，首次挂入 `Doc` 后才获得 CRDT 身份。
   *
   * @param {delta.DeltaConfGetName<DConf>?} name - Delta/类 XML 节点名；`null` 表示匿名片段。
   */
  constructor (name = null) {
    super()
    /** @type {delta.DeltaConfGetName<DConf>} Delta 与序列化使用的节点名。 */
    this.name = /** @type {delta.DeltaConfGetName<DConf>} */ (name)
    /** @type {Item|null} 当前类型作为嵌套值时对应的宿主 Item；根类型为 `null`。 */
    this._item = null
    /** @type {Map<string,Item>} 每个属性键当前获胜的最新 Item。 */
    this._map = new Map()
    /** @type {Item|null} 列表/文本 Item 双向链的起点。 */
    this._start = null
    /** @type {Doc|null} 集成后所属文档；未集成时为 `null`。 */
    this.doc = null
    /** Renderer 无关、仅统计活跃可计数 Item 的逻辑长度。 */
    this._length = 0
    /**
     * 当前类型的浅层 `YEvent` 处理器。
     * @type {EventHandler<YEvent<DeltaToYType<DConf>>,Transaction>}
     */
    this._eH = createEventHandler()
    /**
     * 当前类型及其后代的深层 `YEvent` 处理器。
     * @type {EventHandler<YEvent<DConf>,Transaction>}
     */
    this._dEH = createEventHandler()
    /** @type {null | Array<ArraySearchMarker>} 列表位置的稀疏性能缓存。 */
    this._searchMarker = null
    /**
     * {@link YType#delta} 背后的深层 Delta 活缓存。首次读取前为 `null`；事务和 Renderer change
     * 原地应用深层变化。切换 Renderer 会重建并替换缓存，{@link YType#clearCache} 可释放。
     * @type {delta.DeltaBuilderAny | null}
     */
    this._delta = null
    /** 二进制更新协议使用的旧式类型引用，名称决定默认 XML fragment/element 编码。 */
    this._legacyTypeRef = this.name == null ? YXmlFragmentRefID : YXmlElementRefID
    /**
     * 构造结束时启用空搜索缓存；格式 Item 集成后可能将它设为 null，因为仅靠数值索引无法恢复格式上下文。
     * @type {Array<ArraySearchMarker>|null}
     */
    this._searchMarker = []
    /**
     * 是否曾集成格式 Item；远端事务据此决定是否安排格式去重清理。
     * 该标志由 `ContentFormat.integrate` 更新。
     */
    this._hasFormatting = false
    /**
     * 默认 Renderer；`toDelta`、`applyDelta` 与事件未显式传参时使用。
     * `null` 走按原始内容渲染的通用快速路径，由 {@link YType#useRenderer} 切换。
     * @type {AbstractRenderer?}
     */
    this._renderer = null
    /**
     * 活跃 Renderer `'change'` 事件的绑定回调，用于没有 Y 事务的 attribution 覆盖层修正
     * （如接受建议）。无 Renderer 时为 `null`，由 {@link YType#useRenderer} 管理；参见
     * {@link typeApplyRendererChange}。
     * @type {((changes: IdSet, origin: any, local: boolean) => void) | null}
     */
    this._rendererChangeHandler = null
  }

  /**
   * 返回此类型产生的 Delta schema，满足 lib0 `RDT` 接口。
   *
   * @type {s.Schema<delta.Delta<DConf>>}
   */
  get $delta () {
    return /** @type {any} */ (delta.$deltaAny)
  }

  /**
   * 返回此类型完整嵌套内容树的深层 Delta 活缓存，子类型会渲染为各自 Delta。
   *
   * 返回值是**活对象**：首次访问时物化，普通编辑和 Renderer change 会原地更新。切换 Renderer、
   * 清缓存或 `destroy()` 会丢弃这份对象，此后须重新读取 getter。稳定快照可用 lib0 的
   * `delta.clone(type.delta)`，释放缓存用 {@link YType#clearCache}。
   *
   * 调用方应把它当作只读 Delta。内部保留可变 builder 用于增量更新，返回类型只暴露 `Delta`；
   * 绕过类型直接修改会改变缓存而非 CRDT。写入共享类型必须调用 {@link YType#applyDelta}。
   *
   * @type {delta.Delta<DConf>}
   */
  get delta () {
    if (this._delta === null) {
      this._delta = this._renderDelta()
    }
    return /** @type {any} */ (this._delta)
  }

  /**
   * 用当前 Renderer 把完整深层状态渲染到新的 `isFinal` builder，供后续深层变化原地 `.apply()`。
   *
   * @return {delta.DeltaBuilderAny}
   */
  _renderDelta () {
    const state = /** @type {delta.DeltaBuilderAny} */ (delta.create(this.name))
    state.isFinal = true
    state.apply(this.toDelta({ deep: true }))
    return state
  }

  /**
   * 丢弃 {@link YType#delta} 的深层 Delta 缓存，下次读取将从 CRDT 状态完整重建。
   *
   * 已持有的旧缓存对象不再维护；重新读取 getter 会获得新的完整渲染结果。
   */
  clearCache () {
    this._delta = null
  }

  /**
   * 切换默认 Renderer；之后 `toDelta`、`applyDelta` 与事件在没有显式参数时使用它，单次调用的
   * `{ renderer }` 仍可覆盖。
   *
   * 若已维护深层缓存或存在 `'delta'` listener，会用新 Renderer 重渲染并仅在 `'delta'` 通道发差异。
   * Renderer 切换不是 CRDT 变化，因此不产生 `YEvent`；这里发出的差异 origin 固定为 `null`。
   *
   * @param {AbstractRenderer?} renderer - `null` 表示解绑并恢复原样渲染。
   * @return {this}
   */
  useRenderer (renderer) {
    const prev = this._renderer
    if (renderer === prev) return this
    if (this._rendererChangeHandler !== null) {
      /** @type {AbstractRenderer} */ (prev).off('change', this._rendererChangeHandler)
      this._rendererChangeHandler = null
    }
    if (renderer !== null && this._rendererChangeHandler === null) {
      // 接受建议等 attribution 修正可能没有 Y 事务；订阅 Renderer 才能同步 RDT 缓存与 `'delta'`。
      // `destroy()` 会清空默认 Renderer 和 handler，再次传入原 Renderer 时会重新建立订阅。
      this._rendererChangeHandler = (changes, origin) => typeApplyRendererChange(this, changes, origin)
      renderer.on('change', this._rendererChangeHandler)
    }
    const hasDeltaListeners = (this._observers.get('delta')?.size ?? 0) > 0
    if (this._delta !== null || hasDeltaListeners) {
      const oldState = this._delta ?? this._renderDelta()
      this._renderer = renderer
      const newState = this._renderDelta()
      if (this._delta !== null) this._delta = newState
      if (hasDeltaListeners) {
        const d = /** @type {any} */ (delta.diff(/** @type {any} */ (oldState), /** @type {any} */ (newState)))
        if (!d.isEmpty()) this.emit('delta', [d, null])
      }
    } else {
      this._renderer = renderer
    }
    return this
  }

  /**
   * 销毁此类型的 RDT 表面：发出 `'destroy'`，注销 `'delta'`/`'destroy'` listener，解绑 Renderer
   * 并丢弃 {@link YType#delta} 缓存。
   *
   * CRDT 内容和 `observe`/`observeDeep` 不受影响；这里只释放绑定层。必须同时清缓存，否则事务路径
   * 仍会更新它，却收不到 Renderer 的 attribution 修正，后续读取会静默漂移。销毁后仍可通过
   * `useRenderer(renderer)` 与再次读取 `delta` 重新激活。
   */
  destroy () {
    if (this._rendererChangeHandler !== null) {
      /** @type {AbstractRenderer} */ (this._renderer).off('change', this._rendererChangeHandler)
      this._rendererChangeHandler = null
    }
    this._renderer = null
    this._delta = null
    this.emit('destroy', [this])
    super.destroy()
  }

  /**
   * 从完整 Delta 创建未集成 `YType`，先把变化累积到 preliminary Delta，集成时再写入 CRDT。
   *
   * @template {delta.DeltaConf} DC
   * @param {delta.Delta<DC>} d
   * @return {YType<DC>}
   */
  static from (d) {
    const yt = new YType(d.name)
    yt.applyDelta(d)
    return yt
  }

  /** 返回当前活跃、可计数列表内容长度；未集成访问会发出警告。 */
  get length () {
    this.doc ?? warnPrematureAccess()
    return this._length
  }

  /**
   * 返回一个新的空 DeltaBuilder，供调用方构造适用于此类型的变化。
   * @type {delta.DeltaBuilder<DeltaToYType<DConf>>}
   */
  get change () {
    return /** @type {any} */ (delta.create())
  }

  /**
   * 返回嵌套宿主 `YType`；根类型或未集成类型没有父级。
   *
   * @return {YType<any>?}
   */
  get parent () {
    return /** @type {YType<any>?} */ (this._item ? this._item.parent : null)
  }

  /**
   * 把 preliminary 共享类型挂入文档和宿主 Item，并在同一集成阶段应用预存 Delta。
   *
   * 宿主 Item 与随后写入的内容结构进入 StructStore；根类型通过文档的根类型表定位。
   * 同一事务中新集成子类型的初始化不单独派发自身 observer，由父类型的插入事件携带完整子状态。
   *
   * @param {Doc} y - 所属 Yjs 文档。
   * @param {Item|null} item - 嵌套类型的宿主 Item；根类型传 `null`。
   */
  _integrate (y, item) {
    this.doc = y
    this._item = item
    if (this._prelim) {
      this.applyDelta(this._prelim)
      this._prelim = null
    }
  }

  /**
   * 创建同名、同旧式类型引用但不含内容的副本骨架，供 `clone()` 填充深层 Delta。
   *
   * @return {YType<DConf>}
   */
  _copy () {
    const ytype = new YType(this.name)
    ytype._legacyTypeRef = this._legacyTypeRef
    return ytype
  }

  /**
   * 为本次事务创建 `YEvent`，派发浅层 observer 并登记祖先事件；深层 observer 由事务清理随后派发。
   * 远端变更还会清空搜索标记，并在存在格式项时标记待清理。
   *
   * @param {Transaction} transaction
   * @param {Set<null|string>} parentSubs - 本类型变化的属性键；列表内容变化用 `null`。
   */
  _callObserver (transaction, parentSubs) {
    const event = new YEvent(/** @type {any} */ (this), transaction, parentSubs)
    callTypeObservers(/** @type {any} */ (this), transaction, event)
    // RDT `'delta'` 与深层缓存由事务清理的 `changedParentTypes` 循环驱动，才能像 `observeDeep`
    // 一样冒泡到祖先；此处仅知道直接变化类型，不能维护完整深层路径。
    if (!transaction.local && this._searchMarker) {
      this._searchMarker.length = 0
    }
    // 远端变化可能引入等价格式标记，延迟到事务清理统一去重。
    if (!transaction.local && this._hasFormatting) {
      transaction._needFormattingCleanup = true
    }
  }

  /**
   * 注册当前类型的浅层 `YEvent` observer，并返回原函数以便后续注销。
   *
   * @template {(target: YEvent<DeltaToYType<DConf>>, tr: Transaction) => void} F
   * @param {F} f - observer 函数。
   * @return {F}
   */
  observe (f) {
    addEventHandlerListener(this._eH, f)
    return f
  }

  /**
   * 注册当前类型及其后代的深层 `YEvent` observer，并返回原函数。
   *
   * @template {function(YEvent<DConf>,Transaction):void} F
   * @param {F} f - observer 函数。
   * @return {F}
   */
  observeDeep (f) {
    addEventHandlerListener(this._dEH, f)
    return f
  }

  /**
   * 注销先前由 `observe()` 注册的浅层 observer。
   *
   * @param {(type:YEvent<DeltaToYType<DConf>>,tr:Transaction)=>void} f - 先前注册的 observer。
   */
  unobserve (f) {
    removeEventHandlerListener(this._eH, f)
  }

  /**
   * 注销先前由 `observeDeep()` 注册的深层 observer。
   *
   * @param {function(YEvent<DConf>,Transaction):void} f - 先前注册的深层 observer。
   */
  unobserveDeep (f) {
    removeEventHandlerListener(this._dEH, f)
  }

  /**
   * 把当前共享类型渲染为 Delta；可输出完整状态，也可按 `itemsToRender` 输出一次变化的增量视图。
   *
   * Renderer 可让 tombstone 继续可见并携带 attribution，此时删除内容以带 `delete` attribution 的
   * 正向 insert 表示，而不是把内容本身变成 `DeleteOp`。`deep` 模式递归渲染嵌套类型。
   *
   * @template {boolean} [Deep=false]
   *
   * @param {Object} [opts]
   * @param {AbstractRenderer?} [opts.renderer] - 内容与 attribution Renderer；默认使用当前类型的活跃 Renderer。
   * @param {IdSet?} [opts.itemsToRender] - `null` 渲染完整状态；ID 集合使范围内内容输出变化，其余内容保留位置。
   * @param {boolean} [opts.retainInserts] - 是否把已渲染插入输出为 retain，供 attribution 修复缓存。
   * @param {boolean} [opts.retainDeletes] - 是否把仍渲染且带 attribution 的删除输出为 retain。
   * @param {IdSet?} [opts.insertedItems] - 本次变化新插入的 id；同次插入又删除的内容仍是 fresh insert。
   * @param {Map<YType,Set<string|null>>|null} [opts.modified] - 需要作为已修改子节点递归渲染的类型与属性键。
   * @param {Deep} [opts.deep] - 是否把子类型渲染为 Delta。
   * @return {Deep extends true ? delta.Delta<DConf> : delta.Delta<DeltaConfDeltaToYType<DConf>>} 当前类型的 Delta 表示。
   *
   * @public
   */
  toDelta (opts = {}) {
    const { renderer = this._renderer, itemsToRender = null, retainInserts = false, retainDeletes = false, insertedItems = null, deep = false } = opts
    const { modified = (deep && itemsToRender) ? computeModifiedFromItems(/** @type {Doc} */ (this.doc).store, itemsToRender) : null } = opts
    const renderAttrs = modified?.get(this) || null
    const renderChildren = modified == null || !modified.has(this) || /** @type {Set<string|null>} */ (modified.get(this)).has(null)
    /**
     * @type {delta.DeltaBuilderAny}
     */
    const d = /** @type {any} */ (delta.create(this.name))
    const optsAll = object.assign({}, opts, { renderer, modified })
    // `renderer` 与 `modified` 已规范化进 `optsAll`，后续递归必须使用同一组选项。
    typeMapGetDelta(d, /** @type {any} */ (this), renderAttrs, renderer, deep, modified, itemsToRender, optsAll, optsAll)
    if (renderChildren) {
      /**
       * @type {delta.Formats}
       */
      let currentFormats = {} // 当前绝对格式，用于生成 insert。
      let usingCurrentFormats = false
      /**
       * @type {delta.Formats}
       */
      let changedFormats = {} // 相对消费方缓存的格式差异，用于生成 retain。
      let usingChangedFormats = false
      /**
       * 格式 attribution 的基准值：格式标记之后的内容归因给创建该标记的人；若标记把值恢复为此前
       * 无 attribution 的值，或删除标记而恢复旧值，则后续内容不应继续继承该 attribution。
       * @type {delta.Formats}
       */
      const previousUnattributedFormats = {} // 每个 attribution 格式范围之前的无归因值。
      /**
       * @type {delta.Formats}
       */
      const previousFormats = {} // 消费方缓存中、应用本次变化前的格式值。
      /**
       * `currentFormats` 每个键的来源：`true` 表示当前值由待处理 attribution 标记开启。
       * 变化渲染遇到删除标记时据此区分重新暴露的是已提交外层值（应清缓存旧 attribution），还是仍待
       * 处理的建议值（如重新加粗，应保留 attribution）。
       * @type {{ [key: string]: boolean }}
       */
      const currentFormatsAttributed = {}
      /**
       * 为“自身 attribution 已移除”的 retain 生成清理参数。无环境 attribution 时 `null` 可清空全部；
       * 位于外层格式 attribution 中时，fresh render 仍应保留环境格式，因此返回逐字段 `null` 对象，
       * 借助 lib0 `combineInstr` 只清 insert/delete 自身归因。
       */
      const clearedOwnAttribution = () => d.usedAttribution == null ? null : /** @type {any} */ ({ insert: null, insertAt: null, delete: null, deleteAt: null })
      /**
       * attribution 变化渲染中真正渲染过的格式键。通常 retained 格式边界不产生 op；但若同键渲染标记
       * 已先出现，该变化会让后续 retained 边界成为“恢复旧值”，它管辖的范围必须清掉缓存旧归因。
       * 按键跟踪避免误清其他格式；仅在格式标记处读取，完整渲染和无格式变化热路径保持 `null`。
       * @type {Set<string>?}
       */
      let renderedFormatKeys = null
      /**
       * 单个 Item 的 Renderer 输出缓冲；一个 Item 可按 attribution 边界拆成多个片段。
       * @type {Array<AttributedContent<any>>}
       */
      const cs = []
      /**
       * 处理一个可能带 attribution 的内容片段，是 Renderer 与通用路径共用的 op 发射/格式状态机。
       * Renderer 路径输入 `readContent` 的所有片段；通用路径只输入所有 `ContentFormat` 标记，因为
       * 即使无归因的标记也可能关闭先前归因范围，普通内容则走直接发射快速路径。
       * @param {AttributedContent<any>} c
       */
      const processContent = c => {
        // Renderer 要求显示且带 attribution 的 tombstone 仍作为正向内容渲染。
        const renderContent = c.render && (!c.deleted || c.attrs != null)
        // 本次删除但不作为可见插入渲染的内容，用 DeleteOp 表达位置变化。
        const renderDelete = c.render && c.deleted
        // 未直接渲染的既有可见内容只 retain，并附加相对格式变化。
        const retainContent = !c.render && (!c.deleted || c.attrs != null)
        const attribution = (renderContent || c.content.constructor === ContentFormat) ? createAttributionFromAttributionItems(c.attrs, c.deleted) : undefined
        switch (c.content.constructor) {
          case ContentDeleted: {
            // fresh(mode 3) 内容从未进入消费方状态；GC 内容又无法还原成 insert，因此不能发 delete。
            if (renderDelete && !c.fresh) d.delete(c.content.getLength())
            break
          }
          case ContentString:
            if (renderContent) {
              if (c.deleted ? (retainDeletes && !c.fresh) : retainInserts) {
                // retain 表达相对既有缓存的格式 diff，必须用含 `null` 清理的 `changedFormats`；绝对值
                // `currentFormats` 只会重申仍存在格式，可能遗留已删除格式。fresh 内容同次插入又删除，
                // 消费方无内容可 retain，因此下方仍渲染为带 attribution 的 insert。
                d.useFormats(changedFormats)
                usingChangedFormats = true
                // 变化渲染中 retained Item 无 attribution 表示原归因被移除，需显式清理而非 `{}` 跳过。
                d.retain(/** @type {ContentString} */ (c.content).str.length, undefined, attribution ?? clearedOwnAttribution())
              } else {
                d.useFormats(currentFormats)
                usingCurrentFormats = true
                d.insert(/** @type {ContentString} */ (c.content).str, undefined, attribution)
              }
            } else if (renderDelete) {
              d.delete(c.content.getLength())
            } else if (retainContent) {
              d.useFormats(changedFormats)
              usingChangedFormats = true
              d.retain(c.content.getLength())
            }
            break
          case ContentEmbed:
          case ContentAny:
          case ContentJSON:
          case ContentType:
          case ContentBinary:
          case ContentDoc:
            if (renderContent) {
              if (c.deleted ? (retainDeletes && !c.fresh) : retainInserts) {
                // retain 使用相对格式差异，规则同 `ContentString`。
                d.useFormats(changedFormats)
                usingChangedFormats = true
                if (c.deleted && c.content.constructor === ContentType) {
                  d.modify(/** @type {any} */ (c.content).type.toDelta(optsAll), undefined, attribution ?? null)
                } else if (c.content.constructor === ContentType && modified?.has(/** @type {ContentType} */ (c.content).type)) {
                  // Renderer 仍显示但归因变化的节点需清/并自身 attribution，再递归精确修复
                  // `itemsToRender` 子 id；其他子节点保持原归因。
                  d.modify(/** @type {any} */ (c.content).type.toDelta(optsAll), undefined, attribution ?? clearedOwnAttribution())
                } else {
                  d.retain(c.content.getLength(), undefined, attribution ?? clearedOwnAttribution())
                }
              } else if (deep && c.content.constructor === ContentType) {
                d.useFormats(currentFormats)
                usingCurrentFormats = true
                d.insert([/** @type {any} */(c.content).type.toDelta(optsAll)], undefined, attribution)
              } else {
                d.useFormats(currentFormats)
                usingCurrentFormats = true
                d.insert(c.content.getContent(), undefined, attribution)
              }
            } else if (renderDelete) {
              d.delete(1)
            } else if (retainContent) {
              if (c.content.constructor === ContentType && modified?.has(/** @type {ContentType} */ (c.content).type)) {
                d.modify(/** @type {any} */ (c.content).type.toDelta(optsAll))
              } else {
                d.useFormats(changedFormats)
                usingChangedFormats = true
                d.retain(1)
              }
            }
            break
          case ContentFormat: {
            const { key, value } = /** @type {ContentFormat} */ (c.content)
            const currFormatVal = currentFormats[key] ?? null
            if (attribution != null && (c.deleted || !object.hasProperty(previousUnattributedFormats, key))) {
              previousUnattributedFormats[key] = c.deleted ? value : currFormatVal
            }
            // @todo 抽出 `updateCurrentFormats` 与 `updateChangedFormats`。
            // 第一阶段：更新绝对格式与相对缓存格式差异。
            if (renderContent || renderDelete) {
              // builder 可能仍引用旧对象；写前复制，避免已发射 op 的格式随之后状态突变。
              if (usingCurrentFormats) {
                currentFormats = object.assign({}, currentFormats)
                usingCurrentFormats = false
              }
              if (usingChangedFormats) {
                usingChangedFormats = false
                changedFormats = object.assign({}, changedFormats)
              }
            }
            if (renderContent || renderDelete) {
              if (itemsToRender !== null && renderer !== null) {
                // 只有带 attribution 的变化渲染会在后续恢复分支查询此集合。
                if (renderedFormatKeys === null) renderedFormatKeys = new Set()
                renderedFormatKeys.add(key)
              }
              // `previousFormats` 表示消费方缓存当前位置的控制值，让 retain 始终做“缓存 → 新状态”比较。
              // 贡献者包括事件中本次删除的标记、修复渲染重放的活标记及下方 retained 活标记；已在缓存中
              // 处理过的旧删除标记不能再次贡献。即便删除标记值碰巧等于当前值也要记录，否则后续标记会
              // 被误判为恢复旧值，从而吞掉必要的格式 diff。
              if (c.deleted) {
                if (itemsToRender !== null && !retainInserts) previousFormats[key] = value
              } else { // !c.deleted
                if (retainInserts) previousFormats[key] = value
                if (value == null) {
                  delete currentFormats[key]
                } else {
                  currentFormats[key] = value
                }
                currentFormatsAttributed[key] = false
              }
              // 每个渲染标记都按键重算后续范围的“缓存值 → 新状态值”差异。
              if (equalFormats(currentFormats[key] ?? null, previousFormats[key] ?? null)) {
                delete changedFormats[key]
              } else {
                changedFormats[key] = currentFormats[key] ?? null
              }
            } else if (retainContent && !c.deleted) {
              // retained 活标记更新绝对格式；写前复制可能已被 builder 引用的对象。
              if (usingCurrentFormats) {
                currentFormats = object.assign({}, currentFormats)
                usingCurrentFormats = false
              }
              if (usingChangedFormats && changedFormats[key] !== undefined) {
                usingChangedFormats = false
                changedFormats = object.assign({}, changedFormats)
              }
              if (value == null) {
                delete currentFormats[key]
              } else {
                currentFormats[key] = value
              }
              currentFormatsAttributed[key] = false
              delete changedFormats[key]
              previousFormats[key] = value
            }
            // 第二阶段：更新 attribution 上下文。
            // 带归因 Renderer 的变化渲染中，某格式标记插入后又删除可能净归因为 `null`，但它仍结束此前
            // 开启的归因范围；后续 retain 必须对该键发显式 `null`，不能用清空整个上下文代替。仅当恢复到
            // 无值或已提交外层值时清理；若恢复到仍待处理的归因值（如重新加粗）则保留。若同键归因范围
            // 仍打开，环境上下文会给后续 retain 重新盖上正确归因，也不在这里清理。
            const isDeletedFormatClear = attribution == null && renderer !== null && renderDelete && c.deleted && itemsToRender != null && (currFormatVal == null || currentFormatsAttributed[key] !== true) && !equalFormats(value, currFormatVal) && !object.hasProperty(previousUnattributedFormats, key)
            // `isAcceptedFormatClear` 是活标记版本：标记仍存在但建议被接受后自身 attribution 消失。
            // 修复渲染须在其控制范围内逐键清理旧 `{ format: { [key]: [] } }`，不能用全局 `null` 误删
            // 同位置其他 attribution。只在 `retainInserts` 修复模式启用；普通事件里的无归因新标记不应
            // 产生清理。若同键归因范围仍打开，则按下方常规分支保留环境归因或在范围末端关闭。
            const isAcceptedFormatClear = attribution == null && renderer !== null && renderContent && !c.deleted && itemsToRender != null && retainInserts && !object.hasProperty(previousUnattributedFormats, key)
            if (attribution != null || isDeletedFormatClear || isAcceptedFormatClear || object.hasProperty(previousUnattributedFormats, key)) {
              /**
                 * @type {Attribution}
                 */
              const formattingAttribution = object.assign({}, d.usedAttribution)
              const changedAttributedFormats = /** @type {{ [key: string]: Array<any>|null }} */ (formattingAttribution.format = object.assign({}, formattingAttribution.format ?? {}))
              const sameAsPreviousAttributions = equalFormats(previousUnattributedFormats[key], currentFormats[key] ?? null)
              // 本次渲染的无归因标记若恢复此前无归因值并关闭同键范围，须清缓存中该范围的旧归因。
              // 与完整渲染保持一致：仅当移除该键会让格式归因上下文为空时才关闭；若另一归因键仍使上下文
              // 打开，则修改只发生在未安装副本上，本次变化也不能误清此键。
              const isRangeEndClear = attribution == null && sameAsPreviousAttributions && renderContent && !c.deleted && itemsToRender != null && renderer !== null && object.hasProperty(previousUnattributedFormats, key) && object.every(changedAttributedFormats, (_v, k) => k === key)
              if (isDeletedFormatClear || (isAcceptedFormatClear && changedAttributedFormats[key] == null)) {
                // 统一发逐键清理，包括结束旧归因范围的标记；若缓存本就无旧值，合并后自然是 no-op。
                changedAttributedFormats[key] = null
                delete previousUnattributedFormats[key]
              } else if (isAcceptedFormatClear) {
                // 已接受标记仍位于同键待处理归因范围内：相对基础文档该范围仍是建议变化，保留环境归因。
              } else if (attribution == null && !sameAsPreviousAttributions) {
                // 无归因且未恢复旧值：不改变当前 attribution 上下文。
              } else if (attribution == null || sameAsPreviousAttributions) {
                // 无归因标记或“恢复旧状态”的归因标记代表范围结束。变化渲染若真正渲染了该标记，须发逐键
                // `null`，让缓存后续 retain 去掉旧归因；仅从上下文对象删键会把旧值留在缓存。若同键渲染
                // 标记先于一个 retained 边界，该边界也是因本次变化才恢复旧值，同样须清。纯 retained 边界
                // 或完整 insert 渲染只需删上下文键，避免为未变范围发 op 或给新插入制造伪清理。
                // `c.fresh` 格式标记虽走 retained 路径，但恢复旧值时仍是新状态归因范围末端，规则相同。
                if (isRangeEndClear || (attribution != null && itemsToRender != null && (renderContent || renderDelete || c.fresh || renderedFormatKeys?.has(key) === true))) {
                  changedAttributedFormats[key] = null
                } else {
                  delete changedAttributedFormats[key]
                  // 若副本只剩逐键清理，必须重新加入当前键并安装；否则会关闭控制范围却未把清理传播到后续
                  // retain，留下旧归因。fresh 上下文不会产生 `null` 叶，因此其他模式不受影响。
                  if (itemsToRender != null && !object.isEmpty(changedAttributedFormats) && object.every(changedAttributedFormats, v => v == null)) {
                    changedAttributedFormats[key] = null
                  }
                }
                delete previousUnattributedFormats[key]
              } else {
                // attribution 标记为该键开启待处理控制范围；删除标记不写绝对格式，值等于此前无归因值的
                // 标记已由上方恢复分支处理为已提交控制范围。
                if (!c.deleted) currentFormatsAttributed[key] = true
                const by = changedAttributedFormats[key] = (changedAttributedFormats[key]?.slice() ?? [])
                by.push(...((c.deleted ? attribution.delete : attribution.insert) ?? []))
                const attributedAt = (c.deleted ? attribution.deleteAt : attribution.insertAt)
                if (attributedAt) formattingAttribution.formatAt = attributedAt
              }
              if (object.isEmpty(changedAttributedFormats)) {
                d.useAttribution(null)
              } else if (attribution != null || isDeletedFormatClear || isAcceptedFormatClear || isRangeEndClear || (itemsToRender != null && object.every(changedAttributedFormats, v => v == null))) {
                // 全为逐键 `null` 的变化渲染副本等价于 fresh 渲染的空副本；仍须安装，使无归因关闭标记
                // 结束控制范围的同时把待处理清理传播下去，避免环境上下文把旧键重新并回缓存。
                const attributedAt = (c.deleted ? attribution?.deleteAt : attribution?.insertAt)
                if (attributedAt != null) formattingAttribution.formatAt = attributedAt
                d.useAttribution(formattingAttribution)
              }
            }
            break
          }
        }
      }
      for (let item = this._start; item !== null; item = item.right) {
        const content = item.content
        if (renderer === null || !renderer.hasItem(item)) {
          // Renderer 未声明接管的内容原样走快速路径：不查 attribution、不分配包装，完整覆盖时也不切片。
          if (content.constructor === ContentFormat) {
            // 所有格式标记都必须进入共享状态机，哪怕其本身无 attribution。
            processContent(new AttributedContent(content, item.id.clock, item.deleted, null,
              itemsToRender == null ? 1 : (itemsToRender.has(item.id.client, item.id.clock) ? 2 : 0)))
          } else if (item.deleted) {
            // 普通 tombstone 不可见；变化渲染仅对本次删除 id 发位置型 `delete`，无需读取原内容。
            if (itemsToRender !== null && itemsToRender.intersects(item.id.client, item.id.clock, item.length)) {
              const rslice = itemsToRender.slice(item.id.client, item.id.clock, item.length)
              for (let ir = 0; ir < rslice.length; ir++) {
                const idrange = rslice[ir]
                if (idrange.exists) {
                  // 与 Renderer 切片语义一致：字符串类按长度删，其他内容每片按一个元素删。
                  d.delete((content.constructor === ContentString || content.constructor === ContentDeleted) ? idrange.len : 1)
                }
              }
            }
          } else if (itemsToRender == null) {
            if (retainInserts) {
              // attribution 覆盖层修复：保留既有内容，并清理其先前缓存的自身归因。
              d.useFormats(changedFormats)
              usingChangedFormats = true
              d.retain(content.getLength(), undefined, clearedOwnAttribution())
            } else {
              // 完整状态渲染：一次 insert 输出整个普通 Item。
              d.useFormats(currentFormats)
              usingCurrentFormats = true
              if (deep && content.constructor === ContentType) {
                d.insert([/** @type {any} */(content).type.toDelta(optsAll)])
              } else if (content.constructor === ContentString) {
                d.insert(/** @type {ContentString} */ (content).str)
              } else {
                d.insert(content.getContent())
              }
            }
          } else {
            // 活普通内容的变化渲染：本次 id 范围输出 insert，其他范围只 retain；修复模式还会 retain
            // 先前插入内容并清除其旧 attribution。
            const rslice = itemsToRender.slice(item.id.client, item.id.clock, item.length)
            let itemContent = rslice.length > 1 ? content.copy() : content
            for (let ir = 0; ir < rslice.length; ir++) {
              const idrange = rslice[ir]
              const c = itemContent
              if (ir !== rslice.length - 1) {
                itemContent = itemContent.splice(idrange.len)
              }
              if (!idrange.exists) {
                if (content.constructor === ContentType && modified?.has(/** @type {ContentType} */ (content).type)) {
                  d.modify(/** @type {ContentType} */ (content).type.toDelta(optsAll))
                } else {
                  d.useFormats(changedFormats)
                  usingChangedFormats = true
                  // retain 长度与 Renderer 分片一致，非字符串片段按一个元素计。
                  d.retain(content.constructor === ContentString ? idrange.len : 1)
                }
              } else if (retainInserts) {
                if (content.constructor === ContentType && modified?.has(/** @type {ContentType} */ (content).type)) {
                  // 子节点归因变化（如插入建议被接受）时，清自身归因并递归精确修复 `itemsToRender` 中的
                  // 子 id；变化集外子节点保持原归因，不能粗暴清空整棵子树。
                  d.modify(/** @type {ContentType} */ (content).type.toDelta(optsAll), undefined, clearedOwnAttribution())
                } else {
                  d.useFormats(changedFormats)
                  usingChangedFormats = true
                  d.retain(idrange.len, undefined, clearedOwnAttribution())
                }
              } else {
                d.useFormats(currentFormats)
                usingCurrentFormats = true
                if (deep && content.constructor === ContentType) {
                  d.insert([/** @type {any} */(content).type.toDelta(optsAll)])
                } else if (content.constructor === ContentString) {
                  d.insert(/** @type {ContentString} */ (c).str)
                } else {
                  d.insert(c.getContent())
                }
              }
            }
          }
        } else {
          cs.length = 0
          if (itemsToRender != null) {
            const rslice = itemsToRender.slice(item.id.client, item.id.clock, item.length)
            // 本次插入又删除的 fresh 内容使用 mode 3：即使 `retainDeletes` 也输出 insert，因为消费方缓存
            // 从未见过它，无对象可 retain。fresh 必须按 id 范围判断而非按 Item：清理会把相邻 struct
            // 合并，一个 Item 可能横跨新旧 id。`ContentFormat` 不会合并，保留 mode 0 的 retained 路径，
            // 让格式状态机按变化发生前的方式解释 fresh-deleted 标记。
            const checkFresh = item.deleted && insertedItems !== null && content.constructor !== ContentFormat
            const freshFormat = item.deleted && insertedItems !== null && content.constructor === ContentFormat && insertedItems.hasId(item.id)
            let itemContent = rslice.length > 1 ? content.copy() : content
            for (let ir = 0; ir < rslice.length; ir++) {
              const idrange = rslice[ir]
              let c = itemContent
              if (ir !== rslice.length - 1) {
                itemContent = itemContent.splice(idrange.len)
              }
              if (!idrange.exists || !checkFresh) {
                renderer.readContent(cs, item.id.client, idrange.clock, item.deleted, c,
                  idrange.exists ? (freshFormat ? 0 : 2) : 0)
              } else {
                // `itemsToRender` 合并不同来源后，一个存在区间仍可能跨新旧 id，需再按 `insertedItems` 切分。
                const fslice = insertedItems.slice(item.id.client, idrange.clock, idrange.len)
                let subContent = fslice.length > 1 ? c.copy() : c
                for (let fi = 0; fi < fslice.length; fi++) {
                  const frange = fslice[fi]
                  c = subContent
                  if (fi !== fslice.length - 1) {
                    subContent = subContent.splice(frange.len)
                  }
                  renderer.readContent(cs, item.id.client, frange.clock, item.deleted, c, frange.exists ? 3 : 2)
                }
              }
            }
            if (freshFormat) {
              // fresh 格式标记仍走 mode 0，但状态机必须知道其 freshness：恢复旧值的 fresh clear 会结束
              // attribution 范围并发逐键清理。`ContentFormat` 长度固定为 1，当前缓冲只含该 Item 的片段。
              for (let i = 0; i < cs.length; i++) { cs[i].fresh = true }
            }
          } else {
            renderer.readContent(cs, item.id.client, item.id.clock, item.deleted, content, 1)
          }
          for (let i = 0; i < cs.length; i++) {
            processContent(cs[i])
          }
        }
      }
    }
    return /** @type {any} */ (d.done(false))
  }

  /**
   * 以 `deep: true` 调用 `toDelta()`，把嵌套共享类型递归渲染为 Delta。
   *
   * @param {Object} [opts]
   * @param {AbstractRenderer?} [opts.renderer] - 可选 Renderer；默认使用类型当前 Renderer。
   * @return {delta.Delta<DConf>}
   */
  toDeltaDeep (opts = {}) {
    return /** @type {any} */ (this.toDelta({ ...opts, deep: true }))
  }

  /**
   * 把 Delta 变化应用到此共享类型；列表游标按 Renderer 内容长度推进，属性 op 写入 map CRDT。
   * 存活内容的删除仍按原始 Item 长度处理，见 {@link deleteText}；自定义隐藏视图不能据此当作完整编辑投影。
   *
   * 未集成类型先累积 preliminary Delta。若目标已删除但 Renderer 仍显示，则不写文档，而返回相对
   * 调用方预期状态的 inverse fix；正常应用且无需修正时返回 `null`。
   *
   * @param {delta.DeltaAny} d - 要应用的变化。
   * @param {any} [origin] - 原样写入事务并转发到 `'delta'`，供 listener 识别并跳过自己产生的变化。
   * @param {Object} [opts]
   * @param {AbstractRenderer?} [opts.renderer] - 解释可见坐标的 Renderer；默认使用当前 Renderer。
   * @return {delta.DeltaBuilder<any>?} lib0 RDT fix：把 `old.apply(d)` 的预期状态修正为实际状态；
   * 干净应用时为 `null`。`modify`/`modifyAttr` 命中软删除节点时，未应用部分以相对渲染状态的 inverse 返回。
   *
   * @public
   */
  applyDelta (d, origin = null, { renderer = this._renderer } = {}) {
    if (d.isEmpty()) return null
    if (this.doc == null) {
      (this._prelim || (this._prelim = /** @type {any} */ (delta.create()))).apply(d)
      return null
    }
    const titem = this._item
    if (titem !== null && titem.deleted) {
      if (rendererContentLength(renderer, titem) > 0) {
        // 软删除节点仍在调用方视图中：文档不接受写入，返回相对该渲染状态的整段 inverse。
        const inv = delta.inverse(d, /** @type {any} */ (this.toDeltaDeep({ renderer })))
        return inv.isEmpty() ? null : /** @type {any} */ (inv)
      }
      return null // 硬删除/不可见类型不在调用方坐标中，静默丢弃变化。
    }
    // @todo 此逻辑从旧 YText 迁来，仍需进一步泛化。
    return transact(this.doc, transaction => {
      /**
       * 累积返回给调用方的 fix。坐标属于调用方预期空间，因此跟随输入 `d` 的 `expectedIndex`；不能用
       * `currPos.index`，后者还统计删除操作扫过但因 attribution 继续渲染的 tombstone。
       *
       * @type {delta.DeltaBuilder<any>?}
       */
      let fix = null
      let fixLen = 0
      let expectedIndex = 0
      /**
       * 把嵌套 `modify` 的 fix 追加到正确预期坐标，并可同时恢复父级格式。
       *
       * @param {delta.DeltaAny?} childFix - 子类型未接受的变化之 inverse；`null` 时仅修正父级格式。
       * @param {{ [k:string]: any }} [invFormat] - 软删除子节点的原父级格式，`null` 叶用于清除调用方新增格式。
       */
      const appendModifyFix = (childFix, invFormat) => {
        const f = fix ?? (fix = /** @type {any} */ (delta.create()))
        expectedIndex > fixLen && f.retain(expectedIndex - fixLen)
        f.modify(/** @type {any} */ (childFix ?? delta.create().done(false)), invFormat)
        fixLen = expectedIndex + 1
      }
      const currPos = new ItemTextListPosition(null, this._start, 0, new Map(), renderer)
      for (const op of d.children) {
        if (delta.$textOp.check(op)) {
          insertContent(transaction, /** @type {any} */ (this), currPos, new ContentString(op.insert), op.format || {})
          expectedIndex += op.length
        } else if (delta.$insertOp.check(op)) {
          insertContentHelper(transaction, this, currPos, op.insert, op.format || {})
          expectedIndex += op.length
        } else if (delta.$retainOp.check(op)) {
          currPos.formatText(transaction, /** @type {any} */ (this), op.retain, op.format || {})
          expectedIndex += op.length
        } else if (delta.$deleteOp.check(op)) {
          deleteText(transaction, currPos, op.delete)
        } else if (delta.$modifyOp.check(op)) {
          let item = currPos.right
          while (item !== null && rendererContentLength(renderer, item) === 0) { item = item.right }
          if (item == null || item.content.constructor !== ContentType) { error.unexpectedCase() }
          if (item.deleted) {
            // 软删除子节点不写入而回退：先越过它并收集沿途格式，但不应用 `op.format`；递归后由子节点
            // 删除保护返回 inverse，再把父级格式恢复合并进 fix。
            currPos.formatText(transaction, /** @type {any} */ (this), 1, {})
            /** @type {{ [k:string]: any }|undefined} */
            let invFormat
            for (const k in op.format) {
              (invFormat ?? (invFormat = {}))[k] = currPos.currentFormats.get(k) ?? null
            }
            const childFix = /** @type {ContentType} */ (item.content).type.applyDelta(op.value, origin, { renderer })
            if (childFix !== null || invFormat !== undefined) {
              appendModifyFix(childFix, invFormat)
            }
          } else {
            const childFix = /** @type {ContentType} */ (item.content).type.applyDelta(op.value, origin, { renderer })
            currPos.formatText(transaction, /** @type {any} */ (this), 1, op.format || {})
            if (childFix !== null) {
              appendModifyFix(childFix)
            }
          }
          expectedIndex += 1
        } else {
          error.unexpectedCase()
        }
      }
      for (const op of d.attrs) {
        if (delta.$setAttrOp.check(op)) {
          typeMapSet(transaction, /** @type {any} */ (this), /** @type {any} */ (op.key), op.value)
        } else if (delta.$deleteAttrOp.check(op)) {
          typeMapDelete(transaction, /** @type {any} */ (this), /** @type {any} */ (op.key))
        } else {
          // `modifyAttr` 必须按 Renderer 定位，因为已删除 map 值仍可能是可编辑的软删除节点。
          const mapItem = this._map.get(/** @type {any} */ (op.key))
          const sub = mapItem === undefined
            ? undefined
            : (mapItem.deleted
                ? (mapItem.content.constructor === ContentType && rendererContentLength(renderer, mapItem) > 0
                    ? /** @type {ContentType} */ (mapItem.content).type
                    : undefined)
                : mapItem.content.getContent()[mapItem.length - 1])
          if (!(sub instanceof YType)) {
            error.unexpectedCase()
          }
          const subFix = sub.applyDelta(op.value, origin, { renderer })
          if (subFix !== null) {
            const f = fix ?? (fix = /** @type {any} */ (delta.create()))
            f.modifyAttr(/** @type {any} */ (op.key), /** @type {any} */ (subFix))
          }
        }
      }
      return fix !== null && !(/** @type {delta.DeltaBuilder<any>} */ (fix).done(false).isEmpty()) ? fix : null
    }, origin)
  }

  /**
   * 复制当前 Renderer 的完整深层 Delta 到一个未集成类型；副本挂入 YDoc 后才可稳定读取内容。
   * 渲染出的子 Delta 在新类型中重新集成，因而复制的是可见内容树，不沿用原 Item 身份或删除历史。
   *
   * @return {YType<DConf>}
   */
  clone () {
    const cpy = this._copy()
    cpy.applyDelta(this.toDeltaDeep())
    return cpy
  }

  /**
   * 枚举当前 `_map` 的未删除属性，构造同一 Delta 删除它们，并以一次事务应用；列表内容不受影响。
   * 未集成类型的 preliminary 属性尚未进入 `_map`，因此此方法不会清除预存属性。
   */
  clearAttrs () {
    const d = delta.create()
    this.forEachAttr((_, key) => {
      d.deleteAttr(/** @type {any} */ (key))
    })
    this.applyDelta(d)
  }

  /**
   * 删除指定属性键；底层生成单个 `deleteAttr` Delta。
   *
   * @param {string} attributeName - 要删除的属性名。
   *
   * @public
   */
  deleteAttr (attributeName) {
    this.applyDelta(delta.create().deleteAttr(attributeName).done())
  }

  /**
   * 设置或覆盖一个属性，并返回传入值，便于链外直接取得新嵌套类型。
   *
   * @template {Exclude<keyof delta.DeltaConfGetAttrs<DConf>,symbol>} KEY
   * @template {delta.DeltaConfGetAttrs<DConf>[KEY]} VAL
   *
   * @param {KEY} attributeName - 属性名。
   * @param {VAL} attributeValue - 新属性值。
   * @return {VAL}
   *
   * @public
   */
  setAttr (attributeName, attributeValue) {
    this.applyDelta(delta.create().setAttr(attributeName, attributeValue).done())
    return attributeValue
  }

  /**
   * 返回当前获胜且未删除的属性值；不存在时为 `undefined`。
   *
   * @template {Exclude<keyof delta.DeltaConfGetAttrs<DConf>,symbol|number>} KEY
   * @param {KEY} attributeName - 要查询的属性名。
   * @return {delta.DeltaConfGetAttrs<DConf>[KEY]|undefined} 当前属性值。
   * @public
   */
  getAttr (attributeName) {
    return /** @type {any} */ (typeMapGet(this, attributeName))
  }

  /**
   * 判断指定属性是否存在且当前 Item 未删除。
   *
   * @param {string} attributeName - 要检查的属性名。
   * @return {boolean} 属性是否存在。
   *
   * @public
   */
  hasAttr (attributeName) {
    return /** @type {any} */ (typeMapHas(this, attributeName))
  }

  /**
   * 返回当前全部属性键值；传入 Snapshot 时按其状态向量和删除集回溯历史获胜值。
   *
   * @param {Snapshot} [snapshot] - 可选历史状态；旧值须仍由文档结构保留，GC 不会在这里恢复丢失内容。
   * @return {{ [Key in Extract<keyof delta.DeltaConfGetAttrs<DConf>,string>]?: delta.DeltaConfGetAttrs<DConf>[Key]}} 属性对象。
   *
   * @public
   */
  getAttrs (snapshot) {
    return /** @type {any} */ (snapshot ? typeMapGetAllSnapshot(this, snapshot) : typeMapGetAll(this))
  }

  /**
   * 在 Renderer 视图的索引处批量插入内容；连续普通数组值可共享一个 ContentAny 和一次事务。
   *
   * 字符串按文本插入；非文本内容必须传数组，而不是单个对象。
   *
   * @example
   *  // 在位置 0 插入字符 a
   *  yarray.insert(0, ['a'])
   *  // 在位置 1 批量插入数字 1、2
   *  yarray.insert(1, [1, 2])
   *
   * @param {number} index - 插入位置。
   * @param {Array<delta.DeltaConfGetChildren<DConf>>|delta.DeltaConfGetText<DConf>} content - 文本或待插入内容数组。
   * @param {delta.Formats} [format] - 新内容的完整格式；省略时不继承左侧格式。
   */
  insert (index, content, format) {
    this.applyDelta(delta.create().retain(index).insert(/** @type {any} */ (content), format).done())
  }

  /**
   * 给指定可见范围设置格式；`null` 值用于移除格式，内容本身保持不变。
   *
   * @param {number} index - 范围起点。
   * @param {number} length - 范围可见长度。
   * @param {delta.Formats} formats - 要设置或清除的格式键。
   *
   */
  format (index, length, formats) {
    this.applyDelta(delta.create().retain(index).retain(length, formats))
  }

  /**
   * 以存活内容长度为索引调用 `insert(length, content)`。
   * 默认视图中这就是末尾；Renderer 若显示墓碑，该索引不包含墓碑长度。
   *
   * @param {Array<delta.DeltaConfGetChildren<DConf>>|delta.DeltaConfGetText<DConf>} content - 追加内容。
   *
   */
  push (content) {
    this.insert(this.length, content)
  }

  /**
   * 把内容插入到当前起点，转发给 `insert(0, content)`。
   *
   * @param {Array<delta.DeltaConfGetChildren<DConf>>|delta.DeltaConfGetText<DConf>} content - 前置内容。
   */
  unshift (content) {
    this.insert(0, content)
  }

  /**
   * 通过 Delta retain 定位起点后删除指定长度，默认一个元素；长度处理见 {@link deleteText}。
   *
   * @param {number} index - 删除起点。
   * @param {number} length - 删除长度，默认 1。
   */
  delete (index, length = 1) {
    this.applyDelta(delta.create().retain(index).delete(length))
  }

  /**
   * 返回第 `index` 个活跃可计数子元素，定位时可复用搜索标记。
   *
   * @param {number} index - 零基逻辑索引。
   * @return {delta.DeltaConfGetChildren<DConf>} 存活内容值；超出链尾时实际返回 `undefined`，不使用 Renderer 可见坐标。
   */
  get (index) {
    return typeListGet(this, index)
  }

  /**
   * 把半开区间 `[start, end)` 的活跃列表内容复制为 JavaScript 数组；负索引相对末尾计算。
   *
   * @param {number} [start] - 存活内容起点，默认 0。
   * @param {number} [end] - 存活内容终点（不包含），默认原始列表长度，不含 Renderer 恢复的墓碑。
   * @return {Array<delta.DeltaConfGetChildren<DConf>>}
   */
  slice (start = 0, end = this.length) {
    return typeListSlice(this, start, end)
  }

  /**
   * 把当前 Renderer 输出的数组 insert 展平、文本 insert 按整段字符串保存，忽略格式和属性操作。
   * 因而文本的一个数组元素可含多个 UTF-16 单元，Renderer 显示的墓碑也可出现在结果中。
   *
   * @todo 重构为只依赖 Content 接口。
   *
   * @return {Array<delta.DeltaConfGetChildren<DConf> | delta.DeltaConfGetText<DConf>>}
   */
  toArray () {
    const dcontent = this.toDelta()
    /**
     * @type {Array<any>}
     */
    const children = []
    for (const child of dcontent.children) {
      if (delta.$insertOp.check(child)) {
        for (let i = 0; i < child.insert.length; i++) {
          children.push(child.insert[i])
        }
      } else if (delta.$textOp.check(child)) {
        children.push(child.insert)
      }
    }
    return children
  }

  /**
   * 递归把名称、属性和子内容转换为普通 JSON：属性读取当前存活值，子内容来自当前 Renderer 的 `toArray()`。
   * 是否包含 `children` 仍由存活 `length > 0` 决定，`attrs` 由存活属性数决定，名称非 null 时保留。
   * @return {{ name?: string, attrs?: { [K:string|number]: any }, children?: Array<any>  }}
   */
  toJSON () {
    /**
     * @type {{[K:string]:any}}
     */
    const attrs = this.getAttrs()
    for (const k in attrs) {
      const attr = attrs[k]
      attrs[k] = attr instanceof YType ? attr.toJSON() : attr
    }
    const children = this.toArray().map(child => child instanceof YType ? /** @type {any} */ (child.toJSON()) : child)
    /**
     * @type {any}
     */
    const res = {}
    if (this.name != null) {
      res.name = this.name
    }
    if (this.length > 0) {
      res.children = children
    }
    if (this.attrSize > 0) {
      res.attrs = attrs
    }
    return res
  }

  /**
   * 把共享树渲染为确定性的类 XML 字符串；属性按键排序，匿名无属性节点默认只返回子内容。
   * 属性来自存活 map，子内容来自当前 Renderer；空标签判断仍使用原始 length，文本不做 XML 转义。
   *
   * @param {object} [opts]
   * @param {boolean} [opts.forceTag] - 即使名称为空也强制生成包围标签。
   * @return {string} 供展示/比较的类 XML 表示，非通用 XML 序列化器。
   */
  toString ({ forceTag = false } = {}) {
    /**
     * @type {Array<[string|number,string]>}
     */
    const attrs = []
    this.forEachAttr((attr, key) => {
      attrs.push([(key), /** @type {any} */ (attr) instanceof YType ? attr.toString({ forceTag: true }) : JSON.stringify(attr)])
    })
    const attrsString = (attrs.length > 0 ? ' ' : '') + attrs.sort((a, b) => a[0].toString() < b[0].toString() ? -1 : 1).map(attr => attr[0] + '=' + attr[1]).join(' ')
    /**
     * @type {string}
     */
    const children = this.toArray().map(c => s.$string.check(c) ? c : (c instanceof YType ? c.toString({ forceTag: true }) : JSON.stringify(c))).join('')
    if (this.name == null && !forceTag && attrs.length === 0) {
      return children
    }
    if (this.length === 0) {
      return `<${this.name ?? ''}${attrsString} />`
    }
    return `<${this.name ?? ''}${attrsString}>${children}</${this.name ?? ''}>`
  }

  /**
   * 对 `toArray()` 快照中的每个子元素调用映射函数并返回结果数组。
   *
   * @template M
   * @param {(child:delta.DeltaConfGetChildren<DConf>|delta.DeltaConfGetText<DConf>,index:number)=>M} f - 映射函数。
   * @return {Array<M>} 映射结果。
   */
  map (f) {
    return this.toArray().map(f)
  }

  /**
   * 对 `toArray()` 快照中的每个子元素执行回调。
   *
   * @param {(child:delta.DeltaConfGetChildren<DConf>|delta.DeltaConfGetText<DConf>,index:number)=>any} f - 迭代回调。
   */
  forEach (f) {
    return this.toArray().forEach(f)
  }

  /**
   * 对每个当前未删除的属性键值执行一次回调；值取获胜 Item 的最后一个 Content 元素。
   *
   * @param {(val:delta.DeltaConfGetAttrs<DConf>[any],key:Exclude<keyof delta.DeltaConfGetAttrs<DConf>,symbol>,ytype:this)=>any} f
   */
  forEachAttr (f) {
    this._map.forEach((item, key) => {
      if (!item.deleted) {
        f(item.content.getContent()[item.length - 1], /** @type {any} */ (key), this)
      }
    })
  }

  /**
   * 返回当前未删除属性键的惰性迭代器。
   *
   * @return {IterableIterator<import('lib0/ts').KeyOf<delta.DeltaConfGetAttrs<DConf>>>}
   */
  attrKeys () {
    return iterator.iteratorMap(createMapIterator(this), /** @param {any} v */ v => v[0])
  }

  /**
   * 返回当前未删除属性值的惰性迭代器。
   *
   * @return {IterableIterator<delta.DeltaConfGetAttrs<DConf>[any]>}
   */
  attrValues () {
    return iterator.iteratorMap(createMapIterator(this), /** @param {any} v */ v => v[1].content.getContent()[v[1].length - 1])
  }

  /**
   * 返回当前未删除属性 `[key, value]` 对的惰性迭代器。
   *
   * @return {IterableIterator<{ [K in keyof delta.DeltaConfGetAttrs<DConf>]: [K,delta.DeltaConfGetAttrs<DConf>[K]] }[any]>}
   */
  attrEntries () {
    return iterator.iteratorMap(createMapIterator(this), /** @param {any} v */ v => /** @type {any} */ ([v[0], v[1].content.getContent()[v[1].length - 1]]))
  }

  /**
   * 返回当前未删除属性数；通过消费迭代器计算，不包含 tombstone。
   *
   * @return {number}
   */
  get attrSize () {
    return [...createMapIterator(this)].length
  }

  /**
   * 通过完整 Delta 等价性判断两个共享类型的可观察内容是否相同。
   *
   * @param {this} other
   */
  [traits.EqualityTraitSymbol] (other) {
    return this.toDelta().equals(other.toDelta())
  }

  /**
   * 把旧式类型引用及需要的节点名写入更新编码器，供宿主 Item 同步到远端。
   *
   * @todo 该逻辑无需保留为实例方法。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder - 目标更新编码器。
   */
  _write (encoder) {
    encoder.writeTypeRef(this._legacyTypeRef)
    switch (this._legacyTypeRef) {
      case YXmlElementRefID:
      case YXmlHookRefID: {
        encoder.writeKey(this.name)
        break
      }
    }
  }
}

/**
 * 为给定可读 Delta 配置创建 `YType` 实例 schema；配置参数只参与静态类型推导。
 *
 * @template {import('lib0/delta').ReadableDeltaConf} DConf
 * @param {DConf} _dconf
 * @return {s.Schema<YType<import('lib0/delta').ReadDeltaConf<DConf>>>}
 */
export const $ytype = _dconf => s.$instanceOf(YType)
/** 接受任意 Delta 配置 `YType` 实例的运行时 schema。 */
export const $ytypeAny = s.$instanceOf(YType)

/**
 * 从一组变化 Item 向上汇总所有受影响 `YType` 及属性键；列表变化以 `null` 键表示。
 *
 * 一旦某祖先同一键已标记即可停止该父链，避免重复遍历；结果供深层 Delta 只递归变化分支。
 *
 * @param {StructStore} store - 查找变化 ID 所在结构的文档存储。
 * @param {IdSet} items - 待汇总的 ID 区间；遍历不切分 Item，GC/Skip 不提供父链。
 * @return {Map<YType,Set<string|null>>} 新建的受影响类型映射，属性用键名、列表用 `null`。
 */
export const computeModifiedFromItems = (store, items) => {
  /**
   * @type {Map<YType,Set<null|string>>}
   */
  const modified = new Map()
  iterateStructsByIdSetWithoutSplits(store, items, /** @param {Item | GC | Skip | null} item */ item => {
    while (item instanceof Item) {
      const parent = /** @type {YType} */ (item.parent)
      const conf = map.setIfUndefined(modified, parent, set.create)
      if (conf.has(item.parentSub)) break // 同一父键已覆盖这条祖先链，无需重复上溯。
      conf.add(item.parentSub)
      item = parent._item
    }
  })
  return modified
}

/**
 * 处理 Renderer 的 attribution change 通知（如接受/拒绝建议），无须新建 Y 事务。
 *
 * 重新渲染受影响 id，增量修补 {@link YType#delta} 并发 `'delta'`，与事务内
 * `cleanupTransactions` 的维护语义一致。尚未集成到文档的 id 此刻渲染为空，稍后的真实事务会经常规
 * 路径补上。该函数由 {@link YType#useRenderer} 绑定到 Renderer `'change'`。
 *
 * @param {YType<any>} type - 已绑定 Renderer 的缓存/事件目标。
 * @param {IdSet} changes - attribution 改变的 ID 集合，按 retain 修正现有内容。
 * @param {any} origin - 原样转发给 delta listener 的来源。
 *
 * @private
 * @function
 */
export const typeApplyRendererChange = (type, changes, origin) => {
  const hasDeltaListeners = (type._observers.get('delta')?.size ?? 0) > 0
  // 不做删除类型短路：自定义 Renderer 可能继续显示 tombstone，其缓存和 `'delta'` 仍须响应归因修正。
  if ((type._delta === null && !hasDeltaListeners) || type.doc == null) return
  const change = type.toDelta({ renderer: type._renderer, deep: true, itemsToRender: changes, retainInserts: true, retainDeletes: true })
  if (!change.isEmpty()) {
    type._delta?.apply(change)
    if (hasDeltaListeners) type.emit('delta', [change, origin])
  }
}

/**
 * 比较两个格式值；先检查严格相等，再对两个非 null 对象进行浅层键值比较。
 *
 * @param {any} a
 * @param {any} b
 * @return {boolean}
 */
export const equalFormats = (a, b) => a === b || (typeof a === 'object' && typeof b === 'object' && a && b && object.equalFlat(a, b))

/**
 * 把 Delta 配置中的嵌套 Delta 数据映射为共享类型侧值域，名称、文本等其余配置由 DeltaConfOverwrite 保留。
 * `attrs` 逐属性键应用 DeltaToYType；`children` 对子值类型应用同一映射，而非对文本 UTF-16 单元转换。
 *
 * @template {delta.DeltaConf} DConf
 * @typedef {delta.DeltaConfOverwrite<DConf, {
 *     attrs: { [K in keyof delta.DeltaConfGetAttrs<DConf>]: DeltaToYType<delta.DeltaConfGetAttrs<DConf>[K]> },
 *     children: DeltaToYType<delta.DeltaConfGetChildren<DConf>>
 *   }>
 * } DeltaConfDeltaToYType
 */

/**
 * 把单个 Delta 数据值映射到共享类型侧：普通数据原样保留，可识别 Delta 转为对应 `YType`。
 *
 * @template {any} Data
 * @typedef {Exclude<Data,delta.DeltaAny> | (Extract<Data,delta.DeltaAny> extends delta.Delta<infer DConf> ? (unknown extends DConf ? YType<DConf> : never) : never)} DeltaToYType
 */

/**
 * 返回共享列表半开区间的活跃 Content；负边界先加 `_length`。
 * 此实现不把仍为负的边界裁剪到 0；调用方应传列表范围内的边界，不能照搬所有 Array.slice 越界语义。
 *
 * @param {YType<any>} type
 * @param {number} start
 * @param {number} end
 * @return {Array<any>}
 *
 * @private
 * @function
 */
export const typeListSlice = (type, start, end) => {
  type.doc ?? warnPrematureAccess()
  if (start < 0) {
    start = type._length + start
  }
  if (end < 0) {
    end = type._length + end
  }
  let len = end - start
  const cs = []
  let n = type._start
  while (n !== null && len > 0) {
    if (n.countable && !n.deleted) {
      const c = n.content.getContent()
      if (c.length <= start) {
        start -= c.length
      } else {
        for (let i = start; i < c.length && len > 0; i++) {
          cs.push(c[i])
          len--
        }
        start = 0
      }
    }
    n = n.right
  }
  return cs
}

/**
 * 借助最近搜索标记定位并返回共享列表第 `index` 个活跃 Content 值。
 *
 * @param {YType} type
 * @param {number} index
 * @return {any}
 *
 * @private
 * @function
 */
export const typeListGet = (type, index) => {
  type.doc ?? warnPrematureAccess()
  const marker = findMarker(type, index)
  let n = type._start
  if (marker !== null) {
    n = marker.p
    index -= marker.index
  }
  for (; n !== null; n = n.right) {
    if (!n.deleted && n.countable) {
      if (index < n.length) {
        return n.content.getContent()[index]
      }
      index -= n.length
    }
  }
}

/**
 * 在指定结构 Item 之后批量集成普通值、二进制、子文档和嵌套共享类型。
 *
 * 连续普通值合并为一个 `ContentAny`；特殊内容必须先 flush，避免把独立生命周期塞入同一 Content。
 * @todo 与统一 insert 实现重复，应迁移后删除。
 *
 * @param {Transaction} transaction
 * @param {YType} parent
 * @param {Item?} referenceItem
 * @param {Array<YValue>} content
 *
 * @private
 * @function
 */
export const typeListInsertGenericsAfter = (transaction, parent, referenceItem, content) => {
  let left = referenceItem
  const doc = transaction.doc
  const ownClientId = doc.clientID
  const store = doc.store
  const right = referenceItem === null ? parent._start : referenceItem.right
  /**
   * @type {Array<Object|Array<any>|number|null>}
   */
  let jsonContent = []
  /** 把已积累普通值写成一个 `ContentAny`，并把 `left` 推进到新 Item。 */
  const packJsonContent = () => {
    if (jsonContent.length > 0) {
      left = new Item(createID(ownClientId, store.getClock(ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentAny(jsonContent))
      left.integrate(transaction, 0)
      jsonContent = []
    }
  }
  content.forEach(c => {
    if (c === null) {
      jsonContent.push(c)
    } else {
      switch (c.constructor) {
        case Number:
        case Object:
        case undefined:
        case Boolean:
        case Array:
        case String:
        case BigInt:
        case Date:
          jsonContent.push(c)
          break
        default:
          packJsonContent()
          switch (c.constructor) {
            case Uint8Array:
            case ArrayBuffer:
              left = new Item(createID(ownClientId, store.getClock(ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentBinary(new Uint8Array(/** @type {Uint8Array} */ (c))))
              left.integrate(transaction, 0)
              break
            default:
              if ($ydoc.check(c)) {
                left = new Item(createID(ownClientId, store.getClock(ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, createContentDocFromDoc(/** @type {Doc} */ (c)))
                left.integrate(transaction, 0)
              } else if (c instanceof YType) {
                left = new Item(createID(ownClientId, store.getClock(ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentType(/** @type {any} */ (c)))
                left.integrate(transaction, 0)
              } else {
                throw new Error('Unexpected content type in insert operation')
              }
          }
      }
    }
  })
  packJsonContent()
}

/** 创建列表操作越过可见边界时使用的统一错误。 */
const lengthExceeded = () => error.create('Length exceeded!')

/**
 * 在逻辑索引处插入混合内容；先用搜索标记定位，必要时切分 Item，再更新所有缓存索引。
 *
 * @param {Transaction} transaction
 * @param {YType} parent
 * @param {number} index
 * @param {Array<Object<string,any>|Array<any>|number|null|string|Uint8Array>} content
 *
 * @private
 * @function
 */
export const typeListInsertGenerics = (transaction, parent, index, content) => {
  if (index > parent._length) {
    throw lengthExceeded()
  }
  if (index === 0) {
    if (parent._searchMarker) {
      updateMarkerChanges(parent._searchMarker, index, content.length)
    }
    return typeListInsertGenericsAfter(transaction, parent, null, content)
  }
  const startIndex = index
  const marker = findMarker(parent, index)
  let n = parent._start
  if (marker !== null) {
    n = marker.p
    index -= marker.index
    // 索引正好落在标记起点时退到左侧活 Item，统一复用“在 n 之后插入”的算法。
    if (index === 0) {
      // @todo 此处没有考虑格式，应与文本定位逻辑统一重构。
      n = n.prev // 取左侧第一个未删除 Item，才能把索引改写为“在此 Item 之后插入”。
      index += (n && n.countable && !n.deleted) ? n.length : 0
    }
  }
  for (; n !== null; n = n.right) {
    if (!n.deleted && n.countable) {
      if (index <= n.length) {
        if (index < n.length) {
          // 落在 Item 内部时先切出结构边界。
          getItemCleanStart(transaction, createID(n.id.client, n.id.clock + index))
        }
        break
      }
      index -= n.length
    }
  }
  if (parent._searchMarker) {
    updateMarkerChanges(parent._searchMarker, startIndex, content.length)
  }
  return typeListInsertGenericsAfter(transaction, parent, n, content)
}

/**
 * 从索引最大的搜索标记向右找到结构末尾并追加内容；追加不会平移既有位置，因此无需更新标记。
 *
 * @param {Transaction} transaction
 * @param {YType} parent
 * @param {Array<Object<string,any>|Array<any>|number|null|string|Uint8Array>} content
 *
 * @private
 * @function
 */
export const typeListPushGenerics = (transaction, parent, content) => {
  // 从最靠右缓存点出发，避免每次追加都从 `_start` 扫描。
  const marker = (parent._searchMarker || []).reduce((maxMarker, currMarker) => currMarker.index > maxMarker.index ? currMarker : maxMarker, { index: 0, p: parent._start })
  let n = marker.p
  if (n) {
    while (n.right) {
      n = n.right
    }
  }
  return typeListInsertGenericsAfter(transaction, parent, n, content)
}

/**
 * 旧式列表删除：先按活跃可计数内容定位起点，再逐个未删除 Item 消费其结构长度并 tombstone。
 * 删除循环没有排除格式 Item，因此不能把它当作富文本 Renderer 删除接口；当前公共 delete 走 `deleteText`。
 * 若扫描到末尾仍有剩余长度，已删除的前段保留，随后抛错；搜索标记更新也尚未执行。
 *
 * @param {Transaction} transaction
 * @param {YType} parent
 * @param {number} index
 * @param {number} length
 *
 * @private
 * @function
 */
export const typeListDelete = (transaction, parent, index, length) => {
  if (length === 0) { return }
  const startIndex = index
  const startLength = length
  const marker = findMarker(parent, index)
  let n = parent._start
  if (marker !== null) {
    n = marker.p
    index -= marker.index
  }
  // 找到首个待删除 Item；若起点落在 Item 内，先切出干净边界。
  for (; n !== null && index > 0; n = n.right) {
    if (!n.deleted && n.countable) {
      if (index < n.length) {
        getItemCleanStart(transaction, createID(n.id.client, n.id.clock + index))
      }
      index -= n.length
    }
  }
  // 逐 Item 删除到额度耗尽，末端同样先切分以免多删。
  while (length > 0 && n !== null) {
    if (!n.deleted) {
      if (length < n.length) {
        getItemCleanStart(transaction, createID(n.id.client, n.id.clock + length))
      }
      n.delete(transaction)
      length -= n.length
    }
    n = n.right
  }
  if (length > 0) {
    throw lengthExceeded()
  }
  if (parent._searchMarker) {
    updateMarkerChanges(parent._searchMarker, startIndex, -startLength + length /* 仅当上方越界检查通过时更新；保留剩余额度项以支持将来放宽检查。 */)
  }
}

/**
 * 删除 map 当前键对应的获胜 Item；不存在时保持幂等。
 *
 * @todo 内联该薄包装。
 *
 * @param {Transaction} transaction
 * @param {YType} parent
 * @param {string} key
 *
 * @private
 * @function
 */
export const typeMapDelete = (transaction, parent, key) => {
  const c = parent._map.get(key)
  if (c !== undefined) {
    c.delete(transaction)
  }
}

/**
 * 把属性值封装成对应 Content 并创建同键新 Item；CRDT 集成负责解决并发获胜者。
 *
 * 普通值用 `ContentAny`，二进制、子文档和嵌套类型各用专用 Content；未知构造器直接报错。
 *
 * @param {Transaction} transaction
 * @param {YType} parent
 * @param {string} key
 * @param {YValue} value
 *
 * @private
 * @function
 */
export const typeMapSet = (transaction, parent, key, value) => {
  const left = parent._map.get(key) || null
  const doc = transaction.doc
  const ownClientId = doc.clientID
  let content
  if (value == null) {
    content = new ContentAny([value])
  } else {
    switch (value.constructor) {
      case Number:
      case Object:
      case Boolean:
      case Array:
      case String:
      case Date:
      case BigInt:
        content = new ContentAny([value])
        break
      case Uint8Array:
        content = new ContentBinary(/** @type {Uint8Array} */ (value))
        break
      default:
        if ($ydoc.check(value)) {
          content = createContentDocFromDoc(/** @type {Doc} */ (value))
        } else if (value instanceof YType) {
          content = new ContentType(/** @type {any} */ (value))
        } else {
          throw new Error('Unexpected content type')
        }
    }
  }
  new Item(createID(ownClientId, doc.store.getClock(ownClientId)), left, left && left.lastId, null, null, parent, key, content).integrate(transaction, 0)
}

/**
 * 返回 map 当前未删除获胜值；未集成访问先警告。
 *
 * @param {YType<any>} parent
 * @param {string} key
 * @return {Object<string,any>|number|null|Array<any>|string|Uint8Array|YType<any>|undefined}
 *
 * @private
 * @function
 */
export const typeMapGet = (parent, key) => {
  parent.doc ?? warnPrematureAccess()
  const val = parent._map.get(key)
  return val !== undefined && !val.deleted ? val.content.getContent()[val.length - 1] : undefined
}

/**
 * 枚举 map 当前全部未删除获胜值，生成新的普通对象。
 *
 * @param {YType<any>} parent
 * @return {Object<string,Object<string,any>|number|null|Array<any>|string|Uint8Array|YType<any>|undefined>}
 *
 * @private
 * @function
 */
export const typeMapGetAll = (parent) => {
  /**
   * @type {Object<string,any>}
   */
  const res = {}
  parent.doc ?? warnPrematureAccess()
  parent._map.forEach((value, key) => {
    if (!value.deleted) {
      res[key] = value.content.getContent()[value.length - 1]
    }
  })
  return res
}

/**
 * 把 map 属性渲染进 Delta；Renderer 可将软删除属性作为携带 delete attribution 的正向 setAttr 输出。
 *
 * 完整状态遍历全部属性；变化模式只处理 `attrsToRender`。嵌套类型在 `deep` 模式下根据是否修改选择
 * `modifyAttr` 或完整 `setAttr`。
 * @todo 迁移到 Content/Delta 抽象。
 *
 * @template {delta.DeltaBuilderAny} TypeDelta
 * @param {TypeDelta} d
 * @param {YType} parent
 * @param {Set<string|null>?} attrsToRender - `null` 枚举全部属性；集合中的 `null` 列表标记跳过，字符串键须存在于 `_map`。
 * @param {AbstractRenderer?} renderer - 接管属性可见性与归因的 Renderer；`null` 读取普通获胜 Item。
 * @param {boolean} deep - 是否把嵌套 YType 递归转为 Delta。
 * @param {Set<YType>|Map<YType,any>|null} [modified] - 应按已修改子节点渲染的类型集合/映射。
 * @param {IdSet?} [itemsToRender] - 当前变化的 ID 集合；用于判断删除属性需重发旧值还是输出删除。
 * @param {any} [opts] - 子类型 modifyAttr 使用的变化渲染选项。
 * @param {any} [optsAll] - 新属性值递归渲染选项；软删除值需要完整状态时会单独忽略范围限制。
 *
 * @private
 * @function
 */
export const typeMapGetDelta = (d, parent, attrsToRender, renderer, deep, modified, itemsToRender, opts, optsAll) => {
  /**
   * 渲染一个属性 Item；Renderer 可能改变其可见性、删除态、内容切片和 attribution。
   * 属性读法取最后一个输出片段的末尾值，与普通 map 取获胜 Item 最后内容元素一致；零片段则隐藏属性。
   *
   * @param {Item} item
   * @param {string} key
   */
  const renderAttrs = (item, key) => {
    /**
     * @type {{ deleted: boolean, attrs: Array<ContentAttribute<any>>?, content: AbstractContent }}
     */
    let piece
    if (renderer === null || !renderer.hasItem(item)) {
      // Renderer 未接管时直接读取 Item 字段，避免包装与归因查询。
      piece = { deleted: item.deleted, attrs: null, content: item.content }
    } else {
      /**
       * @type {Array<AttributedContent<any>>}
       */
      const cs = []
      renderer.readContent(cs, item.id.client, item.id.clock, item.deleted, item.content, 1)
      if (cs.length === 0) return // Renderer 隐藏该属性，例如 diff 视图中的无变化 tombstone。
      piece = cs[cs.length - 1]
    }
    const { deleted, attrs, content } = piece
    const attribution = createAttributionFromAttributionItems(attrs, deleted)
    let c = array.last(content.getContent())
    if (deleted) {
      if (attribution != null) {
        // 软删除属性仍在建议/diff 视图可见，必须用带 attribution 的正向 `SetAttrOp`，与子内容使用
        // `InsertOp` 对称。若变化发生在这个仍显示的嵌套值内部，也要重发完整属性：删除值没有
        // `modifyAttr` 路径，而 `setAttr` 替换完整状态是幂等的。
        if (itemsToRender == null || itemsToRender.hasId(item.lastId) || (c instanceof YType && modified != null && modified.has(c))) {
          if (deep && c instanceof YType) {
            // 正向 `setAttr` 会替换消费方属性，嵌套类型必须完整渲染；变化范围选项只会产生无意义 retain。
            c = /** @type {any} */(c).toDelta({ renderer, deep: true })
          }
          d.setAttr(key, c, attribution)
        }
      } else if (itemsToRender != null && itemsToRender.hasId(item.lastId)) {
        // 变化渲染中的硬删除属性输出 `deleteAttr`，供事件、RDT 绑定和活缓存应用；完整状态模式只需省略。
        d.deleteAttr(key, attribution)
      }
    } else if (deep && c instanceof YType && modified?.has(c)) {
      d.modifyAttr(key, c.toDelta(opts))
    } else {
      if (deep && c instanceof YType) {
        c = /** @type {any} */(c).toDelta(optsAll)
      }
      d.setAttr(key, c, attribution)
    }
  }
  if (attrsToRender == null) {
    parent._map.forEach(renderAttrs)
  } else {
    attrsToRender.forEach(key => key != null && renderAttrs(/** @type {Item} */ (parent._map.get(key)), key))
  }
}

/**
 * 判断 map 当前是否存在未删除属性键。
 *
 * @param {YType<any>} parent
 * @param {string} key
 * @return {boolean}
 *
 * @private
 * @function
 */
export const typeMapHas = (parent, key) => {
  parent.doc ?? warnPrematureAccess()
  const val = parent._map.get(key)
  return val !== undefined && !val.deleted
}

/**
 * 判断 Item 在当前状态或指定 Snapshot 中是否可见。
 *
 * Snapshot 可见要求：状态向量已包含该时钟，且删除集未覆盖该 id。
 *
 * @param {Item} item
 * @param {Snapshot|undefined} snapshot - `undefined` 仅检查当前删除位；快照检查 Item 起始 ID 的历史可见性。
 * @return {boolean} 起始 ID 在所选状态中是否可见；调用方负责按快照边界切分内容。
 *
 * @protected
 * @function
 */
export const isVisible = (item, snapshot) => snapshot === undefined
  ? !item.deleted
  : snapshot.sv.has(item.id.client) && (snapshot.sv.get(item.id.client) || 0) > item.id.clock && !snapshot.ds.hasId(item.id)

/**
 * 沿同键冲突链回溯 Snapshot 已知的最新 Item，并返回当时可见值。
 *
 * @param {YType<any>} parent
 * @param {string} key
 * @param {Snapshot} snapshot
 * @return {Object<string,any>|number|null|Array<any>|string|Uint8Array|YType<any>|undefined}
 *
 * @private
 * @function
 */
export const typeMapGetSnapshot = (parent, key, snapshot) => {
  let v = parent._map.get(key) || null
  while (v !== null && (!snapshot.sv.has(v.id.client) || v.id.clock >= (snapshot.sv.get(v.id.client) || 0))) {
    v = v.left
  }
  return v !== null && isVisible(v, snapshot) ? v.content.getContent()[v.length - 1] : undefined
}

/**
 * 为全部属性键回溯 Snapshot 已知的最新 Item，收集当时可见值。
 *
 * @param {YType<any>} parent
 * @param {Snapshot} snapshot
 * @return {Object<string,Object<string,any>|number|null|Array<any>|string|Uint8Array|YType<any>|undefined>}
 *
 * @private
 * @function
 */
export const typeMapGetAllSnapshot = (parent, snapshot) => {
  /**
   * @type {Object<string,any>}
   */
  const res = {}
  parent._map.forEach((value, key) => {
    /**
     * @type {Item|null}
     */
    let v = value
    while (v !== null && (!snapshot.sv.has(v.id.client) || v.id.clock >= (snapshot.sv.get(v.id.client) || 0))) {
      v = v.left
    }
    if (v !== null && isVisible(v, snapshot)) {
      res[key] = v.content.getContent()[v.length - 1]
    }
  })
  return res
}

/**
 * 创建只遍历 map 当前未删除获胜 Item 的惰性迭代器；未集成访问先警告。
 *
 * @param {YType<any> & { _map: Map<string, Item> }} type
 * @return {IterableIterator<Array<any>>}
 *
 * @private
 * @function
 */
export const createMapIterator = type => {
  type.doc ?? warnPrematureAccess()
  return iterator.iteratorFilter(type._map.entries(), /** @param {any} entry */ entry => !entry[1].deleted)
}

/**
 * 从更新流读取嵌套共享类型内容。
 *
 * @private
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @return {ContentType}
 */
export const readContentType = decoder => new ContentType(readYType(decoder))

/**
 * 从更新流读取 UTF-8 字符串内容。
 *
 * @private
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @return {ContentString}
 */
export const readContentString = decoder => new ContentString(decoder.readString())

/**
 * 从更新流读取旧式逐字符串 JSON 内容；字面量 `undefined` 单独恢复，其余交给 `JSON.parse`。
 *
 * @private
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @return {ContentJSON}
 */
export const readContentJSON = decoder => {
  const len = decoder.readLen()
  const cs = []
  for (let i = 0; i < len; i++) {
    const c = decoder.readString()
    if (c === 'undefined') {
      cs.push(undefined)
    } else {
      cs.push(JSON.parse(c))
    }
  }
  return new ContentJSON(cs)
}

/**
 * 从更新流读取格式键和值，构造格式标记内容。
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @return {ContentFormat}
 */
export const readContentFormat = decoder => new ContentFormat(decoder.readKey(), decoder.readJSON())

/**
 * 从更新流读取 JSON embed 内容。
 *
 * @private
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @return {ContentEmbed}
 */
export const readContentEmbed = decoder => new ContentEmbed(decoder.readJSON())

/**
 * 从更新流读取子文档 guid 与选项。
 *
 * @private
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @return {ContentDoc}
 */
export const readContentDoc = decoder => new ContentDoc(decoder.readString(), decoder.readAny())

/**
 * 从更新流读取 lib0 any 编码数组。
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @return {ContentAny}
 */
export const readContentAny = decoder => {
  const len = decoder.readLen()
  const cs = []
  for (let i = 0; i < len; i++) {
    cs.push(decoder.readAny())
  }
  return new ContentAny(cs)
}

/**
 * 从更新流读取二进制缓冲区内容。
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2 } decoder
 * @return {ContentBinary}
 */
export const readContentBinary = decoder => new ContentBinary(decoder.readBuf())

/**
 * 从更新流读取仅保留长度的已删除内容。
 *
 * @private
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2 } decoder
 * @return {ContentDeleted}
 */
export const readContentDeleted = decoder => new ContentDeleted(decoder.readLen())

/**
 * Item ContentRef 到解码函数的协议查找表；索引必须与二进制格式固定编号一致。
 *
 * `GC` 与 `Skip` 不是合法 ItemContent，命中其保留编号立即抛错。
 *
 * @type {Array<function(UpdateDecoderV1 | UpdateDecoderV2):AbstractContent>}
 */
export const contentRefs = [
  () => { error.unexpectedCase() }, // GC 不是 ItemContent。
  readContentDeleted, // 1
  readContentJSON, // 2
  readContentBinary, // 3
  readContentString, // 4
  readContentEmbed, // 5
  readContentFormat, // 6
  readContentType, // 7
  readContentAny, // 8
  readContentDoc, // 9
  () => { error.unexpectedCase() } // 10：Skip 不是 ItemContent。
]

/**
 * 从 info 低 5 位取得 ContentRef，并分派到对应内容解码器。
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @param {number} info - Item 标志字节；低 5 位是协议固定 ContentRef。
 * @return {import('./structs/Item.js').AbstractContent} 解码出的未集成内容。
 */
export const readItemContent = (decoder, info) => contentRefs[info & binary.BITS5](decoder)

/**
 * 从更新流读取旧式类型引用及可选节点名，创建未集成 `YType` 并保留引用供再次编码。
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @return {YType}
 *
 * @private
 * @function
 */
export const readYType = decoder => {
  const typeRef = decoder.readTypeRef()
  const ytype = new YType(typeRef === YXmlElementRefID || typeRef === YXmlHookRefID ? decoder.readKey() : null)
  ytype._legacyTypeRef = typeRef
  return ytype
}
