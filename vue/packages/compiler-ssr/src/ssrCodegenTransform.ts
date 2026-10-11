import {
  type BlockStatement,
  type CallExpression,
  type CompilerError,
  type CompilerOptions,
  ElementTypes,
  type IfStatement,
  type JSChildNode,
  NodeTypes,
  type RootNode,
  type TemplateChildNode,
  type TemplateLiteral,
  createBlockStatement,
  createCallExpression,
  createCompoundExpression,
  createRoot,
  createSimpleExpression,
  createTemplateLiteral,
  createTransformContext,
  isText,
  processExpression,
} from '@vue/compiler-dom'
import { escapeHtml, isString } from '@vue/shared'
import { SSR_INTERPOLATE, ssrHelpers } from './runtimeHelpers'
import { ssrProcessIf } from './transforms/ssrVIf'
import { ssrProcessFor } from './transforms/ssrVFor'
import { ssrProcessSlotOutlet } from './transforms/ssrTransformSlotOutlet'
import { ssrProcessComponent } from './transforms/ssrTransformComponent'
import { ssrProcessElement } from './transforms/ssrTransformElement'
import { SSRErrorCodes, createSSRCompilerError } from './errors'

/**
 * 执行 SSR 第二遍转换，把模板 AST 改造成全新的 JS 语句 AST。
 *
 * SSR 与客户端产物结构完全不同：多个相邻元素/文本可合并进一次 `_push(`template`)`，
 * 无需每个元素各建 VNode。因此先保留第一遍得到的结构/表达式信息，再由本遍统一生成
 * 字符串缓冲、条件和循环语句，最后交给 core codegen。
 * ast.codegenNode 被替换为根语句体；原 ast.helpers 按导出来源分流为 helpers/ssrHelpers。
 * 已经完成的表达式改写在本遍保留，不再把每个输出表达式当模板重新解析。
 */
export function ssrCodegenTransform(
  ast: RootNode,
  options: CompilerOptions,
): void {
  const context = createSSRTransformContext(ast, options)

  // SFC CSS vars 先求值为局部 `_cssVars`，而不是在每个根节点属性中内联表达式，确保一次
  // SSR render 只读取一次响应式值，各根/分支输出也保持一致。
  if (options.ssrCssVars) {
    const cssContext = createTransformContext(createRoot([]), options)
    const varsExp = processExpression(
      createSimpleExpression(options.ssrCssVars, false),
      cssContext,
    )
    context.body.push(
      createCompoundExpression([`const _cssVars = { style: `, varsExp, `}`]),
    )
    Array.from(cssContext.helpers.keys()).forEach(helper => {
      ast.helpers.add(helper)
    })
  }

  const isFragment =
    ast.children.length > 1 && ast.children.some(c => !isText(c))
  processChildren(ast, context, isFragment)
  ast.codegenNode = createBlockStatement(context.body)

  // helper 分流：SSR 专用项从 @vue/server-renderer 导入，其余通用项仍从 vue 导入。
  ast.ssrHelpers = Array.from(
    new Set([
      ...Array.from(ast.helpers).filter(h => h in ssrHelpers),
      ...context.helpers,
    ]),
  )

  ast.helpers = new Set(Array.from(ast.helpers).filter(h => !(h in ssrHelpers)))
}

/** SSR 第二遍转换的输出缓冲、helper 与错误上下文。 */
export interface SSRTransformContext {
  /** 当前编译的模板根节点。 */
  root: RootNode
  /** SSR 编译选项，子上下文与根共享。 */
  options: CompilerOptions
  /** 当前函数体内按顺序生成的 `_push` 调用与控制流语句。 */
  body: (JSChildNode | IfStatement)[]
  /** 当前及所有子上下文使用的 server-renderer helper。 */
  helpers: Set<symbol>
  /** 插槽函数是否需要接收并向下传递 `_scopeId`。 */
  withSlotScopeId: boolean
  /** 用户 onError 或默认抛错函数；收集模式不会把无效 AST 自动修复为合法节点。 */
  onError: (error: CompilerError) => void
  /** 登记并返回一个 SSR helper。 */
  helper<T extends symbol>(name: T): T
  /** 向当前 `_push` 模板字面量追加静态或动态片段。 */
  pushStringPart(part: TemplateLiteral['elements'][0]): void
  /** 结束当前字符串缓冲并追加独立控制流/helper 调用。 */
  pushStatement(statement: IfStatement | CallExpression): void
}

/**
 * 创建一个独立语句体及其字符串编译缓冲。
 * helpers 可与父上下文共享，但 body/currentString 必须独立，否则不同条件/插槽函数体
 * 的片段会串入同一 _push。currentString 是 JS AST TemplateLiteral，不是运行时 SSRBuffer。
 */
function createSSRTransformContext(
  root: RootNode,
  options: CompilerOptions,
  helpers: Set<symbol> = new Set(),
  withSlotScopeId = false,
): SSRTransformContext {
  const body: BlockStatement['body'] = []
  let currentString: TemplateLiteral | null = null

  return {
    root,
    options,
    body,
    helpers,
    withSlotScopeId,
    onError:
      options.onError ||
      (e => {
        throw e
      }),
    /** 登记 SSR helper，子上下文共享同一集合。 */
    helper<T extends symbol>(name: T): T {
      helpers.add(name)
      return name
    },
    /** 追加 `_push` 片段；相邻静态字符串会原地合并。 */
    pushStringPart(part) {
      if (!currentString) {
        const currentCall = createCallExpression(`_push`)
        body.push(currentCall)
        currentString = createTemplateLiteral([])
        currentCall.arguments.push(currentString)
      }
      const bufferedElements = currentString.elements
      const lastItem = bufferedElements[bufferedElements.length - 1]
      if (isString(part) && isString(lastItem)) {
        bufferedElements[bufferedElements.length - 1] += part
      } else {
        bufferedElements.push(part)
      }
    },
    /** 关闭字符串缓冲并追加独立语句，防止控制流嵌进模板字面量。 */
    pushStatement(statement) {
      // 控制流/运行时调用不能嵌在当前字符串中，先关闭缓冲，下一片段会新建 `_push`。
      currentString = null
      body.push(statement)
    },
  }
}

/** 创建共享根、选项和 helper 集合的子输出上下文，用于条件/循环/插槽函数体。 */
function createChildContext(
  parent: SSRTransformContext,
  withSlotScopeId = parent.withSlotScopeId,
): SSRTransformContext {
  // 共享 helpers，确保子语句使用的 server-renderer helper 最终能在根统一导入。
  return createSSRTransformContext(
    parent.root,
    parent.options,
    parent.helpers,
    withSlotScopeId,
  )
}

/** 任何可由 processChildren 遍历的 AST 容器最小接口。 */
interface Container {
  /** 要按模板顺序处理的子节点。 */
  children: TemplateChildNode[]
}

/**
 * 按模板顺序把 children 转为 SSR 字符串片段或 JS 语句。
 * 多根 Fragment 用 `<!--[-->...<!--]-->` 标记边界，供客户端 hydration 精确认领。
 * @param parent - 第一遍结构转换后的节点容器；按其 children 顺序输出。
 * @param asFragment - 是否为当前容器本身添加一对边界注释。
 * @param disableNestedFragments - 传给当前层 If/For 的展平选项，供 Transition 系列使用；
 * 普通元素递归会按自己的容器规则处理，不是对所有后代的全局开关。
 * @param disableComment - 当前层跳过模板注释并抑制无 else 的条件占位，不删除 AST。
 */
export function processChildren(
  parent: Container,
  context: SSRTransformContext,
  asFragment = false,
  disableNestedFragments = false,
  disableComment = false,
): void {
  if (asFragment) {
    context.pushStringPart(`<!--[-->`)
  }
  const { children } = parent
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    switch (child.type) {
      case NodeTypes.ELEMENT:
        switch (child.tagType) {
          case ElementTypes.ELEMENT:
            ssrProcessElement(child, context)
            break
          case ElementTypes.COMPONENT:
            ssrProcessComponent(child, context, parent)
            break
          case ElementTypes.SLOT:
            ssrProcessSlotOutlet(child, context)
            break
          case ElementTypes.TEMPLATE:
            // template 通常已由结构/插槽转换消费，不应作为独立输出节点到达这里。
            break
          default:
            context.onError(
              createSSRCompilerError(
                SSRErrorCodes.X_SSR_INVALID_AST_NODE,
                (child as any).loc,
              ),
            )
            // never 赋值保证新增 ElementTypes 时 TypeScript 能提示补齐 SSR 分支。
            const exhaustiveCheck: never = child
            return exhaustiveCheck
        }
        break
      case NodeTypes.TEXT:
        context.pushStringPart(escapeHtml(child.content))
        break
      case NodeTypes.COMMENT:
        // parser 已保证 AST 注释内容合法，无需再次 HTML 转义。
        if (!disableComment) {
          context.pushStringPart(`<!--${child.content}-->`)
        }
        break
      case NodeTypes.INTERPOLATION:
        context.pushStringPart(
          createCallExpression(context.helper(SSR_INTERPOLATE), [
            child.content,
          ]),
        )
        break
      case NodeTypes.IF:
        ssrProcessIf(child, context, disableNestedFragments, disableComment)
        break
      case NodeTypes.FOR:
        ssrProcessFor(child, context, disableNestedFragments)
        break
      case NodeTypes.IF_BRANCH:
        // IfBranch 由所属 IfNode 一次性处理，不能重复输出。
        break
      case NodeTypes.TEXT_CALL:
      case NodeTypes.COMPOUND_EXPRESSION:
        // SSR 未安装 transformText，这两种客户端文本合并节点不会成为模板 child。
        break
      default:
        context.onError(
          createSSRCompilerError(
            SSRErrorCodes.X_SSR_INVALID_AST_NODE,
            (child as any).loc,
          ),
        )
        // never 赋值用于编译期穷尽检查新增 NodeTypes。
        const exhaustiveCheck: never = child
        return exhaustiveCheck
    }
  }
  if (asFragment) {
    context.pushStringPart(`<!--]-->`)
  }
}

/** 在独立子上下文中处理 children，并返回可嵌入函数/条件体的 BlockStatement。 */
export function processChildrenAsStatement(
  parent: Container,
  parentContext: SSRTransformContext,
  asFragment = false,
  withSlotScopeId: boolean = parentContext.withSlotScopeId,
): BlockStatement {
  const childContext = createChildContext(parentContext, withSlotScopeId)
  processChildren(parent, childContext, asFragment)
  return createBlockStatement(childContext.body)
}
