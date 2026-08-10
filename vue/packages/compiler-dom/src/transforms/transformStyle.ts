import {
  ConstantTypes,
  type NodeTransform,
  NodeTypes,
  type SimpleExpressionNode,
  type SourceLocation,
  createSimpleExpression,
} from '@vue/compiler-core'
import { parseStringStyle } from '@vue/shared'

/**
 * 把静态内联 CSS 属性解析成可序列化的对象表达式。
 *
 * 例如 `style="color: red"` 会先改写为等价的 `:style='{ "color": "red" }'`，再由
 * `transformElement` 与动态 style 统一归并、规范化并生成 props。使用 NodeTransform
 * 是因为它直接改写静态 AttributeNode，而非只处理原始指令。
 */
export const transformStyle: NodeTransform = node => {
  if (node.type === NodeTypes.ELEMENT) {
    node.props.forEach((p, i) => {
      if (p.type === NodeTypes.ATTRIBUTE && p.name === 'style' && p.value) {
        // 原位替换以保留 props 顺序与源码位置，后续流程会把它当普通 v-bind 处理。
        node.props[i] = {
          type: NodeTypes.DIRECTIVE,
          name: `bind`,
          arg: createSimpleExpression(`style`, true, p.loc),
          exp: parseInlineCSS(p.value.content, p.loc),
          modifiers: [],
          loc: p.loc,
        }
      }
    })
  }
}

/** 解析 CSS 声明串，并标记为可安全 stringify 的编译期常量。 */
const parseInlineCSS = (
  cssText: string,
  loc: SourceLocation,
): SimpleExpressionNode => {
  const normalized = parseStringStyle(cssText)
  return createSimpleExpression(
    JSON.stringify(normalized),
    false,
    loc,
    ConstantTypes.CAN_STRINGIFY,
  )
}
