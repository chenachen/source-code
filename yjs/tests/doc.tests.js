import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * 验证包含 15,000 个子类型的事务在 `afterTransaction` 中读取 JSON 时不会递归溢出。
 *
 * Given：单一事务批量插入大量节点，observer 在 cleanup 阶段读文档。
 * When：最外层事务结束并触发 `afterTransaction`。
 * Then：读取完成且 cleanup 不形成嵌套递归。
 *
 * 验证机制：该调用直接覆盖 `transact → cleanupTransactions → afterTransaction` 大批量路径。
 *
 * @param {t.TestCase} _tc
 */
export const testAfterTransactionRecursion = _tc => {
  const ydoc = new Y.Doc()
  const yxml = ydoc.get('')
  ydoc.on('afterTransaction', tr => {
    if (tr.origin === 'test') {
      yxml.toJSON()
    }
  })
  ydoc.transact(_tr => {
    for (let i = 0; i < 15000; i++) {
      yxml.push([new Y.Type('a')])
    }
  }, 'test')
}

/**
 * 验证根类型可按 share 键、嵌套类型可按承载 Item ID 在同步副本中定位。
 *
 * @param {t.TestCase} _tc
 */
export const testFindTypeInOtherDoc = _tc => {
  const ydoc = new Y.Doc()
  const ymap = ydoc.get()
  const ytext = ymap.setAttr('ytext', new Y.Type())
  const ydocClone = new Y.Doc()
  Y.applyUpdate(ydocClone, Y.encodeStateAsUpdate(ydoc))
  /**
   * 在另一个同步文档中定位同一逻辑类型。
   *
   * @param {Y.Type} ytype - 来源类型。
   * @param {Y.Doc} otherYdoc - 目标同步副本。
   * @return {Y.Type} 目标副本中的对应类型。
   */
  const findTypeInOtherYdoc = (ytype, otherYdoc) => {
    const ydoc = /** @type {Y.Doc} */ (ytype.doc)
    if (ytype._item === null) {
      /** 根类型没有承载 Item，必须先在来源 share 中反查根键，再由目标文档 `get()` 取得。 */
      const rootKey = Array.from(ydoc.share.keys()).find(
        (key) => ydoc.share.get(key) === ytype
      )
      if (rootKey == null) {
        throw new Error('type does not exist in other ydoc')
      }
      return otherYdoc.get(rootKey)
    } else {
      /** 嵌套类型由稳定 Item ID 定位目标结构，再从 `ContentType` 取出对应类型。 */
      const ytypeItem = ytype._item
      const otherStructs = otherYdoc.store.clients.get(ytypeItem.id.client) ?? []
      const itemIndex = Y.findIndexSS(
        otherStructs,
        ytypeItem.id.clock
      )
      const otherItem = /** @type {Y.Item} */ (otherStructs[itemIndex])
      const otherContent = /** @type {Y.ContentType} */ (otherItem.content)
      return /** @type {Y.Type} */ (otherContent.type)
    }
  }
  t.assert(findTypeInOtherYdoc(ymap, ydocClone) != null)
  t.assert(findTypeInOtherYdoc(ytext, ydocClone) != null)
}

/**
 * 验证文档收到同 clientID 的远端结构时会更换自身 clientID，避免后续本地 clock 冲突。
 *
 * Given：两个文档被强制设置相同 clientID。
 * When：第二个文档应用第一个文档的 update。
 * Then：cleanup 检测远端 insertSet 命中自身 clientID，并生成新 ID。
 *
 * @param {t.TestCase} _tc
 */
export const testClientIdDuplicateChange = _tc => {
  const doc1 = new Y.Doc()
  doc1.clientID = 0
  const doc2 = new Y.Doc()
  doc2.clientID = 0
  t.assert(doc2.clientID === doc1.clientID)
  doc1.get('a').insert(0, [1, 2])
  Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1))
  t.assert(doc2.clientID !== doc1.clientID)
}

/**
 * 验证空字符串根键与无参 `get()` 指向同一根类型，并能跨 update 保持一致。
 *
 * @param {t.TestCase} _tc
 */
export const testGetTypeEmptyId = _tc => {
  const doc1 = new Y.Doc()
  doc1.get('').insert(0, 'h')
  doc1.get().insert(1, 'i')
  const doc2 = new Y.Doc()
  Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1))
  t.assert(doc2.get().toString() === 'hi')
  t.assert(doc2.get('').toString() === 'hi')
}

/**
 * 验证 `Doc.toJSON()` 只序列化已定义根类型，并递归包含嵌套属性类型。
 *
 * @param {t.TestCase} _tc
 */
export const testToJSON = _tc => {
  const doc = new Y.Doc()
  t.compare(doc.toJSON(), {}, 'doc.toJSON yields empty object')

  const arr = doc.get('array')
  arr.push(['test1'])

  const map = doc.get('map')
  map.setAttr('k1', 'v1')
  const map2 = new Y.Type()
  map.setAttr('k2', map2)
  map2.setAttr('m2k1', 'm2v1')
  t.compare(doc.toJSON(), {
    array: { children: ['test1'] },
    map: {
      attrs: {
        k1: 'v1',
        k2: {
          attrs: {
            m2k1: 'm2v1'
          }
        }
      }
    }
  }, 'doc.toJSON has array and recursive map')
}

/**
 * 验证子文档 added/loaded/removed 生命周期、同 guid 去重查询及远端同步后的显式加载。
 *
 * Given：父文档包含多个子文档，其中两个共享 guid。
 * When：依次集成、重复 load、destroy、远端 applyUpdate 与删除属性。
 * Then：每次 `subdocs` 事件集合只反映本事务状态，`getSubdocGuids()` 按 guid 去重。
 *
 * 验证机制：同时断言事件三集合与文档维护集合，覆盖事务 cleanup 的子文档分支。
 *
 * @param {t.TestCase} _tc
 */
export const testSubdoc = _tc => {
  const doc = new Y.Doc()
  doc.load() // 顶层文档没有父 Item，不产生 subdocs 事件。
  {
    /**
     * @type {Array<any>|null}
     */
    let event = /** @type {any} */ (null)
    doc.on('subdocs', subdocs => {
      event = [Array.from(subdocs.added).map(x => x.guid), Array.from(subdocs.removed).map(x => x.guid), Array.from(subdocs.loaded).map(x => x.guid)]
    })
    const subdocs = doc.get('mysubdocs')
    const docA = new Y.Doc({ guid: 'a' })
    docA.load()
    subdocs.setAttr('a', docA)
    t.compare(event, [['a'], [], ['a']])

    event = null
    subdocs.getAttr('a').load()
    t.assert(event === null)

    event = null
    subdocs.getAttr('a').destroy()
    t.compare(event, [['a'], ['a'], []])
    subdocs.getAttr('a').load()
    t.compare(event, [[], [], ['a']])

    subdocs.setAttr('b', new Y.Doc({ guid: 'a', shouldLoad: false }))
    t.compare(event, [['a'], [], []])
    subdocs.getAttr('b').load()
    t.compare(event, [[], [], ['a']])

    const docC = new Y.Doc({ guid: 'c' })
    docC.load()
    subdocs.setAttr('c', docC)
    t.compare(event, [['c'], [], ['c']])

    t.compare(Array.from(doc.getSubdocGuids()), ['a', 'c'])
  }

  const doc2 = new Y.Doc()
  {
    t.compare(Array.from(doc2.getSubdocs()), [])
    /**
     * @type {Array<any>|null}
     */
    let event = /** @type {any} */ (null)
    doc2.on('subdocs', subdocs => {
      event = [Array.from(subdocs.added).map(d => d.guid), Array.from(subdocs.removed).map(d => d.guid), Array.from(subdocs.loaded).map(d => d.guid)]
    })
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc))
    t.compare(event, [['a', 'a', 'c'], [], []])

    doc2.get('mysubdocs').getAttr('a').load()
    t.compare(event, [[], [], ['a']])

    t.compare(Array.from(doc2.getSubdocGuids()), ['a', 'c'])

    doc2.get('mysubdocs').deleteAttr('a')
    t.compare(event, [[], ['a'], []])
    t.compare(Array.from(doc2.getSubdocGuids()), ['a', 'c'])
  }
}

/**
 * 验证非 autoLoad 子文档在销毁替换、显式加载和远端集成时的 shouldLoad/事件边界。
 *
 * @param {t.TestCase} _tc
 */
export const testSubdocLoadEdgeCases = _tc => {
  const ydoc = new Y.Doc()
  const yarray = ydoc.get()
  const subdoc1 = new Y.Doc()
  /**
   * @type {any}
   */
  let lastEvent = null
  ydoc.on('subdocs', event => {
    lastEvent = event
  })
  yarray.insert(0, [subdoc1])
  t.assert(subdoc1.shouldLoad)
  t.assert(subdoc1.autoLoad === false)
  t.assert(lastEvent !== null && lastEvent.loaded.has(subdoc1))
  t.assert(lastEvent !== null && lastEvent.added.has(subdoc1))
  // destroy 会换入新壳实例，但不得把旧实例再次计入 added。
  subdoc1.destroy()
  const subdoc2 = yarray.get(0)
  t.assert(subdoc1 !== subdoc2)
  t.assert(lastEvent !== null && lastEvent.added.has(subdoc2))
  t.assert(lastEvent !== null && !lastEvent.loaded.has(subdoc2))
  // 显式 load 只进入 loaded，不重复进入 added。
  subdoc2.load()
  t.assert(lastEvent !== null && !lastEvent.added.has(subdoc2))
  t.assert(lastEvent !== null && lastEvent.loaded.has(subdoc2))
  // 远端集成默认 shouldLoad=false，不自动进入 loaded。
  const ydoc2 = new Y.Doc()
  ydoc2.on('subdocs', event => {
    lastEvent = event
  })
  Y.applyUpdate(ydoc2, Y.encodeStateAsUpdate(ydoc))
  const subdoc3 = ydoc2.get().get(0)
  t.assert(subdoc3.shouldLoad === false)
  t.assert(subdoc3.autoLoad === false)
  t.assert(lastEvent !== null && lastEvent.added.has(subdoc3))
  t.assert(lastEvent !== null && !lastEvent.loaded.has(subdoc3))
  // 远端壳实例显式 load 后才进入 loaded。
  subdoc3.load()
  t.assert(subdoc3.shouldLoad)
  t.assert(lastEvent !== null && !lastEvent.added.has(subdoc3))
  t.assert(lastEvent !== null && lastEvent.loaded.has(subdoc3))
}

/**
 * 验证 autoLoad 子文档在本地集成和远端同步后都会自动登记 loaded。
 *
 * @param {t.TestCase} _tc
 */
export const testSubdocLoadEdgeCasesAutoload = _tc => {
  const ydoc = new Y.Doc()
  const yarray = ydoc.get()
  const subdoc1 = new Y.Doc({ autoLoad: true })
  /**
   * @type {any}
   */
  let lastEvent = null
  ydoc.on('subdocs', event => {
    lastEvent = event
  })
  yarray.insert(0, [subdoc1])
  t.assert(subdoc1.shouldLoad)
  t.assert(subdoc1.autoLoad)
  t.assert(lastEvent !== null && lastEvent.loaded.has(subdoc1))
  t.assert(lastEvent !== null && lastEvent.added.has(subdoc1))
  // destroy 换入新壳，但旧实例不重复计入 added。
  subdoc1.destroy()
  const subdoc2 = yarray.get(0)
  t.assert(subdoc1 !== subdoc2)
  t.assert(lastEvent !== null && lastEvent.added.has(subdoc2))
  t.assert(lastEvent !== null && !lastEvent.loaded.has(subdoc2))
  // 显式加载替换壳只产生 loaded。
  subdoc2.load()
  t.assert(lastEvent !== null && !lastEvent.added.has(subdoc2))
  t.assert(lastEvent !== null && lastEvent.loaded.has(subdoc2))
  // autoLoad 选项随子文档同步，远端集成立即进入 loaded。
  const ydoc2 = new Y.Doc()
  ydoc2.on('subdocs', event => {
    lastEvent = event
  })
  Y.applyUpdate(ydoc2, Y.encodeStateAsUpdate(ydoc))
  const subdoc3 = ydoc2.get().get(0)
  t.assert(subdoc1.shouldLoad)
  t.assert(subdoc1.autoLoad)
  t.assert(lastEvent !== null && lastEvent.added.has(subdoc3))
  t.assert(lastEvent !== null && lastEvent.loaded.has(subdoc3))
}

/**
 * 验证 UndoManager 能撤销并重做承载子文档的 Item，恢复序列长度。
 *
 * @param {t.TestCase} _tc
 */
export const testSubdocsUndo = _tc => {
  const ydoc = new Y.Doc()
  const elems = ydoc.get()
  const undoManager = new Y.UndoManager(elems)
  const subdoc = new Y.Doc()
  // @ts-ignore
  elems.insert(0, [subdoc])
  undoManager.undo()
  undoManager.redo()
  t.assert(elems.length === 1)
}

/**
 * 验证 `load` 事件同步更新 `isLoaded` 并兑现一次性的 `whenLoaded`。
 *
 * @param {t.TestCase} _tc
 */
export const testLoadDocsEvent = async _tc => {
  const ydoc = new Y.Doc()
  t.assert(ydoc.isLoaded === false)
  let loadedEvent = false
  ydoc.on('load', () => {
    loadedEvent = true
  })
  ydoc.emit('load', [ydoc])
  await ydoc.whenLoaded
  t.assert(loadedEvent)
  t.assert(ydoc.isLoaded)
}

/**
 * 验证成功 sync 会补发首次 load 并兑现 Promise，断线只重建 `whenSynced` 而不重置 loaded。
 *
 * Given：新文档尚未 load/sync。
 * When：先发 `sync(true)`，再发 `sync(false)`。
 * Then：首次同步同时置 loaded/synced；断线保留 loaded、清除 synced，并替换等待下一周期的 Promise。
 *
 * 验证机制：事件计数、布尔状态与 Promise 身份共同证明状态迁移。
 *
 * @param {t.TestCase} _tc
 */
export const testSyncDocsEvent = async _tc => {
  const ydoc = new Y.Doc()
  t.assert(ydoc.isLoaded === false)
  t.assert(ydoc.isSynced === false)
  let loadedEvent = false
  ydoc.once('load', () => {
    loadedEvent = true
  })
  let syncedEvent = false
  ydoc.once('sync', /** @param {any} isSynced */ (isSynced) => {
    syncedEvent = true
    t.assert(isSynced)
  })
  ydoc.emit('sync', [true, ydoc])
  await ydoc.whenLoaded
  const oldWhenSynced = ydoc.whenSynced
  await ydoc.whenSynced
  t.assert(loadedEvent)
  t.assert(syncedEvent)
  t.assert(ydoc.isLoaded)
  t.assert(ydoc.isSynced)
  let loadedEvent2 = false
  ydoc.on('load', () => {
    loadedEvent2 = true
  })
  let syncedEvent2 = false
  ydoc.on('sync', (isSynced) => {
    syncedEvent2 = true
    t.assert(isSynced === false)
  })
  ydoc.emit('sync', [false, ydoc])
  t.assert(!loadedEvent2)
  t.assert(syncedEvent2)
  t.assert(ydoc.isLoaded)
  t.assert(!ydoc.isSynced)
  t.assert(ydoc.whenSynced !== oldWhenSynced)
}
