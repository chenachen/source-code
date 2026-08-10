import {
  type DirectiveTransform,
  TO_DISPLAY_STRING,
  createCallExpression,
  createObjectProperty,
  createSimpleExpression,
  getConstantType,
} from '@vue/compiler-core'
import { DOMErrorCodes, createDOMCompilerError } from '../errors'

/**
 * 将 `v-text="exp"` 转换为 `textContent` 属性。
 *
 * textContent 会覆盖原 children，因此混用时报告错误并清空子树。非常量值通过
 * `toDisplayString` 统一处理 null、对象等展示语义；可证明的常量则直接输出以减少代码。
 */
export const transformVText: DirectiveTransform = (dir, node, context) => {
  const { exp, loc } = dir
  if (!exp) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_V_TEXT_NO_EXPRESSION, loc),
    )
  }
  if (node.children.length) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_V_TEXT_WITH_CHILDREN, loc),
    )
    node.children.length = 0
  }
  return {
    props: [
      createObjectProperty(
        createSimpleExpression(`textContent`, true),
        exp
          ? getConstantType(exp, context) > 0
            ? exp
            : createCallExpression(
                context.helperString(TO_DISPLAY_STRING),
                [exp],
                loc,
              )
          : createSimpleExpression('', true),
      ),
    ],
  }
}
