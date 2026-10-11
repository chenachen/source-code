import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * 测试场景：空根类型，并注册仅处理 origin=test 的 afterTransaction 监听器。
 * 触发操作：一个事务插入 15,000 个同级 a 子类型，完成后监听器读取整棵 JSON。
 * 预期结果：调用完成且不抛异常；没有显式断言，覆盖宽列表的序列化，不是 15,000 层嵌套。
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
 * 测试场景：文档根类型带一个 ytext 嵌套属性类型，完整 update 已同步到另一文档。
 * 触发操作：根类型按 share 键查找，嵌套类型按承载 Item 的 client/clock 查找对应 ContentType。
 * 预期结果：两次查找均非 null；用例没有比较对象身份或内部内容。
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
 * 测试场景：两个空文档的 clientID 都强制为 0。
 * 触发操作：第一份在根 a 插入 [1,2]，第二份应用它的完整 update。
 * 预期结果：应用前 clientID 相同，清理后第二份 clientID 与第一份不同。
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
 * 测试场景：第一份文档在空字符串根键写 h，再由无参 get() 写 i。
 * 触发操作：把完整 update 应用到第二份文档，分别以无参和空字符串 get 读取。
 * 预期结果：两种读取均为 hi；断言检查内容，没有直接比较类型实例身份。
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
 * 测试场景：空文档先序列化为 {}。
 * 触发操作：在 array 根放入元素 test1，并创建带 k1 和嵌套 k2/m2k1 的 map 根。
 * 预期结果：精确比较包含两个根、children 与递归 attrs 的 JSON。
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
 * 测试场景：父文档管理属性中的子文档，并记录 added/removed/loaded 三集合。
 * 触发操作：依次插入、重复 load、destroy 替换、加载新壳，再加入同 guid=a 的第二实例和 guid=c；完整同步后显式加载与删除其中一个 a。
 * 预期结果：重复 load 不发事件；destroy 同时移除旧实例并加入未加载新壳；远端初次加入三个实例但不加载，guid 查询去重，删除一个 a 后另一个 a 仍存在。
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
 * 测试场景：父文档的序列插入默认 autoLoad=false 子文档。
 * 触发操作：销毁并加载替换壳，然后同步到远端，再显式加载远端实例。
 * 预期结果：本地初次插入 added+loaded；替换壳进入 added、不进入 loaded（本例未断言 removed）；显式 load 不再 added 而进入 loaded；远端初次 shouldLoad=false 且未 loaded，显式 load 后才为 true 并登记 loaded。
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
 * 测试场景：父文档序列插入 autoLoad=true 子文档。
 * 触发操作：销毁并显式加载替换壳，再同步到第二份文档。
 * 预期结果：本地替换壳仍需 load；远端集成同时 added+loaded。最后 shouldLoad/autoLoad 断言读的是原 subdoc1，远端自动加载由事件集合验证。
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
 * 测试场景：空序列已安装 UndoManager。
 * 触发操作：插入一个 Doc，依次 undo 和 redo。
 * 预期结果：最终序列长度为 1；未断言撤销中间长度、恢复实例身份或子文档内部内容。
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
 * 测试场景：新 Doc 的 isLoaded=false，并注册 load 监听器。
 * 触发操作：手动 emit(load)，等待 whenLoaded。
 * 预期结果：监听器已触发且 isLoaded=true；没有连接实际 provider。
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
 * 测试场景：新 Doc 的 loaded/synced 均为 false，并监听首次 load/sync。
 * 触发操作：手动 emit sync(true) 并等待两个 Promise，然后监听后续事件并 emit sync(false)。
 * 预期结果：首次同步补发 load；断线仅置 synced=false、替换 whenSynced，loaded 保持 true 且不再发 load；未执行再次同步。
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
