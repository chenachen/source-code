import type { NodeTransform } from '../transform'
import { findDir } from '../utils'
import {
  ElementTypes,
  type MemoExpression,
  NodeTypes,
  type PlainElementNode,
  convertToBlock,
  createCallExpression,
  createFunctionExpression,
} from '../ast'
import { WITH_MEMO } from '../runtimeHelpers'

/** 防止结构重遍历时对同一节点重复包裹 withMemo。 */
const seen = new WeakSet()

/**
 * 把 `v-memo="deps"` 子树包装成 `withMemo(deps, factory, _cache, index)`。
 * 依赖未变化时运行时直接返回上次 VNode；变化时调用工厂重建。原生元素子树必须提升为 block，
 * 这样缓存失效后只 patch 动态后代。SSR 不保留跨渲染缓存，故跳过。
 */
export const transformMemo: NodeTransform = (node, context) => {
  if (node.type === NodeTypes.ELEMENT) {
    const dir = findDir(node, 'memo')
    if (!dir || seen.has(node) || context.inSSR) {
      return
    }
    seen.add(node)
    return () => {
      const codegenNode =
        node.codegenNode ||
        (context.currentNode as PlainElementNode).codegenNode
      if (codegenNode && codegenNode.type === NodeTypes.VNODE_CALL) {
        // 组件本身已有更新边界；原生元素需要显式 block 才能维护动态 children 列表。
        if (node.tagType !== ElementTypes.COMPONENT) {
          convertToBlock(codegenNode, context)
        }
        node.codegenNode = createCallExpression(context.helper(WITH_MEMO), [
          dir.exp!,
          createFunctionExpression(undefined, codegenNode),
          `_cache`,
          String(context.cached.length),
        ]) as MemoExpression
        // 占用一个 `_cache` 槽；具体缓存写入由 withMemo 运行时完成，因此 AST 中放 null 占位。
        context.cached.push(null)
      }
    }
  }
}
