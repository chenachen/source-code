import {
  type CallExpression,
  type ConditionalExpression,
  type DirectiveNode,
  type ElementNode,
  ElementTypes,
  type ExpressionNode,
  type FunctionExpression,
  NodeTypes,
  type ObjectExpression,
  type Property,
  type SlotsExpression,
  type SourceLocation,
  type TemplateChildNode,
  createArrayExpression,
  createCallExpression,
  createConditionalExpression,
  createFunctionExpression,
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
} from '../ast'
import type { NodeTransform, TransformContext } from '../transform'
import { ErrorCodes, createCompilerError } from '../errors'
import {
  assert,
  findDir,
  hasScopeRef,
  isCommentOrWhitespace,
  isStaticExp,
  isTemplateNode,
  isVSlot,
  isWhitespaceText,
} from '../utils'
import { CREATE_SLOTS, RENDER_LIST, WITH_CTX } from '../runtimeHelpers'
import { createForLoopParams, finalizeForParseResult } from './vFor'
import { SlotFlags, slotFlagsText } from '@vue/shared'

/** 动态条件插槽未命中时的占位值，运行时会忽略该项。 */
const defaultFallback = createSimpleExpression(`undefined`, false)

/**
 * 跟踪作用域插槽引入的变量与插槽嵌套深度。
 *
 * 非浏览器构建且开启 `prefixIdentifiers` 时，插槽参数（如 `{ item }`）会登记为局部
 * 标识符，避免表达式转换器把 `item` 错写为 `_ctx.item`。`vSlot` 计数用于判断一个
 * 插槽是否嵌在另一插槽中；同一节点的退出回调早于 `buildSlots()` 执行，因此只有真正
 * 的内层插槽能看到正数。
 */
export const trackSlotScopes: NodeTransform = (node, context) => {
  if (
    node.type === NodeTypes.ELEMENT &&
    (node.tagType === ElementTypes.COMPONENT ||
      node.tagType === ElementTypes.TEMPLATE)
  ) {
    // 这里只关心会引入作用域参数的 v-slot；无参数插槽不需要登记标识符。
    const vSlot = findDir(node, 'slot')
    if (vSlot) {
      const slotProps = vSlot.exp
      if (!__BROWSER__ && context.prefixIdentifiers) {
        slotProps && context.addIdentifiers(slotProps)
      }
      context.scopes.vSlot++
      return () => {
        if (!__BROWSER__ && context.prefixIdentifiers) {
          slotProps && context.removeIdentifiers(slotProps)
        }
        context.scopes.vSlot--
      }
    }
  }
}

/**
 * 跟踪 `<template v-for v-slot>` 中由 v-for 引入的循环别名。
 *
 * 该转换器只用于非浏览器、开启 `prefixIdentifiers` 的构建；退出 template 时成对移除
 * value/key/index，避免作用域污染后续节点。
 */
export const trackVForSlotScopes: NodeTransform = (node, context) => {
  let vFor
  if (
    isTemplateNode(node) &&
    node.props.some(isVSlot) &&
    (vFor = findDir(node, 'for'))
  ) {
    const result = vFor.forParseResult
    if (result) {
      finalizeForParseResult(result, context)
      const { value, key, index } = result
      const { addIdentifiers, removeIdentifiers } = context
      value && addIdentifiers(value)
      key && addIdentifiers(key)
      index && addIdentifiers(index)

      return () => {
        value && removeIdentifiers(value)
        key && removeIdentifiers(key)
        index && removeIdentifiers(index)
      }
    }
  }
}

/**
 * 插槽函数构造器签名。SSR 可传入自己的实现，从同一套插槽分析结果生成不同代码。
 */
export type SlotFnBuilder = (
  slotProps: ExpressionNode | undefined,
  vFor: DirectiveNode | undefined,
  slotChildren: TemplateChildNode[],
  loc: SourceLocation,
) => FunctionExpression

/** 创建客户端插槽函数，并标记为 slot 以便代码生成器套用插槽专用处理。 */
const buildClientSlotFn: SlotFnBuilder = (props, _vForExp, children, loc) =>
  createFunctionExpression(
    props,
    children,
    false /* newline */,
    true /* isSlot */,
    children.length ? children[0].loc : loc,
  )

/**
 * 收集组件上的所有 `v-slot`，生成传给组件 VNode 的 slots 对象。
 *
 * `v-slot` 不作为普通 DirectiveTransform 运行，而由 `transformElement` 在构造组件
 * children 时调用。这里同时处理组件自身简写、`<template #name>`、条件插槽、循环插槽、
 * 隐式默认插槽，并计算插槽稳定性标记。
 *
 * @returns slots 代码生成表达式，以及是否含动态插槽
 */
export function buildSlots(
  node: ElementNode,
  context: TransformContext,
  buildSlotFn: SlotFnBuilder = buildClientSlotFn,
): {
  /** 最终传给组件 VNode 的静态插槽对象或 `createSlots` 调用。 */
  slots: SlotsExpression
  /** 是否包含条件、循环或捕获外层作用域的动态插槽。 */
  hasDynamicSlots: boolean
} {
  context.helper(WITH_CTX)

  const { children, loc } = node
  const slotsProperties: Property[] = []
  const dynamicSlots: (ConditionalExpression | CallExpression)[] = []

  // 位于 v-for 或另一插槽中的插槽很可能捕获外层局部变量，默认按动态插槽处理。
  let hasDynamicSlots = context.scopes.vSlot > 0 || context.scopes.vFor > 0
  // 开启 prefixIdentifiers 时已有精确作用域信息，可进一步优化：仅当插槽名/参数或
  // 子树真的引用外层局部变量时才视为动态，减少不必要的插槽更新。
  if (!__BROWSER__ && !context.ssr && context.prefixIdentifiers) {
    hasDynamicSlots =
      node.props.some(
        prop =>
          isVSlot(prop) &&
          (hasScopeRef(prop.arg, context.identifiers) ||
            hasScopeRef(prop.exp, context.identifiers)),
      ) || children.some(child => hasScopeRef(child, context.identifiers))
  }

  // 1. 处理直接写在组件上的简写：`<Comp v-slot="{ prop }" />`。
  const onComponentSlot = findDir(node, 'slot', true)
  if (onComponentSlot) {
    const { arg, exp } = onComponentSlot
    if (arg && !isStaticExp(arg)) {
      hasDynamicSlots = true
    }
    slotsProperties.push(
      createObjectProperty(
        arg || createSimpleExpression('default', true),
        buildSlotFn(exp, undefined, children, loc),
      ),
    )
  }

  // 2. 遍历组件子节点，收集 `<template v-slot:foo="{ prop }">` 形式的具名插槽。
  let hasTemplateSlots = false
  let hasNamedDefaultSlot = false
  const implicitDefaultChildren: TemplateChildNode[] = []
  const seenSlotNames = new Set<string>()
  let conditionalBranchIndex = 0

  for (let i = 0; i < children.length; i++) {
    const slotElement = children[i]
    let slotDir

    if (
      !isTemplateNode(slotElement) ||
      !(slotDir = findDir(slotElement, 'slot', true))
    ) {
      // 非 template 插槽的有效节点属于隐式 default 插槽；注释不计入默认内容。
      if (slotElement.type !== NodeTypes.COMMENT) {
        implicitDefaultChildren.push(slotElement)
      }
      continue
    }

    if (onComponentSlot) {
      // 组件自身 v-slot 与子级 template v-slot 混用时语义含糊，直接报告错误。
      context.onError(
        createCompilerError(ErrorCodes.X_V_SLOT_MIXED_SLOT_USAGE, slotDir.loc),
      )
      break
    }

    hasTemplateSlots = true
    const { children: slotChildren, loc: slotLoc } = slotElement
    const {
      arg: slotName = createSimpleExpression(`default`, true),
      exp: slotProps,
      loc: dirLoc,
    } = slotDir

    // 动态插槽名（如 `#[name]`）只有运行时才能确定，整组 slots 必须参与更新。
    let staticSlotName: string | undefined
    if (isStaticExp(slotName)) {
      staticSlotName = slotName ? slotName.content : `default`
    } else {
      hasDynamicSlots = true
    }

    const vFor = findDir(slotElement, 'for')
    const slotFunction = buildSlotFn(slotProps, vFor, slotChildren, slotLoc)

    // v-if/v-for 会使插槽是否存在、名称或数量随渲染变化，需要放入 dynamicSlots。
    let vIf: DirectiveNode | undefined
    let vElse: DirectiveNode | undefined
    if ((vIf = findDir(slotElement, 'if'))) {
      hasDynamicSlots = true
      dynamicSlots.push(
        createConditionalExpression(
          vIf.exp!,
          buildDynamicSlot(slotName, slotFunction, conditionalBranchIndex++),
          defaultFallback,
        ),
      )
    } else if (
      (vElse = findDir(slotElement, /^else(?:-if)?$/, true /* allowEmpty */))
    ) {
      // 与普通 v-else 一样，跳过注释/空白并向前查找相邻的插槽 v-if。
      let j = i
      let prev
      while (j--) {
        prev = children[j]
        if (!isCommentOrWhitespace(prev)) {
          break
        }
      }
      if (prev && isTemplateNode(prev) && findDir(prev, /^(?:else-)?if$/)) {
        __TEST__ && assert(dynamicSlots.length > 0)
        // 将当前 else(-if) 接到上一条动态条件插槽最深层的 alternate。
        let conditional = dynamicSlots[
          dynamicSlots.length - 1
        ] as ConditionalExpression
        while (
          conditional.alternate.type === NodeTypes.JS_CONDITIONAL_EXPRESSION
        ) {
          conditional = conditional.alternate
        }
        conditional.alternate = vElse.exp
          ? createConditionalExpression(
              vElse.exp,
              buildDynamicSlot(
                slotName,
                slotFunction,
                conditionalBranchIndex++,
              ),
              defaultFallback,
            )
          : buildDynamicSlot(slotName, slotFunction, conditionalBranchIndex++)
      } else {
        context.onError(
          createCompilerError(ErrorCodes.X_V_ELSE_NO_ADJACENT_IF, vElse.loc),
        )
      }
    } else if (vFor) {
      hasDynamicSlots = true
      const parseResult = vFor.forParseResult
      if (parseResult) {
        finalizeForParseResult(parseResult, context)
        // v-for 生成动态插槽数组；最终交给 createSlots() 展平并按名称组织。
        dynamicSlots.push(
          createCallExpression(context.helper(RENDER_LIST), [
            parseResult.source,
            createFunctionExpression(
              createForLoopParams(parseResult),
              buildDynamicSlot(slotName, slotFunction),
              true /* force newline */,
            ),
          ]),
        )
      } else {
        context.onError(
          createCompilerError(
            ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION,
            vFor.loc,
          ),
        )
      }
    } else {
      // 静态插槽名可在编译期判重；动态名称只能留给运行时解析。
      if (staticSlotName) {
        if (seenSlotNames.has(staticSlotName)) {
          context.onError(
            createCompilerError(
              ErrorCodes.X_V_SLOT_DUPLICATE_SLOT_NAMES,
              dirLoc,
            ),
          )
          continue
        }
        seenSlotNames.add(staticSlotName)
        if (staticSlotName === 'default') {
          hasNamedDefaultSlot = true
        }
      }
      slotsProperties.push(createObjectProperty(slotName, slotFunction))
    }
  }

  if (!onComponentSlot) {
    /** 创建 default 插槽属性，并在兼容模式下记录旧版非作用域插槽语义。 */
    const buildDefaultSlotProperty = (
      props: ExpressionNode | undefined,
      children: TemplateChildNode[],
    ) => {
      const fn = buildSlotFn(props, undefined, children, loc)
      if (__COMPAT__ && context.compatConfig) {
        fn.isNonScopedSlot = true
      }
      return createObjectProperty(`default`, fn)
    }

    if (!hasTemplateSlots) {
      // 没有 template 具名插槽时，组件全部 children 都是隐式 default 插槽。
      slotsProperties.push(buildDefaultSlotProperty(undefined, children))
    } else if (
      implicitDefaultChildren.length &&
      // #3766：`whitespace: 'preserve'` 会把具名插槽之间的空白放进隐式默认内容。
      // 若这些内容全是空白，应忽略，而不是凭空创建 default 插槽或报告混用错误。
      !implicitDefaultChildren.every(isWhitespaceText)
    ) {
      // 具名插槽之外确有有效内容：若已有显式 default 则报重复，否则创建隐式 default。
      if (hasNamedDefaultSlot) {
        context.onError(
          createCompilerError(
            ErrorCodes.X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN,
            implicitDefaultChildren[0].loc,
          ),
        )
      } else {
        slotsProperties.push(
          buildDefaultSlotProperty(undefined, implicitDefaultChildren),
        )
      }
    }
  }

  const slotFlag = hasDynamicSlots
    ? SlotFlags.DYNAMIC
    : hasForwardedSlots(node.children)
      ? SlotFlags.FORWARDED
      : SlotFlags.STABLE
  let slots = createObjectExpression(
    slotsProperties.concat(
      createObjectProperty(
        `_`,
        // 编译产物用 `_` 携带 SlotFlags：DYNAMIC 可跳过规范化但仍需 diff；
        // STABLE 连 diff 都可跳过；FORWARDED 则由接收方结合父级插槽稳定性判断。
        createSimpleExpression(
          slotFlag + (__DEV__ ? ` /* ${slotFlagsText[slotFlag]} */` : ``),
          false,
        ),
      ),
    ),
    loc,
  ) as SlotsExpression
  if (dynamicSlots.length) {
    slots = createCallExpression(context.helper(CREATE_SLOTS), [
      slots,
      createArrayExpression(dynamicSlots),
    ]) as SlotsExpression
  }

  return {
    slots,
    hasDynamicSlots,
  }
}

/** 创建一条运行时动态插槽描述；条件分支的 index 会作为 key 区分相邻分支。 */
function buildDynamicSlot(
  name: ExpressionNode,
  fn: FunctionExpression,
  index?: number,
): ObjectExpression {
  const props = [
    createObjectProperty(`name`, name),
    createObjectProperty(`fn`, fn),
  ]
  if (index != null) {
    props.push(
      createObjectProperty(`key`, createSimpleExpression(String(index), true)),
    )
  }
  return createObjectExpression(props)
}

/**
 * 递归判断插槽内容是否继续转发了 `<slot>`。
 * 转发插槽的稳定性取决于父组件传入的插槽，编译期不能直接判为稳定。
 */
function hasForwardedSlots(children: TemplateChildNode[]): boolean {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    switch (child.type) {
      case NodeTypes.ELEMENT:
        if (
          child.tagType === ElementTypes.SLOT ||
          hasForwardedSlots(child.children)
        ) {
          return true
        }
        break
      case NodeTypes.IF:
        if (hasForwardedSlots(child.branches)) return true
        break
      case NodeTypes.IF_BRANCH:
      case NodeTypes.FOR:
        if (hasForwardedSlots(child.children)) return true
        break
      default:
        break
    }
  }
  return false
}
