import { Skip } from '../structs/Skip.js'
import { createID } from './ID.js'
import { createDeleteSetFromStructStore, createIdSet } from './ids.js'
import { findIndexSS } from './transaction-helpers.js'

/**
 * 按客户端保存已集成结构，并暂存尚不能应用的结构与删除集。
 *
 * `clients` 中每个数组按时钟升序且无空洞；显式 `Skip` 同时记录在 `skips`，待
 * 缺失更新到达后原位替换。`pendingStructs` 与 `pendingDs` 始终采用 V2 更新格式。
 */
export class StructStore {
  /** 初始化空结构索引和待处理更新槽。 */
  constructor () {
    /**
     * 每个客户端按时钟升序排列的连续结构数组。
     *
     * @type {Map<number,Array<GC|Item|Skip>>}
     */
    this.clients = new Map()
    /**
     * 因果依赖缺失而无法集成的 V2 更新及其最早缺失时钟。
     *
     * @type {null | { missing: Map<number, number>, update: Uint8Array<ArrayBuffer> }}
     */
    this.pendingStructs = null
    /**
     * 因目标结构尚未到达而无法应用的纯删除 V2 更新。
     *
     * @type {null | Uint8Array<ArrayBuffer>}
     */
    this.pendingDs = null
    this.skips = createIdSet()
  }

  /** 从当前结构状态即时构造删除集。 */
  get ds () {
    return createDeleteSetFromStructStore(this)
  }

  /**
   * 追加结构，或用真实结构精确替换已集成 Skip 的相应区间。
   *
   * 正常追加要求上一结构末钟等于新结构首钟。若不连续，唯一允许情形是新结构
   * 落在 Skip 内：方法保留缺口两侧片段、替换中段，并同步删除 `skips` 范围。
   *
   * @param {GC|Item|Skip} struct
   * @function
   */
  add (struct) {
    let structs = this.clients.get(struct.id.client)
    if (structs === undefined) {
      structs = []
      this.clients.set(struct.id.client, structs)
    } else {
      const lastStruct = structs[structs.length - 1]
      if (lastStruct.id.clock + lastStruct.length !== struct.id.clock) {
        // 非尾部追加只允许替换已经集成的 Skip。
        let index = findIndexSS(structs, struct.id.clock)
        const skip = structs[index]
        const diffStart = struct.id.clock - skip.id.clock
        const diffEnd = skip.id.clock + skip.length - struct.id.clock - struct.length
        if (diffStart > 0) {
          structs.splice(index++, 0, new Skip(createID(struct.id.client, skip.id.clock), diffStart))
        }
        if (diffEnd > 0) {
          structs.splice(index + 1, 0, new Skip(createID(struct.id.client, struct.id.clock + struct.length), diffEnd))
        }
        structs[index] = struct
        this.skips.delete(struct.id.client, struct.id.clock, struct.length)
        return
      }
    }
    structs.push(struct)
  }

  /**
   * 返回覆盖指定 ID 的结构。
   *
   * 前置条件：ID 必须已存在；调用方应先完成状态/缺失依赖检查。
   *
   * @param {ID} id
   * @return {GC|Item}
   */
  get (id) {
    const structs = /** @type {Array<GC|Item>} */ (this.clients.get(id.client))
    return structs[findIndexSS(structs, id.clock)]
  }

  /**
   * 返回覆盖指定 ID 的 Item。
   *
   * 前置条件：ID 必须存在且对应可寻址 Item；类型收窄由调用链保证。
   *
   * @param {ID} id
   * @return {Item}
   */
  getItem (id) {
    const structs = /** @type {Array<GC|Item>} */ (this.clients.get(id.client))
    return /** @type {Item} */ (structs[findIndexSS(structs, id.clock)])
  }

  /**
   * 返回指定客户端下一个期望的逻辑时钟。
   *
   * @param {number} client
   * @return {number}
   *
   * @public
   * @function
   */
  getClock (client) {
    const structs = this.clients.get(client)
    if (structs === undefined) {
      return 0
    }
    const lastStruct = structs[structs.length - 1]
    return lastStruct.id.clock + lastStruct.length
  }

  /**
   * 在客户端的有序结构数组中定位覆盖 ID 的索引。
   * @param {ID} id
   * @return {{ structs: Array<GC|Item|Skip>, index: number }}
   *
   * @function
   */
  getIndex (id) {
    const structs = this.clients.get(id.client) || []
    const index = findIndexSS(structs, id.clock)
    return { structs, index }
  }
}

/**
 * 从存储计算状态向量 `client → nextClock`。
 *
 * 若客户端存在 Skip，状态不能越过最早缺口，故用该缺口起始时钟覆盖数组
 * 尾端值；接收方只会请求已连续掌握的前缀。
 *
 * @param {StructStore} store
 * @return {Map<number,number>}
 *
 * @public
 * @function
 */
export const getStateVector = store => {
  const sm = new Map()
  store.clients.forEach((structs, client) => {
    const struct = structs[structs.length - 1]
    sm.set(client, struct.id.clock + struct.length)
  })
  store.skips.clients.forEach((range, client) => {
    sm.set(client, range.getIds()[0].clock)
  })
  return sm
}

/**
 * 校验每个客户端的结构区间严格首尾相接。
 *
 * 此检查只验证存储连续性，不验证 CRDT 左右链接或内容不变量。
 *
 * @param {StructStore} store
 *
 * @private
 * @function
 */
export const integrityCheck = store => {
  store.clients.forEach(structs => {
    for (let i = 1; i < structs.length; i++) {
      const l = structs[i - 1]
      const r = structs[i]
      if (l.id.clock + l.length !== r.id.clock) {
        throw new Error('StructStore failed integrity check')
      }
    }
  })
}
