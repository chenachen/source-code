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
 * promise 与 restore 函数，挂起前暂时卸下上下文，恢复执行后立即还原。未来 Async Context
 * 广泛可用后可考虑移除此转换：https://github.com/tc39/proposal-async-context
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
