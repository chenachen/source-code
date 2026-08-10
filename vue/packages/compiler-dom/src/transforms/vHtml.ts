import {
  type DirectiveTransform,
  createObjectProperty,
  createSimpleExpression,
} from '@vue/compiler-core'
import { DOMErrorCodes, createDOMCompilerError } from '../errors'

/**
 * 将 `v-html="exp"` 转换为 `innerHTML: exp` 属性。
 *
 * innerHTML 会完全覆盖元素原有 children，所以同时书写模板子节点时先报告错误再清空 AST；
 * 这也避免编译器生成永远不会显示、却仍可能执行表达式的无效子树。
 */
export const transformVHtml: DirectiveTransform = (dir, node, context) => {
  const { exp, loc } = dir
  if (!exp) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_V_HTML_NO_EXPRESSION, loc),
    )
  }
  if (node.children.length) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_V_HTML_WITH_CHILDREN, loc),
    )
    node.children.length = 0
  }
  return {
    props: [
      createObjectProperty(
        createSimpleExpression(`innerHTML`, true, loc),
        exp || createSimpleExpression('', true),
      ),
    ],
  }
}
