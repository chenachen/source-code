import {
  type BlockStatement,
  type IfBranchNode,
  type IfNode,
  type NodeTransform,
  NodeTypes,
  createBlockStatement,
  createCallExpression,
  createIfStatement,
  createStructuralDirectiveTransform,
  processIf,
} from '@vue/compiler-dom'
import {
  type SSRTransformContext,
  processChildrenAsStatement,
} from '../ssrCodegenTransform'

/** 第一遍复用 core processIf，把相邻条件指令归并为 IfNode。 */
export const ssrTransformIf: NodeTransform = createStructuralDirectiveTransform(
  /^(?:if|else|else-if)$/,
  processIf,
)

/**
 * 第二遍把 IfNode 生成嵌套 JS if/else 语句。
 * 没有 else 时输出空注释锚点，使服务端 DOM 位置与客户端条件 block 的 hydration 预期一致。
 */
export function ssrProcessIf(
  node: IfNode,
  context: SSRTransformContext,
  disableNestedFragments = false,
  disableComment = false,
): void {
  const [rootBranch] = node.branches
  const ifStatement = createIfStatement(
    rootBranch.condition!,
    processIfBranch(rootBranch, context, disableNestedFragments),
  )
  context.pushStatement(ifStatement)

  let currentIf = ifStatement
  for (let i = 1; i < node.branches.length; i++) {
    const branch = node.branches[i]
    const branchBlockStatement = processIfBranch(
      branch,
      context,
      disableNestedFragments,
    )
    if (branch.condition) {
      // else-if 作为上一 IfStatement 的 alternate 中嵌套 IfStatement。
      currentIf = currentIf.alternate = createIfStatement(
        branch.condition,
        branchBlockStatement,
      )
    } else {
      // 最终 else 直接使用分支 BlockStatement。
      currentIf.alternate = branchBlockStatement
    }
  }

  if (!currentIf.alternate && !disableComment) {
    currentIf.alternate = createBlockStatement([
      createCallExpression(`_push`, ['`<!---->`']),
    ])
  }
}

/** 生成单分支语句体，并按多根情况决定是否添加 Fragment 边界。 */
function processIfBranch(
  branch: IfBranchNode,
  context: SSRTransformContext,
  disableNestedFragments = false,
): BlockStatement {
  const { children } = branch
  const needFragmentWrapper =
    !disableNestedFragments &&
    (children.length !== 1 || children[0].type !== NodeTypes.ELEMENT) &&
    // 唯一子节点为 ForNode 时，v-for 自己已有 Fragment 边界，避免重复嵌套。
    !(children.length === 1 && children[0].type === NodeTypes.FOR)
  return processChildrenAsStatement(branch, context, needFragmentWrapper)
}
