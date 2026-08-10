import type { DirectiveTransform, DirectiveTransformResult } from '../transform'
import {
  type DirectiveNode,
  ElementTypes,
  type ExpressionNode,
  NodeTypes,
  type SimpleExpressionNode,
  createCompoundExpression,
  createObjectProperty,
  createSimpleExpression,
} from '../ast'
import { camelize, toHandlerKey } from '@vue/shared'
import { ErrorCodes, createCompilerError } from '../errors'
import { processExpression } from './transformExpression'
import { validateBrowserExpression } from '../validateExpression'
import { hasScopeRef, isFnExpression, isMemberExpression } from '../utils'
import { TO_HANDLER_KEY } from '../runtimeHelpers'

/** 已保证带事件参数的 v-on 节点形态。 */
export interface VOnDirectiveNode extends DirectiveNode {
  // 无参数 `v-on="listeners"` 影响整个 props 对象，由 transformElement.ts 处理；这里参数必有。
  arg: ExpressionNode
  // transformExpression 会特意跳过带参数 v-on，故这里仍是待按事件语义处理的简单表达式。
  exp: SimpleExpressionNode | undefined
}

/**
 * 把 `v-on:event="handler"` 转成 VNode 的 `onEvent: handler` prop。
 *
 * 除事件名规范化外，还区分成员引用、函数表达式和内联语句；内联语句包装 `$event => ...`。
 * 开启 cacheHandlers 时，仅缓存不捕获 v-for/v-slot 局部变量且不改变组件回调 arity 的处理器。
 * 平台编译器可通过 augmentor 再附加按键/鼠标修饰符包装。
 */
export const transformOn: DirectiveTransform = (
  dir,
  node,
  context,
  augmentor,
) => {
  const { loc, modifiers, arg } = dir as VOnDirectiveNode
  if (!dir.exp && !modifiers.length) {
    context.onError(createCompilerError(ErrorCodes.X_V_ON_NO_EXPRESSION, loc))
  }
  let eventName: ExpressionNode
  if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
    if (arg.isStatic) {
      let rawName = arg.content
      if (__DEV__ && rawName.startsWith('vnode')) {
        context.onError(createCompilerError(ErrorCodes.X_VNODE_HOOKS, arg.loc))
      }
      if (rawName.startsWith('vue:')) {
        rawName = `vnode-${rawName.slice(4)}`
      }
      const eventString =
        node.tagType !== ElementTypes.ELEMENT ||
        rawName.startsWith('vnode') ||
        !/[A-Z]/.test(rawName)
          ? // 组件与 vnode hook 统一 camelCase。修复 #2249：`test-event` 必须生成
            // `onTestEvent`，不能生成混合形式 `onTest-event`，否则 render API 监听不一致。
            toHandlerKey(camelize(rawName))
          : // 原生/自定义元素中显式含大写的 DOM 事件可能大小写敏感，使用 `on:RawName` 原样保留。
            `on:${rawName}`
      eventName = createSimpleExpression(eventString, true, arg.loc)
    } else {
      // 动态事件名统一经 toHandlerKey；#2388 的 nullish 动态值由运行时 helper 安全处理，
      // 避免直接拼接 `on${null}` 导致无法注册/移除监听器。
      eventName = createCompoundExpression([
        `${context.helperString(TO_HANDLER_KEY)}(`,
        arg,
        `)`,
      ])
    }
  } else {
    // 已是复合表达式，保留其分段结构继续生成 handler。
    eventName = arg
    eventName.children.unshift(`${context.helperString(TO_HANDLER_KEY)}(`)
    eventName.children.push(`)`)
  }

  // 识别处理器语法形态并决定是否需要包装、前缀化或缓存。
  let exp: ExpressionNode | undefined = dir.exp as
    SimpleExpressionNode | undefined
  if (exp && !exp.content.trim()) {
    exp = undefined
  }
  let shouldCache: boolean = context.cacheHandlers && !exp && !context.inVOnce
  if (exp) {
    const isMemberExp = isMemberExpression(exp, context)
    const isInlineStatement = !(isMemberExp || isFnExpression(exp, context))
    const hasMultipleStatements = exp.content.includes(`;`)

    // v-on 在通用 expression transform 中被跳过，此处临时登记 `$event` 后单独处理。
    if (!__BROWSER__ && context.prefixIdentifiers) {
      isInlineStatement && context.addIdentifiers(`$event`)
      exp = dir.exp = processExpression(
        exp,
        context,
        false,
        hasMultipleStatements,
      )
      isInlineStatement && context.removeIdentifiers(`$event`)
      // 只有不依赖每轮局部作用域，且不会破坏运行时可观察函数特征时才能缓存。
      shouldCache =
        context.cacheHandlers &&
        // v-once 已缓存整个子树，不必再占一个 handler 缓存槽。
        !context.inVOnce &&
        // compileScript 已证明为运行时常量的绑定天然稳定，无需包装缓存。
        !(exp.type === NodeTypes.SIMPLE_EXPRESSION && exp.constType > 0) &&
        // 修复 #1541：组件接收成员函数时必须保留原函数及其 `.length`。Transition 通过
        // hook.length 判断用户是否接收 done 回调；若缓存时包成 `(...args) =>`，arity 变为 0，
        // SFC 过渡会误以为同步 hook 已完成并立刻隐藏元素。
        !(isMemberExp && node.tagType === ElementTypes.COMPONENT) &&
        // 捕获 v-for/v-slot 局部变量的闭包必须每轮重建，否则会读取旧迭代值。
        !hasScopeRef(exp, context.identifiers)
      // 可缓存成员处理器不能直接缓存当前函数引用，否则 `obj.handler` 被替换后仍调用旧函数。
      // 改成缓存包装器 `(...args) => obj.handler && obj.handler(...args)`，每次事件读取最新值。
      if (shouldCache && isMemberExp) {
        if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
          exp.content = `${exp.content} && ${exp.content}(...args)`
        } else {
          exp.children = [...exp.children, ` && `, ...exp.children, `(...args)`]
        }
      }
    }

    if (__DEV__ && __BROWSER__) {
      validateBrowserExpression(
        exp as SimpleExpressionNode,
        context,
        false,
        hasMultipleStatements,
      )
    }

    if (isInlineStatement || (shouldCache && isMemberExp)) {
      // 内联语句接收 `$event`；可缓存成员包装器接收剩余参数并透传。
      exp = createCompoundExpression([
        `${
          isInlineStatement
            ? !__BROWSER__ && context.isTS
              ? `($event: any)`
              : `$event`
            : `${
                !__BROWSER__ && context.isTS ? `\n//@ts-ignore\n` : ``
              }(...args)`
        } => ${hasMultipleStatements ? `{` : `(`}`,
        exp,
        hasMultipleStatements ? `}` : `)`,
      ])
    }
  }

  let ret: DirectiveTransformResult = {
    props: [
      createObjectProperty(
        eventName,
        exp || createSimpleExpression(`() => {}`, false, loc),
      ),
    ],
  }

  // compiler-dom 在此追加 withModifiers / withKeys 等平台包装。
  if (augmentor) {
    ret = augmentor(ret)
  }

  if (shouldCache) {
    // 稳定函数引用可避免组件因每轮收到新 listener prop 而无意义更新。
    ret.props[0].value = context.cache(ret.props[0].value)
  }

  // 标记事件 key，让 transformElement 在 props 归一化/动态性判断时使用监听器规则。
  ret.props.forEach(p => (p.key.isHandlerKey = true))
  return ret
}
