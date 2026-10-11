/**
 * 验证 attribution 视图的坐标、事件、建议接受/拒绝，以及 lib0 RDT 绑定和增量缓存。
 *
 * 关键回归会把已维护的 `type.delta` 与一次新的深层渲染比较，检查事件是否足以重建当前视图。
 */

import * as Y from '../src/index.js'
import * as t from 'lib0/testing'
import * as delta from 'lib0/delta'
import * as prng from 'lib0/prng'
import * as math from 'lib0/math'
import { bind, $rdt } from 'lib0/delta/rdt'
import { init } from './testHelper.js' // eslint-disable-line

/**
 * hello world 的克隆为基线，当前文档删掉索引 1 的六字符并插入 x，diff 视图仍显示旧内容；在建议视图索引 9 创建相对位置，再分别按 Renderer 与普通视图解析。同一位置的索引分别为 9 与 3。
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
  const rel = Y.createRelativePositionFromTypeIndex(ytext, 9, 1, renderer) // 渲染内容为 `hello wxorld`，索引 9 位于 `r` 前；普通内容 `hxorld` 的同一位置是索引 3。
  const abs1 = Y.createAbsolutePositionFromRelativePosition(rel, ydoc, true, renderer)
  const abs2 = Y.createAbsolutePositionFromRelativePosition(rel, ydoc, true)
  t.assert(abs1?.index === 9)
  t.assert(abs2?.index === 3)
}

/**
 * 基线为 hello world，当前文档已删 world，diff 视图仍显示带 delete 归因的旧词；注册 observer 后按 Renderer retain 11 并插入 !。初始完整视图符合预期，observer 确实运行，变化为 retain 11 加带 insert 归因的 !。
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
 * 基线为 hello world，当前文档只剩 hello 加空格，DiffRenderer 保留 world 删除建议；按 Renderer retain 11 后插入 content。初始归因视图匹配预期，实际存活字符串为 hello content。
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
 * 基线为 hello 加空格，当前文档新增 word 作为插入建议；按 Renderer retain 9，在 word 的 r/d 之间插入 l。归因初值匹配 hello 加带 insert 的 word，实际存活字符串变为 hello world。
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

/**
 * 基线已有文本 hello、数组三数、map 的 k 和空 nested 子类型，目标为其克隆；目标追加文本、数组位置 1 插 x、新增属性及 nested 子内容。文档 diff 以各根键 modifyAttr 合成预期深层变化，新增内容均带空作者 insert 归因。
 * 自定义 attribution 仍是下方 todo，此用例只比较默认空作者归因。
 */
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

/**
 * 基线为空，目标空根数组已注册 observeDeep；preliminary test 节点预存文本和 k=v；把新节点集成到目标数组，再计算文档 diff。恰有一次深层事件带完整子状态，diff 给节点、文本和属性加 insert 归因。
 */
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
 * 三端空文本记录本地 update 的作者，user0 关闭 GC，并保存空基线；两端分别插 a/b，再删 b、插 c；随后只筛 user0 的 ID 并撤销。第一视图 a/b 标作者0/1，第二视图 b 标作者0删除、c 标作者1插入；筛选后只有user0变更归因，撤销后文本为 bc。
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
 * 根已有 p 节点及 hi，克隆基线并建 DiffRenderer，根注册 observeDeep；删除 p 节点。observer 确实运行，事件以 modify 包含 retain(2) 的文本 delete 归因，父节点也带 delete 归因。
 * 旧节点仍在建议视图，不以删除整段的 DeleteOp 更新消费方。
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

/**
 * 基线与当前均为 hi，当前已插 ! 作为建议，Renderer 注册 change handler；把当前完整更新应用到基线以接受新增内容。handler 确实运行；变化 retain hi 后 retain ! 并以 attribution=null 清掉原 insert 归因。
 * null 是清理指令，undefined 只会跳过归因更新。
 */
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

/**
 * 两个独立文档的文本都为空，用 lib0 bind 建双向绑定；A 插 hello、B 追加 world，然后 destroy 绑定再在 A 头插 x。销毁前两端为 hello world，销毁后 A 变为 xhello world 而 B 保持原文。
 */
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

/**
 * 空根类型注册 delta listener；本地插入 hello。捕获 Delta 等于一次 hello insert。
 */
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

/**
 * 空文本注册 listener 保存 origin；分别用自定义外层事务、无 origin 插入、自定义 applyDelta origin、无 origin applyDelta 编辑。事件来源依次为原对象、null、applyOrigin 原对象、null。
 */
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

/**
 * 基线 hello world，当前删除 world，已保存显式 Renderer 渲染结果；把 DiffRenderer 安装为根默认视图，再无参调用 toDelta。无参结果等于显式结果，旧 world 仍带 delete 归因。
 */
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

/**
 * 两组新文档各有一个注册 destroy listener 的根类型；第一组直接销毁类型，第二组销毁文档。两组计数各为 1。
 * 没有检验重复 destroy 调用或嵌套类型销毁。
 */
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

/**
 * 根数组已有空子类型，父子都注册 delta listener；子类型插 hi。父子计数各为 1，父事件为非空 Delta。
 * 未直接比较父 Delta 的 modify 结构，也未注册 observeDeep 作对照。
 */
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

/**
 * 文本已有 hello 且已取得活 delta 对象；数组另有含 a 的子类型并取得父缓存；文本追加 world，子类型追加 b。两组缓存身份都不变，内容与全量深层渲染相同；文本还独立匹配 hello world。
 */
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

/**
 * hello 文本的 delta 已物化；clearCache 后再次读取 getter。内部引用先为 null，新缓存对象身份不同且内容仍为 hello。
 */
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

/**
 * 当前 hello 加空格已删除基线 world，普通视图 delta 已物化并注册 listener；切换到显示旧 world 的 DiffRenderer。捕获非空 delta，缓存包含带 delete 归因的 world。
 * 未单独监视 YEvent、比较事件完整内容或检查其 origin。
 */
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

/**
 * 准备一个集成根类型、一个未集成 Y.Type、普通对象与 null；逐个调用 lib0 $rdt.check。两种 YType 通过，普通对象和 null 不通过。
 */
export const testRdtConformsToRdtSchema = () => {
  t.assert($rdt.check(new Y.Doc().get()))
  t.assert($rdt.check(new Y.Type()))
  t.assert(!$rdt.check({}))
  t.assert(!$rdt.check(null))
}

/**
 * 按当前类型的 toArray 视图收集子列表 YType，按普通存活属性视图收集属性 YType，逐层广度展开。
 * 根装有 Renderer 时可能把删除子类型纳入候选；子类型并不自动继承根 Renderer，因此这不是统一 Renderer 的整树遍历。
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
 * 从 collectTypes 的当前候选中随机选一个类型，执行一次文本/嵌套插入、删除、bold 或属性变更。
 * 索引使用目标自己的原始 length；空目标的删除/格式分支不执行，已删除子类型无默认 Renderer 的写入也可被静默丢弃。
 * 本 helper 无断言，调用方逐轮比较缓存与全量渲染。
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
 * 新文档空根树与测试 PRNG；300 轮随机选择树中类型作文本/嵌套插入、删除、bold 修改或属性编辑。每轮收集到的类型 delta 都等于新深层渲染。
 * 新类型第一次读 getter 是全量物化；存续类型的后续编辑才检验已建立缓存的增量维护。
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
 * 两副本已同步 shared baseline content，各根绑定对自己固定克隆的 DiffRenderer；300 轮任选一端随机编辑后排空消息。两端 delta 每轮相等，第一端还等于自己的新深层渲染。
 * 未额外比较第二端缓存与其全量渲染；首次读取仍会物化，后续轮次维护缓存。
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
 * 两个同步副本已有 shared baseline content，各有固定基线 DiffRenderer，使用 seed=1；40 轮随机树编辑，每轮双向交换增量更新并读取第一端缓存。每轮第一端 delta 与新深层渲染相等。
 * 格式移除需要同时清格式值和逐键归因；循环包含多种操作，不声称每一轮都发生取消格式。
 */
export const testRdtFormatRemovalDrift = () => {
  const gen = prng.create(1) // 固定 seed 保证复现。
  const docs = [new Y.Doc(), new Y.Doc()]
  const [d0, d1] = docs
  /** 先把 d0 相对 d1 状态向量的缺失更新应用到 d1，再把 d1 相对更新后的 d0 的缺失事实传回；同步写入也触发各自 Renderer 监听。 */
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
 * abcdef 相对未格式化克隆做 diff，缓存已物化；全文加粗、取消 cd、再给 cd 加粗。初值明确匹配 abcdef，最后缓存等于全量渲染。
 * 同键建议范围仍打开时，删除临时清除标记不应误清环境归因。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
 * ab 相对未格式化基线做 diff，缓存已物化；把 ab 加粗后在中间插入无格式空子类型。初值明确匹配 ab，最后缓存等于全量渲染。
 * 插入的完整格式先关闭 bold 再恢复，fresh insert 不能继承仅供旧内容 retain 清理的 null 归因。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
 * 字符 a 相对未格式化基线做 diff，缓存已物化；给 a 加粗后删除 a。初值匹配 a，最后缓存等于全量渲染。
 * 格式墓碑清理须同时反映 changedFormats 与格式归因范围结束。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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

/**
 * 普通空根先写 hello 和 k=v，开始读取缓存；在末尾插子类型、子内写 world/!，再删根首字符。初值匹配显式文本/属性 Delta，后续父子缓存均等于全量渲染，子值还明确匹配 world!。
 */
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

/**
 * 空克隆作基线，文档记录本地 update 的作者 ID 到内容映射；插 hello 后以该映射安装 DiffRenderer。缓存明确为带本 clientID insert 归因的 hello，并等于全量渲染。
 */
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
 * 关闭 GC 的基线/建议文档含 hello world 段落，根绑定 renderer 并物化缓存；建议模式删 llo 加空格，切接受模式后跨仍显示的范围设置 code 格式。最后维护的 delta 与新一次 toDelta(deep:true) 相等。
 * 接受模式把变更同步到基线，格式归因修正还须更新现有缓存。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
 * 创建关闭 GC、固定 clientID 的基线/建议文档与 hello world 段落，并建立跟踪两文档的 DiffRenderer。
 *
 * 先建立 Renderer 再向基线写段落，使建议文档通过监听获得初值；多数调用用两种 clientID 顺序检查同位置边界次序。
 *
 * @param {number} baseClientID - 基线 clientID。
 * @param {number} sdocClientID - 建议文档 clientID。
 * @param {boolean} [useRootRenderer] - 默认在建议根绑定 renderer；false 用于根普通视图、子类型自带 Renderer 的对照。
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
 * 两种 clientID 顺序（基线/建议为 1/2 与 2/1）各建关闭 GC 的 hello world 段落，根绑定 DiffRenderer 并物化缓存；建议删除整个段落后，基线在段落内部索引2插 XY。两种顺序下建议删除和远端编辑各触发一次根 delta，远端事件非空，新渲染含 XY 且缓存相等。
 * 新ID集成到已删除父项后自动删除，仍需保留已归因的 insertSet∩deleteSet 部分。
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

/**
 * 两种 clientID 顺序（基线/建议为 1/2 与 2/1）各建关闭 GC 的 hello world 段落，根绑定 DiffRenderer 并物化缓存；建议删整个段落后，基线在其内部插含 fresh 文本的新段落子类型。远端编辑每种顺序触发一次根 delta，全量 JSON 含 fresh，缓存等于全量渲染。
 * 新 ContentType 从未进入消费方，fresh mode 应深层 insert 而非 retain 旧节点。
 */
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

/**
 * 两种 clientID 顺序（基线/建议为 1/2 与 2/1）各建关闭 GC 的 hello world 段落，根绑定 DiffRenderer 并物化缓存；建议文档同事务在子段落索引2插 zz 后删同两字符。两种顺序下全量 JSON 不含 zz，缓存与其相等。
 * 同事务新增又删且没有可显示归因时，不应把交集ID送入消费方状态。
 */
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
 * 基线 client1 的 XY 已同步到 client2 建议根，缓存已物化；建议插 a 的 delta callback 中只反应一次：新事务在 a 后插 b 再删 ab。callback 确实反应，最终缓存等于全量渲染。
 * 外层 cleanup 可先合并相邻删除 Item；fresh 判定必须按本次插入ID子区间，而非合并 Item 首ID。
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
 * 比较完整渲染状态未变化、当前缓存一致，并验证预期状态依次应用 d/fix 后回到实际状态。
 * 使用 cloneDeep 与 final/move 应用，避免修改输入快照；只比较渲染状态，不断言内部结构或 ID 集完全未变。
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

/**
 * 两种 clientID 顺序（基线/建议为 1/2 与 2/1）各建关闭 GC 的 hello world 段落，根绑定 DiffRenderer 并物化缓存；建议删除父段落后，再对它 modify(retain2+insert XY)。fix 明确为嵌套 retain2+delete2，未发 delta、未写 XY，assertRevertedApply 检查实际状态与 inverse 往返。
 * 修改仍显示的软删除节点进入 applyDelta 保护分支，不执行文档写入。
 */
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

/**
 * 两种 clientID 顺序（基线/建议为 1/2 与 2/1）各建关闭 GC 的 hello world 段落，根绑定 DiffRenderer 并物化缓存；建议删父段落后，尝试 modify 内 retain2+delete4。fix 非空，其 JSON 含 llo 加空格及 delete 归因；实际状态不变，预期状态加 fix 可回到实际。
 * 重插来自渲染基线，必须保留调用方看到的删除归因。
 */
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

/**
 * 两种 clientID 顺序（基线/建议为 1/2 与 2/1）各建关闭 GC 的 hello world 段落，根绑定 DiffRenderer 并物化缓存；建议删父段落后，尝试给内部四字符设置 bold。fix 明确为嵌套 retain1+retain4(bold:null)，实际状态不变且 inverse 往返正确。
 * 只比较渲染状态，没有直接统计是否创建内部 marker。
 */
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
 * 两种 clientID 顺序各建关闭 GC 的基线/建议文档，根绑定 DiffRenderer 并物化缓存；树有 aa、bb 两段，基线两段都带 align=x；建议删除第二段，再尝试以 modify.format 把它改为 align=y。fix 为 retain1+modify(空Delta,align=x)，实际状态及 inverse 往返保持一致。
 * 恢复值须在游标走过节点前的活 align 标记后读取。
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
 * 两种 clientID 顺序各建关闭 GC 的基线/建议文档，根绑定 DiffRenderer 并物化缓存；树有 aa、hello world、cc，建议删中间段；一个 Delta 头插 nn，越过 aa，分别对删除中段插 XY、存活尾段插 ZZ。恰发一次 delta；nn/ZZ 已落地而 XY 没有，fix 为 retain2+嵌套delete2，缓存相等。
 * fix 用调用方预期输出坐标，padding 包含本 Delta 更早新增的 nn 节点。
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
 * 两种 clientID 顺序各建关闭 GC 的基线/建议文档，根绑定 DiffRenderer 并物化缓存；map 的 title 属性是含 hi 的子类型；建议删除 title 后，再以 modifyAttr 给该值插 X。fix 为 modifyAttr(title,delete1)，不抛错；实际状态不变且 inverse 往返正确。
 * Renderer 查找能定位仍显示的删除属性值，普通 typeMapGet 看不到它。
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

/**
 * 关闭 GC 的普通文档含 hello 段落，已保存子类型引用；普通删除段落后，直接对子类型 retain2+insert XY。返回 null，根完整深层状态仍为空。
 * 根为空的断言未单独读取已删除子类型内部结构。
 */
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

/**
 * 两种 clientID 顺序（基线/建议为 1/2 与 2/1）各建关闭 GC 的 hello world 段落，根绑定 DiffRenderer 并物化缓存；保存子引用并建议删父段，先无 Renderer、再显式有 Renderer 尝试对子类型插 XY。无 Renderer 返回 null；显式传入返回 retain2+delete2 inverse，根状态/缓存不变，子层 inverse 往返正确。
 * 根的默认 Renderer 不会自动成为子类型默认 Renderer。
 */
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

/**
 * 两种 clientID 顺序各建关闭 GC 的基线/建议文档，根绑定 DiffRenderer 并物化缓存；活段落内含 ww 嵌套节点；只建议删除孙节点，再由根 modify→modify 尝试在孙节点插 X。fix 明确是双层 modify 包裹 delete1，实际状态不变且往返正确。
 * 父级按输入节点位置逐层包装子 fix，活父存在不解除孙节点删除保护。
 */
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
 * 两种 clientID 顺序各建关闭 GC 的基线/建议文档，根绑定 DiffRenderer 并物化缓存；树含 aa、hello world、cc，中段已建议删除；普通 delete(3) 跨两个存活段落与仍显示的中段。返回 null，最终缓存与全量渲染相等。
 * 普通 delete 记录 attributedDeletes 元数据但不创建 modify inverse；本用例未直接读取元数据。
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
 * 两种 clientID 顺序各建关闭 GC 的基线/建议文档，根绑定 DiffRenderer 并物化缓存；基线 abc 后有 nA=kk、nB=qqq，建议已删 bc 和两节点；从 b 开始删一字符、retain c，再 modify 删除 nA 内两个字符。fix 含 kk、不含 qq，实际渲染无变化，缓存相等。
 * 消费在归因删除片段中间结束时须切 Item，否则游标会错过 c 并选到 nB。
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
 * 两种 clientID 顺序各建关闭 GC 的基线/建议文档，根绑定 DiffRenderer 并物化缓存；title 子类型含 hi，建议已删该属性；基线在仍显示的删除属性值末尾插 XY。每种顺序根 delta 恰发一次，全量 JSON 含 XY，缓存相等。
 * 删除值内部变化需用完整带归因 setAttr 刷新，变化型 modifyAttr 不能作为该旧值替换。
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

/**
 * 两种 clientID 顺序（基线/建议为 1/2 与 2/1）各建关闭 GC 的 hello world 段落，根绑定 DiffRenderer 并物化缓存；建议删整个段落后，基线给内部四字符设置 bold。根 delta 各触发一次，最终缓存等于全量渲染。
 * 新格式标记集成到删除父项后仍按格式状态机 retain 路径解释，fresh 状态参与范围清理。
 */
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
 * 两个关闭 GC 的普通文档已同步段落，Q 根已物化缓存并注册三个观察通道；Q 普通删除段落后，P 在段内插 XY，再把 P 更新应用到 Q。自身删除发根 delta/浅事件；远端内部修改只使 observeDeep 加1，delta/浅事件为0，缓存相等。
 * 祖先仍登记深层变化，但空可见 Delta 抑制 delta 通道。
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
 * fixture 根用普通视图，子段落单独绑定 DiffRenderer，父子缓存都已物化；根建议删除段落，再由基线格式化其内部。根只为自身删除发一次delta；子delta在远端格式后加1，浅observer累计至少1次，两级缓存相等。
 * 浅observer只检验总次数>=1，没有单独隔离远端格式的浅通知。
 */
export const testRdtDeletedTypeWithOwnRendererFires = () => {
  const { doc, renderer, ytype } = createSuggestionPair(1, 2, false)
  const parB = /** @type {any} */ (ytype.get(0))
  parB.useRenderer(renderer)
  t.assert(parB.delta != null) // 段落删除前先物化其 Renderer 缓存，随后检验删除及远端编辑后的维护。
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

/**
 * 两个普通文档已同步段落，Q 根建 UndoManager；Q 本地删段落后，P 在其内部插 XY，再以未跟踪 remote-origin 同步。本地删除后 undoStack 为1，远端编辑后仍为1。
 * 此处只断言未新增捕获，不单独证明 scope 匹配过程或远端变更在已跟踪 origin 下会入栈。
 */
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
 * 两组关闭 GC 的基线/建议文档各有 base para，建议根都先物化缓存；第一组接受模式直接插 plain；第二组建议模式插 sugg 后 acceptAll。第一组基线明确含 plain、全量无 attribution 且缓存相等；第二组接受前后缓存各等于全量渲染。
 * 第二组未单独断言最终归因字段缺失，去归因应按深层ID范围修复。
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
 * 接受模式 fixture 已有 base para，composed 从完整状态克隆并监听所有 delta；追加 plain，再追加 blockquote→paragraph(deep) 的多层节点。两次最终新渲染及 composed 都无 attribution，事件顺序组合与新渲染相等。
 * 检查 settled 组合结果，不限定初次 insert 是否临时带归因或修正事件数量。
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
 * 基线已有 base para，建议根物化缓存；建议插新段落 x，再在其中追加 Q，然后仅选择该节点自身 ID 接受。基线出现第二段落，合并父 insert 无归因，子内容仍有 insert 归因，缓存等于全量渲染。
 * 这个具体选择保留子建议；不把 acceptChanges 一般描述为绝不扩展范围的精确ID过滤。
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
 * 关闭 GC 的 base0/sugg1 已有 abc，建议根物化缓存；建议 strong 覆盖 a，基线 strong 覆盖 abc，再在 b/c 间基线插 x。最后维护的 delta 与新一次 toDelta(deep:true) 相等。
 * 无归因恢复标记关闭同键范围时，retain 需逐键清除旧格式归因。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
 * 关闭 GC 的 base1/sugg0 已有 abcd，建议根物化缓存；建议 em 覆盖 ab、strong 覆盖 abcd；基线 strong 覆盖 ab，再在建议端索引1插 x。最后维护的 delta 与新一次 toDelta(deep:true) 相等。
 * 双键上下文即使只剩 null 清理叶，也须安装副本使后续 retain 清理生效。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
 * 关闭 GC 的 base1/sugg0 已有 ab，建议根物化缓存；建议 em 覆盖 ab、strong 覆盖 a；基线 em 覆盖 a，再头插带 strong 的 x。最后维护的 delta 与新一次 toDelta(deep:true) 相等。
 * 带格式基线 insert 会重扫双键归因范围，清理不能因上下文叶均为 null 而被丢弃。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
  // 基线 em 仅覆盖 `a`，未覆盖完整建议范围；后续插入会再次扫描 `b` 前的格式归因上下文。
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
 * 关闭 GC 的 base0/sugg1 已有 ab，建议根物化缓存；基线给 b 设 em 后追加 xx；建议给 xx 设 em，再让基线 em 覆盖 abx。最后维护的 delta 与新一次 toDelta(deep:true) 相等。
 * 基线末端落在建议 xx 区间内部，previousFormats 必须按旧消费方控制值计算格式差。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
 * 关闭 GC 的 base0/sugg1 已有 ab，建议根物化缓存；基线 em 覆盖 ab；建议把 b 的 em 改为 {x:1} 后再清除。最后维护的 delta 与新一次 toDelta(deep:true) 相等。
 * 删除旧标记时同键归因范围仍可开放，不能把取消格式建议的来源误清。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
 * 关闭 GC 的 base0/sugg1 已有 ab，建议根物化缓存；基线一次设 em，建议从左到右分两步分别取消 a/b 的 em。最后维护的 delta 与新一次 toDelta(deep:true) 相等。
 * 第二步可能删除第一步的恢复标记，取消格式来源仍由当前建议范围决定。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
 * 关闭 GC 的 base0/sugg1 已有 committed strong 的 a 与普通 b，建议根物化缓存；给 b 建议相同 strong，先比较缓存，再 acceptAll。接受前后缓存都等于各自全量渲染。
 * 恢复到已提交同键同值时需清旧格式归因；此处没有独立断言最终无 attribution。
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
 * 关闭 GC 的 base0/sugg1 已有 ab，建议根物化缓存；建议 strong 覆盖 a、基线 strong 覆盖 ab，先比较再 rejectAll。拒绝前后缓存都等于各自全量渲染。
 * 同键范围恢复至基线时需清旧来源；此处没有独立检查具体归因叶缺失。
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
 * 关闭 GC 的 base0/sugg1 已有 AB，建议根物化缓存；建议 A 有 em/strong，选择 clock1 的 em 关闭标记接受，再取消 A 的 em。接受后和取消后缓存均等于新渲染。
 * 选关闭而未选打开标记会拆开这对建议边界；不同键的 null 清理仍需传播。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
 * 关闭 GC 的 base0/sugg1 已有 abc，基线 strong 覆盖三字符，建议根物化缓存；建议取消 b 的 strong 并加 em，只接受 clock1 恢复标记，再取消 b 的 em。接受前、接受后及最终缓存均等于对应新渲染。
 * 此选择排除 clock0 的取消格式打开标记；后续另一键变化重扫环境归因。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
 * 关闭 GC 的 base0/sugg1 根有 ab 段落，建议缓存已物化并删除整段；基线给段内 ab 设 strong，先比较，再只取消 b 的 strong。局部取消前后建议缓存均等于对应新渲染。
 * 新格式标记在删除父项内仍属 fresh，范围恢复需逐键清理，不能让 b 继承 a 的来源。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
 * 关闭 GC 的 base0/sugg1 根有初始 em 的 ab 段落，建议缓存已物化；建议删整个段落，先比较，再由基线仅取消尾部 b 的 em。删除后及最终缓存均等于对应新渲染。
 * 清除从原 em 范围内部开始，终点是该两字符范围末尾；未覆盖终点严格处于范围内部的场景。fresh 格式片段需传播范围清理。此断言比较增量缓存与全量渲染，不独立规定最终每个格式值或归因字段。
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
  // 基线只清除尾部 b 的 em：起点在原 em run 内部，终点恰为该 run 末尾；整个节点仍是可见 tombstone。
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
 * 关闭 GC 的文本记录 hella、hello!、hello world 三状态，再把当前全文改为42；把 state2−state1 与 state3 分通道求交作为归因，以 state3 活ID为 renderedContent。输出 hell、带delete的a、带insert的o、普通 world；已撤回 ! 和当前42不显示。
 * state3.inserts只含当时未删除ID，deletes仍保留删除事实；插入/删除通道分别相交。
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
