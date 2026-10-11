import * as time from 'lib0/time'
import * as array from 'lib0/array'
import * as logging from 'lib0/logging'
import { ObservableV2 } from 'lib0/observable'

import { mergeIdSets, iterateStructsByIdSet, diffIdSet } from './ids.js'
import { Item, followRedone } from '../structs/Item.js'

import { transact } from './Transaction.js'
import { createID } from './ID.js'
import { isParentOf } from './isParentOf.js'
import { getItemCleanStart } from './transaction-helpers.js'
import { Doc } from './Doc.js'
import { YType } from '../ytype.js'

/**
 * 一次可撤销捕获区间的插入/删除 ID 集合及用户元数据。
 *
 * 撤销时删除 `inserts` 并重做 `deletes`；该撤销事务又会生成相反的 StackItem 进入 redo 栈。
 */
export class StackItem {
  /**
   * 创建栈项；集合可在 captureTimeout 内继续与后续事务合并。
   *
   * @param {IdSet} insertions - 捕获期间新增的结构 ID。
   * @param {IdSet} deletions - 捕获期间删除的结构 ID。
   */
  constructor (insertions, deletions) {
    /** 捕获区间内插入的 ID 集合；撤销时删除这些结构。 */
    this.inserts = insertions
    /** 捕获区间内删除的 ID 集合；撤销时复制重做这些结构。 */
    this.deletes = deletions
    /** 供调用方随撤销步骤保存选择区间等元数据；核心算法不解释其键值。 */
    this.meta = new Map()
  }
}
/**
 * 清除栈项时取消其删除内容及祖先的 keep 标记，允许这些内容在后续 GC 扫描中被回收。
 * 此函数不发起全量 GC，也不把这些旧删除区间加入当前事务的 deleteSet。
 *
 * @param {Transaction} tr - 执行解除固定的事务。
 * @param {UndoManager} um - 提供撤销作用域。
 * @param {StackItem} stackItem - 将被丢弃的栈项。
 */
const clearUndoManagerStackItem = (tr, um, stackItem) => {
  iterateStructsByIdSet(tr, stackItem.deletes, item => {
    if (item instanceof Item && um.scope.some(type => type === tr.doc || isParentOf(/** @type {YType} */ (type), item))) {
      keepItem(item, false)
    }
  })
}

/**
 * 从指定栈向后查找首个仍能产生可见变更的栈项，并在单一事务中应用反向操作。
 *
 * 远端覆盖可能让顶端步骤失效，因此循环丢弃 no-op，直到成功重做或删除结构，或栈为空。先重做捕获的删除，再反序删除捕获的插入；常见的父先子后插入顺序会因此按子先父后删除，让 deleteFilter 能查看尚未删除的父项。
 *
 * @param {UndoManager} undoManager - 当前管理器。
 * @param {Array<StackItem>} stack - undo 或 redo 源栈。
 * @param {'undo'|'redo'} eventType - 对外事件中的操作类型。
 * @return {StackItem?} 实际产生变更的栈项；无可应用步骤时为 `null`。
 */
const popStackItem = (undoManager, stack, eventType) => {
  /** 保留已完成事务，供栈弹出事件携带 `changedParentTypes`。
   * @type {any} */
  let _tr = null
  const doc = undoManager.doc
  const scope = undoManager.scope
  transact(doc, transaction => {
    while (stack.length > 0 && undoManager.currStackItem === null) {
      const store = doc.store
      const stackItem = /** @type {StackItem} */ (stack.pop())
      /** 捕获期间被删除、现在需要复制重做的 Item 集合。
       * @type {Set<Item>} */
      const itemsToRedo = new Set()
      /** 捕获期间插入、现在仍存活且位于作用域内的 Item。
       * @type {Array<Item>} */
      const itemsToDelete = []
      let performedChange = false
      iterateStructsByIdSet(transaction, stackItem.inserts, struct => {
        if (struct instanceof Item) {
          if (struct.redone !== null) {
            let { item, diff } = followRedone(store, struct.id)
            if (diff > 0) {
              item = getItemCleanStart(transaction, createID(item.id.client, item.id.clock + diff))
            }
            struct = item
          }
          if (!struct.deleted && scope.some(type => type === transaction.doc || isParentOf(/** @type {YType} */ (type), /** @type {Item} */ (struct)))) {
            itemsToDelete.push(struct)
          }
        }
      })
      iterateStructsByIdSet(transaction, stackItem.deletes, struct => {
        if (
          struct instanceof Item &&
          scope.some(type => type === transaction.doc || isParentOf(/** @type {YType} */ (type), struct)) &&
          // 同一捕获区间内先插入再删除的结构没有区间前状态，撤销时不能把它重做出来。
          !stackItem.inserts.hasId(struct.id)
        ) {
          itemsToRedo.add(struct)
        }
      })
      itemsToRedo.forEach(struct => {
        performedChange = redoItem(transaction, struct, itemsToRedo, stackItem.inserts, undoManager.ignoreRemoteAttributeChanges, undoManager) !== null || performedChange
      })
      // 反序删除通常让子项先于父项，deleteFilter 因而仍能检查完整父子上下文。
      for (let i = itemsToDelete.length - 1; i >= 0; i--) {
        const item = itemsToDelete[i]
        if (undoManager.deleteFilter(item)) {
          item.delete(transaction)
          performedChange = true
        }
      }
      undoManager.currStackItem = performedChange ? stackItem : null
    }
    transaction.changed.forEach((subProps, type) => {
      // 序列内容变化会使缓存索引失效；清空 search marker 强制下次重新定位。
      if (subProps.has(null) && type._searchMarker) {
        type._searchMarker.length = 0
      }
    })
    _tr = transaction
  }, undoManager)
  const res = undoManager.currStackItem
  if (res != null) {
    const changedParentTypes = _tr.changedParentTypes
    undoManager.emit('stack-item-popped', [{ stackItem: res, type: eventType, changedParentTypes, origin: undoManager }, undoManager])
    undoManager.currStackItem = null
  }
  return res
}

/**
 * UndoManager 捕获与冲突策略选项。
 *
 * @typedef {Object} UndoManagerOptions
 * @property {number} [UndoManagerOptions.captureTimeout=500] 普通编辑合并为同一栈项的最大时间间隔，单位毫秒。
 * @property {function(Transaction):boolean} [UndoManagerOptions.captureTransaction] 返回 `false` 时不捕获该事务。
 * @property {function(Item):boolean} [UndoManagerOptions.deleteFilter=()=>true] 撤销/重做准备删除作用域内 Item 时的最终过滤器；返回 `false` 保留该项。
 * @property {Set<any>} [UndoManagerOptions.trackedOrigins=new Set([null])] 允许捕获的 origin 实例或构造器集合；管理器自身会自动加入。
 * @property {boolean} [ignoreRemoteAttributeChanges] 是否允许重做属性时覆盖远端更新；默认保护远端值。旧名为 `ignoreRemoteMapChanges`。
 * @property {Doc} [doc] 管理器所属文档；作用域为空时必须显式提供。
 */

/**
 * 栈项事件载荷；`changedParentTypes` 来自触发事件的事务。
 * added/updated 可由普通编辑或 undo/redo 触发；popped 来自实际弹栈操作。
 *
 * @typedef {Object} StackItemEvent
 * @property {StackItem} StackItemEvent.stackItem 本次新增、合并或弹出的栈项；监听器可读写其 meta。
 * @property {any} StackItemEvent.origin added/updated 使用捕获事务的来源，popped 使用本管理器。
 * @property {'undo'|'redo'} StackItemEvent.type added/updated 表示目标栈，popped 表示执行的操作。
 * @property {Map<YType,Array<YEvent<any>>>} StackItemEvent.changedParentTypes 捕获或反向操作事务的深层事件映射。
 */

/**
 * 监听文档事务并维护互为逆操作的 undo/redo 栈。
 *
 * 普通受跟踪事务进入 undo 栈并清空 redo 栈；undo 产生的事务由同一处理器捕获进 redo 栈，redo 则捕获回 undo 栈。`stack-item-added/updated` 可写入 `StackItem.meta`，`stack-item-popped` 可恢复这些元数据。
 *
 * 不变量：只处理同一 `doc` 上且命中 scope、captureTransaction、trackedOrigins 的事务；为可撤销删除设置 `Item.keep`，清栈时再解除。
 *
 * @extends {ObservableV2<{'stack-item-added':function(StackItemEvent, UndoManager):void, 'stack-item-popped': function(StackItemEvent, UndoManager):void, 'stack-cleared': function({ undoStackCleared: boolean, redoStackCleared: boolean }):void, 'stack-item-updated': function(StackItemEvent, UndoManager):void }>}
 */
export class UndoManager extends ObservableV2 {
  /**
   * 创建管理器并订阅文档 `afterTransaction` 与 `destroy`。
   *
   * 默认从第一个 scope 取得文档；空数组必须显式传入 `options.doc`，未集成的类型也不能提供有效文档。
   * `trackedOrigins` 使用调用方传入的 Set，构造时会把本管理器加入其中，销毁时再移除。捕获窗口只按时间合并普通事务，不要求它们具有相同 origin。
   *
   * @param {Doc|YType|Array<YType>} typeScope - Doc 表示全部变更；类型或类型数组仅覆盖它们及后代。
   * @param {UndoManagerOptions} options - 捕获、删除与冲突策略。
   */
  constructor (typeScope, {
    captureTimeout = 500,
    captureTransaction = _tr => true,
    deleteFilter = () => true,
    trackedOrigins = new Set([null]),
    ignoreRemoteAttributeChanges = false,
    doc = /** @type {Doc} */ (array.isArray(typeScope) ? typeScope[0].doc : typeScope instanceof Doc ? typeScope : typeScope.doc)
  } = {}) {
    super()
    /** 去重后的文档/类型作用域。
     * @type {Array<YType | Doc>} */
    this.scope = []
    /** 唯一被监听并承载撤销事务的文档。 */
    this.doc = doc
    this.addToScope(typeScope)
    /** 撤销/重做删除 Item 前的调用方过滤器。 */
    this.deleteFilter = deleteFilter
    trackedOrigins.add(this)
    /** 可捕获的 origin 实例或构造器；包含管理器自身以记录 undo/redo 的逆操作。 */
    this.trackedOrigins = trackedOrigins
    /** 事务级捕获门禁，在作用域与 origin 判断前执行。 */
    this.captureTransaction = captureTransaction
    /** 可撤销步骤，数组尾部为下一次 undo 候选。
     * @type {Array<StackItem>} */
    this.undoStack = []
    /** 可重做步骤，数组尾部为下一次 redo 候选。
     * @type {Array<StackItem>} */
    this.redoStack = []
    /** 当前是否正在执行 `undo()`；afterTransaction 据此把逆操作写入 redo 栈。
     * @type {boolean} */
    this.undoing = false
    /** 当前是否正在执行 `redo()`；afterTransaction 据此把逆操作写回 undo 栈。 */
    this.redoing = false
    /** 当前实际应用的栈项；从反向操作完成到 stack-item-popped 监听器返回期间可见。
     * @type {StackItem|null} */
    this.currStackItem = null
    /** 最近一次普通捕获的毫秒时间戳；零表示下一次必须新建栈项。 */
    this.lastChange = 0
    /** 属性重做是否可覆盖非撤销历史中的远端值。 */
    this.ignoreRemoteAttributeChanges = ignoreRemoteAttributeChanges
    /** 普通事务合并窗口，单位毫秒。 */
    this.captureTimeout = captureTimeout
    /**
     * 捕获命中策略的事务，合并或新建栈项，并固定作用域内的删除内容防止 GC。
     * 栈项记录整个事务的 insertSet/deleteSet；实际应用和 keep 固定时才逐项过滤 scope。
     *
     * @param {Transaction} transaction - 文档刚完成 observer 阶段的事务。
     */
    this.afterTransactionHandler = transaction => {
      // 三重门禁：自定义捕获条件、作用域命中、origin 实例或其构造器被跟踪。
      if (
        !this.captureTransaction(transaction) ||
        !this.scope.some(type => transaction.changedParentTypes.has(/** @type {YType} */ (type)) || type === this.doc) ||
        (!this.trackedOrigins.has(transaction.origin) && (!transaction.origin || !this.trackedOrigins.has(transaction.origin.constructor)))
      ) {
        return
      }
      const undoing = this.undoing
      const redoing = this.redoing
      const stack = undoing ? this.redoStack : this.undoStack
      if (undoing) {
        this.stopCapturing() // 连续 undo 生成的 redo 步骤必须各自独立，不能按时间合并。
      } else if (!redoing) {
        // 新的普通编辑使旧 redo 分支失效，同时解除其 keep 标记。
        this.clear(false, true)
      }
      const insertions = transaction.insertSet
      const now = time.getUnixTime()
      let didAdd = false
      if (this.lastChange > 0 && now - this.lastChange < this.captureTimeout && stack.length > 0 && !undoing && !redoing) {
        // 只合并时间窗口内的普通编辑；undo/redo 始终保持一项对应一步。
        const lastOp = stack[stack.length - 1]
        lastOp.deletes = mergeIdSets([lastOp.deletes, transaction.deleteSet])
        lastOp.inserts = mergeIdSets([lastOp.inserts, insertions])
      } else {
        // 超时、显式 stopCapturing 或 undo/redo 边界都会创建新栈项。
        stack.push(new StackItem(insertions, transaction.deleteSet))
        didAdd = true
      }
      if (!undoing && !redoing) {
        this.lastChange = now
      }
      // 栈项仍引用删除内容，沿父链设置 keep，确保以后能复制重做。
      iterateStructsByIdSet(transaction, transaction.deleteSet, /** @param {Item|GC} item */ item => {
        if (item instanceof Item && this.scope.some(type => type === transaction.doc || isParentOf(/** @type {YType} */ (type), item))) {
          keepItem(item, true)
        }
      })
      /**
       * @type {[StackItemEvent, UndoManager]}
       */
      const changeEvent = [{ stackItem: stack[stack.length - 1], origin: transaction.origin, type: undoing ? 'redo' : 'undo', changedParentTypes: transaction.changedParentTypes }, this]
      if (didAdd) {
        this.emit('stack-item-added', changeEvent)
      } else {
        this.emit('stack-item-updated', changeEvent)
      }
    }
    /** 绑定后的销毁方法引用；Doc 发出 destroy 时仍以本管理器为 this。 */
    this.destroy = this.destroy.bind(this)
    this.doc.on('afterTransaction', this.afterTransactionHandler)
    this.doc.on('destroy', this.destroy)
  }

  /**
   * 去重后扩展撤销作用域，并警告跨文档类型。
   *
   * 单个 UndoManager 的事务监听器只挂在 `doc` 上；跨文档 scope 无法提供正确语义，应改用 MultiDocUndoManager。
   *
   * @param {Array<YType | Doc> | YType | Doc} ytypes - 新增文档或类型。
   */
  addToScope (ytypes) {
    const tmpSet = new Set(this.scope)
    ytypes = array.isArray(ytypes) ? ytypes : [ytypes]
    ytypes.forEach(ytype => {
      if (!tmpSet.has(ytype)) {
        tmpSet.add(ytype)
        if (ytype instanceof YType ? ytype.doc !== this.doc : ytype !== this.doc) logging.warn('[yjs#509] Not same Y.Doc') // 应使用 MultiDocUndoManager；参见 issue #509。
        this.scope.push(ytype)
      }
    })
  }

  /**
   * 允许捕获给定 origin 实例或构造器。
   *
   * @param {any} origin - 待加入 trackedOrigins 的值。
   */
  addTrackedOrigin (origin) {
    this.trackedOrigins.add(origin)
  }

  /**
   * 停止捕获给定 origin；已存在栈项不受影响。
   *
   * @param {any} origin - 待移除值。
   */
  removeTrackedOrigin (origin) {
    this.trackedOrigins.delete(origin)
  }

  /**
   * 清空指定栈，并在事务中解除已删除 Item 的 keep 标记；不会立即扫描全部旧删除内容。
   * 两个待清栈都为空时直接返回，不创建事务也不发 `stack-cleared`；只要有候选，事件中的两个布尔值表示请求清除哪些栈。
   *
   * @param {boolean} clearUndoStack - 是否清空 undo 栈。
   * @param {boolean} clearRedoStack - 是否清空 redo 栈。
   */
  clear (clearUndoStack = true, clearRedoStack = true) {
    if ((clearUndoStack && this.canUndo()) || (clearRedoStack && this.canRedo())) {
      this.doc.transact(tr => {
        if (clearUndoStack) {
          this.undoStack.forEach(item => clearUndoManagerStackItem(tr, this, item))
          this.undoStack = []
        }
        if (clearRedoStack) {
          this.redoStack.forEach(item => clearUndoManagerStackItem(tr, this, item))
          this.redoStack = []
        }
        this.emit('stack-cleared', [{ undoStackCleared: clearUndoStack, redoStackCleared: clearRedoStack }])
      })
    }
  }

  /**
   * 重置 capture 时间戳，强制下一次受跟踪事务创建新栈项。
   *
   * 默认情况下，间隔小于 `captureTimeout` 的普通事务会合并。
   *
   *
   * @example
   *     // 未调用 stopCapturing：
   *     ytext.insert(0, 'a')
   *     ytext.insert(1, 'b')
   *     um.undo()
   *     ytext.toString() // => ''，`ab` 作为一个步骤被删除。
   *     // 调用 stopCapturing：
   *     ytext.insert(0, 'a')
   *     um.stopCapturing()
   *     ytext.insert(0, 'b')
   *     um.undo()
   *     ytext.toString() // => 'a'，只删除 `b`。
   *
   */
  stopCapturing () {
    this.lastChange = 0
  }

  /**
   * 撤销最近一个仍可应用的作用域内步骤，并在 finally 中恢复状态标志。
   * `popStackItem` 用本管理器作为事务 origin，捕获处理器据 `undoing` 将反向事务写入 redo 栈；无可应用项时返回 null，不能据一次调用推断只弹出了一个候选。
   *
   * @return {StackItem?} 实际产生变更的栈项；无步骤时为 `null`。
   */
  undo () {
    this.undoing = true
    let res
    try {
      res = popStackItem(this, this.undoStack, 'undo')
    } finally {
      this.undoing = false
    }
    return res
  }

  /**
   * 重做最近一次撤销，并在 finally 中恢复状态标志。
   * 反向事务以本管理器为 origin 重新进入 undo 栈；重做得到新结构 ID，旧 Item 的 `redone` 只在本地 store 中连接这些实例。
   *
   * @return {StackItem?} 实际产生变更的栈项；无步骤时为 `null`。
   */
  redo () {
    this.redoing = true
    let res
    try {
      res = popStackItem(this, this.redoStack, 'redo')
    } finally {
      this.redoing = false
    }
    return res
  }

  /**
   * 判断 undo 栈是否含候选项；候选可能因远端覆盖在应用时成为 no-op。
   *
   * @return {boolean} 栈非空时为 `true`。
   */
  canUndo () {
    return this.undoStack.length > 0
  }

  /**
   * 判断 redo 栈是否含候选项；候选可能因远端覆盖在应用时成为 no-op。
   *
   * @return {boolean} 栈非空时为 `true`。
   */
  canRedo () {
    return this.redoStack.length > 0
  }

  /** 注销事务/文档监听器、移除自身 origin 并销毁事件订阅；释放栈项的 keep 标记须先调用 clear()。 */
  destroy () {
    this.trackedOrigins.delete(this)
    this.doc.off('afterTransaction', this.afterTransactionHandler)
    this.doc.off('destroy', this.destroy)
    super.destroy()
  }
}

/**
 * 创建 UndoManager，把 ContentIds 转为单个撤销栈项并立即应用。
 * 此函数结束时不注销内部管理器，它仍监听文档的后续事务。
 *
 * @experimental 待恢复内容必须尚未被 GC；这里只反转 ID 集合，无法从 ID 补回已丢弃的载荷。
 *
 * @param {Doc} ydoc - 目标文档。
 * @param {ContentIds} contentIds - 要反转的插入/删除集合；交集会从两侧排除。
 * @param {UndoManagerOptions} opts - 内部 UndoManager 的选项。
 */
export const undoContentIds = (ydoc, contentIds, opts = {}) => {
  const um = new UndoManager(ydoc, opts)
  um.undoStack.push(new StackItem(diffIdSet(contentIds.inserts, contentIds.deletes), diffIdSet(contentIds.deletes, contentIds.inserts)))
  um.undo()
}

/**
 * 判断 ID 是否被栈中任一步骤登记为删除。
 *
 * @param {Array<StackItem>} stack - undo 或 redo 栈。
 * @param {ID} id - 待检查结构 ID。
 * @return {boolean} 任一删除集合命中时为 `true`。
 */
const isDeletedByUndoStack = (stack, id) => array.some(stack, /** @param {StackItem} s */ s => s.deletes.hasId(id))

/**
 * 复制一个已删除 Item，以当前 client 的新 ID 重新集成其内容，并用 `redone` 链连接原项。
 *
 * 父类型若也被删除，必须先恢复其父项或追到已有 redone 实例。序列项寻找属于当前父实例的左右邻居；只有父实例不匹配时才沿邻居的 redone 链继续。
 * 属性项按右侧版本是否将在本步骤删除、已 redone 或出现在任一撤销栈的 deletes 中判断能否越过；默认拒绝越过其余版本，不按 client ID 直接区分本地与远端。
 *
 * @param {Transaction} transaction - 接收新 Item 的事务。
 * @param {Item} item - 原始已删除 Item。
 * @param {Set<Item>} redoitems - 本步骤允许重做的删除项，用于递归父项判断。
 * @param {IdSet} itemsToDelete - 本步骤同时会删除的插入项。
 * @param {boolean} ignoreRemoteAttributeChanges - 是否允许覆盖远端属性值。
 * @param {import('../utils/UndoManager.js').UndoManager} um - 提供两栈冲突信息的管理器。
 *
 * @return {Item|null} 已存在或新建的 redone Item；父项不可恢复或属性冲突时为 `null`。
 *
 * @private
 */
export const redoItem = (transaction, item, redoitems, itemsToDelete, ignoreRemoteAttributeChanges, um) => {
  const doc = transaction.doc
  const store = doc.store
  const ownClientID = doc.clientID
  const redone = item.redone
  if (redone !== null) {
    return getItemCleanStart(transaction, redone)
  }
  let parentItem = /** @type {YType} */ (item.parent)._item
  /**
   * @type {Item|null}
   */
  let left = null
  /**
   * @type {Item|null}
   */
  let right
  // 子内容不能脱离父类型存在；父项在本次 redo 集合中时先递归恢复，并追到其最新 redone 实例。
  if (parentItem !== null && parentItem.deleted === true) {
    // 只有本步骤也计划恢复父项时才可递归；否则子项缺少合法挂载点。
    if (parentItem.redone === null && (!redoitems.has(parentItem) || redoItem(transaction, parentItem, redoitems, itemsToDelete, ignoreRemoteAttributeChanges, um) === null)) {
      return null
    }
    while (parentItem.redone !== null) {
      parentItem = getItemCleanStart(transaction, parentItem.redone)
    }
  }
  /**
   * @type {YType}
   */
  const parentType = /** @type {YType} */ (parentItem === null ? item.parent : /** @type {ContentType} */ (parentItem.content).type)

  if (item.parentSub === null) {
    // 序列项按原左右邻接关系恢复。
    left = item.left
    right = item
    // 左右邻居可能已被多次重做；沿 redone 链寻找属于当前父实例的克隆。
    while (left !== null) {
      /**
       * @type {Item|null}
       */
      let leftTrace = left
      // 追随左邻居的重做链，直到父实例匹配。
      while (leftTrace !== null && /** @type {YType} */ (leftTrace.parent)._item !== parentItem) {
        leftTrace = leftTrace.redone === null ? null : getItemCleanStart(transaction, leftTrace.redone)
      }
      if (leftTrace !== null && /** @type {YType} */ (leftTrace.parent)._item === parentItem) {
        left = leftTrace
        break
      }
      left = left.left
    }
    while (right !== null) {
      /**
       * @type {Item|null}
       */
      let rightTrace = right
      // 追随右邻居的重做链，直到父实例匹配。
      while (rightTrace !== null && /** @type {YType} */ (rightTrace.parent)._item !== parentItem) {
        rightTrace = rightTrace.redone === null ? null : getItemCleanStart(transaction, rightTrace.redone)
      }
      if (rightTrace !== null && /** @type {YType} */ (rightTrace.parent)._item === parentItem) {
        right = rightTrace
        break
      }
      right = right.right
    }
  } else {
    right = null
    if (item.right && !ignoreRemoteAttributeChanges) {
      left = item
      // 若右侧属性版本也将在本步骤删除、已被重做或仍属于任一撤销历史，则原值可越过它恢复；否则它代表应保护的远端更新。
      while (left !== null && left.right !== null && (left.right.redone || itemsToDelete.hasId(left.right.id) || isDeletedByUndoStack(um.undoStack, left.right.id) || isDeletedByUndoStack(um.redoStack, left.right.id))) {
        left = left.right
        // 始终比较该版本链的最新实例。
        while (left.redone) left = getItemCleanStart(transaction, left.redone)
      }
      if (left && left.right !== null) {
        // 右侧仍有未被以上条件涵盖的属性版本，默认拒绝越过；这里不检查该版本是否已删除。
        return null
      }
    } else {
      left = parentType._map.get(item.parentSub) || null
    }
    if (left !== null && /** @type {YType} */ (left.parent)._item !== parentItem) {
      left = parentType._map.get(item.parentSub) || null
    }
  }
  const nextClock = store.getClock(ownClientID)
  const nextId = createID(ownClientID, nextClock)
  const redoneItem = new Item(
    nextId,
    left, left && left.lastId,
    right, right && right.id,
    parentType,
    item.parentSub,
    item.content.copy()
  )
  item.redone = nextId
  keepItem(redoneItem, true)
  redoneItem.integrate(transaction, 0)
  return redoneItem
}

/**
 * 沿父 Item 链设置或清除临时 `keep` 标记，控制本地 GC 是否可回收撤销所需内容。
 *
 * 标记不写入 update，也不会发给其他 peer；它只控制当前文档实例的 GC。遇到已具目标值的 Item 即停止，因此不会重复遍历已固定或已解除的父链。
 *
 * @param {Item|null} item - 起始 Item。
 * @param {boolean} keep - `true` 固定，`false` 解除固定。
 */
export const keepItem = (item, keep) => {
  while (item !== null && item.keep !== keep) {
    item.keep = keep
    item = /** @type {YType} */ (item.parent)._item
  }
}
