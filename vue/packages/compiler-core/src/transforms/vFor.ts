import {
  type NodeTransform,
  type TransformContext,
  createStructuralDirectiveTransform,
} from '../transform'
import {
  type BlockCodegenNode,
  ConstantTypes,
  type DirectiveNode,
  type ElementNode,
  type ExpressionNode,
  type ForCodegenNode,
  type ForIteratorExpression,
  type ForNode,
  type ForParseResult,
  type ForRenderListExpression,
  NodeTypes,
  type PlainElementNode,
  type RenderSlotCall,
  type SimpleExpressionNode,
  type SlotOutletNode,
  type VNodeCall,
  createBlockStatement,
  createCallExpression,
  createCompoundExpression,
  createFunctionExpression,
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
  createVNodeCall,
  getVNodeBlockHelper,
  getVNodeHelper,
} from '../ast'
import { ErrorCodes, createCompilerError } from '../errors'
import {
  findDir,
  findProp,
  injectProp,
  isSlotOutlet,
  isTemplateNode,
} from '../utils'
import {
  FRAGMENT,
  IS_MEMO_SAME,
  OPEN_BLOCK,
  RENDER_LIST,
} from '../runtimeHelpers'
import { processExpression } from './transformExpression'
import { validateBrowserExpression } from '../validateExpression'
import { PatchFlags } from '@vue/shared'

/**
 * 客户端 `v-for` 结构指令转换器。
 *
 * `processFor()` 先把普通元素替换成 `ForNode`；当前转换器再为它生成
 * `renderList(source, iterator)` 和每轮循环对应的 VNode/Fragment。生成工作被拆成
 * “进入节点”和“退出节点”两段，是因为必须等子节点完成转换后，才能取得它们的
 * `codegenNode`。
 */
export const transformFor: NodeTransform = createStructuralDirectiveTransform(
  'for',
  (node, dir, context) => {
    const { helper, removeHelper } = context
    return processFor(node, dir, context, forNode => {
      // 先创建 renderList(source)；循环回调要等子节点遍历完、生成 codegenNode 后再补入。
      const renderExp = createCallExpression(helper(RENDER_LIST), [
        forNode.source,
      ]) as ForRenderListExpression
      const isTemplate = isTemplateNode(node)
      const memo = findDir(node, 'memo')
      const keyProp = findProp(node, `key`, false, true)
      const isDirKey = keyProp && keyProp.type === NodeTypes.DIRECTIVE
      let keyExp =
        keyProp &&
        (keyProp.type === NodeTypes.ATTRIBUTE
          ? keyProp.value
            ? createSimpleExpression(keyProp.value.content, true)
            : undefined
          : keyProp.exp)

      const keyProperty = keyExp ? createObjectProperty(`key`, keyExp) : null

      if (!__BROWSER__) {
        // #2085 / #5288：`<template v-for>` 只是结构容器，替换为 ForNode 后不会再由
        // 普通元素转换流程访问，因此写在它上面的 `:key` 与 `v-memo` 表达式必须在这里
        // 手动处理。否则开启 prefixIdentifiers 后，其中的变量不会被补成 `_ctx.xxx`，
        // 还可能错误地把循环局部变量当成组件上下文属性。
        if (isTemplate && memo) {
          memo.exp = processExpression(
            memo.exp! as SimpleExpressionNode,
            context,
          )
        }
        if ((isTemplate || memo) && keyProperty && isDirKey) {
          keyExp =
            keyProp.exp =
            keyProperty.value =
              processExpression(
                keyProperty.value as SimpleExpressionNode,
                context,
              )
          if (memo) {
            context.vForMemoKeyedNodes.add(node)
          }
        }
      }

      const isStableFragment =
        forNode.source.type === NodeTypes.SIMPLE_EXPRESSION &&
        forNode.source.constType > ConstantTypes.NOT_CONSTANT
      const fragmentFlag = isStableFragment
        ? PatchFlags.STABLE_FRAGMENT
        : keyProp
          ? PatchFlags.KEYED_FRAGMENT
          : PatchFlags.UNKEYED_FRAGMENT

      forNode.codegenNode = createVNodeCall(
        context,
        helper(FRAGMENT),
        undefined,
        renderExp,
        fragmentFlag,
        undefined,
        undefined,
        true /* isBlock */,
        !isStableFragment /* disableTracking */,
        false /* isComponent */,
        node.loc,
      ) as ForCodegenNode

      // 源为编译期常量时，列表长度和顺序稳定；否则根据是否提供 key 选择 keyed/unkeyed
      // diff。这一标记属于“整个列表 Fragment”，并不取代单项 VNode 自身的 patchFlag。
      return () => {
        // 子节点均已完成转换，此时组装每轮循环返回的 childBlock。
        let childBlock: BlockCodegenNode
        const { children } = forNode

        // `<template v-for>` 的 key 必须写在 template 本身。写到其子元素会导致多根节点
        // 无法共享同一个迭代 key，因此在开发或非浏览器编译器中给出明确错误。
        if ((__DEV__ || !__BROWSER__) && isTemplate) {
          node.children.some(c => {
            if (c.type === NodeTypes.ELEMENT) {
              const key = findProp(c, 'key')
              if (key) {
                context.onError(
                  createCompilerError(
                    ErrorCodes.X_V_FOR_TEMPLATE_KEY_PLACEMENT,
                    key.loc,
                  ),
                )
                return true
              }
            }
          })
        }

        const needFragmentWrapper =
          children.length !== 1 || children[0].type !== NodeTypes.ELEMENT
        const slotOutlet = isSlotOutlet(node)
          ? node
          : isTemplate &&
              node.children.length === 1 &&
              isSlotOutlet(node.children[0])
            ? (node.children[0] as SlotOutletNode) // api-extractor somehow fails to infer this
            : null

        if (slotOutlet) {
          // `<slot v-for>` 或 `<template v-for><slot/></template>` 已生成 renderSlot()，
          // 直接复用，避免外面再包一层无意义的 Fragment。
          childBlock = slotOutlet.codegenNode as RenderSlotCall
          if (isTemplate && keyProperty) {
            // template 上的 key 要注入 renderSlot() 的第三个参数（slot props），这样运行时
            // 才能按迭代项识别插槽输出。
            injectProp(childBlock, keyProperty, context)
          }
        } else if (needFragmentWrapper) {
          // 每轮产生文本或多个根节点时，用一个稳定 Fragment 把“这一轮的结果”包起来。
          childBlock = createVNodeCall(
            context,
            helper(FRAGMENT),
            keyProperty ? createObjectExpression([keyProperty]) : undefined,
            node.children,
            PatchFlags.STABLE_FRAGMENT,
            undefined,
            undefined,
            true,
            undefined,
            false /* isComponent */,
          )
        } else {
          // 单个普通元素可直接作为循环返回值。动态列表中的每项通常必须是 block，
          // 以便运行时正确收集动态子节点；常量来源则允许保留普通 VNode 快速路径。
          childBlock = (children[0] as PlainElementNode)
            .codegenNode as VNodeCall
          if (isTemplate && keyProperty) {
            injectProp(childBlock, keyProperty, context)
          }
          const shouldUseBlock =
            !isStableFragment || childBlock.isBlockRequired === true
          if (childBlock.isBlock !== shouldUseBlock) {
            if (childBlock.isBlock) {
              // 从 block 降为普通 VNode：撤销先前登记的 block helper。
              removeHelper(OPEN_BLOCK)
              removeHelper(
                getVNodeBlockHelper(context.inSSR, childBlock.isComponent),
              )
            } else {
              // 从普通 VNode 升为 block：撤销普通 createVNode helper。
              removeHelper(
                getVNodeHelper(context.inSSR, childBlock.isComponent),
              )
            }
          }
          childBlock.isBlock = shouldUseBlock
          if (childBlock.isBlock) {
            helper(OPEN_BLOCK)
            helper(getVNodeBlockHelper(context.inSSR, childBlock.isComponent))
          } else {
            helper(getVNodeHelper(context.inSSR, childBlock.isComponent))
            if (childBlock.needsPatch) {
              childBlock.patchFlag = ((childBlock.patchFlag ?? 0) |
                PatchFlags.NEED_PATCH) as PatchFlags
            }
          }
        }

        if (memo) {
          // v-memo 的循环回调还会接收上次缓存项。key 相同且依赖数组未变化时直接复用
          // 旧 VNode；否则生成新项、记录 memo，再由 renderList 写回编译缓存槽。
          const loop = createFunctionExpression(
            createForLoopParams(forNode.parseResult, [
              createSimpleExpression(`_cached`),
            ]),
          )
          loop.body = createBlockStatement([
            createCompoundExpression([`const _memo = (`, memo.exp!, `)`]),
            createCompoundExpression([
              `if (_cached && _cached.el`,
              ...(keyExp ? [` && _cached.key === `, keyExp] : []),
              ` && ${context.helperString(
                IS_MEMO_SAME,
              )}(_cached, _memo)) return _cached`,
            ]),
            createCompoundExpression([`const _item = `, childBlock as any]),
            createSimpleExpression(`_item.memo = _memo`),
            createSimpleExpression(`return _item`),
          ])
          renderExp.arguments.push(
            loop as ForIteratorExpression,
            createSimpleExpression(`_cache`),
            createSimpleExpression(String(context.cached.length)),
          )
          // 为本次 v-memo 占用一个新的 render cache 下标。
          context.cached.push(null)
        } else {
          renderExp.arguments.push(
            createFunctionExpression(
              createForLoopParams(forNode.parseResult),
              childBlock,
              true /* force newline */,
            ) as ForIteratorExpression,
          )
        }
      }
    })
  },
)

/**
 * 把带 `v-for` 的元素替换成目标无关的 {@link ForNode}。
 *
 * 客户端与 SSR 编译器共用这一步：它负责校验表达式、建立循环别名作用域并安排
 * 退出回调；具体怎样生成客户端 VNode 或 SSR 字符串，由 `processCodegen` 注入。
 *
 * @returns 节点退出时执行的清理函数；表达式非法时返回 `undefined`
 */
export function processFor(
  node: ElementNode,
  dir: DirectiveNode,
  context: TransformContext,
  processCodegen?: (forNode: ForNode) => (() => void) | undefined,
): (() => void) | undefined {
  if (!dir.exp) {
    context.onError(
      createCompilerError(ErrorCodes.X_V_FOR_NO_EXPRESSION, dir.loc),
    )
    return
  }

  const parseResult = dir.forParseResult

  if (!parseResult) {
    context.onError(
      createCompilerError(ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION, dir.loc),
    )
    return
  }

  finalizeForParseResult(parseResult, context)

  const { addIdentifiers, removeIdentifiers, scopes } = context
  const { source, value, key, index } = parseResult

  const forNode: ForNode = {
    type: NodeTypes.FOR,
    loc: dir.loc,
    source,
    valueAlias: value,
    keyAlias: key,
    objectIndexAlias: index,
    parseResult,
    children: isTemplateNode(node) ? node.children : [node],
  }

  context.replaceNode(forNode)

  // 进入循环作用域。表达式转换器看到这些别名后，不会把 item/key/index 补成 `_ctx.*`。
  scopes.vFor++
  if (!__BROWSER__ && context.prefixIdentifiers) {
    // 浏览器外构建会做精确标识符分析，因此要登记循环声明的局部变量。
    value && addIdentifiers(value)
    key && addIdentifiers(key)
    index && addIdentifiers(index)
  }

  const onExit = processCodegen && processCodegen(forNode)

  return (): void => {
    // 离开节点时成对撤销作用域状态，防止循环别名泄漏到后续兄弟节点。
    scopes.vFor--
    if (!__BROWSER__ && context.prefixIdentifiers) {
      value && removeIdentifiers(value)
      key && removeIdentifiers(key)
      index && removeIdentifiers(index)
    }
    if (onExit) onExit()
  }
}

/**
 * 完成 `v-for` 解析结果中的表达式处理，且保证同一结果只处理一次。
 *
 * `source` 是普通读取表达式；`value/key/index` 是参数模式，允许对象解构、默认值等
 * 赋值式语法，所以传给 `processExpression` / 校验器的 `asParams` 为 `true`。
 */
export function finalizeForParseResult(
  result: ForParseResult,
  context: TransformContext,
): void {
  if (result.finalized) return

  if (!__BROWSER__ && context.prefixIdentifiers) {
    result.source = processExpression(
      result.source as SimpleExpressionNode,
      context,
    )
    if (result.key) {
      result.key = processExpression(
        result.key as SimpleExpressionNode,
        context,
        true,
      )
    }
    if (result.index) {
      result.index = processExpression(
        result.index as SimpleExpressionNode,
        context,
        true,
      )
    }
    if (result.value) {
      result.value = processExpression(
        result.value as SimpleExpressionNode,
        context,
        true,
      )
    }
  }
  if (__DEV__ && __BROWSER__) {
    validateBrowserExpression(result.source as SimpleExpressionNode, context)
    if (result.key) {
      validateBrowserExpression(
        result.key as SimpleExpressionNode,
        context,
        true,
      )
    }
    if (result.index) {
      validateBrowserExpression(
        result.index as SimpleExpressionNode,
        context,
        true,
      )
    }
    if (result.value) {
      validateBrowserExpression(
        result.value as SimpleExpressionNode,
        context,
        true,
      )
    }
  }
  result.finalized = true
}

/**
 * 按 `value, key, index` 的固定位置创建 renderList 回调参数，并可追加 v-memo 参数。
 */
export function createForLoopParams(
  { value, key, index }: ForParseResult,
  memoArgs: ExpressionNode[] = [],
): ExpressionNode[] {
  return createParamsList([value, key, index, ...memoArgs])
}

/**
 * 补齐回调参数列表中的空位。
 *
 * 例如 `(value, , index)` 不能直接生成合法 JS，因此会变成
 * `(value, __, index)`；尾部完全未使用的参数则会裁掉。
 */
function createParamsList(
  args: (ExpressionNode | undefined)[],
): ExpressionNode[] {
  let i = args.length
  while (i--) {
    if (args[i]) break
  }
  return args
    .slice(0, i + 1)
    .map((arg, i) => arg || createSimpleExpression(`_`.repeat(i + 1), false))
}
