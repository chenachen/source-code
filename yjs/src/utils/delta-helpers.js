import * as delta from 'lib0/delta'
import { createInsertSetFromStructStore, createDeleteSetFromStructStore, diffIdSet, mergeIdSets } from './ids.js'
import { createDiffRenderer } from './Renderer.js'
import { computeModifiedFromItems } from '../ytype.js'

/**
 * 计算文档 `v1 → v2` 的顶层深层 Delta，只输出发生变化的 share 键。
 *
 * 先对两份 StructStore 的插入集、删除集做差；同一版本区间若既新插入又删除，消费方从未见过，故从
 * 插入渲染集中剔除。剩余 id 向上汇总受影响类型，再由 `v2` 的 Renderer 视图递归生成变化。
 *
 * @param {Doc} v1 - 消费方已有的基线文档。
 * @param {Doc} v2 - 目标文档状态。
 * @param {object} [options]
 * @param {AbstractRenderer} [options.renderer] - 默认使用两文档构造的 DiffRenderer。
 * @return {delta.DeltaBuilderAny} 从 `v1` 变换到 `v2` 的顶层属性 DeltaBuilder。
 */
export const diffDocsToDelta = (v1, v2, { renderer = createDiffRenderer(v1, v2) } = {}) => {
  const insertDiff = diffIdSet(createInsertSetFromStructStore(v2.store, false), createInsertSetFromStructStore(v1.store, false))
  const deleteDiff = diffIdSet(createDeleteSetFromStructStore(v2.store), createDeleteSetFromStructStore(v1.store))
  // 同一差异中插入又删除的 id 从未进入 `v1`，不应先插入再删除给消费方。
  const insertsOnly = diffIdSet(insertDiff, deleteDiff)
  const itemsToRender = mergeIdSets([insertsOnly, deleteDiff])
  /**
   * @type {Map<YType, Set<string|null>>}
   */
  const changedTypes = computeModifiedFromItems(v2.store, itemsToRender)
  const d = delta.create()
  v2.share.forEach((type, typename) => {
    const typeConf = changedTypes.get(type)
    if (typeConf) {
      const shareDelta = type.toDelta({
        renderer, itemsToRender, retainDeletes: true, modified: changedTypes, deep: true
      })
      d.modifyAttr(typename, shareDelta)
    }
  })
  return d
}
