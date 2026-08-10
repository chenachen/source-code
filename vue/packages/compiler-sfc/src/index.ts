/** 当前 `@vue/compiler-sfc` 构建版本，由构建常量注入。 */
export const version: string = __VERSION__

// 面向构建工具公开的主要编译 API。
export { parse } from './parse'
export { compileTemplate } from './compileTemplate'
export { compileStyle, compileStyleAsync } from './compileStyle'
export { compileScript } from './compileScript'
export { rewriteDefault, rewriteDefaultAST } from './rewriteDefault'
export { resolveTypeElements, inferRuntimeType } from './script/resolveType'

import { type SFCParseResult, parseCache as _parseCache } from './parse'
// #9521：公共类型只暴露标准 Map，避免用户的声明文件被迫依赖内部 lru-cache 类型。
export const parseCache = _parseCache as Map<string, SFCParseResult>

// 汇总 core 与 DOM 编译器错误文案，方便工具链按错误码统一展示。
import {
  DOMErrorMessages,
  errorMessages as coreErrorMessages,
} from '@vue/compiler-dom'

/** compiler-core 与 compiler-dom 的完整错误码文案表。 */
export const errorMessages: Record<number, string> = {
  ...coreErrorMessages,
  ...DOMErrorMessages,
}

// 提供给 Vue REPL、插件和上层工具复用的解析/AST 工具。
export { parse as babelParse } from '@babel/parser'
import MagicString from 'magic-string'
export { MagicString }
import { walk as _walk } from 'estree-walker'
/**
 * 遍历 ESTree 节点的兼容导出。它技术上属于内部能力，但 @vue/repl 需要使用；
 * 转为 any 避免公共 API 声明绑定 estree-walker 的具体节点类型。
 */
export const walk = _walk as any
export {
  generateCodeFrame,
  walkIdentifiers,
  extractIdentifiers,
  isInDestructureAssignment,
  isStaticProperty,
} from '@vue/compiler-core'

// 类型推导相关扩展点，供构建插件管理 TypeScript 和缓存失效。
export { invalidateTypeCache, registerTS } from './script/resolveType'
export { extractRuntimeProps } from './script/defineProps'
export { extractRuntimeEmits } from './script/defineEmits'

// SFC 各编译阶段的公共类型。
export type {
  SFCParseOptions,
  SFCParseResult,
  SFCDescriptor,
  SFCBlock,
  SFCTemplateBlock,
  SFCScriptBlock,
  SFCStyleBlock,
} from './parse'
export type {
  TemplateCompiler,
  SFCTemplateCompileOptions,
  SFCTemplateCompileResults,
} from './compileTemplate'
export type {
  SFCStyleCompileOptions,
  SFCAsyncStyleCompileOptions,
  SFCStyleCompileResults,
} from './compileStyle'
export type { SFCScriptCompileOptions } from './compileScript'
export type { ScriptCompileContext } from './script/context'
export type {
  TypeResolveContext,
  SimpleTypeResolveOptions,
  SimpleTypeResolveContext,
} from './script/resolveType'
export type {
  AssetURLOptions,
  AssetURLTagConfig,
} from './template/transformAssetUrl'
export type {
  CompilerOptions,
  CompilerError,
  BindingMetadata,
} from '@vue/compiler-core'

/**
 * @deprecated 仅为兼容 vite-plugin-vue < 5.0 的 `reactivityTransform: true` 保留。
 * 响应性语法转换已移除，但旧插件仍会调用该函数；固定返回 false 可静默忽略旧选项，
 * 避免升级 compiler-sfc 后直接因导出缺失而崩溃。
 */
export const shouldTransformRef = () => false
