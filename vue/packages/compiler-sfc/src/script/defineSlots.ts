import type { LVal, Node } from '@babel/types'
import { isCallOf } from './utils'
import type { ScriptCompileContext } from './context'

/** `defineSlots` 编译宏名称。 */
export const DEFINE_SLOTS = 'defineSlots'

/**
 * 处理仅类型的 `defineSlots<T>()`。
 * 宏不能接收运行时参数；若结果被赋值使用，则把调用改写为 `useSlots()`，否则整条宏声明
 * 可在 compileScript 主流程中移除而不产生运行时代码。
 */
export function processDefineSlots(
  ctx: ScriptCompileContext,
  node: Node,
  declId?: LVal,
): boolean {
  if (!isCallOf(node, DEFINE_SLOTS)) {
    return false
  }
  if (ctx.hasDefineSlotsCall) {
    ctx.error(`duplicate ${DEFINE_SLOTS}() call`, node)
  }
  ctx.hasDefineSlotsCall = true

  if (node.arguments.length > 0) {
    ctx.error(`${DEFINE_SLOTS}() cannot accept arguments`, node)
  }

  if (declId) {
    ctx.s.overwrite(
      ctx.startOffset! + node.start!,
      ctx.startOffset! + node.end!,
      `${ctx.helper('useSlots')}()`,
    )
  }

  return true
}
