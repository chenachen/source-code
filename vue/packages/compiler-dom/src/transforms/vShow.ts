import type { DirectiveTransform } from '@vue/compiler-core'
import { DOMErrorCodes, createDOMCompilerError } from '../errors'
import { V_SHOW } from '../runtimeHelpers'

/**
 * 将 `v-show` 标记为需要 DOM 运行时指令。
 * 它不生成普通 props；运行时会保存元素原 display，并在值变化时切换 display。
 */
export const transformShow: DirectiveTransform = (dir, node, context) => {
  const { exp, loc } = dir
  if (!exp) {
    context.onError(
      createDOMCompilerError(DOMErrorCodes.X_V_SHOW_NO_EXPRESSION, loc),
    )
  }

  return {
    props: [],
    needRuntime: context.helper(V_SHOW),
  }
}
