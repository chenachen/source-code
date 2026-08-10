import * as Y from '../src/index.js'
import { init, compare, applyRandomTests, Doc } from './testHelper.js' // eslint-disable-line
import { AttributionsRenderer } from '../src/utils/Renderer.js'
import { createIdMapFromIdSet } from '../src/utils/ids.js'
import * as t from 'lib0/testing'
import * as prng from 'lib0/prng'
import * as delta from 'lib0/delta'
import * as s from 'lib0/schema'
import * as object from 'lib0/object'

/**
 * 验证属性键、值和条目迭代器的静态类型及空 map 行为。
 *
 * @param {t.TestCase} _tc
 */
export const testIterators = _tc => {
  const ydoc = new Y.Doc()
  /**
   * @type {Y.Type<{attrs: { [k:string]: number} }>}
   */
  const ymap = ydoc.get()
  // 这里只要求 TypeScript 推断正确；空迭代器没有运行时内容可断言。
  /**
   * @type {Array<number>}
   */
  const vals = Array.from(ymap.attrValues())
  /**
   * @type {Array<[string,number]>}
   */
  const entries = Array.from(ymap.attrEntries())
  /**
   * @type {Array<string>}
   */
  const keys = Array.from(ymap.attrKeys())
  console.log(vals, entries, keys)
}

/** 验证嵌套 map 属性变化向祖先冒泡为 `modifyAttr` 深层 Delta。 */
export const testNestedMapEvent = () => {
  const ydoc = new Y.Doc()
  const ymap = ydoc.get()
  const ymapNested = ymap.setAttr('nested', new Y.Type())
  let called = 0
  ymap.observeDeep(event => {
    const d = event.deltaDeep
    called++
    t.compare(d, delta.create().modifyAttr('nested', delta.create().setAttr('k', 'v')).done())
  })
  ymapNested.setAttr('k', 'v')
  t.assert(called === 1)
}

/** 验证列表子类型的属性变化向祖先冒泡为 `modify` 深层 Delta。 */
export const testNestedMapEvent2 = () => {
  const ydoc = new Y.Doc()
  const yarr = ydoc.get()
  const ymapNested = new Y.Type()
  yarr.insert(0, [ymapNested])
  let called = 0
  yarr.observeDeep(event => {
    const d = event.deltaDeep
    called++
    t.compare(d, delta.create().modify(delta.create().setAttr('k', 'v')))
  })
  ymapNested.setAttr('k', 'v')
  t.assert(called === 1)
}

/**
 * 回归 yjs#539：事务外首次计算事件派生字段会失败，过期事件不能延迟求值。
 *
 * 事件派生变化只能在对应事务生命周期内计算；事务结束后访问应报错。参见 yjs#539。
 *
 * @param {t.TestCase} _tc
 */
export const testMapEventError = _tc => {
  const doc = new Y.Doc()
  const ymap = doc.get()
  /**
   * @type {any}
   */
  let event = null
  ymap.observe((e) => {
    event = e
  })
  t.fails(() => {
    t.info(event.keys)
  })
  t.fails(() => {
    t.info(event.keys)
  })
}

/**
 * 验证从属性 Delta 构造、合并并嵌套多个 map 值。
 *
 * @param {t.TestCase} tc
 */
export const testMapHavingIterableAsConstructorParamTests = tc => {
  const { map0 } = init(tc, { users: 1 })
  const m1 = Y.Type.from(delta.create().setAttr('number', 1).setAttr('string', 'hello'))
  map0.setAttr('m1', m1)
  t.assert(m1.getAttr('number') === 1)
  t.assert(m1.getAttr('string') === 'hello')
  const m2 = Y.Type.from(delta.create(delta.$deltaAny).setAttrs({ object: { x: 1 }, boolean: true }).done())
  map0.setAttr('m2', m2)
  t.assert(m2.getAttr('object')?.x === 1)
  t.assert(m2.getAttr('boolean') === true)
  const m3 = new Y.Type()
  m3.applyDelta(m1.toDelta())
  m3.applyDelta(m2.toDelta())
  map0.setAttr('m3', m3)
  t.assert(m3.getAttr('number') === 1)
  t.assert(m3.getAttr('string') === 'hello')
  t.assert(m3.getAttr('object')?.x === 1)
  t.assert(m3.getAttr('boolean') === true)
}

/**
 * 验证标量、对象、布尔值和嵌套共享类型在离线重连后完整同步。
 *
 * @param {t.TestCase} tc
 */
export const testBasicMapTests = tc => {
  const { testConnector, users, map0, map1, map2 } = init(tc, { users: 3 })
  users[2].disconnect()

  map0.setAttr('null', null)
  map0.setAttr('number', 1)
  map0.setAttr('string', 'hello Y')
  map0.setAttr('object', { key: { key2: 'value' } })
  map0.setAttr('y-map', new Y.Type())
  map0.setAttr('boolean1', true)
  map0.setAttr('boolean0', false)
  const map = map0.getAttr('y-map')
  map.setAttr('y-array', new Y.Type())
  const array = map.getAttr('y-array')
  array.insert(0, [0])
  array.insert(0, [-1])

  t.assert(map0.getAttr('null') === null, 'client 0 computed the change (null)')
  t.assert(map0.getAttr('number') === 1, 'client 0 computed the change (number)')
  t.assert(map0.getAttr('string') === 'hello Y', 'client 0 computed the change (string)')
  t.assert(map0.getAttr('boolean0') === false, 'client 0 computed the change (boolean)')
  t.assert(map0.getAttr('boolean1') === true, 'client 0 computed the change (boolean)')
  t.compare(map0.getAttr('object'), { key: { key2: 'value' } }, 'client 0 computed the change (object)')
  t.assert(map0.getAttr('y-map').getAttr('y-array').get(0) === -1, 'client 0 computed the change (type)')
  t.assert(map0.attrSize === 7, 'client 0 map has correct size')

  users[2].connect()
  testConnector.flushAllMessages()

  t.assert(map1.getAttr('null') === null, 'client 1 received the update (null)')
  t.assert(map1.getAttr('number') === 1, 'client 1 received the update (number)')
  t.assert(map1.getAttr('string') === 'hello Y', 'client 1 received the update (string)')
  t.assert(map1.getAttr('boolean0') === false, 'client 1 computed the change (boolean)')
  t.assert(map1.getAttr('boolean1') === true, 'client 1 computed the change (boolean)')
  t.compare(map1.getAttr('object'), { key: { key2: 'value' } }, 'client 1 received the update (object)')
  t.assert(map1.getAttr('y-map').getAttr('y-array').get(0) === -1, 'client 1 received the update (type)')
  t.assert(map1.attrSize === 7, 'client 1 map has correct size')

  // 离线客户端重连后也必须补齐同样的嵌套状态。
  t.assert(map2.getAttr('null') === null, 'client 2 received the update (null) - was disconnected')
  t.assert(map2.getAttr('number') === 1, 'client 2 received the update (number) - was disconnected')
  t.assert(map2.getAttr('string') === 'hello Y', 'client 2 received the update (string) - was disconnected')
  t.assert(map2.getAttr('boolean0') === false, 'client 2 computed the change (boolean)')
  t.assert(map2.getAttr('boolean1') === true, 'client 2 computed the change (boolean)')
  t.compare(map2.getAttr('object'), { key: { key2: 'value' } }, 'client 2 received the update (object) - was disconnected')
  t.assert(map2.getAttr('y-map').getAttr('y-array').get(0) === -1, 'client 2 received the update (type) - was disconnected')
  compare(users)
}

/**
 * 验证普通值、`undefined` 与 `null` 的 set/get 和远端同步语义。
 *
 * @param {t.TestCase} tc
 */
export const testGetAndSetOfMapProperty = tc => {
  const { testConnector, users, map0 } = init(tc, { users: 2 })
  map0.setAttr('stuff', 'stuffy')
  map0.setAttr('undefined', undefined)
  map0.setAttr('null', null)
  t.compare(map0.getAttr('stuff'), 'stuffy')

  testConnector.flushAllMessages()

  for (const user of users) {
    const u = user.get('map')
    t.compare(u.getAttr('stuff'), 'stuffy')
    t.assert(u.getAttr('undefined') === undefined, 'undefined')
    t.compare(u.getAttr('null'), null, 'null')
  }
  compare(users)
}

/**
 * 验证 map 属性可持有嵌套共享 map，并保留对象身份与子写入。
 *
 * @param {t.TestCase} tc
 */
export const testYmapSetsYmap = tc => {
  const { users, map0 } = init(tc, { users: 2 })
  const map = map0.setAttr('Map', new Y.Type())
  t.assert(map0.getAttr('Map') === map)
  map.setAttr('one', 1)
  t.compare(map.getAttr('one'), 1)
  compare(users)
}

/**
 * 验证 map 属性可持有嵌套共享列表并递归序列化。
 *
 * @param {t.TestCase} tc
 */
export const testYmapSetsYarray = tc => {
  const { users, map0 } = init(tc, { users: 2 })
  const array = map0.setAttr('Array', new Y.Type())
  t.assert(array === map0.getAttr('Array'))
  array.insert(0, [1, 2, 3])
  // @ts-ignore
  t.compare(map0.toJSON().attrs, { Array: { children: [1, 2, 3] } })
  compare(users)
}

/**
 * 验证单个属性覆盖可同步到所有副本。
 *
 * @param {t.TestCase} tc
 */
export const testGetAndSetOfMapPropertySyncs = tc => {
  const { testConnector, users, map0 } = init(tc, { users: 2 })
  map0.setAttr('stuff', 'stuffy')
  t.compare(map0.getAttr('stuff'), 'stuffy')
  testConnector.flushAllMessages()
  for (const user of users) {
    const u = user.get('map')
    t.compare(u.getAttr('stuff'), 'stuffy')
  }
  compare(users)
}

/**
 * 验证两个客户端并发写同键后选择同一获胜值。
 *
 * @param {t.TestCase} tc
 */
export const testGetAndSetOfMapPropertyWithConflict = tc => {
  const { testConnector, users, map0, map1 } = init(tc, { users: 3 })
  map0.setAttr('stuff', 'c0')
  map1.setAttr('stuff', 'c1')
  testConnector.flushAllMessages()
  for (const user of users) {
    const u = user.get('map')
    t.compare(u.getAttr('stuff'), 'c1')
  }
  compare(users)
}

/**
 * 验证 `attrSize` 只统计未删除键，并随删除递减。
 *
 * @param {t.TestCase} tc
 */
export const testSizeAndDeleteOfMapProperty = tc => {
  const { map0 } = init(tc, { users: 1 })
  map0.setAttr('stuff', 'c0')
  map0.setAttr('otherstuff', 'c1')
  t.assert(map0.attrSize === 2, `map size is ${map0.attrSize} expected 2`)
  map0.deleteAttr('stuff')
  t.assert(map0.attrSize === 1, `map size after delete is ${map0.attrSize}, expected 1`)
  map0.deleteAttr('otherstuff')
  t.assert(map0.attrSize === 0, `map size after delete is ${map0.attrSize}, expected 0`)
}

/**
 * 验证并发 set 后 delete 的 tombstone 在所有副本获胜。
 *
 * @param {t.TestCase} tc
 */
export const testGetAndSetAndDeleteOfMapProperty = tc => {
  const { testConnector, users, map0, map1 } = init(tc, { users: 3 })
  map0.setAttr('stuff', 'c0')
  map1.setAttr('stuff', 'c1')
  map1.deleteAttr('stuff')
  testConnector.flushAllMessages()
  for (const user of users) {
    const u = user.get('map')
    t.assert(u.getAttr('stuff') === undefined)
  }
  compare(users)
}

/**
 * 验证 `clearAttrs()` 一次删除全部当前属性。
 *
 * @param {t.TestCase} tc
 */
export const testSetAndClearOfMapProperties = tc => {
  const { testConnector, users, map0 } = init(tc, { users: 1 })
  map0.setAttr('stuff', 'c0')
  map0.setAttr('otherstuff', 'c1')
  map0.clearAttrs()
  testConnector.flushAllMessages()
  for (const user of users) {
    const u = user.get('map')
    t.assert(u.getAttr('stuff') === undefined)
    t.assert(u.getAttr('otherstuff') === undefined)
    t.assert(u.attrSize === 0, `map size after clear is ${u.attrSize}, expected 0`)
  }
  compare(users)
}

/**
 * 验证并发覆盖后 `clearAttrs()` 可删除各键当前获胜版本。
 *
 * @param {t.TestCase} tc
 */
export const testSetAndClearOfMapPropertiesWithConflicts = tc => {
  const { testConnector, users, map0, map1, map2, map3 } = init(tc, { users: 4 })
  map0.setAttr('stuff', 'c0')
  map1.setAttr('stuff', 'c1')
  map1.setAttr('stuff', 'c2')
  map2.setAttr('stuff', 'c3')
  testConnector.flushAllMessages()
  map0.setAttr('otherstuff', 'c0')
  map1.setAttr('otherstuff', 'c1')
  map2.setAttr('otherstuff', 'c2')
  map3.setAttr('otherstuff', 'c3')
  map3.clearAttrs()
  testConnector.flushAllMessages()
  for (const user of users) {
    const u = user.get('map')
    t.assert(u.getAttr('stuff') === undefined)
    t.assert(u.getAttr('otherstuff') === undefined)
    t.assert(u.attrSize === 0, `map size after clear is ${u.attrSize}, expected 0`)
  }
  compare(users)
}

/**
 * 验证三方多次并发覆盖同键后确定性收敛。
 *
 * @param {t.TestCase} tc
 */
export const testGetAndSetOfMapPropertyWithThreeConflicts = tc => {
  const { testConnector, users, map0, map1, map2 } = init(tc, { users: 3 })
  map0.setAttr('stuff', 'c0')
  map1.setAttr('stuff', 'c1')
  map1.setAttr('stuff', 'c2')
  map2.setAttr('stuff', 'c3')
  testConnector.flushAllMessages()
  for (const user of users) {
    const u = user.get('map')
    t.compare(u.getAttr('stuff'), 'c3')
  }
  compare(users)
}

/**
 * 验证四方并发 set/delete 同键后删除结果收敛。
 *
 * @param {t.TestCase} tc
 */
export const testGetAndSetAndDeleteOfMapPropertyWithThreeConflicts = tc => {
  const { testConnector, users, map0, map1, map2, map3 } = init(tc, { users: 4 })
  map0.setAttr('stuff', 'c0')
  map1.setAttr('stuff', 'c1')
  map1.setAttr('stuff', 'c2')
  map2.setAttr('stuff', 'c3')
  testConnector.flushAllMessages()
  map0.setAttr('stuff', 'deleteme')
  map1.setAttr('stuff', 'c1')
  map2.setAttr('stuff', 'c2')
  map3.setAttr('stuff', 'c3')
  map3.deleteAttr('stuff')
  testConnector.flushAllMessages()
  for (const user of users) {
    const u = user.get('map')
    t.assert(u.getAttr('stuff') === undefined)
  }
  compare(users)
}

/**
 * 逐键比较事件对象与期望字段，只约束当前用例关心的可观察属性。
 *
 * @param {Object<string,any>} is
 * @param {Object<string,any>} should
 */
const compareEvent = (is, should) => {
  for (const key in should) {
    t.compare(should[key], is[key])
  }
}

/**
 * 验证 add、update、delete 都同步报告正确 `target` 与 `keysChanged`。
 *
 * @param {t.TestCase} tc
 */
export const testThrowsAddAndUpdateAndDeleteEvents = tc => {
  const { users, map0 } = init(tc, { users: 2 })
  /**
   * @type {Object<string,any>}
   */
  let event = {}
  map0.observe(e => {
    event = e // observer 同步派发，保存最后一次事件即可。
  })
  map0.setAttr('stuff', 4)
  compareEvent(event, {
    target: map0,
    keysChanged: new Set(['stuff'])
  })
  // 用嵌套类型覆盖标量，旧值来自 Content。
  map0.setAttr('stuff', new Y.Type())
  compareEvent(event, {
    target: map0,
    keysChanged: new Set(['stuff'])
  })
  // 再用标量覆盖嵌套类型，旧值来自已删除 Content。
  map0.setAttr('stuff', 5)
  // 删除仍应报告同一变化键。
  map0.deleteAttr('stuff')
  compareEvent(event, {
    keysChanged: new Set(['stuff']),
    target: map0
  })
  compare(users)
}

/**
 * 验证清空多个属性时事件一次报告全部变化键。
 *
 * @param {t.TestCase} tc
 */
export const testThrowsDeleteEventsOnClear = tc => {
  const { users, map0 } = init(tc, { users: 2 })
  /**
   * @type {Object<string,any>}
   */
  let event = {}
  map0.observe(e => {
    event = e // observer 同步派发，保存最后一次事件即可。
  })
  // Given：两个不同类型的属性都已存在。
  map0.setAttr('stuff', 4)
  map0.setAttr('otherstuff', new Y.Type())
  // When：一次清空；Then：事件同时报告两个键。
  map0.clearAttrs()
  compareEvent(event, {
    keysChanged: new Set(['stuff', 'otherstuff']),
    target: map0
  })
  compare(users)
}

/**
 * 验证同事务多次 set 折叠为最终值，set 后 delete 折叠为空 Delta。
 *
 * @param {t.TestCase} tc
 */
export const testChangeEvent = tc => {
  const { map0, users } = init(tc, { users: 2 })
  /**
   * @type {delta.Delta<any>?}
   */
  let changes = delta.create()
  map0.observe(e => {
    changes = e.delta
  })
  map0.setAttr('a', 1)
  let keyChange = changes.attrs.a
  t.assert(delta.$setAttrOpWith(s.$number).check(keyChange) && keyChange.value === 1)
  map0.setAttr('a', 2)
  keyChange = changes.attrs.a
  t.assert(delta.$setAttrOpWith(s.$number).check(keyChange) && keyChange.value === 2)
  users[0].transact(() => {
    map0.setAttr('a', 3)
    map0.setAttr('a', 4)
  })
  keyChange = changes.attrs.a
  t.assert(delta.$setAttrOpWith(s.$number).check(keyChange) && keyChange.value === 4)
  users[0].transact(() => {
    map0.setAttr('b', 1)
    map0.setAttr('b', 2)
  })
  keyChange = changes.attrs.b
  t.assert(delta.$setAttrOpWith(s.$number).check(keyChange) && keyChange.value === 2)
  users[0].transact(() => {
    map0.setAttr('c', 1)
    map0.deleteAttr('c')
  })
  t.assert(changes !== null && object.isEmpty(changes.attrs))
  users[0].transact(() => {
    map0.setAttr('d', 1)
    map0.setAttr('d', 2)
  })
  keyChange = changes.attrs.d
  t.assert(delta.$setAttrOpWith(s.$number).check(keyChange) && keyChange.value === 2)
  compare(users)
}

/**
 * 验证浅层/深层 observer 抛错时事务仍完成更新、可再次执行且数据已提交。
 *
 * @param {t.TestCase} _tc
 */
export const testYmapEventExceptionsShouldCompleteTransaction = _tc => {
  const doc = new Y.Doc()
  const map = doc.get('map')

  let updateCalled = false
  let throwingObserverCalled = false
  let throwingDeepObserverCalled = false
  doc.on('update', () => {
    updateCalled = true
  })

  /** 模拟会抛错的浅层 observer，并记录它确已执行。 */
  const throwingObserver = () => {
    throwingObserverCalled = true
    throw new Error('Failure')
  }

  /** 模拟会抛错的深层 observer，并记录它确已执行。 */
  const throwingDeepObserver = () => {
    throwingDeepObserverCalled = true
    throw new Error('Failure')
  }

  map.observe(throwingObserver)
  map.observeDeep(throwingDeepObserver)

  t.fails(() => {
    map.setAttr('y', '2')
  })

  t.assert(updateCalled)
  t.assert(throwingObserverCalled)
  t.assert(throwingDeepObserverCalled)

  // 再次写入证明异常没有把事务清理队列留在损坏状态。
  updateCalled = false
  throwingObserverCalled = false
  throwingDeepObserverCalled = false
  t.fails(() => {
    map.setAttr('z', '3')
  })

  t.assert(updateCalled)
  t.assert(throwingObserverCalled)
  t.assert(throwingDeepObserverCalled)

  t.assert(map.getAttr('z') === '3')
}

/**
 * 验证本地标量 set 事件暴露的值等于目标类型当前值。
 *
 * @param {t.TestCase} tc
 */
export const testYmapEventHasCorrectValueWhenSettingAPrimitive = tc => {
  const { users, map0 } = init(tc, { users: 3 })
  /**
   * @type {Object<string,any>}
   */
  let event = {}
  map0.observe(e => {
    event = e
  })
  map0.setAttr('stuff', 2)
  t.compare(event.value, event.target.get(event.name))
  compare(users)
}

/**
 * 验证远端标量 set 同步后事件值等于本地目标当前值。
 *
 * @param {t.TestCase} tc
 */
export const testYmapEventHasCorrectValueWhenSettingAPrimitiveFromOtherUser = tc => {
  const { users, map0, map1, testConnector } = init(tc, { users: 3 })
  /**
   * @type {Object<string,any>}
   */
  let event = {}
  map0.observe(e => {
    event = e
  })
  map1.setAttr('stuff', 2)
  testConnector.flushAllMessages()
  t.compare(event.value, event.target.get(event.name))
  compare(users)
}

/**
 * 验证属性插入、覆盖与软删除在 Renderer 下携带正确 attribution。
 *
 * @param {t.TestCase} _tc
 */
export const testAttributedContent = _tc => {
  const ydoc = new Y.Doc({ gc: false })
  const ymap = ydoc.get()
  let renderer = /** @type {AbstractRenderer?} */ (null)

  ydoc.on('afterTransaction', tr => {
    // renderer = new AttributionsRenderer(createIdMapFromIdSet(tr.insertSet, [new Y.Attribution('insertAt', 42), new Y.Attribution('insert', 'kevin')]), createIdMapFromIdSet(tr.deleteSet, [new Y.Attribution('delete', 'kevin')]))
    renderer = new AttributionsRenderer(Y.createContentMap(createIdMapFromIdSet(tr.insertSet, []), createIdMapFromIdSet(tr.deleteSet, [])))
  })
  t.group('initial value', () => {
    ymap.setAttr('test', 42)
    const expectedContent = { test: delta.$deltaMapChangeJson.expect({ type: 'insert', value: 42, attribution: { insert: [] } }) }
    const attributedContent = ymap.toDelta({ renderer })
    console.log(attributedContent.toJSON())
    t.compare(expectedContent, attributedContent.toJSON().attrs)
  })
  t.group('overwrite value', () => {
    ymap.setAttr('test', 'fourtytwo')
    const expectedContent = { test: delta.$deltaMapChangeJson.expect({ type: 'insert', value: 'fourtytwo', attribution: { insert: [] } }) }
    const attributedContent = ymap.toDelta({ renderer })
    console.log(attributedContent)
    t.compare(expectedContent, attributedContent.toJSON().attrs)
  })
  t.group('delete value', () => {
    ymap.deleteAttr('test')
    // 完整快照模式没有 `itemsToRender`，软删除属性仍以旧值和 `delete` attribution 可见，必须输出
    // `SetAttrOp`；这与软删除子内容输出带 `{ delete: [] }` 的 `InsertOp` 而非 `DeleteOp` 对称。
    const expectedContent = { test: delta.$deltaMapChangeJson.expect({ type: 'insert', value: 'fourtytwo', attribution: { delete: [] } }) }
    const attributedContent = ymap.toDelta({ renderer })
    console.log(attributedContent.toJSON())
    t.compare(expectedContent, attributedContent.toJSON().attrs)
  })
}

/**
 * 随机 YMap 状态机的操作集合，覆盖标量覆盖、嵌套类型写入和删除。
 *
 * @type {Array<function(Doc,prng.PRNG):void>}
 */
const mapTransactions = [
  /** 随机选择键并写入 UTF-16 字符串。 */
  function set (user, gen) {
    const key = prng.oneOf(gen, ['one', 'two'])
    const value = prng.utf16String(gen)
    user.get('map').setAttr(key, value)
  },
  /** 随机写入嵌套类型，并继续写其列表或属性分支。 */
  function setType (user, gen) {
    const key = prng.oneOf(gen, ['one', 'two'])
    const type = new Y.Type()
    user.get('map').setAttr(key, type)
    if (prng.bool(gen)) {
      type.insert(0, [1, 2, 3, 4])
    } else {
      type.setAttr('deepkey', 'deepvalue')
    }
  },
  /** 随机删除一个候选属性键；不存在时验证幂等。 */
  function _delete (user, gen) {
    const key = prng.oneOf(gen, ['one', 'two'])
    user.get('map').deleteAttr(key)
  }
]

/**
 * 以 10 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests10 = tc => {
  applyRandomTests(tc, mapTransactions, 3)
}

/**
 * 以 40 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests40 = tc => {
  applyRandomTests(tc, mapTransactions, 40)
}

/**
 * 以 42 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests42 = tc => {
  applyRandomTests(tc, mapTransactions, 42)
}

/**
 * 以 43 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests43 = tc => {
  applyRandomTests(tc, mapTransactions, 43)
}

/**
 * 以 44 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests44 = tc => {
  applyRandomTests(tc, mapTransactions, 44)
}

/**
 * 以 45 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests45 = tc => {
  applyRandomTests(tc, mapTransactions, 45)
}

/**
 * 以 46 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests46 = tc => {
  applyRandomTests(tc, mapTransactions, 46)
}

/**
 * 以 300 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests300 = tc => {
  applyRandomTests(tc, mapTransactions, 300)
}

/**
 * 以 400 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests400 = tc => {
  applyRandomTests(tc, mapTransactions, 400)
}

/**
 * 以 500 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests500 = tc => {
  applyRandomTests(tc, mapTransactions, 500)
}

/**
 * 以 600 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests600 = tc => {
  applyRandomTests(tc, mapTransactions, 600)
}

/**
 * 以 1000 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests1000 = tc => {
  applyRandomTests(tc, mapTransactions, 1000)
}

/**
 * 以 1800 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests1800 = tc => {
  applyRandomTests(tc, mapTransactions, 1800)
}

/**
 * 以 5000 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests5000 = tc => {
  t.skip(!t.production)
  applyRandomTests(tc, mapTransactions, 5000)
}

/**
 * 以 10000 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests10000 = tc => {
  t.skip(!t.production)
  applyRandomTests(tc, mapTransactions, 10000)
}

/**
 * 以 100000 步随机 YMap 事务验证多副本属性操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests100000 = tc => {
  t.skip(!t.production)
  applyRandomTests(tc, mapTransactions, 100000)
}
