import {
  type ComponentNode,
  type ExpressionNode,
  NodeTypes,
  createCallExpression,
  createFunctionExpression,
  createSimpleExpression,
  findProp,
} from '@vue/compiler-dom'
import {
  type SSRTransformContext,
  processChildrenAsStatement,
} from '../ssrCodegenTransform'
import { SSRErrorCodes, createSSRCompilerError } from '../errors'
import { SSR_RENDER_TELEPORT } from '../runtimeHelpers'

/**
 * 第二遍把 Teleport 生成 `ssrRenderTeleport(push, content, target, disabled, parent)`。
 * 服务端将内容写入目标专用缓冲区；原位置由 helper 输出 hydration 锚点。缺少有效 to 时
 * 无法确定缓冲区，直接报告 SSR 编译错误。
 */
export function ssrProcessTeleport(
  node: ComponentNode,
  context: SSRTransformContext,
): void {
  const targetProp = findProp(node, 'to')
  if (!targetProp) {
    context.onError(
      createSSRCompilerError(SSRErrorCodes.X_SSR_NO_TELEPORT_TARGET, node.loc),
    )
    return
  }

  let target: ExpressionNode | undefined
  if (targetProp.type === NodeTypes.ATTRIBUTE) {
    target =
      targetProp.value && createSimpleExpression(targetProp.value.content, true)
  } else {
    target = targetProp.exp
  }
  if (!target) {
    context.onError(
      createSSRCompilerError(
        SSRErrorCodes.X_SSR_NO_TELEPORT_TARGET,
        targetProp.loc,
      ),
    )
    return
  }

  const disabledProp = findProp(node, 'disabled', false, true /* allow empty */)
  const disabled = disabledProp
    ? disabledProp.type === NodeTypes.ATTRIBUTE
      ? `true`
      : disabledProp.exp || `false`
    : `false`

  const contentRenderFn = createFunctionExpression(
    [`_push`],
    undefined, // 函数体在下方由 SSR children 结果补入
    true, // 强制换行，提升生成代码可读性
    false, // Teleport 内容函数不是普通 slot
    node.loc,
  )
  contentRenderFn.body = processChildrenAsStatement(node, context)
  context.pushStatement(
    createCallExpression(context.helper(SSR_RENDER_TELEPORT), [
      `_push`,
      contentRenderFn,
      target,
      disabled,
      `_parent`,
    ]),
  )
}
