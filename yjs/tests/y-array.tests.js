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
 * 两个新文档的列表均为空；doc1 插入 `hi`，编码完整更新并应用到 doc2。doc2 的数组内容为 `[hi]`。
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
 * 在开发模式把普通数组和对象分别写入列表与属性；从外部原地修改这两个原值。两次修改都因冻结抛错。
 * 非开发模式仅打印提示，没有执行冻结检查。
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
 * 列表先存入 `[1,2,3]`；读取省略终点、偏移起点与负终点的切片，再头插 0。切片分别匹配原数组与 `[0,1]` 等半开区间结果。
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
 * 由含 `[0,1,2]` 的 Delta 创建尚未集成子类型；把它设为文档根类型的 array 属性。集成时应用 preliminary Delta，子列表可读为 `[0,1,2]`。
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
 * 列表已有四个元素；在独立事务与一个外层事务内交错删除、重新插入。每个断言位置的 `length` 都等于 `toArray().length`。
 * 回归 yjs#297。
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
 * 一串插入、删除后列表有四个元素；嵌套事务先尝试位置 5 插入，再在 4 尾插并删除。越界插入抛错，后两个合法操作正常返回。
 * 回归 yjs#314；错误发生在定位 retain，尚未插入。末尾只打印数组，没有内容或长度断言。
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
      // 越界定位没有插入内容；上个嵌套调用成功插入的末尾元素现在可正常删除。
      next.delete(4)
    })
  })
  console.log(next.toArray())
}

/**
 * 两个副本的列表均为空；在 0 删除零个元素、尝试从 1 删除，再插入 A 并在末尾删除零个。合法零长度操作返回，越界定位抛错，最终 compare 检查副本收敛。
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
 * 两个副本的列表均为空；一次插入 `[1,true,false]`，随后投递更新。本地和远端 Delta 均等于这三个标量的一次 insert，并通过最终收敛比较。
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
 * 三个空列表尚未交换这轮写入；各自都在索引 0 插入本端编号。compare 重连并投递消息后，内容和底层结构一致。
 * 此处不单独约束具体排序。
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
 * 三个副本已同步 `[x,y,z]`；两端在位置 1 插入编号，另一端删除 x 与 z。compare 交换并发操作后，各副本内容及结构收敛。
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
 * 三端已有 `[x,y]`，其中两端断线；各端在 x 后插入自己的标签，再重连离线端。消息排空与 compare 后，各副本可见内容及底层结构相同。
 * 没有单独断言三个标签的数量或具体排序。
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
 * 三端已有 `[x,y]`，其中两端断线；在线端插入 user0、离线端插入 user1。重连前两端分别只看到自己的插入；重连后 compare 检查收敛。
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
 * 两端已同步 `[x,y]`，第二端断线；离线端删除 y，在线端删除整段，再重连。重叠删除合并后 compare 检查两端收敛。
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
 * 两端已同步 `[x,y,z]`，第一端断线；第二端删除三个元素，再重连第一端。compare 检查删除更新合并后两端内容和结构相同。
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
 * 空列表注册浅层 observer，以变量保存最后一个事件；插入三个元素，再分两次删完，每次动作前清空变量。每次调用返回时都已收到事件，并通过最终副本比较。
 * 非空检查不统计事件次数。
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
 * 空列表注册会在长度 1 时继续插入的 observer；先插入 0，第一轮回调内插入 1 并记录 0。回调记录为 `[0,1]`，数组也为 `[0,1]`：新事务写入立即执行，第二轮通知排在当前回调之后。
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
 * 空父列表注册浅层 observer；插入一个空 Y.Type，再删除它。两个操作返回前均已收到父列表事件，最终副本收敛。
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
 * 空列表注册 observer 捕获事件 Delta；插入子类型和两个标量，删除前两项，再在剩余项后插入 0.1。事件依次为整批 insert、delete(2)、retain(1)+insert(0.1)，且操作数量符合断言。
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
 * 空列表用数组累积浅层事件；同批插入 hi 与空子类型，再删除子类型。第一次后恰有一个事件，第二次后恰有两个事件，并通过最终副本比较。
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
 * 空父列表准备插入一个已注册 observer 的新子类型；同一外层事务内集成子类型并设置其 tst 属性。子类型 observer 未触发。
 * 回归 yjs#155；新子状态由父项的插入携带，本用例只断言子 observer 未触发。
 *
 * 问题来源：https://github.com/yjs/yjs/issues/155
 *
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
 * 三端已同步 `[x,y,z]`，第一端断线；该端删完整段后重连并排空消息。compare 检查可见内容、删除集、状态向量与结构一致。
 * 没有直接断言 GC 的次数或回收对象数量。
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
 * 三端空列表中 array0 注册 observer；array0 本地插入 stuff。保存事件的 target 正是 array0，最终副本收敛。
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
 * 三端空列表中 array0 注册 observer；array1 插入 stuff，再投递消息。array0 收到的事件 target 为本地 array0，最终副本收敛。
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
 * 空列表依次追加十个子类型，每个 value 属性设为自己的序号；遍历 `toArray()` 并读取子属性。每个遍历到的子属性都等于递增序号，随后销毁文档。
 * 没有单独断言遍历数量恰为十个。
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
 * 关闭 GC 的列表已有 `[1,2]`，afterTransaction 将本轮 ID 集转成空作者归因；同一事务删除 1，再在 2 后插入 42。完整视图依次输出带 delete 归因的 1、普通 2、带 insert 归因的 42。
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
 * 随机列表操作集合；普通值插入和父列表删除用数组镜像比较，嵌套写入由最终副本比较检查。
 *
 * @type {Array<function(Doc,prng.PRNG,any):void>}
 */
const arrayTransactions = [
  /** 随机批量插入同一唯一值，并用普通数组镜像检查插入位置。 */
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
    t.compareArrays(yarray.toArray(), oldContent) // 本地结果应与普通数组在同一索引 splice 后一致。
  },
  /** 在当前父列表的随机合法索引插入空子类型，再写入四个数；这里不单独断言，最终 compare 检查嵌套状态。 */
  function insertTypeArray (user, gen) {
    const yarray = user.get('array')
    const pos = prng.int32(gen, 0, yarray.length)
    yarray.insert(pos, [new Y.Type()])
    const array2 = yarray.get(pos)
    array2.insert(0, [1, 2, 3, 4])
  },
  /** 在当前列表的随机合法位置插入子类型，连续把 someprop 设为 42/43/44；最终 compare 检查覆盖后的子状态。 */
  function insertTypeMap (user, gen) {
    const yarray = user.get('array')
    const pos = prng.int32(gen, 0, yarray.length)
    yarray.insert(pos, [new Y.Type()])
    const map = yarray.get(pos)
    map.setAttr('someprop', 42)
    map.setAttr('someprop', 43)
    map.setAttr('someprop', 44)
  },
  /** 在当前列表的随机合法位置插入 null；最终 compare 检查它与其他操作交错后的序列状态。 */
  function insertTypeNull (user, gen) {
    const yarray = user.get('array')
    const pos = prng.int32(gen, 0, yarray.length)
    yarray.insert(pos, [null])
  },
  /** 父列表非空时随机删除父项或非空子列表范围；只有父项分支就地与数组镜像比较，子项结果由最终 compare 检查。 */
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
 * 随机驱动建立五个空列表副本；交错执行 6 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests6 = tc => {
  applyRandomTests(tc, arrayTransactions, 6)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 40 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests40 = tc => {
  applyRandomTests(tc, arrayTransactions, 40)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 42 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests42 = tc => {
  applyRandomTests(tc, arrayTransactions, 42)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 43 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests43 = tc => {
  applyRandomTests(tc, arrayTransactions, 43)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 44 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests44 = tc => {
  applyRandomTests(tc, arrayTransactions, 44)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 45 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests45 = tc => {
  applyRandomTests(tc, arrayTransactions, 45)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 46 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests46 = tc => {
  applyRandomTests(tc, arrayTransactions, 46)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 300 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests300 = tc => {
  applyRandomTests(tc, arrayTransactions, 300)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 400 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests400 = tc => {
  applyRandomTests(tc, arrayTransactions, 400)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 500 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests500 = tc => {
  applyRandomTests(tc, arrayTransactions, 500)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 600 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests600 = tc => {
  applyRandomTests(tc, arrayTransactions, 600)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 1000 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests1000 = tc => {
  applyRandomTests(tc, arrayTransactions, 1000)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 1800 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 嵌套写入由最终副本比较检查。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests1800 = tc => {
  applyRandomTests(tc, arrayTransactions, 1800)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 3000 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 仅 production 测试模式执行，其他模式由 t.skip 跳过。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests3000 = tc => {
  t.skip(!t.production)
  applyRandomTests(tc, arrayTransactions, 3000)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 5000 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 仅 production 测试模式执行，其他模式由 t.skip 跳过。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests5000 = tc => {
  t.skip(!t.production)
  applyRandomTests(tc, arrayTransactions, 5000)
}

/**
 * 随机驱动建立五个空列表副本；交错执行 30000 步普通/嵌套插入、删除与随机消息和连线动作。普通插入及父列表删除用数组镜像就地比较，结束时 compare 检查内容和结构收敛。
 * 仅 production 测试模式执行，其他模式由 t.skip 跳过。
 *
 * @param {t.TestCase} tc
 */
export const testRepeatGeneratingYarrayTests30000 = tc => {
  t.skip(!t.production)
  applyRandomTests(tc, arrayTransactions, 30000)
}
