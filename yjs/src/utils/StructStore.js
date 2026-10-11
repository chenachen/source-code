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
     * 因果依赖缺失而无法集成的 V2 更新，以及发现缺失时各客户端的存储尾钟水位。
     *
     * `missing` 对同客户端保留最小水位，用于判断新更新是否值得重试；依赖落在旧
     * Skip 内时，真实缺失 ID 可以早于该水位。
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
    /** clients 中 Skip 覆盖的 ID 区间；真实结构补齐后由 add 删除对应范围。 */
    this.skips = createIdSet()
  }

  /** 从当前结构状态即时构造删除集。 */
  get ds () {
    return createDeleteSetFromStructStore(this)
  }

  /**
   * 追加结构，或用真实结构精确替换已集成 Skip 的相应区间。
   *
   * 正常追加要求上一结构末钟等于新结构首钟。非尾部追加时，调用方须保证新结构
   * 完全落在一个 Skip 内；此方法不再检查类型，而是保留缺口两侧片段、替换中段，
   * 并从 `skips` 移除新结构覆盖的范围。
   *
   * 首次添加的结构也须从 clock 0 起；因果集成入口会在非零起点前先补 Skip，此处不代做该检查。
   *
   * @param {GC|Item|Skip} struct 已裁剪并解析依赖的结构对象，直接存入数组，不复制载荷。
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
   * 前置条件：ID 必须落在存储数组覆盖的区间内。此方法不排除 Skip；需要真实
   * 内容的调用方还须检查 `store.skips`。
   *
   * @param {ID} id 已存在区间内的 client/clock；不存在时二分查找无法给出有效结构。
   * @return {GC|Item} 存储内原对象；类型标注未列 Skip，但运行时可能返回 Skip。
   */
  get (id) {
    const structs = /** @type {Array<GC|Item>} */ (this.clients.get(id.client))
    return structs[findIndexSS(structs, id.clock)]
  }

  /**
   * 按 Item 类型访问覆盖指定 ID 的结构。
   *
   * 这里只作类型断言，不检查结构类型；依赖解析也会用它取得 GC，再检查构造器。
   * 需要访问 Item 字段的调用方须保证目标 ID 已存在且对应 Item。
   *
   * @param {ID} id 要查询的已知 ID；位于 Item 中间时返回包含它的整段，不切分。
   * @return {Item} 存储内原对象，Item 类型仅靠调用者前置条件保证。
   */
  getItem (id) {
    const structs = /** @type {Array<GC|Item>} */ (this.clients.get(id.client))
    return /** @type {Item} */ (structs[findIndexSS(structs, id.clock)])
  }

  /**
   * 返回指定客户端存储数组尾端的时钟；没有结构时返回 0。
   *
   * 尾端包含 Skip，不能据此认定之前全部内容已知。同步时表示连续已知前缀的
   * 时钟由 `getStateVector()` 计算。
   *
   * @param {number} client 查询的写入者 ID。
   * @return {number} 数组最后结构的排他末钟，包括 Skip；无该 client 时为 0。
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
   * @param {ID} id 已落在存储范围内的 ID；未知 client 对应空数组，不是返回未命中哨兵。
   * @return {{ structs: Array<GC|Item|Skip>, index: number }} 原结构数组与覆盖该 clock 的索引，供调用方切分或邻接访问。
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
 * 尾端值。向对端发送该向量后，对端据此补发缺口起点及其之后的结构。
 *
 * @param {StructStore} store 已集成结构和 Skip 索引保持一致的存储。
 * @return {Map<number,number>} 新建映射；每个值是缺口之前的连续已知排他末钟，删除不降低它。
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
