import { RESOLVE_FILTER } from '../runtimeHelpers'
import {
  type AttributeNode,
  type DirectiveNode,
  type ExpressionNode,
  NodeTypes,
  type SimpleExpressionNode,
} from '../ast'
import {
  CompilerDeprecationTypes,
  isCompatEnabled,
  warnDeprecation,
} from './compatConfig'
import type { NodeTransform, TransformContext } from '../transform'
import { toValidAssetId } from '../utils'

/** `/` 前出现这些字符时更可能是除法；否则按正则字面量起始处理。 */
const validDivisionCharRE = /[\w).+\-_$\]]/

/**
 * Vue 2 过滤器兼容转换入口。
 *
 * 将 `value | currency('¥')` 改写为 `_filter_currency(value, '¥')`，并登记运行时过滤器解析。
 * 它排在 transformExpression 之前，所以只需处理尚未前缀化的简单/复合表达式。
 */
export const transformFilter: NodeTransform = (node, context) => {
  if (!isCompatEnabled(CompilerDeprecationTypes.COMPILER_FILTERS, context)) {
    return
  }

  if (node.type === NodeTypes.INTERPOLATION) {
    // 此时表达式转换尚未运行，改写后的调用稍后会统一做标识符前缀化。
    rewriteFilter(node.content, context)
  } else if (node.type === NodeTypes.ELEMENT) {
    node.props.forEach((prop: AttributeNode | DirectiveNode) => {
      if (
        prop.type === NodeTypes.DIRECTIVE &&
        prop.name !== 'for' &&
        prop.exp
      ) {
        rewriteFilter(prop.exp, context)
      }
    })
  }
}

/** 递归查找复合表达式和嵌套插值中的简单表达式并改写过滤器。 */
function rewriteFilter(node: ExpressionNode, context: TransformContext) {
  if (node.type === NodeTypes.SIMPLE_EXPRESSION) {
    parseFilter(node, context)
  } else {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]
      if (typeof child !== 'object') continue
      if (child.type === NodeTypes.SIMPLE_EXPRESSION) {
        parseFilter(child, context)
      } else if (child.type === NodeTypes.COMPOUND_EXPRESSION) {
        rewriteFilter(child, context)
      } else if (child.type === NodeTypes.INTERPOLATION) {
        rewriteFilter(child.content, context)
      }
    }
  }
}

/**
 * 用小型词法状态机寻找最外层单个 `|`，排除 `||`、括号/数组/对象内部、字符串、模板串和正则。
 */
function parseFilter(node: SimpleExpressionNode, context: TransformContext) {
  const exp = node.content
  let inSingle = false
  let inDouble = false
  let inTemplateString = false
  let inRegex = false
  let curly = 0
  let square = 0
  let paren = 0
  let lastFilterIndex = 0
  let c,
    prev,
    i: number,
    expression,
    filters: string[] = []

  for (i = 0; i < exp.length; i++) {
    prev = c
    c = exp.charCodeAt(i)
    if (inSingle) {
      if (c === 0x27 && prev !== 0x5c) inSingle = false
    } else if (inDouble) {
      if (c === 0x22 && prev !== 0x5c) inDouble = false
    } else if (inTemplateString) {
      if (c === 0x60 && prev !== 0x5c) inTemplateString = false
    } else if (inRegex) {
      if (c === 0x2f && prev !== 0x5c) inRegex = false
    } else if (
      c === 0x7c && // `|`
      exp.charCodeAt(i + 1) !== 0x7c &&
      exp.charCodeAt(i - 1) !== 0x7c &&
      !curly &&
      !square &&
      !paren
    ) {
      if (expression === undefined) {
        // 第一个管道结束原始输入表达式；后续管道结束上一过滤器片段。
        lastFilterIndex = i + 1
        expression = exp.slice(0, i).trim()
      } else {
        pushFilter()
      }
    } else {
      switch (c) {
        case 0x22:
          inDouble = true
          break
        case 0x27:
          inSingle = true
          break
        case 0x60:
          inTemplateString = true
          break
        case 0x28:
          paren++
          break
        case 0x29:
          paren--
          break
        case 0x5b:
          square++
          break
        case 0x5d:
          square--
          break
        case 0x7b:
          curly++
          break
        case 0x7d:
          curly--
          break
      }
      if (c === 0x2f) {
        // `/` 既可能是除法也可能开始正则；查看前一个非空白字符做近似判断。
        let j = i - 1
        let p
        // 向前寻找第一个非空格字符。
        for (; j >= 0; j--) {
          p = exp.charAt(j)
          if (p !== ' ') break
        }
        if (!p || !validDivisionCharRE.test(p)) {
          inRegex = true
        }
      }
    }
  }

  if (expression === undefined) {
    expression = exp.slice(0, i).trim()
  } else if (lastFilterIndex !== 0) {
    pushFilter()
  }

  /** 把上一个管道符之后的片段登记为过滤器，并移动下一段起点。 */
  function pushFilter() {
    filters.push(exp.slice(lastFilterIndex, i).trim())
    lastFilterIndex = i + 1
  }

  if (filters.length) {
    __DEV__ &&
      warnDeprecation(
        CompilerDeprecationTypes.COMPILER_FILTERS,
        context,
        node.loc,
      )
    for (i = 0; i < filters.length; i++) {
      expression = wrapFilter(expression, filters[i], context)
    }
    node.content = expression
    // 源码已替换，旧 Babel AST 与 content 不再一致，必须让后续阶段重新解析。
    node.ast = undefined
  }
}

/**
 * 把单个过滤器包装为运行时调用：无参数 `f` → `f(exp)`；有参数 `f(a)` → `f(exp, a)`。
 */
function wrapFilter(
  exp: string,
  filter: string,
  context: TransformContext,
): string {
  context.helper(RESOLVE_FILTER)
  const i = filter.indexOf('(')
  if (i < 0) {
    context.filters!.add(filter)
    return `${toValidAssetId(filter, 'filter')}(${exp})`
  } else {
    const name = filter.slice(0, i)
    const args = filter.slice(i + 1)
    context.filters!.add(name)
    return `${toValidAssetId(name, 'filter')}(${exp}${
      args !== ')' ? ',' + args : args
    }`
  }
}
