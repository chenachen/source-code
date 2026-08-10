import { init, compare, applyRandomTests, Doc } from './testHelper.js' // eslint-disable-line
import * as Y from '../src/index.js'
import * as t from 'lib0/testing'
import * as prng from 'lib0/prng'
import * as math from 'lib0/math'
import * as env from 'lib0/environment'
import * as delta from 'lib0/delta'

/** 当前测试进程是否启用开发期值冻结检查。 */
const isDevMode = env.getVariable('node_env') === 'development'

/**
 * 验证数组更新可编码并在另一文档应用，远端得到相同内容。
 *
 * @param {t.TestCase} _tc
 */
export const testBasicUpdate = _tc => {
  const doc1 = new Y.Doc()
  const doc2 = new Y.Doc()
  doc1.get('array').insert(0, ['hi'])
  const update = Y.encodeStateAsUpdate(doc1)
  Y.applyUpdate(doc2, update)
  t.compare(doc2.get('array').toArray(), ['hi'])
}

/**
 * 验证开发模式会冻结已写入共享类型的普通数组与对象，阻止外部原地篡改。
 *
 * @param {t.TestCase} _tc
 */
export const testFailsObjectManipulationInDevMode = _tc => {
  if (isDevMode) {
    t.info('running in dev mode')
    const doc = new Y.Doc()
    const a = [1, 2, 3]
    const b = { o: 1 }
    doc.get('test').insert(0, [a])
    doc.get('map').setAttr('k', b)
    t.fails(() => {
      a[0] = 42
    })
    t.fails(() => {
      b.o = 42
    })
  } else {
    t.info('not in dev mode')
  }
}

/**
 * 验证 `slice()` 的正向、负向边界及前置插入后的半开区间语义。
 *
 * @param {t.TestCase} _tc
 */
export const testSlice = _tc => {
  const doc1 = new Y.Doc()
  const arr = doc1.get('array')
  arr.insert(0, [1, 2, 3])
  t.compareArrays(arr.slice(0), [1, 2, 3])
  t.compareArrays(arr.slice(1), [2, 3])
  t.compareArrays(arr.slice(0, -1), [1, 2])
  arr.insert(0, [0])
  t.compareArrays(arr.slice(0), [0, 1, 2, 3])
  t.compareArrays(arr.slice(0, 2), [0, 1])
}

/**
 * 验证 `Y.Type.from()` 可从含数组子项的 Delta 构造共享列表。
 *
 * @param {t.TestCase} _tc
 */
export const testArrayFrom = _tc => {
  const doc1 = new Y.Doc()
  const db1 = doc1.get('root')
  const nestedArray1 = Y.Type.from(delta.create().insert([0, 1, 2]))
  db1.setAttr('array', nestedArray1)
  t.compare(nestedArray1.toArray(), [0, 1, 2])
}

/**
 * 回归 yjs#297：交错删除与插入后，缓存长度始终等于实际可见数组长度。
 *
 * 该用例来自 yjs#297，覆盖搜索标记曾导致 `_length` 与可见内容失配的问题。
 *
 * @param {t.TestCase} _tc
 */
export const testLengthIssue = _tc => {
  const doc1 = new Y.Doc()
  const arr = doc1.get('array')
  arr.push([0, 1, 2, 3])
  arr.delete(0)
  arr.insert(0, [0])
  t.assert(arr.length === arr.toArray().length)
  doc1.transact(() => {
    arr.delete(1)
    t.assert(arr.length === arr.toArray().length)
    arr.insert(1, [1])
    t.assert(arr.length === arr.toArray().length)
    arr.delete(2)
    t.assert(arr.length === arr.toArray().length)
    arr.insert(2, [2])
    t.assert(arr.length === arr.toArray().length)
  })
  t.assert(arr.length === arr.toArray().length)
  arr.delete(1)
  t.assert(arr.length === arr.toArray().length)
  arr.insert(1, [1])
  t.assert(arr.length === arr.toArray().length)
}

/**
 * 回归 yjs#314：嵌套事务中的越界失败不能破坏随后合法删除与长度状态。
 *
 * 该用例来自 yjs#314，覆盖失败的嵌套列表操作污染后续事务状态的问题。
 *
 * @param {t.TestCase} _tc
 */
export const testLengthIssue2 = _tc => {
  const doc = new Y.Doc()
  const next = doc.get()
  doc.transact(() => {
    next.insert(0, ['group2'])
  })
  doc.transact(() => {
    next.insert(1, ['rectangle3'])
  })
  doc.transact(() => {
    next.delete(0)
    next.insert(0, ['rectangle3'])
  })
  next.delete(1)
  doc.transact(() => {
    next.insert(1, ['ellipse4'])
  })
  doc.transact(() => {
    next.insert(2, ['ellipse3'])
  })
  doc.transact(() => {
    next.insert(3, ['ellipse2'])
  })
  doc.transact(() => {
    doc.transact(() => {
      t.fails(() => {
        next.insert(5, ['rectangle2'])
      })
      next.insert(4, ['rectangle2'])
    })
    doc.transact(() => {
      // 前一越界插入已回滚；合法末尾删除此时不得继续抛错。
      next.delete(4)
    })
  })
  console.log(next.toArray())
}

/**
 * 验证零长度删除幂等、真实越界删除报错，随后副本仍可收敛。
 *
 * @param {t.TestCase} tc
 */
export const testDeleteInsert = tc => {
  const { users, array0 } = init(tc, { users: 2 })
  array0.delete(0, 0)
  t.describe('Does not throw when deleting zero elements with position 0')
  t.fails(() => {
    array0.delete(1, 1)
  })
  array0.insert(0, ['A'])
  array0.delete(1, 0)
  t.describe('Does not throw when deleting zero elements with valid position 1')
  compare(users)
}

/**
 * 验证一次批量插入三种标量后，本地与同步后的 Delta 内容一致。
 *
 * @param {t.TestCase} tc
 */
export const testInsertThreeElementsTryRegetProperty = tc => {
  const { testConnector, users, array0, array1 } = init(tc, { users: 2 })
  array0.insert(0, [1, true, false])
  t.compare(array0.toDelta(), delta.create().insert([1, true, false]).done(), 'content works')
  testConnector.flushAllMessages()
  t.compare(array1.toDelta(), delta.create().insert([1, true, false]).done(), 'comparison works after sync')
  compare(users)
}

/**
 * 验证三个副本在同一位置并发插入后按 CRDT 规则收敛。
 *
 * @param {t.TestCase} tc
 */
export const testConcurrentInsertWithThreeConflicts = tc => {
  const { users, array0, array1, array2 } = init(tc, { users: 3 })
  array0.insert(0, [0])
  array1.insert(0, [1])
  array2.insert(0, [2])
  compare(users)
}

/**
 * 验证三方并发插入与删除混合冲突最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testConcurrentInsertDeleteWithThreeConflicts = tc => {
  const { testConnector, users, array0, array1, array2 } = init(tc, { users: 3 })
  array0.insert(0, ['x', 'y', 'z'])
  testConnector.flushAllMessages()
  array0.insert(1, [0])
  array1.delete(0)
  array1.delete(1, 1)
  array2.insert(1, [2])
  compare(users)
}

/**
 * 验证离线副本在同一位置各自插入后，重连可合并并收敛。
 *
 * @param {t.TestCase} tc
 */
export const testInsertionsInLateSync = tc => {
  const { testConnector, users, array0, array1, array2 } = init(tc, { users: 3 })
  array0.insert(0, ['x', 'y'])
  testConnector.flushAllMessages()
  users[1].disconnect()
  users[2].disconnect()
  array0.insert(1, ['user0'])
  array1.insert(1, ['user1'])
  array2.insert(1, ['user2'])
  users[1].connect()
  users[2].connect()
  testConnector.flushAllMessages()
  compare(users)
}

/**
 * 验证断开连接期间各副本保持本地视图，重连后才交换并收敛。
 *
 * @param {t.TestCase} tc
 */
export const testDisconnectReallyPreventsSendingMessages = tc => {
  const { testConnector, users, array0, array1 } = init(tc, { users: 3 })
  array0.insert(0, ['x', 'y'])
  testConnector.flushAllMessages()
  users[1].disconnect()
  users[2].disconnect()
  array0.insert(1, ['user0'])
  array1.insert(1, ['user1'])
  t.compare(array0.toJSON().children, ['x', 'user0', 'y'])
  t.compare(array1.toJSON().children, ['x', 'user1', 'y'])
  users[1].connect()
  users[2].connect()
  compare(users)
}

/**
 * 验证离线期间重叠删除在重连后仍收敛。
 *
 * @param {t.TestCase} tc
 */
export const testDeletionsInLateSync = tc => {
  const { testConnector, users, array0, array1 } = init(tc, { users: 2 })
  array0.insert(0, ['x', 'y'])
  testConnector.flushAllMessages()
  users[1].disconnect()
  array1.delete(1, 1)
  array0.delete(0, 2)
  users[1].connect()
  compare(users)
}

/**
 * 验证离线副本收到覆盖此前插入区间的删除后正确合并。
 *
 * @param {t.TestCase} tc
 */
export const testInsertThenMergeDeleteOnSync = tc => {
  const { testConnector, users, array0, array1 } = init(tc, { users: 2 })
  array0.insert(0, ['x', 'y', 'z'])
  testConnector.flushAllMessages()
  users[0].disconnect()
  array1.delete(0, 3)
  users[0].connect()
  compare(users)
}

/**
 * 验证普通数组插入和连续删除各同步触发一次浅层事件。
 *
 * @param {t.TestCase} tc
 */
export const testInsertAndDeleteEvents = tc => {
  const { array0, users } = init(tc, { users: 2 })
  /**
   * @type {Object<string,any>?}
   */
  let event = null
  array0.observe(e => {
    event = e
  })
  array0.insert(0, [0, 1, 2])
  t.assert(event !== null)
  event = null
  array0.delete(0)
  t.assert(event !== null)
  event = null
  array0.delete(0, 2)
  t.assert(event !== null)
  event = null
  compare(users)
}

/**
 * 验证 observer 内发起的新事务延后派发，事件顺序为外层回调完成后再进入下一轮。
 *
 * @param {t.TestCase} tc
 */
export const testNestedObserverEvents = tc => {
  const { array0, users } = init(tc, { users: 2 })
  /**
   * @type {Array<number>}
   */
  const vals = []
  array0.observe(() => {
    if (array0.length === 1) {
      // observer 内插入会排队触发下一轮，但必须等本轮回调执行完。
      array0.insert(1, [1])
      vals.push(0)
    } else {
      // 第二轮对应上方回调内插入。
      vals.push(1)
    }
  })
  array0.insert(0, [0])
  t.compareArrays(vals, [0, 1])
  t.compareArrays(array0.toArray(), [0, 1])
  compare(users)
}

/**
 * 验证嵌套共享类型的插入与删除都触发父数组事件。
 *
 * @param {t.TestCase} tc
 */
export const testInsertAndDeleteEventsForTypes = tc => {
  const { array0, users } = init(tc, { users: 2 })
  /**
   * @type {Object<string,any>|null}
   */
  let event = null
  array0.observe(e => {
    event = e
  })
  array0.insert(0, [new Y.Type()])
  t.assert(event !== null)
  event = null
  array0.delete(0)
  t.assert(event !== null)
  event = null
  compare(users)
}

/**
 * 验证数组事件 Delta 对插入、删除和带偏移插入给出最小可应用操作。
 *
 * @param {t.TestCase} tc
 */
export const testChangeEvent = tc => {
  const { array0, users } = init(tc, { users: 2 })
  /**
   * @type {delta.Delta<any>}
   */
  let d = delta.create()
  array0.observe(e => {
    d = e.delta
  })
  const newArr = new Y.Type()
  array0.insert(0, [newArr, 4, 'dtrn'])
  t.assert(d !== null && d.children.len === 1)
  t.compare(d, delta.create().insert([newArr, 4, 'dtrn']).done())
  array0.delete(0, 2)
  t.assert(d !== null && d.children.len === 1)
  t.compare(d.toJSON().children, [{ delete: 2 }])
  array0.insert(1, [0.1])
  t.assert(d !== null && d.children.len === 2)
  t.compare(d, delta.create().retain(1).insert([0.1]).done())
  compare(users)
}

/**
 * 验证同批插入普通值与嵌套类型只产生一次事件，后续删除再产生一次。
 *
 * @param {t.TestCase} tc
 */
export const testInsertAndDeleteEventsForTypes2 = tc => {
  const { array0, users } = init(tc, { users: 2 })
  /**
   * @type {Array<Object<string,any>>}
   */
  const events = []
  array0.observe(e => {
    events.push(e)
  })
  array0.insert(0, ['hi', new Y.Type()])
  t.assert(events.length === 1, 'Event is triggered exactly once for insertion of two elements')
  array0.delete(1)
  t.assert(events.length === 2, 'Event is triggered exactly once for deletion')
  compare(users)
}

/**
 * 回归 yjs#155：新子类型在首次集成事务内的初始化写入不触发其自身 observer。
 *
 * 问题来源：https://github.com/yjs/yjs/issues/155
 * @param {t.TestCase} tc
 */
export const testNewChildDoesNotEmitEventInTransaction = tc => {
  const { array0, users } = init(tc, { users: 2 })
  let fired = false
  users[0].transact(() => {
    const newMap = new Y.Type()
    newMap.observe(() => {
      fired = true
    })
    array0.insert(0, [newMap])
    newMap.setAttr('tst', 42)
  })
  t.assert(!fired, 'Event does not trigger')
}

/**
 * 验证含离线副本的删除同步与 GC 清理后所有文档仍收敛。
 *
 * @param {t.TestCase} tc
 */
export const testGarbageCollector = tc => {
  const { testConnector, users, array0 } = init(tc, { users: 3 })
  array0.insert(0, ['x', 'y', 'z'])
  testConnector.flushAllMessages()
  users[0].disconnect()
  array0.delete(0, 3)
  users[0].connect()
  testConnector.flushAllMessages()
  compare(users)
}

/**
 * 验证本地数组变化事件的 `target` 指向接收变化的本地类型。
 *
 * @param {t.TestCase} tc
 */
export const testEventTargetIsSetCorrectlyOnLocal = tc => {
  const { array0, users } = init(tc, { users: 3 })
  /**
   * @type {any}
   */
  let event
  array0.observe(e => {
    event = e
  })
  array0.insert(0, ['stuff'])
  t.assert(event.target === array0, '"target" property is set correctly')
  compare(users)
}

/**
 * 验证远端数组变化同步后，事件 `target` 指向本地对应类型。
 *
 * @param {t.TestCase} tc
 */
export const testEventTargetIsSetCorrectlyOnRemote = tc => {
  const { testConnector, array0, array1, users } = init(tc, { users: 3 })
  /**
   * @type {any}
   */
  let event
  array0.observe(e => {
    event = e
  })
  array1.insert(0, ['stuff'])
  testConnector.flushAllMessages()
  t.assert(event.target === array0, '"target" property is set correctly')
  compare(users)
}

/**
 * 验证包含嵌套共享类型的数组保持顺序，并可逐项读取子属性。
 *
 * @param {t.TestCase} _tc
 */
export const testIteratingArrayContainingTypes = _tc => {
  const y = new Y.Doc()
  const arr = y.get('arr')
  const numItems = 10
  for (let i = 0; i < numItems; i++) {
    const map = new Y.Type()
    map.setAttr('value', i)
    arr.push([map])
  }
  let cnt = 0
  for (const item of arr.toArray()) {
    t.assert(item.getAttr('value') === cnt++, 'value is correct')
  }
  y.destroy()
}

/**
 * 验证 Renderer 将删除与插入数组元素渲染为带对应 attribution 的正向内容。
 *
 * @param {t.TestCase} _tc
 */
export const testAttributedContent = _tc => {
  const ydoc = new Y.Doc({ gc: false })
  /**
   * @type {Y.Type<{ children: number }>}
   */
  const yarray = ydoc.get()
  yarray.insert(0, [1, 2])
  let renderer = /** @type {AbstractRenderer?} */ (null)

  ydoc.on('afterTransaction', tr => {
    // renderer = new AttributionsRenderer(createIdMapFromIdSet(tr.insertSet, [new Y.Attribution('insertAt', 42), new Y.Attribution('insert', 'kevin')]), createIdMapFromIdSet(tr.deleteSet, [new Y.Attribution('delete', 'kevin')]))
    renderer = new Y.AttributionsRenderer(Y.createContentMap(Y.createIdMapFromIdSet(tr.insertSet, []), Y.createIdMapFromIdSet(tr.deleteSet, [])))
  })
  t.group('insert / delete', () => {
    ydoc.transact(() => {
      yarray.delete(0, 1)
      yarray.insert(1, [42])
    })
    const expectedContent = delta.create().insert([1], null, { delete: [] }).insert([2]).insert([42], null, { insert: [] })
    const attributedContent = yarray.toDelta({ renderer })
    console.log(attributedContent.toJSON())
    t.assert(attributedContent.equals(expectedContent))
  })
}

let _uniqueNumber = 0
/** 返回进程内递增值，给随机插入批次分配可追踪的唯一内容。 */
const getUniqueNumber = () => _uniqueNumber++

/**
 * 随机 YArray 状态机的操作集合；每步同时用普通数组或嵌套读取校验局部结果。
 *
 * @type {Array<function(Doc,prng.PRNG,any):void>}
 */
const arrayTransactions = [
  /** 随机批量插入同一唯一值，并用普通数组镜像验证搜索标记定位。 */
  function insert (user, gen) {
    const yarray = user.get('array')
    const uniqueNumber = getUniqueNumber()
    const content = []
    const len = prng.int32(gen, 1, 4)
    for (let i = 0; i < len; i++) {
      content.push(uniqueNumber)
    }
    const pos = prng.int32(gen, 0, yarray.length)
    const oldContent = yarray.toArray()
    yarray.insert(pos, content)
    oldContent.splice(pos, 0, ...content)
    t.compareArrays(yarray.toArray(), oldContent) // 镜像数组证明搜索标记没有把插入定位到错误位置。
  },
  /** 随机插入嵌套列表并立即写入其子内容，覆盖父子集成路径。 */
  function insertTypeArray (user, gen) {
    const yarray = user.get('array')
    const pos = prng.int32(gen, 0, yarray.length)
    yarray.insert(pos, [new Y.Type()])
    const array2 = yarray.get(pos)
    array2.insert(0, [1, 2, 3, 4])
  },
  /** 随机插入嵌套 map 并连续覆盖同一属性，覆盖获胜 Item 链。 */
  function insertTypeMap (user, gen) {
    const yarray = user.get('array')
    const pos = prng.int32(gen, 0, yarray.length)
    yarray.insert(pos, [new Y.Type()])
    const map = yarray.get(pos)
    map.setAttr('someprop', 42)
    map.setAttr('someprop', 43)
    map.setAttr('someprop', 44)
  },
  /** 随机插入可序列化的 `null` 标量。 */
  function insertTypeNull (user, gen) {
    const yarray = user.get('array')
    const pos = prng.int32(gen, 0, yarray.length)
    yarray.insert(pos, [null])
  },
  /** 随机删除父列表或嵌套类型范围，并与普通数组镜像比较。 */
  function _delete (user, gen) {
    const yarray = user.get('array')
    const length = yarray.length
    if (length > 0) {
      let somePos = prng.int32(gen, 0, length - 1)
      let delLength = prng.int32(gen, 1, math.min(2, length - somePos))
      if (prng.bool(gen)) {
        const type = yarray.get(somePos)
        if (type instanceof Y.Type && type.length > 0) {
          somePos = prng.int32(gen, 0, type.length - 1)
          delLength = prng.int32(gen, 0, math.min(2, type.length - somePos))
          type.delete(somePos, delLength)
        }
      } else {
        const oldContent = yarray.toArray()
        yarray.delete(somePos, delLength)
        oldContent.splice(somePos, delLength)
        t.compareArrays(yarray.toArray(), oldContent)
      }
    }
  }
]

/**
 * 以 6 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests6 = tc => {
  applyRandomTests(tc, arrayTransactions, 6)
}

/**
 * 以 40 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests40 = tc => {
  applyRandomTests(tc, arrayTransactions, 40)
}

/**
 * 以 42 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests42 = tc => {
  applyRandomTests(tc, arrayTransactions, 42)
}

/**
 * 以 43 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests43 = tc => {
  applyRandomTests(tc, arrayTransactions, 43)
}

/**
 * 以 44 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests44 = tc => {
  applyRandomTests(tc, arrayTransactions, 44)
}

/**
 * 以 45 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests45 = tc => {
  applyRandomTests(tc, arrayTransactions, 45)
}

/**
 * 以 46 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests46 = tc => {
  applyRandomTests(tc, arrayTransactions, 46)
}

/**
 * 以 300 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests300 = tc => {
  applyRandomTests(tc, arrayTransactions, 300)
}

/**
 * 以 400 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests400 = tc => {
  applyRandomTests(tc, arrayTransactions, 400)
}

/**
 * 以 500 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests500 = tc => {
  applyRandomTests(tc, arrayTransactions, 500)
}

/**
 * 以 600 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests600 = tc => {
  applyRandomTests(tc, arrayTransactions, 600)
}

/**
 * 以 1000 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests1000 = tc => {
  applyRandomTests(tc, arrayTransactions, 1000)
}

/**
 * 以 1800 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests1800 = tc => {
  applyRandomTests(tc, arrayTransactions, 1800)
}

/**
 * 以 3000 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests3000 = tc => {
  t.skip(!t.production)
  applyRandomTests(tc, arrayTransactions, 3000)
}

/**
 * 以 5000 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests5000 = tc => {
  t.skip(!t.production)
  applyRandomTests(tc, arrayTransactions, 5000)
}

/**
 * 以 30000 步随机 YArray 事务验证多副本操作与最终收敛。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests30000 = tc => {
  t.skip(!t.production)
  applyRandomTests(tc, arrayTransactions, 30000)
}
