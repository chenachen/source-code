import { ElementTypes, type NodeTransform, NodeTypes } from '@vue/compiler-core'
import { DOMErrorCodes, createDOMCompilerError } from '../errors'

/**
 * 从客户端组件模板中移除原生 `<script>` 与 `<style>`。
 *
 * 通过 innerHTML/模板挂载执行这类标签既不可靠又有副作用；样式和脚本应由 SFC、构建器
 * 或显式 DOM API 管理。开发模式同时报告诊断，生产模式静默移除。
 */
export const ignoreSideEffectTags: NodeTransform = (node, context) => {
  if (
    node.type === NodeTypes.ELEMENT &&
    node.tagType === ElementTypes.ELEMENT &&
    (node.tag === 'script' || node.tag === 'style')
  ) {
    __DEV__ &&
      context.onError(
        createDOMCompilerError(
          DOMErrorCodes.X_IGNORED_SIDE_EFFECT_TAG,
          node.loc,
        ),
      )
    context.removeNode()
  }
}
