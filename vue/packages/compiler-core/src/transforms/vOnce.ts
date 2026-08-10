import type { NodeTransform } from '../transform'
import { findDir } from '../utils'
import { type ElementNode, type ForNode, type IfNode, NodeTypes } from '../ast'
import { SET_BLOCK_TRACKING } from '../runtimeHelpers'

/** 已处理节点集合；结构转换可能再次遍历原元素，需防止重复缓存。 */
const seen = new WeakSet()

/**
 * 把 `v-once` 子树的最终 codegenNode 放入组件实例渲染缓存。
 *
 * 进入时设置 `inVOnce`，让内部转换避免生成不安全缓存；退出时 children 和结构节点都已完成，
 * 再缓存整个 VNode。缓存期间暂停 block tracking，防止首次创建的动态后代被外层 block 收集，
 * 否则后续渲染外层仍会尝试 patch 本应永久复用的子树。SSR 每次请求直接输出字符串，不复用缓存。
 */
export const transformOnce: NodeTransform = (node, context) => {
  if (node.type === NodeTypes.ELEMENT && findDir(node, 'once', true)) {
    if (seen.has(node) || context.inVOnce || context.inSSR) {
      return
    }
    seen.add(node)
    context.inVOnce = true
    context.helper(SET_BLOCK_TRACKING)
    return () => {
      context.inVOnce = false
      const cur = context.currentNode as ElementNode | IfNode | ForNode
      if (cur.codegenNode) {
        cur.codegenNode = context.cache(
          cur.codegenNode,
          true /* 缓存值是 VNode，需要暂停 block tracking */,
          true /* 标记来自 v-once */,
        )
      }
    }
  }
}
