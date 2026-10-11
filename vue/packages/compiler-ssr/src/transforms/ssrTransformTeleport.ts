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
 * disabled 为 false 时，内容写入目标专用缓冲；为 true 时写入当前位置，目标只保留锚点。
 * 原位置由 helper 输出 hydration 锚点。缺少 to 属性或目标表达式时报告 SSR 编译错误。
 * 即使 onError 只收集，缺少 target 仍立即返回、不生成 Teleport 调用。contentRenderFn
 * 接收自己的 _push，运行时据 disabled 选择父 buffer 或目标 buffer；编译器不操作目标 DOM。
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

  const disabledProp = findProp(node, 'disabled', false, true /* 允许空值 */)
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
