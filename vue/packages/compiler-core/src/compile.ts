import type { CompilerOptions } from './options'
import { baseParse } from './parser'
import {
  type DirectiveTransform,
  type NodeTransform,
  transform,
} from './transform'
import { type CodegenResult, generate } from './codegen'
import type { RootNode } from './ast'
import { extend, isString } from '@vue/shared'
import { transformIf } from './transforms/vIf'
import { transformFor } from './transforms/vFor'
import { transformExpression } from './transforms/transformExpression'
import { transformSlotOutlet } from './transforms/transformSlotOutlet'
import { transformElement } from './transforms/transformElement'
import { transformOn } from './transforms/vOn'
import { transformBind } from './transforms/vBind'
import { trackSlotScopes, trackVForSlotScopes } from './transforms/vSlot'
import { transformText } from './transforms/transformText'
import { transformOnce } from './transforms/vOnce'
import { transformModel } from './transforms/vModel'
import { transformFilter } from './compat/transformFilter'
import { ErrorCodes, createCompilerError, defaultOnError } from './errors'
import { transformMemo } from './transforms/vMemo'
import { transformVBindShorthand } from './transforms/transformVBindShorthand'

/**
 * 基础编译器的一组转换预设。
 *
 * 元组第一项是按顺序执行的节点转换，第二项是按指令名索引的指令转换。
 * 平台编译器（例如 compiler-dom）会在这组预设之外追加平台专用转换。
 */
export type TransformPreset = [
  NodeTransform[],
  Record<string, DirectiveTransform>,
]

/**
 * 创建平台无关的节点转换与指令转换集合。
 *
 * 转换顺序会影响 AST 结构和作用域追踪。例如 `v-for` 必须先登记其局部变量，
 * `transformExpression` 随后改写表达式时才能识别这些变量，避免错误地加上 `_ctx.`。
 * 结构指令也要先于元素转换执行，因为 `v-if` / `v-for` 会把原始元素包装成新的结构节点。
 *
 * @param prefixIdentifiers 是否把模板中的自由标识符改写成渲染上下文访问
 * @returns 节点转换列表与指令转换表
 */
export function getBaseTransformPreset(
  prefixIdentifiers?: boolean,
): TransformPreset {
  return [
    [
      transformVBindShorthand,
      transformOnce,
      transformIf,
      transformMemo,
      transformFor,
      ...(__COMPAT__ ? [transformFilter] : []),
      ...(!__BROWSER__ && prefixIdentifiers
        ? [
            // 顺序不可交换：先记录 v-for / v-slot 作用域，再改写表达式中的标识符。
            trackVForSlotScopes,
            transformExpression,
          ]
        : __BROWSER__ && __DEV__
          ? [transformExpression]
          : []),
      transformSlotOutlet,
      transformElement,
      trackSlotScopes,
      transformText,
    ],
    {
      on: transformOn,
      bind: transformBind,
      model: transformModel,
    },
  ]
}

/**
 * 执行平台无关的完整编译流程：模板解析 → AST 转换 → 渲染函数代码生成。
 *
 * 这里命名为 `baseCompile`，是为了让 `@vue/compiler-dom` 等上层编译器可以把
 * 自己加入平台选项后的入口命名为 `compile`，同时继续原样导出 compiler-core API。
 * 若传入的已经是 `RootNode`，会跳过解析阶段，供 SFC 编译器复用已经缓存的模板 AST。
 *
 * 浏览器版编译器使用 `with` 作用域，不能启用模块模式、标识符前缀等依赖构建时分析的能力；
 * 这些组合会在这里尽早报错，避免生成运行时无法执行的代码。
 *
 * @param source 模板源码，或已经解析好的根 AST
 * @param options 贯穿解析、转换和代码生成阶段的编译选项
 * @returns 生成的渲染函数代码、源码映射与 AST 等结果
 */
export function baseCompile(
  source: string | RootNode,
  options: CompilerOptions = {},
): CodegenResult {
  const onError = options.onError || defaultOnError
  const isModuleMode = options.mode === 'module'
  /* v8 ignore start */
  if (__BROWSER__) {
    if (options.prefixIdentifiers === true) {
      onError(createCompilerError(ErrorCodes.X_PREFIX_ID_NOT_SUPPORTED))
    } else if (isModuleMode) {
      onError(createCompilerError(ErrorCodes.X_MODULE_MODE_NOT_SUPPORTED))
    }
  }
  /* v8 ignore stop */

  const prefixIdentifiers =
    !__BROWSER__ && (options.prefixIdentifiers === true || isModuleMode)
  if (!prefixIdentifiers && options.cacheHandlers) {
    onError(createCompilerError(ErrorCodes.X_CACHE_HANDLER_NOT_SUPPORTED))
  }
  if (options.scopeId && !isModuleMode) {
    onError(createCompilerError(ErrorCodes.X_SCOPE_ID_NOT_SUPPORTED))
  }

  const resolvedOptions = extend({}, options, {
    prefixIdentifiers,
  })

  // 三段式编译管线。转换阶段直接修改 AST，并在节点上挂载 codegenNode；
  // generate 只消费这些代码生成节点，不再重新理解模板语义。
  const ast = isString(source) ? baseParse(source, resolvedOptions) : source
  const [nodeTransforms, directiveTransforms] =
    getBaseTransformPreset(prefixIdentifiers)

  if (!__BROWSER__ && options.isTS) {
    const { expressionPlugins } = options
    if (!expressionPlugins || !expressionPlugins.includes('typescript')) {
      options.expressionPlugins = [...(expressionPlugins || []), 'typescript']
    }
  }

  transform(
    ast,
    extend({}, resolvedOptions, {
      nodeTransforms: [
        ...nodeTransforms,
        // 用户转换排在基础转换之后，既能读取标准化后的结构，也能参与退出阶段处理。
        ...(options.nodeTransforms || []),
      ],
      directiveTransforms: extend(
        {},
        directiveTransforms,
        // 同名用户转换会覆盖基础实现，便于上层编译器替换指令语义。
        options.directiveTransforms || {},
      ),
    }),
  )

  return generate(ast, resolvedOptions)
}
