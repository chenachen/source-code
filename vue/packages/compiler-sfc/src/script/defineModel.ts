import type { LVal, Node, TSType } from '@babel/types'
import type { ScriptCompileContext } from './context'
import { inferRuntimeType } from './resolveType'
import { UNKNOWN_TYPE, isCallOf, toRuntimeTypeString } from './utils'
import { BindingTypes, unwrapTSNode } from '@vue/compiler-dom'

/** `defineModel` 编译宏名称。 */
export const DEFINE_MODEL = 'defineModel'

/** 单个具名 model 的类型、prop 选项和 useModel 运行时选项。 */
export interface ModelDecl {
  /** model 值的 TS 类型参数。 */
  type: TSType | undefined
  /** 用于生成 prop 的 options 源码。 */
  options: string | undefined
  /** 接收 defineModel 返回 ref 的局部变量名。 */
  identifier: string | undefined
  /** 静态可拆对象中被提升的 prop 选项节点；动态 options 不会填此数组。 */
  runtimeOptionNodes: Node[]
}

/**
 * 处理 `defineModel(name?, options?)`，登记隐式 prop/emit 并把宏改写为 useModel。
 * options 中 `get/set` 只属于 useModel，type/default/required 等只属于 prop；对象形状静态
 * 可知时会把两组源码拆开，避免把无关选项重复传到两端。
 * 静态可拆要求 ObjectExpression 无 spread/计算键；从后往前删除源码片段可保持后续
 * AST 原始位置。只有剥离的 prop 节点进入 runtimeOptionNodes 的局部引用检查，get/set
 * 留在 setup 闭包。动态对象/引用参数整段保留，当前不做同样的逐 prop 作用域检查。
 *
 * @param declId - 接收 model ref 的声明左值；只有简单 Identifier 写入 identifier。
 * @returns 是否识别到宏；重复静态模型名称通过 ctx.error 抛出诊断。
 */
export function processDefineModel(
  ctx: ScriptCompileContext,
  node: Node,
  declId?: LVal,
): boolean {
  if (!isCallOf(node, DEFINE_MODEL)) {
    return false
  }

  ctx.hasDefineModelCall = true

  const type =
    (node.typeParameters && node.typeParameters.params[0]) || undefined
  let modelName: string
  let options: Node | undefined
  const arg0 = node.arguments[0] && unwrapTSNode(node.arguments[0])
  const hasName =
    arg0 &&
    (arg0.type === 'StringLiteral' ||
      (arg0.type === 'TemplateLiteral' && arg0.expressions.length === 0))
  if (hasName) {
    modelName =
      arg0.type === 'StringLiteral' ? arg0.value : arg0.quasis[0].value.cooked!
    options = node.arguments[1]
  } else {
    modelName = 'modelValue'
    options = arg0
  }

  if (ctx.modelDecls[modelName]) {
    ctx.error(`duplicate model name ${JSON.stringify(modelName)}`, node)
  }

  let optionsString = options && ctx.getString(options)
  let optionsRemoved = !options
  const runtimeOptionNodes: Node[] = []

  if (
    options &&
    options.type === 'ObjectExpression' &&
    !options.properties.some(p => p.type === 'SpreadElement' || p.computed)
  ) {
    let removed = 0
    for (let i = options.properties.length - 1; i >= 0; i--) {
      const p = options.properties[i]
      const next = options.properties[i + 1]
      const start = p.start!
      const end = next ? next.start! : options.end! - 1
      if (
        (p.type === 'ObjectProperty' || p.type === 'ObjectMethod') &&
        ((p.key.type === 'Identifier' &&
          (p.key.name === 'get' || p.key.name === 'set')) ||
          (p.key.type === 'StringLiteral' &&
            (p.key.value === 'get' || p.key.value === 'set')))
      ) {
        // get/set 是 useModel 的值转换器，从生成 prop 的 optionsString 中删除。
        optionsString =
          optionsString.slice(0, start - options.start!) +
          optionsString.slice(end - options.start!)
      } else {
        // type/default/required 等属于 prop，从原宏调用的 useModel options 中删除。
        removed++
        ctx.s.remove(ctx.startOffset! + start, ctx.startOffset! + end)
        // 记录这些提升到组件选项的节点，稍后禁止其引用 setup 局部变量。
        runtimeOptionNodes.push(p)
      }
    }
    if (removed === options.properties.length) {
      optionsRemoved = true
      ctx.s.remove(
        ctx.startOffset! + (hasName ? arg0.end! : options.start!),
        ctx.startOffset! + options.end!,
      )
    }
  }

  ctx.modelDecls[modelName] = {
    type,
    options: optionsString,
    runtimeOptionNodes,
    identifier:
      declId && declId.type === 'Identifier' ? declId.name : undefined,
  }
  // model 同时是 prop，在模板表达式中按 props binding 处理。
  ctx.bindingMetadata[modelName] = BindingTypes.PROPS

  // 宏本身不存在于运行时，改写为导入别名 `_useModel`。
  ctx.s.overwrite(
    ctx.startOffset! + node.callee.start!,
    ctx.startOffset! + node.callee.end!,
    ctx.helper('useModel'),
  )
  // useModel 首参始终为生成的 __props；省略名称时补默认 `modelValue`。
  ctx.s.appendLeft(
    ctx.startOffset! +
      (node.arguments.length ? node.arguments[0].start! : node.end! - 1),
    `__props, ` +
      (hasName
        ? ``
        : `${JSON.stringify(modelName)}${optionsRemoved ? `` : `, `}`),
  )

  return true
}

/**
 * 为所有 defineModel 生成隐式 model prop 与对应 modifiers prop。
 * 开发环境保留类型校验；生产仅保留会影响 Boolean/Function 语义的类型。
 * 未知类型与 Boolean/Function 共存时去掉 Unknown 并在开发加 skipCheck；其余未知类型
 * 退为 type:null。用户运行时 options 后合并，可覆盖推导选项；TS 用 spread，JS 用 assign。
 * 默认 modelValue 配 modelModifiers，具名模型配 nameModifiers，即使无类型也生成修饰符 prop。
 */
export function genModelProps(ctx: ScriptCompileContext): string | undefined {
  if (!ctx.hasDefineModelCall) return

  const isProd = !!ctx.options.isProd
  let modelPropsDecl = ''
  for (const [name, { type, options: runtimeOptions }] of Object.entries(
    ctx.modelDecls,
  )) {
    let skipCheck = false
    let codegenOptions = ``
    let runtimeTypes = type && inferRuntimeType(ctx, type)
    if (runtimeTypes) {
      const hasBoolean = runtimeTypes.includes('Boolean')
      const hasFunction = runtimeTypes.includes('Function')
      const hasUnknownType = runtimeTypes.includes(UNKNOWN_TYPE)

      if (hasUnknownType) {
        if (hasBoolean || hasFunction) {
          runtimeTypes = runtimeTypes.filter(t => t !== UNKNOWN_TYPE)
          skipCheck = true
        } else {
          runtimeTypes = ['null']
        }
      }

      if (!isProd) {
        codegenOptions =
          `type: ${toRuntimeTypeString(runtimeTypes)}` +
          (skipCheck ? ', skipCheck: true' : '')
      } else if (hasBoolean || (runtimeOptions && hasFunction)) {
        // Boolean 类型影响属性强制转换；Function 若可能带 default，类型用于区分函数值/工厂。
        codegenOptions = `type: ${toRuntimeTypeString(runtimeTypes)}`
      } else {
        // 其余类型只服务开发校验，生产可删除。
      }
    }

    let decl: string
    if (codegenOptions && runtimeOptions) {
      decl = ctx.isTS
        ? `{ ${codegenOptions}, ...${runtimeOptions} }`
        : `Object.assign({ ${codegenOptions} }, ${runtimeOptions})`
    } else if (codegenOptions) {
      decl = `{ ${codegenOptions} }`
    } else if (runtimeOptions) {
      decl = runtimeOptions
    } else {
      decl = `{}`
    }
    modelPropsDecl += `\n    ${JSON.stringify(name)}: ${decl},`

    // 每个 model 都伴随 modifiers prop，供 `.trim/.number` 或自定义修饰符传给 useModel。
    const modifierPropName = JSON.stringify(
      name === 'modelValue' ? `modelModifiers` : `${name}Modifiers`,
    )
    modelPropsDecl += `\n    ${modifierPropName}: {},`
  }
  return `{${modelPropsDecl}\n  }`
}
