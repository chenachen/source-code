import * as error from 'lib0/error'
import * as map from 'lib0/map'
import * as math from 'lib0/math'
import * as logging from 'lib0/logging'
import { callAll } from 'lib0/function'

import { ContentFormat } from '../structs/Item.js'
import { getStateVector } from './StructStore.js'
import { callEventHandlerListeners } from './EventHandler.js'
import { createIdSet, iterateStructsByIdSet } from './ids.js'
import { GC } from '../structs/GC.js'
import { YEvent } from './YEvent.js'
import { writeUpdateMessageFromTransaction } from './encoding-helpers.js'
import { UpdateEncoderV1, UpdateEncoderV2 } from './UpdateEncoder.js'
import { findIndexSS, updateCurrentFormats, cleanupFormattingGap, tryGcDeleteSet, tryMerge, tryToMergeWithLefts, cleanupContextlessFormattingGap } from './transaction-helpers.js'
import * as random from 'lib0/random'

/** 生成 53 位安全整数 client id；碰撞检测后也用它替换当前写入者标识。 */
export const generateNewClientId = random.uint53

/**
 * 记录一次 Yjs 模型变更批次的插入、删除、受影响类型与生命周期元数据。
 *
 * 多次修改放进同一事务可合并 observer 调用和网络 update；嵌套事务复用外层实例，不创建额外通知边界。
 *
 * @example
 * const ydoc = new Y.Doc()
 * const map = ydoc.get('map')
 * // 变更发生时记录内容
 * map.observe(() => {
 *   console.log('change triggered')
 * })
 * // 分开修改会各触发一次日志：
 * map.setAttr('a', 0) // => "change triggered"
 * map.setAttr('b', 0) // => "change triggered"
 * // 合并进事务后，只在事务结束时触发一次：
 * ydoc.transact(() => {
 *   map.setAttr('a', 1)
 *   map.setAttr('b', 1)
 * }) // => "change triggered"
 *
 * @public
 */
export class Transaction {
  /**
   * 创建活动事务；before/after state vector 均按需计算，避免每次变更都复制全量状态。
   *
   * @param {Doc} doc - 本事务修改的文档。
   * @param {any} origin - 发起方标识，供 provider、observer 和 UndoManager 识别来源。
   * @param {boolean} local - 是否由本地文档发起。
   */
  constructor (doc, origin, local) {
    /** 本事务所属文档。
     * @type {Doc} */
    this.doc = doc
    /** 本事务删除的结构 ID 区间；包含事务内先插入再删除的项。 */
    this.deleteSet = createIdSet()
    /** 格式清理额外删除的结构 ID 区间；始终是 `deleteSet` 的子集。 */
    this.cleanUps = createIdSet()
    /** 本事务插入的结构 ID 区间。 */
    this.insertSet = createIdSet()
    /** 事务开始前的惰性 state vector 缓存。
     * @type {Map<Number,Number>?} */
    this._beforeState = null
    /** 事务完成后的惰性 state vector 缓存；完成前读取非法。
     * @type {Map<Number,Number>?} */
    this._afterState = null
    /** 直接修改的已存在类型及其属性键；序列内容变化用 `null`，本事务新插入的类型不单独发事件。
     * @type {Map<YType,Set<String|null>>} */
    this.changed = new Map()
    /** 类型及祖先到事件数组的映射，供 `observeDeep` 与深层 delta 共用同一冒泡结果。
     * @type {Map<YType,Array<YEvent<any>>>} */
    this.changedParentTypes = new Map()
    /** cleanup 阶段需尝试与相邻结构合并的替换结构。
     * @type {Array<AbstractStruct>} */
    this._mergeStructs = []
    /** 发起方标识；对象身份会参与 UndoManager 的 trackedOrigins 判断。
     * @type {any} */
    this.origin = origin
    /** 生命周期监听器之间共享的事务级元数据。
     * @type {Map<any,any>} */
    this.meta = new Map()
    /** 变更是否源于本地，而非解码远端 update。
     * @type {boolean} */
    this.local = local
    /** 本事务新集成的子文档。
     * @type {Set<Doc>} */
    this.subdocsAdded = new Set()
    /** 本事务移除的子文档。
     * @type {Set<Doc>} */
    this.subdocsRemoved = new Set()
    /** 本事务显式请求加载的子文档。
     * @type {Set<Doc>} */
    this.subdocsLoaded = new Set()
    /** 是否需要在 observer 调用后另开事务清理冗余格式项。
     * @type {boolean} */
    this._needFormattingCleanup = false
    this._done = false
  }

  /**
   * 惰性重建事务开始前的 state vector。
   *
   * 当前 store 已含本事务插入项，因此必须把每个插入区间的 client clock 回退到首项起点。
   *
   * @deprecated
   * @type {Map<Number,Number>}
   */
  get beforeState () {
    if (this._beforeState == null) {
      const sv = getStateVector(this.doc.store)
      this.insertSet.clients.forEach((ranges, client) => {
        sv.set(client, ranges.getIds()[0].clock)
      })
      this._beforeState = sv
    }
    return this._beforeState
  }

  /**
   * 在事务标记完成后惰性重建结束 state vector。
   *
   * 当前 store 可能已继续变化，因此本事务写入 client 的 clock 取其最后插入区间末端；完成前读取会抛错。
   *
   * @deprecated
   * @type {Map<Number,Number>}
   */
  get afterState () {
    if (!this._done) error.unexpectedCase()
    if (this._afterState == null) {
      const sv = getStateVector(this.doc.store)
      this.insertSet.clients.forEach((_ranges, client) => {
        const ranges = _ranges.getIds()
        const d = ranges[ranges.length - 1]
        sv.set(client, d.clock + d.len)
      })
      this._afterState = sv
    }
    return this._afterState
  }
}

/**
 * 全量扫描文本类型，删除被覆盖或已与上下文等价的格式项，并返回删除数。
 *
 * 该实验接口主要用于自动清理的兜底与测试：常规路径应在每次修改后局部清理。算法需要遍历完整内容并维护当前位置格式状态，成本与文本长度相关。
 *
 * @param {YType} type - 待清理文本类型；文档禁用格式清理时直接返回零。
 * @return {number} 删除的冗余格式项数量。
 */
export const cleanupYTextFormatting = type => {
  if (!type.doc?.cleanupFormatting) return 0
  let res = 0
  transact(/** @type {Doc} */ (type.doc), transaction => {
    let start = /** @type {Item} */ (type._start)
    let end = type._start
    let startFormats = map.create()
    const currentFormats = map.copy(startFormats)
    while (end) {
      if (end.deleted === false) {
        switch (end.content.constructor) {
          case ContentFormat:
            updateCurrentFormats(currentFormats, /** @type {ContentFormat} */ (end.content))
            break
          default:
            res += cleanupFormattingGap(transaction, start, end, startFormats, currentFormats)
            startFormats = map.copy(currentFormats)
            start = end
            break
        }
      }
      end = end.right
    }
  })
  return res
}

/**
 * 按队列顺序完成事务：通知 observer、清理结构、编码 update、处理子文档，再继续 observer 新建的后续事务。
 *
 * WHY：observer 可修改同一文档并可抛错。队列加 `try/finally` 同时保证不递归调用、每个事务必做结构清理，且其他 observer 仍有机会执行。
 *
 * @param {Array<Transaction>} transactionCleanups - 最外层事务及 observer 中追加的事务队列。
 * @param {number} i - 当前清理位置。
 */
const cleanupTransactions = (transactionCleanups, i) => {
  if (i < transactionCleanups.length) {
    const transaction = transactionCleanups[i]
    transaction._done = true
    const doc = transaction.doc
    const store = doc.store
    const ds = transaction.deleteSet
    const mergeStructs = transaction._mergeStructs
    // insertIntoIdSet(store.ds, ds)
    try {
      doc.emit('beforeObserverCalls', [transaction, doc])
      /** observer 回调队列；`callAll` 会在某项抛错后继续执行其余项。
       * @type {Array<function():void>} */
      const fs = []
      // 删除类型仍进入 changedParentTypes：自定义 renderer 可能继续展示建议删除的墓碑，其内部变化必须冒泡到存活祖先；类型自身是否通知由 `_callObserver` 判断。
      transaction.changed.forEach((subs, itemtype) =>
        fs.push(() => {
          itemtype._callObserver(transaction, subs)
        })
      )
      fs.push(() => {
        // `changedParentTypes` 同时包含变更类型及全部祖先，`observeDeep` 与 RDT `delta` 因而共享完全一致的冒泡边界。
        transaction.changedParentTypes.forEach((events, type) => {
          // 删除类型仅在仍挂有 renderer 时直接发事件；否则只保留向存活祖先的冒泡，避免不可见墓碑产生无意义通知。
          if (type._item !== null && type._item.deleted && type._renderer === null) return
          const hasDeep = type._dEH.l.length > 0
          const hasDeltaListeners = (type._observers.get('delta')?.size ?? 0) > 0
          const maintaining = type._delta !== null
          if (!hasDeep && !hasDeltaListeners && !maintaining) return
          /**
           * @type {YEvent<any>}
           */
          const deepEventHandler = events.find(event => event.target === type) || new YEvent(type, transaction, new Set(null))
          if (hasDeep) {
            callEventHandlerListeners(type._dEH, deepEventHandler, transaction)
          }
          if (hasDeltaListeners || maintaining) {
            // 从当前 type 为根计算深层 delta；祖先变更表现为嵌套 `modify` 链。
            const change = /** @type {any} */ (deepEventHandler.getDelta({ renderer: type._renderer, deep: true }).done())
            // 基础 renderer 不显示已删除内容；完全发生在不可见子树中的变更会渲染为空，不能发这种 no-op。
            if (!change.isEmpty()) {
              type._delta?.apply(change) // 更新当前类型及祖先的缓存，并保留 DiffRenderer attribution。
              if (hasDeltaListeners) type.emit('delta', [change, transaction.origin])
            }
          }
        })
      })
      fs.push(() => doc.emit('afterTransaction', [transaction, doc]))
      callAll(fs, [])
      if (transaction._needFormattingCleanup && doc.cleanupFormatting) {
        cleanupYTextAfterTransaction(transaction)
      }
    } finally {
      // observer 全部尝试后才把删除项替换为 ItemDeleted/GC；此前 observer 仍可读取事务前后结构。
      if (doc.gc) {
        tryGcDeleteSet(transaction, ds, doc.gcFilter)
      }
      tryMerge(ds, store)

      // 每个受影响 client 从右向左合并，删除数组元素时不会跳过左侧候选。
      transaction.insertSet.clients.forEach((ids, client) => {
        const firstClock = ids.getIds()[0].clock
        const structs = /** @type {Array<GC|Item>} */ (store.clients.get(client))
        // 从右向左遍历，确保 splice 后尚未检查的索引仍有效。
        const firstChangePos = math.max(findIndexSS(structs, firstClock), 1)
        for (let i = structs.length - 1; i >= firstChangePos;) {
          i -= 1 + tryToMergeWithLefts(structs, i)
        }
      })
      // 再处理事务中被替换的结构。理想上可转成排序后的 DeleteSet，但当前 DeleteSet 不保留重复项。
      for (let i = mergeStructs.length - 1; i >= 0; i--) {
        const { client, clock } = mergeStructs[i].id
        const structs = /** @type {Array<GC|Item>} */ (store.clients.get(client))
        const replacedStructPos = findIndexSS(structs, clock)
        if (replacedStructPos + 1 < structs.length) {
          if (tryToMergeWithLefts(structs, replacedStructPos + 1) > 1) {
            continue // 两侧已经在本次合并中覆盖，无需重复检查左侧。
          }
        }
        if (replacedStructPos > 0) {
          tryToMergeWithLefts(structs, replacedStructPos)
        }
      }
      if (!transaction.local && transaction.insertSet.clients.has(doc.clientID)) {
        logging.print(logging.ORANGE, logging.BOLD, '[yjs] ', logging.UNBOLD, logging.RED, 'Changed the client-id because another client seems to be using it.')
        doc.clientID = generateNewClientId()
      }
      // 当前每个 cleanup 事务独立编码 update；尚未把 observer 产生的整队事务合并成单一消息。
      doc.emit('afterTransactionCleanup', [transaction, doc])
      if (doc._observers.has('update')) {
        const encoder = new UpdateEncoderV1()
        const hasContent = writeUpdateMessageFromTransaction(encoder, transaction)
        if (hasContent) {
          doc.emit('update', [encoder.toUint8Array(), transaction.origin, doc, transaction])
        }
      }
      if (doc._observers.has('updateV2')) {
        const encoder = new UpdateEncoderV2()
        const hasContent = writeUpdateMessageFromTransaction(encoder, transaction)
        if (hasContent) {
          doc.emit('updateV2', [encoder.toUint8Array(), transaction.origin, doc, transaction])
        }
      }
      const { subdocsAdded, subdocsLoaded, subdocsRemoved } = transaction
      if (subdocsAdded.size > 0 || subdocsRemoved.size > 0 || subdocsLoaded.size > 0) {
        subdocsAdded.forEach(subdoc => {
          subdoc.clientID = doc.clientID
          if (subdoc.collectionid == null) {
            subdoc.collectionid = doc.collectionid
          }
          doc.subdocs.add(subdoc)
        })
        subdocsRemoved.forEach(subdoc => doc.subdocs.delete(subdoc))
        doc.emit('subdocs', [{ loaded: subdocsLoaded, added: subdocsAdded, removed: subdocsRemoved }, doc, transaction])
        subdocsRemoved.forEach(subdoc => subdoc.destroy())
      }

      if (transactionCleanups.length <= i + 1) {
        doc._transactionCleanups = []
        doc.emit('afterAllTransactions', [doc, transactionCleanups])
      } else {
        cleanupTransactions(transactionCleanups, i + 1)
      }
    }
  }
}

/**
 * observer 调用后，按本事务插入/删除范围选择局部或全量格式清理。
 *
 * WHY：格式项插入或删除会改变后续位置的格式上下文，必须全量重算对应类型；仅删除普通内容时可从局部间隙反向去重。清理另开事务，使新增删除可正常进入 observer/update 流程。
 *
 * @param {Transaction} transaction
 */
export const cleanupYTextAfterTransaction = transaction => {
  /**
   * 需要全量格式清理的类型集合。
   * @type {Set<YType>}
   */
  const needFullCleanup = new Set()
  // 插入格式项会改变后续上下文，登记其父类型做全量清理。
  const doc = transaction.doc
  iterateStructsByIdSet(transaction, transaction.insertSet, (item) => {
    if (
      !item.deleted && /** @type {Item} */ (item).content.constructor === ContentFormat && item.constructor !== GC
    ) {
      needFullCleanup.add(/** @type {any} */ (item).parent)
    }
  })
  // 清理操作本身会删除结构，必须进入新事务并排在当前 cleanup 队列之后。
  transact(doc, (t) => {
    iterateStructsByIdSet(transaction, transaction.deleteSet, item => {
      if (item instanceof GC || !(/** @type {YType} */ (item.parent)._hasFormatting) || needFullCleanup.has(/** @type {YType} */ (item.parent))) {
        return
      }
      const parent = /** @type {YType} */ (item.parent)
      if (item.content.constructor === ContentFormat) {
        needFullCleanup.add(parent)
      } else {
        // 只删除普通内容时，间隙两侧格式足以局部去重，无需计算该位置之前的完整格式状态。
        cleanupContextlessFormattingGap(t, item)
      }
    })
    // 涉及格式项时必须从类型起点累计 currentFormats，直接全量清理。
    for (const yText of needFullCleanup) {
      cleanupYTextFormatting(yText)
    }
  })
}

/**
 * 实现 `Doc.transact()` 的嵌套事务边界，并保证异常路径也会完成最外层 cleanup。
 *
 * 首次调用创建事务和 cleanup 队列项；嵌套调用直接把同一事务传给回调。只有创建者清空 `_transaction` 并启动队列，因此 observer 中产生的事务按序处理而不会递归。
 *
 * @template T
 * @param {Doc} doc - 目标文档。
 * @param {function(Transaction):T} f - 在事务中执行的回调。
 * @param {any} [origin=true] - 发起方标识。
 * @param {boolean} [local=true] - 是否为本地变更。
 * @return {T} 回调返回值。
 *
 * @function
 */
export const transact = (doc, f, origin = null, local = true) => {
  const transactionCleanups = doc._transactionCleanups
  let initialCall = false
  /**
   * @type {any}
   */
  let result = null
  if (doc._transaction === null) {
    initialCall = true
    doc._transaction = new Transaction(doc, origin, local)
    transactionCleanups.push(doc._transaction)
    if (transactionCleanups.length === 1) {
      doc.emit('beforeAllTransactions', [doc])
    }
    doc.emit('beforeTransaction', [doc._transaction, doc])
  }
  try {
    result = f(doc._transaction)
  } finally {
    if (initialCall) {
      const finishCleanup = doc._transaction === transactionCleanups[0]
      doc._transaction = null
      if (finishCleanup) {
        // 最外层事务结束后才处理 observer。observer 可追加事务或抛错；cleanup 队列配合 finally 保证逐个执行且不形成递归栈。
        cleanupTransactions(transactionCleanups, 0)
      }
    }
  }
  return result
}
