import {
  type CacheExpression,
  type CallExpression,
  type ComponentNode,
  ConstantTypes,
  ElementTypes,
  type ExpressionNode,
  type JSChildNode,
  NodeTypes,
  type ParentNode,
  type PlainElementNode,
  type RootNode,
  type SimpleExpressionNode,
  type SlotFunctionExpression,
  type TemplateChildNode,
  type TemplateNode,
  type TextCallNode,
  type VNodeCall,
  createArrayExpression,
  getVNodeBlockHelper,
  getVNodeHelper,
} from '../ast'
import type { TransformContext } from '../transform'
import {
  PatchFlagNames,
  PatchFlags,
  isArray,
  isString,
  isSymbol,
} from '@vue/shared'
import { findDir, isSlotOutlet } from '../utils'
import {
  GUARD_REACTIVE_PROPS,
  NORMALIZE_CLASS,
  NORMALIZE_PROPS,
  NORMALIZE_STYLE,
  OPEN_BLOCK,
} from '../runtimeHelpers'

/**
 * 从根开始执行静态分析：稳定 VNode 和文本进入实例渲染缓存；动态元素中稳定的
 * props 对象及 dynamicProps 名单可提升到 render 外。
 * 单元素根保留 VNodeCall，随后由 createRootCodegen 转为 block，作为静态子树的更新边界。
 */
export function cacheStatic(root: RootNode, context: TransformContext): void {
  walk(
    root,
    undefined,
    context,
    // 单元素根保留为 block 更新边界，仍继续缓存其静态后代。
    !!getSingleElementRoot(root),
  )
}

/** 忽略注释后取得唯一元素根；slot 出口不视为可优化的普通根元素。 */
export function getSingleElementRoot(
  root: RootNode,
): PlainElementNode | ComponentNode | TemplateNode | null {
  const children = root.children.filter(x => x.type !== NodeTypes.COMMENT)
  return children.length === 1 &&
    children[0].type === NodeTypes.ELEMENT &&
    !isSlotOutlet(children[0])
    ? children[0]
    : null
}

/**
 * 深度优先分析父节点 children，收集可缓存节点，并在全部 children 都静态时优先缓存整个数组。
 * 数组级缓存比逐 VNode 缓存少 `_cache` 槽和条件表达式，也适用于组件默认/具名插槽返回值。
 * doNotHoistNode 保护单根及结构分支的唯一子节点；它仍递归优化后代。整棵子树已经缓存时
 * 直接 continue，避免再次分配后代缓存槽。parent 只用于定位具名 slot 的组件父节点。
 * inFor 在本实现中仅向下传递，不改变缓存决策；缓存数组统一设置 needArraySpread。
 */
function walk(
  node: ParentNode,
  parent: ParentNode | undefined,
  context: TransformContext,
  doNotHoistNode: boolean = false,
  inFor = false,
) {
  const { children } = node
  const toCache: (PlainElementNode | TextCallNode)[] = []
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    // 组件可能依赖实例状态/插槽，结构节点需要 block 语义；只缓存原生元素和显式文本调用。
    if (
      child.type === NodeTypes.ELEMENT &&
      child.tagType === ElementTypes.ELEMENT
    ) {
      const constantType = doNotHoistNode
        ? ConstantTypes.NOT_CONSTANT
        : getConstantType(child, context)
      if (constantType > ConstantTypes.NOT_CONSTANT) {
        if (constantType >= ConstantTypes.CAN_CACHE) {
          ;(child.codegenNode as VNodeCall).patchFlag = PatchFlags.CACHED
          toCache.push(child)
          continue
        }
      } else {
        // 整个节点动态时，props 对象和 dynamicProps 名单仍可能稳定，可单独提升。
        const codegenNode = child.codegenNode!
        if (codegenNode.type === NodeTypes.VNODE_CALL) {
          const flag = codegenNode.patchFlag
          if (
            (flag === undefined ||
              flag === PatchFlags.NEED_PATCH ||
              flag === PatchFlags.TEXT) &&
            getGeneratedPropsConstantType(child, context) >=
              ConstantTypes.CAN_CACHE
          ) {
            const props = getNodeProps(child)
            if (props) {
              codegenNode.props = context.hoist(props)
            }
          }
          if (codegenNode.dynamicProps) {
            codegenNode.dynamicProps = context.hoist(codegenNode.dynamicProps)
          }
        }
      }
    } else if (child.type === NodeTypes.TEXT_CALL) {
      const constantType = doNotHoistNode
        ? ConstantTypes.NOT_CONSTANT
        : getConstantType(child, context)
      if (constantType >= ConstantTypes.CAN_CACHE) {
        if (
          child.codegenNode.type === NodeTypes.JS_CALL_EXPRESSION &&
          child.codegenNode.arguments.length > 0
        ) {
          child.codegenNode.arguments.push(
            PatchFlags.CACHED +
              (__DEV__ ? ` /* ${PatchFlagNames[PatchFlags.CACHED]} */` : ``),
          )
        }
        toCache.push(child)
        continue
      }
    }

    // 当前节点未整体缓存，继续分析其后代。组件 children 处于插槽作用域。
    if (child.type === NodeTypes.ELEMENT) {
      const isComponent = child.tagType === ElementTypes.COMPONENT
      if (isComponent) {
        context.scopes.vSlot++
      }
      walk(child, node, context, false, inFor)
      if (isComponent) {
        context.scopes.vSlot--
      }
    } else if (child.type === NodeTypes.FOR) {
      // v-for 的单 child 必须保留 block，不能把这个 child 整体缓存。
      walk(child, node, context, child.children.length === 1, true)
    } else if (child.type === NodeTypes.IF) {
      for (let i = 0; i < child.branches.length; i++) {
        // 每个 v-if 分支的单 child 是分支 block，同样不能整体缓存。
        walk(
          child.branches[i],
          node,
          context,
          child.branches[i].children.length === 1,
          inFor,
        )
      }
    }
  }

  let cachedAsArray = false
  if (toCache.length === children.length && node.type === NodeTypes.ELEMENT) {
    if (
      node.tagType === ElementTypes.ELEMENT &&
      node.codegenNode &&
      node.codegenNode.type === NodeTypes.VNODE_CALL &&
      isArray(node.codegenNode.children)
    ) {
      // 原生元素全部 children 静态时，缓存整个数组而非逐项缓存。
      node.codegenNode.children = getCacheExpression(
        createArrayExpression(node.codegenNode.children),
      )
      cachedAsArray = true
    } else if (
      node.tagType === ElementTypes.COMPONENT &&
      node.codegenNode &&
      node.codegenNode.type === NodeTypes.VNODE_CALL &&
      node.codegenNode.children &&
      !isArray(node.codegenNode.children) &&
      node.codegenNode.children.type === NodeTypes.JS_OBJECT_EXPRESSION
    ) {
      // 组件默认插槽返回数组全部静态，可缓存该返回数组。
      const slot = getSlotNode(node.codegenNode, 'default')
      if (slot) {
        slot.returns = getCacheExpression(
          createArrayExpression(slot.returns as TemplateChildNode[]),
        )
        cachedAsArray = true
      }
    } else if (
      node.tagType === ElementTypes.TEMPLATE &&
      parent &&
      parent.type === NodeTypes.ELEMENT &&
      parent.tagType === ElementTypes.COMPONENT &&
      parent.codegenNode &&
      parent.codegenNode.type === NodeTypes.VNODE_CALL &&
      parent.codegenNode.children &&
      !isArray(parent.codegenNode.children) &&
      parent.codegenNode.children.type === NodeTypes.JS_OBJECT_EXPRESSION
    ) {
      // `<template #name>` 具名插槽同理，需从父组件 slots 对象找到对应函数。
      const slotName = findDir(node, 'slot', true)
      const slot =
        slotName &&
        slotName.arg &&
        getSlotNode(parent.codegenNode, slotName.arg)
      if (slot) {
        slot.returns = getCacheExpression(
          createArrayExpression(slot.returns as TemplateChildNode[]),
        )
        cachedAsArray = true
      }
    }
  }

  if (!cachedAsArray) {
    for (const child of toCache) {
      child.codegenNode = context.cache(child.codegenNode!)
    }
  }

  /**
   * 创建数组缓存并要求每次读取时浅拷贝。
   *
   * #6978/#7138/#7114：v-for 内复用同一个缓存 children 数组时，挂载第一项会原地替换/克隆
   * 数组元素，后续迭代与 HMR 读到已变异 VNode，出现列表缺项或只更新部分静态内容。
   * #13221 相关内存泄漏：mountChildren 会把缓存 VNode 替换为绑定 DOM `el` 的克隆；若写回
   * 长寿命缓存数组，卸载后 DOM 引用仍被缓存持有。读取时 `[...cached]` 可隔离这些变异。
   */
  function getCacheExpression(value: JSChildNode): CacheExpression {
    const exp = context.cache(value)
    exp.needArraySpread = true
    return exp
  }

  /** 从组件 VNode 的静态 slots 对象中查找指定插槽函数。 */
  function getSlotNode(
    node: VNodeCall,
    name: string | ExpressionNode,
  ): SlotFunctionExpression | undefined {
    if (
      node.children &&
      !isArray(node.children) &&
      node.children.type === NodeTypes.JS_OBJECT_EXPRESSION
    ) {
      const slot = node.children.properties.find(
        p => p.key === name || (p.key as SimpleExpressionNode).content === name,
      )
      return slot && slot.value
    }
  }

  if (toCache.length && context.transformHoist) {
    context.transformHoist(children, context, node)
  }
}

/**
 * 计算模板节点的最低静态等级。
 * 原生元素的结果取生成 props、原始 v-bind 表达式和 children 的最小值，并在 context
 * 的 WeakMap 中缓存。组件、结构节点及多数 block 立即返回 NOT_CONSTANT；表达式直接读
 * constType，缓存表达式为 CAN_CACHE。静态 svg/foreignObject/math 且没有任何指令时，
 * 本分析还会将其 VNodeCall 降为普通 VNode，并同步调整 helper 引用计数。
 */
export function getConstantType(
  node: TemplateChildNode | SimpleExpressionNode | CacheExpression,
  context: TransformContext,
): ConstantTypes {
  const { constantCache } = context
  switch (node.type) {
    case NodeTypes.ELEMENT:
      if (node.tagType !== ElementTypes.ELEMENT) {
        return ConstantTypes.NOT_CONSTANT
      }
      const cached = constantCache.get(node)
      if (cached !== undefined) {
        return cached
      }
      const codegenNode = node.codegenNode!
      if (codegenNode.type !== NodeTypes.VNODE_CALL) {
        return ConstantTypes.NOT_CONSTANT
      }
      if (
        codegenNode.isBlock &&
        node.tag !== 'svg' &&
        node.tag !== 'foreignObject' &&
        node.tag !== 'math'
      ) {
        return ConstantTypes.NOT_CONSTANT
      }
      if (codegenNode.patchFlag === undefined) {
        let returnType = ConstantTypes.CAN_STRINGIFY

        // 1. 无 patchFlag 不等于绝对静态。编译器注入 key、缓存处理器等 codegen props
        // 仍可能引用 v-for/v-slot 局部变量，必须检查生成后的 props。
        const generatedPropsType = getGeneratedPropsConstantType(node, context)
        if (generatedPropsType === ConstantTypes.NOT_CONSTANT) {
          constantCache.set(node, ConstantTypes.NOT_CONSTANT)
          return ConstantTypes.NOT_CONSTANT
        }
        if (generatedPropsType < returnType) {
          returnType = generatedPropsType
        }

        // 2. 任一 child 的静态等级都会限制父元素。
        for (let i = 0; i < node.children.length; i++) {
          const childType = getConstantType(node.children[i], context)
          if (childType === ConstantTypes.NOT_CONSTANT) {
            constantCache.set(node, ConstantTypes.NOT_CONSTANT)
            return ConstantTypes.NOT_CONSTANT
          }
          if (childType < returnType) {
            returnType = childType
          }
        }

        // 3. 若尚高于最低非零等级，再检查源码 v-bind 表达式。无 patchFlag 已保证可跳过 patch，
        // 这里判断它是否还能缓存或字符串化。
        if (returnType > ConstantTypes.CAN_SKIP_PATCH) {
          for (let i = 0; i < node.props.length; i++) {
            const p = node.props[i]
            if (p.type === NodeTypes.DIRECTIVE && p.name === 'bind' && p.exp) {
              const expType = getConstantType(p.exp, context)
              if (expType === ConstantTypes.NOT_CONSTANT) {
                constantCache.set(node, ConstantTypes.NOT_CONSTANT)
                return ConstantTypes.NOT_CONSTANT
              }
              if (expType < returnType) {
                returnType = expType
              }
            }
          }
        }

        // 走到这里的 block 通常是 svg/foreignObject/math。完全静态且没有任何指令时没有动态后代，
        // 可降级为普通 VNode，并同步撤销/登记 helper，减少 openBlock 开销。
        if (codegenNode.isBlock) {
          // 此分支保守排除所有 DIRECTIVE；包括 v-bind，并不限于自定义指令。
          for (let i = 0; i < node.props.length; i++) {
            const p = node.props[i]
            if (p.type === NodeTypes.DIRECTIVE) {
              constantCache.set(node, ConstantTypes.NOT_CONSTANT)
              return ConstantTypes.NOT_CONSTANT
            }
          }

          context.removeHelper(OPEN_BLOCK)
          context.removeHelper(
            getVNodeBlockHelper(context.inSSR, codegenNode.isComponent),
          )
          codegenNode.isBlock = false
          context.helper(getVNodeHelper(context.inSSR, codegenNode.isComponent))
        }

        constantCache.set(node, returnType)
        return returnType
      } else {
        constantCache.set(node, ConstantTypes.NOT_CONSTANT)
        return ConstantTypes.NOT_CONSTANT
      }
    case NodeTypes.TEXT:
    case NodeTypes.COMMENT:
      return ConstantTypes.CAN_STRINGIFY
    case NodeTypes.IF:
    case NodeTypes.FOR:
    case NodeTypes.IF_BRANCH:
      return ConstantTypes.NOT_CONSTANT
    case NodeTypes.INTERPOLATION:
    case NodeTypes.TEXT_CALL:
      return getConstantType(node.content, context)
    case NodeTypes.SIMPLE_EXPRESSION:
      return node.constType
    case NodeTypes.COMPOUND_EXPRESSION:
      let returnType = ConstantTypes.CAN_STRINGIFY
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        if (isString(child) || isSymbol(child)) {
          continue
        }
        const childType = getConstantType(child, context)
        if (childType === ConstantTypes.NOT_CONSTANT) {
          return ConstantTypes.NOT_CONSTANT
        } else if (childType < returnType) {
          returnType = childType
        }
      }
      return returnType
    case NodeTypes.JS_CACHE_EXPRESSION:
      return ConstantTypes.CAN_CACHE
    default:
      if (__DEV__) {
        const exhaustiveCheck: never = node
        exhaustiveCheck
      }
      return ConstantTypes.NOT_CONSTANT
  }
}

/** 静态提升后仍允许调用的纯归一化 helper。 */
const allowHoistedHelperSet = new Set([
  NORMALIZE_CLASS,
  NORMALIZE_STYLE,
  NORMALIZE_PROPS,
  GUARD_REACTIVE_PROPS,
])

/**
 * 仅识别白名单 Symbol helper，沿第一个参数递归读取 simple expression 的常量等级。
 * 不接受任意函数、对象 AST 或 compound 参数；其余形态返回 NOT_CONSTANT。
 */
function getConstantTypeOfHelperCall(
  value: CallExpression,
  context: TransformContext,
): ConstantTypes {
  if (
    value.type === NodeTypes.JS_CALL_EXPRESSION &&
    !isString(value.callee) &&
    allowHoistedHelperSet.has(value.callee)
  ) {
    const arg = value.arguments[0] as JSChildNode
    if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
      return getConstantType(arg, context)
    } else if (arg.type === NodeTypes.JS_CALL_EXPRESSION) {
      // 支持 `normalizeProps(guardReactiveProps(exp))` 多层纯 helper 包装。
      return getConstantTypeOfHelperCall(arg, context)
    }
  }
  return ConstantTypes.NOT_CONSTANT
}

/**
 * 计算生成对象 props 的键和值的最低常量等级；值只支持 simple expression 或白名单 helper。
 * 无 props 或非对象形态保留初始 CAN_STRINGIFY，不表示已经分析任意调用/整体绑定；
 * 外层 getConstantType 还结合 patchFlag、原始绑定与 children 判断能否缓存。
 */
function getGeneratedPropsConstantType(
  node: PlainElementNode,
  context: TransformContext,
): ConstantTypes {
  let returnType = ConstantTypes.CAN_STRINGIFY
  const props = getNodeProps(node)
  if (props && props.type === NodeTypes.JS_OBJECT_EXPRESSION) {
    const { properties } = props
    for (let i = 0; i < properties.length; i++) {
      const { key, value } = properties[i]
      const keyType = getConstantType(key, context)
      if (keyType === ConstantTypes.NOT_CONSTANT) {
        return keyType
      }
      if (keyType < returnType) {
        returnType = keyType
      }
      let valueType: ConstantTypes
      if (value.type === NodeTypes.SIMPLE_EXPRESSION) {
        valueType = getConstantType(value, context)
      } else if (value.type === NodeTypes.JS_CALL_EXPRESSION) {
        // compiler 生成的 normalizeProps/normalizeClass 等纯 helper 可随参数一起提升。
        valueType = getConstantTypeOfHelperCall(value, context)
      } else {
        valueType = ConstantTypes.NOT_CONSTANT
      }
      if (valueType === ConstantTypes.NOT_CONSTANT) {
        return valueType
      }
      if (valueType < returnType) {
        returnType = valueType
      }
    }
  }
  return returnType
}

/** 从原生元素 codegenNode 读取最终 props 表达式。 */
function getNodeProps(node: PlainElementNode) {
  const codegenNode = node.codegenNode!
  if (codegenNode.type === NodeTypes.VNODE_CALL) {
    return codegenNode.props
  }
}
