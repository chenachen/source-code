import {
  ElementTypes,
  type NodeTransform,
  NodeTypes,
  type RootNode,
  type TemplateChildNode,
  createSimpleExpression,
  findDir,
  locStub,
} from '@vue/compiler-dom'

/**
 * 把一次 render 求得的 `_cssVars` 作为无参数 v-bind 注入每个可能的组件根。
 * 只处理根级元素/组件及其 v-if/Suspense 分支；v-for 单项由循环上下文处理，避免重复注入。
 */
export const ssrInjectCssVars: NodeTransform = (node, context) => {
  if (!context.ssrCssVars) {
    return
  }

  // `_cssVars` 由 ssrCodegenTransform 在 render 开头初始化；登记为局部标识符，避免
  // transformExpression 将其错误前缀为 `_ctx._cssVars`。
  if (node.type === NodeTypes.ROOT) {
    context.identifiers._cssVars = 1
  }

  const parent = context.parent
  if (!parent || parent.type !== NodeTypes.ROOT) {
    return
  }

  if (node.type === NodeTypes.IF_BRANCH) {
    for (const child of node.children) {
      injectCssVars(child)
    }
  } else {
    injectCssVars(node)
  }
}

/** 向单个有效根注入 `v-bind="_cssVars"`，Suspense 则递归进入各插槽根。 */
function injectCssVars(node: RootNode | TemplateChildNode) {
  if (
    node.type === NodeTypes.ELEMENT &&
    (node.tagType === ElementTypes.ELEMENT ||
      node.tagType === ElementTypes.COMPONENT) &&
    !findDir(node, 'for')
  ) {
    if (node.tag === 'suspense' || node.tag === 'Suspense') {
      for (const child of node.children) {
        if (
          child.type === NodeTypes.ELEMENT &&
          child.tagType === ElementTypes.TEMPLATE
        ) {
          // Suspense 的 template 子节点代表具名/default/fallback 插槽，注入其实际内容根。
          child.children.forEach(injectCssVars)
        } else {
          injectCssVars(child)
        }
      }
    } else {
      node.props.push({
        type: NodeTypes.DIRECTIVE,
        name: 'bind',
        arg: undefined,
        exp: createSimpleExpression(`_cssVars`, false),
        modifiers: [],
        loc: locStub,
      })
    }
  }
}
