import {
  type ComponentNode,
  ElementTypes,
  type IfBranchNode,
  type NodeTransform,
  NodeTypes,
  isCommentOrWhitespace,
} from '@vue/compiler-core'
import { TRANSITION } from '../runtimeHelpers'
import { DOMErrorCodes, createDOMCompilerError } from '../errors'

/**
 * 校验内置 `<Transition>` 的子节点，并识别与 `v-show` 配合的持久化模式。
 *
 * Transition 只能管理一个最终元素/组件；若子节点使用 v-show，节点不会被卸载，需注入
 * `persisted` 告诉运行时只执行显示/隐藏过渡，不走插入/移除流程。
 */
export const transformTransition: NodeTransform = (node, context) => {
  if (
    node.type === NodeTypes.ELEMENT &&
    node.tagType === ElementTypes.COMPONENT
  ) {
    const component = context.isBuiltInComponent(node.tag)
    if (component === TRANSITION) {
      return () => {
        if (!node.children.length) {
          return
        }

        // 多个有效根或可能产生多个根的 v-for/v-if 分支都无法由单个 Transition 管理。
        if (hasMultipleChildren(node)) {
          context.onError(
            createDOMCompilerError(
              DOMErrorCodes.X_TRANSITION_INVALID_CHILDREN,
              {
                start: node.children[0].loc.start,
                end: node.children[node.children.length - 1].loc.end,
                source: '',
              },
            ),
          )
        }

        // v-show 始终保留 DOM，只切换 display；给 Transition 注入布尔属性 persisted，
        // 使运行时走“持久化节点”钩子。
        const child = node.children[0]
        if (child.type === NodeTypes.ELEMENT) {
          for (const p of child.props) {
            if (p.type === NodeTypes.DIRECTIVE && p.name === 'show') {
              node.props.push({
                type: NodeTypes.ATTRIBUTE,
                name: 'persisted',
                nameLoc: node.loc,
                value: undefined,
                loc: node.loc,
              })
            }
          }
        }
      }
    }
  }
}

/**
 * 判断 Transition 或任一 v-if 分支是否可能产生多个有效子节点。
 * #1352 / #4637：编译器生成的注释占位和格式化空白不算真实过渡目标，先过滤后再计数。
 */
function hasMultipleChildren(node: ComponentNode | IfBranchNode): boolean {
  const children = (node.children = node.children.filter(
    c => !isCommentOrWhitespace(c),
  ))
  const child = children[0]
  return (
    children.length !== 1 ||
    child.type === NodeTypes.FOR ||
    (child.type === NodeTypes.IF && child.branches.some(hasMultipleChildren))
  )
}
