import {
  DOMErrorCodes,
  type DirectiveTransform,
  createConditionalExpression,
  createDOMCompilerError,
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
} from '@vue/compiler-dom'

/**
 * 将 SSR `v-show` 转为条件 style：真值不追加样式，假值合并 `{ display: 'none' }`。
 * 服务端没有运行时指令挂载阶段，初始可见性必须直接体现在输出 HTML。
 */
export const ssrTransformShow: DirectiveTransform = (dir, node, context) => {
  if (!dir.exp) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_V_SHOW_NO_EXPRESSION),
    )
  }
  return {
    props: [
      createObjectProperty(
        `style`,
        createConditionalExpression(
          dir.exp!,
          createSimpleExpression(`null`, false),
          createObjectExpression([
            createObjectProperty(
              `display`,
              createSimpleExpression(`none`, true),
            ),
          ]),
          false /* 表达式不换行 */,
        ),
      ),
    ],
  }
}
