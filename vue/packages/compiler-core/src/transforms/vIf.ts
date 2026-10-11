import {
  type NodeTransform,
  type TransformContext,
  createStructuralDirectiveTransform,
  traverseNode,
} from '../transform'
import {
  type AttributeNode,
  type BlockCodegenNode,
  type CacheExpression,
  ConstantTypes,
  type DirectiveNode,
  type ElementNode,
  ElementTypes,
  type IfBranchNode,
  type IfConditionalExpression,
  type IfNode,
  type MemoExpression,
  NodeTypes,
  type SimpleExpressionNode,
  convertToBlock,
  createCallExpression,
  createConditionalExpression,
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
  createVNodeCall,
  locStub,
} from '../ast'
import { ErrorCodes, createCompilerError } from '../errors'
import { processExpression } from './transformExpression'
import { validateBrowserExpression } from '../validateExpression'
import { cloneLoc } from '../parser'
import { CREATE_COMMENT, FRAGMENT } from '../runtimeHelpers'
import {
  findDir,
  findProp,
  getMemoedVNodeCall,
  injectProp,
  isCommentOrWhitespace,
} from '../utils'
import { PatchFlags } from '@vue/shared'

/**
 * 客户端 `v-if / v-else-if / v-else` 结构指令转换器。
 *
 * 相邻分支先由 {@link processIf} 合并成一个 IfNode；退出节点时再把分支链生成嵌套的
 * JS 条件表达式，并给每个分支注入稳定且互不重复的 key。
 */
export const transformIf: NodeTransform = createStructuralDirectiveTransform(
  /^(?:if|else|else-if)$/,
  (node, dir, context) => {
    return processIf(node, dir, context, (ifNode, branch, isRoot) => {
      // #1587：同一父节点下的多组 v-if 最终都渲染在相同深度。若每组都从 key=0
      // 重新编号，运行时可能把后一组的分支误认为前一组的旧 VNode 并错误复用。
      // 因此这里累计前面所有 IfNode 的分支数量，为当前分支生成父级范围内唯一的 key。
      const siblings = context.parent!.children
      let i = siblings.indexOf(ifNode)
      let key = 0
      while (i-- >= 0) {
        const sibling = siblings[i]
        if (sibling && sibling.type === NodeTypes.IF) {
          key += sibling.branches.length
        }
      }

      // 等分支子树完成转换后再生成 codegenNode，此时才能取得子元素的 VNodeCall。
      return () => {
        if (isRoot) {
          ifNode.codegenNode = createCodegenNodeForBranch(
            branch,
            key,
            context,
          ) as IfConditionalExpression
        } else {
          // 后续 else(-if) 分支接到已有条件表达式最深处的 alternate 上。
          const parentCondition = getParentCondition(ifNode.codegenNode!)
          parentCondition.alternate = createCodegenNodeForBranch(
            branch,
            key + ifNode.branches.length - 1,
            context,
          )
        }
      }
    })
  },
)

/**
 * 将单个条件指令归并到目标无关的 IfNode 中。
 *
 * `v-if` 创建根节点；`v-else-if` 与 `v-else` 向前寻找相邻 IfNode 并追加分支。
 * 客户端和 SSR 共用分支归并逻辑，实际代码生成通过 `processCodegen` 定制。
 * 缺失条件经返回式 onError 恢复成 true。无法找到相邻 IfNode 时保留原元素供后续转换；
 * 若在最终 else 后继续追加分支，返回式处理器报告后仍会追加这个不可达分支。
 */
export function processIf(
  node: ElementNode,
  dir: DirectiveNode,
  context: TransformContext,
  processCodegen?: (
    node: IfNode,
    branch: IfBranchNode,
    isRoot: boolean,
  ) => (() => void) | undefined,
): (() => void) | undefined {
  if (
    dir.name !== 'else' &&
    (!dir.exp || !(dir.exp as SimpleExpressionNode).content.trim())
  ) {
    const loc = dir.exp ? dir.exp.loc : node.loc
    context.onError(
      createCompilerError(ErrorCodes.X_V_IF_NO_EXPRESSION, dir.loc),
    )
    dir.exp = createSimpleExpression(`true`, false, loc)
  }

  if (!__BROWSER__ && context.prefixIdentifiers && dir.exp) {
    // v-if 转换早于通用表达式转换，此刻 dir.exp 必然仍是简单表达式，需在此主动处理。
    dir.exp = processExpression(dir.exp as SimpleExpressionNode, context)
  }

  if (__DEV__ && __BROWSER__ && dir.exp) {
    validateBrowserExpression(dir.exp as SimpleExpressionNode, context)
  }

  if (dir.name === 'if') {
    const branch = createIfBranch(node, dir)
    const ifNode: IfNode = {
      type: NodeTypes.IF,
      loc: cloneLoc(node.loc),
      branches: [branch],
    }
    context.replaceNode(ifNode)
    if (processCodegen) {
      return processCodegen(ifNode, branch, true)
    }
  } else {
    // 向前寻找相邻 v-if。注释与纯空白不打断分支链，但要先从原兄弟列表移除。
    const siblings = context.parent!.children
    const comments = []
    let i = siblings.indexOf(node)
    while (i-- >= -1) {
      const sibling = siblings[i]
      if (sibling && isCommentOrWhitespace(sibling)) {
        context.removeNode(sibling)
        if (__DEV__ && sibling.type === NodeTypes.COMMENT) {
          comments.unshift(sibling)
        }
        continue
      }

      if (sibling && sibling.type === NodeTypes.IF) {
        // 无条件 v-else 后的分支不可达，先报告相邻分支错误；默认处理器抛出，返回式处理器继续归并。
        if (
          (dir.name === 'else-if' || dir.name === 'else') &&
          sibling.branches[sibling.branches.length - 1].condition === undefined
        ) {
          context.onError(
            createCompilerError(ErrorCodes.X_V_ELSE_NO_ADJACENT_IF, node.loc),
          )
        }

        // 当前元素将成为 IfNode 的一个分支，因此从父节点原 children 中移除。
        context.removeNode()
        const branch = createIfBranch(node, dir)
        if (
          __DEV__ &&
          comments.length &&
          // #3619：通常保留分支间注释；但 Transition 要求可判定的单个有效子节点，
          // 把这些注释塞回分支会干扰其子节点分析，所以该场景忽略注释。
          !(
            context.parent &&
            context.parent.type === NodeTypes.ELEMENT &&
            (context.parent.tag === 'transition' ||
              context.parent.tag === 'Transition')
          )
        ) {
          branch.children = [...comments, ...branch.children]
        }

        // 用户显式给不同分支相同 key 会强制运行时复用本应替换的节点，必须报错。
        if (__DEV__ || !__BROWSER__) {
          const key = branch.userKey
          if (key) {
            sibling.branches.forEach(({ userKey }) => {
              if (isSameKey(userKey, key)) {
                context.onError(
                  createCompilerError(
                    ErrorCodes.X_V_IF_SAME_KEY,
                    branch.userKey!.loc,
                  ),
                )
              }
            })
          }
        }

        sibling.branches.push(branch)
        const onExit = processCodegen && processCodegen(sibling, branch, false)
        // 分支元素已从原 children 中移除，父级遍历不会再遇到它，必须在这里主动遍历。
        traverseNode(branch, context)
        // 主动遍历也要配对调用退出逻辑，才能完成子树 codegen。
        if (onExit) onExit()
        // 告诉外层遍历器：原位置的当前节点已被合并并移除，不要继续按普通节点处理。
        context.currentNode = null
      } else {
        context.onError(
          createCompilerError(ErrorCodes.X_V_ELSE_NO_ADJACENT_IF, node.loc),
        )
      }
      break
    }
  }
}

/** 创建一个条件分支；非 `v-for` 的 `<template v-if>` 会被展开为其子节点。 */
function createIfBranch(node: ElementNode, dir: DirectiveNode): IfBranchNode {
  const isTemplateIf = node.tagType === ElementTypes.TEMPLATE
  return {
    type: NodeTypes.IF_BRANCH,
    loc: node.loc,
    condition: dir.name === 'else' ? undefined : dir.exp,
    children: isTemplateIf && !findDir(node, 'for') ? node.children : [node],
    userKey: findProp(node, `key`),
    isTemplateIf,
  }
}

/**
 * 为单个条件分支生成条件表达式。
 * 假分支先用 block 形式的注释节点占位，以保持分支切换时 block 栈与 DOM 锚点稳定。
 */
function createCodegenNodeForBranch(
  branch: IfBranchNode,
  keyIndex: number,
  context: TransformContext,
): IfConditionalExpression | BlockCodegenNode | MemoExpression {
  if (branch.condition) {
    return createConditionalExpression(
      branch.condition,
      createChildrenCodegenNode(branch, keyIndex, context),
      // 第二个参数 `true` 表示按 block 创建注释占位节点，使当前条件 block 正确闭合。
      createCallExpression(context.helper(CREATE_COMMENT), [
        __DEV__ ? '"v-if"' : '""',
        'true',
      ]),
    ) as IfConditionalExpression
  } else {
    return createChildrenCodegenNode(branch, keyIndex, context)
  }
}

/**
 * 生成一个分支为真时的 VNode，并注入由编译器分配的分支 key。
 * 多根分支用 Fragment 包裹；单根分支则复用已有 VNodeCall 并提升为 block。
 */
function createChildrenCodegenNode(
  branch: IfBranchNode,
  keyIndex: number,
  context: TransformContext,
): BlockCodegenNode | MemoExpression {
  const { helper } = context
  const keyProperty = createObjectProperty(
    `key`,
    createSimpleExpression(
      `${keyIndex}`,
      false,
      locStub,
      ConstantTypes.CAN_CACHE,
    ),
  )
  const { children } = branch
  const firstChild = children[0]
  const needFragmentWrapper =
    children.length !== 1 || firstChild.type !== NodeTypes.ELEMENT
  if (needFragmentWrapper) {
    if (children.length === 1 && firstChild.type === NodeTypes.FOR) {
      // v-if 分支只有一个 ForNode 时复用 v-for 已有 Fragment，避免 Fragment 嵌套。
      const vnodeCall = firstChild.codegenNode!
      injectProp(vnodeCall, keyProperty, context)
      return vnodeCall
    } else {
      let patchFlag = PatchFlags.STABLE_FRAGMENT
      // 开发模式下，若 Fragment 实际只有一个非注释根，标记 DEV_ROOT_FRAGMENT。
      // 运行时可在保留注释节点的同时，仍把该有效节点作为组件根处理 attrs 等行为。
      if (
        __DEV__ &&
        !branch.isTemplateIf &&
        children.filter(c => c.type !== NodeTypes.COMMENT).length === 1
      ) {
        patchFlag |= PatchFlags.DEV_ROOT_FRAGMENT
      }

      return createVNodeCall(
        context,
        helper(FRAGMENT),
        createObjectExpression([keyProperty]),
        children,
        patchFlag,
        undefined,
        undefined,
        true,
        false,
        false /* 非组件 */,
        branch.loc,
      )
    }
  } else {
    const ret = (firstChild as ElementNode).codegenNode as
      BlockCodegenNode | MemoExpression
    const vnodeCall = getMemoedVNodeCall(ret)
    // 条件分支根必须是 block，切换分支时运行时才能正确追踪整棵动态子树。
    if (vnodeCall.type === NodeTypes.VNODE_CALL) {
      convertToBlock(vnodeCall, context)
    }
    // key 区分不同分支，避免标签相同时把旧分支 DOM 错误地就地 patch 成新分支。
    injectProp(vnodeCall, keyProperty, context)
    return ret
  }
}

/** 判断两个分支上用户显式提供的静态或动态 key 是否相同。 */
function isSameKey(
  a: AttributeNode | DirectiveNode | undefined,
  b: AttributeNode | DirectiveNode,
): boolean {
  if (!a || a.type !== b.type) {
    return false
  }
  if (a.type === NodeTypes.ATTRIBUTE) {
    if (a.value!.content !== (b as AttributeNode).value!.content) {
      return false
    }
  } else {
    // 动态 `:key` 只有表达式类型、静态性和源码内容均相同，才视为重复。
    const exp = a.exp!
    const branchExp = (b as DirectiveNode).exp!
    if (exp.type !== branchExp.type) {
      return false
    }
    if (
      exp.type !== NodeTypes.SIMPLE_EXPRESSION ||
      exp.isStatic !== (branchExp as SimpleExpressionNode).isStatic ||
      exp.content !== (branchExp as SimpleExpressionNode).content
    ) {
      return false
    }
  }
  return true
}

/** 沿条件表达式/缓存表达式向下找到最后一个可接续的 alternate。 */
function getParentCondition(
  node: IfConditionalExpression | CacheExpression,
): IfConditionalExpression {
  while (true) {
    if (node.type === NodeTypes.JS_CONDITIONAL_EXPRESSION) {
      if (node.alternate.type === NodeTypes.JS_CONDITIONAL_EXPRESSION) {
        node = node.alternate
      } else {
        return node
      }
    } else if (node.type === NodeTypes.JS_CACHE_EXPRESSION) {
      node = node.value as IfConditionalExpression
    }
  }
}
