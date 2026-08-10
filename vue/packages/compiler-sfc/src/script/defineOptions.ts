import type { Node } from '@babel/types'
import { unwrapTSNode } from '@vue/compiler-dom'
import type { ScriptCompileContext } from './context'
import { isCallOf } from './utils'
import { DEFINE_PROPS } from './defineProps'
import { DEFINE_EMITS } from './defineEmits'
import { DEFINE_EXPOSE } from './defineExpose'
import { DEFINE_SLOTS } from './defineSlots'

/** `defineOptions` 编译宏名称。 */
export const DEFINE_OPTIONS = 'defineOptions'

/**
 * 处理 `defineOptions({...})`，保存要合并进组件默认导出的运行时选项。
 * props/emits/expose/slots 各有专用宏与类型推导流程，禁止在这里重复声明，避免两个来源
 * 的合并优先级和生成结果含糊。
 */
export function processDefineOptions(
  ctx: ScriptCompileContext,
  node: Node,
): boolean {
  if (!isCallOf(node, DEFINE_OPTIONS)) {
    return false
  }
  if (ctx.hasDefineOptionsCall) {
    ctx.error(`duplicate ${DEFINE_OPTIONS}() call`, node)
  }
  if (node.typeParameters) {
    ctx.error(`${DEFINE_OPTIONS}() cannot accept type arguments`, node)
  }
  if (!node.arguments[0]) return true

  ctx.hasDefineOptionsCall = true
  ctx.optionsRuntimeDecl = unwrapTSNode(node.arguments[0])

  let propsOption = undefined
  let emitsOption = undefined
  let exposeOption = undefined
  let slotsOption = undefined
  if (ctx.optionsRuntimeDecl.type === 'ObjectExpression') {
    for (const prop of ctx.optionsRuntimeDecl.properties) {
      if (
        (prop.type === 'ObjectProperty' || prop.type === 'ObjectMethod') &&
        prop.key.type === 'Identifier'
      ) {
        switch (prop.key.name) {
          case 'props':
            propsOption = prop
            break

          case 'emits':
            emitsOption = prop
            break

          case 'expose':
            exposeOption = prop
            break

          case 'slots':
            slotsOption = prop
            break
        }
      }
    }
  }

  if (propsOption) {
    ctx.error(
      `${DEFINE_OPTIONS}() cannot be used to declare props. Use ${DEFINE_PROPS}() instead.`,
      propsOption,
    )
  }
  if (emitsOption) {
    ctx.error(
      `${DEFINE_OPTIONS}() cannot be used to declare emits. Use ${DEFINE_EMITS}() instead.`,
      emitsOption,
    )
  }
  if (exposeOption) {
    ctx.error(
      `${DEFINE_OPTIONS}() cannot be used to declare expose. Use ${DEFINE_EXPOSE}() instead.`,
      exposeOption,
    )
  }
  if (slotsOption) {
    ctx.error(
      `${DEFINE_OPTIONS}() cannot be used to declare slots. Use ${DEFINE_SLOTS}() instead.`,
      slotsOption,
    )
  }

  return true
}
