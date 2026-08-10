// 公共 `vite/module-runner` 入口只能重导出跨运行时实现；不要在这里引入 Node 专用模块，
// 否则浏览器、worker 与自定义 realm 即使只使用基础 Runner 也会被迫解析 Node 依赖。

export {
  EvaluatedModules,
  normalizeModuleId,
  type EvaluatedModuleNode,
} from './evaluatedModules'
export { ModuleRunner } from './runner'
export { ESModulesEvaluator } from './esmEvaluator'
export {
  createDefaultImportMeta,
  createNodeImportMeta,
} from './createImportMeta'

export { createWebSocketModuleRunnerTransport } from '../shared/moduleRunnerTransport'

export type { FetchFunctionOptions, FetchResult } from '../shared/invokeMethods'
export type {
  ModuleRunnerTransportHandlers,
  ModuleRunnerTransport,
} from '../shared/moduleRunnerTransport'
export type { HMRLogger } from '../shared/hmr'
export type {
  ModuleEvaluator,
  ModuleRunnerContext,
  FetchFunction,
  ResolvedResult,
  SSRImportMetadata,
  ModuleRunnerImportMeta,
  ModuleRunnerOptions,
  ModuleRunnerHmr,
} from './types'
export {
  ssrDynamicImportKey,
  ssrExportAllKey,
  ssrExportNameKey,
  ssrImportKey,
  ssrImportMetaKey,
  ssrModuleExportsKey,
} from './constants'
export type { InterceptorOptions } from './sourcemap/interceptor'
