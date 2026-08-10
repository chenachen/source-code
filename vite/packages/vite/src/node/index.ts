/**
 * `vite` 包的 Node 端公共出口。
 *
 * 该文件刻意只做 API 汇总与少量兼容别名，不承载实现逻辑。阅读源码时应从这里
 * 确认用户可见边界，再跳转到各实现模块；新增导出也必须同时考虑语义化版本与
 * Rolldown/Rollup 兼容承诺。
 */
import type * as Rolldown from 'rolldown'
import {
  parseAst as _parseAst,
  parseAstAsync as _parseAstAsync,
} from 'rolldown/parseAst'
import type * as Rollup from '#types/internal/rollupTypeCompat'

// 底层打包器与解析/压缩工具的受支持出口。
export type { Rollup, Rolldown }
export { esmExternalRequirePlugin } from 'rolldown/plugins'
export {
  parse,
  parseSync,
  type ParserOptions,
  type ParseResult,
  minify,
  minifySync,
  type MinifyOptions,
  type MinifyResult,
  Visitor,
  type VisitorObject,
  type ESTree,
} from 'rolldown/utils'

/** @deprecated 请改用 `parseSync`。 */
export const parseAst: typeof _parseAst = _parseAst
/** @deprecated 请改用 `parse`。 */
export const parseAstAsync: typeof _parseAstAsync = _parseAstAsync

// 配置、插件环境与三种主流程入口：开发、预览、构建。
export {
  defineConfig,
  loadConfigFromFile,
  resolveConfig,
  sortUserPlugins,
} from './config'
export { perEnvironmentPlugin } from './plugin'
export { perEnvironmentState } from './environment'
export { createServer } from './server'
export { preview } from './preview'
export { build, createBuilder } from './build'

// 可独立调用的依赖优化、解析与源码转换工具。
export { optimizeDeps } from './optimizer'
export { createIdResolver } from './idResolver'

export { formatPostcssSourceMap, preprocessCSS } from './plugins/css'
export { transformWithEsbuild } from './plugins/esbuild'
export { transformWithOxc } from './plugins/oxc'
export { buildErrorMessage } from './server/middlewares/error'

export {
  createRunnableDevEnvironment,
  isRunnableDevEnvironment,
  type RunnableDevEnvironment,
  type RunnableDevEnvironmentContext,
} from './server/environments/runnableEnvironment'
export {
  createFetchableDevEnvironment,
  isFetchableDevEnvironment,
  type FetchableDevEnvironment,
  type FetchableDevEnvironmentContext,
} from './server/environments/fetchableEnvironments'
export {
  DevEnvironment,
  type DevEnvironmentContext,
} from './server/environment'
// 环境运行器、SSR 模块获取/执行与服务端 HMR 桥接能力。
export { runnerImport } from './ssr/runnerImport'
export { BuildEnvironment } from './build'

export { fetchModule, type FetchModuleOptions } from './ssr/fetchModule'
export {
  createServerModuleRunner,
  createServerModuleRunnerTransport,
} from './ssr/runtime/serverModuleRunner'
export { createServerHotChannel } from './server/hmr'
export { ssrTransform as moduleRunnerTransform } from './ssr/ssrTransform'
export type { ModuleRunnerTransformOptions } from './ssr/ssrTransform'

export {
  VERSION as version,
  DEFAULT_CLIENT_CONDITIONS as defaultClientConditions,
  DEFAULT_CLIENT_MAIN_FIELDS as defaultClientMainFields,
  DEFAULT_EXTERNAL_CONDITIONS as defaultExternalConditions,
  DEFAULT_SERVER_CONDITIONS as defaultServerConditions,
  DEFAULT_SERVER_MAIN_FIELDS as defaultServerMainFields,
  defaultAllowedOrigins,
} from './constants'
// 历史兼容常量：Vite 当前不再以此值描述实际转换器版本，保留只为避免旧代码断裂。
export const esbuildVersion = '0.25.0'
export {
  normalizePath,
  mergeConfig,
  mergeAlias,
  createFilter,
  withFilter,
  isCSSRequest,
  rollupVersion,
  rolldownVersion,
} from './utils'
export { send } from './server/send'
export { createLogger } from './logger'
export { searchForWorkspaceRoot } from './server/searchRoot'

export {
  isFileServingAllowed,
  isFileLoadingAllowed,
} from './server/middlewares/static'
export { loadEnv, resolveEnvPrefix } from './env'

// Vite 自有公共类型。分组顺序大致对应配置、插件、服务器、构建和资源处理模块。
export type {
  AppType,
  ConfigEnv,
  ExperimentalOptions,
  HTMLOptions,
  InlineConfig,
  LegacyOptions,
  PluginHookUtils,
  ResolveFn,
  ResolvedWorkerOptions,
  ResolvedConfig,
  UserConfig,
  UserConfigExport,
  UserConfigFn,
  UserConfigFnObject,
  UserConfigFnPromise,
  EnvironmentOptions,
  DevEnvironmentOptions,
  ResolvedDevEnvironmentOptions,
} from './config'
export type { HtmlAssetSource } from './assetSource'
export type {
  Plugin,
  PluginOption,
  HookHandler,
  ConfigPluginContext,
  MinimalPluginContextWithoutEnvironment,
} from './plugin'
export type { Environment } from './environment'
export type { FilterPattern } from './utils'
export type { CorsOptions, CorsOrigin, CommonServerOptions } from './http'
export type {
  ViteDevServer,
  ServerOptions,
  FileSystemServeOptions,
  ServerHook,
  ResolvedServerOptions,
  ResolvedServerUrls,
  HttpServer,
} from './server'
export type {
  ViteBuilder,
  BuildAppHook,
  BuilderOptions,
  BuildOptions,
  BuildEnvironmentOptions,
  LibraryOptions,
  LibraryFormats,
  RenderBuiltAssetUrl,
  ResolvedBuildOptions,
  ResolvedBuildEnvironmentOptions,
  ModulePreloadOptions,
  ResolvedModulePreloadOptions,
  ResolveModulePreloadDependenciesFn,
} from './build'
export type {
  PreviewOptions,
  PreviewServer,
  PreviewServerHook,
  ResolvedPreviewOptions,
} from './preview'
export type {
  DepOptimizationMetadata,
  DepOptimizationOptions,
  DepOptimizationConfig,
  OptimizedDepInfo,
  ExportsData,
} from './optimizer'
export type {
  ResolvedSSROptions,
  SsrDepOptimizationConfig,
  SSROptions,
  SSRTarget,
} from './ssr'
export type {
  Logger,
  LogOptions,
  LogErrorOptions,
  LogLevel,
  LogType,
  LoggerOptions,
} from './logger'
export type {
  IndexHtmlTransform,
  IndexHtmlTransformHook,
  IndexHtmlTransformContext,
  IndexHtmlTransformResult,
  HtmlTagDescriptor,
} from './plugins/html'
export type {
  CSSOptions,
  CSSModulesOptions,
  PreprocessCSSResult,
  ResolvedCSSOptions,
  PostcssUserConfig,
  SassPreprocessorOptions,
  LessPreprocessorOptions,
  StylusPreprocessorOptions,
} from './plugins/css'
export type { JsonOptions } from './plugins/json'
export type { ESBuildOptions } from './plugins/esbuild'
export type { EsbuildTransformOptions } from '#types/internal/esbuildOptions'
export type { OxcOptions } from './plugins/oxc'
export type { Manifest, ManifestChunk } from './plugins/manifest'
export type { ResolveOptions, InternalResolveOptions } from './plugins/resolve'
export type { TerserOptions } from './plugins/terser'

export type {
  WebSocketServer,
  WebSocketClient,
  WebSocketCustomListener,
} from './server/ws'
export type { SkipInformation, PluginContainer } from './server/pluginContainer'
export type {
  EnvironmentModuleGraph,
  EnvironmentModuleNode,
  ResolvedUrl,
} from './server/moduleGraph'
export type { SendOptions } from './server/send'
export type { ProxyOptions } from './server/middlewares/proxy'
export type {
  TransformOptions,
  TransformResult,
} from './server/transformRequest'
export type {
  HmrOptions,
  WsOptions,
  HmrContext,
  HotUpdateOptions,
  HotChannelListener,
  HotChannel,
  ServerHotChannel,
  HotChannelClient,
  NormalizedHotChannel,
  NormalizedHotChannelClient,
  NormalizedServerHotChannel,
} from './server/hmr'

export type { FetchFunction, FetchResult } from 'vite/module-runner'
export type { ServerModuleRunnerOptions } from './ssr/runtime/serverModuleRunner'

export type { BindCLIShortcutsOptions, CLIShortcut } from './shortcuts'

export type {
  HMRPayload,
  HotPayload,
  ConnectedPayload,
  UpdatePayload,
  Update,
  FullReloadPayload,
  CustomPayload,
  PrunePayload,
  ErrorPayload,
} from '#types/hmrPayload'
export type {
  CustomEventMap,
  InferCustomEventPayload,
  InvalidatePayload,
} from '#types/customEvent'
export type {
  ImportGlobFunction,
  ImportGlobOptions,
  GeneralImportGlobOptions,
  KnownAsTypeMap,
  KnownQueryTypeMap,
} from '#types/importGlob'
export type { ChunkMetadata, CustomPluginOptionsVite } from '#types/metadata'

// Vite 配置表面直接引用的依赖包类型，在此转出以免用户依赖内部别名路径。
export type {
  AliasOptions,
  MapToFunction,
  ResolverFunction,
  ResolverObject,
  Alias,
} from '#dep-types/alias'
export type { Connect } from '#dep-types/connect'
export type { WebSocket, WebSocketAlias } from '#dep-types/ws'
export type * as HttpProxy from 'http-proxy-3'
export type { FSWatcher, WatchOptions } from '#dep-types/chokidar'
export type { Terser } from '#types/internal/terserOptions'
export type { RollupCommonJSOptions } from '#dep-types/commonjs'
export type { RollupDynamicImportVarsOptions } from '#dep-types/dynamicImportVars'
export type { Matcher, AnymatchPattern, AnymatchFn } from '#dep-types/anymatch'
export type { LightningCSSOptions } from '#types/internal/lightningcssOptions'

// 旧 API 的兼容出口；新代码应优先使用按环境拆分的 ModuleGraph 等新接口。
export type { ModuleGraph, ModuleNode } from './server/mixedModuleGraph'
