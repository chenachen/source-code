import {
  type BlockCodegenNode,
  type CacheExpression,
  type CallExpression,
  type DirectiveNode,
  type ElementNode,
  ElementTypes,
  type ExpressionNode,
  type IfBranchNode,
  type InterpolationNode,
  type JSChildNode,
  type MemoExpression,
  NodeTypes,
  type ObjectExpression,
  type Position,
  type Property,
  type RenderSlotCall,
  type RootNode,
  type SimpleExpressionNode,
  type SlotOutletNode,
  type TemplateChildNode,
  type TemplateNode,
  type TextNode,
  type VNodeCall,
  createCallExpression,
  createObjectExpression,
} from './ast'
import type { TransformContext } from './transform'
import {
  BASE_TRANSITION,
  GUARD_REACTIVE_PROPS,
  KEEP_ALIVE,
  MERGE_PROPS,
  NORMALIZE_PROPS,
  SUSPENSE,
  TELEPORT,
  TO_HANDLERS,
  WITH_MEMO,
} from './runtimeHelpers'
import { NOOP, isObject, isString } from '@vue/shared'
import type { PropsExpression } from './transforms/transformElement'
import { parseExpression } from '@babel/parser'
import type { Expression, Node } from '@babel/types'
import { unwrapTSNode } from './babelUtils'
import { isWhitespace } from './tokenizer'

/** 判断代码生成节点是否为编译期确认的静态简单表达式。 */
export const isStaticExp = (p: JSChildNode): p is SimpleExpressionNode =>
  p.type === NodeTypes.SIMPLE_EXPRESSION && p.isStatic

/** 把平台无关的 Vue 内置组件标签映射到对应运行时 helper Symbol。 */
export function isCoreComponent(tag: string): symbol | void {
  switch (tag) {
    case 'Teleport':
    case 'teleport':
      return TELEPORT
    case 'Suspense':
    case 'suspense':
      return SUSPENSE
    case 'KeepAlive':
    case 'keep-alive':
      return KEEP_ALIVE
    case 'BaseTransition':
    case 'base-transition':
      return BASE_TRANSITION
  }
}

/** 匹配空串、数字开头或包含 JS 标识符非法字符的名称。 */
const nonIdentifierRE = /^$|^\d|[^\$\w\xA0-\uFFFF]/
/** 编译器的标识符快速近似判断，接受广泛非 ASCII 字符；完整 JS 合法性仍由表达式解析确认。 */
export const isSimpleIdentifier = (name: string): boolean =>
  !nonIdentifierRE.test(name)

/** 浏览器轻量成员表达式词法器的嵌套状态。 */
enum MemberExpLexState {
  /** 扫描根标识符或点访问成员。 */
  inMemberExp,
  /** 位于 `[...]` 计算属性内部；允许嵌套括号和任意表达式文本。 */
  inBrackets,
  /** 位于 `(...)` 调用参数内部；调用只能出现在成员链中间，不能作为最终左值。 */
  inParens,
  /** 位于单双引号或模板字符串中，分隔符字符不参与括号计数。 */
  inString,
}

/** JS 标识符首字符近似规则；允许 `_`、`$` 和非 ASCII 字符。 */
export const validFirstIdentCharRE: RegExp = /[A-Za-z_$\xA0-\uFFFF]/
/** 成员路径后续可出现的字符，包括点与可选链问号。 */
const validIdentCharRE = /[\.\?\w$\xA0-\uFFFF]/
/** 匹配点访问/方括号访问周围多余空白。 */
const whitespaceRE = /\s+[.[]\s*|\s*[.[]\s+/g

/** 取得表达式原始源码；复合表达式从 location 恢复完整文本。 */
const getExpSource = (exp: ExpressionNode): string =>
  exp.type === NodeTypes.SIMPLE_EXPRESSION ? exp.content : exp.loc.source

/**
 * 浏览器构建使用的轻量成员表达式检查器。
 *
 * 这里只识别成员路径形态，不验证方括号内部 JS 语法。浏览器开发构建另做表达式校验；
 * 生产构建可能返回含非法表达式的代码，在创建 render 函数时才抛 SyntaxError。
 * 括号深度与字符串状态只做轻量扫描，不是完整 JS lexer；返回 true 也不保证可选链可被赋值。
 */
export const isMemberExpressionBrowser = (exp: ExpressionNode): boolean => {
  // 先去掉 `foo . bar` / `foo [x]` 访问符周围空白，简化状态机。
  const path = getExpSource(exp)
    .trim()
    .replace(whitespaceRE, s => s.trim())

  let state = MemberExpLexState.inMemberExp
  let stateStack: MemberExpLexState[] = []
  let currentOpenBracketCount = 0
  let currentOpenParensCount = 0
  let currentStringType: "'" | '"' | '`' | null = null

  for (let i = 0; i < path.length; i++) {
    const char = path.charAt(i)
    switch (state) {
      case MemberExpLexState.inMemberExp:
        if (char === '[') {
          stateStack.push(state)
          state = MemberExpLexState.inBrackets
          currentOpenBracketCount++
        } else if (char === '(') {
          stateStack.push(state)
          state = MemberExpLexState.inParens
          currentOpenParensCount++
        } else if (
          !(i === 0 ? validFirstIdentCharRE : validIdentCharRE).test(char)
        ) {
          return false
        }
        break
      case MemberExpLexState.inBrackets:
        if (char === `'` || char === `"` || char === '`') {
          stateStack.push(state)
          state = MemberExpLexState.inString
          currentStringType = char
        } else if (char === `[`) {
          currentOpenBracketCount++
        } else if (char === `]`) {
          if (!--currentOpenBracketCount) {
            state = stateStack.pop()!
          }
        }
        break
      case MemberExpLexState.inParens:
        if (char === `'` || char === `"` || char === '`') {
          stateStack.push(state)
          state = MemberExpLexState.inString
          currentStringType = char
        } else if (char === `(`) {
          currentOpenParensCount++
        } else if (char === `)`) {
          // `foo()` 是调用结果而非可赋值成员；但 `foo().bar` 仍可继续形成成员访问。
          if (i === path.length - 1) {
            return false
          }
          if (!--currentOpenParensCount) {
            state = stateStack.pop()!
          }
        }
        break
      case MemberExpLexState.inString:
        if (char === currentStringType) {
          state = stateStack.pop()!
          currentStringType = null
        }
        break
    }
  }
  return !currentOpenBracketCount && !currentOpenParensCount
}

/**
 * Node 构建按 Babel AST 识别成员访问、可选成员访问和非 undefined 的简单标识符。
 * 其中可选成员访问是可读取路径，但不能直接用作赋值目标。
 */
export const isMemberExpressionNode: (
  exp: ExpressionNode,
  context: TransformContext,
) => boolean = __BROWSER__
  ? (NOOP as any)
  : (exp, context) => {
      try {
        let ret: Node =
          exp.ast ||
          parseExpression(getExpSource(exp), {
            plugins: context.expressionPlugins
              ? [...context.expressionPlugins, 'typescript']
              : ['typescript'],
          })
        ret = unwrapTSNode(ret) as Expression
        return (
          ret.type === 'MemberExpression' ||
          ret.type === 'OptionalMemberExpression' ||
          (ret.type === 'Identifier' && ret.name !== 'undefined')
        )
      } catch (e) {
        return false
      }
    }

/** 按构建目标选择轻量词法检查或 Babel AST 检查。 */
export const isMemberExpression: (
  exp: ExpressionNode,
  context: TransformContext,
) => boolean = __BROWSER__ ? isMemberExpressionBrowser : isMemberExpressionNode

/** 浏览器构建识别箭头函数与 function 表达式的近似正则。 */
const fnExpRE =
  /^\s*(?:async\s*)?(?:\([^)]*?\)|[\w$_]+)\s*(?::[^=]+)?=>|^\s*(?:async\s+)?function(?:\s+[\w$]+)?\s*\(/

/** 浏览器构建的函数表达式快速检查。 */
export const isFnExpressionBrowser: (exp: ExpressionNode) => boolean = exp =>
  fnExpRE.test(getExpSource(exp))

/** Node 构建通过 Babel AST 精确判断函数/箭头函数表达式。 */
export const isFnExpressionNode: (
  exp: ExpressionNode,
  context: TransformContext,
) => boolean = __BROWSER__
  ? (NOOP as any)
  : (exp, context) => {
      try {
        let ret: Node =
          exp.ast ||
          parseExpression(getExpSource(exp), {
            plugins: context.expressionPlugins
              ? [...context.expressionPlugins, 'typescript']
              : ['typescript'],
          })
        // 含分号的 v-on 表达式可能已按 Program 缓存，先取第一条 ExpressionStatement。
        if (ret.type === 'Program') {
          ret = ret.body[0]
          if (ret.type === 'ExpressionStatement') {
            ret = ret.expression
          }
        }
        ret = unwrapTSNode(ret) as Expression
        return (
          ret.type === 'FunctionExpression' ||
          ret.type === 'ArrowFunctionExpression'
        )
      } catch (e) {
        return false
      }
    }

/** 按构建目标选择函数表达式检查实现。 */
export const isFnExpression: (
  exp: ExpressionNode,
  context: TransformContext,
) => boolean = __BROWSER__ ? isFnExpressionBrowser : isFnExpressionNode

/**
 * 向前推进源码位置并返回新对象；原 Position 保持不变。
 */
export function advancePositionWithClone(
  pos: Position,
  source: string,
  numberOfCharacters: number = source.length,
): Position {
  return advancePositionWithMutation(
    {
      offset: pos.offset,
      line: pos.line,
      column: pos.column,
    },
    source,
    numberOfCharacters,
  )
}

/**
 * 原地推进源码位置。parser/codegen 热路径频繁调用，避免 clone 分配。
 * 按 UTF-16 代码单元累计 offset/column，只有 LF 增加 line；numberOfCharacters 指定本次消费的前缀长度。
 */
export function advancePositionWithMutation(
  pos: Position,
  source: string,
  numberOfCharacters: number = source.length,
): Position {
  let linesCount = 0
  let lastNewLinePos = -1
  for (let i = 0; i < numberOfCharacters; i++) {
    if (source.charCodeAt(i) === 10 /* LF 换行代码 */) {
      linesCount++
      lastNewLinePos = i
    }
  }

  pos.offset += numberOfCharacters
  pos.line += linesCount
  pos.column =
    lastNewLinePos === -1
      ? pos.column + numberOfCharacters
      : numberOfCharacters - lastNewLinePos

  return pos
}

/** 编译器内部不变量断言；失败表示转换管线遗漏，不是用户模板的普通语法错误。 */
export function assert(condition: boolean, msg?: string): void {
  /* v8 ignore next 3 */
  if (!condition) {
    throw new Error(msg || `unexpected compiler condition`)
  }
}

/** 查找首个匹配指令；默认要求 exp 节点存在，allowEmpty 允许裸指令，但不检查表达式文本是否为空白。 */
export function findDir(
  node: ElementNode,
  name: string | RegExp,
  allowEmpty: boolean = false,
): DirectiveNode | undefined {
  for (let i = 0; i < node.props.length; i++) {
    const p = node.props[i]
    if (
      p.type === NodeTypes.DIRECTIVE &&
      (allowEmpty || p.exp) &&
      (isString(name) ? p.name === name : name.test(p.name))
    ) {
      return p
    }
  }
}

/**
 * 查找静态属性或等价的静态参数 `v-bind`；`dynamicOnly` 为 true 时只接受 v-bind。
 * 默认要求 value/exp 节点存在，allowEmpty 接受无值项；动态参数不可能在编译期确认等于 name。
 */
export function findProp(
  node: ElementNode,
  name: string,
  dynamicOnly: boolean = false,
  allowEmpty: boolean = false,
): ElementNode['props'][0] | undefined {
  for (let i = 0; i < node.props.length; i++) {
    const p = node.props[i]
    if (p.type === NodeTypes.ATTRIBUTE) {
      if (dynamicOnly) continue
      if (p.name === name && (p.value || allowEmpty)) {
        return p
      }
    } else if (
      p.name === 'bind' &&
      (p.exp || allowEmpty) &&
      isStaticArgOf(p.arg, name)
    ) {
      return p
    }
  }
}

/** 判断指令参数是否为指定名称的静态参数。 */
export function isStaticArgOf(
  arg: DirectiveNode['arg'],
  name: string,
): boolean {
  return !!(arg && isStaticExp(arg) && arg.content === name)
}

/**
 * 元素是否含会在运行时产生未知 key 集合的 v-bind：无参数对象绑定或动态参数绑定。
 */
export function hasDynamicKeyVBind(node: ElementNode): boolean {
  return node.props.some(
    p =>
      p.type === NodeTypes.DIRECTIVE &&
      p.name === 'bind' &&
      (!p.arg || // `v-bind="obj"`。
        p.arg.type !== NodeTypes.SIMPLE_EXPRESSION || // 复合动态参数。
        !p.arg.isStatic), // `v-bind:[foo]`。
  )
}

/** 节点是否为原始文本或插值。 */
export function isText(
  node: TemplateChildNode,
): node is TextNode | InterpolationNode {
  return node.type === NodeTypes.INTERPOLATION || node.type === NodeTypes.TEXT
}

/** 属性节点是否为 `v-pre`。 */
export function isVPre(p: ElementNode['props'][0]): p is DirectiveNode {
  return p.type === NodeTypes.DIRECTIVE && p.name === 'pre'
}

/** 属性节点是否为 `v-slot`。 */
export function isVSlot(p: ElementNode['props'][0]): p is DirectiveNode {
  return p.type === NodeTypes.DIRECTIVE && p.name === 'slot'
}

/** 节点是否为承载结构指令或插槽语义的 `<template>` 容器。 */
export function isTemplateNode(
  node: RootNode | TemplateChildNode,
): node is TemplateNode {
  return (
    node.type === NodeTypes.ELEMENT && node.tagType === ElementTypes.TEMPLATE
  )
}

/** 节点是否为 `<slot>` 出口。 */
export function isSlotOutlet(
  node: RootNode | TemplateChildNode,
): node is SlotOutletNode {
  return node.type === NodeTypes.ELEMENT && node.tagType === ElementTypes.SLOT
}

/** injectProp 需要穿透的 props 归一化 helper 集合。 */
const propsHelperSet = new Set([NORMALIZE_PROPS, GUARD_REACTIVE_PROPS])

/**
 * 沿 `normalizeProps(guardReactiveProps(...))` 调用链取得尚未归一化的真实 props，
 * 同时返回调用路径，注入完成后可把新表达式重新接回原包装层。
 */
function getUnnormalizedProps(
  props: PropsExpression | '{}',
  callPath: CallExpression[] = [],
): [PropsExpression | '{}', CallExpression[]] {
  if (
    props &&
    !isString(props) &&
    props.type === NodeTypes.JS_CALL_EXPRESSION
  ) {
    const callee = props.callee
    if (!isString(callee) && propsHelperSet.has(callee)) {
      return getUnnormalizedProps(
        props.arguments[0] as PropsExpression,
        callPath.concat(props),
      )
    }
  }
  return [props, callPath]
}

/**
 * 向 VNode 或 renderSlot 调用注入编译器生成的 prop（最常见是结构分支 `key`）。
 *
 * props 可能是对象、`mergeProps`、`toHandlers` 或多层归一化调用。本函数先穿透包装，
 * 尽量注入第一个对象字面量；若无法安全原地修改，再用 `mergeProps({ injected }, props)`。
 * 编译器生成值放前面，使用户显式同名 prop 保持最高优先级。
 */
export function injectProp(
  node: VNodeCall | RenderSlotCall,
  prop: Property,
  context: TransformContext,
): void {
  if (node.type !== NodeTypes.VNODE_CALL && injectSlotKey(node, prop)) {
    return
  }

  let propsWithInjection: ObjectExpression | CallExpression | undefined
  /**
   * 可能遇到的 props 形态：
   * 1. `mergeProps(...)`
   * 2. `toHandlers(...)`
   * 3. `normalizeProps(...)`
   * 4. `normalizeProps(guardReactiveProps(...))`
   *
   * 注入必须发生在 normalize 之前，否则 key 可能进不到最终 VNode props。
   */
  let props =
    node.type === NodeTypes.VNODE_CALL ? node.props : node.arguments[2]
  let callPath: CallExpression[] = []
  let parentCall: CallExpression | undefined
  if (
    props &&
    !isString(props) &&
    props.type === NodeTypes.JS_CALL_EXPRESSION
  ) {
    const ret = getUnnormalizedProps(props)
    props = ret[0]
    callPath = ret[1]
    parentCall = callPath[callPath.length - 1]
  }

  if (props == null || isString(props)) {
    propsWithInjection = createObjectExpression([prop])
  } else if (props.type === NodeTypes.JS_CALL_EXPRESSION) {
    // mergeProps 第一参数若是对象字面量，可以直接前插；后续参数仍能覆盖编译器值。
    const first = props.arguments[0] as string | JSChildNode
    if (!isString(first) && first.type === NodeTypes.JS_OBJECT_EXPRESSION) {
      // 修复 #6631：动态组件位于 v-if 中且已有显式 `key="badge"` 时，旧逻辑又注入
      // `key: 0`，生成重复对象 key 并触发构建警告。命中用户 key 后不再插入分支 key。
      if (!hasProp(prop, first)) {
        first.properties.unshift(prop)
      }
    } else {
      if (props.callee === TO_HANDLERS) {
        // 修复 #2366：`v-if` 元素只有 `v-on="listeners"` 时，props 是 toHandlers 调用。
        // 直接把 `{ key }` 塞进 toHandlers 参数会被当成事件名转换，分支 VNode 实际拿不到 key；
        // 必须在外层 mergeProps，才能同时保留对象事件监听与 v-if 分支身份。
        propsWithInjection = createCallExpression(context.helper(MERGE_PROPS), [
          createObjectExpression([prop]),
          props,
        ])
      } else {
        props.arguments.unshift(createObjectExpression([prop]))
      }
    }
    !propsWithInjection && (propsWithInjection = props)
  } else if (props.type === NodeTypes.JS_OBJECT_EXPRESSION) {
    if (!hasProp(prop, props)) {
      props.properties.unshift(prop)
    }
    propsWithInjection = props
  } else {
    // 单个 `v-bind="props"` 表达式不可原地加属性，用 mergeProps 构造替换值。
    propsWithInjection = createCallExpression(context.helper(MERGE_PROPS), [
      createObjectExpression([prop]),
      props,
    ])
    // 对 `normalizeProps(guardReactiveProps(props))`，改写后为
    // `normalizeProps(mergeProps({ key: 0 }, props))`。mergeProps 自身创建新对象，
    // 已不会修改响应式入参，所以可越过并移除 guardReactiveProps 这一层。
    if (parentCall && parentCall.callee === GUARD_REACTIVE_PROPS) {
      parentCall = callPath[callPath.length - 2]
    }
  }
  if (node.type === NodeTypes.VNODE_CALL) {
    if (parentCall) {
      parentCall.arguments[0] = propsWithInjection
    } else {
      node.props = propsWithInjection
    }
  } else {
    if (parentCall) {
      parentCall.arguments[0] = propsWithInjection
    } else {
      node.arguments[2] = propsWithInjection
    }
  }
}

/**
 * renderSlot 的分支 key 使用第六参数传递，而不是混入 slot props。
 * 用户已经显式提供 key 时直接视为处理完成，防止编译器分支 key 覆盖用户优先级。
 */
function injectSlotKey(node: RenderSlotCall, prop: Property): boolean {
  if (
    prop.key.type !== NodeTypes.SIMPLE_EXPRESSION ||
    prop.key.content !== 'key'
  ) {
    return false
  }

  // 已有用户 key 时保留它，避免编译器生成的 v-if 分支 key 泄漏或抢占优先级。
  const props = node.arguments[2]
  if (props && !isString(props)) {
    const [unnormalizedProps] = getUnnormalizedProps(props as PropsExpression)
    if (
      unnormalizedProps &&
      !isString(unnormalizedProps) &&
      unnormalizedProps.type === NodeTypes.JS_OBJECT_EXPRESSION &&
      hasProp(prop, unnormalizedProps)
    ) {
      return true
    }
  }

  node.arguments[2] ||= '{}'
  node.arguments[3] ||= 'undefined'
  node.arguments[4] ||= 'undefined'
  node.arguments[5] = prop.value
  return true
}

/** 对象表达式是否已含与待注入项同名的静态 key。 */
function hasProp(prop: Property, props: ObjectExpression) {
  let result = false
  if (prop.key.type === NodeTypes.SIMPLE_EXPRESSION) {
    const propKeyName = prop.key.content
    result = props.properties.some(
      p =>
        p.key.type === NodeTypes.SIMPLE_EXPRESSION &&
        p.key.content === propKeyName,
    )
  }
  return result
}

/**
 * 把组件/指令/过滤器原名编码成合法且尽量唯一的 JS 局部变量名。
 *
 * `-` 统一变为 `_`；其他非单词字符使用 UTF-16 charCode。修复 #4422：若简单都替换为
 * 下划线，`a-b` 与 `a.b`、或两个含不同中文字符的组件名会生成同一个
 * `_component_a_b` 声明，最终因重复 const 导致整份渲染函数无法执行。
 */
export function toValidAssetId(
  name: string,
  type: 'component' | 'directive' | 'filter',
): string {
  return `_${type}_${name.replace(/[^\w]/g, (searchValue, replaceValue) => {
    return searchValue === '-' ? '_' : name.charCodeAt(replaceValue).toString()
  })}`
}

/**
 * 递归检查节点是否引用当前 `v-for` / `v-slot` 局部标识符。
 * 结果用于判断插槽、处理器、静态节点能否安全提升或缓存；捕获局部变量就必须留在作用域内。
 * 依赖 processExpression 已把复合 JS 拆成标识符片段；它不会重新解析未拆分的任意表达式文本。
 * identifiers 的零计数保留在表中，但不构成活动引用；已经生成的缓存表达式不再向内检查。
 */
export function hasScopeRef(
  node:
    | TemplateChildNode
    | IfBranchNode
    | ExpressionNode
    | CacheExpression
    | undefined,
  ids: TransformContext['identifiers'],
): boolean {
  if (!node || Object.keys(ids).length === 0) {
    return false
  }
  switch (node.type) {
    case NodeTypes.ELEMENT:
      for (let i = 0; i < node.props.length; i++) {
        const p = node.props[i]
        if (
          p.type === NodeTypes.DIRECTIVE &&
          (hasScopeRef(p.arg, ids) || hasScopeRef(p.exp, ids))
        ) {
          return true
        }
      }
      return node.children.some(c => hasScopeRef(c, ids))
    case NodeTypes.FOR:
      if (hasScopeRef(node.source, ids)) {
        return true
      }
      return node.children.some(c => hasScopeRef(c, ids))
    case NodeTypes.IF:
      return node.branches.some(b => hasScopeRef(b, ids))
    case NodeTypes.IF_BRANCH:
      if (hasScopeRef(node.condition, ids)) {
        return true
      }
      return node.children.some(c => hasScopeRef(c, ids))
    case NodeTypes.SIMPLE_EXPRESSION:
      return (
        !node.isStatic &&
        isSimpleIdentifier(node.content) &&
        !!ids[node.content]
      )
    case NodeTypes.COMPOUND_EXPRESSION:
      return node.children.some(c => isObject(c) && hasScopeRef(c, ids))
    case NodeTypes.INTERPOLATION:
    case NodeTypes.TEXT_CALL:
      return hasScopeRef(node.content, ids)
    case NodeTypes.TEXT:
    case NodeTypes.COMMENT:
    case NodeTypes.JS_CACHE_EXPRESSION:
      return false
    default:
      if (__DEV__) {
        const exhaustiveCheck: never = node
        exhaustiveCheck
      }
      return false
  }
}

/**
 * 从普通 block 或 `withMemo` 包装中取得实际 VNode/renderSlot 调用。
 */
export function getMemoedVNodeCall(
  node: BlockCodegenNode | MemoExpression,
): VNodeCall | RenderSlotCall {
  if (node.type === NodeTypes.JS_CALL_EXPRESSION && node.callee === WITH_MEMO) {
    return node.arguments[1].returns as VNodeCall
  } else {
    return node
  }
}

/** 拆分 `v-for` 左右两侧的正则，同时接受 `in` 与 `of`。 */
export const forAliasRE: RegExp = /([\s\S]*?)\s+(?:in|of)\s+(\S[\s\S]*)/

/** 字符串是否完全由 HTML 空白字符组成。 */
export function isAllWhitespace(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    if (!isWhitespace(str.charCodeAt(i))) {
      return false
    }
  }
  return true
}

/** 节点是否为纯空白文本；兼容 transformText 包装后的 TextCallNode。 */
export function isWhitespaceText(node: TemplateChildNode): boolean {
  return (
    (node.type === NodeTypes.TEXT && isAllWhitespace(node.content)) ||
    (node.type === NodeTypes.TEXT_CALL && isWhitespaceText(node.content))
  )
}

/** 节点是否为注释或纯空白文本，常用于寻找有效单根节点。 */
export function isCommentOrWhitespace(node: TemplateChildNode): boolean {
  return node.type === NodeTypes.COMMENT || isWhitespaceText(node)
}
