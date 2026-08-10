import {
  ElementTypes,
  type NodeTransform,
  NodeTypes,
  type SlotOutletNode,
  TRANSITION,
  TRANSITION_GROUP,
  createCallExpression,
  createFunctionExpression,
  isSlotOutlet,
  processSlotOutlet,
  resolveComponentType,
} from '@vue/compiler-dom'
import { SSR_RENDER_SLOT, SSR_RENDER_SLOT_INNER } from '../runtimeHelpers'
import {
  type SSRTransformContext,
  processChildrenAsStatement,
} from '../ssrCodegenTransform'

/**
 * 第一遍为 `<slot>` 构造 ssrRenderSlot 调用的固定参数。
 * fallback 函数要等第二遍才能生成；使用 scoped `:slotted()` 时还会传入 `scopeId-s`。
 */
export const ssrTransformSlotOutlet: NodeTransform = (node, context) => {
  if (isSlotOutlet(node)) {
    const { slotName, slotProps } = processSlotOutlet(node, context)

    const args = [
      `_ctx.$slots`,
      slotName,
      slotProps || `{}`,
      // fallback 占位，第二遍取得其 SSR statement body 后替换。
      `null`,
      `_push`,
      `_parent`,
    ]

    // :slotted CSS 通过插槽 scopeId 给消费方输出的根节点添加 `data-v-xxx-s`。
    if (context.scopeId && context.slotted !== false) {
      args.push(`"${context.scopeId}-s"`)
    }

    let method = SSR_RENDER_SLOT

    // #3989/#9933：Transition/TransitionGroup 只有一个 slot 子节点时，运行时会把 slot
    // Fragment 展平为 VNode；SSR 若仍输出 Fragment 注释，hydration 结构会不一致，因此改用
    // SSR_RENDER_SLOT_INNER 的禁用 Fragment 模式。
    let parent = context.parent!
    if (parent) {
      const children = parent.children
      // #10743：`<Transition><slot v-if /></Transition>` 的直接父级是 IfBranch，需看祖父组件。
      if (parent.type === NodeTypes.IF_BRANCH) {
        parent = context.grandParent!
      }
      let componentType
      if (
        parent.type === NodeTypes.ELEMENT &&
        parent.tagType === ElementTypes.COMPONENT &&
        ((componentType = resolveComponentType(parent, context, true)) ===
          TRANSITION ||
          componentType === TRANSITION_GROUP) &&
        children.filter(c => c.type === NodeTypes.ELEMENT).length === 1
      ) {
        method = SSR_RENDER_SLOT_INNER
        if (!(context.scopeId && context.slotted !== false)) {
          args.push('null')
        }
        args.push('true')
      }
    }

    node.ssrCodegenNode = createCallExpression(context.helper(method), args)
  }
}

/** 第二遍补上 fallback SSR 函数、合并转发 scopeId，并输出 slot helper 调用。 */
export function ssrProcessSlotOutlet(
  node: SlotOutletNode,
  context: SSRTransformContext,
): void {
  const renderCall = node.ssrCodegenNode!

  // 有 fallback children 时将第四个 null 占位替换为独立 SSR render 函数。
  if (node.children.length) {
    const fallbackRenderFn = createFunctionExpression([])
    fallbackRenderFn.body = processChildrenAsStatement(node, context)
    // 参数形态：renderSlot(slots, name, props, fallback, push, parent, scopeId, ...)。
    renderCall.arguments[3] = fallbackRenderFn
  }

  // 转发 slot 时同时携带当前外层 `_scopeId`，使多层 scoped/slotted 样式都能命中。
  if (context.withSlotScopeId) {
    const slotScopeId = renderCall.arguments[6]
    renderCall.arguments[6] = slotScopeId
      ? `${slotScopeId as string} + _scopeId`
      : `_scopeId`
  }

  context.pushStatement(node.ssrCodegenNode!)
}
