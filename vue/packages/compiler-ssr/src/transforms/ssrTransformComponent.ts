import {
  CREATE_VNODE,
  type CallExpression,
  type CompilerOptions,
  type ComponentNode,
  DOMDirectiveTransforms,
  DOMNodeTransforms,
  type DirectiveNode,
  ElementTypes,
  type ExpressionNode,
  type FunctionExpression,
  type JSChildNode,
  Namespaces,
  type NodeTransform,
  NodeTypes,
  RESOLVE_DYNAMIC_COMPONENT,
  type ReturnStatement,
  type RootNode,
  SUSPENSE,
  type SlotFnBuilder,
  TELEPORT,
  TRANSITION,
  TRANSITION_GROUP,
  type TemplateChildNode,
  type TemplateNode,
  type TransformContext,
  type TransformOptions,
  buildProps,
  buildSlots,
  createCallExpression,
  createFunctionExpression,
  createIfStatement,
  createReturnStatement,
  createRoot,
  createSimpleExpression,
  createTransformContext,
  getBaseTransformPreset,
  locStub,
  resolveComponentType,
  stringifyExpression,
  traverseNode,
} from '@vue/compiler-dom'
import { SSR_RENDER_COMPONENT, SSR_RENDER_VNODE } from '../runtimeHelpers'
import {
  type SSRTransformContext,
  processChildren,
  processChildrenAsStatement,
} from '../ssrCodegenTransform'
import { ssrProcessTeleport } from './ssrTransformTeleport'
import {
  ssrProcessSuspense,
  ssrTransformSuspense,
} from './ssrTransformSuspense'
import {
  ssrProcessTransitionGroup,
  ssrTransformTransitionGroup,
} from './ssrTransformTransitionGroup'
import { extend, isArray, isObject, isPlainObject, isSymbol } from '@vue/shared'
import { buildSSRProps } from './ssrTransformElement'
import {
  ssrProcessTransition,
  ssrTransformTransition,
} from './ssrTransformTransition'

/**
 * 第一遍必须调用 buildSlots 才能借助 core context 正确分析 slot/v-for 作用域；但 slot
 * children 的 SSR 函数体只能第二遍生成。因此用 WeakMap 暂存半成品，且不延长 AST 生命周期。
 */
const wipMap = new WeakMap<ComponentNode, WIPSlotEntry[]>()

/** 标识 processChildren 的 parent 是待完成 slot，而非普通 AST 容器。 */
const WIP_SLOT = Symbol()

/** 每个 slot 的 SSR 函数、原 children 与客户端 VNode fallback 分支。 */
interface WIPSlotEntry {
  /** 区分半成品插槽容器与普通 AST parent 的内部标记。 */
  type: typeof WIP_SLOT
  /** 第一遍创建、第二遍补齐 body 的插槽函数。 */
  fn: FunctionExpression
  /** 插槽的原始模板子节点。 */
  children: TemplateChildNode[]
  /** 未传 `_push` 时返回普通 VNode 的 fallback；SSR 中的 render-function 子组件也会走此分支。 */
  vnodeBranch: ReturnStatement
}

/** 第一遍解析出的组件类型，第二遍据此分派内置/静态/动态组件。 */
const componentTypeMap = new WeakMap<
  ComponentNode,
  string | symbol | CallExpression
>()

/**
 * SSR 组件第一遍转换：解析组件、构造 props 和半成品 slot 函数。
 * 第二遍会为每个 slot 补齐“SSR 字符串分支 + 普通 VNode fallback 分支”。fallback 必不可少，
 * 因为 render-function 子组件调用传入 slot 时可能不提供 `_push`，期望得到 VNode 数组。
 * enter 阶段克隆未被后代 SSR 转换改写的 children，exit 阶段在原树作用域内分别构造
 * VNode/SSR slots，并按 buildSlots 的同一遍历次序配对。WeakMap 以组件 AST 为键保留
 * 中间状态，离开编译树后可被回收；不属于按模板文本复用产物的编译缓存。
 */
export const ssrTransformComponent: NodeTransform = (node, context) => {
  if (
    node.type !== NodeTypes.ELEMENT ||
    node.tagType !== ElementTypes.COMPONENT
  ) {
    return
  }

  const component = resolveComponentType(node, context, true /* SSR 模式 */)
  const isDynamicComponent =
    isObject(component) && component.callee === RESOLVE_DYNAMIC_COMPONENT
  componentTypeMap.set(node, component)

  if (isSymbol(component)) {
    if (component === SUSPENSE) {
      return ssrTransformSuspense(node, context)
    } else if (component === TRANSITION_GROUP) {
      return ssrTransformTransitionGroup(node, context)
    } else if (component === TRANSITION) {
      return ssrTransformTransition(node, context)
    }
    return // Teleport/KeepAlive 等其他内置组件留到第二遍按 fallthrough 分派
  }

  // 为 slot 建立客户端 VNode fallback：clone 后用普通 buildSlots 取得每个 slot children，
  // 再跑独立 VNode 子转换并保存 ReturnStatement。clone 防止 fallback 转换原位修改 SSR 树。
  const vnodeBranches: ReturnStatement[] = []
  const clonedNode = clone(node)

  return function ssrPostTransformComponent() {
    // fallback 分支顺序与随后 SSR buildSlots 的 slot 遍历顺序一致，按下标配对。
    if (clonedNode.children.length) {
      buildSlots(clonedNode, context, (props, vFor, children) => {
        vnodeBranches.push(
          createVNodeSlotBranch(props, vFor, children, context),
        )
        return createFunctionExpression(undefined)
      })
    }

    let propsExp: string | JSChildNode = `null`
    if (node.props.length) {
      // 组件 props 的 v-on 仍要传给子组件 emits，不能像原生元素 SSR 那样跳过监听器。
      const { props, directives } = buildProps(
        node,
        context,
        undefined,
        true,
        isDynamicComponent,
      )
      if (props || directives.length) {
        propsExp = buildSSRProps(props, directives, context)
      }
    }

    const wipEntries: WIPSlotEntry[] = []
    wipMap.set(node, wipEntries)

    /** 第一遍创建 SSR slot 函数壳，并保存 children 供第二遍填充双分支 body。 */
    const buildSSRSlotFn: SlotFnBuilder = (props, _vForExp, children, loc) => {
      const param0 = (props && stringifyExpression(props)) || `_`
      const fn = createFunctionExpression(
        [param0, `_push`, `_parent`, `_scopeId`],
        undefined, // 第二遍再赋函数体
        true, // 多行输出便于阅读
        true, // 标记为 slot 函数
        loc,
      )
      wipEntries.push({
        type: WIP_SLOT,
        fn,
        children,
        // 取第一轮 buildSlots 同位置产生的 VNode fallback。
        vnodeBranch: vnodeBranches[wipEntries.length],
      })
      return fn
    }

    const slots = node.children.length
      ? buildSlots(node, context, buildSSRSlotFn).slots
      : `null`

    if (typeof component !== 'string') {
      // 动态组件解析结果可能是原生标签字符串、组件或 VNode，统一先 createVNode 再由
      // ssrRenderVNode 分派，不能直接调用静态组件 helper。
      node.ssrCodegenNode = createCallExpression(
        context.helper(SSR_RENDER_VNODE),
        [
          `_push`,
          createCallExpression(context.helper(CREATE_VNODE), [
            component,
            propsExp,
            slots,
          ]),
          `_parent`,
        ],
      )
    } else {
      node.ssrCodegenNode = createCallExpression(
        context.helper(SSR_RENDER_COMPONENT),
        [component, propsExp, slots, `_parent`],
      )
    }
  }
}

/**
 * SSR 第二遍完成 slot 双分支并输出组件/内置组件调用。
 * slot 函数根据是否收到第二参数 `_push` 判断调用来自 SSR helper 还是普通 render 函数。
 * @param node - 第一遍已登记 componentTypeMap、可能有 ssrCodegenNode/wipMap 的组件节点。
 * @param context - 当前输出函数体；此函数会中断连续字符串并写入独立 helper 调用。
 * @param parent - 当前模板容器或 WIP_SLOT 容器，用于透明组件插槽的空字符串占位。
 */
export function ssrProcessComponent(
  node: ComponentNode,
  context: SSRTransformContext,
  parent: {
    /** 组件在父容器中的兄弟节点，用于 Transition 等透明组件处理。 */
    children: TemplateChildNode[]
  },
): void {
  const component = componentTypeMap.get(node)!
  if (!node.ssrCodegenNode) {
    // 没有 ssrCodegenNode 表示第一遍识别为需专用处理或透明输出的内置组件。
    if (component === TELEPORT) {
      return ssrProcessTeleport(node, context)
    } else if (component === SUSPENSE) {
      return ssrProcessSuspense(node, context)
    } else if (component === TRANSITION_GROUP) {
      return ssrProcessTransitionGroup(node, context)
    } else {
      // Transition/KeepAlive 服务端本身透明，只输出 children。#5352：若它位于 slot 根，
      // 先 push 空字符串（不改变 HTML），防止全注释 slot 被 ssrRenderSlot 误判为空而走 fallback。
      if ((parent as WIPSlotEntry).type === WIP_SLOT) {
        context.pushStringPart(``)
      }
      if (component === TRANSITION) {
        return ssrProcessTransition(node, context)
      }
      processChildren(node, context)
    }
  } else {
    // 补完第一遍留下的 slot 函数；每个函数同时服务 SSR 消费方与普通 VNode 消费方。
    const wipEntries = wipMap.get(node) || []
    for (let i = 0; i < wipEntries.length; i++) {
      const { fn, vnodeBranch } = wipEntries[i]
      // ssrRenderSlot/ssrRenderSlotInner 调用时传入 `_push`：存在走 SSR 输出，否则返回 VNode。
      fn.body = createIfStatement(
        createSimpleExpression(`_push`, false),
        processChildrenAsStatement(
          wipEntries[i],
          context,
          false,
          true /* 传递插槽作用域 ID */,
        ),
        vnodeBranch,
      )
    }

    // slot 内组件需继续向其根传递 `_scopeId`，保证父级 slotted/scoped CSS 生效。
    if (context.withSlotScopeId) {
      node.ssrCodegenNode.arguments.push(`_scopeId`)
    }

    if (typeof component === 'string') {
      // 静态组件 helper 返回 SSRBuffer 或 Promise<SSRBuffer>，独立交给 `_push` 保留输出顺序；
      // 不能并进字符串插值，最终展开阶段才将子 buffer 解析为 HTML。
      context.pushStatement(
        createCallExpression(`_push`, [node.ssrCodegenNode]),
      )
    } else {
      // 动态组件 codegenNode 本身已是会写入 `_push` 的 ssrRenderVNode 调用。
      context.pushStatement(node.ssrCodegenNode)
    }
  }
}

/** 根 AST 到原始编译选项，供 slot VNode fallback 子转换重建客户端管线。 */
export const rawOptionsMap: WeakMap<RootNode, CompilerOptions> = new WeakMap<
  RootNode,
  CompilerOptions
>()

/** 客户端 VNode fallback 使用的 core 基础转换预设。 */
const [baseNodeTransforms, baseDirectiveTransforms] =
  getBaseTransformPreset(true)
/** core + DOM 的客户端节点转换管线。 */
const vnodeNodeTransforms = [...baseNodeTransforms, ...DOMNodeTransforms]
/** core + DOM 的客户端指令转换表。 */
const vnodeDirectiveTransforms = {
  ...baseDirectiveTransforms,
  ...DOMDirectiveTransforms,
}

/**
 * 将单个 slot children 用客户端管线编译为 ReturnStatement fallback。
 * wrapper template 会带回原 v-slot 参数与 v-for，确保子转换正确识别局部作用域。
 * 返回的 VNode 数组仅来自克隆 children；真实 SSR children 继续由第二遍使用。
 * 外部自定义转换也会在此子管线执行，不能假设一个插件对 slot 只访问一次。
 */
function createVNodeSlotBranch(
  slotProps: ExpressionNode | undefined,
  vFor: DirectiveNode | undefined,
  children: TemplateChildNode[],
  parentContext: TransformContext,
): ReturnStatement {
  // 复制根原始选项，但用客户端 VNode transforms 覆盖 SSR transforms。
  const rawOptions = rawOptionsMap.get(parentContext.root)!

  const subOptions = {
    ...rawOptions,
    // 用户自定义转换仍追加在标准 VNode 转换之后。
    nodeTransforms: [
      ...vnodeNodeTransforms,
      ...(rawOptions.nodeTransforms || []),
    ],
    directiveTransforms: {
      ...vnodeDirectiveTransforms,
      ...(rawOptions.directiveTransforms || {}),
    },
  }

  // wrapper template 让多 children 按统一根处理；必须复制 v-slot props/v-for，避免 fallback
  // 把 slot 参数或循环别名错误前缀为 `_ctx.*`。
  const wrapperProps: TemplateNode['props'] = []
  if (slotProps) {
    wrapperProps.push({
      type: NodeTypes.DIRECTIVE,
      name: 'slot',
      exp: slotProps,
      arg: undefined,
      modifiers: [],
      loc: locStub,
    })
  }
  if (vFor) {
    wrapperProps.push(extend({}, vFor))
  }
  const wrapperNode: TemplateNode = {
    type: NodeTypes.ELEMENT,
    ns: Namespaces.HTML,
    tag: 'template',
    tagType: ElementTypes.TEMPLATE,
    props: wrapperProps,
    children,
    loc: locStub,
    codegenNode: undefined,
  }
  subTransform(wrapperNode, subOptions, parentContext)
  return createReturnStatement(children)
}

/**
 * 对一个 slot wrapper 执行独立客户端子转换，并把使用到的 helper/component/directive
 * 合并回父 SSR context，使最终模块拥有 fallback 所需导入与解析声明。
 */
function subTransform(
  node: TemplateChildNode,
  options: TransformOptions,
  parentContext: TransformContext,
) {
  const childRoot = createRoot([node])
  const childContext = createTransformContext(childRoot, options)
  // fallback 是普通 render 函数语义，显式关闭 ssr 标记。
  childContext.ssr = false
  // 继承当前 slot/v-for 标识符与层级，保持表达式解析一致；imports 共用同一列表去重。
  childContext.scopes = { ...parentContext.scopes }
  childContext.identifiers = { ...parentContext.identifiers }
  childContext.imports = parentContext.imports
  // 只遍历子根，不执行 SSR 第二遍。
  traverseNode(childRoot, childContext)
  // helper 是引用计数 Map，需累加；组件/指令是 Set，直接合并。
  ;(['helpers', 'components', 'directives'] as const).forEach(key => {
    childContext[key].forEach((value: any, helperKey: any) => {
      if (key === 'helpers') {
        const parentCount = parentContext.helpers.get(helperKey)
        if (parentCount === undefined) {
          parentContext.helpers.set(helperKey, value)
        } else {
          parentContext.helpers.set(helperKey, value + parentCount)
        }
      } else {
        ;(parentContext[key] as any).add(value)
      }
    })
  })
  // 不额外合并 imports/hoists：资产 URL import 已与父上下文共享且两分支应一致；fallback
  // 子转换未启用静态提升，不会产生 hoist。
}

/**
 * 递归复制数组及 isPlainObject 判定为 `[object Object]` 的对象；其他值按原值保留。
 * 用于隔离 VNode fallback 的原位转换，只面向无环 AST，不复制对象原型。
 */
function clone(v: any): any {
  if (isArray(v)) {
    return v.map(clone)
  } else if (isPlainObject(v)) {
    const res: any = {}
    for (const key in v) {
      res[key] = clone(v[key as keyof typeof v])
    }
    return res
  } else {
    return v
  }
}
