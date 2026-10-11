/**
 * 模板表达式转换负责两件事：
 *
 * 1. 按标识符拆成复合表达式，为每个名字保留精确 source-map 位置；
 * 2. 根据脚本绑定来源把自由变量加上 `_ctx.`、`$setup.`、`$props.` 等访问前缀。
 *
 * Node 构建使用 Babel AST 做作用域分析。浏览器运行时编译为控制体积不打包 Babel，
 * 生成函数包在 `with (_ctx)` 中，只做轻量语法校验。
 */
import type { NodeTransform, TransformContext } from '../transform'
import {
  type CompoundExpressionNode,
  ConstantTypes,
  type ExpressionNode,
  NodeTypes,
  type SimpleExpressionNode,
  createCompoundExpression,
  createSimpleExpression,
} from '../ast'
import {
  isInDestructureAssignment,
  isInNewExpression,
  isStaticProperty,
  isStaticPropertyKey,
  walkIdentifiers,
} from '../babelUtils'
import { advancePositionWithClone, findDir, isSimpleIdentifier } from '../utils'
import {
  genPropsAccessExp,
  hasOwn,
  isGloballyAllowed,
  isString,
  makeMap,
} from '@vue/shared'
import { ErrorCodes, createCompilerError } from '../errors'
import type {
  AssignmentExpression,
  Identifier,
  Node,
  UpdateExpression,
} from '@babel/types'
import { validateBrowserExpression } from '../validateExpression'
import { parseExpression } from '@babel/parser'
import { IS_REF, UNREF } from '../runtimeHelpers'
import { BindingTypes } from '../options'

/** 无需从组件上下文读取、可直接出现在模板表达式中的字面量关键字。 */
const isLiteralWhitelisted = /*@__PURE__*/ makeMap('true,false,null,this')

/**
 * 遍历插值和元素指令，把其中的表达式交给 processExpression。
 * v-for、带参数 v-on、v-slot 参数等具有特殊语法/作用域，由各自路径选择正确解析模式。
 */
export const transformExpression: NodeTransform = (node, context) => {
  if (node.type === NodeTypes.INTERPOLATION) {
    node.content = processExpression(
      node.content as SimpleExpressionNode,
      context,
    )
  } else if (node.type === NodeTypes.ELEMENT) {
    // 逐条处理元素指令表达式及动态参数。
    const memo = findDir(node, 'memo')
    for (let i = 0; i < node.props.length; i++) {
      const dir = node.props[i]
      // v-for 需先拆分 source/aliases；带参数 v-on 需区分函数引用与内联语句。
      if (dir.type === NodeTypes.DIRECTIVE && dir.name !== 'for') {
        const exp = dir.exp
        const arg = dir.arg
        // `v-on:arg` 留给 transformOn 包装 `$event`。
        if (
          exp &&
          exp.type === NodeTypes.SIMPLE_EXPRESSION &&
          !(dir.name === 'on' && arg) &&
          // `v-for + v-memo` 的 key 已在 transformFor 子作用域中处理，避免二次前缀化。
          !(
            memo &&
            context.vForMemoKeyedNodes.has(node) &&
            arg &&
            arg.type === NodeTypes.SIMPLE_EXPRESSION &&
            arg.content === 'key'
          )
        ) {
          dir.exp = processExpression(
            exp,
            context,
            // v-slot 值是函数参数/解构声明，不是普通读取表达式。
            dir.name === 'slot',
          )
        }
        if (arg && arg.type === NodeTypes.SIMPLE_EXPRESSION && !arg.isStatic) {
          dir.arg = processExpression(arg, context)
        }
      }
    }
  }
}

/** 拆分表达式时附加到 Babel Identifier 的生成元数据。 */
interface PrefixMeta {
  /** 标识符前要补的访问前缀，例如 `_ctx.` 或 `$setup.`。 */
  prefix?: string
  /** 该标识符是否来自编译期常量绑定。 */
  isConstant: boolean
  /** 标识符在表达式源码中的起始偏移。 */
  start: number
  /** 标识符在表达式源码中的结束偏移。 */
  end: number
  /** 该节点引入的函数参数/解构局部名，离开作用域时成组撤销。 */
  scopeIds?: Set<string>
}

/**
 * 解析并前缀化单个模板表达式。
 *
 * 调用方若只在 Node 端需要此函数，应把调用放在显式 `!__BROWSER__` 分支中，
 * 让 Babel parser 等 Node-only 依赖能从浏览器构建 tree-shake。浏览器分支只做开发校验。
 *
 * @param asParams 把源码放在函数参数位置解析（v-slot / v-for aliases）
 * @param asRawStatements 按可含分号的语句列表解析（v-on 内联多语句）
 * @param localVars 额外局部标识符计数表
 * @returns 原简单节点或按标识符位置拆出的复合节点；会改写 content/Babel Identifier 并登记 ref helpers。
 * node.ast 的 false 表示 parser 已报错，直接返回以避免重复诊断；无前缀或空文本也保持原节点。
 */
export function processExpression(
  node: SimpleExpressionNode,
  context: TransformContext,
  asParams = false,
  asRawStatements = false,
  localVars: Record<string, number> = Object.create(context.identifiers),
): ExpressionNode {
  if (__BROWSER__) {
    if (__DEV__) {
      // 沿用 Vue 2 风格轻量校验，不做 AST 改写。
      validateBrowserExpression(node, context, asParams, asRawStatements)
    }
    return node
  }

  if (!context.prefixIdentifiers || !node.content.trim()) {
    return node
  }

  const { inline, bindingMetadata } = context
  /** 按绑定类型和读写上下文把单个自由标识符改写为正确访问表达式。 */
  const rewriteIdentifier = (
    raw: string,
    parent?: Node | null,
    id?: Identifier,
  ) => {
    const type = hasOwn(bindingMetadata, raw) && bindingMetadata[raw]
    if (inline) {
      // 分别识别赋值左值、更新参数与解构赋值目标，读取和写入 ref 的生成方式不同。
      const isAssignmentLVal =
        parent && parent.type === 'AssignmentExpression' && parent.left === id
      const isUpdateArg =
        parent && parent.type === 'UpdateExpression' && parent.argument === id
      const isDestructureAssignment =
        parent && isInDestructureAssignment(parent, parentStack)
      const isNewExpression = parent && isInNewExpression(parentStack)
      /** 生成 unref 调用；作为 `new` callee 时额外加括号维持运算优先级。 */
      const wrapWithUnref = (raw: string) => {
        const wrapped = `${context.helperString(UNREF)}(${raw})`
        return isNewExpression ? `(${wrapped})` : wrapped
      }

      if (
        isConst(type) ||
        type === BindingTypes.SETUP_REACTIVE_CONST ||
        localVars[raw]
      ) {
        return raw
      } else if (type === BindingTypes.SETUP_REF) {
        return `${raw}.value`
      } else if (type === BindingTypes.SETUP_MAYBE_REF) {
        // maybe-ref 是 const：读取用 unref；写入若合法只能是 ref.value，普通 const 本就不可赋值。
        return isAssignmentLVal || isUpdateArg || isDestructureAssignment
          ? `${raw}.value`
          : wrapWithUnref(raw)
      } else if (type === BindingTypes.SETUP_LET) {
        if (isAssignmentLVal) {
          // setup let 运行时可能被换成 ref。`x = y` 生成
          // `isRef(x) ? x.value = y : x = y`；右值需复制到三元式 ref 分支中。
          const { right: rVal, operator } = parent as AssignmentExpression
          const rExp = rawExp.slice(rVal.start! - 1, rVal.end! - 1)
          const rExpString = stringifyExpression(
            processExpression(
              createSimpleExpression(rExp, false),
              context,
              false,
              false,
              knownIds,
            ),
          )
          return `${context.helperString(IS_REF)}(${raw})${
            context.isTS ? ` //@ts-ignore\n` : ``
          } ? ${raw}.value ${operator} ${rExpString} : ${raw}`
        } else if (isUpdateArg) {
          // 扩大 Identifier 范围覆盖整个 update expression，避免原始 `++` 在替换后残留。
          id!.start = parent!.start
          id!.end = parent!.end
          const { prefix: isPrefix, operator } = parent as UpdateExpression
          const prefix = isPrefix ? operator : ``
          const postfix = isPrefix ? `` : operator
          // `x++` → `isRef(x) ? x.value++ : x++`，同时保留前置/后置运算语义。
          return `${context.helperString(IS_REF)}(${raw})${
            context.isTS ? ` //@ts-ignore\n` : ``
          } ? ${prefix}${raw}.value${postfix} : ${prefix}${raw}${postfix}`
        } else if (isDestructureAssignment) {
          // TODO：解构左值无法在不重建整个 Pattern 的情况下为每项插入 isRef 分支，
          // 当前按普通 let 处理，即假定该绑定不是 ref。
          return raw
        } else {
          return wrapWithUnref(raw)
        }
      } else if (type === BindingTypes.PROPS) {
        // 使用 compileScript 生成的 `__props`，TS 内联模板可获得准确 props 类型。
        return genPropsAccessExp(raw)
      } else if (type === BindingTypes.PROPS_ALIASED) {
        // defineProps 解构别名需要恢复原 prop key。
        return genPropsAccessExp(bindingMetadata.__propsAliases![raw])
      }
    } else {
      if (
        (type && type.startsWith('setup')) ||
        type === BindingTypes.LITERAL_CONST
      ) {
        // 非内联模式通过渲染函数额外参数 `$setup` 读取 setup 绑定。
        return `$setup.${raw}`
      } else if (type === BindingTypes.PROPS_ALIASED) {
        return `$props['${bindingMetadata.__propsAliases![raw]}']`
      } else if (type) {
        return `$${type}.${raw}`
      }
    }

    // 未知绑定最终走组件公开实例代理。
    return `_ctx.${raw}`
  }

  // 单标识符无需 Babel 遍历，直接用绑定元数据完成改写与常量级别标记。
  const rawExp = node.content

  let ast = node.ast

  if (ast === false) {
    // parser 已报告过语法错误，false 防止这里重复解析和重复诊断。
    return node
  }

  if (ast === null || (!ast && isSimpleIdentifier(rawExp))) {
    const isScopeVarReference = context.identifiers[rawExp]
    const isAllowedGlobal = isGloballyAllowed(rawExp)
    const isLiteral = isLiteralWhitelisted(rawExp)
    if (
      !asParams &&
      !isScopeVarReference &&
      !isLiteral &&
      (!isAllowedGlobal || bindingMetadata[rawExp])
    ) {
      // setup const 在实例内稳定，可跳过 patch；但每个实例值可能不同，不能提升到模块级。
      if (isConst(bindingMetadata[rawExp])) {
        node.constType = ConstantTypes.CAN_SKIP_PATCH
      }
      node.content = rewriteIdentifier(rawExp)
    } else if (!isScopeVarReference) {
      if (isLiteral) {
        node.constType = ConstantTypes.CAN_STRINGIFY
      } else {
        node.constType = ConstantTypes.CAN_CACHE
      }
    }
    return node
  }

  if (!ast) {
    // 三类源码需不同包装：多条 v-on 语句两侧补空格保持 offset；普通表达式包括号以正确
    // 解析对象字面量；v-for/v-slot 别名放进箭头函数参数位置以按 Pattern 解析。
    const source = asRawStatements
      ? ` ${rawExp} `
      : `(${rawExp})${asParams ? `=>{}` : ``}`
    try {
      ast = parseExpression(source, {
        sourceType: 'module',
        plugins: context.expressionPlugins,
      })
    } catch (e: any) {
      context.onError(
        createCompilerError(
          ErrorCodes.X_INVALID_EXPRESSION,
          node.loc,
          undefined,
          e.message,
        ),
      )
      return node
    }
  }

  /** 附加前后缀改写元数据的 Babel 标识符；最终按原始 source offset 回填表达式。 */
  type QualifiedId = Identifier & PrefixMeta
  const ids: QualifiedId[] = []
  const parentStack: Node[] = []
  const knownIds: Record<string, number> = Object.create(context.identifiers)

  walkIdentifiers(
    ast,
    (node, parent, _, isReferenced, isLocal) => {
      if (isStaticPropertyKey(node, parent!)) {
        return
      }
      // Vue 2 过滤器转换生成的 `_filter_x` 是编译器局部变量，不能加 `_ctx.`。
      if (__COMPAT__ && node.name.startsWith('_filter_')) {
        return
      }

      const needPrefix = isReferenced && canPrefix(node)
      if (needPrefix && !isLocal) {
        if (isStaticProperty(parent!) && parent.shorthand) {
          // 对象简写 `{ foo }` 改写值后必须展开为 `{ foo: _ctx.foo }`，保留原 key。
          ;(node as QualifiedId).prefix = `${node.name}: `
        }
        node.name = rewriteIdentifier(node.name, parent, node)
        ids.push(node as QualifiedId)
      } else {
        // 非局部调用目标/成员对象之外的未前缀标识符可视为常量；v-for/v-slot 局部变量除外。
        if (
          !(needPrefix && isLocal) &&
          (!parent ||
            (parent.type !== 'CallExpression' &&
              parent.type !== 'NewExpression' &&
              parent.type !== 'MemberExpression'))
        ) {
          ;(node as QualifiedId).isConstant = true
        }
        // 即使不需前缀，也拆成子表达式以产生精确 source map；静态属性 key 已提前跳过。
        ids.push(node as QualifiedId)
      }
    },
    true, // 所有标识符都回调，便于 source map 和常量分析。
    parentStack,
    knownIds,
  )

  // 将原表达式按 Identifier 范围切成字符串与 SimpleExpression 子节点。
  // codegen 对 CompoundExpression 使用 children，不再使用原 content。
  const children: CompoundExpressionNode['children'] = []
  ids.sort((a, b) => a.start - b.start)
  ids.forEach((id, i) => {
    // 普通/参数表达式解析时前面添加了一个 `(`，Babel 范围需整体减 1 对齐模板源码。
    const start = id.start - 1
    const end = id.end - 1
    const last = ids[i - 1]
    const leadingText = rawExp.slice(last ? last.end - 1 : 0, start)
    if (leadingText.length || id.prefix) {
      children.push(leadingText + (id.prefix || ``))
    }
    const source = rawExp.slice(start, end)
    children.push(
      createSimpleExpression(
        id.name,
        false,
        {
          start: advancePositionWithClone(node.loc.start, source, start),
          end: advancePositionWithClone(node.loc.start, source, end),
          source,
        },
        id.isConstant
          ? ConstantTypes.CAN_STRINGIFY
          : ConstantTypes.NOT_CONSTANT,
      ),
    )
    if (i === ids.length - 1 && end < rawExp.length) {
      children.push(rawExp.slice(end))
    }
  })

  let ret
  if (children.length) {
    ret = createCompoundExpression(children, node.loc)
    ret.ast = ast
  } else {
    ret = node
    ret.constType = ConstantTypes.CAN_STRINGIFY
  }
  ret.identifiers = Object.keys(knownIds)
  return ret
}

/** 判断自由标识符是否允许添加组件上下文前缀。 */
function canPrefix(id: Identifier) {
  // 标准全局对象（Math、Date 等）直接使用。
  if (isGloballyAllowed(id.name)) {
    return false
  }
  // webpack 生成/注入的 require 必须保持为模块加载函数。
  if (id.name === 'require') {
    return false
  }
  return true
}

/** 把简单/复合表达式重新拼回可执行源码字符串。 */
export function stringifyExpression(exp: ExpressionNode | string): string {
  if (isString(exp)) {
    return exp
  } else if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
    return exp.content
  } else {
    return (exp.children as (ExpressionNode | string)[])
      .map(stringifyExpression)
      .join('')
  }
}

/** 是否为编译期确定且不可变的 setup/literal 常量绑定。 */
function isConst(type: unknown) {
  return (
    type === BindingTypes.SETUP_CONST || type === BindingTypes.LITERAL_CONST
  )
}
