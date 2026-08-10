import type { NodeTransform, TransformContext } from '../transform'
import {
  type CallExpression,
  type ExpressionNode,
  NodeTypes,
  type SlotOutletNode,
  createCallExpression,
  createFunctionExpression,
  createSimpleExpression,
} from '../ast'
import { isSlotOutlet, isStaticArgOf, isStaticExp } from '../utils'
import { type PropsExpression, buildProps } from './transformElement'
import { ErrorCodes, createCompilerError } from '../errors'
import { RENDER_SLOT } from '../runtimeHelpers'
import { camelize } from '@vue/shared'
import { processExpression } from './transformExpression'

/**
 * 把 `<slot>` 出口转换为 `renderSlot($slots, name, props, fallback, ...)` 调用。
 * 尾部可选参数按实际需要裁剪，避免每个插槽都生成多余 `undefined`。
 */
export const transformSlotOutlet: NodeTransform = (node, context) => {
  if (isSlotOutlet(node)) {
    const { children, loc } = node
    const { slotName, slotProps } = processSlotOutlet(node, context)

    const slotArgs: CallExpression['arguments'] = [
      context.prefixIdentifiers ? `_ctx.$slots` : `$slots`,
      slotName,
      '{}',
      'undefined',
      'true',
    ]
    let expectedLen = 2

    if (slotProps) {
      slotArgs[2] = slotProps
      expectedLen = 3
    }

    if (children.length) {
      slotArgs[3] = createFunctionExpression([], children, false, false, loc)
      expectedLen = 4
    }

    if (context.scopeId && !context.slotted) {
      // scoped SFC 且样式未使用 :slotted 时显式传 noSlotted，避免对子组件插槽内容追加 scopeId。
      expectedLen = 5
    }
    slotArgs.splice(expectedLen)

    node.codegenNode = createCallExpression(
      context.helper(RENDER_SLOT),
      slotArgs,
      loc,
    )
  }
}

/** `<slot>` 属性拆分结果。 */
interface SlotOutletProcessResult {
  /** 静态名称直接保存带引号字符串，动态名称保留表达式节点。 */
  slotName: string | ExpressionNode
  /** 除 `name` 外的属性生成的插槽 props；没有属性时省略。 */
  slotProps: PropsExpression | undefined
}

/**
 * 从 `<slot>` 中提取名称，其余属性通过通用 buildProps 生成传给插槽函数的 props。
 * 自定义运行时指令无法合理作用于插槽出口，因此发现后报错。
 */
export function processSlotOutlet(
  node: SlotOutletNode,
  context: TransformContext,
): SlotOutletProcessResult {
  let slotName: string | ExpressionNode = `"default"`
  let slotProps: PropsExpression | undefined = undefined

  const nonNameProps = []
  for (let i = 0; i < node.props.length; i++) {
    const p = node.props[i]
    if (p.type === NodeTypes.ATTRIBUTE) {
      if (p.value) {
        if (p.name === 'name') {
          slotName = JSON.stringify(p.value.content)
        } else {
          p.name = camelize(p.name)
          nonNameProps.push(p)
        }
      }
    } else {
      if (p.name === 'bind' && isStaticArgOf(p.arg, 'name')) {
        if (p.exp) {
          slotName = p.exp
        } else if (p.arg && p.arg.type === NodeTypes.SIMPLE_EXPRESSION) {
          const name = camelize(p.arg.content)
          slotName = p.exp = createSimpleExpression(name, false, p.arg.loc)
          if (!__BROWSER__) {
            slotName = p.exp = processExpression(p.exp, context)
          }
        }
      } else {
        if (p.name === 'bind' && p.arg && isStaticExp(p.arg)) {
          p.arg.content = camelize(p.arg.content)
        }
        nonNameProps.push(p)
      }
    }
  }

  if (nonNameProps.length > 0) {
    const { props, directives } = buildProps(
      node,
      context,
      nonNameProps,
      false,
      false,
    )
    slotProps = props

    if (directives.length) {
      context.onError(
        createCompilerError(
          ErrorCodes.X_V_SLOT_UNEXPECTED_DIRECTIVE_ON_SLOT_OUTLET,
          directives[0].loc,
        ),
      )
    }
  }

  return {
    slotName,
    slotProps,
  }
}
