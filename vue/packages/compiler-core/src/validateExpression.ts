import type { SimpleExpressionNode } from './ast'
import type { TransformContext } from './transform'
import { ErrorCodes, createCompilerError } from './errors'

// JS 引擎已判定语法错误后，用这些关键字补充属性名相关诊断。
// 正则不决定表达式是否合法；new、delete、void 等仍可出现在合法表达式中。
const prohibitedKeywordRE = new RegExp(
  '\\b' +
    (
      'arguments,await,break,case,catch,class,const,continue,debugger,default,' +
      'delete,do,else,export,extends,finally,for,function,if,import,let,new,' +
      'return,super,switch,throw,try,var,void,while,with,yield'
    )
      .split(',')
      .join('\\b|\\b') +
    '\\b',
)

// 校验关键字前先剔除字符串/模板字符串，避免把字符串内容（如 "return"）误判为语法。
const stripStringRE =
  /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*\$\{|\}(?:[^`\\]|\\.)*`|`(?:[^`\\]|\\.)*`/g

/**
 * 校验未经标识符前缀化处理的浏览器端模板表达式。
 *
 * 仅运行时浏览器编译器使用此路径：它不借助 Babel 重写表达式，只能通过
 * `new Function` 让 JS 引擎做语法校验。`asParams` 用于 `v-slot` / `v-for`
 * 参数模式，`asRawStatements` 用于事件处理器中的多条语句。
 *
 * @param node 待校验的简单表达式节点
 * @param context 当前转换上下文，用于上报带源码位置的错误
 * @param asParams 是否把表达式当作函数参数列表
 * @param asRawStatements 是否把表达式当作原始语句体
 */
export function validateBrowserExpression(
  node: SimpleExpressionNode,
  context: TransformContext,
  asParams = false,
  asRawStatements = false,
): void {
  const exp = node.content

  // 各指令对空表达式的规则不同（例如部分事件写法允许为空），由指令转换自行校验。
  if (!exp.trim()) {
    return
  }

  try {
    new Function(
      asRawStatements
        ? ` ${exp} `
        : `return ${asParams ? `(${exp}) => {}` : `(${exp})`}`,
    )
  } catch (e: any) {
    let message = e.message
    const keywordMatch = exp
      .replace(stripStringRE, '')
      .match(prohibitedKeywordRE)
    if (keywordMatch) {
      // 原生 SyntaxError 往往只说 “Unexpected token”；命中特定关键字时给出更易懂原因。
      message = `avoid using JavaScript keyword as property name: "${keywordMatch[0]}"`
    }
    context.onError(
      createCompilerError(
        ErrorCodes.X_INVALID_EXPRESSION,
        node.loc,
        undefined,
        message,
      ),
    )
  }
}
