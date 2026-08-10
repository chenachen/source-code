import {
  type ComponentNode,
  NodeTypes,
  type TransformContext,
  findProp,
} from '@vue/compiler-dom'
import {
  type SSRTransformContext,
  processChildren,
} from '../ssrCodegenTransform'

/** 第一遍记录每个 Transition 是否启用 appear，供第二遍决定 SSR 包装。 */
const wipMap = new WeakMap<ComponentNode, Boolean>()

/** 第一遍读取静态/动态 appear 属性是否存在。 */
export function ssrTransformTransition(
  node: ComponentNode,
  context: TransformContext,
) {
  return (): void => {
    const appear = findProp(node, 'appear', false, true)
    wipMap.set(node, !!appear)
  }
}

/**
 * 第二遍输出 Transition children。
 * #5351：运行时 Transition 会过滤注释，SSR 也必须删除，否则 hydration 子节点索引错位。
 * appear 模式额外输出 `<template>`，让客户端首次水合时能对现有节点执行 appear 过渡。
 */
export function ssrProcessTransition(
  node: ComponentNode,
  context: SSRTransformContext,
): void {
  // 与运行时过滤规则保持一致，原位更新 children 后再输出。
  node.children = node.children.filter(c => c.type !== NodeTypes.COMMENT)

  const appear = wipMap.get(node)
  if (appear) {
    context.pushStringPart(`<template>`)
    processChildren(node, context, false, true)
    context.pushStringPart(`</template>`)
  } else {
    processChildren(node, context, false, true)
  }
}
