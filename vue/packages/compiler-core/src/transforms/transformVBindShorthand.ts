import { camelize } from '@vue/shared'
import {
  NodeTypes,
  type SimpleExpressionNode,
  createSimpleExpression,
} from '../ast'
import type { NodeTransform } from '../transform'
import { ErrorCodes, createCompilerError } from '../errors'
import { validFirstIdentCharRE } from '../utils'

/**
 * 展开 Vue 3.4 的 `v-bind` 同名简写：`:foo` → `:foo="foo"`。
 *
 * 动态参数没有可推导的变量名，因此报错。浏览器 in-DOM 模板会把无值属性变成空串，
 * #13930 中旧逻辑把它留给 transformBind 后访问 undefined AST 并崩溃；这里把空串也视为简写。
 */
export const transformVBindShorthand: NodeTransform = (node, context) => {
  if (node.type === NodeTypes.ELEMENT) {
    for (const prop of node.props) {
      // 同名简写把静态参数 camelize 后作为读取表达式，例如 `:foo-bar` → `fooBar`。
      if (
        prop.type === NodeTypes.DIRECTIVE &&
        prop.name === 'bind' &&
        (!prop.exp ||
          // #13930：in-DOM 中 `:foo` 经 DOM parser 后表现为 `:foo=""`。
          (__BROWSER__ &&
            prop.exp.type === NodeTypes.SIMPLE_EXPRESSION &&
            !prop.exp.content.trim())) &&
        prop.arg
      ) {
        const arg = prop.arg
        if (arg.type !== NodeTypes.SIMPLE_EXPRESSION || !arg.isStatic) {
          // `[key]` 无法同时表示绑定 key 和变量名，只允许静态简单参数。
          context.onError(
            createCompilerError(
              ErrorCodes.X_V_BIND_INVALID_SAME_NAME_ARGUMENT,
              arg.loc,
            ),
          )
          prop.exp = createSimpleExpression('', true, arg.loc)
        } else {
          const propName = camelize((arg as SimpleExpressionNode).content)
          if (
            validFirstIdentCharRE.test(propName[0]) ||
            // language-tools #3424 的类型生成会产生前导连字符形式，保留它供工具链后续处理。
            propName[0] === '-'
          ) {
            prop.exp = createSimpleExpression(propName, false, arg.loc)
          }
        }
      }
    }
  }
}
