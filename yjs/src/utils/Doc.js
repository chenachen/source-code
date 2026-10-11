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
 * @property {boolean} [DocOpts.gc=true] 是否允许回收已删除的内容；在内容尚未回收时关闭 GC，才能保留快照恢复所需的历史。
 * @property {function(Item):boolean} [DocOpts.gcFilter] 回收 `Item` 前的过滤器；返回 `false` 可保留该项。
 * @property {string} [DocOpts.guid] 跨客户端稳定的文档标识；同一子文档的各副本应共享该值。
 * @property {string | null} [DocOpts.collectionid] provider 支持集合概念时使用的集合标识。
 * @property {any} [DocOpts.meta] 随文档携带的元数据；子文档场景会同步给远端副本。
 * @property {boolean} [DocOpts.autoLoad] 子文档集成后是否由远端 provider 自动加载。
 * @property {boolean} [DocOpts.shouldLoad] provider 当前是否应同步该文档；调用 `load()` 后置为 `true`。
 * @property {boolean} [DocOpts.isSuggestionDoc] 是否把此 Doc 作为建议文档；启用后关闭自动格式清理，避免清理操作也成为建议。
 */

/**
 * `Doc` 生命周期与事务阶段事件表。
 *
 * 事务回调结束后先通知 observer，再回收与合并结构，随后编码 update 并处理子文档；observer 发起的新事务进入同一清理队列。
 *
 * @typedef {Object} DocEvents
 * @property {function(Doc):void} DocEvents.destroy - 根类型绑定已释放后、Doc 自身监听器清除前触发。
 * @property {function(Doc):void} DocEvents.load - 文档首次完成加载时触发。
 * @property {function(boolean, Doc):void} DocEvents.sync - provider 同步状态改变时触发。
 * @property {function(Uint8Array<ArrayBuffer>, any, Doc, Transaction):void} DocEvents.update - 事务清理生成 V1 更新后触发。
 * @property {function(Uint8Array<ArrayBuffer>, any, Doc, Transaction):void} DocEvents.updateV2 - 事务清理生成 V2 更新后触发。
 * @property {function(Doc):void} DocEvents.beforeAllTransactions - 一批最外层事务开始前触发。
 * @property {function(Transaction, Doc):void} DocEvents.beforeTransaction - 单个事务回调执行前触发。
 * @property {function(Transaction, Doc):void} DocEvents.beforeObserverCalls - 共享类型 observer 调用前触发。
 * @property {function(Transaction, Doc):void} DocEvents.afterTransaction - observer 完成、结构清理开始前触发。
 * @property {function(Transaction, Doc):void} DocEvents.afterTransactionCleanup - GC 与结构合并完成、update 编码开始前触发。
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
   * 构造时没有根类型或结构历史；`get()` 按需建立根类型，远端 update 也可建立同名根。
   * 内置监听器只把 provider 发出的 load/sync 映射成标志和 Promise，本构造器不建立网络连接。
   *
   * @param {DocOpts} opts - 文档配置。
   */
  constructor ({ guid = random.uuidv4(), collectionid = null, gc = true, gcFilter = () => true, meta = null, autoLoad = false, shouldLoad = true, isSuggestionDoc = false } = {}) {
    super()
    /** 是否允许在事务清理阶段回收已删除载荷；保留稳定 ID 不等于仍能恢复旧值。 */
    this.gc = gc
    /** GC 对未 keep 的已删除 Item 再调用此过滤器；返回 false 保留该项载荷。 */
    this.gcFilter = gcFilter
    /** 新写入的逻辑时钟空间；接收同 ID 的远端插入后，cleanup 可更换此值。 */
    this.clientID = generateNewClientId()
    /** 逻辑文档标识；同 guid 子文档可以是不同实例，此值不参与 Item 排序。 */
    this.guid = guid
    /** provider 使用的可选集合名，随 ContentDoc 配置传到远端壳实例。 */
    this.collectionid = collectionid
    /** 建议副本标志；初始化 cleanupFormatting 的默认值，不建立 renderer。 */
    this.isSuggestionDoc = isSuggestionDoc
    /** 是否自动清理冗余格式 Item；建议文档默认关闭，避免清理删除也成为建议。 */
    this.cleanupFormatting = !isSuggestionDoc
    /** 根键到已集成共享类型的映射；本地 `get()` 和远端 update 解码都会按根键取得此处的实例。
     * @type {Map<string, YType>} */
    this.share = new Map()
    /** 所有根/嵌套类型共用的结构仓库；client-clock 序与类型的 left/right 文档序是两套索引。 */
    this.store = new StructStore()
    /** 当前最外层事务；嵌套事务不得替换它。
     * @type {Transaction | null} */
    this._transaction = null
    /** 待按创建顺序清理的事务队列；observer 中的新事务追加到此处，避免在其写回调退出时立即嵌套清理。
     * 已完成项也留在当前数组里，最后一项完成后才整体替换为空数组；清理下一项使用递归调用。
     * @type {Array<Transaction>} */
    this._transactionCleanups = []
    /** 当前集成且未移除的子文档实例集合。
     * @type {Set<Doc>} */
    this.subdocs = new Set()
    /** 子文档被集成进父文档时指向承载它的 `Item`；顶层文档为 `null`。
     * @type {Item?} */
    this._item = null
    /** 当前加载意愿；load() 将它设为 true，provider 据此决定是否加载，不代表内容已同步。 */
    this.shouldLoad = shouldLoad
    /** 编码给远端子文档壳实例的自动加载策略。 */
    this.autoLoad = autoLoad
    /** 随子文档配置携带的用户元数据；核心结构排序与合并不解释它。 */
    this.meta = meta
    /** provider 已从持久层载入文档，或首次成功同步时为 `true`；是否触发取决于 provider 实现。
     * @type {boolean} */
    this.isLoaded = false
    /** 最近一次 sync 事件表示成功时为 true；网络同步与断线由 provider 判断，Doc 只更新此状态。 */
    this.isSynced = false
    /** destroy() 开始后为 true；资源释放状态，不属于网络同步内容。 */
    this.isDestroyed = false
    /** 首次 `load` 事件后兑现；成功 `sync` 也会补发首次 `load`，断线不会重建此 Promise。 */
    this.whenLoaded = promise.create(resolve => {
      this.on('load', () => {
        this.isLoaded = true
        resolve(this)
      })
    })
    /**
     * 创建等待下一次成功同步的 Promise，并在兑现时注销一次性监听器。
     *
     * 已同步状态转为未同步时需要新的等待周期，第一次已兑现的 Promise 无法表示再次同步。
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
    // 从已同步状态收到 `false` 才重建 whenSynced；首次成功同步（true 或无参）同时补发 load。
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
   * 把 shouldLoad 设为 true；若它是尚未请求加载的子文档，同时在父事务中登记 subdocsLoaded，供 provider 响应加载请求。
   *
   * `shouldLoad` 已为 `true` 时不会重复登记 loaded。独立调用时父事务的 subdocs 事件先触发，事务返回后才把此标志置为 true。
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

  /**
   * 返回 Doc 持有的当前子文档 Set，包含 guid 相同但实例不同的子文档。
   *
   * 返回内部集合而非副本；其 added/removed 维护由事务 cleanup 完成，查询同 guid 去重值使用 `getSubdocGuids()`。
   */
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
   * 回调中的嵌套调用复用活动事务，由最外层结束后统一清理。observer 中继续修改会创建后续事务，各事务分别通知并按需生成 update。
   * 写入立即生效且没有回滚；回调抛错仍进入最外层 finally 清理，再传播错误。此包装本身不调度异步任务。
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
   * `name` 只在第一次创建时使用，不会改变已存在类型的名字；根类型的存在本身不生成插入 Item 或 update。
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
   * 调用 `share` 中每个根类型的 `toJSON()`，递归序列化其内容与嵌套类型。
   *
   * 本地创建或由 update 解码创建的根类型都会出现；新代码应直接调用各共享类型的 `toJSON()`。
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
   * 释放根类型的 Renderer、Delta 缓存及事件订阅，销毁子文档，随后发出 Doc 的 `destroy` 并注销其监听器。
   *
   * `share`、store 和 CRDT 内容仍保留，嵌套类型的绑定及 observe/observeDeep 监听器不会被递归清除。
   * 子文档销毁不会删除父 `Item`：它会换入同 guid、`shouldLoad=false` 的新壳实例；父项仍存活时发布 added，并始终发布旧实例的 removed。
   */
  destroy () {
    this.isDestroyed = true
    // 这里只释放根类型的绑定层；YType.destroy 不递归访问嵌套类型，也不删除共享内容。
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
