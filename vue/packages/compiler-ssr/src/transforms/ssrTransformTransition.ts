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

/** 第一遍记录模板是否声明 appear 属性，供第二遍决定是否生成 template 包装。 */
const wipMap = new WeakMap<ComponentNode, Boolean>()

/** 第一遍只检查静态/动态 appear 属性是否存在，不求动态表达式的布尔值。 */
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
 * 模板声明 appear 或 :appear 时额外输出 `<template>`；客户端取出其内容后，根据运行时
 * appear 值决定是否执行出现过渡，再用内容节点替换外层 template。
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
