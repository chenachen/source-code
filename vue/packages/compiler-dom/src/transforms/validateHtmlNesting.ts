import {
  type CompilerError,
  ElementTypes,
  type NodeTransform,
  NodeTypes,
} from '@vue/compiler-core'
import { isValidHTMLNesting } from '../htmlNesting'

/**
 * 开发期按规则矩阵检查原生元素的直接父子标签。
 * 这里只传入 tag 字符串，不扫描任意祖先，也不按 namespace 排除 SVG。
 * 非法结构会被浏览器 parser 自动重排，使 SSR 字符串解析出的 DOM 与客户端 VNode 树
 * 不一致，因此这里以编译警告提前指出潜在 hydration 错误。
 */
export const validateHtmlNesting: NodeTransform = (node, context) => {
  if (
    node.type === NodeTypes.ELEMENT &&
    node.tagType === ElementTypes.ELEMENT &&
    context.parent &&
    context.parent.type === NodeTypes.ELEMENT &&
    context.parent.tagType === ElementTypes.ELEMENT &&
    !isValidHTMLNesting(context.parent.tag, node.tag)
  ) {
    const error = new SyntaxError(
      `<${node.tag}> cannot be child of <${context.parent.tag}>, ` +
        'according to HTML specifications. ' +
        'This can cause hydration errors or ' +
        'potentially disrupt future functionality.',
    ) as CompilerError
    error.loc = node.loc
    context.onWarn(error)
  }
}
