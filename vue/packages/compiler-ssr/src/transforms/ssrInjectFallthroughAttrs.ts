import {
  ElementTypes,
  type NodeTransform,
  NodeTypes,
  type ParentNode,
  type RootNode,
  type TemplateChildNode,
  createSimpleExpression,
  findDir,
  isCommentOrWhitespace,
  locStub,
} from '@vue/compiler-dom'

/** 过滤不构成组件真实根的注释和纯空白。 */
const filterChild = (node: ParentNode) =>
  node.children.filter(n => !isCommentOrWhitespace(n))

/** 判断容器是否恰有一个有效子节点。 */
const hasSingleChild = (node: ParentNode): boolean =>
  filterChild(node).length === 1

/**
 * 将组件未声明 attrs 以 `v-bind="_attrs"` 注入唯一 SSR 根节点。
 *
 * 处理普通单根、每个 v-if 分支，以及只包裹一个子节点的 Transition/KeepAlive；多根时
 * attrs 没有明确归属，保持 Vue 的 fragment fallthrough 行为，不擅自注入。
 */
export const ssrInjectFallthroughAttrs: NodeTransform = (node, context) => {
  // `_attrs` 是 SSR render 参数；登记为局部标识符，避免表达式转换补成 `_ctx._attrs`。
  if (node.type === NodeTypes.ROOT) {
    context.identifiers._attrs = 1
  }

  if (
    node.type === NodeTypes.ELEMENT &&
    node.tagType === ElementTypes.COMPONENT &&
    (node.tag === 'transition' ||
      node.tag === 'Transition' ||
      node.tag === 'KeepAlive' ||
      node.tag === 'keep-alive')
  ) {
    const rootChildren = filterChild(context.root)
    if (rootChildren.length === 1 && rootChildren[0] === node) {
      if (hasSingleChild(node)) {
        injectFallthroughAttrs(node.children[0])
      }
      return
    }
  }

  const parent = context.parent
  if (!parent || parent.type !== NodeTypes.ROOT) {
    return
  }

  if (node.type === NodeTypes.IF_BRANCH && hasSingleChild(node)) {
    // 只有整条 v-if/else 链是唯一根时，才能向每个单根分支注入 attrs。
    let hasEncounteredIf = false
    for (const c of filterChild(parent)) {
      if (
        c.type === NodeTypes.IF ||
        (c.type === NodeTypes.ELEMENT && findDir(c, 'if'))
      ) {
        // 出现第二组独立根级 v-if，整体已是多根。
        if (hasEncounteredIf) return
        hasEncounteredIf = true
      } else if (
        // v-if 前已有其他有效根；或
        !hasEncounteredIf ||
        // v-if 后节点不是同一条 else(-if) 分支。
        !(c.type === NodeTypes.ELEMENT && findDir(c, /else/, true))
      ) {
        return
      }
    }
    injectFallthroughAttrs(node.children[0])
  } else if (hasSingleChild(parent)) {
    injectFallthroughAttrs(node)
  }
}

/** 向非 v-for 的原生元素/组件根追加无参数 `v-bind="_attrs"`。 */
function injectFallthroughAttrs(node: RootNode | TemplateChildNode) {
  if (
    node.type === NodeTypes.ELEMENT &&
    (node.tagType === ElementTypes.ELEMENT ||
      node.tagType === ElementTypes.COMPONENT) &&
    !findDir(node, 'for')
  ) {
    node.props.push({
      type: NodeTypes.DIRECTIVE,
      name: 'bind',
      arg: undefined,
      exp: createSimpleExpression(`_attrs`, false),
      modifiers: [],
      loc: locStub,
    })
  }
}
