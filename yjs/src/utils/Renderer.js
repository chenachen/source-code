import { ObservableV2 } from 'lib0/observable'
import * as encoding from 'lib0/encoding'

import { getItemCleanStart } from './transaction-helpers.js'
import { diffIdSet, createInsertSetFromStructStore, createDeleteSetFromStructStore, insertIntoIdSet, mergeIdSets, intersectSets, createIdSet, createIdSetFromIdMap, writeIdSet, createIdMapFromIdSet, insertIntoIdMap, diffIdMap, createIdMap, mergeIdMaps, intersectMaps, createMaybeAttrRange, createContentAttribute } from './ids.js'
import { ContentDeleted, ContentFormat } from '../structs/Item.js'
import { createID } from './ID.js'
import { writeStructsFromIdSet } from './encoding-helpers.js'
import { applyUpdate, encodeStateAsUpdate } from './encoding.js'
import { UpdateEncoderV1 } from './UpdateEncoder.js'
import { transact } from './Transaction.js'
import { UndoManager, StackItem } from './UndoManager.js'

import { $renderer, AttributedContent } from './renderer-helpers.js'

export { AbstractRenderer, rendererContentLength, $renderer } from './renderer-helpers.js'

/**
 * 按 AttributionsRenderer 规则把一个已切分片段追加到结果。
 *
 * `inRC` 表示片段属于 `renderedContent`，因此即使文档已删除也按恢复内容显示；`attrs !== null`（包括空数组）则无论正常集合是否包含都显示并携带归因。无归因的真实删除只在 mode 1/2 留下片段，再由 Delta 状态机决定是否生成 delete。
 *
 * @param {Array<AttributedContent<any>>} contents - 输出数组。
 * @param {AbstractContent} c - 已按边界切分的内容。
 * @param {number} clock - 片段起始 clock。
 * @param {boolean} deleted - Item 在文档中的删除标志。
 * @param {boolean} inRC - 片段是否在 `renderedContent` 中。
 * @param {Array<ContentAttribute<any>>|null} attrs - 片段 attribution。
 * @param {0|1|2|3} shouldRender - `AbstractRenderer.readContent` 定义的输出模式。
 */
const pushAttributedPiece = (contents, c, clock, deleted, inRC, attrs, shouldRender) => {
  if (inRC || attrs != null) {
    // 正常集合或 attribution 任一命中即可见；恢复的删除片段清除有效 deleted 标志。
    contents.push(new AttributedContent(c, clock, deleted && !inRC, attrs, shouldRender))
  } else if (deleted && shouldRender !== 0 && shouldRender !== 3) {
    // 真删除、无 attribution、未恢复：mode 1 不显示，mode 2 发 delete；mode 0/3 不输出片段。
    contents.push(new AttributedContent(c, clock, true, null, shouldRender))
  }
  // 其余为自定义集合隐藏的存活内容，或 mode 0/3 下不可见的删除内容，不输出。
}

/**
 * 按 ContentMap 给内容叠加 attribution，并可用 renderedContent 重定义正常可见集合。
 *
 * `attributions.inserts/deletes` 合并成 `renderAs`，其覆盖片段始终显示并携带属性。`renderedContent` 中内容按正常存活内容显示，即使 Item 已被删除；默认 `null` 时隐式采用“未删除即正常可见”，避免纯 attribution 叠加产生额外集合运算。自定义集合具有最终权威：集合外且无归因的存活内容也会隐藏。
 *
 * 删除内容必须仍保存在文档中，通常需在删除前设置 `gc=false`；本 renderer 不像 DiffRenderer 那样从旧文档补回被 GC 的 Content。构造器合并出独立映射，之后修改入参 ContentMap 不会自动刷新这个 renderer。
 *
 * @implements AbstractRenderer
 *
 * @extends {ObservableV2<{change:(idset:IdSet,origin:any,local:boolean)=>void}>}
 */
export class AttributionsRenderer extends ObservableV2 {
  /**
   * 预合并 attribution 映射与可见覆盖集合，为逐 Item 渲染提供快速判断。
   *
   * @param {ContentMap} attributions - 插入/删除 attribution IdMap。
   * @param {Object} [options] - renderer 选项。
   * @param {IdSet?} [options.renderedContent] - 正常显示集合；默认隐式使用文档存活内容。
   */
  constructor (attributions, { renderedContent = null } = {}) {
    super()
    /** 插入与删除 attribution 的统一映射；`readContent` 据此切分属性边界。
     * @type {IdMap<any>} */
    this.renderAs = mergeIdMaps([attributions.inserts, attributions.deletes])
    /** `renderAs` 覆盖的 ID 集合，供 `hasItem` 快速判断；允许过度近似，最终输出由 `readContent` 决定。
     * @type {IdSet} */
    this.attributed = createIdSetFromIdMap(this.renderAs)
    /** 自定义正常可见集合；`null` 表示隐式规则 `alive ⟺ !item.deleted`。
     * @type {IdSet?} */
    this.renderedContent = renderedContent
    /** 自定义 `renderedContent ∪ attributed`，用于可见长度计算；默认模式不物化。
     * @type {IdSet?} */
    this.rendered = renderedContent === null ? null : mergeIdSets([renderedContent, this.attributed])
  }

  /** 返回统一 renderer schema 标记。 */
  get $type () { return $renderer }

  /**
   * 判断 Item 是否不能走通用快路径。
   *
   * attribution 命中总需接管；自定义可见集合下，还需接管待恢复的删除片段及未被完整覆盖、需要隐藏的存活片段。
   *
   * @param {Item} item - 待判断 Item。
   * @return {boolean} 至少一段需要特殊处理时为 `true`。
   */
  hasItem (item) {
    const { client, clock } = item.id
    if (this.attributed.intersects(client, clock, item.length)) return true
    if (this.renderedContent === null) return false
    // 自定义集合与快路径的差异只有两类：需恢复的删除内容，以及未完全覆盖、需隐藏的存活内容。
    return item.deleted
      ? this.renderedContent.intersects(client, clock, item.length)
      : !this.renderedContent.covers(client, clock, item.length)
  }

  /**
   * 先按正常可见集合、再按 attribution 边界切分内容，并追加有效片段。
   *
   * 常见的整 Item 可见状态使用一次 `renderAs.slice`；只有自定义集合在 Item 内部分段时才做外层/内层两级切分，避免纯 overlay 路径复制内容。
   *
   * @param {Array<AttributedContent<any>>} contents - 输出数组。
   * @param {number} client - 内容 client。
   * @param {number} clock - 起始 clock。
   * @param {boolean} deleted - 文档删除状态。
   * @param {AbstractContent} content - 待切分内容。
   * @param {0|1|2|3} shouldRender - retain/insert/delete 内部模式。
   */
  readContent (contents, client, clock, deleted, content, shouldRender) {
    const total = content.getLength()
    /** Item 按 renderedContent 切出的片段；整 Item 状态一致时置 `null`，从而只切一次 attribution。
     * @type {Array<import('./ids.js').MaybeIdRange>?} */
    let outer = null
    let inRC = !deleted // 默认规则：存活即正常可见。
    if (this.renderedContent !== null) {
      outer = this.renderedContent.slice(client, clock, total)
      if (outer.length === 1) {
        inRC = outer[0].exists
        outer = null
      }
    }
    if (outer === null) {
      // 正常可见状态全段一致，只需按 attribution 边界切片一次。
      const slice = this.renderAs.slice(client, clock, total)
      let rest = slice.length === 1 ? content : content.copy()
      for (let i = 0; i < slice.length; i++) {
        const s = slice[i]
        const c = rest
        if (i < slice.length - 1) rest = c.splice(s.len)
        pushAttributedPiece(contents, c, s.clock, deleted, inRC, s.attrs, shouldRender)
      }
      return
    }
    // 通用路径：外层 renderedContent 决定有效删除状态，内层 renderAs 决定 attrs。多外段意味着内容可安全复制/切分，不修改调用方对象。
    let rest = content.copy()
    for (let oi = 0; oi < outer.length; oi++) {
      const rcSeg = outer[oi]
      const slice = this.renderAs.slice(client, rcSeg.clock, rcSeg.len)
      for (let ii = 0; ii < slice.length; ii++) {
        const s = slice[ii]
        const last = oi === outer.length - 1 && ii === slice.length - 1
        const c = rest
        if (!last) rest = c.splice(s.len)
        pushAttributedPiece(contents, c, s.clock, deleted, rcSeg.exists, s.attrs, shouldRender)
      }
    }
  }

  /**
   * 计算 Item 在 attribution/自定义正常集合叠加后的可见 countable 长度。
   *
   * @param {Item} item - 待计算 Item。
   * @return {number} 非 countable 为零；否则为有效可见 ID 覆盖长度。
   */
  contentLength (item) {
    if (!item.content.isCountable()) {
      return 0
    }
    const { client, clock } = item.id
    if (this.renderedContent === null) {
      // 默认模式：存活内容完整可见；删除内容只在有 attribution 的区间可见。
      return item.deleted ? this.renderAs.coveredLength(client, clock, item.length) : item.length
    }
    // 自定义模式：长度为 Item 与 `(renderedContent ∪ attributed)` 的交集覆盖。
    return /** @type {IdSet} */ (this.rendered).coveredLength(client, clock, item.length)
  }
}

/**
 * 创建 attribution overlay renderer。
 *
 * @param {ContentMap} attributions - 插入/删除 attribution IdMap。
 * @param {Object} [options] - renderer 选项。
 * @param {IdSet?} [options.renderedContent] - 正常显示集合；默认使用文档存活内容。
 * @return {AttributionsRenderer} 新 renderer。
 */
export const createAttributionsRenderer = (attributions, options) => new AttributionsRenderer(attributions, options)

/**
 * 从旧 store 复制并裁剪出精确 ID 区间的 Content，供 DiffRenderer 补回已删除/GC 的新文档内容。
 *
 * 查找包含 clock 的单个旧 Item，复制后裁去左侧前缀和超过 len 的后缀；此 helper 不跨多个旧 Item 拼接内容。
 * 长度大于 1 的旧内容先复制；长度为 1 时直接借用原 Content。调用方需保证旧 store 仍含该 ID 的可恢复载荷，这里不处理旧文档也已 GC 的情况。
 *
 * @param {StructStore} store - 保留原内容的旧文档 store。
 * @param {number} client - 目标 client。
 * @param {number} clock - 目标起始 clock。
 * @param {number} len - 目标长度。
 * @return {AbstractContent} 从 clock 开始、长度至多 len 且不越过该旧 Item 的内容。
 */
const getItemContent = (store, client, clock, len) => {
  // 这里只读取包含起点的单个旧 Item。
  const prevItem = store.getItem(createID(client, clock))
  const diffStart = clock - prevItem.id.clock
  let content = prevItem.length > 1 ? prevItem.content.copy() : prevItem.content
  // 先去掉目标 clock 左侧前缀，再截断超过 len 的后缀。
  if (diffStart > 0) {
    content = content.splice(diffStart)
  }
  if (len < content.getLength()) {
    content.splice(len)
  }
  return content
}

/**
 * 从起止 ID 附近收集一个格式闭合的建议变更区间，返回应同步/反转的插入与删除集合。
 *
 * 向左扫描在关闭格式标记或首个含无归因存活内容的 Item 处停止，再向右收集。越过 end 后，只有遇到无归因存活片段且已打开格式键全部关闭才退出；因此选择可能扩展到邻近建议。起点本身若是关闭标记，不会先反向配对其开启标记。`collectAll` 用于接受，允许收集冗余删除事实；拒绝路径传事务，以便从旧 store 补回已 GC 的删除内容供 UndoManager 重做。
 *
 * @param {Transaction?} tr - 非空时允许切分并补回删除内容。
 * @param {DiffRenderer} renderer - 提供 diff attribution 与前后文档。
 * @param {ID} start - 选择起点。
 * @param {ID} end - 选择终点。
 * @param {boolean} collectAll - 是否收集范围内全部删除事实与必要插入。
 * @return {{inserts:IdSet,deletes:IdSet}} 收集的结构集合。
 */
const collectSuggestedChanges = (tr, renderer, start, end, collectAll) => {
  const inserts = createIdSet()
  const deletes = createIdSet()
  const store = renderer._nextDoc.store
  /** 活的非 null 格式项加入键，后续同键 `value:null` 项删除键；集合清空前不能停止右扫。
   * @type {Set<string>} */
  const openedCollectedFormats = new Set()
  /**
   * @type {Item?}
   */
  let item = store.getItem(start)
  const endItem = start === end ? item : (end == null ? null : store.getItem(end))

  // 关闭格式标记，或包含无归因内容的存活 Item，构成左边界；后者右侧的 attributed 尾段仍要收集。
  while (item.left != null) {
    item = item.left
    if (item.content instanceof ContentFormat && item.content.value == null) {
      item = item.right
      break
    }
    if (!item.deleted) {
      const slice = renderer.inserts.slice(item.id.client, item.id.clock, item.length)
      if (slice.some(s => s.attrs === null)) {
        for (let i = slice.length - 1; i >= 0; i--) {
          const s = slice[i]
          if (s.attrs == null) break
          inserts.add(item.id.client, s.clock, s.len)
        }
        item = item.right
        break
      }
    }
  }
  let foundEndItem = false
  // eslint-disable-next-line
  itemLoop: while (item != null) {
    const itemClient = item.id.client
    const slice = (item.deleted ? renderer.deletes : renderer.inserts).slice(itemClient, item.id.clock, item.length)
    foundEndItem ||= item === endItem
    if (item.deleted) {
      // 新文档删除项的 Content 可能已 GC；拒绝路径切分后从旧文档恢复精确片段。
      for (let i = slice.length - 1; i >= 0; i--) {
        const s = slice[i]
        if (s.attrs != null || collectAll) {
          deletes.add(itemClient, s.clock, s.len)
          if (collectAll) {
            // 同一 ID 可能既新增又删除；接受时一并编码 insert，目标文档会忽略已具备的冗余结构。
            inserts.add(itemClient, s.clock, s.len)
          }
        }
        if (tr != null) {
          const splicedItem = getItemCleanStart(tr, createID(itemClient, s.clock))
          if (s.attrs != null) {
            splicedItem.content = getItemContent(renderer._prevDocStore, itemClient, s.clock, s.len)
          }
        }
      }
    } else {
      if (item.content instanceof ContentFormat) {
        const { key, value } = item.content
        if (value == null) {
          openedCollectedFormats.delete(key)
        } else {
          openedCollectedFormats.add(key)
        }
      }
      for (let i = 0; i < slice.length; i++) {
        const s = slice[i]
        if (s.attrs != null) {
          inserts.add(itemClient, s.clock, s.len)
        } else if (foundEndItem && openedCollectedFormats.size === 0) {
          // eslint-disable-next-line
          break itemLoop
        }
      }
    }
    item = item.right
  }
  return { inserts, deletes }
}

/**
 * 把可选 attribution 裁到 diff 集合，并以空属性补齐未归因区间，得到完整覆盖的 IdMap。
 *
 * @param {IdMap<any>|undefined} attrs - 可选外部 attribution。
 * @param {IdSet} slice - 必须完整覆盖的 diff ID 集合。
 * @return {IdMap<any>} 每个 diff 区间都有属性数组或空数组的映射。
 */
const extractAttributions = (attrs, slice) => attrs == null ? createIdMapFromIdSet(slice, []) : mergeIdMaps([intersectMaps(attrs, slice), createIdMapFromIdSet(slice, [])])

/**
 * 持续维护 prevDoc 到 nextDoc 的结构差异，并把新增/删除建议渲染为 attribution 内容。
 *
 * prevDoc 是已接受基线，nextDoc 是建议工作副本。基线更新始终流向建议副本并缩小 diff；建议副本更新默认只留在建议模式，关闭 suggestionMode 后才按 origin 过滤回流基线。
 *
 * `inserts` 保存基线尚未接收的新增结构 ID，即使它后来又在 nextDoc 中删除也可留在映射中；`deletes` 保存基线尚未删除的旧内容。`attributed` 是快速覆盖近似，允许多报但不能漏报，`readContent` 再按 Item 当前删除状态选择映射，决定最终输出。
 *
 * @implements AbstractRenderer
 *
 * @extends {ObservableV2<{change:(idset:IdSet,origin:any,local:boolean)=>void}>}
 */
export class DiffRenderer extends ObservableV2 {
  /**
   * 计算初始差异，并安装双向同步、diff 维护与销毁监听器。
   *
   * @param {Doc} prevDoc - 已接受基线文档。
   * @param {Doc} nextDoc - 建议工作文档。
   * @param {Object} [options] - renderer 选项。
   * @param {ContentMap?} [options.attributions] - 应叠加到差异的 attribution。
   */
  constructor (prevDoc, nextDoc, { attributions = null } = {}) {
    super()
    const _nextDocInserts = createInsertSetFromStructStore(nextDoc.store, false) // 仅用于初始 diff；后续 next 插入直接来自事务。
    const _prevDocInserts = createInsertSetFromStructStore(prevDoc.store, false) // 后续由 prev beforeObserverCalls 增量维护。
    const nextDocDeletes = createDeleteSetFromStructStore(nextDoc.store) // 初始 next 删除基线；新删除直接来自事务。
    const prevDocDeletes = createDeleteSetFromStructStore(prevDoc.store) // 后续随 prev 事务维护。
    const insertDiff = diffIdSet(_nextDocInserts, _prevDocInserts)
    const deleteDiff = diffIdSet(nextDocDeletes, prevDocDeletes)
    /** 基线尚未接收的新增 ID 与归因；无外部归因的差异仍以空属性数组表示建议。 */
    this.inserts = extractAttributions(attributions?.inserts, insertDiff)
    /** 建议副本已删、基线尚未删除的 ID 与归因；读取时借旧 store 恢复载荷。 */
    this.deletes = extractAttributions(attributions?.deletes, deleteDiff)
    /** inserts/deletes 的原始覆盖并集；可能保留后来又被删的建议插入而多报，最终以 `readContent` 为准。
     * @type {IdSet} */
    this.attributed = mergeIdSets([insertDiff, deleteDiff])
    /** 接受状态所在文档；接受建议时 update 的目标。 */
    this._prevDoc = prevDoc
    /** 旧文档 store 的引用；新副本 GC 后从这里读取尚存的原载荷，不是构造时的内容快照。 */
    this._prevDocStore = prevDoc.store
    /** 建议工作副本；渲染、范围定位及拒绝建议的撤销操作均在这里进行。 */
    this._nextDoc = nextDoc
    // 必须在 next observer 之前更新 diff，使同一事务产生的 delta 已看到最新 attribution 状态。
    /** 建议副本的 observer 前监听器引用；计算事务差异，destroy 时用同一引用注销。 */
    this._nextBOH = nextDoc.on('beforeObserverCalls', tr => {
      // next 新增中排除基线已存在 ID，余下成为建议插入。
      const diffInserts = diffIdSet(tr.insertSet, _prevDocInserts)
      insertIntoIdMap(this.inserts, extractAttributions(attributions?.inserts, diffInserts))
      // next 删除中排除基线已删项与当前建议插入，余下成为建议删除。
      const diffDeletes = diffIdSet(diffIdSet(tr.deleteSet, prevDocDeletes), this.inserts)
      insertIntoIdMap(this.deletes, extractAttributions(attributions?.deletes, diffDeletes))
      insertIntoIdSet(this.attributed, diffInserts)
      insertIntoIdSet(this.attributed, diffDeletes)
      // @todo 可针对 diffInserts/diffDeletes 发更精确的更新范围。
    })
    /** 基线的 observer 前监听器引用；逐出已接受的归因并通知 change。 */
    this._prevBOH = prevDoc.on('beforeObserverCalls', tr => {
      insertIntoIdSet(_prevDocInserts, tr.insertSet)
      insertIntoIdSet(prevDocDeletes, tr.deleteSet)
      if (tr.insertSet.clients.size < 2) {
        tr.insertSet.forEach((attrRange, client) => {
          this.inserts.delete(client, attrRange.clock, attrRange.len)
        })
      } else {
        this.inserts = diffIdMap(this.inserts, tr.insertSet)
      }
      // 删除映射也按基线新删除区间收缩；小 client 集合走原地删除，较大集合用批量差集。
      if (tr.deleteSet.clients.size < 2) {
        tr.deleteSet.forEach((attrRange, client) => {
          this.deletes.delete(client, attrRange.clock, attrRange.len)
        })
      } else {
        this.deletes = diffIdMap(this.deletes, tr.deleteSet)
      }
      // 先从覆盖集合逐出基线已接受/拒绝范围，再把仍被任一映射覆盖的交集补回；同一 ID 可同时有插入和删除建议，不能因只处理其中一侧而漏报。
      const evicted = mergeIdSets([tr.insertSet, tr.deleteSet])
      this.attributed = diffIdSet(this.attributed, evicted)
      insertIntoIdSet(this.attributed, intersectSets(evicted, this.inserts))
      insertIntoIdSet(this.attributed, intersectSets(evicted, this.deletes))
      // 通知 attribution 变化；同一基线事务内新增又删除的 ID 没有可见中间态，从事件范围排除。
      this.emit('change', [diffIdSet(mergeIdSets([tr.insertSet, tr.deleteSet]), intersectSets(tr.insertSet, tr.deleteSet)), tr.origin, tr.local])
    })
    // 基线变化始终流入建议副本；建议变化仅在关闭 suggestionMode 且命中 origin 策略时回流。
    /** 基线 update 转发监听器；origin 为本 renderer 时不再回送，避免接受操作的回路。 */
    this._prevUpdateListener = prevDoc.on('update', (update, origin) => {
      origin !== this && applyUpdate(nextDoc, update)
    })
    /** 非建议模式下的工作副本 update 回流监听器；仅匹配 origin 的本地事务进入基线。 */
    this._ndUpdateListener = nextDoc.on('update', (update, origin, _doc, tr) => {
      // 只回流本地建议事务；远端应用产生的 update 不应再次形成同步环。
      if (!this.suggestionMode && tr.local && (this.suggestionOrigins == null || this.suggestionOrigins.some(o => o === origin))) {
        applyUpdate(prevDoc, update, this)
      }
    })
    /** 工作副本事务完成监听器；传播 renderer 视图中删掉、结构上早已 deleted 的内容。 */
    this._afterTrListener = nextDoc.on('afterTransaction', (tr) => {
      // 关闭建议模式后，用户可能删除 renderer 恢复显示、但 nextDoc 结构已标 deleted 的内容；普通 update 不会再次携带该删除，需从事务 meta 单独传播。
      if (!this.suggestionMode && tr.local && (this.suggestionOrigins == null || this.suggestionOrigins.some(o => o === tr.origin))) {
        const attributedDeletes = tr.meta.get('attributedDeletes')
        if (attributedDeletes != null) {
          transact(prevDoc, () => {
            // 构造“零新增结构 + 指定 delete set”的最小 update 应用到基线。
            const ds = new UpdateEncoderV1()
            encoding.writeVarUint(ds.restEncoder, 0) // 编码零个结构。
            writeIdSet(ds, attributedDeletes)
            applyUpdate(prevDoc, ds.toUint8Array())
          }, this)
        }
      }
    })
    /** 默认把本地编辑保留在建议副本；设为 false 后才启用本地事务回流。 */
    this.suggestionMode = true
    /** 关闭建议模式时，可选限制哪些 origin 能把 nextDoc 本地变化同步回基线。
     * @type {Array<any>?} */
    this.suggestionOrigins = null
    /** 绑定本实例的销毁回调；任一文档销毁时解除两边监听。 */
    this._destroyHandler = nextDoc.on('destroy', this.destroy.bind(this))
    prevDoc.on('destroy', this._destroyHandler)
  }

  /** 返回统一 renderer schema 标记。 */
  get $type () { return $renderer }

  /**
   * 判断 Item 区间是否与当前差异覆盖相交。
   *
   * @param {Item} item - 待判断 Item。
   * @return {boolean} 至少一段可能需差异渲染时为 `true`。
   */
  hasItem (item) {
    return this.attributed.intersects(item.id.client, item.id.clock, item.length)
  }

  /** 注销前后文档的同步、事务与销毁监听器，并销毁自身事件订阅。 */
  destroy () {
    super.destroy()
    this._nextDoc.off('destroy', this._destroyHandler)
    this._prevDoc.off('destroy', this._destroyHandler)
    this._nextDoc.off('beforeObserverCalls', this._nextBOH)
    this._prevDoc.off('beforeObserverCalls', this._prevBOH)
    this._prevDoc.off('update', this._prevUpdateListener)
    this._nextDoc.off('update', this._ndUpdateListener)
    this._nextDoc.off('afterTransaction', this._afterTrListener)
  }

  /** 把 nextDoc 的完整缺失状态 update 应用到 prevDoc，接受全部建议。 */
  acceptAllChanges () {
    applyUpdate(this._prevDoc, encodeStateAsUpdate(this._nextDoc))
  }

  /**
   * 先把 nextDoc 状态应用到 prevDoc，再用该事务的 insert/delete 集合立即撤销，恢复基线应用前的可见内容并让 diff 监听器收敛。
   *
   * 临时 UndoManager 只承载这一事务，完成后立即销毁，避免持续捕获。
   */
  rejectAllChanges () {
    this._prevDoc.transact(tr => {
      applyUpdate(this._prevDoc, encodeStateAsUpdate(this._nextDoc))
      const um = new UndoManager(this._prevDoc)
      um.undoStack.push(new StackItem(tr.insertSet, tr.deleteSet))
      um.undo()
      um.destroy()
    })
  }

  /**
   * 从指定 ID 范围向邻近边界扩展，接受收集到的建议。
   *
   * 从 nextDoc 编码收集到的插入结构和 delete set，应用到基线；允许冗余事实，由 update 集成幂等过滤。
   *
   * @param {ID} start - 定位选择起点所在的 Item；收集并非精确截断到这个 clock。
   * @param {ID} end - 定位终点 Item，默认与起点相同；仍可能扩展到后续边界。
   */
  acceptChanges (start, end = start) {
    const { inserts, deletes } = collectSuggestedChanges(null, this, start, end, true)
    const encoder = new UpdateEncoderV1()
    writeStructsFromIdSet(encoder, this._nextDoc.store, inserts)
    writeIdSet(encoder, deletes)
    applyUpdate(this._prevDoc, encoder.toUint8Array())
  }

  /**
   * 在 nextDoc 内撤销指定范围的建议，再接受该范围已收敛后的状态以更新基线。
   *
   * 拒绝删除建议前会从 prevDocStore 补回可能被 GC 的 Content；临时 UndoManager 反转收集集合后立即销毁。
   *
   * @param {ID} start - 定位选择起点所在的 Item。
   * @param {ID} end - 定位终点 Item，默认与起点相同；收集规则与 acceptChanges 相同。
   */
  rejectChanges (start, end = start) {
    this._nextDoc.transact(tr => {
      const { inserts, deletes } = collectSuggestedChanges(tr, this, start, end, false)
      const encoder = new UpdateEncoderV1()
      writeStructsFromIdSet(encoder, this._nextDoc.store, inserts)
      writeIdSet(encoder, deletes)
      const um = new UndoManager(this._nextDoc)
      um.undoStack.push(new StackItem(inserts, deletes))
      um.undo()
      um.destroy()
    })
    this.acceptChanges(start, end)
  }

  /**
   * 按 inserts/deletes attribution 边界切分内容；必要时从 prevDocStore 恢复 nextDoc 已丢失的删除 Content。
   *
   * mode 3 的同事务新增后删除只在有 attribution 时输出 insert；无 attribution 片段必须完全省略，因为消费端从未见过该内容，输出 delete 会错删现有状态。
   *
   * @param {Array<AttributedContent<any>>} contents - 输出数组。
   * @param {number} client - 内容 client。
   * @param {number} clock - 起始 clock。
   * @param {boolean} deleted - nextDoc 删除状态。
   * @param {AbstractContent} _content - nextDoc 当前 Content。
   * @param {0|1|2|3} shouldRender - retain/insert/delete 内部模式。
   */
  readContent (contents, client, clock, deleted, _content, shouldRender) {
    const slice = (deleted ? this.deletes : this.inserts).slice(client, clock, _content.getLength())
    /**
     * @type {AbstractContent?}
     */
    let content = slice.length === 1 ? _content : _content.copy()
    for (let i = 0; i < slice.length; i++) {
      const s = slice[i]
      if (content == null || content instanceof ContentDeleted) {
        if ((!shouldRender && s.attrs == null) || this.inserts.has(client, s.clock)) {
          continue
        }
        // 从包含当前 slice 起点的旧 Item 恢复；旧 Item 更短时，下方把 slice 再拆开，下一轮继续取旧内容。
        const prevItem = this._prevDocStore.getItem(createID(client, s.clock))
        const diffStart = s.clock - prevItem.id.clock
        content = prevItem.length > 1 ? prevItem.content.copy() : prevItem.content
        // 去掉 slice 起点之前的内容。
        if (diffStart > 0) {
          content = content.splice(diffStart)
        }
      }
      const c = /** @type {AbstractContent} */ (content)
      const clen = c.getLength()
      if (clen < s.len) {
        slice.splice(i + 1, 0, createMaybeAttrRange(s.clock + clen, s.len - clen, s.attrs))
        s.len = clen
      }
      content = s.len < clen ? c.splice(s.len) : null
      // mode 3 仅在有 attribution 处作为 insert；无 attribution fresh 删除不产生任何操作。
      if (!deleted || s.attrs != null || (shouldRender !== 0 && shouldRender !== 3)) {
        contents.push(new AttributedContent(c, s.clock, deleted, s.attrs, shouldRender))
      }
    }
  }

  /**
   * 计算 Item 在 diff 视图中的 countable 长度。
   *
   * 存活内容完整计数；删除内容仅统计 `readContent(mode 0)` 恢复出的有 attribution 片段。
   *
   * @param {Item} item - 待计算 Item。
   * @return {number} diff 视图可见长度。
   */
  contentLength (item) {
    if (!item.deleted) {
      return item.content.isCountable() ? item.length : 0
    }
    /**
     * @type {Array<AttributedContent<any>>}
     */
    const cs = []
    this.readContent(cs, item.id.client, item.id.clock, true, item.content, 0)
    return cs.reduce((cnt, c) => cnt + ((c.attrs != null && c.content.isCountable()) ? c.content.getLength() : 0), 0)
  }
}

/**
 * 创建维护 prevDoc→nextDoc 差异的 renderer。
 *
 * @param {Doc} prevDoc - 已接受基线。
 * @param {Doc} nextDoc - 建议工作副本。
 * @param {Object} [options] - renderer 选项。
 * @param {ContentMap?} [options.attributions] - 叠加到 diff 的 attribution。
 * @return {DiffRenderer} 已安装监听器的 renderer。
 */
export const createDiffRenderer = (prevDoc, nextDoc, options) => new DiffRenderer(prevDoc, nextDoc, options)

/**
 * 兼容 v13 snapshot API 的历史切面 renderer；要求承载文档关闭 GC。
 *
 * prevSnapshot 到 nextSnapshot 间新增/新删区间用内部 `change` 属性标记以强制走 renderer，输出前移除该内部标记；nextSnapshot 之后的内容由 `hasItem/readContent` 接管并隐藏。
 *
 * @implements AbstractRenderer
 *
 * @extends {ObservableV2<{change:(idset:IdSet,origin:any,local:boolean)=>void}>}
 */
export class SnapshotRenderer extends ObservableV2 {
  /**
   * 建立从 prevSnapshot 到 nextSnapshot 的插入/删除可见区间映射。
   *
   * @param {Snapshot} prevSnapshot - 对比起点快照。
   * @param {Snapshot} nextSnapshot - 要渲染的终点快照。
   */
  constructor (prevSnapshot, nextSnapshot) {
    super()
    /** 起点快照引用；构造时据它区分旧内容与快照间变化。 */
    this.prevSnapshot = prevSnapshot
    /** 终点快照引用；readContent/hasItem 持续读取它的 sv/ds，调用方应保持其边界稳定。 */
    this.nextSnapshot = nextSnapshot
    const inserts = createIdMap()
    const deletes = createIdMapFromIdSet(diffIdSet(nextSnapshot.ds, prevSnapshot.ds), [createContentAttribute('change', '')])
    nextSnapshot.sv.forEach((clock, client) => {
      const prevClock = prevSnapshot.sv.get(client) || 0
      inserts.add(client, 0, prevClock, []) // prevSnapshot 已包含内容正常显示，不附外部属性。
      inserts.add(client, prevClock, clock - prevClock, [createContentAttribute('change', '')]) // 快照间新增内容用内部 change 标记接管。
    })
    /** 正常旧内容、快照间新增与删除的统一映射；内部 change 属性在输出片段时移除。 */
    this.attrs = mergeIdMaps([diffIdMap(inserts, prevSnapshot.ds), deletes])
    /** attrs 覆盖到 nextSnapshot 的有限 ID；快照之后的无限未来区间无法枚举，由 `hasItem` 额外声明接管并隐藏。
     * @type {IdSet} */
    this.attributed = createIdSetFromIdMap(this.attrs)
  }

  /** 返回统一 renderer schema 标记。 */
  get $type () { return $renderer }

  /**
   * 接管快照 attrs 命中项及 state vector 之后的未来内容。
   *
   * @param {Item} item - 待判断 Item。
   * @return {boolean} 需要按快照边界显示或隐藏时为 `true`。
   */
  hasItem (item) {
    // 未来内容（含快照从未见过的 client）必须由 renderer 接管并隐藏，否则通用快路径会把存活项显示出来。
    return (this.nextSnapshot.sv.get(item.id.client) ?? 0) < item.id.clock + item.length ||
      this.attributed.intersects(item.id.client, item.id.clock, item.length)
  }

  /**
   * 按 nextSnapshot 的 state/delete 边界过滤内容，并移除只用于内部接管的 `change` 属性。
   *
   * @param {Array<AttributedContent<any>>} contents - 输出数组。
   * @param {number} client - 内容 client。
   * @param {number} clock - 起始 clock。
   * @param {boolean} _deleted - 当前文档删除状态；快照视图改用 nextSnapshot.ds 判定。
   * @param {AbstractContent} content - 待切分内容。
   * @param {0|1|2|3} shouldRender - retain/insert/delete 内部模式。
   */
  readContent (contents, client, clock, _deleted, content, shouldRender) {
    if ((this.nextSnapshot.sv.get(client) ?? 0) <= clock) return // 完全位于快照未来，不显示。
    const slice = this.attrs.slice(client, clock, content.getLength())
    content = slice.length === 1 ? content : content.copy()
    slice.forEach(s => {
      const deleted = this.nextSnapshot.ds.has(client, s.clock)
      const nonExistend = (this.nextSnapshot.sv.get(client) ?? 0) <= s.clock
      const c = content
      if (s.len < c.getLength()) {
        content = c.splice(s.len)
      }
      if (nonExistend) return
      if (shouldRender || !deleted || (s.attrs != null && s.attrs.length > 0)) {
        let attrsWithoutChange = s.attrs?.filter(attr => attr.name !== 'change') ?? null
        if (s.attrs?.length === 0) {
          attrsWithoutChange = null
        }
        contents.push(new AttributedContent(c, s.clock, deleted, attrsWithoutChange, shouldRender))
      }
    })
  }

  /**
   * 按当前删除状态与 snapshot attrs 计算 countable 长度。
   *
   * 当前已删 Item 只统计快照 attrs 覆盖的片段；当前存活 Item 直接取完整长度，不按 nextSnapshot.sv 截断。
   * 因此含快照之后的存活内容时，这里的索引计数与 `readContent` 隐藏未来内容的结果不同。
   *
   * @param {Item} item - 待计算 Item。
   * @return {number} 当前实现计算的 countable 长度。
   */
  contentLength (item) {
    return item.content.isCountable()
      ? (item.deleted
          ? this.attrs.sliceId(item.id, item.length).reduce((len, s) => s.attrs != null ? len + s.len : len, 0)
          : item.length
        )
      : 0
  }
}

/**
 * 创建 snapshot renderer；省略 nextSnapshot 时渲染单一历史切面。
 *
 * @param {Snapshot} prevSnapshot - 起点快照。
 * @param {Snapshot} nextSnapshot - 终点快照，默认与起点相同。
 * @return {SnapshotRenderer} 新 renderer。
 */
export const createSnapshotRenderer = (prevSnapshot, nextSnapshot = prevSnapshot) => new SnapshotRenderer(prevSnapshot, nextSnapshot)
