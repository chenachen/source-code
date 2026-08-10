import type { Node } from '@babel/types'
import { isCallOf } from './utils'
import type { ScriptCompileContext } from './context'

/** `defineExpose` 编译宏名称。 */
export const DEFINE_EXPOSE = 'defineExpose'

/** 识别并记录 defineExpose 调用；重复调用会使公开接口来源不明确，直接报错。 */
export function processDefineExpose(
  ctx: ScriptCompileContext,
  node: Node,
): boolean {
  if (isCallOf(node, DEFINE_EXPOSE)) {
    if (ctx.hasDefineExposeCall) {
      ctx.error(`duplicate ${DEFINE_EXPOSE}() call`, node)
    }
    ctx.hasDefineExposeCall = true
    return true
  }
  return false
}
