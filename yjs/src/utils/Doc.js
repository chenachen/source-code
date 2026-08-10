/**
 * @module Y
 */

import { ObservableV2 } from 'lib0/observable'
import * as random from 'lib0/random'
import * as map from 'lib0/map'
import * as array from 'lib0/array'
import * as promise from 'lib0/promise'

import { StructStore } from './StructStore.js'
import { transact, generateNewClientId } from './Transaction.js'
import { YType } from '../ytype.js'
import { $ydoc } from './schemas.js'

/**
 * 文档构造选项。
 *
 * @typedef {Object} DocOpts
 * @property {boolean} [DocOpts.gc=true] 是否允许回收已删除的结构；关闭后才能从任意历史快照恢复内容。
 * @property {function(Item):boolean} [DocOpts.gcFilter] 回收 `Item` 前的过滤器；返回 `false` 可保留该项。
 * @property {string} [DocOpts.guid] 跨客户端稳定的文档标识；同一子文档的各副本应共享该值。
 * @property {string | null} [DocOpts.collectionid] provider 支持集合概念时使用的集合标识。
 * @property {any} [DocOpts.meta] 随文档携带的元数据；子文档场景会同步给远端副本。
 * @property {boolean} [DocOpts.autoLoad] 子文档集成后是否由远端 provider 自动加载。
 * @property {boolean} [DocOpts.shouldLoad] provider 当前是否应同步该文档；调用 `load()` 后置为 `true`。
 * @property {boolean} [DocOpts.isSuggestionDoc] 是否把本文件视为建议文档。建议文档若未设置该标志，自动格式清理也可能被显示为建议。
 */

/**
 * `Doc` 生命周期与事务阶段事件表。
 *
 * WHY：事务清理按此顺序暴露阶段钩子，使 observer、update 编码和 provider 能共享同一批次边界。
 *
 * @typedef {Object} DocEvents
 * @property {function(Doc):void} DocEvents.destroy - 文档销毁且绑定即将解除时触发。
 * @property {function(Doc):void} DocEvents.load - 文档首次完成加载时触发。
 * @property {function(boolean, Doc):void} DocEvents.sync - provider 同步状态改变时触发。
 * @property {function(Uint8Array<ArrayBuffer>, any, Doc, Transaction):void} DocEvents.update - 事务清理生成 V1 更新后触发。
 * @property {function(Uint8Array<ArrayBuffer>, any, Doc, Transaction):void} DocEvents.updateV2 - 事务清理生成 V2 更新后触发。
 * @property {function(Doc):void} DocEvents.beforeAllTransactions - 一批最外层事务开始前触发。
 * @property {function(Transaction, Doc):void} DocEvents.beforeTransaction - 单个事务回调执行前触发。
 * @property {function(Transaction, Doc):void} DocEvents.beforeObserverCalls - 共享类型 observer 调用前触发。
 * @property {function(Transaction, Doc):void} DocEvents.afterTransaction - observer 完成、结构清理开始前触发。
 * @property {function(Transaction, Doc):void} DocEvents.afterTransactionCleanup - GC、结构合并与更新编码完成后触发。
 * @property {function(Doc, Array<Transaction>):void} DocEvents.afterAllTransactions - 清理队列中全部事务完成后触发。
 * @property {function({ loaded: Set<Doc>, added: Set<Doc>, removed: Set<Doc> }, Doc, Transaction):void} DocEvents.subdocs - 发布本事务的子文档加载、添加与移除集合。
 */

/**
 * 持有一份 Yjs 共享数据状态及其事务、子文档和 provider 生命周期。
 *
 * 不变量：任一时刻至多有一个活动中的 `_transaction`；嵌套 `transact` 复用它，最外层返回后统一清理并通知 observer。
 * `guid` 标识逻辑文档，`clientID` 标识当前写入者；两者用途不可互换。
 *
 * @extends ObservableV2<DocEvents>
 */
export class Doc extends ObservableV2 {
  /**
   * 创建空文档并安装 load/sync 生命周期监听器。
   *
   * @param {DocOpts} opts - 文档配置。
   */
  constructor ({ guid = random.uuidv4(), collectionid = null, gc = true, gcFilter = () => true, meta = null, autoLoad = false, shouldLoad = true, isSuggestionDoc = false } = {}) {
    super()
    this.gc = gc
    this.gcFilter = gcFilter
    this.clientID = generateNewClientId()
    this.guid = guid
    this.collectionid = collectionid
    this.isSuggestionDoc = isSuggestionDoc
    this.cleanupFormatting = !isSuggestionDoc
    /** 根类型名到共享类型实例的唯一映射；同名 `get()` 必须返回同一对象。
     * @type {Map<string, YType>} */
    this.share = new Map()
    this.store = new StructStore()
    /** 当前最外层事务；嵌套事务不得替换它。
     * @type {Transaction | null} */
    this._transaction = null
    /** 待按创建顺序清理的事务队列；observer 中产生的新事务也追加到此处，避免递归清理。
     * @type {Array<Transaction>} */
    this._transactionCleanups = []
    /** 当前集成且未移除的子文档实例集合。
     * @type {Set<Doc>} */
    this.subdocs = new Set()
    /** 子文档被集成进父文档时指向承载它的 `Item`；顶层文档为 `null`。
     * @type {Item?} */
    this._item = null
    this.shouldLoad = shouldLoad
    this.autoLoad = autoLoad
    this.meta = meta
    /** provider 已从持久层载入文档，或首次成功同步时为 `true`；是否触发取决于 provider 实现。
     * @type {boolean} */
    this.isLoaded = false
    /** provider 已与后端完成同步时为 `true`。断线时 provider 应以 `false` 触发 `sync`；P2P 或未实现该事件的 provider 中语义较弱。 */
    this.isSynced = false
    this.isDestroyed = false
    /** 文档首次完成持久层加载后兑现；与 `whenSynced` 不同，断线不会重建。 */
    this.whenLoaded = promise.create(resolve => {
      this.on('load', () => {
        this.isLoaded = true
        resolve(this)
      })
    })
    /**
     * 创建等待下一次成功同步的 Promise，并在兑现时注销一次性监听器。
     *
     * WHY：断线会产生新的等待周期，不能永久复用第一次同步时已兑现的 Promise。
     */
    const provideSyncedPromise = () => promise.create(resolve => {
      /**
       * 在 provider 报告成功同步时兑现当前等待周期；`undefined` 兼容旧 provider 的无参事件。
       *
       * @param {boolean} isSynced - provider 报告的连接同步状态。
       */
      const eventHandler = (isSynced) => {
        if (isSynced === undefined || isSynced === true) {
          this.off('sync', eventHandler)
          resolve()
        }
      }
      this.on('sync', eventHandler)
    })
    // 状态迁移：`false` 会重建 whenSynced；首次 `true` 同时补发 load，保证只实现 sync 的 provider 也能结束加载等待。
    this.on('sync', isSynced => {
      if (isSynced === false && this.isSynced) {
        this.whenSynced = provideSyncedPromise()
      }
      this.isSynced = isSynced === undefined || isSynced === true
      if (this.isSynced && !this.isLoaded) {
        this.emit('load', [this])
      }
    })
    /** 等待当前连接周期首次同步成功的 Promise；连接丢失后替换为新的 Promise。 */
    this.whenSynced = provideSyncedPromise()
  }

  /**
   * 请求 provider 加载此文档；若它是尚未请求加载的子文档，同时在父文档事务中登记 `subdocsLoaded`。
   *
   * 不变量：方法幂等；`shouldLoad` 已为 `true` 时不会重复产生子文档事件。
   */
  load () {
    const item = this._item
    if (item !== null && !this.shouldLoad) {
      transact(/** @type {any} */ (item.parent).doc, transaction => {
        transaction.subdocsLoaded.add(this)
      }, null, true)
    }
    this.shouldLoad = true
  }

  /** 返回当前子文档集合；集合由事务 cleanup 根据 added/removed 集合维护。 */
  getSubdocs () {
    return this.subdocs
  }

  /** 返回当前子文档逻辑标识的去重副本，不暴露内部实例集合。 */
  getSubdocGuids () {
    return new Set(array.from(this.subdocs).map(doc => doc.guid))
  }

  /**
   * 在一个事务边界内执行修改，并把 observer 通知与网络 update 合并到最外层事务结束之后。
   *
   * 嵌套调用复用活动事务；只有最外层调用负责 cleanup，因此同一批修改只生成一组通知和 update。
   *
   * @template T
   * @param {function(Transaction):T} f - 在事务中执行的函数。
   * @param {any} [origin] - 发起方标识，原样保存在 `transaction.origin`，可供 UndoManager/provider 过滤。
   * @param {boolean} [local] - 是否由本地文档发起。
   * @return T 回调返回值。
   */
  transact (f, origin = null, local = true) {
    return transact(this, f, origin, local)
  }

  /**
   * 按根键取得或惰性创建共享类型。
   *
   * 不变量：同一 `key` 始终对应同一已集成实例，即 `ydoc.get(key) === ydoc.get(key)`；创建后同步写入 `share`。
   *
   * @param {string} key - 根类型键。
   * @param {string?} name - 新建类型使用的可选类型名。
   *
   * @return {YType}
   */
  get (key = '', name = null) {
    return map.setIfUndefined(this.share, key, () => {
      const t = new YType(name)
      t._integrate(this, null)
      return t
    })
  }

  /**
   * 递归序列化已经通过 `get()` 定义的所有根类型。
   *
   * 未创建的根类型不会出现在结果中；新代码应直接调用各共享类型的 `toJSON()`。
   *
   * @deprecated 请直接在共享类型上调用 `toJSON()`。
   *
   * @return {Object<string, any>}
   */
  toJSON () {
    /**
     * @type {Object<string, any>}
     */
    const doc = {}
    this.share.forEach((value, key) => {
      doc[key] = value.toJSON()
    })
    return doc
  }

  /**
   * 销毁顶层共享类型和子文档，发出 `destroy`，并注销本 Doc 的全部事件监听器。
   *
   * 子文档销毁不会删除父 `Item`：它会换入同 guid、`shouldLoad=false` 的新壳实例，并在父事务中发布 removed/added 状态。
   */
  destroy () {
    this.isDestroyed = true
    // 只销毁顶层共享类型并触发其 `destroy`，让绑定解除订阅；嵌套类型由所属顶层类型管理，不在此递归。
    this.share.forEach(type => type.destroy())
    array.from(this.subdocs).forEach(subdoc => subdoc.destroy())
    const item = this._item
    if (item !== null) {
      this._item = null
      const content = /** @type {ContentDoc} */ (item.content)
      /** 替换已销毁子文档的空壳；保留 guid 和内容选项，使父结构仍可在以后重新加载同一逻辑文档。 */
      const contentDoc = new Doc({ guid: this.guid, ...content.opts, shouldLoad: false })
      content.doc = contentDoc
      contentDoc._item = item
      transact(/** @type {any} */ (item).parent.doc, transaction => {
        if (!item.deleted) {
          transaction.subdocsAdded.add(contentDoc)
        }
        transaction.subdocsRemoved.add(this)
      }, null, true)
    }
    this.emit('destroy', [this])
    super.destroy()
  }
}

Doc.prototype.$type = $ydoc
