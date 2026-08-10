import type {
  Expression,
  LVal,
  Node,
  ObjectExpression,
  ObjectMethod,
  ObjectProperty,
} from '@babel/types'
import { BindingTypes, isFunctionType, unwrapTSNode } from '@vue/compiler-dom'
import type { ScriptCompileContext } from './context'
import {
  type TypeResolveContext,
  inferRuntimeType,
  resolveTypeElements,
} from './resolveType'
import {
  UNKNOWN_TYPE,
  concatStrings,
  getEscapedPropName,
  isCallOf,
  isLiteralNode,
  resolveObjectKey,
  toRuntimeTypeString,
} from './utils'
import { genModelProps } from './defineModel'
import { getObjectOrArrayExpressionKeys } from './analyzeScriptBindings'
import { processPropsDestructure } from './definePropsDestructure'

/** `defineProps` 编译宏名称。 */
export const DEFINE_PROPS = 'defineProps'
/** `withDefaults` 编译宏名称。 */
export const WITH_DEFAULTS = 'withDefaults'

/** 从类型声明推导出的单个运行时 prop 信息。 */
export interface PropTypeData {
  /** 对外 prop 名。 */
  key: string
  /** Vue 运行时构造器名称列表。 */
  type: string[]
  /** TS 属性是否为必填。 */
  required: boolean
  /** 是否因联合类型含未知分支而跳过运行时类型校验。 */
  skipCheck: boolean
}

/** prop 公共名到解构局部名及默认值的映射。 */
export type PropsDestructureBindings = Record<
  string, // 对外 prop 名
  {
    /** 本地标识符，别名解构时可与公共名不同。 */
    local: string
    /** 解构语法中声明的默认值表达式。 */
    default?: Expression
  }
>

/**
 * 识别 defineProps 的运行时或类型声明，登记 props binding，并处理响应式解构。
 * 同一次调用不能同时给类型参数和运行时参数，因为两者都会定义完整 props 来源。
 */
export function processDefineProps(
  ctx: ScriptCompileContext,
  node: Node,
  declId?: LVal,
  isWithDefaults = false,
): boolean {
  if (!isCallOf(node, DEFINE_PROPS)) {
    return processWithDefaults(ctx, node, declId)
  }

  if (ctx.hasDefinePropsCall) {
    ctx.error(`duplicate ${DEFINE_PROPS}() call`, node)
  }
  ctx.hasDefinePropsCall = true
  ctx.propsRuntimeDecl = node.arguments[0]

  // 运行时对象/数组声明中的静态键可立即登记为模板 props binding。
  if (ctx.propsRuntimeDecl) {
    for (const key of getObjectOrArrayExpressionKeys(ctx.propsRuntimeDecl)) {
      if (!(key in ctx.bindingMetadata)) {
        ctx.bindingMetadata[key] = BindingTypes.PROPS
      }
    }
  }

  // 类型参数留到 resolveType 阶段推导运行时 props 配置。
  if (node.typeParameters) {
    if (ctx.propsRuntimeDecl) {
      ctx.error(
        `${DEFINE_PROPS}() cannot accept both type and non-type arguments ` +
          `at the same time. Use one or the other.`,
        node,
      )
    }
    ctx.propsTypeDecl = node.typeParameters.params[0]
  }

  // withDefaults 会禁用响应式解构；直接解构则记录别名/默认值并在后续重写引用。
  if (!isWithDefaults && declId && declId.type === 'ObjectPattern') {
    processPropsDestructure(ctx, declId)
  }

  ctx.propsCall = node
  ctx.propsDecl = declId

  return true
}

/**
 * 处理 `withDefaults(defineProps<T>(), defaults)`。
 * 它只适用于类型式 props；对象字面量默认值可编译期内联，动态 defaults 则运行时合并。
 */
function processWithDefaults(
  ctx: ScriptCompileContext,
  node: Node,
  declId?: LVal,
): boolean {
  if (!isCallOf(node, WITH_DEFAULTS)) {
    return false
  }
  if (
    !processDefineProps(
      ctx,
      node.arguments[0],
      declId,
      true /* isWithDefaults */,
    )
  ) {
    ctx.error(
      `${WITH_DEFAULTS}' first argument must be a ${DEFINE_PROPS} call.`,
      node.arguments[0] || node,
    )
  }

  if (ctx.propsRuntimeDecl) {
    ctx.error(
      `${WITH_DEFAULTS} can only be used with type-based ` +
        `${DEFINE_PROPS} declaration.`,
      node,
    )
  }
  if (declId && declId.type === 'ObjectPattern') {
    ctx.warn(
      `${WITH_DEFAULTS}() is unnecessary when using destructure with ${DEFINE_PROPS}().\n` +
        `Reactive destructure will be disabled when using withDefaults().\n` +
        `Prefer using destructure default values, e.g. const { foo = 1 } = defineProps(...). `,
      node.callee,
    )
  }
  ctx.propsRuntimeDefaults = node.arguments[1]
  if (!ctx.propsRuntimeDefaults) {
    ctx.error(`The 2nd argument of ${WITH_DEFAULTS} is required.`, node)
  }
  ctx.propsCall = node

  return true
}

/**
 * 生成组件 `props:` 选项源码，并与 defineModel 隐式 props 合并。
 */
export function genRuntimeProps(ctx: ScriptCompileContext): string | undefined {
  let propsDecls: undefined | string

  if (ctx.propsRuntimeDecl) {
    propsDecls = ctx.getString(ctx.propsRuntimeDecl).trim()
    if (ctx.propsDestructureDecl) {
      const defaults: string[] = []
      for (const key in ctx.propsDestructuredBindings) {
        const d = genDestructuredDefaultValue(ctx, key)
        const finalKey = getEscapedPropName(key)
        if (d)
          defaults.push(
            `${finalKey}: ${d.valueString}${
              d.needSkipFactory ? `, __skip_${finalKey}: true` : ``
            }`,
          )
      }
      if (defaults.length) {
        propsDecls = `/*@__PURE__*/${ctx.helper(
          `mergeDefaults`,
        )}(${propsDecls}, {\n  ${defaults.join(',\n  ')}\n})`
      }
    }
  } else if (ctx.propsTypeDecl) {
    propsDecls = extractRuntimeProps(ctx)
  }

  const modelsDecls = genModelProps(ctx)

  if (propsDecls && modelsDecls) {
    return `/*@__PURE__*/${ctx.helper(
      'mergeModels',
    )}(${propsDecls}, ${modelsDecls})`
  } else {
    return modelsDecls || propsDecls
  }
}

/** 从 defineProps 的 TS 类型声明提取并生成运行时 props 对象源码。 */
export function extractRuntimeProps(
  ctx: TypeResolveContext,
): string | undefined {
  // 调用契约保证 propsTypeDecl 存在。
  const props = resolveRuntimePropsFromType(ctx, ctx.propsTypeDecl!)
  if (!props.length) {
    return
  }

  const propStrings: string[] = []
  const hasStaticDefaults = hasStaticWithDefaults(ctx)

  for (const prop of props) {
    propStrings.push(genRuntimePropFromType(ctx, prop, hasStaticDefaults))
    // 类型式声明也要登记 props binding，供模板与 script setup 表达式改写使用。
    if ('bindingMetadata' in ctx && !(prop.key in ctx.bindingMetadata)) {
      ctx.bindingMetadata[prop.key] = BindingTypes.PROPS
    }
  }

  let propsDecls = `{
    ${propStrings.join(',\n    ')}\n  }`

  if (ctx.propsRuntimeDefaults && !hasStaticDefaults) {
    propsDecls = `/*@__PURE__*/${ctx.helper(
      'mergeDefaults',
    )}(${propsDecls}, ${ctx.getString(ctx.propsRuntimeDefaults)})`
  }

  return propsDecls
}

/** 将类型成员解析为运行时构造器、必填性和校验策略。 */
function resolveRuntimePropsFromType(
  ctx: TypeResolveContext,
  node: Node,
): PropTypeData[] {
  const props: PropTypeData[] = []
  const elements = resolveTypeElements(ctx, node)
  for (const key in elements.props) {
    const e = elements.props[key]
    let type = inferRuntimeType(ctx, e)
    let skipCheck = false
    // 联合类型含未知分支时，Boolean/Function 仍需保留其特殊运行时语义，但不能严格校验；
    // 其他未知组合降级为 null（任意类型）。
    if (type.includes(UNKNOWN_TYPE)) {
      if (type.includes('Boolean') || type.includes('Function')) {
        type = type.filter(t => t !== UNKNOWN_TYPE)
        skipCheck = true
      } else {
        type = ['null']
      }
    }
    props.push({
      key,
      required: !e.optional,
      type: type || [`null`],
      skipCheck,
    })
  }
  return props
}

/**
 * 为单个类型式 prop 生成开发/生产环境适用的运行时选项。
 * 开发保留完整 type/required 校验；生产只保留会影响 Boolean 转换、Function 默认值或
 * Custom Element 属性转换的类型信息。
 */
function genRuntimePropFromType(
  ctx: TypeResolveContext,
  { key, required, type, skipCheck }: PropTypeData,
  hasStaticDefaults: boolean,
): string {
  let defaultString: string | undefined
  const destructured = genDestructuredDefaultValue(ctx, key, type)
  if (destructured) {
    defaultString = `default: ${destructured.valueString}${
      destructured.needSkipFactory ? `, skipFactory: true` : ``
    }`
  } else if (hasStaticDefaults) {
    const prop = (ctx.propsRuntimeDefaults as ObjectExpression).properties.find(
      node => {
        if (node.type === 'SpreadElement') return false
        return resolveObjectKey(node.key, node.computed) === key
      },
    ) as ObjectProperty | ObjectMethod
    if (prop) {
      if (prop.type === 'ObjectProperty') {
        // 静态 defaults 对象中找到同名属性，可直接内联默认值而无需 mergeDefaults。
        defaultString = `default: ${ctx.getString(prop.value)}`
      } else {
        let paramsString = ''
        if (prop.params.length) {
          const start = prop.params[0].start
          const end = prop.params[prop.params.length - 1].end
          paramsString = ctx.getString({ start, end } as Node)
        }
        defaultString = `${prop.async ? 'async ' : ''}${
          prop.kind !== 'method' ? `${prop.kind} ` : ''
        }default(${paramsString}) ${ctx.getString(prop.body)}`
      }
    }
  }

  const finalKey = getEscapedPropName(key)
  if (!ctx.options.isProd) {
    return `${finalKey}: { ${concatStrings([
      `type: ${toRuntimeTypeString(type)}`,
      `required: ${required}`,
      skipCheck && 'skipCheck: true',
      defaultString,
    ])} }`
  } else if (
    type.some(
      el =>
        el === 'Boolean' ||
        ((!hasStaticDefaults || defaultString) && el === 'Function'),
    )
  ) {
    // #4783：Boolean 类型决定空属性/同名字符串的强制转换，生产环境也不能删。
    // #7111：Function 存在默认值或 defaults 非静态时，保留类型才能区分“函数值”与
    // “返回默认对象的工厂函数”。
    return `${finalKey}: { ${concatStrings([
      `type: ${toRuntimeTypeString(type)}`,
      defaultString,
    ])} }`
  } else {
    // #8989：Custom Element 需要运行时类型把 attribute 字符串转换为对应 property 值。
    if (ctx.isCE) {
      if (defaultString) {
        return `${finalKey}: ${`{ ${defaultString}, type: ${toRuntimeTypeString(
          type,
        )} }`}`
      } else {
        return `${finalKey}: {type: ${toRuntimeTypeString(type)}}`
      }
    }

    // 普通组件生产构建无需 required/type 校验，仅保留可能存在的 default。
    return `${finalKey}: ${defaultString ? `{ ${defaultString} }` : `{}`}`
  }
}

/**
 * 判断 withDefaults 参数是否为仅含静态键的对象字面量。
 * 静态时可把每个默认值直接编进对应 prop；含 spread/动态键时只能运行时 mergeDefaults。
 */
function hasStaticWithDefaults(ctx: TypeResolveContext) {
  return !!(
    ctx.propsRuntimeDefaults &&
    ctx.propsRuntimeDefaults.type === 'ObjectExpression' &&
    ctx.propsRuntimeDefaults.properties.every(
      node =>
        node.type !== 'SpreadElement' &&
        (!node.computed || node.key.type.endsWith('Literal')),
    )
  )
}

/**
 * 生成解构默认值的 runtime props 表示，并做尽力而为的类型匹配检查。
 * 对象/数组默认值通常要包工厂；Function prop 或无法判断类型的函数/外部标识符需跳过
 * 工厂包装，避免把用户期望的函数值误执行。
 */
function genDestructuredDefaultValue(
  ctx: TypeResolveContext,
  key: string,
  inferredType?: string[],
):
  | {
      /** 默认值表达式对应的生成代码。 */
      valueString: string
      /** 是否禁止把对象/数组默认值自动包装为工厂函数。 */
      needSkipFactory: boolean
    }
  | undefined {
  const destructured = ctx.propsDestructuredBindings[key]
  const defaultVal = destructured && destructured.default
  if (defaultVal) {
    const value = ctx.getString(defaultVal)
    const unwrapped = unwrapTSNode(defaultVal)

    if (inferredType && inferredType.length && !inferredType.includes('null')) {
      const valueType = inferValueType(unwrapped)
      if (valueType && !inferredType.includes(valueType)) {
        ctx.error(
          `Default value of prop "${key}" does not match declared type.`,
          unwrapped,
        )
      }
    }

    // 运行时式声明的解构无法安全推导 prop 是否为 Function。默认值是函数或外部标识符时
    // 标记 skipFactory，避免运行时误把它当默认值工厂调用。
    const needSkipFactory =
      !inferredType &&
      (isFunctionType(unwrapped) || unwrapped.type === 'Identifier')

    const needFactoryWrap =
      !needSkipFactory &&
      !isLiteralNode(unwrapped) &&
      !inferredType?.includes('Function')

    return {
      valueString: needFactoryWrap ? `() => (${value})` : value,
      needSkipFactory,
    }
  }
}

/**
 * 对运行时默认值做非完备、尽力而为的构造器推导，用于提前发现解构默认值与 TS prop
 * 类型明显不匹配；无法可靠判断的表达式返回 undefined，不做误报。
 */
function inferValueType(node: Node): string | undefined {
  switch (node.type) {
    case 'StringLiteral':
      return 'String'
    case 'NumericLiteral':
      return 'Number'
    case 'BooleanLiteral':
      return 'Boolean'
    case 'ObjectExpression':
      return 'Object'
    case 'ArrayExpression':
      return 'Array'
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return 'Function'
  }
}
