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
 * 带数值属性配置的 map 为空；把三个属性迭代器转成带类型注解的数组。静态检查约束 keys/values/entries 类型，运行时仅打印三个空数组。
 * 没有写入或内容断言。
 *
 * @param {t.TestCase} _tc
 */
export const testIterators = _tc => {
  const ydoc = new Y.Doc()
  /**
   * @type {Y.Type<{attrs: { [k:string]: number} }>}
   */
  const ymap = ydoc.get()
  // 空 map 用于实例化三种迭代器；本用例只打印结果，不作运行时内容断言。
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

/**
 * 根 map 的 nested 属性已持有一个空子类型，根注册 observeDeep；子类型设置 k=v。根恰收到一次 modifyAttr(nested, setAttr(k,v)) 深层 Delta。
 */
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

/**
 * 根列表已包含一个空子类型，根注册 observeDeep；子类型设置 k=v。根恰收到一次 modify(setAttr(k,v)) 深层 Delta。
 */
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
 * 空 map 虽注册 observer，但没有任何写入，事件引用保持 null；两次读取 event.keys。两次都因 null.keys 抛错。
 * 没有进入 YEvent，未覆盖事务结束后读取事件的场景。
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
 * 从两个属性 Delta 分别创建 preliminary map 值；将其挂入根属性，再把两份 Delta 累积到第三个子类型并集成。三个子类型均可读出各自初始键值，合并值同时拥有四项属性。
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
 * 三个空 map 副本中第三端断线；第一端写入七种属性及 map→array 的嵌套内容，再重连同步。三端读取 null、标量、对象与嵌套 -1 均匹配，前两端属性数为 7，最终结构收敛。
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
 * 两个空 map 副本；第一端写入普通字符串、undefined 和 null 后同步。两端读到相应值，并通过最终收敛比较。
 * 读取 undefined 的断言不区分键缺失；没有单独断言该键存在。
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
 * 空根 map；以 setAttr 返回值取得新子类型，再写 one=1。getAttr 返回同一子对象且其值为 1，最终副本收敛。
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
 * 空根 map；设置一个子列表并插入 `[1,2,3]`。本地对象身份保留，递归 JSON 的 Array.children 为这三个数，最终副本收敛。
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
 * 两个空 map 副本；第一端设置 stuff=stuffy 并投递消息。本地和两个副本都可读到 stuffy，最终收敛。
 * 这里只有首次设置，没有执行覆盖。
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
 * 三个空 map 副本使用固定 clientID 0、1、2；前两端在未交换消息时分别设置 stuff=c0 与 c1，再同步。所有端都保留 clientID 较大写入者的 c1，最终结构一致。
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
 * 单端空 map；写入两个键，再逐一删除。attrSize 依次为 2、1、0，不把删除 Item 算作现存属性。
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
 * 三个空 map 副本；map0 写 c0，map1 并发写 c1 后马上删掉自己的获胜项，再同步。各端读取 stuff 都为 undefined，最终收敛。
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
 * 单端空 map；写入 stuff、otherstuff 后执行 clearAttrs。两个键都不可读，属性数为 0，并通过 compare。
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
 * 四端先并发覆盖 stuff 并完成一轮同步；各端再并发写 otherstuff，最大 clientID 的 map3 清空其已知两键，然后同步。所有端两键均不可读且属性数为 0。
 * clear 对已同步 stuff 的获胜项和 map3 自己的 otherstuff 生效；不声称 clear 能删除未知并发写。
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
 * 三个空 map 副本；map0 写 c0、map1 连写 c1/c2、map2 写 c3 后同步。各端 stuff 为最大 clientID 的 c3，最终结构收敛。
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
 * 四端先完成 stuff 的一轮冲突同步；下一轮各端覆盖同键，map3 写 c3 后删除该项，再同步。所有端读取该键均为 undefined，最终结构收敛。
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
 * 空 map 注册浅层 observer 保存最近事件；设置标量、用子类型覆盖、再设标量并删除。被比较的初次设置、子类型覆盖和删除都报告 target=map0、keysChanged={stuff}。
 * 再次设标量仅执行写入，没有独立比较该步事件。
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
  // 用嵌套类型覆盖标量，事件仍报告同一变化键。
  map0.setAttr('stuff', new Y.Type())
  compareEvent(event, {
    target: map0,
    keysChanged: new Set(['stuff'])
  })
  // 再用标量覆盖嵌套类型；此步只执行写入，没有单独比较事件字段。
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
 * map0 已写入一个标量键和一个子类型键，observer 保存最近事件；一次 clearAttrs 删除两个键。保存事件的 target 为 map0，keysChanged 同时包含两个键。
 * 只检查最后事件的字段，没有统计通知次数。
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
 * 空 map 注册 observer 保存最近 Delta；依次单次 set、同事务重复 set，以及新键 set 后 delete。单次写入输出对应值，重复 set 只留最终值；新键 c 的 set/delete 后 attrs 为空。
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
 * 空 map 同时注册会抛错的浅层/深层 observer，并监听文档 update；分别设置 y=2 与 z=3，两次都期望调用抛错。每次两个 observer 和 update 均运行，第二次写入值 z=3 仍已保存。
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
 * 三端空 map 中 map0 注册 observer；本地设置 stuff=2，比较旧事件 value/name 字段。比较实际为 undefined 与 get(undefined)，随后 compare 检查副本收敛。
 * 当前 YEvent 不定义 value/name；此字段断言未验证写入值 2。
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
 * 三端空 map 中 map0 注册 observer；map1 设置 stuff=2 并投递消息，再比较旧事件字段。比较实际为 undefined 与 get(undefined)，随后 compare 检查副本收敛。
 * 当前 YEvent 不定义 value/name；此字段断言未验证远端写入值 2。
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
 * 关闭 GC 的空 map，每次事务后按本轮 ID 集重建 Renderer；先设置 test=42，再覆盖为 fourtytwo，最后删除。前两次输出当前值及 insert 归因，删除后仍以正向 setAttr 输出旧字符串及 delete 归因。
 *
 * @param {t.TestCase} _tc
 */
export const testAttributedContent = _tc => {
  const ydoc = new Y.Doc({ gc: false })
  const ymap = ydoc.get()
  let renderer = /** @type {AbstractRenderer?} */ (null)

  ydoc.on('afterTransaction', tr => {
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
  /** 在当前 map 随机设置 one/two 为 UTF-16 字符串，既可首次写入也可覆盖；最终 compare 检查获胜值收敛。 */
  function set (user, gen) {
    const key = prng.oneOf(gen, ['one', 'two'])
    const value = prng.utf16String(gen)
    user.get('map').setAttr(key, value)
  },
  /** 随机覆盖 one/two 为新子类型，再写四个列表数或 deepkey 属性；最终 compare 检查父子集成与同步后的状态。 */
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
  /** 在当前 map 随机删除 one/two；键可不存在，调用仍应返回，最终 compare 检查交错后的收敛状态。 */
  function _delete (user, gen) {
    const key = prng.oneOf(gen, ['one', 'two'])
    user.get('map').deleteAttr(key)
  }
]

/**
 * 随机驱动建立五个空 map 副本；交错执行 3 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 * 函数名保留旧的 10，实际只传入 3 步。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests10 = tc => {
  applyRandomTests(tc, mapTransactions, 3)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 40 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests40 = tc => {
  applyRandomTests(tc, mapTransactions, 40)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 42 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests42 = tc => {
  applyRandomTests(tc, mapTransactions, 42)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 43 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests43 = tc => {
  applyRandomTests(tc, mapTransactions, 43)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 44 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests44 = tc => {
  applyRandomTests(tc, mapTransactions, 44)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 45 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests45 = tc => {
  applyRandomTests(tc, mapTransactions, 45)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 46 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests46 = tc => {
  applyRandomTests(tc, mapTransactions, 46)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 300 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests300 = tc => {
  applyRandomTests(tc, mapTransactions, 300)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 400 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests400 = tc => {
  applyRandomTests(tc, mapTransactions, 400)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 500 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests500 = tc => {
  applyRandomTests(tc, mapTransactions, 500)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 600 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests600 = tc => {
  applyRandomTests(tc, mapTransactions, 600)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 1000 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests1000 = tc => {
  applyRandomTests(tc, mapTransactions, 1000)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 1800 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests1800 = tc => {
  applyRandomTests(tc, mapTransactions, 1800)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 5000 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 * 仅 production 测试模式执行，其余模式跳过。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests5000 = tc => {
  t.skip(!t.production)
  applyRandomTests(tc, mapTransactions, 5000)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 10000 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 * 仅 production 测试模式执行，其余模式跳过。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests10000 = tc => {
  t.skip(!t.production)
  applyRandomTests(tc, mapTransactions, 10000)
}

/**
 * 随机驱动建立五个空 map 副本；交错执行 100000 步字符串/嵌套值覆盖、删除与随机网络动作。结束时 compare 检查可见属性及底层结构收敛。
 * 仅 production 测试模式执行，其余模式跳过。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYmapTests100000 = tc => {
  t.skip(!t.production)
  applyRandomTests(tc, mapTransactions, 100000)
}
