import type { AwaitExpression } from '@babel/types'
import type { ScriptCompileContext } from './context'

/**
 * 改写顶层 await，使 await 前后的当前组件实例上下文保持一致：
 *
 * ```js
 * const instance = getCurrentInstance()
 * await foo()
 * expect(getCurrentInstance()).toBe(instance)
 * ```
 *
 * JS 在 await 后继续执行时不会天然保留 Vue 的 currentInstance。`withAsyncContext` 返回
 * 待等待的值与 restore 函数，挂起前暂时卸下上下文，恢复执行后立即还原。
 *
 * ```js
 * // 输入
 * await foo()
 * // 输出
 * ;(
 *   ([__temp,__restore] = withAsyncContext(() => foo())),
 *   await __temp,
 *   __restore()
 * )
 *
 * // 输入
 * const a = await foo()
 * // 输出
 * const a = (
 *   ([__temp, __restore] = withAsyncContext(() => foo())),
 *   __temp = await __temp,
 *   __restore(),
 *   __temp
 * )
 * ```
 *
 * @param node - setup 顶层执行路径中的 await；函数内部 await 由调用者跳过。
 * @param needSemi - 是否在包装前补分号，防止 ASI 粘连；单行 if/while 的 body 不可随意补分号。
 * @param isStatement - 独立语句无需保存结果；作为子表达式时以逗号表达式返回等待后的 __temp。
 * @remarks 参数源码只用 await 单词正则决定回调是否加 async；原位置与括号信息由 Babel AST 提供。
 */
export function processAwait(
  ctx: ScriptCompileContext,
  node: AwaitExpression,
  needSemi: boolean,
  isStatement: boolean,
): void {
  const argumentStart =
    node.argument.extra && node.argument.extra.parenthesized
      ? (node.argument.extra.parenStart as number)
      : node.argument.start!

  const startOffset = ctx.startOffset!
  const argumentStr = ctx.descriptor.source.slice(
    argumentStart + startOffset,
    node.argument.end! + startOffset,
  )

  const containsNestedAwait = /\bawait\b/.test(argumentStr)

  ctx.s.overwrite(
    node.start! + startOffset,
    argumentStart + startOffset,
    `${needSemi ? `;` : ``}(\n  ([__temp,__restore] = ${ctx.helper(
      `withAsyncContext`,
    )}(${containsNestedAwait ? `async ` : ``}() => `,
  )
  ctx.s.appendLeft(
    node.end! + startOffset,
    `)),\n  ${isStatement ? `` : `__temp = `}await __temp,\n  __restore()${
      isStatement ? `` : `,\n  __temp`
    }\n)`,
  )
}
