/**
 * compiler-core 的公开 API 汇总入口。
 * baseCompile 负责完整客户端管线；平台编译器也可分别复用解析、转换、生成与 AST 工厂，
 * 覆盖指令转换或追加节点转换。此文件只重新导出实现，不持有解析或渲染状态。
 */
export { baseCompile } from './compile'

// 同时公开解析、转换、代码生成各阶段的底层 API 与 AST 类型，供平台编译器和工具链复用。
export {
  type CompilerOptions,
  type ParserOptions,
  type TransformOptions,
  type CodegenOptions,
  type HoistTransform,
  type BindingMetadata,
  BindingTypes,
} from './options'
export { baseParse } from './parser'
export {
  transform,
  type TransformContext,
  createTransformContext,
  traverseNode,
  createStructuralDirectiveTransform,
  type NodeTransform,
  type StructuralDirectiveTransform,
  type DirectiveTransform,
} from './transform'
export {
  generate,
  type CodegenContext,
  type CodegenResult,
  type CodegenSourceMapGenerator,
  type RawSourceMap,
} from './codegen'
export {
  ErrorCodes,
  errorMessages,
  createCompilerError,
  type CoreCompilerError,
  type CompilerError,
} from './errors'

export * from './ast'
export * from './utils'
export * from './babelUtils'
export * from './runtimeHelpers'

export { getBaseTransformPreset, type TransformPreset } from './compile'
export { transformModel } from './transforms/vModel'
export { transformOn } from './transforms/vOn'
export { transformBind } from './transforms/vBind'
export { noopDirectiveTransform } from './transforms/noopDirectiveTransform'
export { processIf } from './transforms/vIf'
export { processFor, createForLoopParams } from './transforms/vFor'
export {
  transformExpression,
  processExpression,
  stringifyExpression,
} from './transforms/transformExpression'
export {
  buildSlots,
  type SlotFnBuilder,
  trackVForSlotScopes,
  trackSlotScopes,
} from './transforms/vSlot'
export {
  transformElement,
  resolveComponentType,
  buildProps,
  buildDirectiveArgs,
  type PropsExpression,
} from './transforms/transformElement'
export { transformVBindShorthand } from './transforms/transformVBindShorthand'
export { processSlotOutlet } from './transforms/transformSlotOutlet'
export { getConstantType } from './transforms/cacheStatic'
export { generateCodeFrame } from '@vue/shared'

// 仅供 Vue 2 兼容构建使用。
export {
  checkCompatEnabled,
  warnDeprecation,
  CompilerDeprecationTypes,
} from './compat/compatConfig'
