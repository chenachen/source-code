/**
 * 本文件验证 attribution/RDT 行为及编解码、集成兼容性。
 *
 * 即使集成算法升级或增加编码方案，同一更新历史的可见文档也必须保持一致。V1 兼容样本由 Yjs v13.2.0 随机测试生成。
 */

import * as Y from '../src/index.js'
import * as t from 'lib0/testing'
import * as delta from 'lib0/delta'
import * as prng from 'lib0/prng'
import * as math from 'lib0/math'
import { bind, $rdt } from 'lib0/delta/rdt'
import { init } from './testHelper.js' // eslint-disable-line

/**
 * 验证同一相对位置按 DiffRenderer 可见内容解析为建议视图索引，而基础视图解析为文档存活索引。
 *
 * @param {t.TestCase} _tc
 */
export const testRelativePositions = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  ytext.insert(0, 'hello world')
  const v1 = Y.cloneDoc(ydoc)
  ytext.delete(1, 6)
  ytext.insert(1, 'x')
  const renderer = Y.createDiffRenderer(v1, ydoc)
  const rel = Y.createRelativePositionFromTypeIndex(ytext, 9, 1, renderer) // DiffRenderer 视图中位于 `hello wo` 之后。
  const abs1 = Y.createAbsolutePositionFromRelativePosition(rel, ydoc, true, renderer)
  const abs2 = Y.createAbsolutePositionFromRelativePosition(rel, ydoc, true)
  t.assert(abs1?.index === 9)
  t.assert(abs2?.index === 3)
}

/**
 * 验证 observer 的 `getDelta({ renderer })` 为新插入内容附上 DiffRenderer 的 insert attribution。
 *
 * @param {t.TestCase} _tc
 */
export const testAttributedEvents = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  ytext.insert(0, 'hello world')
  const v1 = Y.cloneDoc(ydoc)
  ydoc.transact(() => {
    ytext.delete(6, 5)
  })
  const renderer = Y.createDiffRenderer(v1, ydoc)
  const c1 = ytext.toDelta({ renderer })
  t.compare(c1, delta.create().insert('hello ').insert('world', null, { delete: [] }).done())
  let calledObserver = false
  ytext.observe(event => {
    const d = event.getDelta({ renderer })
    t.compare(d, delta.create().retain(11).insert('!', null, { insert: [] }).done())
    calledObserver = true
  })
  ytext.applyDelta(delta.create().retain(11).insert('!').done(), null, { renderer })
  t.assert(calledObserver)
}

/**
 * 验证在 renderer 恢复显示的建议删除内容之后插入时，applyDelta 的可见索引正确映射到底层文档。
 *
 * @param {t.TestCase} _tc
 */
export const testInsertionsMindingAttributedContent = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  ytext.insert(0, 'hello world')
  const v1 = Y.cloneDoc(ydoc)
  ydoc.transact(() => {
    ytext.delete(6, 5)
  })
  const renderer = Y.createDiffRenderer(v1, ydoc)
  const c1 = ytext.toDelta({ renderer })
  t.compare(c1, delta.create().insert('hello ').insert('world', null, { delete: [] }).done())
  ytext.applyDelta(delta.create().retain(11).insert('content').done(), null, { renderer })
  t.assert(ytext.toString() === 'hello content')
}

/**
 * 验证在建议插入片段内部按 renderer 索引继续插入，可形成预期底层字符串。
 *
 * @param {t.TestCase} _tc
 */
export const testInsertionsIntoAttributedContent = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  ytext.insert(0, 'hello ')
  const v1 = Y.cloneDoc(ydoc)
  ydoc.transact(() => {
    ytext.insert(6, 'word')
  })
  const renderer = Y.createDiffRenderer(v1, ydoc)
  const c1 = ytext.toDelta({ renderer })
  t.compare(c1, delta.create().insert('hello ').insert('word', null, { insert: [] }).done())
  ytext.applyDelta(delta.create().retain(9).insert('l').done(), null, { renderer })
  t.assert(ytext.toString() === 'hello world')
}

/** 验证文档级 diff 把根文本、数组、Map 属性和嵌套类型变更组合成深层 Delta。 */
export const testYdocDiff = () => {
  const ydocStart = new Y.Doc()
  ydocStart.get('text').insert(0, 'hello')
  ydocStart.get('array').insert(0, [1, 2, 3])
  ydocStart.get('map').setAttr('k', 42)
  ydocStart.get('map').setAttr('nested', new Y.Type())
  const ydocUpdated = Y.cloneDoc(ydocStart)
  ydocUpdated.get('text').insert(5, ' world')
  ydocUpdated.get('array').insert(1, ['x'])
  ydocUpdated.get('map').setAttr('newk', 42)
  ydocUpdated.get('map').getAttr('nested').insert(0, [1])
  // @todo 增加自定义 attribution 覆盖。
  const d = Y.diffDocsToDelta(ydocStart, ydocUpdated).done()
  console.log('calculated diff', d.toJSON())
  const expected = delta.create()
    .modifyAttr('text', delta.create().retain(5).insert(' world', null, { insert: [] }))
    .modifyAttr('array', delta.create().retain(1).insert(['x'], null, { insert: [] }))
    .modifyAttr('map', delta.create().setAttr('newk', 42, { insert: [] }).modifyAttr('nested', delta.create().insert([1], null, { insert: [] })))
  const expectedDone = expected.done()
  t.compare(d, expectedDone)
}

/** 验证插入带文本与属性的嵌套节点时，文档 diff 保留完整子树内容并只触发一次深层事件。 */
export const testChildListContent = () => {
  const ydocStart = new Y.Doc()
  const ydocUpdated = Y.cloneDoc(ydocStart)
  const yf = new Y.Type('test')
  let calledEvent = 0
  yf.applyDelta(delta.create().insert('test content').setAttr('k', 'v').done())

  const yarray = ydocUpdated.get('array')
  yarray.observeDeep(event => {
    calledEvent++
    const d = event.deltaDeep
    const expectedD = delta.create().insert([delta.create('test').insert('test content').setAttr('k', 'v')])
    t.compare(d, expectedD)
  })
  ydocUpdated.get('array').insert(0, [yf])
  t.assert(calledEvent === 1)
  const d = Y.diffDocsToDelta(ydocStart, ydocUpdated)
  console.log('calculated diff', d.toJSON())
  const expected = delta.create()
    .modifyAttr('array', delta.create().insert([delta.create('test').insert('test content', null, { insert: [] }).setAttr('k', 'v', { insert: [] })], null, { insert: [] }).done())
  t.compare(d.done(), expected.done())
}

/**
 * 验证多用户 attribution session 可按作者筛选渲染，并通过 ContentIds 只撤销指定用户变更。
 *
 * @param {t.TestCase} tc
 */
export const testAttributionSession1 = tc => {
  const { testConnector, users, text0, text1 } = init(tc, { users: 3 })
  users[0].gc = false
  const globalAttributions = Y.createContentMap()
  const v1 = Y.cloneDoc(users[0])
  users.forEach(user => user.on('update', (update, _, ydoc, tr) => {
    if (!tr.local) return
    const userid = ydoc.clientID.toString()
    const contentIds = Y.createContentIdsFromUpdate(update)
    Y.insertIntoIdMap(globalAttributions.inserts, Y.createIdMapFromIdSet(contentIds.inserts, [Y.createContentAttribute('insert', userid)]))
    Y.insertIntoIdMap(globalAttributions.deletes, Y.createIdMapFromIdSet(contentIds.deletes, [Y.createContentAttribute('delete', userid)]))
  }))
  text0.insert(0, 'a')
  text1.insert(0, 'b')
  testConnector.flushAllMessages()
  const d1 = text0.toDelta({ renderer: Y.createDiffRenderer(v1, users[0], { attributions: globalAttributions }) })
  t.compare(d1, delta.create().insert('a', null, { insert: ['0'] }).insert('b', null, { insert: ['1'] }).done())
  const v2 = Y.cloneDoc(users[0])
  text0.delete(1, 1)
  text1.insert(2, 'c')
  testConnector.flushAllMessages()
  const d2 = text0.toDelta({ renderer: Y.createDiffRenderer(v2, users[0], { attributions: globalAttributions }) })
  t.compare(d2, delta.create().insert('a').insert('b', null, { delete: ['0'] }).insert('c', null, { insert: ['1'] }).done())

  const onlyUser0ChangesAttributed = Y.createContentMap(
    Y.filterIdMap(globalAttributions.inserts, attrs => attrs.some(attr => attr.name === 'insert' && attr.val === '0')),
    Y.filterIdMap(globalAttributions.deletes, attrs => attrs.some(attr => attr.name === 'delete' && attr.val === '0'))
  )
  const rendererUser0 = new Y.AttributionsRenderer(onlyUser0ChangesAttributed)
  const d3 = text0.toDelta({ renderer: rendererUser0 })
  t.compare(d3, delta.create().insert('a', null, { insert: ['0'] }).insert('b', null, { delete: ['0'] }).insert('c').done())
  Y.undoContentIds(users[0], Y.createContentIdsFromContentMap(onlyUser0ChangesAttributed))

  const d4 = text0.toDelta()
  t.compare(d4, delta.create().insert('bc').done())
}

/**
 * Given：DiffRenderer 正在显示含子文本的段落。
 * When：删除整个段落节点。
 * Then：change 事件范围同时覆盖父项及其被归因的后代内容。
 *
 * 验证机制：对事件 IdSet 与预期 ContentIds 做结构比较。
 */
export const testAttributionEvent = () => {
  const ydoc = new Y.Doc()
  const ytype = ydoc.get()
  // <p>hi</p>
  ytype.applyDelta(delta.create().insert([delta.create('p').insert('hi').done()]).done())
  const ydocBase = Y.cloneDoc(ydoc)
  const renderer = Y.createDiffRenderer(ydocBase, ydoc)
  let called = false
  ytype.observeDeep(event => {
    const change = event.getDelta({ renderer })
    const expectedChange = delta.create().modify(delta.create('p').retain(2, null, { delete: [] }), null, { delete: [] }).done()
    t.compare(
      change,
      expectedChange
    )
    called = true
  })
  // 删除段落；其后代内容也必须进入 attribution 变化范围。
  ytype.delete(0, 1)
  t.assert(called)
}

/** 验证接受建议后 attribution change 可生成 tri-state `null`，清除缓存中原 insert attribution。 */
export const testAttributionChange = () => {
  const ydoc = new Y.Doc()
  const ytype = ydoc.get()
  ytype.applyDelta(delta.create().insert('hi').done())
  const ydocClone = Y.cloneDoc(ydoc)
  const renderer = Y.createDiffRenderer(ydocClone, ydoc)
  ytype.applyDelta(delta.create().retain(2).insert('!').done())
  let calledHandler = false
  renderer.on('change', changes => {
    calledHandler = true
    const changeUpdate = ytype.toDelta({ renderer, deep: true, itemsToRender: changes, retainInserts: true, retainDeletes: true })
    // `!` 失去 `{ insert: [] }` 建议归因，变化 Delta 以 tri-state `null` 显式清除。
    const expectedUpdate = delta.create().retain(2).retain(1, undefined, null)
    t.compare(changeUpdate, expectedUpdate)
  })
  Y.applyUpdate(ydocClone, Y.encodeStateAsUpdate(ydoc))
  t.assert(calledHandler)
}

/** 验证 YType 实现 lib0 `RDT` 接口，`bind` 可双向同步两个类型，销毁绑定后停止传播。 */
export const testRdtBinding = () => {
  const docA = new Y.Doc()
  const docB = new Y.Doc()
  const a = docA.get('text')
  const b = docB.get('text')
  const binding = bind(a, b)
  // 修改 A，变化传播到 B。
  a.insert(0, 'hello')
  t.assert(b.toString() === 'hello')
  // 修改 B，变化反向传播到 A，且不形成回声循环。
  b.insert(5, ' world')
  t.assert(a.toString() === 'hello world')
  t.assert(b.toString() === 'hello world')
  // 销毁绑定后变化不再传播。
  binding.destroy()
  a.insert(0, 'x')
  t.assert(a.toString() === 'xhello world')
  t.assert(b.toString() === 'hello world')
}

/** 验证本地修改通过 `delta` 通道发出以当前类型为根的深层 Delta。 */
export const testRdtDeltaEvent = () => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  /**
   * @type {any}
   */
  let captured = null
  ytext.on('delta', d => { captured = d })
  ytext.insert(0, 'hello')
  t.compare(captured, delta.create().insert('hello').done())
}

/** 验证 `delta` 事件第二参数透传事务 origin，未显式提供时为 null。 */
export const testRdtDeltaEventOrigin = () => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  /**
   * @type {any}
   */
  let capturedOrigin = null
  ytext.on('delta', (_d, origin) => { capturedOrigin = origin })
  const myOrigin = {}
  ydoc.transact(() => {
    ytext.insert(0, 'hello')
  }, myOrigin)
  t.assert(capturedOrigin === myOrigin)
  // 未显式提供 origin 时发出 `null`。
  capturedOrigin = myOrigin
  ytext.insert(5, ' world')
  t.assert(capturedOrigin === null)
  // `applyDelta` 的 origin 成为事务 origin，并由事件透传。
  const applyOrigin = {}
  ytext.applyDelta(delta.create().retain(11).insert('!').done(), applyOrigin)
  t.assert(capturedOrigin === applyOrigin)
  // `applyDelta` 未提供 origin 时事件传出 `null`。
  capturedOrigin = applyOrigin
  ytext.applyDelta(delta.create().retain(12).insert('?').done())
  t.assert(capturedOrigin === null)
}

/** 验证 `useRenderer` 更换 `toDelta` 等 API 的默认 renderer，省略参数与显式传入结果一致。 */
export const testUseRenderer = () => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  ytext.insert(0, 'hello world')
  const v1 = Y.cloneDoc(ydoc)
  ydoc.transact(() => {
    ytext.delete(6, 5)
  })
  const renderer = Y.createDiffRenderer(v1, ydoc)
  const explicit = ytext.toDelta({ renderer })
  // 更换默认 renderer 后，无参 toDelta 应等同显式调用。
  ytext.useRenderer(renderer)
  const viaDefault = ytext.toDelta()
  t.compare(viaDefault, explicit)
  t.compare(viaDefault, delta.create().insert('hello ').insert('world', null, { delete: [] }).done())
}

/** 验证类型显式 destroy 与 Doc destroy 顶层类型都会各触发一次 RDT `destroy` 事件。 */
export const testRdtDestroy = () => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get('text')
  let destroyed = 0
  ytext.on('destroy', () => { destroyed++ })
  ytext.destroy()
  t.assert(destroyed === 1)
  // Doc 销毁时会连带销毁顶层类型。
  const ydoc2 = new Y.Doc()
  const ytext2 = ydoc2.get('text')
  let destroyed2 = 0
  ytext2.on('destroy', () => { destroyed2++ })
  ydoc2.destroy()
  t.assert(destroyed2 === 1)
}

/** 验证嵌套子类型修改时 `delta` 像 observeDeep 一样冒泡，祖先收到以自身为根的非空 modify Delta。 */
export const testRdtDeltaBubblesLikeObserveDeep = () => {
  const ydoc = new Y.Doc()
  const yarray = ydoc.get('arr')
  const child = new Y.Type()
  yarray.insert(0, [child])
  let containerFired = 0
  let childFired = 0
  /**
   * @type {any}
   */
  let captured = null
  yarray.on('delta', d => { containerFired++; captured = d })
  child.on('delta', () => { childFired++ })
  child.insert(0, 'hi')
  // 被编辑子类型及祖先容器都收到 delta。
  t.assert(childFired === 1)
  t.assert(containerFired === 1)
  // 祖先 Delta 是非空嵌套 modify。
  t.assert(captured !== null && !captured.isEmpty())
}

/** 验证 `delta` getter 返回可复用的深层缓存；后续嵌套修改原地 apply，缓存身份不变且等于新鲜渲染。 */
export const testRdtDeltaCacheMaintenance = () => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get('text')
  ytext.insert(0, 'hello')
  // 首次访问物化缓存。
  t.assert(ytext.delta.equals(delta.create().insert('hello').done()))
  // 后续编辑原地更新 live 缓存。
  const live = ytext.delta
  ytext.insert(5, ' world')
  t.assert(live === ytext.delta) // 仍是同一个受维护的缓存对象。
  t.assert(ytext.delta.equals(delta.create().insert('hello world').done()))
  t.assert(ytext.delta.equals(ytext.toDeltaDeep())) // 内容等于一次全新的深层渲染。

  // 嵌套场景：子类型编辑通过 nested modify apply 更新容器深层缓存。
  const yarray = ydoc.get('arr')
  const child = new Y.Type()
  yarray.insert(0, [child])
  child.insert(0, 'a')
  const before = yarray.delta // 在基础 renderer 下物化缓存。
  child.insert(1, 'b') // 缓存物化后修改后代。
  t.assert(before === yarray.delta)
  t.assert(yarray.delta.equals(yarray.toDeltaDeep()))
}

/** 验证 `clearCache()` 丢弃已维护深层 Delta，下一次 getter 创建身份不同但内容相同的新缓存。 */
export const testRdtClearCache = () => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get('text')
  ytext.insert(0, 'hello')
  const d1 = ytext.delta
  t.assert(ytext._delta !== null)
  ytext.clearCache()
  t.assert(ytext._delta === null)
  const d2 = ytext.delta // 重新物化为新 builder。
  t.assert(d2 !== d1)
  t.assert(d2.equals(delta.create().insert('hello').done()))
}

/** 验证 `useRenderer` 重渲染已维护缓存、只在 delta 通道发出视图差异，并把缓存更新为新视图。 */
export const testRdtUseRendererEmitsDiff = () => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get('text')
  ytext.insert(0, 'hello world')
  const v1 = Y.cloneDoc(ydoc)
  ydoc.transact(() => { ytext.delete(6, 5) })
  // 在基础 renderer 下物化缓存。
  t.assert(ytext.delta.equals(delta.create().insert('hello ').done()))
  /**
   * @type {any}
   */
  let captured = null
  ytext.on('delta', d => { captured = d })
  ytext.useRenderer(Y.createDiffRenderer(v1, ydoc))
  // renderer 切换产生非空视图差异。
  t.assert(captured !== null && !captured.isEmpty())
  // 缓存随后反映 diff renderer 状态。
  t.assert(ytext.delta.equals(delta.create().insert('hello ').insert('world', null, { delete: [] }).done()))
}

/** 验证 YType 在运行时通过 lib0 `$rdt.check`，普通对象和 null 不通过。 */
export const testRdtConformsToRdtSchema = () => {
  t.assert($rdt.check(new Y.Doc().get()))
  t.assert($rdt.check(new Y.Type()))
  t.assert(!$rdt.check({}))
  t.assert(!$rdt.check(null))
}

/**
 * 收集根类型及其所有未删除的子列表/属性 YType 后代。
 *
 * @param {Y.Type<any>} root - 遍历起点。
 * @return {Array<Y.Type<any>>} 广度展开的类型数组。
 */
const collectTypes = root => {
  /**
   * @type {Array<Y.Type<any>>}
   */
  const out = [root]
  for (let i = 0; i < out.length; i++) {
    out[i].forEach(c => { if (c instanceof Y.Type) out.push(c) })
    out[i].forEachAttr(v => { if (v instanceof Y.Type) out.push(v) })
  }
  return out
}

/**
 * 在根树中随机选择一个类型并执行一次插入、删除、格式或属性变更。
 *
 * @param {prng.PRNG} gen - 确定性随机源。
 * @param {Y.Type<any>} root - 随机变更树根。
 */
const applyRandomYTypeOp = (gen, root) => {
  const target = prng.oneOf(gen, collectTypes(root))
  switch (prng.int32(gen, 0, 4)) {
    case 0: // 插入文本。
      target.insert(prng.int32(gen, 0, target.length), prng.word(gen))
      break
    case 1: // 插入嵌套类型。
      target.insert(prng.int32(gen, 0, target.length), [new Y.Type()])
      break
    case 2: // 删除一段内容。
      if (target.length > 0) {
        const p = prng.int32(gen, 0, target.length - 1)
        target.delete(p, prng.int32(gen, 1, math.min(3, target.length - p)))
      }
      break
    case 3: // 格式化一段内容（添加或移除粗体）。
      if (target.length > 0) {
        const p = prng.int32(gen, 0, target.length - 1)
        target.format(p, prng.int32(gen, 1, math.min(3, target.length - p)), { bold: prng.bool(gen) ? true : null })
      }
      break
    case 4: // 设置或删除映射属性。
      if (prng.bool(gen)) {
        target.setAttr(prng.oneOf(gen, ['a', 'b', 'c']), prng.word(gen))
      } else {
        target.deleteAttr(prng.oneOf(gen, ['a', 'b', 'c']))
      }
      break
  }
}

/**
 * 模糊验证：每次随机树变更后，每一层类型的增量 `delta` 缓存必须等于全量深层渲染。
 *
 * @param {t.TestCase} tc
 */
export const testRdtDeltaFuzz = tc => {
  const ydoc = new Y.Doc()
  const root = ydoc.get('root')
  for (let i = 0; i < 300; i++) {
    applyRandomYTypeOp(tc.prng, root)
    collectTypes(root).forEach(type =>
      t.assert(type.delta.equals(type.toDelta({ deep: true })), `iter ${i}`))
  }
}

/**
 * 在两个同步建议副本上模糊验证 DiffRenderer 缓存收敛。
 *
 * 每个副本对自己的固定基线做 diff；无自定义 attrs 时插入/删除统一呈现 `{insert:[]}`/`{delete:[]}`，因此纯靠 delta 事件维护的缓存应跨副本一致，并等于各自全量深层渲染。
 *
 * @param {t.TestCase} tc
 */
export const testRdtDeltaSuggestionConvergence = tc => {
  const { testConnector, users } = init(tc, { users: 2 })
  const [d0, d1] = users
  d0.get('root').insert(0, 'shared baseline content')
  testConnector.flushAllMessages()
  // 每个副本对固定基线 clone 做普通 diff，归因值与客户端身份无关。
  d0.get('root').useRenderer(Y.createDiffRenderer(Y.cloneDoc(d0), d0))
  d1.get('root').useRenderer(Y.createDiffRenderer(Y.cloneDoc(d1), d1))
  for (let i = 0; i < 300; i++) {
    applyRandomYTypeOp(tc.prng, prng.oneOf(tc.prng, users).get('root')) // 同时覆盖格式添加与移除。
    testConnector.flushAllMessages()
    const a = d0.get('root').delta
    const b = d1.get('root').delta
    t.assert(a.equals(b), `converge iter ${i}`) // 建议视图与副本身份无关。
    t.assert(a.equals(d0.get('root').toDelta({ deep: true })), `canonical iter ${i}`) // 同时匹配新鲜渲染。
  }
}

/**
 * 固定 seed=1 回归：DiffRenderer 下移除格式后，增量缓存必须等于全量渲染。
 *
 * 历史缺陷位于 `toDelta` 的 ContentFormat change 模式：只清除格式值，却未显式清除格式 attribution，导致未格式化区间残留 `{format:{bold:[]}}`，第 35 轮漂移。修复要求 change/diff retain 发出 `{format:{<key>:null}}`。
 */
export const testRdtFormatRemovalDrift = () => {
  const gen = prng.create(1) // 固定 seed 保证复现。
  const docs = [new Y.Doc(), new Y.Doc()]
  const [d0, d1] = docs
  /** 双向交换增量 update，令两个副本收敛。 */
  const sync = () => {
    Y.applyUpdate(d1, Y.encodeStateAsUpdate(d0, Y.encodeStateVector(d1)))
    Y.applyUpdate(d0, Y.encodeStateAsUpdate(d1, Y.encodeStateVector(d0)))
  }
  d0.get('root').insert(0, 'shared baseline content')
  sync()
  // 每个副本对自己的固定基线 clone 做 diff。
  d0.get('root').useRenderer(Y.createDiffRenderer(Y.cloneDoc(d0), d0))
  d1.get('root').useRenderer(Y.createDiffRenderer(Y.cloneDoc(d1), d1))
  for (let i = 0; i < 40; i++) {
    applyRandomYTypeOp(gen, prng.oneOf(gen, docs).get('root'))
    sync()
    // 每轮都读取 delta 才能持续走增量维护；只在末尾首次读取会全量物化并掩盖漂移。
    const cached = d0.get('root').delta
    const fresh = d0.get('root').toDelta({ deep: true })
    if (!cached.equals(fresh)) {
      console.error('iter ' + i + ' cached :', JSON.stringify(cached.toJSON()))
      console.error('iter ' + i + ' toDelta:', JSON.stringify(fresh.toJSON()))
    }
    t.assert(cached.equals(fresh), `iter ${i}: maintained .delta drifted from toDelta({ deep: true })`)
  }
}

/**
 * 最小回归：先加粗全文、取消 `cd`、再重新加粗时，删除临时 `bold:null` marker 不得使增量缓存漂移。
 *
 * 删除 marker 在 change render 中出现 `attrs==null`，此时必须保留而非清空 attribution 上下文；全量渲染会看到最终 attributed `bold:true` marker，结果应为全文 bold 且带 `{format:{bold:[]}}`。
 */
export const testRdtFormatRebold = () => {
  const doc = new Y.Doc()
  const root = doc.get('root')
  root.insert(0, 'abcdef')
  // 基线取自格式操作前，因此每次格式变化都是 attributed suggestion。
  root.useRenderer(Y.createDiffRenderer(Y.cloneDoc(doc), doc))
  // 首次访问启动增量缓存；此时基线等于当前状态。
  t.assert(root.delta.equals(delta.create().insert('abcdef').done()))
  root.format(0, 6, { bold: true }) // 全文加粗。
  root.format(2, 2, { bold: null }) // 取消 `cd`，插入临时 bold:null marker。
  root.format(2, 2, { bold: true }) // 重新加粗 `cd`，删除临时 marker。
  const cached = root.delta
  const fresh = root.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('rebold cached :', JSON.stringify(cached.toJSON()))
    console.error('rebold toDelta:', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta drifted from toDelta({ deep: true }) after re-bold')
}

/**
 * 最小回归：在 bold 文本中插入嵌套类型，不得让缓存中的 embed 残留伪造的 `{format:{bold:null}}` attribution。
 *
 * Yjs 会用 `[bold:null] <embed> [bold:true]` 让 embed 不继承 bold。change render 中 fresh ContentType 不应继承仅供 retain 清除上下文的 null leaf；全量 insert render 只包含 embed 的 `{insert:[]}`。该用例锁定 insert 与 retain attribution 上下文必须区分的边界。
 */
export const testRdtFormatEmbedInBold = () => {
  const doc = new Y.Doc()
  const root = doc.get('root')
  root.insert(0, 'ab')
  root.useRenderer(Y.createDiffRenderer(Y.cloneDoc(doc), doc))
  // 首次访问启动增量缓存；基线与当前状态一致。
  t.assert(root.delta.equals(delta.create().insert('ab').done()))
  root.format(0, 2, { bold: true }) // 加粗 `ab`。
  root.insert(1, [new Y.Type()]) // 在 bold run 中插入 embed：`a<T>b`。
  const cached = root.delta
  const fresh = root.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('embed-in-bold cached :', JSON.stringify(cached.toJSON()))
    console.error('embed-in-bold toDelta:', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta drifted from toDelta({ deep: true }) after embed-in-bold insert')
}

/**
 * 最小回归：先格式化字符再删除时，缓存不得在删除建议上残留 bold 值与 `{format:{bold:[]}}`。
 *
 * 删除会同时清理两侧格式 marker；change render 必须用 `changedFormats` 发出 `bold→null`，并为真正移除格式的删除 marker 显式发 `{format:{<key>:null}}`。最终只保留 `{delete:[]}`，与全量渲染一致。
 */
export const testRdtFormatDeleteFormatted = () => {
  const doc = new Y.Doc()
  const root = doc.get('root')
  root.insert(0, 'a')
  root.useRenderer(Y.createDiffRenderer(Y.cloneDoc(doc), doc)) // 格式操作前的基线。
  // 启动增量缓存；尚无建议。
  t.assert(root.delta.equals(delta.create().insert('a').done()))
  root.format(0, 1, { bold: true }) // 加粗 `a`。
  root.delete(0, 1) // 删除 `a`。
  const cached = root.delta
  const fresh = root.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('delete-formatted cached :', JSON.stringify(cached.toJSON()))
    console.error('delete-formatted toDelta:', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta drifted from toDelta({ deep: true }) after format+delete')
}

/** 基线验证：平面内容、嵌套子类型和持续编辑中，缓存同时等于显式预期 Delta 与全量深层渲染。 */
export const testRdtDeltaSanity = () => {
  const ydoc = new Y.Doc()
  const root = ydoc.get('root')
  root.insert(0, 'hello')
  root.setAttr('k', 'v')
  t.assert(root.delta.equals(delta.create().insert('hello').setAttr('k', 'v').done()))
  t.assert(root.delta.equals(root.toDelta({ deep: true })))
  // 插入嵌套子类型并持续编辑时仍保持缓存一致。
  const child = new Y.Type()
  root.insert(5, [child])
  child.insert(0, 'world')
  t.assert(root.delta.equals(root.toDelta({ deep: true })))
  child.insert(5, '!')
  root.delete(0, 1)
  t.assert(root.delta.equals(root.toDelta({ deep: true })))
  // 子类型自身缓存也必须一致。
  t.assert(child.delta.equals(child.toDelta({ deep: true })))
  t.assert(child.delta.equals(delta.create().insert('world!').done()))
}

/** 基线验证：自定义 attribution DiffRenderer 下，缓存包含预期作者标记并等于全量 attributed 深层渲染。 */
export const testRdtDeltaAttributionSanity = () => {
  const ydoc = new Y.Doc()
  const root = ydoc.get('root')
  const v1 = Y.cloneDoc(ydoc)
  const attributions = Y.createContentMap()
  ydoc.on('update', (update, _origin, doc, tr) => {
    if (!tr.local) return
    const uid = doc.clientID.toString()
    const cids = Y.createContentIdsFromUpdate(update)
    Y.insertIntoIdMap(attributions.inserts, Y.createIdMapFromIdSet(cids.inserts, [Y.createContentAttribute('insert', uid)]))
    Y.insertIntoIdMap(attributions.deletes, Y.createIdMapFromIdSet(cids.deletes, [Y.createContentAttribute('delete', uid)]))
  })
  root.insert(0, 'hello') // 相对于 v1 的建议插入。
  const uid = ydoc.clientID.toString()
  root.useRenderer(Y.createDiffRenderer(v1, ydoc, { attributions }))
  t.assert(root.delta.equals(delta.create().insert('hello', null, { insert: [uid] }).done()))
  t.assert(root.delta.equals(root.toDelta({ deep: true })))
}

/**
 * 回归验证：accepting renderer 跨建议删除区间格式化后，缓存不得残留 `{format:{code:[]}}`。
 *
 * suggestionMode=false 会把格式提交到基线，因此全量 diff 不含格式 attribution；change render 也必须最终去归因。该场景同样可由两个固定模式建议副本复现。
 */
export const testRdtFormatAcrossSuggestionDeletedDrift = () => {
  const doc = new Y.Doc({ gc: false })
  const suggestionDoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
  const renderer = Y.createDiffRenderer(doc, suggestionDoc, { attributions: Y.createContentMap() })
  doc.get('prosemirror').applyDelta(
    delta.create().insert([delta.create('paragraph', {}, 'hello world')]).done()
  )
  const ytype = suggestionDoc.get('prosemirror')
  ytype.useRenderer(renderer)
  t.assert(ytype.delta != null) // 物化增量缓存。
  // 建议删除 `llo `，内容继续以 attributed tombstone 显示。
  renderer.suggestionMode = true
  ytype.applyDelta(delta.create().modify(delta.create().retain(2).delete(4)).done())
  // 接受模式用户跨仍显示的删除区间格式化。
  renderer.suggestionMode = false
  ytype.applyDelta(delta.create().modify(delta.create().retain(1).retain(6, { code: {} })).done())
  const cached = ytype.delta
  const fresh = ytype.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render')
}

/**
 * 创建“基线文档 + 建议文档 + hello world 段落”的删除父节点测试 fixture。
 *
 * clientID 固定，因为同位置 Item/marker 次序依赖 clientID 比较；关键用例会覆盖两种顺序。可选把 DiffRenderer 安装到建议根类型。
 *
 * @param {number} baseClientID - 基线 clientID。
 * @param {number} sdocClientID - 建议文档 clientID。
 * @param {boolean} useRootRenderer - 是否在根类型启用 renderer。
 * @return {{doc:Y.Doc,sdoc:Y.Doc,renderer:Y.DiffRenderer,ytype:Y.Type}} fixture。
 */
const createSuggestionPair = (baseClientID, sdocClientID, useRootRenderer = true) => {
  const doc = new Y.Doc({ gc: false })
  doc.clientID = baseClientID
  const sdoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sdoc.clientID = sdocClientID
  const renderer = Y.createDiffRenderer(doc, sdoc, { attributions: Y.createContentMap() })
  doc.get('prosemirror').applyDelta(
    delta.create().insert([delta.create('paragraph', {}, 'hello world')]).done()
  )
  const ytype = sdoc.get('prosemirror')
  if (useRootRenderer) ytype.useRenderer(renderer)
  return { doc, sdoc, renderer, ytype }
}

/**
 * 验证基线远端插入建议删除段落内部时，变化穿过 tombstone 冒泡到根 RDT。
 *
 * 新内容集成后随父项自动删除，位于 `insertSet∩deleteSet`，但 renderer 已归因；`itemsToRender` 必须包含 `I∩D∩renderer.attributed`，以 fresh insert 形式显示并保持缓存等于全量渲染。
 */
export const testRdtDeltaThroughDeletedParent = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const { doc, ytype } = createSuggestionPair(baseClientID, sdocClientID)
    t.assert(ytype.delta != null) // 物化缓存。
    let fired = 0
    /**
     * @type {any}
     */
    let captured = null
    ytype.on('delta', d => { fired++; captured = d })
    // 建议删除整段，继续作为 attributed tombstone 显示。
    ytype.applyDelta(delta.create().delete(1).done())
    t.assert(fired === 1)
    fired = 0
    // 基线远端修改集成到已删除父项并自动删除，但仍必须触发根 delta。
    doc.get('prosemirror').applyDelta(delta.create().modify(delta.create().retain(2).insert('XY')).done())
    t.assert(fired === 1, 'root delta fires for a change inside a suggestion-deleted paragraph')
    t.assert(captured !== null && !captured.isEmpty())
    const fresh = ytype.toDelta({ deep: true })
    t.assert(JSON.stringify(fresh.toJSON()).includes('XY'), 'fresh render shows the text inside the tombstone')
    const cached = ytype.delta
    if (!cached.equals(fresh)) {
      console.error('cached:', JSON.stringify(cached.toJSON()))
      console.error('fresh :', JSON.stringify(fresh.toJSON()))
    }
    t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render')
  }
}

/** 验证向建议删除段落插入完整嵌套类型时，ContentType mode 3 把自动删除但已归因的子树渲染为 deep fresh insert。 */
export const testRdtDeltaFreshTypeThroughDeletedParent = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const { doc, ytype } = createSuggestionPair(baseClientID, sdocClientID)
    t.assert(ytype.delta != null) // 物化缓存。
    let fired = 0
    ytype.on('delta', () => { fired++ })
    // 建议删除整段，仍作为 tombstone 显示。
    ytype.applyDelta(delta.create().delete(1).done())
    fired = 0
    // 基线远端在 tombstone 内插入全新嵌套段落。
    const freshParagraph = /** @type {any} */ (delta.create('paragraph', {}, 'fresh'))
    const inner = /** @type {any} */ (delta.create().retain(2).insert([freshParagraph]))
    doc.get('prosemirror').applyDelta(delta.create().modify(inner).done())
    t.assert(fired === 1, 'root delta fires for a fresh nested type inside a suggestion-deleted paragraph')
    const fresh = ytype.toDelta({ deep: true })
    t.assert(JSON.stringify(fresh.toJSON()).includes('fresh'), 'fresh render shows the nested type inside the tombstone')
    const cached = ytype.delta
    if (!cached.equals(fresh)) {
      console.error('cached:', JSON.stringify(cached.toJSON()))
      console.error('fresh :', JSON.stringify(fresh.toJSON()))
    }
    t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render')
  }
}

/** 验证同事务建议插入后立即删除的内容完全不可见，`insertSet∩deleteSet` 不得泄漏到缓存。 */
export const testRdtDeltaSuggestedInsertThenDeleteInvisible = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const { sdoc, ytype } = createSuggestionPair(baseClientID, sdocClientID)
    t.assert(ytype.delta != null) // 物化缓存。
    // 在建议文档同一事务插入并删除相同内容。
    sdoc.transact(() => {
      const par = /** @type {Y.Type} */ (ytype.get(0))
      par.applyDelta(delta.create().retain(2).insert('zz').done())
      par.applyDelta(delta.create().retain(2).delete(2).done())
    })
    const fresh = ytype.toDelta({ deep: true })
    t.assert(!JSON.stringify(fresh.toJSON()).includes('zz'), 'insert-then-deleted suggestion is invisible')
    const cached = ytype.delta
    if (!cached.equals(fresh)) {
      console.error('cached:', JSON.stringify(cached.toJSON()))
      console.error('fresh :', JSON.stringify(fresh.toJSON()))
    }
    t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render')
  }
}

/**
 * 验证 mode 3 freshness 必须按 ID 子区间判断，不能按合并后的整个 Item 起点判断。
 *
 * 外层 delta observer 创建嵌套事务；外层 cleanup 在嵌套事件渲染前把 fresh 插入+删除范围合并进旧左邻居。若只检查合并 Item 首 ID，会把 fresh 范围误渲染为 delete 并删坏缓存。
 */
export const testRdtDeltaFreshRangeAfterItemMerge = () => {
  const doc = new Y.Doc({ gc: false })
  doc.clientID = 1
  const sdoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sdoc.clientID = 2
  const renderer = Y.createDiffRenderer(doc, sdoc, { attributions: Y.createContentMap() })
  doc.get('t').applyDelta(delta.create().insert('XY').done())
  const ytype = sdoc.get('t')
  ytype.useRenderer(renderer)
  t.assert(ytype.delta != null) // 物化缓存。
  let reacted = false
  ytype.on('delta', change => {
    if (reacted || !JSON.stringify(change.toJSON()).includes('"a"')) return
    reacted = true
    // 嵌套事务在建议 `a` 后插入相邻 clock 的 `b`，再删除二者；外层 cleanup 会先把删除项合并。
    sdoc.transact(() => {
      ytype.applyDelta(delta.create().retain(1).insert('b').done())
      ytype.applyDelta(delta.create().delete(2).done())
    })
  })
  // 外层事务在位置 0 建议插入 `a`。
  ytype.applyDelta(delta.create().insert('a').done())
  t.assert(reacted)
  const cached = ytype.delta
  const fresh = ytype.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render')
}

/**
 * 断言 lib0 RDT “完全回退 apply”契约：文档未变化、缓存仍一致，且 `before.apply(d).apply(fix)` 回到实际状态。
 *
 * @param {any} ytype - 已物化 delta 缓存的目标类型。
 * @param {any} before - apply 前的深层渲染。
 * @param {any} d - 尝试但未落地的变化。
 * @param {any} fix - `applyDelta` 返回的逆操作。
 */
const assertRevertedApply = (ytype, before, d, fix) => {
  const fresh = ytype.toDelta({ deep: true })
  t.assert(delta.diff(before, fresh).isEmpty(), 'nothing was applied to the doc')
  t.assert(ytype.delta.equals(fresh), 'maintained .delta must equal a fresh deep render')
  const roundTrip = delta.cloneDeep(before)
  roundTrip.apply(delta.cloneDeep(d), { final: true, move: true })
  if (fix !== null) {
    roundTrip.apply(delta.cloneDeep(fix), { final: true, move: true })
  }
  t.assert(delta.diff(roundTrip, fresh).isEmpty(), 'the fix round-trips the expected state back to the actual state')
}

/** 验证修改建议删除节点时不落地任何内容：返回嵌套变化的逆操作、不发 delta，并保持文档与缓存不变。 */
export const testRdtApplyDeltaModifyIntoTombstoneReturnsInverse = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const { ytype } = createSuggestionPair(baseClientID, sdocClientID)
    t.assert(ytype.delta != null) // 物化缓存。
    ytype.applyDelta(delta.create().delete(1).done())
    const before = ytype.toDelta({ deep: true })
    let fired = 0
    ytype.on('delta', () => { fired++ })
    const d = delta.create().modify(delta.create().retain(2).insert('XY')).done()
    const fix = ytype.applyDelta(d)
    t.assert(fix !== null, 'the reverted operation is returned')
    t.compare(/** @type {any} */ (fix).toJSON(), delta.create().modify(delta.create().retain(2).delete(2)).done().toJSON())
    t.assert(fired === 0, 'a fully reverted apply emits no delta event')
    t.assert(!JSON.stringify(ytype.toDelta({ deep: true }).toJSON()).includes('XY'), 'the insert was not applied')
    assertRevertedApply(ytype, before, d, fix)
  }
}

/** 验证删除 tombstone 内内容时，fix 从渲染基线重插被删范围，并恢复调用方原先看到的 delete attribution。 */
export const testRdtApplyDeltaDeleteInsideTombstoneInverse = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const { ytype } = createSuggestionPair(baseClientID, sdocClientID)
    t.assert(ytype.delta != null)
    ytype.applyDelta(delta.create().delete(1).done())
    const before = ytype.toDelta({ deep: true })
    const d = delta.create().modify(delta.create().retain(2).delete(4)).done()
    const fix = ytype.applyDelta(d)
    t.assert(fix !== null)
    const fixJson = JSON.stringify(/** @type {any} */ (fix).toJSON())
    t.assert(fixJson.includes('llo '), 'the fix re-inserts the deleted range')
    t.assert(fixJson.includes('"delete"'), 'the re-insert restores the stored delete attribution')
    assertRevertedApply(ytype, before, d, fix)
  }
}

/** 验证格式化 tombstone 内容不会创建 marker，返回 fix 会把格式键恢复为基线值（未格式化区间为 `{bold:null}`）。 */
export const testRdtApplyDeltaFormatInsideTombstoneInverse = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const { ytype } = createSuggestionPair(baseClientID, sdocClientID)
    t.assert(ytype.delta != null)
    ytype.applyDelta(delta.create().delete(1).done())
    const before = ytype.toDelta({ deep: true })
    const d = delta.create().modify(delta.create().retain(1).retain(4, { bold: {} })).done()
    const fix = ytype.applyDelta(d)
    t.assert(fix !== null)
    t.compare(/** @type {any} */ (fix).toJSON(), delta.create().modify(delta.create().retain(1).retain(4, { bold: null })).done().toJSON())
    assertRevertedApply(ytype, before, d, fix)
  }
}

/**
 * 验证 tombstone 节点上的 `modify.format` 同样不落地，fix 恢复节点此前格式值。
 *
 * 此前值必须在 cursor 走到节点后从格式上下文读取，才能计入遍历起点与节点间的 live 格式 marker。
 */
export const testRdtApplyDeltaNodeFormatOnTombstoneInverse = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const doc = new Y.Doc({ gc: false })
    doc.clientID = baseClientID
    const sdoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
    sdoc.clientID = sdocClientID
    const renderer = Y.createDiffRenderer(doc, sdoc, { attributions: Y.createContentMap() })
    doc.get('prosemirror').applyDelta(
      delta.create().insert([delta.create('paragraph', {}, 'aa'), delta.create('paragraph', {}, 'bb')]).done()
    )
    // 基线同时格式化两个段落，首段前存在 live `align` marker。
    doc.get('prosemirror').applyDelta(delta.create().retain(2, { align: 'x' }).done())
    const ytype = sdoc.get('prosemirror')
    ytype.useRenderer(renderer)
    t.assert(ytype.delta != null)
    // 建议删除第二段。
    ytype.applyDelta(delta.create().retain(1).delete(1).done())
    const before = ytype.toDelta({ deep: true })
    const d = delta.create().retain(1).modify(delta.create(), { align: 'y' }).done()
    const fix = ytype.applyDelta(d)
    t.assert(fix !== null)
    t.compare(/** @type {any} */ (fix).toJSON(), delta.create().retain(1).modify(delta.create(), { align: 'x' }).done().toJSON())
    assertRevertedApply(ytype, before, d, fix)
  }
}

/**
 * 验证同一 Delta 可同时含已应用与被回退操作：live 内容修改落地并只发一次事件，tombstone modify 单独返回 fix。
 *
 * fix 的 retain padding 必须按调用方预期空间计算，包括该 Delta 更早插入的内容。
 */
export const testRdtApplyDeltaMixedFixCoordinates = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const doc = new Y.Doc({ gc: false })
    doc.clientID = baseClientID
    const sdoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
    sdoc.clientID = sdocClientID
    const renderer = Y.createDiffRenderer(doc, sdoc, { attributions: Y.createContentMap() })
    doc.get('prosemirror').applyDelta(
      delta.create().insert([
        delta.create('paragraph', {}, 'aa'), delta.create('paragraph', {}, 'hello world'), delta.create('paragraph', {}, 'cc')
      ]).done()
    )
    const ytype = sdoc.get('prosemirror')
    ytype.useRenderer(renderer)
    t.assert(ytype.delta != null)
    // 建议删除中间段。
    ytype.applyDelta(delta.create().retain(1).delete(1).done())
    let fired = 0
    ytype.on('delta', () => { fired++ })
    const innerXY = /** @type {any} */ (delta.create().retain(2).insert('XY'))
    const innerZZ = /** @type {any} */ (delta.create().retain(2).insert('ZZ'))
    const pNew = /** @type {any} */ (delta.create('paragraph', {}, 'nn'))
    const d = /** @type {any} */ (delta.create()).insert([pNew]).retain(1).modify(innerXY).modify(innerZZ).done()
    const fix = ytype.applyDelta(d)
    t.assert(fired === 1, 'the applied part of the change emits exactly one delta event')
    t.assert(fix !== null)
    t.compare(/** @type {any} */ (fix).toJSON(), delta.create().retain(2).modify(delta.create().retain(2).delete(2)).done().toJSON())
    const fresh = JSON.stringify(ytype.toDelta({ deep: true }).toJSON())
    t.assert(fresh.includes('nn') && fresh.includes('ZZ'), 'ops on live content were applied')
    t.assert(!fresh.includes('XY'), 'the tombstone-targeting modify was not applied')
    t.assert(ytype.delta.equals(ytype.toDelta({ deep: true })), 'maintained .delta must equal a fresh deep render')
  }
}

/**
 * 验证 `modifyAttr` 可通过 renderer 感知查找定位仍显示的已删除 Map 值，不落地并以 modifyAttr 包装逆操作。
 *
 * 历史实现使用看不到删除项的 `typeMapGet`，会触发 `unexpectedCase`。
 */
export const testRdtApplyDeltaModifyAttrOnDeletedMapValue = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const doc = new Y.Doc({ gc: false })
    doc.clientID = baseClientID
    const sdoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
    sdoc.clientID = sdocClientID
    const renderer = Y.createDiffRenderer(doc, sdoc, { attributions: Y.createContentMap() })
    const title = doc.get('m').setAttr('title', new Y.Type())
    title.insert(0, 'hi')
    const m = sdoc.get('m')
    m.useRenderer(renderer)
    t.assert(m.delta != null)
    // 建议删除属性；值继续以 delete-attributed tombstone 显示。
    m.applyDelta(delta.create().deleteAttr('title').done())
    const before = m.toDelta({ deep: true })
    const d = delta.create().modifyAttr('title', delta.create().insert('X')).done()
    const fix = m.applyDelta(d)
    t.assert(fix !== null, 'no throw — the reverted operation is returned')
    t.compare(/** @type {any} */ (fix).toJSON(), delta.create().modifyAttr('title', delta.create().delete(1)).done().toJSON())
    assertRevertedApply(m, before, d, fix)
  }
}

/** 验证普通删除且无 renderer 接管的不可见类型维持静默丢弃语义：applyDelta 返回 null，文档不变。 */
export const testRdtApplyDeltaInvisibleDeletedSilentNull = () => {
  const doc = new Y.Doc({ gc: false })
  doc.clientID = 1
  const root = doc.get('prosemirror')
  root.applyDelta(delta.create().insert([delta.create('paragraph', {}, 'hello')]).done())
  const par = /** @type {Y.Type} */ (root.get(0))
  root.applyDelta(delta.create().delete(1).done())
  const res = par.applyDelta(delta.create().retain(2).insert('XY').done())
  t.assert(res === null, 'invisible deleted type: silent drop, no fix')
  t.assert(root.toDelta({ deep: true }).isEmpty(), 'nothing was applied')
}

/** 验证直接修改“已删除但由 renderer 显示”的类型时，顶层守卫返回相对渲染状态的逆操作；无 renderer 时仍静默返回 null。 */
export const testRdtApplyDeltaDirectGuardOnDeletedType = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const { ytype, renderer } = createSuggestionPair(baseClientID, sdocClientID)
    t.assert(ytype.delta != null)
    const par = /** @type {Y.Type} */ (ytype.get(0))
    ytype.applyDelta(delta.create().delete(1).done())
    const rootBefore = ytype.toDelta({ deep: true })
    const d = /** @type {any} */ (delta.create().retain(2).insert('XY').done())
    // 子类型不继承根 renderer；未显式传入时节点不可见。
    t.assert(par.applyDelta(d) === null, 'no renderer: silent drop')
    const fix = par.applyDelta(d, null, { renderer })
    t.assert(fix !== null)
    t.compare(/** @type {any} */ (fix).toJSON(), delta.create().retain(2).delete(2).done().toJSON())
    t.assert(delta.diff(rootBefore, ytype.toDelta({ deep: true })).isEmpty(), 'nothing was applied to the doc')
    t.assert(ytype.delta.equals(ytype.toDelta({ deep: true })), 'maintained .delta must equal a fresh deep render')
    // 在节点自身渲染状态上验证 fix 往返。
    const parBefore = /** @type {any} */ (par.toDelta({ deep: true, renderer }))
    const roundTrip = /** @type {any} */ (delta.cloneDeep(parBefore))
    roundTrip.apply(delta.cloneDeep(d), { final: true, move: true })
    roundTrip.apply(delta.cloneDeep(/** @type {any} */ (fix)), { final: true, move: true })
    t.assert(delta.diff(roundTrip, par.toDelta({ deep: true, renderer })).isEmpty(), 'the fix round-trips at the node level')
  }
}

/** 验证 live 子节点之后的 tombstone 孙节点返回嵌套 fix，父级按位置逐层包装为 `modify(modify(inverse))`。 */
export const testRdtApplyDeltaNestedTombstoneFixBubbles = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const doc = new Y.Doc({ gc: false })
    doc.clientID = baseClientID
    const sdoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
    sdoc.clientID = sdocClientID
    const renderer = Y.createDiffRenderer(doc, sdoc, { attributions: Y.createContentMap() })
    doc.get('prosemirror').applyDelta(
      delta.create().insert([delta.create('paragraph', {}, [delta.create('nested', {}, 'ww')])]).done()
    )
    const ytype = sdoc.get('prosemirror')
    ytype.useRenderer(renderer)
    t.assert(ytype.delta != null)
    // 只建议删除仍存活段落内的嵌套节点。
    const par = /** @type {Y.Type} */ (ytype.get(0))
    par.applyDelta(delta.create().delete(1).done(), null, { renderer })
    const before = ytype.toDelta({ deep: true })
    const innerX = /** @type {any} */ (delta.create().insert('X'))
    const midModify = /** @type {any} */ (delta.create().modify(innerX))
    const d = delta.create().modify(midModify).done()
    const fix = ytype.applyDelta(d)
    t.assert(fix !== null)
    const innerDel = /** @type {any} */ (delta.create().delete(1))
    const midModifyDel = /** @type {any} */ (delta.create().modify(innerDel))
    t.compare(/** @type {any} */ (fix).toJSON(), delta.create().modify(midModifyDel).done().toJSON())
    assertRevertedApply(ytype, before, d, fix)
  }
}

/**
 * 锁定普通 delete 跨 tombstone 的既有语义：对 live 内容做建议删除、记录 attributed 范围，但不返回 fix。
 *
 * 这是当前由下游修复的已知空隙；测试确保未来改变该行为时必须显式处理。
 */
export const testRdtApplyDeltaPureDeleteOverTombstoneNoFix = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const doc = new Y.Doc({ gc: false })
    doc.clientID = baseClientID
    const sdoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
    sdoc.clientID = sdocClientID
    const renderer = Y.createDiffRenderer(doc, sdoc, { attributions: Y.createContentMap() })
    doc.get('prosemirror').applyDelta(
      delta.create().insert([
        delta.create('paragraph', {}, 'aa'), delta.create('paragraph', {}, 'hello world'), delta.create('paragraph', {}, 'cc')
      ]).done()
    )
    const ytype = sdoc.get('prosemirror')
    ytype.useRenderer(renderer)
    t.assert(ytype.delta != null)
    ytype.applyDelta(delta.create().retain(1).delete(1).done())
    const res = ytype.applyDelta(delta.create().delete(3).done())
    t.assert(res === null, 'a plain delete over a tombstone range returns no fix')
    const fresh = ytype.toDelta({ deep: true })
    t.assert(ytype.delta.equals(fresh), 'maintained .delta must equal a fresh deep render')
  }
}

/**
 * 验证 delete 在 attributed-deleted chunk 中间结束时会按消费边界切分 Item。
 *
 * 若不切分，cursor 会越过整块，使同一 Delta 后续 modify 错位并返回另一个节点内容的 fix。
 */
export const testRdtApplyDeltaDeleteMidStruckChunkKeepsCursorSync = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const doc = new Y.Doc({ gc: false })
    doc.clientID = baseClientID
    const sdoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
    sdoc.clientID = sdocClientID
    const renderer = Y.createDiffRenderer(doc, sdoc, { attributions: Y.createContentMap() })
    doc.get('t').applyDelta(delta.create().insert('abc').done())
    doc.get('t').applyDelta(delta.create().retain(3).insert([delta.create('nA', {}, 'kk'), delta.create('nB', {}, 'qqq')]).done())
    const ytype = sdoc.get('t')
    ytype.useRenderer(renderer)
    t.assert(ytype.delta != null)
    // 把 `bc` 作为一个 2 单位 chunk 删除，并删除两个节点。
    ytype.applyDelta(delta.create().retain(1).delete(2).done())
    ytype.applyDelta(delta.create().retain(3).delete(2).done())
    const before = ytype.toDelta({ deep: true })
    // delete 在 chunk 中部结束：删 `b`、retain `c`，再对 tombstone nA 做回退 modify。
    const inner = /** @type {any} */ (delta.create().delete(2))
    const d = delta.create().retain(1).delete(1).retain(1).modify(inner).done()
    const fix = ytype.applyDelta(d)
    t.assert(fix !== null)
    const fixJson = JSON.stringify(/** @type {any} */ (fix).toJSON())
    t.assert(fixJson.includes('kk') && !fixJson.includes('qq'), "the fix restores nA's content, not nB's")
    const fresh = ytype.toDelta({ deep: true })
    t.assert(delta.diff(before, fresh).isEmpty(), 'nothing was applied (struck delete is meta-only, modify reverted)')
    t.assert(ytype.delta.equals(fresh), 'maintained .delta must equal a fresh deep render')
  }
}

/**
 * 验证仍显示的建议删除属性值内部变化会重新发出完整 `setAttr`。
 *
 * 删除值没有 modifyAttr 路径；当值类型出现在 modified 集合中时，change render 必须用幂等完整替换刷新缓存，否则所有 RDT 消费者永久陈旧。
 */
export const testRdtDeltaThroughDeletedAttrValue = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const doc = new Y.Doc({ gc: false })
    doc.clientID = baseClientID
    const sdoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
    sdoc.clientID = sdocClientID
    const renderer = Y.createDiffRenderer(doc, sdoc, { attributions: Y.createContentMap() })
    const title = doc.get('m').setAttr('title', new Y.Type())
    title.insert(0, 'hi')
    const m = sdoc.get('m')
    m.useRenderer(renderer)
    t.assert(m.delta != null)
    m.applyDelta(delta.create().deleteAttr('title').done())
    t.assert(m.delta.equals(m.toDelta({ deep: true })), 'cache consistent after the suggestion deleteAttr')
    let fired = 0
    m.on('delta', () => { fired++ })
    // 基线在 tombstone 属性值内部编辑。
    doc.get('m').getAttr('title').insert(2, 'XY')
    t.assert(fired === 1, "'delta' fires for a change inside the tombstone attr value")
    const fresh = m.toDelta({ deep: true })
    t.assert(JSON.stringify(fresh.toJSON()).includes('XY'), 'fresh render shows the edit')
    t.assert(m.delta.equals(fresh), 'maintained .delta must equal a fresh deep render')
  }
}

/** 验证基线远端格式化建议删除段落内部时，根 delta 发出一次且 fresh-deleted 格式 marker 走 retain 路径，缓存等于全量渲染。 */
export const testRdtDeltaFormatThroughDeletedParent = () => {
  for (const [baseClientID, sdocClientID] of [[1, 2], [2, 1]]) {
    const { doc, ytype } = createSuggestionPair(baseClientID, sdocClientID)
    t.assert(ytype.delta != null) // 物化缓存。
    ytype.applyDelta(delta.create().delete(1).done()) // 建议删除段落。
    let fired = 0
    ytype.on('delta', () => { fired++ })
    doc.get('prosemirror').applyDelta(delta.create().modify(delta.create().retain(1).retain(4, { bold: {} })).done())
    t.assert(fired === 1, 'root delta fires for a format inside a suggestion-deleted paragraph')
    const cached = ytype.delta
    const fresh = ytype.toDelta({ deep: true })
    if (!cached.equals(fresh)) {
      console.error('cached:', JSON.stringify(cached.toJSON()))
      console.error('fresh :', JSON.stringify(fresh.toJSON()))
    }
    t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render')
  }
}

/**
 * 验证基础 renderer 下不可见删除子树的远端变化不发空 delta，也不触发根 v1 observe，但会通知存活祖先的 observeDeep。
 *
 * 事务仍通过删除父项登记 changedParentTypes；最终 Delta 为空时只抑制 delta 通道。
 */
export const testRdtNoDeltaThroughDeletedParentPlainDoc = () => {
  const docP = new Y.Doc({ gc: false })
  docP.clientID = 3
  const docQ = new Y.Doc({ gc: false })
  docQ.clientID = 4
  docP.get('prosemirror').applyDelta(
    delta.create().insert([delta.create('paragraph', {}, 'hello world')]).done()
  )
  Y.applyUpdate(docQ, Y.encodeStateAsUpdate(docP))
  const rootQ = docQ.get('prosemirror')
  t.assert(rootQ.delta != null) // 物化缓存。
  let deltaFired = 0
  let deepFired = 0
  let observeFired = 0
  rootQ.on('delta', () => { deltaFired++ })
  rootQ.observeDeep(() => { deepFired++ })
  rootQ.observe(() => { observeFired++ })
  // Q 普通删除段落是可见变化，正常发事件。
  rootQ.applyDelta(delta.create().delete(1).done())
  t.assert(deltaFired === 1 && observeFired === 1)
  deltaFired = 0
  deepFired = 0
  observeFired = 0
  // 远端修改不可见删除段落内部。
  docP.get('prosemirror').applyDelta(delta.create().modify(delta.create().retain(2).insert('XY')).done())
  Y.applyUpdate(docQ, Y.encodeStateAsUpdate(docP))
  t.assert(deltaFired === 0, 'no delta emission for an invisible change')
  t.assert(observeFired === 0, 'v1 observe on the root is unaffected')
  t.assert(deepFired === 1, 'deep listeners on live ancestors are notified')
  t.assert(rootQ.delta.equals(rootQ.toDelta({ deep: true })), 'maintained cache stays equal to a fresh render')
}

/**
 * 验证已删除类型拥有自身 renderer 时仍会因 tombstone 可见而触发 observe/delta 并维护缓存。
 *
 * 上层基础 renderer 看不到该内部变化，因此不得发空 delta。
 */
export const testRdtDeletedTypeWithOwnRendererFires = () => {
  const { doc, renderer, ytype } = createSuggestionPair(1, 2, false)
  const parB = /** @type {any} */ (ytype.get(0))
  parB.useRenderer(renderer)
  t.assert(parB.delta != null) // 物化已删除类型的 renderer 缓存。
  t.assert(ytype.delta != null) // 根缓存使用基础 renderer。
  let parFired = 0
  let parObserved = 0
  let rootFired = 0
  parB.on('delta', () => { parFired++ })
  parB.observe(() => { parObserved++ })
  ytype.on('delta', () => { rootFired++ })
  // 删除段落对根是可见变化；段落自身成为仍由 DiffRenderer 显示的 tombstone。
  ytype.applyDelta(delta.create().delete(1).done())
  t.assert(rootFired === 1, 'root fires for its own visible delete')
  t.assert(parB.delta.equals(parB.toDelta({ deep: true })), 'deleted type cache current after the deletion')
  const parFiredAfterDelete = parFired
  // tombstone 内远端格式使已删除类型发事件；基础 renderer 根不输出空变化。
  doc.get('prosemirror').applyDelta(delta.create().modify(delta.create().retain(1).retain(4, { bold: {} })).done())
  t.assert(parFired === parFiredAfterDelete + 1, 'deleted type with its own renderer fires delta')
  t.assert(parObserved >= 1, 'deleted type with its own renderer fires observe')
  t.assert(rootFired === 1, 'base-renderer root does not emit empty deltas')
  t.assert(parB.delta.equals(parB.toDelta({ deep: true })), 'deleted type cache current after the remote format')
  t.assert(ytype.delta.equals(ytype.toDelta({ deep: true })), 'root cache stays equal to a fresh render')
}

/** 验证类型 scope UndoManager 能从 changedParentTypes 看见 tombstone 子树事务，但最终仍由 origin 门禁决定是否捕获。 */
export const testRdtDeletedSubtreeUndoScope = () => {
  const docP = new Y.Doc({ gc: false })
  docP.clientID = 5
  const docQ = new Y.Doc({ gc: false })
  docQ.clientID = 6
  docP.get('prosemirror').applyDelta(
    delta.create().insert([delta.create('paragraph', {}, 'hello world')]).done()
  )
  Y.applyUpdate(docQ, Y.encodeStateAsUpdate(docP))
  const rootQ = docQ.get('prosemirror')
  const um = new Y.UndoManager(rootQ)
  rootQ.applyDelta(delta.create().delete(1).done()) // 本地删除被捕获。
  t.assert(um.undoStack.length === 1)
  // 删除父项冒泡让远端变化命中 scope，但未跟踪 origin 使其不入栈。
  docP.get('prosemirror').applyDelta(delta.create().modify(delta.create().retain(2).insert('XY')).done())
  Y.applyUpdate(docQ, Y.encodeStateAsUpdate(docP), 'remote-origin')
  t.assert(um.undoStack.length === 1, 'untracked-origin remote change is not captured')
}

/**
 * 回归验证 accepting renderer 插入已提交子节点时，缓存不得保留 change render 的临时 `{insert:[]}`。
 *
 * 节点已同步到基线且附近无建议内容，全量 diff 应无 attribution。该“删尾 + 插节点”结构对应 ProseMirror block split；同时覆盖直接 accepting 插入与先建议插入后 acceptAll 两个入口。
 */
export const testRdtAcceptingNodeInsertCacheDrift = () => {
  const doc = new Y.Doc({ gc: false })
  const suggestionDoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
  const renderer = Y.createDiffRenderer(doc, suggestionDoc, { attributions: Y.createContentMap() })
  renderer.suggestionMode = false
  doc.get('prosemirror').applyDelta(
    delta.create().insert([delta.create('paragraph', {}, 'base para')]).done()
  )
  const ytype = suggestionDoc.get('prosemirror')
  ytype.useRenderer(renderer)
  t.assert(ytype.delta != null) // 物化缓存。
  ytype.applyDelta(delta.create().retain(1).insert([delta.create('paragraph', {}, 'plain')]).done())
  // 插入已到达基线，属于 committed content。
  t.assert(JSON.stringify(doc.get('prosemirror').toDeltaDeep().toJSON()).includes('plain'), 'the insert committed to base')
  const cached = ytype.delta
  const fresh = ytype.toDelta({ deep: true })
  t.assert(!JSON.stringify(fresh.toJSON()).includes('"attribution"'), 'fresh render shows committed (unattributed) content')
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render')
  // 第二入口：接受建议节点插入。接受后的去归因修正也必须深入嵌套内容。
  {
    const doc2 = new Y.Doc({ gc: false })
    const suggestionDoc2 = new Y.Doc({ isSuggestionDoc: true, gc: false })
    const renderer2 = Y.createDiffRenderer(doc2, suggestionDoc2, { attributions: Y.createContentMap() })
    doc2.get('prosemirror').applyDelta(delta.create().insert([delta.create('paragraph', {}, 'base para')]).done())
    const ytype2 = suggestionDoc2.get('prosemirror')
    ytype2.useRenderer(renderer2)
    t.assert(ytype2.delta != null) // 物化缓存。
    renderer2.suggestionMode = true
    ytype2.applyDelta(delta.create().retain(1).insert([delta.create('paragraph', {}, 'sugg')]).done())
    t.assert(ytype2.delta.equals(ytype2.toDelta({ deep: true })), 'suggested insert itself is consistent')
    renderer2.acceptAllChanges()
    t.assert(ytype2.delta.equals(ytype2.toDelta({ deep: true })), 'maintained .delta must equal a fresh render after accepting the node insert')
  }
}

/**
 * 从消费者事件流角度回归 accepting 节点插入：组合全部 delta 后不得仍把 committed 子树显示成建议。
 *
 * 写入可能先发节点及后代带 `{insert:[]}` 的 insert render，再发去归因修正。修正可以让初次事件直接无归因，也可递归清除所有后代；契约只要求最终事件组合收敛到无归因全量渲染。
 */
export const testRdtAcceptingNodeInsertRenderedAsSuggestion = () => {
  const doc = new Y.Doc({ gc: false })
  const suggestionDoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
  const renderer = Y.createDiffRenderer(doc, suggestionDoc, { attributions: Y.createContentMap() })
  renderer.suggestionMode = false
  doc.get('prosemirror').applyDelta(
    delta.create().insert([delta.create('paragraph', {}, 'base para')]).done()
  )
  const ytype = suggestionDoc.get('prosemirror')
  ytype.useRenderer(renderer)
  // composed 表示写入前状态依次应用所有 delta，是远端绑定/维护缓存实际看到的文档。
  const composed = delta.cloneDeep(/** @type {any} */ (ytype.toDelta({ deep: true })))
  ytype.on('delta', d => {
    composed.apply(/** @type {any} */ (delta.cloneDeep(/** @type {any} */ (d))), { final: true, move: true })
  })
  ytype.applyDelta(delta.create().retain(1).insert([delta.create('paragraph', {}, 'plain')]).done())
  const fresh = ytype.toDelta({ deep: true })
  t.assert(!JSON.stringify(fresh.toJSON()).includes('"attribution"'), 'ground truth: the insert committed to base, nothing is suggested')
  if (!composed.equals(fresh)) {
    console.error('composed:', JSON.stringify(composed.toJSON()))
    console.error('fresh   :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(!JSON.stringify(composed.toJSON()).includes('"attribution"'), 'the settled event stream must not present the committed insert as a suggestion')
  t.assert(composed.equals(fresh), 'composing the emitted changes converges to a fresh render')
  // 多层嵌套必须在每一级去归因，不能只修正首层。
  ytype.applyDelta(delta.create().retain(2).insert([delta.create('blockquote', {}, [delta.create('paragraph', {}, 'deep')])]).done())
  const fresh2 = ytype.toDelta({ deep: true })
  t.assert(!JSON.stringify(fresh2.toJSON()).includes('"attribution"'), 'ground truth: the multi-level insert committed to base')
  t.assert(!JSON.stringify(composed.toJSON()).includes('"attribution"'), 'no nesting level is left presented as a suggestion')
  t.assert(composed.equals(fresh2), 'the event stream converges for multi-level nesting')
}

/**
 * 验证去归因修复按 ID 范围精确生效，不能无条件清空整个已接受节点子树。
 *
 * 仅接受节点自身 ID 后，空段落提交到基线，但文本后代仍是待处理建议；修复必须清除节点 attribution、保留后代 `{insert:[]}`，并维持缓存等于全量渲染。
 */
export const testRdtPartialAcceptKeepsPendingChildSuggestions = () => {
  const doc = new Y.Doc({ gc: false })
  const suggestionDoc = new Y.Doc({ isSuggestionDoc: true, gc: false })
  const renderer = Y.createDiffRenderer(doc, suggestionDoc, { attributions: Y.createContentMap() })
  doc.get('prosemirror').applyDelta(delta.create().insert([delta.create('paragraph', {}, 'base para')]).done())
  const ytype = suggestionDoc.get('prosemirror')
  ytype.useRenderer(renderer)
  t.assert(ytype.delta != null) // 物化后续要原地维护的缓存。
  renderer.suggestionMode = true
  const client = suggestionDoc.clientID
  // 建议 1：插入节点；段落占 clock 0，文本 `x` 占 clock 1。
  ytype.applyDelta(delta.create().retain(1).insert([delta.create('paragraph', {}, 'x')]).done())
  // 建议 2：在该建议节点内部继续插入文本。
  ytype.applyDelta(delta.create().retain(1).modify(delta.create().retain(1).insert('Q')).done())
  t.assert(ytype.delta.equals(ytype.toDelta({ deep: true })), 'consistent before the partial accept')
  // 只接受节点自身 ID（clock 0），所有子内容继续作为待处理建议。
  renderer.acceptChanges(Y.createID(client, 0))
  const cached = ytype.delta
  const fresh = ytype.toDelta({ deep: true })
  const freshJson = /** @type {any} */ (fresh.toJSON())
  // 全量真值：节点作为空段落提交。
  t.assert(JSON.stringify(doc.get('prosemirror').toDeltaDeep().toJSON()).split('"paragraph"').length === 3, 'the accepted node reached the base doc')
  t.assert(freshJson.children[0].attribution === undefined, 'the accepted node itself is no longer attributed')
  // 子内容仍保持建议状态。
  const acceptedPara = freshJson.children[0].insert[1]
  t.assert(acceptedPara.name === 'paragraph' && JSON.stringify(acceptedPara.children).includes('"attribution":{"insert":[]}'), 'pending child suggestions keep their attribution')
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after the partial accept')
}

/**
 * 回归验证 `isRangeEndClear`：无归因 marker 关闭同键 attributed range 时，必须发该键 attribution clear。
 *
 * 场景来自 y-prosemirror seed 54321：建议 strong 覆盖 `a`，基线 strong 覆盖 `abc`，再在建议 span 之后、基线格式范围内部插入 `x`。历史缓存让尾部 `c` 残留 `{format:{strong:[]}}`，全量渲染则已提交无归因。插入位于建议边界或格式末端不会触发，故内部位置是关键条件。
 */
export const testRdtBaseInsertIntoOverlappingFormatRangeCacheDrift = () => {
  const base = new Y.Doc({ gc: false })
  base.clientID = 0
  const sugg = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sugg.clientID = 1
  const renderer = Y.createDiffRenderer(base, sugg, { attributions: Y.createContentMap() })
  renderer.suggestionMode = true
  const bt = base.get('t')
  const st = sugg.get('t')
  bt.applyDelta(delta.create().insert('abc').done())
  st.useRenderer(renderer)
  t.assert(st.delta != null) // 物化缓存。
  // 建议 strong 覆盖 `a`。
  st.applyDelta(delta.create().retain(1, { strong: {} }).done())
  // 基线 strong 覆盖 `abc`，与同键建议重叠。
  bt.applyDelta(delta.create().retain(3, { strong: {} }).done())
  // 在 `b`/`c` 间基线插入；change 必须在尾部 `c` 前关闭 attributed range。
  bt.applyDelta(delta.create().retain(2).insert('x').done())
  const cached = st.delta
  const fresh = st.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after a base insert into the overlapping format range')
}

/**
 * 回归验证 attribution install gate 必须安装“全部为 null-clear leaf”的上下文副本。
 *
 * em/strong 两个建议格式重叠时，环境副本含逐键 null clear；旧空值判断丢弃无归因 close marker 的键删除。随后在 em 范围内部建议插入 `x` 会把陈旧 `{format:{strong:[]}}` 刷入尾部缓存。clientID 次序是关键：base > sugg 时复现。
 */
export const testRdtSuggestedInsertUnderTwoKeySuggestedFormatsCacheDrift = () => {
  const base = new Y.Doc({ gc: false })
  base.clientID = 1
  const sugg = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sugg.clientID = 0
  const renderer = Y.createDiffRenderer(base, sugg, { attributions: Y.createContentMap() })
  renderer.suggestionMode = true
  const bt = base.get('t')
  const st = sugg.get('t')
  bt.applyDelta(delta.create().insert('abcd').done())
  st.useRenderer(renderer)
  t.assert(st.delta != null) // 物化缓存。
  // 两个建议格式重叠，形成双键 attributed 上下文。
  st.applyDelta(delta.create().retain(2, { em: {} }).done())
  st.applyDelta(delta.create().retain(4, { strong: {} }).done())
  // 基线 strong 覆盖 `ab`，键值与建议相同；此时缓存仍一致。
  bt.applyDelta(delta.create().retain(2, { strong: {} }).done())
  // 在 em 范围内部建议插入，迫使 change render 重扫并暴露陈旧 strong 上下文。
  st.applyDelta(delta.create().retain(1).insert('x').done())
  const cached = st.delta
  const fresh = st.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after a suggested insert under a two-key suggested format context')
}

/**
 * 回归验证双键建议格式下的“带格式基线插入”同样安装全 null-leaf 上下文。
 *
 * 建议 em 覆盖 `ab`、strong 覆盖 `a`；基线 em 只覆盖 `a`，再在上下文前插入带另一个建议键 strong 的 `x`。旧缓存会让尾部 `b` 残留 `{format:{em:[]}}`。插入键、位置、覆盖范围及 base > sugg 的 clientID 次序均为关键条件，区别于普通插入同类用例。
 */
export const testRdtFormattedBaseInsertUnderTwoKeySuggestedFormatsCacheDrift = () => {
  const base = new Y.Doc({ gc: false })
  base.clientID = 1
  const sugg = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sugg.clientID = 0
  const renderer = Y.createDiffRenderer(base, sugg, { attributions: Y.createContentMap() })
  renderer.suggestionMode = true
  const bt = base.get('t')
  const st = sugg.get('t')
  bt.applyDelta(delta.create().insert('ab').done())
  st.useRenderer(renderer)
  t.assert(st.delta != null) // 物化缓存。
  // 两个建议格式重叠，em 范围长于 strong。
  st.applyDelta(delta.create().retain(2, { em: {} }).done())
  st.applyDelta(delta.create().retain(1, { strong: {} }).done())
  // 基线 em 仅覆盖 `a`，未覆盖完整建议范围；尾部治理状态潜在陈旧但暂未显现。
  bt.applyDelta(delta.create().retain(1, { em: {} }).done())
  // 在上下文前插入带另一建议键 strong 的基线内容，触发重扫。
  bt.applyDelta(delta.create().insert('x', { strong: {} }).done())
  const cached = st.delta
  const fresh = st.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after a formatted base insert under a two-key suggested format context')
}

/**
 * 回归验证 `previousFormats` 跟踪：基线格式范围末端落在同键建议格式 span 内部时，不得把格式泄漏到后一字符。
 *
 * fuzz seed 711/4935 均化简为四步：`b` 已有 em，追加两个 `x`，建议 em 跨过基线格式末端，再让基线 em 只覆盖前三字符。历史缓存把尾部 `x` 错误格式化；此处是格式值漂移而非 attribution 漂移。预存格式、两个边界字符、同键与操作顺序均为必要条件。
 */
export const testRdtBaseFormatEndingInsideSuggestedFormatRangeFormatValueCacheDrift = () => {
  const base = new Y.Doc({ gc: false })
  base.clientID = 0
  const sugg = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sugg.clientID = 1
  const renderer = Y.createDiffRenderer(base, sugg, { attributions: Y.createContentMap() })
  renderer.suggestionMode = true
  const bt = base.get('t')
  const st = sugg.get('t')
  bt.applyDelta(delta.create().insert('ab').done())
  st.useRenderer(renderer)
  t.assert(st.delta != null) // 物化缓存。
  // `b` 上预先存在基线 em。
  bt.applyDelta(delta.create().retain(1).retain(1, { em: {} }).done())
  // 在 em run 后追加两个普通字符。
  bt.applyDelta(delta.create().retain(2).insert('xx').done())
  // 对新增 `xx` 建议同键 em。
  st.applyDelta(delta.create().retain(2).retain(2, { em: {} }).done())
  // 基线 em 覆盖 `abx`，末端严格落在建议 span 内；尾部 `x` 不应继承格式。
  bt.applyDelta(delta.create().retain(3, { em: {} }).done())
  const cached = st.delta
  const fresh = st.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after a base format ending inside a same-key suggested format range')
}

/**
 * 回归验证 `isDeletedFormatClear` 的开放 attributed-range 守卫：建议移除被覆盖的基线格式时不得丢失 removal attribution。
 *
 * 基线 em 覆盖 `ab`，建议先把 `b` 的 em 覆盖为不同值，再设 null。缓存必须像全量渲染一样保留 `b` 的 `{format:{em:[]}}`。基线范围越过目标字符及“先不同值覆盖”是关键条件；两种 clientID 次序均稳定复现。
 */
export const testRdtSuggestedRemovalOfOverriddenBaseFormatCacheDrift = () => {
  const base = new Y.Doc({ gc: false })
  base.clientID = 0
  const sugg = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sugg.clientID = 1
  const renderer = Y.createDiffRenderer(base, sugg, { attributions: Y.createContentMap() })
  renderer.suggestionMode = true
  const bt = base.get('t')
  const st = sugg.get('t')
  bt.applyDelta(delta.create().insert('ab').done())
  st.useRenderer(renderer)
  t.assert(st.delta != null) // 物化缓存。
  // 基线 em 覆盖整个 `ab`，严格越过建议触及字符。
  bt.applyDelta(delta.create().retain(2, { em: {} }).done())
  // 建议以不同值覆盖 `b` 的基线格式。
  st.applyDelta(delta.create().retain(1).retain(1, { em: { x: 1 } }).done())
  // 再建议移除 `b` 的 em，必须保留 removal attribution。
  st.applyDelta(delta.create().retain(1).retain(1, { em: null }).done())
  const cached = st.delta
  const fresh = st.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after a suggested removal of an overridden base format')
}

/**
 * 回归验证分两步从左到右建议取消同一基线格式时，两段都保留 unformat attribution。
 *
 * lifecycle fuzz 的 clearCache 并非必要条件；核心场景是基线一次格式化 `ab`，再分别取消 `a`、`b`。旧缓存丢失第二步 `b` 的 `{format:{em:[]}}`。两步顺序和基线单次覆盖整段是关键，格式键、值与 clientID 次序不关键。
 */
export const testRdtStagedSuggestedUnformatOfBaseFormatCacheDrift = () => {
  const base = new Y.Doc({ gc: false })
  base.clientID = 0
  const sugg = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sugg.clientID = 1
  const renderer = Y.createDiffRenderer(base, sugg, { attributions: Y.createContentMap() })
  renderer.suggestionMode = true
  const bt = base.get('t')
  const st = sugg.get('t')
  bt.applyDelta(delta.create().insert('ab').done())
  st.useRenderer(renderer)
  t.assert(st.delta != null) // 物化缓存。
  // 基线 em 一次覆盖 `ab`；suggestion mode 下基线格式本身不是建议。
  bt.applyDelta(delta.create().retain(2, { em: {} }).done())
  // 从左到右分步取消：先取消 `a`，缓存仍一致。
  st.applyDelta(delta.create().retain(1, { em: null }).done())
  // 再取消 `b`，第二步也必须保留 `{format:{em:[]}}`。
  st.applyDelta(delta.create().retain(1).retain(1, { em: null }).done())
  const cached = st.delta
  const fresh = st.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after a staged suggested unformat of a base format')
}

/**
 * 回归验证 acceptAll 对“相邻且同键同值”的已提交/建议格式去归因。
 *
 * 初始 `a` 已提交 strong，邻接 `b` 普通；建议把 `b` 设为相同 strong 后 acceptAll。`currentFormatsAttributed` 必须识别重新暴露的 committed strong 并清除 `b` 的 `{format:{strong:[]}}`。同键、同值、邻接与 committed 在前均为关键；不同于节点插入归因泄漏。
 */
export const testRdtAcceptAllOfSameValueSuggestedFormatCacheDrift = () => {
  const base = new Y.Doc({ gc: false })
  base.clientID = 0
  const sugg = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sugg.clientID = 1
  const renderer = Y.createDiffRenderer(base, sugg, { attributions: Y.createContentMap() })
  renderer.suggestionMode = true
  const bt = base.get('t')
  const st = sugg.get('t')
  // 初始渲染即含 committed strong `a` 与普通 `b`。
  bt.applyDelta(delta.create().insert('a', { strong: {} }).insert('b').done())
  st.useRenderer(renderer)
  t.assert(st.delta != null) // 物化缓存。
  // 对邻接 `b` 建议同键同值 strong。
  st.applyDelta(delta.create().retain(1).retain(1, { strong: {} }).done())
  // 建议状态本身一致，漂移只可能由 accept 触发。
  t.assert(st.delta.equals(st.toDelta({ deep: true })), 'suggested format itself is consistent')
  renderer.acceptAllChanges()
  const cached = st.delta
  const fresh = st.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after accepting a same-value suggested format extension')
}

/**
 * 回归验证 rejectAll 后不残留已删除建议格式的 provenance。
 *
 * 建议 strong 覆盖 `a`，随后基线同键 strong 覆盖整个 `ab` 并严格越过建议范围；reject 后两字符都应是 committed strong、无 attribution。旧事件 render 让尾部 `b` 残留 `{format:{strong:[]}}`。前置缓存一致，漂移仅由 reject 触发；base < sugg 的 marker 次序为关键。
 */
export const testRdtRejectAllOverlappingSameKeyFormatProvenanceResidual = () => {
  const base = new Y.Doc({ gc: false })
  base.clientID = 0
  const sugg = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sugg.clientID = 1
  const renderer = Y.createDiffRenderer(base, sugg, { attributions: Y.createContentMap() })
  renderer.suggestionMode = true
  const bt = base.get('t')
  const st = sugg.get('t')
  bt.applyDelta(delta.create().insert('ab').done())
  st.useRenderer(renderer)
  t.assert(st.delta != null) // 物化缓存。
  // 建议 strong 覆盖 `a`。
  st.applyDelta(delta.create().retain(1, { strong: {} }).done())
  // 基线同键 strong 覆盖 `ab`，严格越过建议 span。
  bt.applyDelta(delta.create().retain(2, { strong: {} }).done())
  t.assert(st.delta.equals(st.toDelta({ deep: true })), 'consistent before the reject')
  // reject 后尾部 `b` 不得保留建议格式 attribution。
  renderer.rejectAllChanges()
  const cached = st.delta
  const fresh = st.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after rejecting overlapping same-key formats')
}

/**
 * 回归验证 partial accept 拆开建议格式 open/close marker 对后，后续 unformat 不会把另一格式 attribution 泄漏到尾字符。
 *
 * `AB` 的 `A` 上有 em 与 strong 两个不同键建议；只接受 em close marker（clock 1），留下拆分 marker 对。accept 当下仍一致，随后取消 em 才会暴露潜在状态。修复要求安装全 null-leaf 环境副本时把 reset 键显式 clear。关键条件：接受 close 而不接受 open、存在第二个非空不同键格式、尾部字符及最终 unformat。
 */
export const testRdtSplitFormatMarkerPairPartialAcceptThenUnformatCacheDrift = () => {
  const base = new Y.Doc({ gc: false })
  base.clientID = 0
  const sugg = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sugg.clientID = 1
  const renderer = Y.createDiffRenderer(base, sugg, { attributions: Y.createContentMap() })
  renderer.suggestionMode = true
  const bt = base.get('t')
  const st = sugg.get('t')
  bt.applyDelta(delta.create().insert('AB').done())
  st.useRenderer(renderer)
  t.assert(st.delta != null) // 物化缓存。
  // `A` 上两个不同键建议：clock 0/1 为 em 开闭，2/3 为 strong 开闭。
  st.applyDelta(delta.create().retain(1, { em: {} }).done())
  st.applyDelta(delta.create().retain(1, { strong: {} }).done())
  // 只接受 em close marker，拆开 marker 对；accept 当下仍一致。
  renderer.acceptChanges(Y.createID(1, 1), Y.createID(1, 1))
  t.assert(st.delta.equals(st.toDelta({ deep: true })), 'consistent immediately after the marker-splitting accept')
  // 随后取消 `A` 的 em，尾部 `B` 不得泄漏 strong attribution。
  st.applyDelta(delta.create().retain(1, { em: null }).done())
  const cached = st.delta
  const fresh = st.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after unformatting under a split-accepted format marker pair')
}

/**
 * 回归验证 partial accept 跳过 unformat open marker 后，后续不同键格式变化不会在邻接字符留下陈旧 attribution。
 *
 * 基线 strong 覆盖 `abc`；`b` 上建议 strong:null（clock 0/1）和 em（clock 2/3）；只接受 clock 1 的 restore marker。accept 当下仍一致，随后移除 em 才会暴露尾部 `c` 的伪 `{format:{strong:[]}}`。partial 范围必须排除 clock 0、第二格式必须先存在且不同键、基线范围必须跨过 `b` 两侧。
 */
export const testRdtPartialAcceptSkippingUnformatOpenMarkerCacheDrift = () => {
  const base = new Y.Doc({ gc: false })
  base.clientID = 0
  const sugg = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sugg.clientID = 1
  const renderer = Y.createDiffRenderer(base, sugg, { attributions: Y.createContentMap() })
  renderer.suggestionMode = true
  const bt = base.get('t')
  const st = sugg.get('t')
  bt.applyDelta(delta.create().insert('abc').done())
  st.useRenderer(renderer)
  t.assert(st.delta != null) // 物化缓存。
  // committed strong 覆盖 `abc`，严格跨过 `b` 两侧。
  bt.applyDelta(delta.create().retain(3, { strong: {} }).done())
  // 对 `b` 建议取消 strong：clock 0 开启 null，clock 1 关闭并恢复 strong。
  st.applyDelta(delta.create().retain(1).retain(1, { strong: null }).done())
  // 同一 `b` 上增加不同键 em：clock 2/3 为开闭 marker。
  st.applyDelta(delta.create().retain(1).retain(1, { em: {} }).done())
  t.assert(st.delta.equals(st.toDelta({ deep: true })), 'consistent before the accept')
  // 只接受 clock 1 的范围末 restore marker，跳过 clock 0；潜在状态尚未显现。
  renderer.acceptChanges(Y.createID(1, 1), Y.createID(1, 1))
  t.assert(st.delta.equals(st.toDelta({ deep: true })), 'consistent after the partial accept')
  // 移除 em 触发重渲染；`c` 不得残留 strong attribution。
  st.applyDelta(delta.create().retain(1).retain(1, { em: null }).done())
  const cached = st.delta
  const fresh = st.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after a format edit following a partial accept that skipped the unformat open marker')
}

/**
 * 回归验证建议整块删除段落后，基线对内部文本的局部 unformat 会更新嵌套 tombstone 缓存。
 *
 * y-prosemirror seeds 143/2/18 均化简为：段落 `ab` 被建议整节点删除，基线 strong 覆盖两字符，再只清除尾部 `b`。mode-0 fresh 格式片段必须携带 fresh，使 reset-to-previous marker 发逐键 clear；最终 `a` 保留 format attribution，`b` 只保留 delete attribution。整块删除、基线 provenance、移除方向和尾部局部范围为关键。
 */
export const testRdtBaseUnformatInsideBlockDeletedParagraphCacheDrift = () => {
  const base = new Y.Doc({ gc: false })
  base.clientID = 0
  const sugg = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sugg.clientID = 1
  const renderer = Y.createDiffRenderer(base, sugg, { attributions: Y.createContentMap() })
  renderer.suggestionMode = true
  const bt = base.get('t')
  const st = sugg.get('t')
  bt.applyDelta(delta.create().insert([delta.create('paragraph', {}, 'ab')]).done())
  st.useRenderer(renderer)
  t.assert(st.delta != null) // 物化缓存。
  // 建议整块删除段落。
  st.applyDelta(delta.create().delete(1).done())
  // 基线 strong 覆盖 tombstone 内两字符，删除文本上显示 attributed format；此时仍一致。
  bt.applyDelta(delta.create().modify(delta.create('paragraph').retain(2, { strong: {} }).done()).done())
  t.assert(st.delta.equals(st.toDelta({ deep: true })), 'consistent before the unformat')
  // 只清除尾部 `b`，其 strong attribution 必须从缓存移除。
  bt.applyDelta(delta.create().modify(delta.create('paragraph').retain(1).retain(1, { strong: null }).done()).done())
  const cached = st.delta
  const fresh = st.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after a base partial unformat inside a block-deleted paragraph')
}

/**
 * 回归验证建议删除整段后，基线格式 clear 在同键格式 run 内部结束时不会丢失。
 *
 * y-prosemirror seed 103 可化简为：段落 `ab` 初始 em，整节点建议删除，基线只清除尾部 `b`。fresh 格式片段必须传播 `c.fresh`，让 change render 发 clear，而非把环境 `{format:{em:[]}}` 重新盖满整段。整节点 tombstone、clear 方向及原格式范围跨过目标字符为关键；键值与 clientID 次序不关键。
 */
export const testRdtBaseFormatClearInsideSuggestionDeletedParagraphCacheDrift = () => {
  const base = new Y.Doc({ gc: false })
  base.clientID = 0
  const sugg = new Y.Doc({ isSuggestionDoc: true, gc: false })
  sugg.clientID = 1
  const renderer = Y.createDiffRenderer(base, sugg, { attributions: Y.createContentMap() })
  renderer.suggestionMode = true
  const bt = base.get('t')
  const st = sugg.get('t')
  // 基线段落的 em run 覆盖 `ab`。
  bt.applyDelta(delta.create().insert([delta.create('paragraph').insert('ab', { em: {} })]).done())
  st.useRenderer(renderer)
  t.assert(st.delta != null) // 物化缓存。
  // 建议删除整段，继续作为 attributed tombstone 显示。
  st.applyDelta(delta.create().delete(1).done())
  t.assert(st.delta.equals(st.toDelta({ deep: true })), 'cache consistent after the suggestion delete')
  // 基线只清除 `b` 的 em；clear 末端位于原 em run 与 tombstone 内部。
  bt.applyDelta(delta.create().modify(delta.create().retain(1).retain(1, { em: null })).done())
  const cached = st.delta
  const fresh = st.toDelta({ deep: true })
  if (!cached.equals(fresh)) {
    console.error('cached:', JSON.stringify(cached.toJSON()))
    console.error('fresh :', JSON.stringify(fresh.toJSON()))
  }
  t.assert(cached.equals(fresh), 'maintained .delta must equal a fresh deep render after a base format clear inside a suggestion-deleted paragraph')
}

/**
 * 验证 AttributionsRenderer 只突出 state1→state2 且在 state3 仍活跃的变更：已撤回插入退出，新删除保持 delete attribution。
 *
 * Given：`hella → hello! → hello world` 三个可见状态，再把当前内容替换为 `42`。
 * When：以 state3 可见 inserts 作为 renderedContent，并取 `(state2-state1)∩state3` attribution。
 * Then：只把 `a` 标为删除、`o` 标为插入，其余 state3 内容正常显示。
 *
 * @param {t.TestCase} _tc
 */
export const testAttributionRendererActiveChangesInDiff = _tc => {
  const ydoc = new Y.Doc({ gc: false })
  const ytext = ydoc.get()
  ytext.insert(0, 'hella')
  const state1 = Y.createContentIdsFromDoc(ydoc, true)
  ytext.applyDelta(delta.create().retain(4).delete(1).insert('o!').done())
  const state2 = Y.createContentIdsFromDoc(ydoc, true)
  ytext.applyDelta(delta.create().retain(5).delete(1).insert(' world').done())
  // state3 只捕获可见内容：`!` 已插入后删除，不再是活跃插入；`a` 不在 renderedContent，故保持 delete attribution 而非被恢复成 insert。
  const state3 = Y.createContentIdsFromDoc(ydoc, false)
  ytext.applyDelta(delta.create().delete(11).insert('42').done())

  // 渲染 state1→state2 中在 state3 仍活跃的变化。
  const attrs = Y.createContentMapFromContentIds(Y.intersectContentIds(Y.excludeContentIds(state2, state1), state3), [], [])
  const renderer = Y.createAttributionsRenderer(attrs, { renderedContent: state3.inserts })

  const attrDelta = ytext.toDelta({ renderer })
  console.log(attrDelta.toJSON())
  t.compare(attrDelta, delta.create().insert('hell').insert('a', null, { delete: [] }).insert('o', null, { insert: [] }).insert(' world').done())
}
