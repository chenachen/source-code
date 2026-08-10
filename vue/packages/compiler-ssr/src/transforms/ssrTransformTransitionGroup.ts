import {
  type AttributeNode,
  type ComponentNode,
  type DirectiveNode,
  type JSChildNode,
  NodeTypes,
  type TransformContext,
  buildProps,
  createCallExpression,
  findProp,
} from '@vue/compiler-dom'
import { SSR_RENDER_ATTRS } from '../runtimeHelpers'
import {
  type SSRTransformContext,
  processChildren,
} from '../ssrCodegenTransform'
import { buildSSRProps } from './ssrTransformElement'

/** 跨两遍转换保存 TransitionGroup 的 tag、属性表达式与 scopeId。 */
const wipMap = new WeakMap<ComponentNode, WIPEntry>()

/** TransitionGroup 有显式 tag 时生成外层元素所需的中间状态。 */
interface WIPEntry {
  /** 用户声明的静态或动态外层标签属性。 */
  tag: AttributeNode | DirectiveNode
  /** 除 tag 外生成的 SSR 属性表达式。 */
  propsExp: string | JSChildNode | null
  /** 外层元素需要追加的 SFC scopeId 属性。 */
  scopeId: string | null
}

/** 第一遍提取 tag，并为其余 props/directives 生成 SSR attrs 表达式。 */
export function ssrTransformTransitionGroup(
  node: ComponentNode,
  context: TransformContext,
) {
  return (): void => {
    const tag = findProp(node, 'tag')
    if (tag) {
      const otherProps = node.props.filter(p => p !== tag)
      const { props, directives } = buildProps(
        node,
        context,
        otherProps,
        true /* isComponent */,
        false /* isDynamicComponent */,
        true /* ssr (skip event listeners) */,
      )
      let propsExp = null
      if (props || directives.length) {
        propsExp = createCallExpression(context.helper(SSR_RENDER_ATTRS), [
          buildSSRProps(props, directives, context),
        ])
      }
      wipMap.set(node, {
        tag,
        propsExp,
        scopeId: context.scopeId || null,
      })
    }
  }
}

/**
 * 第二遍按动态 tag、静态 tag 或无 tag Fragment 三种形式输出 TransitionGroup。
 * 所有形式都禁用子级重复 Fragment 与条件空注释，以匹配运行时对子节点的展平/过滤。
 */
export function ssrProcessTransitionGroup(
  node: ComponentNode,
  context: SSRTransformContext,
): void {
  const entry = wipMap.get(node)
  if (entry) {
    const { tag, propsExp, scopeId } = entry
    if (tag.type === NodeTypes.DIRECTIVE) {
      // 动态 :tag 分段输出开闭标签名，props/scopeId 插在开始标签内。
      context.pushStringPart(`<`)
      context.pushStringPart(tag.exp!)
      if (propsExp) {
        context.pushStringPart(propsExp)
      }
      if (scopeId) {
        context.pushStringPart(` ${scopeId}`)
      }
      context.pushStringPart(`>`)

      processChildren(
        node,
        context,
        false,
        /**
         * TransitionGroup 运行时会把全部 children 展平到同一 Fragment，以共享 key map
         * 进行 patch；SSR 必须禁用嵌套 Fragment 锚点，否则 hydration 看到额外边界。
         */
        true,
        /**
         * #6715：TransitionGroup 运行时过滤注释，hydration 不期待这些节点；因此禁用
         * 无 v-else 的假 v-if 通常输出的空注释占位。
         */
        true,
      )
      context.pushStringPart(`</`)
      context.pushStringPart(tag.exp!)
      context.pushStringPart(`>`)
    } else {
      // 静态 tag 可直接并入字符串缓冲。
      context.pushStringPart(`<${tag.value!.content}`)
      if (propsExp) {
        context.pushStringPart(propsExp)
      }
      if (scopeId) {
        context.pushStringPart(` ${scopeId}`)
      }
      context.pushStringPart(`>`)
      processChildren(node, context, false, true, true)
      context.pushStringPart(`</${tag.value!.content}>`)
    }
  } else {
    // 未提供 tag 时自身渲染为 Fragment，仍按 TransitionGroup 规则展平其子级。
    processChildren(node, context, true, true, true)
  }
}
