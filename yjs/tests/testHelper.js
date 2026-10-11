import * as Y from '../src/index.js'
import * as t from 'lib0/testing'
import * as prng from 'lib0/prng'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from '@y/protocols/sync'
import * as object from 'lib0/object'
import * as map from 'lib0/map'
import * as math from 'lib0/math'
import * as list from 'lib0/list'
import * as delta from 'lib0/delta'
import { createIdSet, createIdMap, encodeIdMap } from '../src/utils/ids.js'

export * from '../src/index.js'

if (typeof window !== 'undefined') {
  // @ts-ignore
  window.Y = Y // eslint-disable-line
}

/**
 * 把某客户端生成的协议消息排入其他在线客户端的接收队列；发送者离线时不广播。
 *
 * @param {TestYInstance} y - 消息发送者。
 * @param {Uint8Array} m - 已编码同步协议消息。
 */
const broadcastMessage = (y, m) => {
  if (y.tc.onlineConns.has(y)) {
    y.tc.onlineConns.forEach(remoteYInstance => {
      if (remoteYInstance !== y) {
        remoteYInstance._receive(m, y)
      }
    })
  }
}

/** 当前随机测试是否选择 V2 编码；同步协议尚不支持时保持 false。 */
export let useV2 = false

/** V1 update 编解码函数表，让测试可用统一 `enc` 接口切换版本。 */
export const encV1 = {
  encodeStateAsUpdate: Y.encodeStateAsUpdate,
  mergeUpdates: Y.mergeUpdates,
  applyUpdate: Y.applyUpdate,
  logUpdate: Y.logUpdate,
  updateEventName: /** @type {'update'} */ ('update'),
  diffUpdate: Y.diffUpdate
}

/** V2 update 编解码函数表；保留供不依赖 syncProtocol 的检查使用。 */
export const encV2 = {
  encodeStateAsUpdate: Y.encodeStateAsUpdateV2,
  mergeUpdates: Y.mergeUpdatesV2,
  applyUpdate: Y.applyUpdateV2,
  logUpdate: Y.logUpdateV2,
  updateEventName: /** @type {'updateV2'} */ ('updateV2'),
  diffUpdate: Y.diffUpdateV2
}

/** 当前测试使用的 update 编解码函数表。 */
export let enc = encV1

/** 把全局测试编码状态切换为 V1。 */
const useV1Encoding = () => {
  useV2 = false
  enc = encV1
}

/** 请求 V2 时报告协议限制并安全回退 V1，避免 syncProtocol 生成不兼容消息。 */
const useV2Encoding = () => {
  console.error('sync protocol doesnt support v2 protocol yet, fallback to v1 encoding') // TODO：同步协议支持 V2 后再启用该编码分支。
  useV2 = false
  enc = encV1
}

/**
 * 带可控网络收发队列的测试文档实例。
 *
 * @extends {Y.Doc}
 */
export class TestYInstance extends Y.Doc {
  /**
   * 注册到测试连接器，记录全部 update；将 origin 非连接器的 update 编码广播，最后建立连接。
   *
   * @param {TestConnector} testConnector - 负责调度消息的连接器。
   * @param {number} clientID - 稳定测试用户编号；实际 Yjs clientID 由 fixture 随后设置。
   */
  constructor (testConnector, clientID) {
    super()
    /** 稳定测试日志用户编号；不替代 Y.Doc.clientID，后者由 init 设置为用户索引。 */
    this.userID = clientID
    /**
     * 调度当前实例的共享连接器；同时作为远端应用更新的事务 origin。
     * @type {TestConnector}
     */
    this.tc = testConnector
    /**
     * 按发送者分开的 FIFO 接收队列；跨发送者顺序由连接器 PRNG 选择。
     * @type {Map<TestYInstance, Array<Uint8Array>>}
     */
    this.receiving = new Map()
    testConnector.allConns.add(this)
    /** 收到/产生的 update 历史；收敛检查会用 `mergeUpdates` 重建新文档验证编码正确性。
     * @type {Array<Uint8Array<ArrayBuffer>>} */
    this.updates = []
    // 本地或远端 update 都记入历史；非连接器 origin 才再次广播，避免读消息时回环。
    this.on(enc.updateEventName, (update, origin) => {
      if (origin !== testConnector) {
        const encoder = encoding.createEncoder()
        syncProtocol.writeUpdate(encoder, update)
        broadcastMessage(this, encoding.toUint8Array(encoder))
      }
      this.updates.push(update)
    })
    this.connect()
  }

  /** 从在线集合移除并清空本实例的接收队列；其他实例已排队的消息仍保留。 */
  disconnect () {
    this.receiving = new Map()
    this.tc.onlineConns.delete(this)
  }

  /**
   * 加入在线集合并与所有在线 peer 双向发起 SyncStep1；重复连接幂等。
   *
   * 双向握手保证新实例请求他人 state，同时现有实例也请求新实例可能已有的 state。
   */
  connect () {
    if (!this.tc.onlineConns.has(this)) {
      this.tc.onlineConns.add(this)
      const encoder = encoding.createEncoder()
      syncProtocol.writeSyncStep1(encoder, /** @type {any} */ (this))
      // 向所有在线 peer 发布本实例的 SyncStep1。
      broadcastMessage(this, encoding.toUint8Array(encoder))
      this.tc.onlineConns.forEach(remoteYInstance => {
        if (remoteYInstance !== this) {
          // 让每个远端实例也向本实例发 SyncStep1。
          const encoder = encoding.createEncoder()
          syncProtocol.writeSyncStep1(encoder, /** @type {any} */ (remoteYInstance))
          this._receive(encoding.toUint8Array(encoder), remoteYInstance)
        }
      })
    }
  }

  /**
   * 按发送者把消息排队，不立即解码；TestConnector 决定实际投递顺序。
   *
   * @param {Uint8Array} message - 待投递协议消息。
   * @param {TestYInstance} remoteClient - 消息发送者。
   */
  _receive (message, remoteClient) {
    map.setIfUndefined(this.receiving, remoteClient, () => /** @type {Array<Uint8Array>} */ ([])).push(message)
  }
}

/**
 * 维护全部/在线 TestYInstance，并用 seeded PRNG 控制消息、断线与重连顺序。
 *
 * 实例通过 connect/disconnect 自行更新在线集合；连接器只负责确定性调度，便于复现并发交错。
 */
export class TestConnector {
  /**
   * 创建空连接集合。
   *
   * @param {prng.PRNG} gen - 测试用确定性随机源。
   */
  constructor (gen) {
    /**
     * 所有已创建实例，包括断线实例；reconnectAll 从这里恢复连接。
     * @type {Set<TestYInstance>}
     */
    this.allConns = new Set()
    /**
     * 当前在线实例；广播和消息投递仅从此集合选择。
     * @type {Set<TestYInstance>}
     */
    this.onlineConns = new Set()
    /**
     * 共享 seeded PRNG，网络选择与模型随机操作沿用同一随机序列，便于按 seed 复现。
     * @type {prng.PRNG}
     */
    this.prng = gen
  }

  /**
   * 创建并自动连接一个测试文档实例。
   *
   * @param {number} clientID - 测试用户编号。
   * @return {TestYInstance} 新实例。
   */
  createY (clientID) {
    return new TestYInstance(this, clientID)
  }

  /**
   * 随机选择在线接收者、发送者队列及其首条消息，解码处理并把协议回复重新排队。
   *
   * 单次只投递一条，seeded PRNG 可复现不同网络交错；每个发送者队列内仍按 FIFO 处理。无在线待收消息时返回 false。
   *
   * @return {boolean} 是否实际处理了一条消息。
   */
  flushRandomMessage () {
    const gen = this.prng
    const conns = Array.from(this.onlineConns).filter(conn => conn.receiving.size > 0)
    if (conns.length > 0) {
      const receiver = prng.oneOf(gen, conns)
      const [sender, messages] = prng.oneOf(gen, Array.from(receiver.receiving))
      const m = messages.shift()
      if (messages.length === 0) {
        receiver.receiving.delete(sender)
      }
      if (m === undefined) {
        return this.flushRandomMessage()
      }
      const encoder = encoding.createEncoder()
      // console.log('receive (' + sender.userID + '->' + receiver.userID + '):\n', syncProtocol.stringifySyncMessage(decoding.createDecoder(m), receiver))
      // 应用远端 update 时使用 connector origin，文档监听器因此不再广播；SyncStep1 的协议回复单独发回原发送者。
      syncProtocol.readSyncMessage(decoding.createDecoder(m), encoder, /** @type {any} */ (receiver), receiver.tc)
      if (encoding.length(encoder) > 0) {
        // 即使原发送者此刻离线，也把回复放入其接收队列；flush 只选择在线接收者。
        sender._receive(encoding.toUint8Array(encoder), receiver)
      }
      return true
    }
    return false
  }

  /**
   * 持续随机投递直到所有在线接收队列为空。
   *
   * @return {boolean} 本次是否至少处理过一条消息。
   */
  flushAllMessages () {
    let didSomething = false
    while (this.flushRandomMessage()) {
      didSomething = true
    }
    return didSomething
  }

  /** 连接全部已创建实例，并触发各自同步握手。 */
  reconnectAll () {
    this.allConns.forEach(conn => conn.connect())
  }

  /** 断开全部实例并清空其待收消息。 */
  disconnectAll () {
    this.allConns.forEach(conn => conn.disconnect())
  }

  /** 连接全部实例并排空协议消息，形成收敛屏障。 */
  syncAll () {
    this.reconnectAll()
    this.flushAllMessages()
  }

  /**
   * 随机断开一个在线实例。
   *
   * @return {boolean} 是否存在并断开了在线实例。
   */
  disconnectRandom () {
    if (this.onlineConns.size === 0) {
      return false
    }
    prng.oneOf(this.prng, Array.from(this.onlineConns)).disconnect()
    return true
  }

  /**
   * 随机重连一个离线实例。
   *
   * @return {boolean} 是否存在并重连了离线实例。
   */
  reconnectRandom () {
    /**
     * @type {Array<TestYInstance>}
     */
    const reconnectable = []
    this.allConns.forEach(conn => {
      if (!this.onlineConns.has(conn)) {
        reconnectable.push(conn)
      }
    })
    if (reconnectable.length === 0) {
      return false
    }
    prng.oneOf(this.prng, reconnectable).connect()
    return true
  }
}

/**
 * 创建指定数量的互联测试文档和 array/map/xml/text 四个根类型，clientID 固定为用户索引。
 * 先完成首次握手同步，再调用每用户的 fixture 回调。
 * fixture 回调产生的新消息不会在返回前再次排空。
 *
 * 编码版本由测试 PRNG 选择；fixture 建立后重置为 V1，避免全局状态泄漏到后续用例。
 *
 * 返回属性按实际 users 数量创建，array0 等快捷引用并不保证在 users<对应索引+1 时存在。同步协议当前使用 V1；PRNG 请求 V2 的分支仍回退 V1。
 *
 * @template T
 * @param {t.TestCase} tc - 提供 PRNG 的测试上下文。
 * @param {{users?:number}} conf - 用户数量配置。
 * @param {InitTestObjectCallback<T>} [initTestObject] - 为每个用户建立额外 fixture。
 * @return {{testObjects:Array<any>,testConnector:TestConnector,users:Array<TestYInstance>,array0:Y.Type<any>,array1:Y.Type<any>,array2:Y.Type<any>,map0:Y.Type<any>,map1:Y.Type<any>,map2:Y.Type<any>,map3:Y.Type<any>,text0:Y.Type,text1:Y.Type,text2:Y.Type,xml0:Y.Type,xml1:Y.Type,xml2:Y.Type}}
 */
export const init = (tc, { users = 5 } = {}, initTestObject) => {
  /**
   * @type {Object<string,any>}
   */
  const result = {
    users: []
  }
  const gen = tc.prng
  // 随机选择编码路径；当前 V2 请求会明确回退 V1。
  if (prng.bool(gen)) {
    useV2Encoding()
  } else {
    useV1Encoding()
  }

  const testConnector = new TestConnector(gen)
  result.testConnector = testConnector
  for (let i = 0; i < users; i++) {
    const y = testConnector.createY(i)
    y.clientID = i
    result.users.push(y)
    result['array' + i] = y.get('array')
    result['map' + i] = y.get('map')
    result['xml' + i] = y.get('xml')
    result['text' + i] = y.get('text')
  }
  testConnector.syncAll()
  result.testObjects = result.users.map(initTestObject || (() => null))
  useV1Encoding()
  return /** @type {any} */ (result)
}

/**
 * 逐 client、clock、len 断言两个 IdSet 的规范区间完全相等。
 *
 * 读取双方 getIds 会触发原位规范化；此 helper 比较覆盖边界，不区分 Item、GC、Skip 或可见载荷。
 *
 * @param {Y.IdSet} idSet1 - 左集合。
 * @param {Y.IdSet} idSet2 - 右集合。
 * @return {boolean} 全部断言通过后返回 true。
 */
export const compareIdSets = (idSet1, idSet2) => {
  t.assert(idSet1.clients.size === idSet2.clients.size)
  for (const [client, _items1] of idSet1.clients.entries()) {
    const items1 = _items1.getIds()
    const items2 = idSet2.clients.get(client)?.getIds()
    t.assert(items2 !== undefined && items1.length === items2.length)
    for (let i = 0; i < items1.length; i++) {
      const di1 = items1[i]
      const di2 = /** @type {Array<import('../src/utils/ids.js').IdRange>} */ (items2)[i]
      t.assert(di1.clock === di2.clock && di1.len === di2.len)
    }
  }
  return true
}

/**
 * 按稳定 hash 在属性数组中查找等价 ContentAttribute，仅供测试比较。
 *
 * @template T
 * @param {Array<Y.ContentAttribute<T>>} attrs
 * @param {Y.ContentAttribute<T>} attr
 *
 */
const _idmapAttrsHas = (attrs, attr) => {
  const hash = attr.hash()
  return attrs.find(a => a.hash() === hash)
}

/**
 * 忽略数组顺序，按属性 hash 比较两个 ContentAttribute 集合，仅供测试。
 *
 * @template T
 * @param {Array<Y.ContentAttribute<T>>} a
 * @param {Array<Y.ContentAttribute<T>>} b
 */
export const _idmapAttrsEqual = (a, b) => a.length === b.length && a.every(v => _idmapAttrsHas(b, v))

/**
 * 校验 IdMap 每个区间属性都在 attrs/attrsH 索引中，再按每个属性重复 add 重建副本，比较分段数量。
 * 空属性区间不进入属性循环，因此不会被重建；此 helper 的断言不能用作空属性范围的完整验证。
 *
 * @template T
 * @param {Y.IdMap<T>} idmap
 */
export const validateIdMap = idmap => {
  const copy = Y.createIdMap()
  idmap.clients.forEach((ranges, client) => {
    ranges.getIds().forEach(range => {
      range.attrs.forEach(attr => {
        t.assert(idmap.attrs.has(attr))
        t.assert(idmap.attrsH.get(attr.hash()) === attr)
        copy.add(client, range.clock, range.len, range.attrs.slice())
      })
    })
    t.assert(copy.clients.get(client)?.getIds().length === ranges.getIds().length)
  })
  t.assert(idmap.attrsH.size === idmap.attrs.size)
}

/**
 * 逐 client、区间与属性集合断言两个 IdMap 相等，并分别执行内部索引一致性校验。
 *
 * 属性比较按 hash 忽略顺序，并调用 validateIdMap 检查两侧索引；哈希碰撞或重复属性出现次数不是此比较的独立检查项。
 *
 * @template T
 * @param {Y.IdMap<T>} idmap1
 * @param {Y.IdMap<T>} idmap2
 */
export const compareIdmaps = (idmap1, idmap2) => {
  t.assert(idmap1.clients.size === idmap2.clients.size)
  for (const [client, _items1] of idmap1.clients.entries()) {
    const items1 = _items1.getIds()
    const items2 = idmap2.clients.get(client)?.getIds()
    t.assert(items2 !== undefined && items1.length === items2.length)
    for (let i = 0; i < items1.length; i++) {
      const di1 = items1[i]
      const di2 = /** @type {Array<import('../src/utils/ids.js').AttrRange<T>>} */ (items2)[i]
      t.assert(di1.clock === di2.clock && di1.len === di2.len && _idmapAttrsEqual(di1.attrs, di2.attrs))
    }
  }
  validateIdMap(idmap1)
  validateIdMap(idmap2)
}

/**
 * 生成带重叠/空洞的随机 IdSet，供区间算法性质测试。
 *
 * clockStart 随机区间含 clockRange 端点，len 上限为 clockRange-clockStart；零长 add 被忽略。末尾可随机删 client 键，抽到不存在的编号也只执行空操作。
 *
 * @param {prng.PRNG} gen - 确定性随机源。
 * @param {number} clients - client 数量。
 * @param {number} clockRange - 每个 client 的排他最大 clock。
 * @return {Y.IdSet} 延迟规范化的随机集合；本函数不调用 getIds，可能仍含无序或重叠范围。
 */
export const createRandomIdSet = (gen, clients, clockRange) => {
  const maxOpLen = 5
  const numOfOps = math.ceil((clients * clockRange) / maxOpLen)
  const idset = createIdSet()
  for (let i = 0; i < numOfOps; i++) {
    const client = prng.uint32(gen, 0, clients - 1)
    const clockStart = prng.uint32(gen, 0, clockRange)
    const len = prng.uint32(gen, 0, clockRange - clockStart)
    idset.add(client, clockStart, len)
  }
  if (idset.clients.size === clients && clients > 1 && prng.bool(gen)) {
    idset.clients.delete(prng.uint32(gen, 0, clients))
  }
  return idset
}

/**
 * 生成带随机属性组合的 IdMap，并通过 encodeIdMap 规范化范围、报告编码体积。
 * 每轮至少构造一个属性定义；attrChoices 为空时选择结果为 undefined，仍写入空名称属性，
 * 因此传入 [] 并不生成 attrs=[] 的范围。
 *
 * @template T
 * @param {prng.PRNG} gen - 确定性随机源。
 * @param {number} clients - client 数量。
 * @param {number} clockRange - 每个 client 的排他最大 clock。
 * @param {Array<T>} attrChoices - 可选属性值。
 * @return {Y.IdMap<T>}
 */
export const createRandomIdMap = (gen, clients, clockRange, attrChoices) => {
  const maxOpLen = 5
  const numOfOps = math.ceil((clients * clockRange) / maxOpLen)
  const idMap = createIdMap()
  for (let i = 0; i < numOfOps; i++) {
    const client = prng.uint32(gen, 0, clients - 1)
    const clockStart = prng.uint32(gen, 0, clockRange)
    const len = prng.uint32(gen, 0, clockRange - clockStart)
    const attrs = [prng.oneOf(gen, attrChoices)]
    // 随机附加第二个不同属性，覆盖多属性合并路径。
    if (prng.bool(gen)) {
      const a = prng.oneOf(gen, attrChoices)
      if (attrs.find(attr => attr === a) == null) {
        attrs.push(a)
      }
    }
    idMap.add(client, clockStart, len, attrs.map(v => Y.createContentAttribute('', v)))
  }
  t.info(`Created IdMap with ${numOfOps} ranges and ${attrChoices.length} different attributes. Encoded size: ${encodeIdMap(idMap).byteLength}`)
  return idMap
}

/**
 * 建立同步屏障后，从各用户 update 历史重建合并文档，断言可见内容、state vector、结构布局、snapshot 与各 store.ds 一致。
 * 循环中的 equalIdSets 返回值未作断言；删除一致性实际还由 snapshot 字节与最后的 compareIdSets 检查。
 *
 * 网络副本和 mergeUpdates 重建文档一起参与收敛断言；最后销毁数组中全部文档。追加的重建文档不会从 users 数组移除。
 *
 * @param {Array<TestYInstance>} users - 待检查副本；函数会追加重建文档并销毁全部实例。
 */
export const compare = users => {
  users.forEach(u => u.connect())
  while (users[0].tc.flushAllMessages()) {} // eslint-disable-line
  // 合并每个文档记录的全部 update 并重建副本，把 `mergeUpdates` 结果纳入同一收敛检查。
  const mergedDocs = users.map(user => {
    const ydoc = new Y.Doc()
    enc.applyUpdate(ydoc, enc.mergeUpdates(user.updates))
    return ydoc
  })
  users.push(.../** @type {any} */(mergedDocs))
  const userArrayValues = users.map(u => u.get('array').toJSON().children ?? [])
  const userMapValues = users.map(u => u.get('map').toJSON().attrs ?? {})
  // TODO：为合并文档的 XML 根类型补齐精确类型，移除下一行抑制。
  // @ts-ignore
  const userXmlValues = users.map(u => u.get('xml').toString())
  const userTextValues = users.map(u => u.get('text').toDeltaDeep())
  for (const u of users) {
    t.assert(u.store.pendingDs === null)
    t.assert(u.store.pendingStructs === null)
  }
  // Map 属性迭代器必须与 JSON 可见键集合一致。
  const ymapkeys = Array.from(users[0].get('map').attrKeys())
  t.assert(ymapkeys.length === Object.keys(userMapValues[0]).length)
  ymapkeys.forEach(key => t.assert(object.hasProperty(userMapValues[0], key)))
  // 两两比较可见状态与底层结构不变量。
  for (let i = 0; i < users.length - 1; i++) {
    t.compare(userArrayValues[i].length, users[i].get('array').length)
    t.compare(userArrayValues[i], userArrayValues[i + 1])
    t.compare(userMapValues[i], userMapValues[i + 1])
    t.compare(userXmlValues[i], userXmlValues[i + 1])
    t.compare(list.toArray(userTextValues[i].children).map(a => (delta.$textOp.check(a) || delta.$insertOp.check(a)) ? a.insert.length : 0).reduce((a, b) => a + b, 0), users[i].get('text').length)
    t.compare(userTextValues[i], userTextValues[i + 1], '', (_constructor, a, b) => {
      if (a instanceof Y.Type) {
        t.compare(a.toJSON(), b.toJSON())
      } else if (a !== b) {
        t.fail('Deltas dont match')
      }
      return true
    })
    t.compare(Y.encodeStateVector(users[i]), Y.encodeStateVector(users[i + 1]))
    Y.equalIdSets(Y.createDeleteSetFromStructStore(users[i].store), Y.createDeleteSetFromStructStore(users[i + 1].store))
    compareStructStores(users[i].store, users[i + 1].store)
    t.compare(Y.encodeSnapshot(Y.snapshot(users[i])), Y.encodeSnapshot(Y.snapshot(users[i + 1])))
  }
  users.forEach(user => {
    compareIdSets(user.store.ds, Y.createDeleteSetFromStructStore(user.store))
  })
  users.map(u => u.destroy())
}

/**
 * 比较两个可空 Item 引用是否同空或具有相同 ID。
 *
 * @param {Y.Item?} a - 左 Item。
 * @param {Y.Item?} b - 右 Item。
 * @return {boolean} 身份位置相等时为 true。
 */
export const compareItemIDs = (a, b) => a === b || (a !== null && b != null && Y.compareIDs(a.id, b.id))

/**
 * 比较两个 StructStore 的结构类型、ID、删除状态、长度、邻接来源与双向链连接。
 * 不直接比较 Item.content、parent、keep、redone 或 store.skips；可见载荷由 compare 的类型值比较承担。
 *
 * @param {StructStore} ss1 - 左 store。
 * @param {StructStore} ss2 - 右 store。
 */
export const compareStructStores = (ss1, ss2) => {
  t.assert(ss1.clients.size === ss2.clients.size)
  for (const [client, structs1] of ss1.clients) {
    const structs2 = /** @type {Array<Y.AbstractStruct>} */ (ss2.clients.get(client))
    t.assert(structs2 !== undefined && structs1.length === structs2.length)
    for (let i = 0; i < structs1.length; i++) {
      const s1 = structs1[i]
      const s2 = structs2[i]
      // 先比较所有 AbstractStruct 共有字段。
      if (
        s1.constructor !== s2.constructor ||
        !Y.compareIDs(s1.id, s2.id) ||
        s1.deleted !== s2.deleted ||
        // @ts-ignore
        s1.length !== s2.length
      ) {
        t.fail('Structs dont match')
      }
      if (s1 instanceof Y.Item) {
        if (
          !(s2 instanceof Y.Item) ||
          !((s1.left === null && s2.left === null) || (s1.left !== null && s2.left !== null && Y.compareIDs(s1.left.lastId, s2.left.lastId))) ||
          !compareItemIDs(s1.right, s2.right) ||
          !Y.compareIDs(s1.origin, s2.origin) ||
          !Y.compareIDs(s1.rightOrigin, s2.rightOrigin) ||
          s1.parentSub !== s2.parentSub
        ) {
          return t.fail('Items dont match')
        }
        // 双向 linked-list 指针必须互相回指。
        t.assert(s1.left === null || s1.left.right === s1)
        t.assert(s1.right === null || s1.right.left === s1)
        t.assert(s2.left === null || s2.left.right === s2)
        t.assert(s2.right === null || s2.right.left === s2)
      }
    }
  }
}

/**
 * 为每个测试文档创建用户自定义 fixture。
 *
 * @template T
 * @callback InitTestObjectCallback
 * @param {TestYInstance} y
 * @return {T}
 */

/**
 * 在五个固定 clientID 用户上交错执行变更、消息投递与断线重连，结束时调用 `compare()` 重连并验证全副本收敛。
 * 每轮先抽取网络分支，再必定选一个用户执行一个 mods 变更；各网络概率是逐个 if/else 条件的随机抽样，不能相加视作一次抽样阈值。
 *
 * iterations=0 时仅建立 fixture 并执行 compare，未触发 mods；空 mods 在正轮次没有有效候选，不构成任何模型变更覆盖。
 *
 * @template T
 * @param {t.TestCase} tc - 提供 seeded PRNG 的测试上下文。
 * @param {Array<function(Y.Doc,prng.PRNG,T):void>} mods - 非空的模型变更候选；传入的函数修改选中用户与其 fixture。
 * @param {number} iterations - 交错次数。
 * @param {InitTestObjectCallback<T>} [initTestObject] - 每用户附加 fixture 工厂。
 * @return {ApplyRandomTestsResult} 完整 fixture；compare 已销毁 users 内文档，并追加了合并重建的文档。
 */
export const applyRandomTests = (tc, mods, iterations, initTestObject) => {
  const gen = tc.prng
  const result = init(tc, { users: 5 }, initTestObject)
  const { testConnector, users } = result
  for (let i = 0; i < iterations; i++) {
    if (prng.int32(gen, 0, 100) <= 2) {
      // 小概率随机断线或重连，覆盖离线积累与重新握手。
      if (prng.bool(gen)) {
        testConnector.disconnectRandom()
      } else {
        testConnector.reconnectRandom()
      }
    } else if (prng.int32(gen, 0, 100) <= 1) {
      // 小概率排空在线实例的接收队列；离线实例此时不重连。
      testConnector.flushAllMessages()
    } else if (prng.int32(gen, 0, 100) <= 50) {
      // 常态只投递一条随机消息，扩大因果交错空间。
      testConnector.flushRandomMessage()
    }
    const user = prng.int32(gen, 0, users.length - 1)
    const test = prng.oneOf(gen, mods)
    test(users[user], gen, result.testObjects[user])
  }
  compare(users)
  return result
}

/** 随机测试驱动返回的完整 fixture 类型。
 * @typedef {ReturnType<typeof applyRandomTests>} ApplyRandomTestsResult */
