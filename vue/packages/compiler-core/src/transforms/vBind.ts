import type { DirectiveTransform } from '../transform'
import {
  type ExpressionNode,
  NodeTypes,
  createObjectProperty,
  createSimpleExpression,
} from '../ast'
import { ErrorCodes, createCompilerError } from '../errors'
import { camelize } from '@vue/shared'
import { CAMELIZE } from '../runtimeHelpers'

/**
 * 转换带参数的 `v-bind` 为单个 VNode prop。
 *
 * 无参数 `v-bind="obj"` 会影响整个 props 合并顺序，由 transformElement.ts 直接处理；
 * 此处只处理 `:foo="bar"`，并实现 `.camel`、`.prop`、`.attr` 修饰符。
 */
export const transformBind: DirectiveTransform = (dir, _node, context) => {
  const { modifiers, loc } = dir
  const arg = dir.arg!

  let { exp } = dir

  // 空表达式通常是语法错误；浏览器 in-DOM 模板有一项例外。
  if (exp && exp.type === NodeTypes.SIMPLE_EXPRESSION && !exp.content.trim()) {
    if (!__BROWSER__) {
      // #10280：浏览器把同名简写 `:foo` 的 DOM 属性值规范成空串 `:foo=""`。
      // 因而只有非浏览器构建能把真正空表达式直接报错；浏览器路径先交给 shorthand 转换识别。
      context.onError(
        createCompilerError(ErrorCodes.X_V_BIND_NO_EXPRESSION, loc),
      )
      return {
        props: [
          createObjectProperty(arg, createSimpleExpression('', true, loc)),
        ],
      }
    } else {
      exp = undefined
    }
  }

  // 动态参数可能得到 null/undefined；回退为空字符串，避免运行时把无效值当作属性 key。
  if (arg.type !== NodeTypes.SIMPLE_EXPRESSION) {
    arg.children.unshift(`(`)
    arg.children.push(`) || ""`)
  } else if (!arg.isStatic) {
    arg.content = arg.content ? `${arg.content} || ""` : `""`
  }

  // `.sync` 已在 parser 兼容路径改写为 v-model；这里只处理仍有效的三个 bind 修饰符。
  if (modifiers.some(mod => mod.content === 'camel')) {
    if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
      if (arg.isStatic) {
        arg.content = camelize(arg.content)
      } else {
        arg.content = `${context.helperString(CAMELIZE)}(${arg.content})`
      }
    } else {
      arg.children.unshift(`${context.helperString(CAMELIZE)}(`)
      arg.children.push(`)`)
    }
  }

  if (!context.inSSR) {
    if (modifiers.some(mod => mod.content === 'prop')) {
      injectPrefix(arg, '.')
    }
    if (modifiers.some(mod => mod.content === 'attr')) {
      injectPrefix(arg, '^')
    }
  }

  return {
    props: [createObjectProperty(arg, exp!)],
  }
}

/**
 * 给 prop key 编码 `.prop` / `.attr` 前缀。运行时 patchProp 读取 `.` 强制 DOM property，
 * 读取 `^` 强制 attribute；动态 key 用模板串或拼接在运行时构造。
 */
const injectPrefix = (arg: ExpressionNode, prefix: string) => {
  if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
    if (arg.isStatic) {
      arg.content = prefix + arg.content
    } else {
      arg.content = `\`${prefix}\${${arg.content}}\``
    }
  } else {
    arg.children.unshift(`'${prefix}' + (`)
    arg.children.push(`)`)
  }
}
