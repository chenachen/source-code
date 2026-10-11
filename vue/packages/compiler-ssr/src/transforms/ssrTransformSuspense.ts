import {
  type ComponentNode,
  type FunctionExpression,
  type SlotsExpression,
  type TemplateChildNode,
  type TransformContext,
  buildSlots,
  createCallExpression,
  createFunctionExpression,
} from '@vue/compiler-dom'
import {
  type SSRTransformContext,
  processChildrenAsStatement,
} from '../ssrCodegenTransform'
import { SSR_RENDER_SUSPENSE } from '../runtimeHelpers'

/** 跨两遍转换暂存 Suspense slots 表达式和待填充函数。 */
const wipMap = new WeakMap<ComponentNode, WIPEntry>()

/** 第一遍建立、第二遍补完 body 的 Suspense 中间状态。 */
interface WIPEntry {
  /** 第一遍由 buildSlots 建立的完整 slots 表达式。 */
  slotsExp: SlotsExpression
  /** 第二遍仍需填入 SSR 函数体的插槽。 */
  wipSlots: Array<{
    /** 已创建但 body 尚为空的插槽函数。 */
    fn: FunctionExpression
    /** 该插槽原始模板子节点。 */
    children: TemplateChildNode[]
  }>
}

/** 第一遍复用 buildSlots 收集 default/fallback 插槽，但暂不生成其函数体。 */
export function ssrTransformSuspense(
  node: ComponentNode,
  context: TransformContext,
) {
  return (): void => {
    if (node.children.length) {
      const wipEntry: WIPEntry = {
        slotsExp: null!, // 紧接着由 buildSlots 返回值设置
        wipSlots: [],
      }
      wipMap.set(node, wipEntry)
      wipEntry.slotsExp = buildSlots(
        node,
        context,
        (_props, _vForExp, children, loc) => {
          const fn = createFunctionExpression(
            [],
            undefined, // 第二遍再写函数 body，不在此生成 return
            true, // 生成多行函数
            false, // Suspense 分支不按普通作用域 slot 包装
            loc,
          )
          wipEntry.wipSlots.push({
            fn,
            children,
          })
          return fn
        },
      ).slots
    }
  }
}

/** 第二遍把各 Suspense slot children 编成 SSR 函数体并输出 server-renderer helper。 */
export function ssrProcessSuspense(
  node: ComponentNode,
  context: SSRTransformContext,
): void {
  // 此时第一遍的表达式/结构转换已完成，可安全生成每个 slot 的 SSR statements。
  const wipEntry = wipMap.get(node)
  if (!wipEntry) {
    return
  }
  const { slotsExp, wipSlots } = wipEntry
  for (let i = 0; i < wipSlots.length; i++) {
    const slot = wipSlots[i]
    slot.fn.body = processChildrenAsStatement(slot, context)
  }
  // helper 只执行 default，没有 default 时输出空注释；fallback 虽已编译，但不在服务端执行。
  // default 中的异步组件结果进入 SSR buffer，由最终展开阶段等待。
  context.pushStatement(
    createCallExpression(context.helper(SSR_RENDER_SUSPENSE), [
      `_push`,
      slotsExp,
    ]),
  )
}
