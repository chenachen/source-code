import type {
  ArrayPattern,
  Identifier,
  LVal,
  Node,
  ObjectPattern,
  RestElement,
} from '@babel/types'
import { isCallOf } from './utils'
import type { ScriptCompileContext } from './context'
import {
  type TypeResolveContext,
  resolveTypeElements,
  resolveUnionType,
} from './resolveType'

/** `defineEmits` 编译宏名称。 */
export const DEFINE_EMITS = 'defineEmits'

/** 识别 defineEmits 的运行时/类型声明，并记录接收 emit 函数的变量。 */
export function processDefineEmits(
  ctx: ScriptCompileContext,
  node: Node,
  declId?: LVal,
): boolean {
  if (!isCallOf(node, DEFINE_EMITS)) {
    return false
  }
  if (ctx.hasDefineEmitCall) {
    ctx.error(`duplicate ${DEFINE_EMITS}() call`, node)
  }
  ctx.hasDefineEmitCall = true
  ctx.emitsRuntimeDecl = node.arguments[0]
  if (node.typeParameters) {
    if (ctx.emitsRuntimeDecl) {
      ctx.error(
        `${DEFINE_EMITS}() cannot accept both type and non-type arguments ` +
          `at the same time. Use one or the other.`,
        node,
      )
    }
    ctx.emitsTypeDecl = node.typeParameters.params[0]
  }

  ctx.emitDecl = declId

  return true
}

/**
 * 生成组件 `emits:` 选项；defineModel 还会隐式追加每个 `update:modelName` 事件。
 */
export function genRuntimeEmits(ctx: ScriptCompileContext): string | undefined {
  let emitsDecl = ''
  if (ctx.emitsRuntimeDecl) {
    emitsDecl = ctx.getString(ctx.emitsRuntimeDecl).trim()
  } else if (ctx.emitsTypeDecl) {
    const typeDeclaredEmits = extractRuntimeEmits(ctx)
    emitsDecl = typeDeclaredEmits.size
      ? `[${Array.from(typeDeclaredEmits)
          .map(k => JSON.stringify(k))
          .join(', ')}]`
      : ``
  }
  if (ctx.hasDefineModelCall) {
    let modelEmitsDecl = `[${Object.keys(ctx.modelDecls)
      .map(n => JSON.stringify(`update:${n}`))
      .join(', ')}]`
    emitsDecl = emitsDecl
      ? `/*@__PURE__*/${ctx.helper(
          'mergeModels',
        )}(${emitsDecl}, ${modelEmitsDecl})`
      : modelEmitsDecl
  }
  return emitsDecl
}

/**
 * 从 defineEmits 类型提取静态事件名。
 * 支持调用签名与 Vue 3.3 的属性式元组语法，但两种形式混用会产生含糊来源，因此报错。
 */
export function extractRuntimeEmits(ctx: TypeResolveContext): Set<string> {
  const emits = new Set<string>()
  const node = ctx.emitsTypeDecl!

  if (node.type === 'TSFunctionType') {
    extractEventNames(ctx, node.parameters[0], emits)
    return emits
  }

  const { props, calls } = resolveTypeElements(ctx, node)

  let hasProperty = false
  for (const key in props) {
    emits.add(key)
    hasProperty = true
  }

  if (calls) {
    if (hasProperty) {
      ctx.error(
        `defineEmits() type cannot mixed call signature and property syntax.`,
        node,
      )
    }
    for (const call of calls) {
      extractEventNames(ctx, call.parameters[0], emits)
    }
  }

  return emits
}

/** 从调用签名第一个参数的字符串字面量联合类型中收集事件名。 */
function extractEventNames(
  ctx: TypeResolveContext,
  eventName: ArrayPattern | Identifier | ObjectPattern | RestElement,
  emits: Set<string>,
) {
  if (
    eventName.type === 'Identifier' &&
    eventName.typeAnnotation &&
    eventName.typeAnnotation.type === 'TSTypeAnnotation'
  ) {
    const types = resolveUnionType(ctx, eventName.typeAnnotation.typeAnnotation)

    for (const type of types) {
      if (type.type === 'TSLiteralType') {
        if (
          type.literal.type !== 'UnaryExpression' &&
          type.literal.type !== 'TemplateLiteral'
        ) {
          emits.add(String(type.literal.value))
        }
      }
    }
  }
}
