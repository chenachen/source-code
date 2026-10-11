import {
  type ForNode,
  type NodeTransform,
  NodeTypes,
  createCallExpression,
  createForLoopParams,
  createFunctionExpression,
  createStructuralDirectiveTransform,
  processFor,
} from '@vue/compiler-dom'
import {
  type SSRTransformContext,
  processChildrenAsStatement,
} from '../ssrCodegenTransform'
import { SSR_RENDER_LIST } from '../runtimeHelpers'

/** 第一遍只复用 core processFor 构造目标无关 ForNode。 */
export const ssrTransformFor: NodeTransform =
  createStructuralDirectiveTransform('for', processFor)

/**
 * 第二遍把 ForNode 生成 `ssrRenderList(source, iterator)` 输出语句。
 * 默认在整个列表及多根单项外输出 Fragment 注释锚点，保证 hydration 能识别范围。
 */
export function ssrProcessFor(
  node: ForNode,
  context: SSRTransformContext,
  disableNestedFragments = false,
): void {
  const needFragmentWrapper =
    !disableNestedFragments &&
    (node.children.length !== 1 || node.children[0].type !== NodeTypes.ELEMENT)
  const renderLoop = createFunctionExpression(
    createForLoopParams(node.parseResult),
  )
  renderLoop.body = processChildrenAsStatement(
    node,
    context,
    needFragmentWrapper,
  )
  // 整个列表默认是 Fragment。Transition/TransitionGroup 展平直接 children 时会禁用这里的
  // 边界；普通嵌套列表仍各自保留 Fragment，不能仅因祖先已有边界就省略。
  if (!disableNestedFragments) {
    context.pushStringPart(`<!--[-->`)
  }
  context.pushStatement(
    createCallExpression(context.helper(SSR_RENDER_LIST), [
      node.source,
      renderLoop,
    ]),
  )
  if (!disableNestedFragments) {
    context.pushStringPart(`<!--]-->`)
  }
}
