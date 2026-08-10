import * as map from 'lib0/map'
import * as set from 'lib0/set'

import { diffIdSet, intersectSets, mergeIdSets } from './ids.js'
import { createAbsolutePositionFromRelativePosition, createRelativePosition } from './RelativePosition.js'

/**
 * 描述一次事务对某个 YType 造成的直接或深层变化，并按需生成 renderer 感知的 Delta。
 *
 * @template {DeltaConf} DConf
 */
export class YEvent {
  /**
   * 根据变更键集合创建事件；`null` 键表示子列表变化，其余键进入 `keysChanged`。
   *
   * @param {YType<DConf>} target - 最初发生变化的类型。
   * @param {import('./Transaction.js').Transaction} transaction - 产生事件的事务。
   * @param {Set<any>?} subs - 变化的属性键集合。
   */
  constructor (target, transaction, subs) {
    /** 事件最初创建于此类型；冒泡期间保持不变。
     * @type {import('../ytype.js').YType<DConf>} */
    this.target = target
    /** 当前调用 observer 的冒泡目标；可与 `target` 不同。
     * @type {YType<any>} */
    this.currentTarget = target
    /** 触发事件的事务，提供 insert/delete 集合与 origin。
     * @type {import('./Transaction.js').Transaction} */
    this.transaction = transaction
    /** 浅层 Delta 的惰性缓存。
     * @type {Delta<import('../ytype.js').DeltaConfDeltaToYType<DConf>>|null} */
    this._delta = null
    /** 深层 Delta 的惰性缓存。
     * @type {Delta<DConf>|null} */
    this._deltaDeep = null
    /**
     * 子列表是否变化；对应 `subs` 中出现 `null`。
     * @type {Boolean}
     * @private
     */
    this.childListChanged = false
    /** 发生变化的属性键，不包含表示子列表的 `null`。
     * @type {Set<string>} */
    this.keysChanged = new Set()
    subs?.forEach((sub) => {
      if (sub === null) {
        this.childListChanged = true
      } else {
        this.keysChanged.add(sub)
      }
    })
  }

  /**
   * 判断结构是否在本事务 deleteSet 中。
   *
   * 与结构最终 `deleted` 状态不同，本方法对“同一事务内先插入再删除”的结构也返回 `true`。
   *
   * @param {AbstractStruct} struct
   * @return {boolean}
   */
  deletes (struct) {
    return this.transaction.deleteSet.hasId(struct.id)
  }

  /**
   * 判断结构是否在本事务 insertSet 中。
   *
   * 即使结构同一事务内随后被删除，本方法仍返回 `true`，用于描述事务动作而非最终可见性。
   *
   * @param {AbstractStruct} struct
   * @return {boolean}
   */
  adds (struct) {
    return this.transaction.insertSet.hasId(struct.id)
  }

  /**
   * 根据事务 ID 集合、深度选项与 renderer 生成本类型的变化 Delta 构建器。
   *
   * 默认只渲染插入与删除集合的对称差；若 renderer 把“先插入再删除”的交集项标记为 attributed，则也保留这些可见建议项。`deep` 模式把直接变更向父链扩展，供嵌套 `modify` 生成使用。
   *
   * @template {boolean} [Deep=false]
   * @param {object} [opts]
   * @param {AbstractRenderer?} [opts.renderer] - 内容及 attribution renderer；默认使用目标类型当前 renderer，`null` 表示原样渲染。
   * @param {Deep} [opts.deep] - 是否包含后代变化。
   * @return {Deep extends true ? Delta<DConf> : Delta<import('../ytype.js').DeltaConfDeltaToYType<DConf>>} 当前事件的 Delta 构建器。
   *
   * @public
   */
  getDelta ({ renderer = this.target._renderer, deep } = {}) {
    const insertSet = this.transaction.insertSet
    const deleteSet = this.transaction.deleteSet
    // 同事务插入又删除的内容通常不可见；renderer 仍可能把它显示为删除建议（如远端内容集成到建议删除父项后被自动删除）。
    // 因此渲染 `(I ∪ D) − ((I ∩ D) − renderer.attributed)`：对称差加上 renderer 归因过的交集部分。
    const both = intersectSets(insertSet, deleteSet)
    const itemsToRender = mergeIdSets(
      (both.isEmpty() || renderer === null)
        ? [diffIdSet(insertSet, deleteSet), diffIdSet(deleteSet, insertSet)]
        : [diffIdSet(insertSet, deleteSet), diffIdSet(deleteSet, insertSet), intersectSets(both, renderer.attributed)]
    )
    /**
     * @todo 深层变更扩展应在事务阶段只计算一次，而非每个事件重复计算。
     *
     * @type {Map<YType,Set<string|null>>|null}
     */
    let modified = this.transaction.changed
    if (deep) {
      // 复制 changed，随后把每个直接变更逐级登记到祖先；不得污染事务共享映射。
      const dchanged = new Map()
      modified.forEach((attrs, type) => {
        dchanged.set(type, new Set(attrs))
      })
      for (let m of modified.keys()) {
        while (m._item != null) {
          const item = m._item
          const ms = map.setIfUndefined(dchanged, item?.parent, set.create)
          if (item && !ms.has(item.parentSub)) {
            ms.add(item.parentSub)
            m = /** @type {any} */ (item.parent)
          } else {
            break
          }
        }
      }
      modified = dchanged
    }
    return /** @type {any} */ (this.target.toDelta({ renderer, itemsToRender, retainDeletes: true, insertedItems: insertSet, deep: !!deep, modified }))
  }

  /**
   * 惰性计算并缓存当前类型的浅层 Quill Delta 变化。
   *
   * @type {Delta<import('../ytype.js').DeltaConfDeltaToYType<DConf>>} 当前类型的 Delta。
   * @public
   */
  get delta () {
    return /** @type {any} */ (this._delta ?? (this._delta = this.getDelta().done()))
  }

  /**
   * 惰性计算并缓存包含后代 `modify` 链的深层 Delta。
   *
   * @type {Delta<DConf>} 当前类型的深层 Delta。
   * @public
   */
  get deltaDeep () {
    return /** @type {any} */ (this._deltaDeep ?? (this._deltaDeep = /** @type {any} */ (this.getDelta({ deep: true }))))
  }
}

/**
 * 计算从祖先类型到目标后代的属性键/可见索引路径。
 *
 * Map-like 父项使用 `parentSub`；序列父项先构造相对位置再按指定 renderer 解析，以使路径索引与调用方看到的内容一致。
 *
 * @example
 *   // `child` 可通过 `type.get(path[0]).get(path[1])..` 访问。
 *   const path = type.getPathTo(child)
 *   // 假设 `type instanceof YArray`
 *   console.log(path) // 结果可能为 [2, 'key1']
 *   child === type.get(path[0]).get(path[1])
 *
 * @param {YType} parent - 路径起点。
 * @param {YType} child - 目标后代。
 * @param {AbstractRenderer?} renderer - 决定删除/归因内容是否计入序列索引。
 * @return {Array<string|number>} 从父到子的访问路径。
 *
 * @private
 * @function
 */
export const getPathTo = (parent, child, renderer = null) => {
  const path = []
  const doc = /** @type {Doc} */ (parent.doc)
  while (child._item !== null && child !== parent) {
    if (child._item.parentSub !== null) {
      // Map-like 父类型以属性键定位子项。
      path.unshift(child._item.parentSub)
    } else {
      const parent = /** @type {import('../ytype.js').YType} */ (child._item.parent)
      // 序列父类型的数值索引必须按 renderer 可见性计算。
      const apos = /** @type {import('../utils/RelativePosition.js').AbsolutePosition} */ (createAbsolutePositionFromRelativePosition(createRelativePosition(parent, child._item.id), doc, false, renderer))
      path.unshift(apos.index)
    }
    child = /** @type {YType} */ (child._item.parent)
  }
  return path
}
