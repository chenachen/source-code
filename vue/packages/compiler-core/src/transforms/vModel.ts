import type { DirectiveTransform } from '../transform'
import {
  ConstantTypes,
  ElementTypes,
  type ExpressionNode,
  NodeTypes,
  type Property,
  createCompoundExpression,
  createObjectProperty,
  createSimpleExpression,
} from '../ast'
import { ErrorCodes, createCompilerError } from '../errors'
import {
  hasScopeRef,
  isMemberExpression,
  isSimpleIdentifier,
  isStaticExp,
} from '../utils'
import { IS_REF } from '../runtimeHelpers'
import { BindingTypes } from '../options'
import { camelize } from '@vue/shared'

/**
 * 把组件 `v-model` 转成值 prop、`onUpdate:*` 赋值监听器和 modifiers prop。
 *
 * 基础转换只描述组件协议；原生 input/select/textarea 的 value/checked 细节由 compiler-dom
 * augment。SFC setup 内联模式结合 bindingMetadata 区分 ref、maybe-ref、let 与不可写绑定。
 */
export const transformModel: DirectiveTransform = (dir, node, context) => {
  const { exp, arg } = dir
  if (!exp) {
    context.onError(
      createCompilerError(ErrorCodes.X_V_MODEL_NO_EXPRESSION, dir.loc),
    )
    return createTransformProps()
  }

  // parser 的 loc.source 保留用户原始左值。复合表达式用它恢复完整文本，
  // inline 模式也用它查询 setup 绑定，避免把改写后的 _unref(foo) 当成脚本变量名。
  const rawExp = exp.loc.source.trim()
  const expString =
    exp.type === NodeTypes.SIMPLE_EXPRESSION ? exp.content : rawExp

  // script setup 内联时 exp 可能已变成 `_unref(foo)`；用原始 rawExp 查询脚本绑定类型。
  const bindingType = context.bindingMetadata[rawExp]

  // props（含解构别名）只读，必须由子组件 emit update 让父级更新，不能本地直接赋值。
  if (
    bindingType === BindingTypes.PROPS ||
    bindingType === BindingTypes.PROPS_ALIASED
  ) {
    context.onError(createCompilerError(ErrorCodes.X_V_MODEL_ON_PROPS, exp.loc))
    return createTransformProps()
  }

  // 字面量常量与确定非 ref 的 setup const 都不可写。
  if (
    bindingType === BindingTypes.LITERAL_CONST ||
    bindingType === BindingTypes.SETUP_CONST
  ) {
    context.onError(createCompilerError(ErrorCodes.X_V_MODEL_ON_CONST, exp.loc))
    return createTransformProps()
  }

  const maybeRef =
    !__BROWSER__ &&
    context.inline &&
    (bindingType === BindingTypes.SETUP_LET ||
      bindingType === BindingTypes.SETUP_REF ||
      bindingType === BindingTypes.SETUP_MAYBE_REF)

  if (!expString.trim() || (!isMemberExpression(exp, context) && !maybeRef)) {
    context.onError(
      createCompilerError(ErrorCodes.X_V_MODEL_MALFORMED_EXPRESSION, exp.loc),
    )
    return createTransformProps()
  }

  if (
    !__BROWSER__ &&
    context.prefixIdentifiers &&
    isSimpleIdentifier(expString) &&
    context.identifiers[expString]
  ) {
    context.onError(
      createCompilerError(ErrorCodes.X_V_MODEL_ON_SCOPE_VARIABLE, exp.loc),
    )
    return createTransformProps()
  }

  const propName = arg ? arg : createSimpleExpression('modelValue', true)
  const eventName = arg
    ? isStaticExp(arg)
      ? `onUpdate:${camelize(arg.content)}`
      : createCompoundExpression(['"onUpdate:" + ', arg])
    : `onUpdate:modelValue`

  let assignmentExp: ExpressionNode
  const eventArg = context.isTS ? `($event: any)` : `$event`
  if (maybeRef) {
    if (bindingType === BindingTypes.SETUP_REF) {
      // 已知 ref：赋值目标固定是 `.value`。
      assignmentExp = createCompoundExpression([
        `${eventArg} => ((`,
        createSimpleExpression(rawExp, false, exp.loc),
        `).value = $event)`,
      ])
    } else {
      // maybe-ref / setup let：运行时先 isRef。普通 let 可回退为变量赋值；
      // setup-maybe-ref 来自 const，若实际不是 ref 就不能赋值，因此回退 null。
      const altAssignment =
        bindingType === BindingTypes.SETUP_LET ? `${rawExp} = $event` : `null`
      assignmentExp = createCompoundExpression([
        `${eventArg} => (${context.helperString(IS_REF)}(${rawExp}) ? (`,
        createSimpleExpression(rawExp, false, exp.loc),
        `).value = $event : ${altAssignment})`,
      ])
    }
  } else {
    assignmentExp = createCompoundExpression([
      `${eventArg} => ((`,
      exp,
      `) = $event)`,
    ])
  }

  const props = [
    // 值向下传递：`modelValue: foo` 或自定义参数名。
    createObjectProperty(propName, dir.exp!),
    // 更新向上传递：`"onUpdate:modelValue": $event => (foo = $event)`。
    createObjectProperty(eventName, assignmentExp),
  ]

  // 不引用 v-for/v-slot 局部变量的赋值监听器可缓存为稳定函数。
  if (
    !__BROWSER__ &&
    context.prefixIdentifiers &&
    !context.inVOnce &&
    context.cacheHandlers &&
    !hasScopeRef(exp, context.identifiers)
  ) {
    props[1].value = context.cache(props[1].value)
  }

  // 组件需要自行解释修饰符：生成 `modelModifiers: { trim: true }`；具名 model 使用 `argModifiers`。
  if (dir.modifiers.length && node.tagType === ElementTypes.COMPONENT) {
    const modifiers = dir.modifiers
      .map(m => m.content)
      .map(m => (isSimpleIdentifier(m) ? m : JSON.stringify(m)) + `: true`)
      .join(`, `)
    const modifiersKey = arg
      ? isStaticExp(arg)
        ? `${arg.content}Modifiers`
        : createCompoundExpression([arg, ' + "Modifiers"'])
      : `modelModifiers`
    props.push(
      createObjectProperty(
        modifiersKey,
        createSimpleExpression(
          `{ ${modifiers} }`,
          false,
          dir.loc,
          ConstantTypes.CAN_CACHE,
        ),
      ),
    )
  }

  return createTransformProps(props)
}

/** 统一构造 DirectiveTransformResult，错误分支可返回空 props。 */
function createTransformProps(props: Property[] = []) {
  return { props }
}
