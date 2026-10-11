import {
  CompilerDeprecationTypes,
  type DirectiveTransform,
  type ExpressionNode,
  NodeTypes,
  type SimpleExpressionNode,
  type SourceLocation,
  type TransformContext,
  transformOn as baseTransform,
  checkCompatEnabled,
  createCallExpression,
  createCompoundExpression,
  createObjectProperty,
  createSimpleExpression,
  isStaticExp,
} from '@vue/compiler-core'
import { V_ON_WITH_KEYS, V_ON_WITH_MODIFIERS } from '../runtimeHelpers'
import { capitalize, makeMap } from '@vue/shared'

/** 映射为 addEventListener options，并编码到事件属性名后缀的修饰符。 */
const isEventOptionModifier = /*@__PURE__*/ makeMap(`passive,once,capture`)
/** 与按键无关、需要 `withModifiers` 在回调执行前判断的修饰符。 */
const isNonKeyModifier = /*@__PURE__*/ makeMap(
  // 传播和默认行为
  `stop,prevent,self,` +
    // 系统键与精确匹配
    `ctrl,shift,alt,meta,exact,` +
    // 鼠标键
    `middle`,
)
/** left/right 既可能表示方向键，也可能表示鼠标按键，需结合事件名判断。 */
const maybeKeyModifier = /*@__PURE__*/ makeMap('left,right')
/** 可使用键名守卫的原生键盘事件属性名。 */
const isKeyboardEvent = /*@__PURE__*/ makeMap(`onkeyup,onkeydown,onkeypress`)

/**
 * 把修饰符分为按键守卫、通用运行时守卫和事件监听选项三组。
 * 动态事件名下 left/right 同时进入两组，最终生成外层 withKeys、内层 withModifiers。
 * withKeys 要求事件带 key，没有 key 的普通鼠标事件会直接返回，不会退回鼠标按键判断。
 * 三组分别保留各自在原 modifiers 中的顺序；stop/prevent 等有先后副作用，不能排序。
 * @param key - core 已生成的静态 onXxx 或动态事件键，不是模板中的原始事件名。
 * @returns 三组字符串，调用方据此改键名、包 handler；此处不修改 handler 或 props。
 */
const resolveModifiers = (
  key: ExpressionNode,
  modifiers: SimpleExpressionNode[],
  context: TransformContext,
  loc: SourceLocation,
) => {
  const keyModifiers = []
  const nonKeyModifiers = []
  const eventOptionModifiers = []

  for (let i = 0; i < modifiers.length; i++) {
    const modifier = modifiers[i].content

    if (
      __COMPAT__ &&
      modifier === 'native' &&
      checkCompatEnabled(
        CompilerDeprecationTypes.COMPILER_V_ON_NATIVE,
        context,
        loc,
      )
    ) {
      eventOptionModifiers.push(modifier)
    } else if (isEventOptionModifier(modifier)) {
      // `.passive/.capture/.once` 最终成为事件名后缀，交给 patchEvent 解析为监听选项。
      eventOptionModifiers.push(modifier)
    } else {
      // 其余修饰符要包装 handler，在事件触发时执行条件守卫。
      if (maybeKeyModifier(modifier)) {
        if (isStaticExp(key)) {
          if (
            isKeyboardEvent((key as SimpleExpressionNode).content.toLowerCase())
          ) {
            keyModifiers.push(modifier)
          } else {
            nonKeyModifiers.push(modifier)
          }
        } else {
          keyModifiers.push(modifier)
          nonKeyModifiers.push(modifier)
        }
      } else {
        if (isNonKeyModifier(modifier)) {
          nonKeyModifiers.push(modifier)
        } else {
          keyModifiers.push(modifier)
        }
      }
    }
  }

  return {
    keyModifiers,
    nonKeyModifiers,
    eventOptionModifiers,
  }
}

/**
 * 将 click 的 right/middle 修饰语义改写为浏览器实际触发的事件。
 * `.right` 对应 contextmenu，`.middle` 对应 mouseup；动态事件名只在值确为 onClick 时改写。
 */
const transformClick = (key: ExpressionNode, event: string) => {
  const isStaticClick =
    isStaticExp(key) && key.content.toLowerCase() === 'onclick'
  return isStaticClick
    ? createSimpleExpression(event, true)
    : key.type !== NodeTypes.SIMPLE_EXPRESSION
      ? createCompoundExpression([
          `(`,
          key,
          `) === "onClick" ? "${event}" : (`,
          key,
          `)`,
        ])
      : key
}

/**
 * 扩展 core `v-on` 转换，加入 DOM 事件修饰符语义。
 *
 * 通用修饰符包装 `withModifiers`，按键修饰符包装 `withKeys`，监听选项则追加到事件属性名
 * （如 `onClickOnceCapture`），供 runtime-dom 注册原生监听器时读取。
 * DOM augmentor 在 core 完成表达式处理后、handler 缓存前运行，所以缓存的是含守卫的
 * 整体回调。无 modifiers 时原样返回 core 结果，不重复登记额外 helper。
 */
export const transformOn: DirectiveTransform = (dir, node, context) => {
  return baseTransform(dir, node, context, baseResult => {
    const { modifiers } = dir
    if (!modifiers.length) return baseResult

    let { key, value: handlerExp } = baseResult.props[0]
    const { keyModifiers, nonKeyModifiers, eventOptionModifiers } =
      resolveModifiers(key, modifiers, context, dir.loc)

    // 浏览器不会触发 click.right/click.middle 对应语义，先改成真正会触发的事件名。
    if (nonKeyModifiers.includes('right')) {
      key = transformClick(key, `onContextmenu`)
    }
    if (nonKeyModifiers.includes('middle')) {
      key = transformClick(key, `onMouseup`)
    }

    if (nonKeyModifiers.length) {
      handlerExp = createCallExpression(context.helper(V_ON_WITH_MODIFIERS), [
        handlerExp,
        JSON.stringify(nonKeyModifiers),
      ])
    }

    if (
      keyModifiers.length &&
      // 动态事件名可能在运行时变成键盘事件，因此始终保留按键守卫。
      (!isStaticExp(key) || isKeyboardEvent(key.content.toLowerCase()))
    ) {
      handlerExp = createCallExpression(context.helper(V_ON_WITH_KEYS), [
        handlerExp,
        JSON.stringify(keyModifiers),
      ])
    }

    if (eventOptionModifiers.length) {
      const modifierPostfix = eventOptionModifiers.map(capitalize).join('')
      key = isStaticExp(key)
        ? createSimpleExpression(`${key.content}${modifierPostfix}`, true)
        : createCompoundExpression([`(`, key, `) + "${modifierPostfix}"`])
    }

    return {
      props: [createObjectProperty(key, handlerExp)],
    }
  })
}
