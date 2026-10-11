import type { NodeTransform } from '../transform'
import {
  type CallExpression,
  type CompoundExpressionNode,
  ConstantTypes,
  ElementTypes,
  NodeTypes,
  createCallExpression,
  createCompoundExpression,
} from '../ast'
import { isText } from '../utils'
import { CREATE_TEXT } from '../runtimeHelpers'
import { PatchFlagNames, PatchFlags } from '@vue/shared'
import { getConstantType } from './cacheStatic'

/**
 * 合并相邻文本/插值，并在需要时预生成 `createTextVNode` 调用。
 *
 * 例如 `<div>abc {{ d }} {{ e }}</div>` 合成一个复合表达式，避免运行时创建三段文本节点。
 * 单个原生元素文本 child 保持原样，让 renderer 走直接设置 `textContent` 的最快路径；
 * 多 child 或组件 child 则显式转成文本 VNode，省去运行时 normalizeChildren。
 * 根节点只有一段文本时也保留原节点，根 codegen 再决定包装；带未知指令的元素排除快速路径。
 * 本转换原地合并 children 数组并替换文本节点，动态 TEXT 标记仅用于客户端生成。
 */
export const transformText: NodeTransform = (node, context) => {
  if (
    node.type === NodeTypes.ROOT ||
    node.type === NodeTypes.ELEMENT ||
    node.type === NodeTypes.FOR ||
    node.type === NodeTypes.IF_BRANCH
  ) {
    // 退出阶段执行，确保插值表达式已完成 `_ctx` 前缀化和常量分析。
    return () => {
      const children = node.children
      let currentContainer: CompoundExpressionNode | undefined = undefined
      let hasText = false

      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (isText(child)) {
          hasText = true
          for (let j = i + 1; j < children.length; j++) {
            const next = children[j]
            if (isText(next)) {
              if (!currentContainer) {
                currentContainer = children[i] = createCompoundExpression(
                  [child],
                  child.loc,
                )
              }
              // `+` 片段直接写入复合表达式，代码生成器按顺序拼出 JS。
              currentContainer.children.push(` + `, next)
              children.splice(j, 1)
              j--
            } else {
              currentContainer = undefined
              break
            }
          }
        }
      }

      if (
        !hasText ||
        // 普通原生元素的单文本 child 可由运行时直接设置 textContent；组件 children 仍需归一化。
        (children.length === 1 &&
          (node.type === NodeTypes.ROOT ||
            (node.type === NodeTypes.ELEMENT &&
              node.tagType === ElementTypes.ELEMENT &&
              // 修复 #3756：未知自定义指令可能在 mounted 时向元素插入 DOM；若更新时走
              // textContent 快速路径，会清空这些用户节点。保留文本 VNode 才能只 patch 文本节点。
              !node.props.find(
                p =>
                  p.type === NodeTypes.DIRECTIVE &&
                  !context.directiveTransforms[p.name],
              ) &&
              // 兼容模式的普通 template 会渲染为 Fragment，其 children 必须显式成为 VNode。
              !(__COMPAT__ && node.tag === 'template'))))
      ) {
        return
      }

      // 编译期转成 createTextVNode，避免运行时再判断字符串/数组 children 类型。
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (isText(child) || child.type === NodeTypes.COMPOUND_EXPRESSION) {
          const callArgs: CallExpression['arguments'] = []
          // createTextVNode 默认内容就是单空格；该常见节点用空参数调用节省字节。
          if (child.type !== NodeTypes.TEXT || child.content !== ' ') {
            callArgs.push(child)
          }
          // 动态文本加 TEXT patchFlag，block 更新时只比较 text content。
          if (
            !context.ssr &&
            getConstantType(child, context) === ConstantTypes.NOT_CONSTANT
          ) {
            callArgs.push(
              PatchFlags.TEXT +
                (__DEV__ ? ` /* ${PatchFlagNames[PatchFlags.TEXT]} */` : ``),
            )
          }
          children[i] = {
            type: NodeTypes.TEXT_CALL,
            content: child,
            loc: child.loc,
            codegenNode: createCallExpression(
              context.helper(CREATE_TEXT),
              callArgs,
            ),
          }
        }
      }
    }
  }
}
