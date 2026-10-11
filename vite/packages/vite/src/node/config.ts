import fs from 'node:fs'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { inspect, promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import {
  getEnv,
  ignoreInput,
  ignoreOutput,
} from '@voidzero-dev/vite-task-client'
import colors from 'picocolors'
import picomatch from 'picomatch'
import { freshImport } from 'fresh-import'
import {
  type InputOption,
  type NormalizedOutputOptions,
  type OutputChunk,
  type PluginContextMeta,
  type RolldownOptions,
  rolldown,
} from 'rolldown'
import { isDynamicPattern } from 'tinyglobby'
import type {
  DevToolsConfig,
  ResolvedDevToolsConfig,
} from '@vitejs/devtools/config'
import type { Alias, AliasOptions } from '#dep-types/alias'
import type { AnymatchFn } from '../types/anymatch'
import { withTrailingSlash } from '../shared/utils'
import {
  createImportMetaResolver,
  importMetaResolveWithCustomHookString,
} from '../module-runner/importMetaResolver'
import {
  CLIENT_ENTRY,
  DEFAULT_ASSETS_RE,
  DEFAULT_CLIENT_CONDITIONS,
  DEFAULT_CLIENT_MAIN_FIELDS,
  DEFAULT_CONFIG_FILES,
  DEFAULT_EXTENSIONS,
  DEFAULT_EXTERNAL_CONDITIONS,
  DEFAULT_PREVIEW_PORT,
  DEFAULT_SERVER_CONDITIONS,
  DEFAULT_SERVER_MAIN_FIELDS,
  ENV_ENTRY,
  FS_PREFIX,
} from './constants'
import { resolveEnvironmentPlugins } from './plugin'
import type {
  FalsyPlugin,
  HookHandler,
  Plugin,
  PluginOption,
  PluginWithRequiredHook,
} from './plugin'
import type {
  BuildEnvironmentOptions,
  BuilderOptions,
  RenderBuiltAssetUrl,
  ResolvedBuildEnvironmentOptions,
  ResolvedBuildOptions,
  ResolvedBuilderOptions,
} from './build'
import {
  buildEnvironmentOptionsDefaults,
  builderOptionsDefaults,
  resolveBuildEnvironmentOptions,
  resolveBuilderOptions,
} from './build'
import type { ResolvedServerOptions, ServerOptions } from './server'
import { resolveServerOptions, serverConfigDefaults } from './server'
import { DevEnvironment } from './server/environment'
import { createRunnableDevEnvironment } from './server/environments/runnableEnvironment'
import type { WebSocketServer } from './server/ws'
import type { PreviewOptions, ResolvedPreviewOptions } from './preview'
import { resolvePreviewOptions } from './preview'
import {
  type CSSOptions,
  type ResolvedCSSOptions,
  cssConfigDefaults,
  resolveCSSOptions,
} from './plugins/css'
import {
  arraify,
  asyncFlatten,
  createDebugger,
  createFilter,
  deepClone,
  getFileStartIndex,
  hasBothRollupOptionsAndRolldownOptions,
  isExternalUrl,
  isFilePathESM,
  isInNodeModules,
  isNodeBuiltin,
  isNodeLikeBuiltin,
  isObject,
  isParentDirectory,
  lineTerminatorRE,
  mergeAlias,
  mergeConfig,
  mergeWithDefaults,
  nodeLikeBuiltins,
  normalizeAlias,
  normalizePath,
  resolveHostname,
  safeRealpathSync,
  setupRollupOptionCompat,
} from './utils'
import {
  createPluginHookUtils,
  getHookHandler,
  getSortedPluginsByHook,
  resolvePlugins,
} from './plugins'
import type { ESBuildOptions } from './plugins/esbuild'
import {
  type EnvironmentResolveOptions,
  type InternalResolveOptions,
  type ResolveOptions,
} from './plugins/resolve'
import type { LogLevel, Logger } from './logger'
import { createLogger } from './logger'
import {
  createNativeConfigCompatPlugin,
  formatNativeConfigIncompatWarning,
  type NativeConfigIncompatibility,
} from './nativeConfigCompat'
import type { DepOptimizationOptions } from './optimizer'
import type { JsonOptions } from './plugins/json'
import type { HtmlAssetSource } from './assetSource'
import type { PackageCache } from './packages'
import { findNearestNodeModules, findNearestPackageData } from './packages'
import { loadEnv, resolveEnvPrefix } from './env'
import type { ResolvedSSROptions, SSROptions } from './ssr'
import { resolveSSROptions, ssrConfigDefaults } from './ssr'
import { PartialEnvironment } from './baseEnvironment'
import { createIdResolver } from './idResolver'
import { runnerImport } from './ssr/runnerImport'
import { getAdditionalAllowedHosts } from './server/middlewares/hostCheck'
import { convertEsbuildPluginToRolldownPlugin } from './optimizer/pluginConverter'
import { type OxcOptions, convertEsbuildConfigToOxcConfig } from './plugins/oxc'
import type { RequiredExceptFor } from './typeUtils'
import {
  BasicMinimalPluginContext,
  basePluginContextMeta,
} from './server/pluginContainer'
import { nodeResolveWithVite } from './nodeResolve'

/** `vite:config` 命名空间的调试输出器；深度 10 足以展开嵌套环境配置。 */
const debug = createDebugger('vite:config', { depth: 10 })
/** Promise 形式的 `fs.realpath`，用于把配置依赖路径解析到真实文件。 */
const promisifiedRealpath = promisify(fs.realpath)
/**
 * 标记配置已经完成解析的内部唯一符号。
 * 使用 symbol 而不是公开字符串字段，避免用户配置恰好包含同名键而被误判。
 */
const SYMBOL_RESOLVED_CONFIG: unique symbol = Symbol('vite:resolved-config')

/** 传给函数式用户配置和插件 `config` 钩子的当前命令环境。 */
export interface ConfigEnv {
  /**
   * 当前执行命令：`serve` 表示服务器流程，`build` 表示生产构建（`vite build`）。
   * preview 也传入 `serve`，但使用 production mode 并通过 `isPreview` 区分。
   */
  command: 'build' | 'serve'
  /** 当前 mode；决定 `.env.[mode]` 和函数式配置分支。 */
  mode: string
  /** 是否正在执行旧式 SSR 构建入口。 */
  isSsrBuild?: boolean
  /** 是否由 `vite preview` 发起配置解析。 */
  isPreview?: boolean
}

/**
 * 应用的 HTML 处理模型。
 *
 * - `spa`：开发和预览服务器通过 HTML fallback 中间件回退到 `index.html`。
 * - `mpa`：保留 HTML 中间件，但不把未知路径回退到 `index.html`。
 * - `custom`：不注册 Vite HTML 中间件，供 SSR 框架等自行处理 HTML。
 */
export type AppType = 'spa' | 'mpa' | 'custom'

/** 同步函数式配置：根据命令环境返回配置对象。 */
export type UserConfigFnObject = (env: ConfigEnv) => UserConfig
/** 异步函数式配置：根据命令环境返回配置 Promise。 */
export type UserConfigFnPromise = (env: ConfigEnv) => Promise<UserConfig>
/** 可同步或异步返回用户配置的通用函数类型。 */
export type UserConfigFn = (env: ConfigEnv) => UserConfig | Promise<UserConfig>

/** `vite.config.*` 默认导出允许采用的全部形式。 */
export type UserConfigExport =
  | UserConfig
  | Promise<UserConfig>
  | UserConfigFnObject
  | UserConfigFnPromise
  | UserConfigFn

/**
 * 为 `vite.config.ts` 提供类型推断的辅助函数。
 *
 * 接受 {@link UserConfig} 对象、Promise 或接收 {@link ConfigEnv} 的函数式配置。
 * 运行时直接返回原值，不做合并或解析；真正处理发生在 `resolveConfig()`。
 *
 * @param config - 用户配置导出。
 * @returns 与输入完全相同的配置值。
 */
export function defineConfig(config: UserConfig): UserConfig
/** 保留 Promise 配置的异步类型推断并原样返回。 */
export function defineConfig(config: Promise<UserConfig>): Promise<UserConfig>
/** 保留同步函数式配置的参数与返回类型。 */
export function defineConfig(config: UserConfigFnObject): UserConfigFnObject
/** 保留异步函数式配置的参数与返回类型。 */
export function defineConfig(config: UserConfigFnPromise): UserConfigFnPromise
/** 保留可同步或异步函数式配置的联合类型。 */
export function defineConfig(config: UserConfigFn): UserConfigFn
/** 汇总全部合法配置导出形式的重载。 */
export function defineConfig(config: UserConfigExport): UserConfigExport
/** 运行时不转换配置，仅返回同一输入值。 */
export function defineConfig(config: UserConfigExport): UserConfigExport {
  return config
}

/** 创建 Dev Environment 时由服务器提供、但不属于静态配置的运行时上下文。 */
export interface CreateDevEnvironmentContext {
  /** Dev Server 共用的 HMR WebSocket 通道。 */
  ws: WebSocketServer
}

/** 单个 Environment 在开发阶段的行为配置。 */
export interface DevEnvironmentOptions {
  /**
   * 服务器启动后预转换的文件列表，支持 glob。
   * 适合提前处理首屏模块，降低浏览器首次请求时的转换延迟。
   */
  warmup?: string[]
  /**
   * 是否在转换入口时继续预转换已知直接依赖。
   * client 环境默认 `true`，其他环境默认 `false`。
   */
  preTransformRequests?: boolean
  /**
   * 是否在开发阶段生成 Source Map；可分别控制 JS 和 CSS。
   * @default { js: true }
   * @experimental
   */
  sourcemap?:
    | boolean
    | {
        /** 是否为 JavaScript/TypeScript 转换生成 Source Map。 */
        js?: boolean
        /** 是否为 CSS 转换生成 Source Map。 */
        css?: boolean
      }
  /**
   * 决定哪些源码写入 Source Map 的 `x_google_ignoreList` 扩展，使浏览器调试器默认
   * 跳过第三方代码。
   *
   * 默认忽略包含 `node_modules` 的路径。传 `false` 可完全关闭；传函数可根据源码路径
   * 和 Source Map 路径逐项决定。
   *
   * @see https://developer.chrome.com/blog/devtools-better-angular-debugging/#the-x_google_ignorelist-source-map-extension
   */
  sourcemapIgnoreList?:
    | false
    | ((sourcePath: string, sourcemapPath: string) => boolean)

  /**
   * 创建自定义 Dev Environment 实例。
   * 未提供时，client 使用浏览器环境实现，其他环境使用可运行环境实现。
   */
  createEnvironment?: (
    name: string,
    config: ResolvedConfig,
    context: CreateDevEnvironmentContext,
  ) => Promise<DevEnvironment> | DevEnvironment

  /**
   * 环境是否允许在服务器重启时通过提前抛错中止当前文件处理。
   *
   * client 支持 full reload，可安全终止旧请求；SSR 请求可能仍需完成，所以默认行为
   * 不同。该开关主要服务 Environment API 的重启恢复流程。
   * @experimental
   */
  recoverable?: boolean

  /**
   * 是否把模块转换成 Module Runner 可执行格式。
   * client consumer 默认 `false`，server consumer 默认 `true`；也是已移除
   * `experimental.skipSsrTransform` 配置的替代项。
   */
  moduleRunnerTransform?: boolean
}

/**
 * 创建默认 client Dev Environment。
 *
 * client 通过 WebSocket 接收 HMR，不允许服务端 `fetchModule`，因为模块由浏览器请求
 * 和执行。其他环境的默认实现与此不同。
 */
function defaultCreateClientDevEnvironment(
  name: string,
  config: ResolvedConfig,
  context: CreateDevEnvironmentContext,
) {
  return new DevEnvironment(name, config, {
    hot: true,
    transport: context.ws,
    disableFetchModule: true,
  })
}

/** 创建默认非 client 可运行环境，由服务端 Module Runner 加载模块。 */
function defaultCreateDevEnvironment(name: string, config: ResolvedConfig) {
  return createRunnableDevEnvironment(name, config)
}

/**
 * 完成默认值填充后的开发环境选项。
 * `sourcemapIgnoreList: false` 会在解析时转换成实际判定函数，因此结果不再允许
 * `false | undefined`。
 */
export type ResolvedDevEnvironmentOptions = Omit<
  Required<DevEnvironmentOptions>,
  'sourcemapIgnoreList'
> & {
  /** 解析后可直接调用的 Source Map ignore-list 判定函数。 */
  sourcemapIgnoreList: Exclude<
    DevEnvironmentOptions['sourcemapIgnoreList'],
    false | undefined
  >
}

/** 顶层兼容解析选项：在标准 ResolveOptions 基础上继续接受 alias。 */
type AllResolveOptions = ResolveOptions & {
  /** 顶层兼容入口接受字符串、对象或数组形式的 alias。 */
  alias?: AliasOptions
}

/** 已补齐默认值并把 alias 规范化为数组的顶层解析选项。 */
type ResolvedAllResolveOptions = Required<ResolveOptions> & {
  /** 按声明顺序执行的规范化 alias 条目。 */
  alias: Alias[]
}

/** 开发与构建阶段都适用的单个 Environment 基础配置。 */
export interface SharedEnvironmentOptions {
  /**
   * 应用入口；相对路径以项目 root 为基准解析。
   * client 与 SSR 等环境可以使用不同入口。
   */
  input?: InputOption
  /**
   * 定义全局常量替换。
   * 开发阶段会提供相应定义，构建阶段会把引用静态替换进产物。
   */
  define?: Record<string, any>
  /** 当前环境专属的模块解析选项。 */
  resolve?: EnvironmentResolveOptions
  /**
   * 环境消费模块的位置；决定解析条件和默认行为。
   * @default client 环境为 'client'，其他环境为 'server'
   */
  consumer?: 'client' | 'server'
  /**
   * 是否保留源码中的 `process.env`，交给运行时求值。
   * client consumer 默认关闭，server consumer 默认开启；旧 `ssr.target: 'webworker'`
   * 默认关闭。关闭时启用 define 插件的默认 process.env 替换，库构建仍不提供这组默认值。
   */
  keepProcessEnv?: boolean
  /** 当前环境的依赖发现与预构建配置。 */
  optimizeDeps?: DepOptimizationOptions
  /**
   * 当前环境是否产生打包后的输出。
   *
   * build 阶段所有环境默认 `true`。serve 阶段通常为 `false`；启用
   * `experimental.bundledDev` 时只有 client 默认 `true`。环境显式值始终优先。
   *
   * @experimental
   */
  isBundled?: boolean
}

/** 单个 Environment 的完整用户配置，分别允许覆盖开发和构建选项。 */
export interface EnvironmentOptions extends SharedEnvironmentOptions {
  /** 开发阶段专属配置。 */
  dev?: DevEnvironmentOptions
  /** 构建阶段专属配置。 */
  build?: BuildEnvironmentOptions
}

/** 所有字段已补默认值的标准模块解析配置。 */
export type ResolvedResolveOptions = Required<ResolveOptions>

/** 单个 Environment 完成继承、兼容转换和默认值填充后的运行配置。 */
export type ResolvedEnvironmentOptions = {
  /** 已保留原始结构的环境入口。 */
  input?: InputOption
  /** 环境级常量替换表。 */
  define?: Record<string, any>
  /** 已解析的模块解析选项。 */
  resolve: ResolvedResolveOptions
  /** 模块由浏览器还是服务端消费。 */
  consumer: 'client' | 'server'
  /** 是否在转换结果中保留 `process.env`。 */
  keepProcessEnv?: boolean
  /** 已合并的依赖优化配置。 */
  optimizeDeps: DepOptimizationOptions
  /** 已补全的开发环境配置。 */
  dev: ResolvedDevEnvironmentOptions
  /** 已补全的构建环境配置。 */
  build: ResolvedBuildEnvironmentOptions
  /** 是否使用打包输出模型。 */
  isBundled: boolean
  /** 已按执行顺序排列、适用于当前环境的插件。 */
  plugins: readonly Plugin[]
  /**
   * 依赖优化器实际使用的插件名称，用于判断缓存是否仍有效。
   * @internal
   */
  optimizeDepsPluginNames: string[]
}

/**
 * 顶层默认环境选项。
 * `consumer`、`keepProcessEnv` 由具体环境决定；顶层 resolve 额外兼容 alias。
 */
export type DefaultEnvironmentOptions = Omit<
  EnvironmentOptions,
  'consumer' | 'resolve' | 'keepProcessEnv'
> & {
  /** 顶层默认环境额外接受 alias 的兼容解析配置。 */
  resolve?: AllResolveOptions
}

/** `vite.config.*` 可声明的顶层用户配置。 */
export interface UserConfig extends DefaultEnvironmentOptions {
  /**
   * 项目根目录。可以是绝对路径，也可以是相对于当前工作目录的路径。
   * @default process.cwd()
   */
  root?: string
  /**
   * 开发和生产环境使用的公共基础路径。
   * @default '/'
   */
  base?: string
  /**
   * 原样提供的静态资源目录。其中内容不经过插件转换，开发时直接提供，构建时复制到
   * 输出目录。可使用绝对路径或相对于项目 root 的路径。
   *
   * 设为 `false` 或空字符串可关闭该目录及构建复制。
   * @default 'public'
   */
  publicDir?: string | false
  /**
   * Vite 缓存目录，保存依赖预构建结果等可再生数据。可用 `--force` 或删除目录重建。
   * 接受绝对路径或相对于项目 root 的路径。找不到 package.json 和 node_modules 时
   * 默认改用 `.vite`。
   *
   * @default 'node_modules/.vite'
   */
  cacheDir?: string
  /**
   * 显式运行 mode。它覆盖命令默认 mode，但仍会被 CLI `--mode` 覆盖。
   */
  mode?: string
  /** Vite 插件列表；允许嵌套数组、Promise 和条件值。 */
  plugins?: PluginOption[]
  /** HTML 转换相关选项。 */
  html?: HTMLOptions
  /** CSS、预处理器和 CSS Modules 相关选项。 */
  css?: CSSOptions
  /** JSON 模块加载选项。 */
  json?: JsonOptions
  /**
   * 旧 esbuild 转换选项；兼容层会尽量映射到 Oxc。`false` 仅关闭旧兼容路径，
   * 要关闭默认源码转换还需设置 `oxc: false`。
   *
   * @deprecated 请改用 `oxc`。
   */
  esbuild?: ESBuildOptions | false
  /**
   * 传给 Oxc 的转换选项；设为 `false` 可禁用。
   */
  oxc?: OxcOptions | false
  /**
   * 额外视为静态资源的 picomatch 模式或正则。
   * 命中的 import 会走资源 URL 处理，而不是普通源码转换。
   */
  assetsInclude?: string | RegExp | (string | RegExp)[]
  /**
   * 多环境 Builder 选项。
   * @experimental
   */
  builder?: BuilderOptions
  /** 开发服务器选项，例如 host、port、proxy。 */
  server?: ServerOptions
  /** 生产产物预览服务器选项，例如 host、port。 */
  preview?: PreviewOptions
  /**
   * 实验特性。
   *
   * 这些字段可能不遵循 semver；使用时应锁定 Vite 具体版本。
   * @experimental
   */
  experimental?: ExperimentalOptions
  /**
   * 报告未来将移除的兼容 API 用法；设为 `'warn'` 可同时启用全部迁移告警。
   */
  future?: FutureOptions | 'warn'
  /**
   * 旧行为兼容选项。
   *
   * 这些字段只承诺 patch 级兼容，可能在未来 minor 版本删除；使用时至少锁定 minor。
   */
  legacy?: LegacyOptions
  /**
   * 日志级别。
   * @default 'info'
   */
  logLevel?: LogLevel
  /** 自定义 Logger；提供后替代默认终端日志实现。 */
  customLogger?: Logger
  /** 是否允许 Vite 在更新终端输出时清屏。 @default true */
  clearScreen?: boolean
  /**
   * `.env*` 文件目录。可使用绝对路径或相对于 root 的路径；设为 `false` 完全关闭
   * 环境文件加载和监听。
   *
   * @default root
   */
  envDir?: string | false
  /**
   * 允许通过 `import.meta.env` 暴露到客户端的环境变量前缀。
   * 空字符串会泄露全部进程变量，因此解析阶段会拒绝。
   *
   * @default 'VITE_'
   */
  envPrefix?: string | string[]
  /** Worker 打包选项；bundled 模式下每个入口单独子构建，普通开发模式通过 URL 加载。 */
  worker?: {
    /**
     * Worker 产物格式。
     * @default 'iife'
     */
    format?: 'es' | 'iife'
    /**
     * Worker 构建专属插件工厂。每次调用必须返回新插件实例，因为每个 Worker
     * Rolldown 构建都拥有独立生命周期和插件状态。
     */
    plugins?: () => PluginOption[]
    /**
     * `rolldownOptions` 的旧名称。
     * @deprecated 请改用 `rolldownOptions`。
     */
    rollupOptions?: Omit<
      RolldownOptions,
      'plugins' | 'input' | 'onwarn' | 'preserveEntrySignatures'
    >
    /**
     * 构建 Worker 的 Rolldown 选项。input、plugins 等由 Vite 管理，不能在此覆盖。
     */
    rolldownOptions?: Omit<
      RolldownOptions,
      'plugins' | 'input' | 'onwarn' | 'preserveEntrySignatures'
    >
  }
  /** 顶层 client 环境的依赖优化兼容配置。 */
  optimizeDeps?: DepOptimizationOptions
  /**
   * SSR 兼容配置。解析时把 resolve、external/noExternal 和 optimizeDeps 合入
   * `environments.ssr`，再将最终环境值回填到此入口，供旧插件读取。
   */
  ssr?: SSROptions
  /** 按名称声明 client、ssr 或框架自定义 Environment 的覆盖配置。 */
  environments?: Record<string, EnvironmentOptions>
  /**
   * 应用采用 SPA、MPA，还是由 SSR 框架自行处理 HTML 的 custom 模式。
   * @default 'spa'
   */
  appType?: AppType
  /**
   * 启用 Vite DevTools 集成。项目必须安装 `@vitejs/devtools`；当前仅支持构建模式。
   *
   * @experimental
   * @default false
   */
  devtools?: boolean | DevToolsConfig
}

/** HTML 入口转换与安全属性配置。 */
export interface HTMLOptions {
  /**
   * 生成 script/style 标签时写入的 CSP nonce 占位值。
   *
   * 服务器必须为每次请求把占位值替换成唯一随机值；直接把固定值部署到生产环境会失去
   * CSP nonce 防重放意义。
   */
  cspNonce?: string
  /**
   * 补充应视为资源 URL 来源的 HTML 元素和属性。
   * 内置规则已包含 `<img src>`、`<video src>` 等标准元素；此项主要服务自定义组件或
   * `data-*` 延迟加载属性。
   *
   * @example
   * ```ts
   * html: {
   *   additionalAssetSources: {
   *     // 自定义 Web Component
   *     'html-import': { srcAttributes: ['src'] },
   *     // 为已有元素补充 data-* 资源属性
   *     'img': { srcAttributes: ['data-src-dark', 'data-src-light'] }
   *   }
   * }
   * ```
   */
  additionalAssetSources?: Record<string, HtmlAssetSource>
}

/**
 * 未来主版本将移除的兼容 API 检查项。
 * 配置值为 `'warn'` 时仍保留旧行为，但在命中旧 API 时输出迁移告警。
 */
export interface FutureOptions {
  /** 对插件旧 `handleHotUpdate` 钩子发出移除告警。 */
  removePluginHookHandleHotUpdate?: 'warn'
  /** 对插件钩子旧 `ssr` 参数发出移除告警。 */
  removePluginHookSsrArgument?: 'warn'

  /** 对 `server.moduleGraph` 旧入口发出移除告警。 */
  removeServerModuleGraph?: 'warn'
  /** 对 `server.reloadModule` 旧入口发出移除告警。 */
  removeServerReloadModule?: 'warn'
  /** 对 `server.pluginContainer` 旧入口发出移除告警。 */
  removeServerPluginContainer?: 'warn'
  /** 对 `server.hot` 旧入口发出移除告警。 */
  removeServerHot?: 'warn'
  /** 对 `server.transformRequest` 旧入口发出移除告警。 */
  removeServerTransformRequest?: 'warn'
  /** 对 `server.warmupRequest` 旧入口发出移除告警。 */
  removeServerWarmupRequest?: 'warn'

  /** 对旧 `ssrLoadModule` API 发出移除告警。 */
  removeSsrLoadModule?: 'warn'
}

/** 尚未稳定、可能不遵循 semver 的实验功能开关。 */
export interface ExperimentalOptions {
  /**
   * glob import 带 query 时追加虚拟 `&lang.(ext)`，让后续插件仍能从 ID 判断原扩展名。
   *
   * @experimental
   * @default false
   */
  importGlobRestoreExtension?: boolean
  /**
   * 精细控制构建资源和 public 文件最终 URL 的生成方式。
   *
   * @experimental
   */
  renderBuiltUrl?: RenderBuiltAssetUrl
  /**
   * 启用 `import.meta.hot.acceptExports` 的 HMR 部分导出接受能力。
   *
   * @experimental
   * @default false
   */
  hmrPartialAccept?: boolean
  /**
   * 在 serve 阶段启用全量打包开发模式。
   *
   * 它只改变 client 环境 `isBundled` 的默认值；其他环境在 serve 时仍默认 `false`。
   * 每个环境都可用 `environments[name].isBundled` 显式覆盖。
   *
   * 该模式高度实验性。HMR 边界由浏览器根据实际运行状态计算，与传统中间件模式有
   * 两个重要差异：
   *
   * - 只有真正执行过的 `import.meta.hot.accept()` 才形成接受边界；死分支中的调用不会
   *   阻止 full reload。
   * - `hot.invalidate()` 完全由客户端处理。
   *
   * @experimental
   * @default false
   * @see https://github.com/vitejs/vite/pull/21235
   */
  bundledDev?: boolean
}

/** 为迁移旧项目临时保留的兼容开关；不建议新项目使用。 */
export interface LegacyOptions {
  /**
   * 跳过 HMR WebSocket 连接 token 校验，恢复 Vite 6.0.8 及更早版本行为。
   *
   * 旧实现允许任意网页连接本机 Vite WebSocket，恶意网站可借此监听或干扰开发会话。
   * Vite 6.0.9+ 要求页面携带随机 token。某些自行建立 WebSocket 的旧插件可能因此
   * 断开，此选项只为它们提供短期迁移窗口。
   *
   * **启用会重新引入安全弱点，除非完全理解风险，否则不要使用。**
   *
   * @see https://github.com/vitejs/vite/commit/029dcd6d77d3e3ef10bc38e9a0829784d9760fdb
   */
  skipWebSocketTokenCheck?: boolean
  /**
   * 恢复 Vite 8 之前不一致的 CommonJS 互操作行为。
   *
   * 旧版 Dev 依赖优化使用 esbuild，生产构建使用 Rollup CommonJS 插件，两者对默认导入
   * 的处理不同。Vite 8+ 两条链都使用 Rolldown，并统一到 esbuild 语义。此开关仅供
   * 依赖旧差异的项目迁移。
   *
   * @see https://github.com/vitejs/vite/commit/10aa99287ed936cf80bfaafa122db90498bd32f0
   */
  inconsistentCjsInterop?: boolean
}

/** Worker 配置解析后的运行形式。 */
export interface ResolvedWorkerOptions {
  /** 最终 Worker 产物格式。 */
  format: 'es' | 'iife'
  /**
   * 为指定 Worker 嵌套链创建独立 ResolvedConfig。
   * bundleChain 用于检测 Worker 递归引用。
   */
  plugins: (bundleChain: string[]) => Promise<ResolvedConfig>
  /**
   * `rolldownOptions` 的兼容别名。
   * @deprecated 请改用 `rolldownOptions`。
   */
  rollupOptions: RolldownOptions
  /** 已合并的 Worker Rolldown 配置。 */
  rolldownOptions: RolldownOptions
}

/**
 * 只允许通过 CLI 或 Node API 传入、不会从普通 `vite.config.*` 暴露的内联配置。
 * 内联值在配置文件加载后拥有更高合并优先级。
 */
export interface InlineConfig extends UserConfig {
  /** 显式配置文件路径；`false` 表示禁止搜索和加载配置文件。 */
  configFile?: string | false
  /**
   * 配置文件执行策略：预打包、Module Runner 或当前运行时原生导入。
   * @experimental
   */
  configLoader?: 'bundle' | 'runner' | 'native'
  /**
   * 禁用环境文件的旧入口。
   * @deprecated 请改用 `envDir: false`。
   */
  envFile?: false
  /** 忽略依赖优化缓存并强制重新预构建。 */
  forceOptimizeDeps?: boolean
}

/**
 * `resolveConfig()` 的最终结果，也是开发服务器、构建器和插件读取的统一配置快照。
 *
 * 顶层字段在类型上只读，运行时对象未被冻结，部分嵌套对象仍由生态插件修改。
 * 用户输入已经过路径规范化、默认值填充、插件钩子处理及 Environment 展开。
 */
export interface ResolvedConfig extends Readonly<
  Omit<
    UserConfig,
    | 'plugins'
    | 'css'
    | 'json'
    | 'assetsInclude'
    | 'optimizeDeps'
    | 'worker'
    | 'build'
    | 'dev'
    | 'environments'
    | 'experimental'
    | 'future'
    | 'server'
    | 'preview'
    | 'devtools'
  > & {
    /** 实际加载的配置文件路径；禁用或未找到时为 `undefined`。 */
    configFile: string | undefined
    /** 配置文件打包/执行期间发现的依赖，用于监听配置依赖变化并触发重启。 */
    configFileDependencies: string[]
    /** CLI 或 Node API 最初传入的配置；文件合并时优先，后续插件钩子仍可覆盖。 */
    inlineConfig: InlineConfig
    /** 规范化后的绝对项目根目录。 */
    root: string
    /** 规范化后的公开基础路径。 */
    base: string
    /**
     * 已执行 URI 解码的 base，供文件系统与 URL 比较使用。
     * @internal
     */
    decodedBase: string
    /**
     * 经过相对路径与 URL 规则解析、尚未补末尾斜杠的 base；不是用户原始输入。
     * @internal
     */
    rawBase: string
    /** 规范化后的 public 绝对目录；禁用时为空字符串。 */
    publicDir: string
    /** 规范化后的缓存绝对目录。 */
    cacheDir: string
    /** 当前服务器或构建命令。 */
    command: 'build' | 'serve'
    /** 最终 mode。 */
    mode: string
    /** 当前配置是否服务于嵌套 Worker 构建。 */
    isWorker: boolean
    /**
     * 嵌套 Worker 构建回溯到主应用配置的引用；主配置自身为 `null`。
     * @internal
     */
    mainConfig: ResolvedConfig | null
    /**
     * Worker 构建入口链，用于检测 Worker 递归引用。
     * @internal
     */
    bundleChain: string[]
    /** 当前转换是否采用生产语义，由最终 `process.env.NODE_ENV` 判断。 */
    isProduction: boolean
    /** 规范化后的 `.env` 目录；`false` 表示禁用环境文件。 */
    envDir: string | false
    /** 已完成前缀过滤、展开和优先级覆盖的客户端环境变量。 */
    env: Record<string, any>
    /** 顶层兼容解析配置；alias 已统一成数组。 */
    resolve: Required<ResolveOptions> & {
      /** 按声明顺序执行的规范化 alias 条目。 */
      alias: Alias[]
    }
    /** 已展平、过滤并排序的顶层插件列表。 */
    plugins: readonly Plugin[]
    /** 已补齐默认值的 CSS 配置。 */
    css: ResolvedCSSOptions
    /** 已补齐默认值的 JSON 配置。 */
    json: Required<JsonOptions>
    /** 已解析的 esbuild 兼容配置。 @deprecated 请改用 `oxc`。 */
    esbuild: ESBuildOptions | false
    /** 已解析的 Oxc 转换配置。 */
    oxc: OxcOptions | false
    /** 已解析的开发服务器配置。 */
    server: ResolvedServerOptions
    /** 顶层开发兼容配置；环境工厂和 consumer 默认值由各 Environment 另行解析。 */
    dev: ResolvedDevEnvironmentOptions
    /** 已解析的多环境 Builder 配置。 @experimental */
    builder: ResolvedBuilderOptions | undefined
    /** 顶层构建兼容配置；legacyBuilder 会在构建前镜像当前 Environment 的 build 值。 */
    build: ResolvedBuildOptions
    /** DevTools 的标准化配置及启用状态。 */
    devtools: ResolvedDevToolsConfig
    /** 已解析的预览服务器配置。 */
    preview: ResolvedPreviewOptions
    /** 已解析的 SSR 外部化配置。 */
    ssr: ResolvedSSROptions
    /** 判断文件是否应按静态资源处理的最终匹配函数。 */
    assetsInclude: (file: string) => boolean
    /** 用户输入的原始静态资源匹配模式。 */
    rawAssetsInclude: (string | RegExp)[]
    /** 当前配置共用的 Logger。 */
    logger: Logger
    /**
     * 创建供依赖优化器、CSS `@import` 等特殊流程使用的内部 resolver。
     *
     * 此 API 只支持 client 和 ssr 环境；`aliasOnly` 为 true 时仅执行 alias 解析。插件应基于
     * `environment.config` 调用 `createIdResolver()`，避免解析时丢失当前环境信息。
     *
     * @deprecated 请改用 Vite 导出的 `createIdResolver`。
     */
    createResolver: (options?: Partial<InternalResolveOptions>) => ResolveFn
    /** 顶层 client 环境的依赖优化兼容配置。 */
    optimizeDeps: DepOptimizationOptions
    /**
     * 顶层 resolver 与其 Environment 共用的 package.json 缓存；优化器可另建独立缓存。
     * @internal
     */
    packageCache: PackageCache
    /** Worker 构建运行配置。 */
    worker: ResolvedWorkerOptions
    /** HTML 中间件模型。 */
    appType: AppType
    /** 已补齐默认值的实验选项；renderBuiltUrl 仍允许缺省。 */
    experimental: RequiredExceptFor<ExperimentalOptions, 'renderBuiltUrl'>
    /** 未来行为告警配置；未启用时为 `undefined`。 */
    future: FutureOptions | undefined
    /** 每个命名 Environment 的最终配置。 */
    environments: Record<string, ResolvedEnvironmentOptions>
    /**
     * legacy 插件注入的产物分类函数，用于识别旧浏览器 chunk。
     * @internal
     */
    isOutputOptionsForLegacyChunks?(
      outputOptions: NormalizedOutputOptions,
    ): boolean
    /**
     * 浏览器连接 HMR WebSocket 时使用的随机 token。
     *
     * 客户端注入此值，服务器在 WebSocket 握手时校验连接来源。
     *
     * @deprecated 仅供 Vite 内部客户端注入。
     */
    webSocketToken: string
    /**
     * 由 `server.fs.deny` 编译得到的文件访问拒绝匹配器。
     * @internal
     */
    fsDenyGlob: AnymatchFn
    /**
     * 即使不在普通 fs allow 范围内，也已由入口解析确认可安全加载的模块路径。
     * @internal
     */
    safeModulePaths: Set<string>
    /** 已完成解析的品牌标记，供 `isResolvedConfig()` 可靠判断。 @internal */
    [SYMBOL_RESOLVED_CONFIG]: true
  } & PluginHookUtils
> {}

/**
 * 标准化可选的 Vite DevTools 配置。
 *
 * DevTools 是可选 peer dependency。未启用时不会动态导入它；启用但包缺失或配置解析
 * 失败时记录错误并返回禁用配置，避免辅助工具令正常构建完全不可用。
 *
 * @param config - 用户的布尔开关或 DevTools 详细配置。
 * @param host - Vite Server host，用作 DevTools 未指定 host 时的回退值。
 * @param logger - 动态加载失败时使用的配置 Logger。
 * @returns host 已补齐的 DevTools 配置和最终启用状态。
 * @see https://github.com/vitejs/vite/pull/21331
 */
export async function resolveDevToolsConfig(
  config: DevToolsConfig | boolean | undefined,
  host: string | boolean | undefined,
  logger: Logger,
): Promise<ResolvedDevToolsConfig> {
  /** `true` 或对象中的 `enabled: true` 才真正加载 DevTools。 */
  const isEnabled = config === true || !!(config && config.enabled)
  // host 可为 true/undefined，需要复用 Server 的主机解析规则得到可连接名称。
  const resolvedHostname = await resolveHostname(host)
  const fallbackHostname = resolvedHostname.host ?? 'localhost'
  /** 即使 DevTools 不可用，也返回形状稳定的禁用配置。 */
  const fallbackConfig = {
    config: {
      host: fallbackHostname,
    },
    enabled: false,
  }
  if (!isEnabled) {
    return fallbackConfig
  }

  try {
    // 仅在启用后动态导入，保持 @vitejs/devtools 为真正可选依赖。
    const { normalizeDevToolsConfig } = await import('@vitejs/devtools/config')
    return normalizeDevToolsConfig(config, fallbackHostname)
  } catch (e) {
    logger.error(
      colors.red(
        `Failed to load Vite DevTools config: ${e.message || e.stack}`,
      ),
      { error: e },
    )
    return fallbackConfig
  }
}

/**
 * 可以静态确定的顶层配置默认值。
 *
 * 依赖 command、consumer、root 或其他字段才能推断的默认值故意只留注释占位，稍后由
 * 各 `resolve*Options()` 函数补齐。对象被冻结，合并时必须先克隆，防止一次解析污染
 * 后续项目。
 */
const configDefaults = Object.freeze({
  define: {},
  dev: {
    warmup: [],
    // preTransformRequests：根据 consumer 推断。
    /** @experimental */
    sourcemap: { js: true },
    sourcemapIgnoreList: undefined,
    // createEnvironment：根据环境名称选择浏览器或可运行环境工厂。
    // recoverable：client 为 true。
    // moduleRunnerTransform：server consumer 为 true。
  },
  build: buildEnvironmentOptionsDefaults,
  resolve: {
    // mainFields：根据 consumer 选择 client/server 默认值。
    // conditions：根据 consumer 选择 client/server 默认值。
    externalConditions: [...DEFAULT_EXTERNAL_CONDITIONS],
    extensions: DEFAULT_EXTENSIONS,
    dedupe: [],
    /** @experimental */
    noExternal: [],
    external: [],
    preserveSymlinks: false,
    tsconfigPaths: false,
    alias: [],
  },

  // root：相对 process.cwd() 解析；缺省时直接使用 process.cwd()。
  base: '/',
  publicDir: 'public',
  // cacheDir：根据最近 package 目录推断。
  // mode：由命令默认值、配置和 CLI 共同决定。
  plugins: [],
  html: {
    cspNonce: undefined,
  },
  css: cssConfigDefaults,
  json: {
    namedExports: true,
    stringify: 'auto',
  },
  // esbuild：缺省时使用兼容转换默认行为。
  assetsInclude: undefined,
  /** @experimental */
  builder: builderOptionsDefaults,
  server: serverConfigDefaults,
  preview: {
    port: DEFAULT_PREVIEW_PORT,
    // 其余字段继承 server 或保持未定义，由 resolvePreviewOptions 处理。
  },
  /** @experimental */
  experimental: {
    importGlobRestoreExtension: false,
    renderBuiltUrl: undefined,
    hmrPartialAccept: false,
    bundledDev: false,
  },
  future: {
    removePluginHookHandleHotUpdate: undefined,
    removePluginHookSsrArgument: undefined,
    removeServerModuleGraph: undefined,
    removeServerHot: undefined,
    removeServerTransformRequest: undefined,
    removeServerWarmupRequest: undefined,
    removeSsrLoadModule: undefined,
  },
  legacy: {
    skipWebSocketTokenCheck: false,
  },
  logLevel: 'info',
  customLogger: undefined,
  clearScreen: true,
  envDir: undefined,
  envPrefix: 'VITE_',
  worker: {
    format: 'iife',
    /** 默认不为 Worker 子构建追加用户插件；每次调用返回新的空数组。 */
    plugins: (): never[] => [],
    // rolldownOptions：默认空对象，在 Worker 配置阶段合并。
  },
  optimizeDeps: {
    include: [],
    exclude: [],
    needsInterop: [],
    // esbuildOptions：仅作为旧版兼容输入。
    rolldownOptions: {},
    /** @experimental */
    extensions: [],
    /** @deprecated @experimental */
    disabled: 'build',
    // noDiscovery：根据 consumer 推断，非 client 默认 true。
    /** @experimental */
    holdUntilCrawlEnd: true,
    // entries：未指定时从 HTML/入口自动发现。
    /** @experimental */
    force: false,
    /** @experimental */
    ignoreOutdatedRequests: false,
  },
  ssr: ssrConfigDefaults,
  environments: {},
  appType: 'spa',
} satisfies UserConfig)

/**
 * 规范化 Environment 入口并去除被转义的 glob 特殊字符。
 *
 * Vite 当前只接受明确入口，不接受 glob。保留“先拒绝未转义 glob、再反转义”的设计，
 * 允许未来在不破坏现有转义语义的情况下增加 glob 支持（#22642）。
 *
 * @param input - 字符串、字符串数组或命名入口对象。
 * @returns 保持原结构、但已反转义 glob 字符的入口。
 */
function normalizeInput(
  input: InputOption | undefined,
): InputOption | undefined {
  if (input === undefined) {
    return undefined
  }
  if (typeof input === 'string') {
    return unescapeGlobCharacters(input)
  }
  if (Array.isArray(input)) {
    return input.map(unescapeGlobCharacters)
  }
  const resolved: Record<string, string> = {}
  for (const key in input) {
    resolved[key] = unescapeGlobCharacters(input[key])
  }
  return resolved
}

/** 匹配输入路径中用反斜杠转义的 tinyglobby 特殊字符。 */
const escapedGlobCharactersRE = /\\([*?[\]{}()!+@|])/g

/**
 * 校验入口不是动态 glob，并还原显式转义的 glob 字符。
 * 例如 `entry\\[name\\].js` 表示真实方括号，而 `entry*.js` 会被拒绝。
 */
function unescapeGlobCharacters(value: string): string {
  if (isDynamicPattern(value)) {
    // 未转义 glob 现在直接报错，使未来启用 glob 时不会改变一个曾被当成普通路径的值。
    throw new Error(
      `\`input\` cannot contain glob characters. They are reserved, ` +
        `so the ${JSON.stringify(value)} is not allowed. Please escape them with a backslash (\\)`,
    )
  }
  // 校验通过后去掉转义反斜杠，把路径恢复成文件系统中的真实名称。
  return value.replace(escapedGlobCharactersRE, '$1')
}

/**
 * 补齐单个 Environment 的开发阶段默认值。
 *
 * 环境名称决定默认工厂：名为 client 的环境使用浏览器 DevEnvironment，其他名称使用
 * RunnableDevEnvironment。consumer 决定预转换、重启恢复和 Module Runner 转换默认值；
 * 自定义 client consumer 因而可使用不同工厂并保留浏览器侧转换策略。
 *
 * @param dev - 用户的环境级开发配置。
 * @param environmentName - 当前环境名称；顶层兼容解析时可能为空。
 * @param consumer - 模块最终由 client 还是 server 消费。
 * @param preTransformRequest - 旧顶层 `server.preTransformRequests` 兼容值。
 * @returns 所有开发字段已补齐的配置。
 */
export function resolveDevEnvironmentOptions(
  dev: DevEnvironmentOptions | undefined,
  environmentName: string | undefined,
  consumer: 'client' | 'server' | undefined,
  // 兼容旧顶层 server.preTransformRequests。
  preTransformRequest?: boolean,
): ResolvedDevEnvironmentOptions {
  const resolved = mergeWithDefaults(
    {
      ...configDefaults.dev,
      sourcemapIgnoreList: isInNodeModules,
      preTransformRequests: preTransformRequest ?? consumer === 'client',
      createEnvironment:
        environmentName === 'client'
          ? defaultCreateClientDevEnvironment
          : defaultCreateDevEnvironment,
      recoverable: consumer === 'client',
      moduleRunnerTransform: consumer === 'server',
    },
    dev ?? {},
  )
  return {
    ...resolved,
    /** 将 false 规范化为始终不忽略的判定函数，其他配置保留用户函数或 node_modules 默认判定。 */
    sourcemapIgnoreList:
      resolved.sourcemapIgnoreList === false
        ? () => false
        : resolved.sourcemapIgnoreList,
  }
}

/**
 * 把一个 Environment 的继承结果解析成可直接运行的配置。
 *
 * 此阶段确定 consumer、打包模型、resolver、依赖优化、Dev 与 Build 子配置。插件列表和
 * 依赖优化插件名称依赖后续全局插件解析，先以占位值写入。
 */
function resolveEnvironmentOptions(
  options: EnvironmentOptions,
  alias: Alias[],
  preserveSymlinks: boolean,
  forceOptimizeDeps: boolean | undefined,
  logger: Logger,
  environmentName: string,
  isBuild: boolean,
  isBundledDev: boolean,
  // 兼容旧 ssr.target 与 server.preTransformRequests。
  isSsrTargetWebworkerSet?: boolean,
  preTransformRequests?: boolean,
): ResolvedEnvironmentOptions {
  const isClientEnvironment = environmentName === 'client'
  const consumer =
    options.consumer ?? (isClientEnvironment ? 'client' : 'server')
  const isSsrTargetWebworkerEnvironment =
    isSsrTargetWebworkerSet && environmentName === 'ssr'

  const isBundled =
    options.isBundled ?? (isBuild || (isClientEnvironment && isBundledDev))

  // 常见误用 `define: { 'process.env': process.env }` 会把整份宿主环境静态写进客户端。
  // PATH/Path 是完整 process.env 最稳定的特征之一；Windows 使用 Path，所以忽略大小写。
  // 命中后只告警一次，提醒访问令牌、CI 密钥等泄露风险（#19517）。
  if (options.define?.['process.env']) {
    const processEnvDefine = options.define['process.env']
    if (typeof processEnvDefine === 'object') {
      const pathKey = Object.entries(processEnvDefine).find(
        // 忽略大小写以同时匹配 Unix 的 PATH 与 Windows 常见的 Path。
        ([key, value]) => key.toLowerCase() === 'path' && !!value,
      )?.[0]
      if (pathKey) {
        logger.warnOnce(
          colors.yellow(
            `The \`define\` option contains an object with ${JSON.stringify(pathKey)} for "process.env" key. ` +
              'It looks like you may have passed the entire `process.env` object to `define`, ' +
              'which can unintentionally expose all environment variables. ' +
              'This poses a security risk and is discouraged.',
          ),
        )
      }
    }
  }

  const resolve = resolveEnvironmentResolveOptions(
    options.resolve,
    alias,
    preserveSymlinks,
    logger,
    consumer,
    isSsrTargetWebworkerEnvironment,
  )
  return {
    input: normalizeInput(options.input),
    define: options.define,
    resolve,
    keepProcessEnv:
      options.keepProcessEnv ??
      (isSsrTargetWebworkerEnvironment ? false : consumer === 'server'),
    consumer,
    optimizeDeps: resolveDepOptimizationOptions(
      options.optimizeDeps,
      resolve.preserveSymlinks,
      forceOptimizeDeps,
      consumer,
      logger,
    ),
    dev: resolveDevEnvironmentOptions(
      options.dev,
      environmentName,
      consumer,
      preTransformRequests,
    ),
    build: resolveBuildEnvironmentOptions(
      options.build ?? {},
      logger,
      consumer,
      isBundled && !isBuild,
      options.input,
      isSsrTargetWebworkerEnvironment,
    ),
    isBundled,
    // 插件需要先完成全局排序和 apply 过滤，稍后回填。
    plugins: undefined!,
    // `setOptimizeDepsPluginNames()` 在插件解析后回填缓存键所需名称。
    optimizeDepsPluginNames: undefined!,
  }
}

/**
 * 从顶层 UserConfig 提取所有 Environment 默认继承的配置。
 *
 * `mainFields` 和 `conditions` 与 consumer 强相关，不能让 client 默认值污染 server
 * 环境，因此这里主动清空并在环境解析阶段重新计算。
 */
export function getDefaultEnvironmentOptions(
  config: UserConfig,
): EnvironmentOptions {
  return {
    define: config.define,
    resolve: {
      ...config.resolve,
      // mainFields/conditions 不继承；每个 consumer 必须重新选择默认解析条件。
      mainFields: undefined,
      conditions: undefined,
    },
    dev: config.dev,
    build: config.build,
  }
}

/** 已解析插件列表提供的高频钩子排序查询工具。 */
export interface PluginHookUtils {
  /** 在顶层插件既定顺序上，按当前钩子的 order 分组并筛选声明了该钩子的插件。 */
  getSortedPlugins: <K extends keyof Plugin>(
    hookName: K,
  ) => PluginWithRequiredHook<K>[]
  /** 获取指定钩子的已解包处理函数，并保持插件执行顺序。 */
  getSortedPluginHooks: <K extends keyof Plugin>(
    hookName: K,
  ) => NonNullable<HookHandler<Plugin[K]>>[]
}

/**
 * 旧内部 resolver 函数签名。
 *
 * @param id - 要解析的模块 ID。
 * @param importer - 发起导入的模块 ID。
 * @param aliasOnly - 为 true 时只执行 alias，不进入普通模块解析。
 * @param ssr - 是否使用 SSR 环境解析。
 * @returns 解析成功的 ID，无法解析时为 `undefined`。
 */
export type ResolveFn = (
  id: string,
  importer?: string,
  aliasOnly?: boolean,
  ssr?: boolean,
) => Promise<string | undefined>

/**
 * 检查路径是否包含 `#`、`?`、`*` 等会与 URL query/hash 或 glob 语义冲突的字符，
 * 命中时给出重命名建议。
 *
 * 这些路径并非在所有平台都无效，所以这里只告警而不阻止启动（#15761、#19683）。
 */
function checkBadCharactersInPath(
  name: string,
  type: 'directory' | 'file',
  path: string,
  logger: Logger,
): void {
  const badChars = []

  if (path.includes('#')) {
    badChars.push('#')
  }
  if (path.includes('?')) {
    badChars.push('?')
  }
  if (path.includes('*')) {
    badChars.push('*')
  }

  if (badChars.length > 0) {
    const charString = badChars.map((c) => `"${c}"`).join(' and ')
    const inflectedChars = badChars.length > 1 ? 'characters' : 'character'

    logger.warn(
      colors.yellow(
        `${name} contains the ${charString} ${inflectedChars} (${colors.cyan(
          path,
        )}), which may not work when running Vite. Consider renaming the ${type} without the characters.`,
      ),
    )
  }
}

/**
 * Vite 浏览器运行时的内部别名。
 * 它们优先解析到当前安装包的构建产物，并使用 `/@fs/` 让 Dev Server 按文件提供。
 */
const clientAlias = [
  {
    find: /^\/?@vite\/env/,
    replacement: path.posix.join(FS_PREFIX, normalizePath(ENV_ENTRY)),
  },
  {
    find: /^\/?@vite\/client/,
    replacement: path.posix.join(FS_PREFIX, normalizePath(CLIENT_ENTRY)),
  },
]

/**
 * 解析单个 Environment 的模块查找选项。
 *
 * alias 和 preserveSymlinks 实际属于顶层配置，为方便环境插件读取，也会复制到每个
 * resolved Environment。mainFields、conditions 和 builtins 则根据 consumer 重新计算。
 */
function resolveEnvironmentResolveOptions(
  resolve: EnvironmentResolveOptions | undefined,
  alias: Alias[],
  preserveSymlinks: boolean,
  logger: Logger,
  /** 解析顶层兼容 resolve 时为 undefined。 */
  consumer: 'client' | 'server' | undefined,
  // 兼容旧 `ssr.target: 'webworker'`：使用浏览器入口条件；仅 noExternal=true 时默认清空 builtins。
  isSsrTargetWebworkerEnvironment?: boolean,
): ResolvedAllResolveOptions {
  const resolvedResolve: ResolvedAllResolveOptions = mergeWithDefaults(
    {
      ...configDefaults.resolve,
      mainFields:
        consumer === undefined ||
        consumer === 'client' ||
        isSsrTargetWebworkerEnvironment
          ? DEFAULT_CLIENT_MAIN_FIELDS
          : DEFAULT_SERVER_MAIN_FIELDS,
      conditions:
        consumer === undefined ||
        consumer === 'client' ||
        isSsrTargetWebworkerEnvironment
          ? DEFAULT_CLIENT_CONDITIONS
          : DEFAULT_SERVER_CONDITIONS.filter((c) => c !== 'browser'),
      builtins:
        resolve?.builtins ??
        (consumer === 'server'
          ? isSsrTargetWebworkerEnvironment && resolve?.noExternal === true
            ? []
            : nodeLikeBuiltins
          : []),
    },
    resolve ?? {},
  )
  resolvedResolve.preserveSymlinks = preserveSymlinks
  resolvedResolve.alias = alias

  // browserField 已被 mainFields 中是否包含 browser 取代。旧值 false 不能静默忽略，
  // 否则升级后可能解析到包的 browser 入口并改变运行行为。
  if (
    // @ts-expect-error removed field
    resolve?.browserField === false &&
    resolvedResolve.mainFields.includes('browser')
  ) {
    logger.warn(
      colors.yellow(
        `\`resolve.browserField\` is set to false, but the option is removed in favour of ` +
          `the 'browser' string in \`resolve.mainFields\`. You may want to update \`resolve.mainFields\` ` +
          `to remove the 'browser' string and preserve the previous browser behaviour.`,
      ),
    )
  }
  return resolvedResolve
}

/**
 * 解析顶层兼容 `resolve` 配置。
 *
 * 用户 alias 与 Vite 内部 client alias 合并并规范化为数组。Environment 随后继承这组
 * alias 和 preserveSymlinks，但会按 consumer 选择自己的 mainFields/conditions。
 */
function resolveResolveOptions(
  resolve: AllResolveOptions | undefined,
  logger: Logger,
): ResolvedAllResolveOptions {
  // 内部 client/env alias 必须始终存在，再与用户 alias 合并。
  const alias = normalizeAlias(
    mergeAlias(clientAlias, resolve?.alias || configDefaults.resolve.alias),
  )
  const preserveSymlinks =
    resolve?.preserveSymlinks ?? configDefaults.resolve.preserveSymlinks

  if (alias.some((a) => a.find === '/')) {
    logger.warn(
      colors.yellow(
        `\`resolve.alias\` contains an alias that maps \`/\`. ` +
          `This is not recommended as it can cause unexpected behavior when resolving paths.`,
      ),
    )
  }
  if (alias.some((a) => a.customResolver)) {
    logger.warn(
      colors.yellow(
        `\`resolve.alias\` contains an alias with \`customResolver\` option. ` +
          `This is deprecated and will be removed in Vite 9. ` +
          `Please use a custom plugin with a resolveId hook and \`enforce: 'pre'\` instead.`,
      ),
    )
  }

  return resolveEnvironmentResolveOptions(
    resolve,
    alias,
    preserveSymlinks,
    logger,
    undefined,
  )
}

/**
 * 合并并迁移单个 Environment 的依赖优化配置。
 *
 * Vite 8 已改用 Rolldown。旧 `esbuildOptions` 仍尽力映射到 Rolldown，但显式
 * `rolldownOptions` 始终优先；无法可靠等价转换的字段只保留兼容输入并输出弃用告警。
 *
 * @todo 引入独立的 ResolvedDepOptimizationOptions，避免返回类型仍包含未解析形态。
 */
function resolveDepOptimizationOptions(
  optimizeDeps: DepOptimizationOptions | undefined,
  preserveSymlinks: boolean,
  forceOptimizeDeps: boolean | undefined,
  consumer: 'client' | 'server' | undefined,
  logger: Logger,
): DepOptimizationOptions {
  if (
    optimizeDeps?.rolldownOptions &&
    optimizeDeps?.rolldownOptions === optimizeDeps?.rollupOptions
  ) {
    // setupRollupOptionCompat 可能已让两个字段指向同一对象。删除旧字段，避免后续
    // 合并把同一配置当成用户同时提供了两套相互冲突的选项。
    delete optimizeDeps?.rollupOptions
  }
  const merged = mergeWithDefaults(
    {
      ...configDefaults.optimizeDeps,
      disabled: undefined, // 此处不写默认值，避免仅因解析配置就触发弃用告警。
      noDiscovery: consumer !== 'client',
      force: forceOptimizeDeps ?? configDefaults.optimizeDeps.force,
    },
    optimizeDeps ?? {},
  )
  // 建立 rollupOptions → rolldownOptions 兼容代理，并在旧字段运行时写入时告警。
  setupRollupOptionCompat(merged, 'optimizeDeps')

  const rolldownOptions = merged.rolldownOptions as Exclude<
    DepOptimizationOptions['rolldownOptions'],
    undefined
  >

  if (merged.esbuildOptions && Object.keys(merged.esbuildOptions).length > 0) {
    logger.warn(
      colors.yellow(
        `You or a plugin you are using have set \`optimizeDeps.esbuildOptions\` ` +
          `but this option is now deprecated. ` +
          `Vite now uses Rolldown to optimize the dependencies. ` +
          `Please use \`optimizeDeps.rolldownOptions\` instead.`,
      ),
    )

    rolldownOptions.resolve ??= {}
    rolldownOptions.output ??= {}
    rolldownOptions.transform ??= {}

    /**
     * 仅当用户没有在 Rolldown 配置中显式设置同名字段时，写入 esbuild 兼容值。
     * 这保证新配置优先，也避免迁移层意外覆盖插件写入。
     */
    const setResolveOptions = <
      T extends keyof Exclude<RolldownOptions['resolve'], undefined>,
    >(
      key: T,
      value: Exclude<RolldownOptions['resolve'], undefined>[T],
    ) => {
      if (value !== undefined && rolldownOptions.resolve![key] === undefined) {
        rolldownOptions.resolve![key] = value
      }
    }

    if (
      merged.esbuildOptions.minify !== undefined &&
      rolldownOptions.output.minify === undefined
    ) {
      rolldownOptions.output.minify = merged.esbuildOptions.minify
    }
    if (
      merged.esbuildOptions.treeShaking !== undefined &&
      rolldownOptions.treeshake === undefined
    ) {
      rolldownOptions.treeshake = merged.esbuildOptions.treeShaking
    }
    if (
      merged.esbuildOptions.define !== undefined &&
      rolldownOptions.transform.define === undefined
    ) {
      rolldownOptions.transform.define = merged.esbuildOptions.define
    }
    if (merged.esbuildOptions.loader !== undefined) {
      const loader = merged.esbuildOptions.loader
      rolldownOptions.moduleTypes ??= {}
      for (const [key, value] of Object.entries(loader)) {
        if (
          rolldownOptions.moduleTypes[key] === undefined &&
          value !== 'copy' &&
          value !== 'css' &&
          value !== 'default' &&
          value !== 'file' &&
          value !== 'local-css'
        ) {
          rolldownOptions.moduleTypes[key] = value
        }
      }
    }
    if (
      merged.esbuildOptions.preserveSymlinks !== undefined &&
      rolldownOptions.resolve.symlinks === undefined
    ) {
      rolldownOptions.resolve.symlinks = !merged.esbuildOptions.preserveSymlinks
    }
    setResolveOptions('extensions', merged.esbuildOptions.resolveExtensions)
    setResolveOptions('mainFields', merged.esbuildOptions.mainFields)
    setResolveOptions('conditionNames', merged.esbuildOptions.conditions)
    if (
      merged.esbuildOptions.keepNames !== undefined &&
      rolldownOptions.output.keepNames === undefined
    ) {
      rolldownOptions.output.keepNames = merged.esbuildOptions.keepNames
    }

    if (
      merged.esbuildOptions.platform !== undefined &&
      rolldownOptions.platform === undefined
    ) {
      rolldownOptions.platform = merged.esbuildOptions.platform
    }

    // 下列 esbuild 字段无法可靠转换：
    // - legalComments
    // - target、supported（旧实现会转译到 ESBUILD_MODULES_TARGET）
    // - ignoreAnnotations
    // - jsx、jsxFactory、jsxFragment、jsxImportSource、jsxDev、jsxSideEffects
    // - tsconfigRaw、tsconfig

    // 下列字段理论上可转换，但兼容收益不足或 Rolldown 缺少完整等价能力：
    // - sourceRoot
    // - sourcesContent（Rolldown 不支持 output.sourcemapExcludeSources）
    // - drop
    // - dropLabels
    // - mangleProps、reserveProps、mangleQuoted、mangleCache
    // - minifyWhitespace、minifyIdentifiers、minifySyntax
    // - lineLimit
    // - charset
    // - pure（Rolldown 不支持 treeshake.manualPureFunctions）
    // - alias（与 resolve.alias 的语义可能不同）
    // - inject
    // - banner、footer
    // - nodePaths

    // 下列字段在依赖预构建场景没有意义：
    // - globalName（这里只生成 ESM）
    // - color
    // - logLimit
    // - logOverride
    // - splitting
    // - outbase
    // - packages（不应由用户设置）
    // - allowOverwrite
    // - publicPath（Rolldown 不支持 esbuild 的 file loader）
    // - entryNames、chunkNames、assetNames（Vite 不允许改写这些输出命名）
    // - stdin
    // - absWorkingDir
  }

  // 两套配置最终都补齐符号链接和输出默认值，使扫描与正式优化使用一致模块身份。
  merged.esbuildOptions ??= {}
  merged.esbuildOptions.preserveSymlinks ??= preserveSymlinks

  rolldownOptions.resolve ??= {}
  rolldownOptions.resolve.symlinks ??= !preserveSymlinks
  rolldownOptions.output ??= {}
  rolldownOptions.output.topLevelVar ??= true

  return merged
}

/**
 * 收集每个 Environment 的依赖优化插件名称并写回配置。
 *
 * Rolldown 的 input/output 插件都可能改变预构建结果。名称列表进入依赖缓存元数据，
 * 插件集合变化时即可判定旧缓存失效。插件配置允许 Promise 和嵌套数组，需先异步展平。
 */
async function setOptimizeDepsPluginNames(resolvedConfig: ResolvedConfig) {
  await Promise.all(
    Object.values(resolvedConfig.environments).map(async (environment) => {
      const plugins = environment.optimizeDeps.rolldownOptions?.plugins ?? []
      const outputPlugins =
        environment.optimizeDeps.rolldownOptions?.output?.plugins ?? []
      const flattenedPlugins = await asyncFlatten([plugins, outputPlugins])

      const pluginNames = []
      for (const plugin of flattenedPlugins) {
        if (plugin && 'name' in plugin) {
          pluginNames.push(plugin.name)
        }
      }
      environment.optimizeDepsPluginNames = pluginNames
    }),
  )
}

/**
 * 把顶层 client `optimizeDeps.esbuildOptions.plugins` 中的旧 esbuild 插件转换并追加到
 * Rolldown 插件列表。转换器只提供兼容桥，不保证所有 esbuild 插件语义完全等价。
 */
function applyDepOptimizationOptionCompat(resolvedConfig: ResolvedConfig) {
  if (
    resolvedConfig.optimizeDeps.esbuildOptions?.plugins &&
    resolvedConfig.optimizeDeps.esbuildOptions.plugins.length > 0
  ) {
    resolvedConfig.optimizeDeps.rolldownOptions ??= {}
    resolvedConfig.optimizeDeps.rolldownOptions.plugins ||= []
    ;(resolvedConfig.optimizeDeps.rolldownOptions.plugins as any[]).push(
      ...resolvedConfig.optimizeDeps.esbuildOptions.plugins.map((plugin) =>
        convertEsbuildPluginToRolldownPlugin(plugin),
      ),
    )
  }
}

/**
 * 判断输入是否已经是 `resolveConfig()` 生成的 ResolvedConfig。
 * 唯一 symbol 品牌不会与普通用户字段冲突，也不能被 JSON 配置偶然伪造。
 */
export function isResolvedConfig(
  inlineConfig: InlineConfig | ResolvedConfig,
): inlineConfig is ResolvedConfig {
  return (
    SYMBOL_RESOLVED_CONFIG in inlineConfig &&
    inlineConfig[SYMBOL_RESOLVED_CONFIG]
  )
}

/**
 * 把 CLI/Node API 的内联配置、`vite.config.*`、插件钩子和默认值归一成
 * {@link ResolvedConfig}。
 *
 * 阅读这条主链时可按六个阶段理解：
 *
 * 1. 建立旧字段兼容代理，确定初始 mode/NODE_ENV，并加载配置文件；
 * 2. 过滤、排序插件，依次运行 `config` 钩子；
 * 3. 规范化 root，继承 Environment 配置，运行 `configEnvironment` 并解析环境选项；
 * 4. 加载 `.env`，解析 base/cacheDir/server/build 等派生配置；
 * 5. 组装 ResolvedConfig，创建 Worker 工厂和 Vite 内部插件；
 * 6. 运行 `configResolved`，回填环境插件、兼容字段并执行最终校验。
 *
 * 配置覆盖关系大体为：静态默认值 < 配置文件 < 内联配置 < 插件返回值；环境配置还会
 * 先继承顶层默认值，再由 `environments[name]` 覆盖。函数会设置 `process.env.NODE_ENV`，
 * 因而并非纯函数。
 *
 * @param inlineConfig - CLI 或 Node API 传入的配置；加载文件后先用它覆盖文件值。
 * @param command - 当前是开发/预览服务器流程还是构建流程。
 * @param defaultMode - 命令未显式提供 mode 时的默认值。
 * @param defaultNodeEnv - 宿主进程尚未设置 NODE_ENV 时的临时默认值。
 * @param isPreview - 是否由 preview 命令发起；preview 的 command 仍是 `serve`。
 * @param patchConfig - 内部兼容钩子，在创建内部插件前修补 resolved 配置。
 * @param patchPlugins - 内部 Builder 兼容钩子，在插件解析后修补插件列表。
 */
export async function resolveConfig(
  inlineConfig: InlineConfig,
  command: 'build' | 'serve',
  defaultMode = 'development',
  defaultNodeEnv = 'development',
  isPreview = false,
  /** @internal */
  patchConfig: ((config: ResolvedConfig) => void) | undefined = undefined,
  /** @internal */
  patchPlugins: ((resolvedPlugins: Plugin[]) => void) | undefined = undefined,
): Promise<ResolvedConfig> {
  let config = inlineConfig
  config.build ??= {}
  setupRollupOptionCompat(config.build, 'build')
  config.worker ??= {}
  setupRollupOptionCompat(config.worker, 'worker')
  config.optimizeDeps ??= {}
  setupRollupOptionCompat(config.optimizeDeps, 'optimizeDeps')
  if (config.ssr) {
    config.ssr.optimizeDeps ??= {}
    setupRollupOptionCompat(config.ssr.optimizeDeps, 'ssr.optimizeDeps')
  }

  let configFileDependencies: string[] = []
  let mode = inlineConfig.mode || defaultMode
  // 本地未设置 NODE_ENV 时向 Vite Task 查询；Task runner 还会把该值计入构建缓存键。
  if (process.env.NODE_ENV === undefined) {
    const nodeEnv = getEnv('NODE_ENV')
    if (nodeEnv !== undefined) {
      process.env.NODE_ENV = nodeEnv
    }
  }
  const isNodeEnvSet = !!process.env.NODE_ENV
  const packageCache: PackageCache = new Map()

  // @vue/compiler-* 等依赖在导入时就读取 NODE_ENV 决定生产行为，因此必须尽早设置。
  if (!isNodeEnvSet) {
    process.env.NODE_ENV = defaultNodeEnv
  }

  const configEnv: ConfigEnv = {
    mode,
    command,
    isSsrBuild: command === 'build' && !!config.build?.ssr,
    isPreview,
  }

  let { configFile } = config
  if (configFile !== false) {
    const loadResult = await loadConfigFromFile(
      configEnv,
      configFile,
      config.root,
      config.logLevel,
      config.customLogger,
      config.configLoader,
    )
    if (loadResult) {
      config = mergeConfig(loadResult.config, config)
      configFile = loadResult.path
      configFileDependencies = loadResult.dependencies
    }
  }

  // 配置文件可以修改 mode，但内联 `--mode` 优先级始终更高。
  mode = inlineConfig.mode || config.mode || mode
  configEnv.mode = mode

  /** 删除条件 falsy 插件，并按 apply 回调或命令字符串筛选当前模式插件。 */
  const filterPlugin = (p: Plugin | FalsyPlugin): p is Plugin => {
    if (!p) {
      return false
    } else if (!p.apply) {
      return true
    } else if (typeof p.apply === 'function') {
      return p.apply({ ...config, mode }, configEnv)
    } else {
      return p.apply === command
    }
  }

  // 展平插件并执行 apply 过滤，再按 enforce 分成 pre、normal、post 三段。
  const rawPlugins = (await asyncFlatten(config.plugins || [])).filter(
    filterPlugin,
  )

  const [prePlugins, normalPlugins, postPlugins] = sortUserPlugins(rawPlugins)

  const isBuild = command === 'build'

  // config 钩子按插件顺序串行执行；后一插件能看到前一插件已合并的结果。
  const userPlugins = [...prePlugins, ...normalPlugins, ...postPlugins]
  config = await runConfigHook(config, userPlugins, configEnv)

  // 补齐所需的默认 Environment；缺失项前置插入，已有环境的声明顺序保持不变。
  config.environments ??= {}
  if (
    !config.environments.ssr &&
    (!isBuild || config.ssr || config.build?.ssr)
  ) {
    // 开发时默认准备 ssr 配置；优化器的扫描/预构建由环境的实际使用触发。
    // 构建时只有旧顶层 ssr/build.ssr 启用 SSR 才自动补此项；显式 environments.ssr 已在上游保留。
    config.environments = { ssr: {}, ...config.environments }
  }
  if (!config.environments.client) {
    config.environments = { client: {}, ...config.environments }
  }

  // 从最终日志选项创建后续所有解析阶段共用的 Logger。
  const logger = createLogger(config.logLevel, {
    allowClearScreen: config.clearScreen,
    customLogger: config.customLogger,
  })

  const tsconfigPathsPlugin = userPlugins.find(
    (p) =>
      p.name === 'vite-tsconfig-paths' ||
      p.name === 'vite-plugin-tsconfig-paths',
  )
  if (tsconfigPathsPlugin) {
    logger.warnOnce(
      colors.yellow(
        `The plugin ${JSON.stringify(tsconfigPathsPlugin.name)} is detected. ` +
          `Vite now supports tsconfig paths resolution natively via the ${colors.bold('resolve.tsconfigPaths')} option. ` +
          `You can remove the plugin and set ${colors.bold('resolve.tsconfigPaths: true')} in your Vite config instead.`,
      ),
    )
  }

  if (process.versions.pnp) {
    logger.warnOnce(
      colors.yellow(
        `Using Yarn PnP with Vite is discouraged and PnP-specific bugs will no longer be actively worked on. ` +
          `Please switch to a different ${colors.bold('nodeLinker')} mode or to a different package manager.`,
      ),
    )
  }

  // root 先转绝对路径、消除符号链接，再统一成正斜杠路径。
  let nonNormalizedResolvedRoot = config.root
    ? path.resolve(config.root)
    : process.cwd()
  try {
    nonNormalizedResolvedRoot = safeRealpathSync(nonNormalizedResolvedRoot)
  } catch {}
  const resolvedRoot = normalizePath(nonNormalizedResolvedRoot)

  checkBadCharactersInPath(
    'The project root',
    'directory',
    resolvedRoot,
    logger,
  )

  const configEnvironmentsClient = config.environments!.client!
  configEnvironmentsClient.dev ??= {}

  const deprecatedSsrOptimizeDepsConfig = config.ssr?.optimizeDeps ?? {}
  let configEnvironmentsSsr = config.environments!.ssr

  // 兼容旧字段：server.warmup.clientFiles/ssrFiles → environment.dev.warmup。
  const warmupOptions = config.server?.warmup
  if (warmupOptions?.clientFiles) {
    configEnvironmentsClient.dev.warmup = warmupOptions.clientFiles
  }
  if (warmupOptions?.ssrFiles) {
    configEnvironmentsSsr ??= {}
    configEnvironmentsSsr.dev ??= {}
    configEnvironmentsSsr.dev.warmup = warmupOptions.ssrFiles
  }

  // 兼容旧顶层 ssr：把它作为 environments.ssr 的低优先级默认值。
  if (configEnvironmentsSsr) {
    configEnvironmentsSsr.optimizeDeps = mergeConfig(
      deprecatedSsrOptimizeDepsConfig,
      configEnvironmentsSsr.optimizeDeps ?? {},
    )

    // 以 resolve 为根调用 mergeConfig，才能命中 noExternal 的专用数组合并规则。
    configEnvironmentsSsr.resolve = mergeConfig(
      {
        resolve: {
          conditions: config.ssr?.resolve?.conditions,
          externalConditions: config.ssr?.resolve?.externalConditions,
          mainFields: config.ssr?.resolve?.mainFields,
          external: config.ssr?.external,
          noExternal: config.ssr?.noExternal,
        },
      } satisfies EnvironmentOptions,
      {
        resolve: configEnvironmentsSsr.resolve ?? {},
      },
    ).resolve
  }

  if (config.build?.ssrEmitAssets !== undefined) {
    configEnvironmentsSsr ??= {}
    configEnvironmentsSsr.build ??= {}
    configEnvironmentsSsr.build.emitAssets = config.build.ssrEmitAssets
  }

  // 插件 config 钩子不能删除必须存在的 client，以及开发阶段必须存在的 ssr。
  if (!config.environments.client || (!config.environments.ssr && !isBuild)) {
    throw new Error(
      'Required environments configuration were stripped out in the config hook',
    )
  }

  // 为每个 Environment 合并顶层默认值。
  const defaultEnvironmentOptions = getDefaultEnvironmentOptions(config)
  // input、完整 resolve 和 optimizeDeps 等旧顶层入口只由 client 继承。
  const defaultClientEnvironmentOptions: UserConfig = {
    ...defaultEnvironmentOptions,
    input: config.input,
    resolve: config.resolve, // client 继承包括 mainFields/conditions 在内的完整解析项。
    optimizeDeps: config.optimizeDeps,
  }
  const defaultNonClientEnvironmentOptions: UserConfig = {
    ...defaultEnvironmentOptions,
    dev: {
      ...defaultEnvironmentOptions.dev,
      createEnvironment: undefined,
      warmup: undefined,
    },
    build: {
      ...defaultEnvironmentOptions.build,
      createEnvironment: undefined,
    },
  }

  for (const name of Object.keys(config.environments)) {
    config.environments[name] = mergeConfig(
      name === 'client'
        ? defaultClientEnvironmentOptions
        : (deepClone(
            defaultNonClientEnvironmentOptions as object,
          ) as UserConfig),
      config.environments[name],
    )
  }

  await runConfigEnvironmentHook(
    config.environments,
    userPlugins,
    logger,
    configEnv,
    config.ssr?.target === 'webworker',
  )

  const isBundledDev = command === 'serve' && !!config.experimental?.bundledDev

  // 兼容旧插件读取：把 environments.client.resolve 的关键字段同步回顶层 resolve。
  config.resolve ??= {}
  config.resolve.conditions = config.environments.client.resolve?.conditions
  config.resolve.mainFields = config.environments.client.resolve?.mainFields

  const resolvedDefaultResolve = resolveResolveOptions(config.resolve, logger)

  const resolvedEnvironments: Record<string, ResolvedEnvironmentOptions> = {}
  for (const environmentName of Object.keys(config.environments)) {
    resolvedEnvironments[environmentName] = resolveEnvironmentOptions(
      config.environments[environmentName],
      resolvedDefaultResolve.alias,
      resolvedDefaultResolve.preserveSymlinks,
      inlineConfig.forceOptimizeDeps,
      logger,
      environmentName,
      isBuild,
      isBundledDev,
      config.ssr?.target === 'webworker',
      config.server?.preTransformRequests,
    )
  }

  // 兼容旧插件读取：顶层 optimizeDeps 与 client 环境必须引用同一对象。生态插件常在
  // configResolved 中直接修改它，共享引用可让改动同步反映到 client Environment。
  const backwardCompatibleOptimizeDeps =
    resolvedEnvironments.client.optimizeDeps

  const resolvedDevEnvironmentOptions = resolveDevEnvironmentOptions(
    config.dev,
    // 顶层 dev 没有具体 environmentName/consumer，按通用默认值解析。
    undefined,
    undefined,
  )

  const resolvedBuildOptions = resolveBuildEnvironmentOptions(
    config.build ?? {},
    logger,
    undefined,
    isBundledDev,
    config.input,
  )

  // 兼容旧 SSR 插件：即使用户只配置 environments.ssr，也把解析结果同步回顶层 ssr。
  const patchedConfigSsr = {
    ...config.ssr,
    external: resolvedEnvironments.ssr?.resolve.external,
    noExternal: resolvedEnvironments.ssr?.resolve.noExternal,
    optimizeDeps: resolvedEnvironments.ssr?.optimizeDeps,
    resolve: {
      ...config.ssr?.resolve,
      conditions: resolvedEnvironments.ssr?.resolve.conditions,
      externalConditions: resolvedEnvironments.ssr?.resolve.externalConditions,
    },
  }
  const ssr = resolveSSROptions(
    patchedConfigSsr,
    resolvedDefaultResolve.preserveSymlinks,
  )

  // 加载 `.env*`；旧 `envFile: false` 等价于新 `envDir: false`。
  if (config.envFile === false) {
    logger.warn(
      colors.yellow(
        'The `envFile` option is deprecated, please use `envDir: false` instead.',
      ),
    )
  }
  let envDir = config.envFile === false ? false : config.envDir
  if (envDir !== false) {
    envDir = config.envDir
      ? normalizePath(path.resolve(resolvedRoot, config.envDir))
      : resolvedRoot
  }

  const userEnv = loadEnv(mode, envDir, resolveEnvPrefix(config))

  // 自定义 mode（如 staging）仍可能需要 development 语义。env.ts 会把
  // `.env.staging` 中的 NODE_ENV 暂存到 VITE_USER_NODE_ENV，供这里二次判定。
  const userNodeEnv = process.env.VITE_USER_NODE_ENV
  if (!isNodeEnvSet && userNodeEnv) {
    if (userNodeEnv === 'development') {
      process.env.NODE_ENV = 'development'
    } else {
      // `.env` 中的 production 会让 Vue 等框架生成生产代码并破坏开发 HMR，因此不接受。
      logger.warn(
        `NODE_ENV=${userNodeEnv} is not supported in the .env file. ` +
          `Only NODE_ENV=development is supported to create a development build of your project. ` +
          `If you need to set process.env.NODE_ENV, you can set it in the Vite config instead.`,
      )
    }
  }

  const isProduction = process.env.NODE_ENV === 'production'

  // 解析公开 base URL；保留是否使用相对路径的原始语义。
  const relativeBaseShortcut = config.base === '' || config.base === './'

  // 开发服务器忽略相对 base 并回退到 `/`；SSR 构建也不能依赖 import.meta.url 推导它。
  const resolvedBase = relativeBaseShortcut
    ? !isBuild || config.build?.ssr
      ? '/'
      : './'
    : resolveBaseUrl(config.base, isBuild, logger)

  // cacheDir 默认放在最近 package 根的 node_modules/.vite。找不到 package.json 但 root
  // 已有 node_modules（如使用 npm 包的 Deno 项目）时，也优先放入 node_modules/.vite；
  // 两者都不存在才回退到 root/.vite。
  const pkgDir = findNearestPackageData(resolvedRoot, packageCache)?.dir
  let cacheDir: string
  if (config.cacheDir) {
    cacheDir = path.resolve(resolvedRoot, config.cacheDir)
  } else if (pkgDir) {
    cacheDir = path.join(pkgDir, `node_modules/.vite`)
  } else {
    const nodeModulesDir = path.join(resolvedRoot, 'node_modules')
    cacheDir = fs.existsSync(nodeModulesDir)
      ? path.join(nodeModulesDir, `.vite`)
      : path.join(resolvedRoot, `.vite`)
  }
  cacheDir = normalizePath(cacheDir)

  /** 匹配用户额外声明的资源类型；未配置或空数组时关闭这部分匹配，内置资源规则另行判断。 */
  const assetsFilter =
    config.assetsInclude &&
    (!Array.isArray(config.assetsInclude) || config.assetsInclude.length)
      ? createFilter(config.assetsInclude)
      : () => false

  // publicDir 允许 false/空字符串显式关闭；其余相对路径始终相对于 resolvedRoot。
  const { publicDir } = config
  const resolvedPublicDir =
    publicDir !== false && publicDir !== ''
      ? normalizePath(
          path.resolve(
            resolvedRoot,
            typeof publicDir === 'string'
              ? publicDir
              : configDefaults.publicDir,
          ),
        )
      : ''

  const input = normalizeInput(config.input)
  const server = await resolveServerOptions(resolvedRoot, config.server, logger)

  const builder = resolveBuilderOptions(config.builder)

  const BASE_URL = resolvedBase

  const resolvedConfigContext = new BasicMinimalPluginContext(
    {
      ...basePluginContextMeta,
      watchMode:
        (command === 'serve' && !isPreview) ||
        (command === 'build' && !!resolvedBuildOptions.watch),
    } satisfies PluginContextMeta,
    logger,
  )

  let resolved: ResolvedConfig

  let createUserWorkerPlugins = config.worker?.plugins
  if (Array.isArray(createUserWorkerPlugins)) {
    // @ts-expect-error 兼容旧版直接传插件数组的写法。
    createUserWorkerPlugins = () => config.worker?.plugins

    logger.warn(
      colors.yellow(
        `worker.plugins is now a function that returns an array of plugins. ` +
          `Please update your Vite config accordingly.\n`,
      ),
    )
  }

  /**
   * 为一次 Worker 子构建创建独立插件实例与专属的顶层 ResolvedConfig 对象。
   *
   * Worker 构建不能复用主构建插件实例：插件可能缓存上下文，也可能只适合最终产物后处理；
   * 复用会让额外的嵌套 Rolldown 调用污染插件状态。因此这里重新执行插件工厂、config 与
   * configResolved 钩子，同时用 bundleChain 保留递归 Worker 链。
   */
  const createWorkerPlugins = async function (bundleChain: string[]) {
    // 每次调用插件工厂，确保 Worker 拿到独立实例。
    const rawWorkerUserPlugins = (
      await asyncFlatten(createUserWorkerPlugins?.() || [])
    ).filter(filterPlugin)

    // mergeConfig({}, config) 创建新顶层对象；未发生递归合并的嵌套值仍可能共享引用。
    // 然后执行 Worker 专属插件的 config 钩子。
    let workerConfig = mergeConfig({}, config)
    const [workerPrePlugins, workerNormalPlugins, workerPostPlugins] =
      sortUserPlugins(rawWorkerUserPlugins)

    // Worker 插件同样按顺序运行 config 钩子；此处不重跑主配置的整套环境/默认值解析。
    const workerUserPlugins = [
      ...workerPrePlugins,
      ...workerNormalPlugins,
      ...workerPostPlugins,
    ]
    workerConfig = await runConfigHook(
      workerConfig,
      workerUserPlugins,
      configEnv,
    )

    // 主 resolved 覆盖已解析字段；Worker 的专属标志最后写入。未复制的嵌套配置沿用主对象。
    const workerResolved: ResolvedConfig = {
      ...workerConfig,
      ...resolved,
      isWorker: true,
      mainConfig: resolved,
      bundleChain,
    }

    // resolvePlugins 依赖除 plugins 外已经完成的配置，因此只能在对象建立后回写字段。
    ;(workerResolved.plugins as Plugin[]) = await resolvePlugins(
      workerResolved,
      workerPrePlugins,
      workerNormalPlugins,
      workerPostPlugins,
    )

    // Worker 的 configResolved 钩子读取 workerResolved，而不是主应用 resolved。
    await Promise.all(
      createPluginHookUtils(workerResolved.plugins)
        .getSortedPluginHooks('configResolved')
        .map((hook) => hook.call(resolvedConfigContext, workerResolved)),
    )

    // 生态插件可能在 configResolved 中继续修改插件列表，所以环境插件必须随后解析。
    // 构建 Worker 借用 client 环境；复制该环境后再写 plugins，避免改坏主配置的 client。
    ;(workerResolved.environments as Record<
      string,
      ResolvedEnvironmentOptions
    >) = {
      ...workerResolved.environments,
      client: {
        ...workerResolved.environments.client,
        plugins: await resolveEnvironmentPlugins(
          new PartialEnvironment('client', workerResolved),
        ),
      },
    }

    return workerResolved
  }

  const resolvedWorkerOptions: Omit<
    ResolvedWorkerOptions,
    'rolldownOptions'
  > & {
    /** 新 Rolldown worker 配置；缺省时稍后由旧 rollupOptions 建立代理。 */
    rolldownOptions: ResolvedWorkerOptions['rolldownOptions'] | undefined
  } = {
    format: config.worker?.format || 'iife',
    plugins: createWorkerPlugins,
    rollupOptions: config.worker?.rollupOptions || {},
    // 缺省时由 setupRollupOptionCompat 从旧 rollupOptions 建立兼容代理。
    rolldownOptions: config.worker?.rolldownOptions,
  }
  setupRollupOptionCompat(resolvedWorkerOptions, 'worker')

  const base = withTrailingSlash(resolvedBase)

  const preview = resolvePreviewOptions(config.preview, server)

  const additionalAllowedHosts = getAdditionalAllowedHosts(server, preview)
  if (Array.isArray(server.allowedHosts)) {
    server.allowedHosts.push(...additionalAllowedHosts)
  }
  if (Array.isArray(preview.allowedHosts)) {
    preview.allowedHosts.push(...additionalAllowedHosts)
  }

  let oxc: OxcOptions | false | undefined = config.oxc
  if (config.esbuild) {
    if (config.oxc) {
      logger.warn(
        colors.yellow(
          `Both esbuild and oxc options were set. oxc options will be used and esbuild options will be ignored.`,
        ) +
          ` The following esbuild options were set: \`${inspect(config.esbuild)}\``,
      )
    } else {
      oxc = convertEsbuildConfigToOxcConfig(config.esbuild, logger)
    }
  } else if (config.esbuild === false && config.oxc !== false) {
    logger.warn(
      colors.yellow(
        `\`esbuild\` option is set to false, but \`oxc\` option was not set to false. ` +
          `\`esbuild: false\` does not have effect any more. ` +
          `If you want to disable the default transformation, which is now handled by Oxc, please set \`oxc: false\` instead.`,
      ),
    )
  }

  const experimental = mergeWithDefaults(
    configDefaults.experimental,
    config.experimental ?? {},
  )
  if (command === 'serve' && experimental.bundledDev) {
    // 全量打包开发模式尚不支持 experimental.renderBuiltUrl，主动关闭以免生成错误 URL。
    experimental.renderBuiltUrl = undefined
  }

  const resolvedDevToolsConfig = await resolveDevToolsConfig(
    config.devtools,
    server.host,
    logger,
  )

  resolved = {
    configFile: configFile ? normalizePath(configFile) : undefined,
    configFileDependencies: configFileDependencies.map((name) =>
      normalizePath(path.resolve(name)),
    ),
    inlineConfig,
    root: resolvedRoot,
    base,
    decodedBase: decodeBase(base),
    rawBase: resolvedBase,
    publicDir: resolvedPublicDir,
    cacheDir,
    command,
    mode,
    isWorker: false,
    mainConfig: null,
    bundleChain: [],
    isProduction,
    // 先放用户插件占位；内部插件依赖 resolved 对象，稍后由 resolvePlugins 整体替换。
    plugins: userPlugins,
    css: resolveCSSOptions(config.css),
    json: mergeWithDefaults(configDefaults.json, config.json ?? {}),
    // 保留 esbuild 配置供兼容的 buildEsbuildPlugin 使用。
    esbuild:
      config.esbuild === false
        ? false
        : {
            jsxDev: !isProduction,
            // Vite 输出更适合 UTF-8，且不默认保留第三方许可注释。
            charset: 'utf8',
            legalComments: 'none',
            ...config.esbuild,
          },
    oxc:
      oxc === false
        ? false
        : {
            ...oxc,
            jsx:
              typeof oxc?.jsx === 'string'
                ? oxc.jsx
                : {
                    development: oxc?.jsx?.development ?? !isProduction,
                    ...oxc?.jsx,
                  },
          },
    server,
    builder,
    preview,
    envDir,
    env: {
      ...userEnv,
      BASE_URL,
      MODE: mode,
      DEV: !isProduction,
      PROD: isProduction,
    },
    /** 判断文件是否命中内置或用户配置的静态资源规则。 */
    assetsInclude(file: string) {
      return DEFAULT_ASSETS_RE.test(file) || assetsFilter(file)
    },
    rawAssetsInclude: config.assetsInclude ? arraify(config.assetsInclude) : [],
    logger,
    packageCache,
    worker: resolvedWorkerOptions,
    appType: config.appType ?? 'spa',
    experimental,
    future:
      config.future === 'warn'
        ? ({
            removePluginHookHandleHotUpdate: 'warn',
            removePluginHookSsrArgument: 'warn',
            removeServerModuleGraph: 'warn',
            removeServerReloadModule: 'warn',
            removeServerPluginContainer: 'warn',
            removeServerHot: 'warn',
            removeServerTransformRequest: 'warn',
            removeServerWarmupRequest: 'warn',
            removeSsrLoadModule: 'warn',
          } satisfies Required<FutureOptions>)
        : config.future,

    ssr,

    input,
    optimizeDeps: backwardCompatibleOptimizeDeps,
    resolve: resolvedDefaultResolve,
    dev: resolvedDevEnvironmentOptions,
    build: resolvedBuildOptions,
    devtools: resolvedDevToolsConfig,

    environments: resolvedEnvironments,

    // 生成 72 位随机 WebSocket 会话 token（base64url 为 12 字符），高于 OWASP 建议的
    // 至少 64 位熵，避免任意网页连接本机开发服务器的 HMR 通道。
    // 参考：https://owasp.org/www-community/vulnerabilities/Insufficient_Session-ID_Length
    webSocketToken: Buffer.from(
      crypto.getRandomValues(new Uint8Array(9)),
    ).toString('base64url'),

    getSortedPlugins: undefined!,
    getSortedPluginHooks: undefined!,

    /** 创建兼容旧 client/SSR 布尔参数的惰性内部 resolver。 */
    createResolver(options) {
      const resolve = createIdResolver(this, options)
      const clientEnvironment = new PartialEnvironment('client', this)
      let ssrEnvironment: PartialEnvironment | undefined
      return async (id, importer, aliasOnly, ssr) => {
        if (ssr) {
          ssrEnvironment ??= new PartialEnvironment('ssr', this)
        }
        return await resolve(
          ssr ? ssrEnvironment! : clientEnvironment,
          id,
          importer,
          aliasOnly,
        )
      }
    },
    fsDenyGlob: picomatch(
      // picomatch 的 matchBase 行为与文档不符，因此先把不含 `/` 的模式手动扩成
      // `**/pattern`，再关闭 matchBase：
      // https://github.com/micromatch/picomatch/issues/89
      server.fs.deny.map((pattern) =>
        pattern.includes('/') ? pattern : `**/${pattern}`,
      ),
      {
        matchBase: false,
        nocase: true,
        dot: true,
      },
    ),
    safeModulePaths: new Set<string>(),
    [SYMBOL_RESOLVED_CONFIG]: true,
  }
  resolved = {
    ...config,
    ...resolved,
  }

  // Builder 兼容钩子：内部插件创建前修补 resolved（例如旧 config.build.ssr）。等内部插件
  // 全部只读取 environment.config 后，可把 patchConfig/patchPlugins 合并成单一钩子。
  patchConfig?.(resolved)

  const resolvedPlugins = await resolvePlugins(
    resolved,
    prePlugins,
    normalPlugins,
    postPlugins,
  )

  // Builder 兼容钩子：构建时选择性加入跨 Environment 共享插件。
  patchPlugins?.(resolvedPlugins)
  ;(resolved.plugins as Plugin[]) = resolvedPlugins

  // TODO：弃用 config.getSortedPlugins 和 config.getSortedPluginHooks。
  Object.assign(resolved, createPluginHookUtils(resolved.plugins))

  // 顶层内部插件已装配完成。configResolved 统一并发启动，不串行合并返回值；
  // 钩子仍可修改共享配置，所以 Environment 插件解析需等全部钩子完成。
  await Promise.all(
    resolved
      .getSortedPluginHooks('configResolved')
      .map((hook) => hook.call(resolvedConfigContext, resolved)),
  )

  // 生态项目会在 configResolved 中修改插件，因此 Environment 插件只能在它之后解析。
  for (const name of Object.keys(resolved.environments)) {
    resolved.environments[name].plugins = await resolveEnvironmentPlugins(
      new PartialEnvironment(name, resolved),
    )
  }

  optimizeDepsDisabledBackwardCompatibility(resolved, resolved.optimizeDeps)
  optimizeDepsDisabledBackwardCompatibility(
    resolved,
    resolved.ssr.optimizeDeps,
    'ssr.',
  )

  // 兼容在 configResolved 中修改 build.ssrEmitAssets 的 SSR 插件（如 Vike）：未启用
  // sharedConfigBuild 时，把最终值同步到 SSR Environment 的 build.emitAssets。
  // 参考：https://github.com/vikejs/vike/blob/953614cea7b418fcc0309b5c918491889fdec90a/vike/node/plugin/plugins/buildConfig.ts#L67
  if (!resolved.builder?.sharedConfigBuild && resolved.environments.ssr) {
    resolved.environments.ssr.build.emitAssets =
      resolved.build.ssrEmitAssets || resolved.build.emitAssets
  }

  applyDepOptimizationOptionCompat(resolved)
  await setOptimizeDepsPluginNames(resolved)

  debug?.(`using resolved config: %O`, {
    ...resolved,
    plugins: resolved.plugins.map((p) => p.name),
    worker: {
      ...resolved.worker,
      plugins: `() => plugins`,
    },
  })

  // 最后校验跨字段约束；此时插件对配置的修改也必须计入。

  // Vite 目前只支持所有 output 共用一个 assetFileNames 引用；不同引用无法可靠合并。
  const outputOption = config.build?.rolldownOptions?.output ?? []
  // Array.isArray 同时负责把 output 类型缩窄为数组。
  if (Array.isArray(outputOption)) {
    const assetFileNamesList = outputOption.map(
      (output) => output.assetFileNames,
    )
    if (assetFileNamesList.length > 1) {
      const firstAssetFileNames = assetFileNamesList[0]
      const hasDifferentReference = assetFileNamesList.some(
        (assetFileNames) => assetFileNames !== firstAssetFileNames,
      )
      if (hasDifferentReference) {
        resolved.logger.warn(
          colors.yellow(`
assetFileNames isn't equal for every build.rolldownOptions.output. A single pattern across all outputs is supported by Vite.
`),
        )
      }
    }
  }

  if (config.experimental?.renderBuiltUrl && config.build?.chunkImportMap) {
    resolved.logger.warn(
      colors.yellow(
        `The \`build.chunkImportMap\` option and the \`experimental.renderBuiltUrl\` option are both enabled.` +
          ` The combination of these two options is not supported and may result in unexpected behavior.`,
      ),
    )
  }

  // 对 Vite 5 已删除的实验 SSR CJS 选项保留明确迁移告警。
  if (
    // @ts-expect-error 字段已从公开类型删除，仅用于运行时迁移提示。
    config.legacy?.buildSsrCjsExternalHeuristics ||
    // @ts-expect-error 字段已从公开类型删除，仅用于运行时迁移提示。
    config.ssr?.format === 'cjs'
  ) {
    resolved.logger.warn(
      colors.yellow(`
(!) Experimental legacy.buildSsrCjsExternalHeuristics and ssr.format were be removed in Vite 5.
    The only SSR Output format is ESM. Find more information at https://github.com/vitejs/vite/discussions/13816.
`),
    )
  }

  const resolvedBuildOutDir = normalizePath(
    path.resolve(resolved.root, resolved.build.outDir),
  )
  if (
    isParentDirectory(resolvedBuildOutDir, resolved.root) ||
    resolvedBuildOutDir === resolved.root
  ) {
    resolved.logger.warn(
      colors.yellow(`
(!) build.outDir must not be the same directory of root or a parent directory of root as this could cause Vite to overwriting source files with build outputs.
`),
    )
  }

  return resolved
}

/**
 * 校验并规范化用户的公开基础路径。
 *
 * serve 阶段只保留 URL pathname；build 阶段则保留完整外部 URL，因为 Electron、CDN
 * 部署等非普通 Web 根路径目标会直接使用它。`''` 和 `'./'` 的相对 base 已由
 * `resolveConfig()` 在调用前单独处理（SSR 相对 base 修复见 #8683）。
 *
 * @param base - 用户配置的 base。
 * @param isBuild - 是否处于构建流程。
 * @param logger - 非法或缺少前导斜杠时使用的 Logger。
 */
export function resolveBaseUrl(
  base: UserConfig['base'] = configDefaults.base,
  isBuild: boolean,
  logger: Logger,
): string {
  if (base[0] === '.') {
    logger.warn(
      colors.yellow(
        colors.bold(
          `(!) invalid "base" option: "${base}". The value can only be an absolute ` +
            `URL, "./", or an empty string.`,
        ),
      ),
    )
    return '/'
  }

  // 完整外部 URL 在 build 中原样保留协议和主机。
  const isExternal = isExternalUrl(base)
  // 本地路径缺少前导 `/` 时仍尽力修复，但先告警帮助用户纠正配置。
  if (!isExternal && base[0] !== '/') {
    logger.warn(
      colors.yellow(
        colors.bold(`(!) "base" option should start with a slash.`),
      ),
    )
  }

  // serve 只需要 pathname；非外部 build base 也借助 URL 解析器处理编码与相对语义。
  if (!isBuild || !isExternal) {
    base = new URL(base, 'http://vite.dev').pathname
    // URL 解析后再次确保前导斜杠，稳定下游拼接约定。
    if (base[0] !== '/') {
      base = '/' + base
    }
  }

  return base
}

/** 解码 base 中的 URI 转义；格式错误时转成带配置语义的异常。 */
function decodeBase(base: string): string {
  try {
    return decodeURI(base)
  } catch {
    throw new Error(
      'The value passed to "base" option was malformed. It should be a valid URL.',
    )
  }
}

/**
 * 按 `enforce` 把已展平的用户插件稳定分组为 pre、normal、post。
 * 同组插件保持声明顺序，真正的钩子级 order 排序由 hook 工具处理。
 */
export function sortUserPlugins(
  plugins: (Plugin | Plugin[])[] | undefined,
): [Plugin[], Plugin[], Plugin[]] {
  const prePlugins: Plugin[] = []
  const postPlugins: Plugin[] = []
  const normalPlugins: Plugin[] = []

  if (plugins) {
    plugins.flat().forEach((p) => {
      if (p.enforce === 'pre') prePlugins.push(p)
      else if (p.enforce === 'post') postPlugins.push(p)
      else normalPlugins.push(p)
    })
  }

  return [prePlugins, normalPlugins, postPlugins]
}

/**
 * 发现、执行并校验一个 Vite 配置文件。
 *
 * 显式 `configFile` 始终相对当前工作目录解析；未显式指定时，才在 `configRoot` 中按
 * `DEFAULT_CONFIG_FILES` 顺序查找。三种 loader 的取舍如下：
 *
 * - `bundle`：默认路径。先用 Rolldown 打包本地配置依赖，再交给 Node 执行；TS/CJS/ESM
 *   兼容性最好，并能指出将来切换 native loader 时的不兼容语法（#22850）。
 * - `runner`：通过 Vite Module Runner 执行并跟踪依赖，适合实验性运行时（#18637）。
 * - `native`：直接交给当前运行时导入，不经 Vite 转换 TypeScript/模块语义；跳过配置
 *   bundle。freshImport 可用时跟踪依赖，否则只给入口添加时间戳并返回空依赖列表。
 *
 * 函数式默认导出会收到 {@link ConfigEnv}，且允许异步返回。最终结果必须是对象。
 *
 * @returns 配置路径、用户配置和需要监听的配置依赖；未找到默认配置时返回 `null`。
 */
export async function loadConfigFromFile(
  configEnv: ConfigEnv,
  configFile?: string,
  configRoot: string = process.cwd(),
  logLevel?: LogLevel,
  customLogger?: Logger,
  configLoader: 'bundle' | 'runner' | 'native' = 'bundle',
): Promise<{
  /** 实际加载的配置文件绝对路径。 */
  path: string
  /** 求值并校验后的用户配置对象。 */
  config: UserConfig
  /** 需由 watcher 跟踪的配置传递依赖。 */
  dependencies: string[]
} | null> {
  if (
    configLoader !== 'bundle' &&
    configLoader !== 'runner' &&
    configLoader !== 'native'
  ) {
    throw new Error(
      `Unsupported configLoader: ${configLoader}. Accepted values are 'bundle', 'runner', and 'native'.`,
    )
  }

  const start = performance.now()
  /** 返回从本次配置加载开始计算的毫秒耗时文本。 */
  const getTime = () => `${(performance.now() - start).toFixed(2)}ms`

  let resolvedPath: string | undefined

  if (configFile) {
    // 显式路径始终相对 cwd，与 CLI `--config` 的直觉保持一致。
    resolvedPath = path.resolve(configFile)
  } else {
    // 隐式配置从内联 root（若存在）查找，否则 configRoot 默认就是 cwd。
    for (const filename of DEFAULT_CONFIG_FILES) {
      const filePath = path.resolve(configRoot, filename)
      if (!fs.existsSync(filePath)) continue

      resolvedPath = filePath
      break
    }
  }

  if (!resolvedPath) {
    debug?.('no config file found.')
    return null
  }

  try {
    const { configExport, dependencies } = await (configLoader === 'bundle'
      ? bundleAndLoadConfigFile(
          resolvedPath,
          configRoot,
          logLevel,
          customLogger,
        )
      : configLoader === 'runner'
        ? runnerImportConfigFile(resolvedPath)
        : nativeImportConfigFile(resolvedPath))
    debug?.(`config file loaded in ${getTime()}`)

    const config = await (typeof configExport === 'function'
      ? configExport(configEnv)
      : configExport)
    if (!isObject(config)) {
      throw new Error(`config must export or return an object.`)
    }

    return {
      path: normalizePath(resolvedPath),
      config,
      dependencies,
    }
  } catch (e) {
    const logger = createLogger(logLevel, { customLogger })
    checkBadCharactersInPath('The config path', 'file', resolvedPath, logger)
    logger.error(colors.red(`failed to load config from ${resolvedPath}`), {
      error: e,
    })
    throw e
  }
}

/**
 * 使用当前 Node/Deno 运行时原生导入配置。
 * Vite Task 提供 freshImport 时可同时绕过缓存并跟踪传递依赖；普通运行时退化为时间戳
 * query 动态导入，只能报告空依赖列表。
 */
async function nativeImportConfigFile(resolvedPath: string): Promise<{
  /** 配置模块的默认导出值。 */
  configExport: any
  /** freshImport 记录的传递依赖；普通 import 时为空。 */
  dependencies: string[]
}> {
  const freshImported = freshImport(pathToFileURL(resolvedPath).href)
  if (freshImported) {
    const { result, dependencies } = await freshImported
    return {
      configExport: (
        result as {
          /** 标记 freshImport 返回值为模块 namespace。 */
          [Symbol.toStringTag]: 'Module'
          /** 配置模块默认导出。 */
          default: any
        }
      ).default,
      dependencies,
    }
  }

  const module = await import(
    pathToFileURL(resolvedPath).href + '?t=' + Date.now()
  )
  return { configExport: module.default, dependencies: [] }
}

/** 通过 Module Runner 执行配置，并返回 Runner 记录到的传递依赖。 */
async function runnerImportConfigFile(resolvedPath: string) {
  const { module, dependencies } = await runnerImport<{
    /** Module Runner 求值得到的配置默认导出。 */
    default: UserConfigExport
  }>(resolvedPath)
  return {
    configExport: module.default,
    dependencies,
  }
}

/**
 * 默认配置加载流程：先打包配置，再按其 ESM/CJS 身份执行打包结果。
 * bundle 阶段同时收集依赖和 native loader 不兼容项；后者只告警，不影响当前加载。
 */
async function bundleAndLoadConfigFile(
  resolvedPath: string,
  configRoot: string,
  logLevel: LogLevel | undefined,
  customLogger: Logger | undefined,
) {
  const isESM =
    typeof process.versions.deno === 'string' || isFilePathESM(resolvedPath)

  const bundled = await bundleConfigFile(resolvedPath, isESM)
  const userConfig = await loadConfigFromBundledFile(
    resolvedPath,
    bundled.code,
    isESM,
  )

  if (bundled.nativeIncompatibilities.length > 0) {
    const logger = createLogger(logLevel, { customLogger })
    logger.warn(
      formatNativeConfigIncompatWarning(
        bundled.nativeIncompatibilities,
        configRoot,
      ),
    )
  }

  return {
    configExport: userConfig,
    dependencies: bundled.dependencies,
  }
}

/**
 * 使用 Rolldown 把配置及其本地依赖打成单 chunk。
 *
 * 第三方包保留为外部依赖，由 Node 按真实 ESM/CJS 规则加载；本地文件打入 chunk，既让
 * TypeScript 可直接执行，也方便收集配置依赖。打包会改变文件作用域，因此插件需要为
 * 每个源文件注入原始 `__dirname`、`__filename` 和 `import.meta.*` 值。
 *
 * @returns 可执行代码、所有本地模块依赖，以及切换 native loader 时可能失败的语法项。
 */
async function bundleConfigFile(
  fileName: string,
  isESM: boolean,
): Promise<{
  /** 可交给 Node 执行的单 chunk 配置代码。 */
  code: string
  /** bundle 中纳入监听的本地模块绝对路径。 */
  dependencies: string[]
  /** 根据模块格式、全局引用与路径解析结果分类得到的 native 迁移提示。 */
  nativeIncompatibilities: NativeConfigIncompatibility[]
}> {
  let importMetaResolverRegistered = false

  const root = path.dirname(fileName)
  const dirnameVarName = '__vite_injected_original_dirname'
  const filenameVarName = '__vite_injected_original_filename'
  const importMetaUrlVarName = '__vite_injected_original_import_meta_url'
  const importMetaResolveVarName =
    '__vite_injected_original_import_meta_resolve'
  const importMetaResolveRegex = /import\.meta\s*\.\s*resolve/

  const nativeIncompatibilities: NativeConfigIncompatibility[] = []

  const bundle = await rolldown({
    input: fileName,
    // 暂不设置 target；配置代码直接由当前运行时执行。
    platform: 'node',
    resolve: {
      mainFields: ['main'],
    },
    transform: {
      define: {
        __dirname: dirnameVarName,
        __filename: filenameVarName,
        'import.meta.url': importMetaUrlVarName,
        'import.meta.dirname': dirnameVarName,
        'import.meta.filename': filenameVarName,
        'import.meta.resolve': importMetaResolveVarName,
        'import.meta.main': 'false',
      },
    },
    // 关闭 tree-shaking，确保无副作用模块仍出现在 moduleIds 中并进入依赖监听列表。
    treeshake: false,
    // 配置 bundle 不读取项目 tsconfig，不应用其 paths 或项目源码转换设置。
    tsconfig: false,
    plugins: [
      !process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING &&
        createNativeConfigCompatPlugin(nativeIncompatibilities),
      {
        name: 'externalize-deps',
        resolveId: {
          filter: { id: /^[^.#].*/ },
          /** 把第三方依赖和运行时 builtin 外部化，并保留本地/JSON 配置依赖。 */
          handler(id, importer, { kind }) {
            if (!importer || path.isAbsolute(id) || isNodeBuiltin(id)) {
              return
            }

            // isNodeBuiltin 已排除 Node 内置模块；此分支捕获 Deno 等非 Node 运行时内置项。
            // Rolldown 不应解析它们，交给最终运行时处理。
            if (isNodeLikeBuiltin(id) || id.startsWith('npm:')) {
              return { id, external: true }
            }

            const isImport = isESM || kind === 'dynamic-import'
            let idFsPath: string | undefined
            try {
              idFsPath = nodeResolveWithVite(id, importer, {
                root,
                isRequire: !isImport,
              })
            } catch (e) {
              if (!isImport) {
                let canResolveWithImport = false
                try {
                  canResolveWithImport = !!nodeResolveWithVite(id, importer, {
                    root,
                  })
                } catch {}
                if (canResolveWithImport) {
                  throw new Error(
                    `Failed to resolve ${JSON.stringify(
                      id,
                    )}. This package is ESM only but it was tried to load by \`require\`. See https://vite.dev/guide/troubleshooting.html#this-package-is-esm-only for more details.`,
                  )
                }
              }
              throw e
            }
            if (!idFsPath) return
            // Rolldown 尚不能为外部 JSON 保留 import attributes，因此 JSON 必须打进配置。
            if (idFsPath.endsWith('.json')) {
              return idFsPath
            }

            if (idFsPath && isImport) {
              idFsPath = pathToFileURL(idFsPath).href
            }
            return { id: idFsPath, external: true }
          },
        },
      },
      {
        name: 'inject-file-scope-variables',
        transform: {
          filter: { id: /\.[cm]?[jt]s$/ },
          /** 为每个打包模块注入其原始文件作用域变量与 import.meta 语义。 */
          handler(code, id) {
            let injectValues =
              `const ${dirnameVarName} = ${JSON.stringify(path.dirname(id))};` +
              `const ${filenameVarName} = ${JSON.stringify(id)};` +
              `const ${importMetaUrlVarName} = ${JSON.stringify(
                pathToFileURL(id).href,
              )};`
            if (importMetaResolveRegex.test(code)) {
              if (isESM) {
                if (!importMetaResolverRegistered) {
                  importMetaResolverRegistered = true
                  createImportMetaResolver()
                }
                injectValues += `const ${importMetaResolveVarName} = (specifier, importer = ${importMetaUrlVarName}) => (${importMetaResolveWithCustomHookString})(specifier, importer);`
              } else {
                injectValues += `const ${importMetaResolveVarName} = (specifier, importer = ${importMetaUrlVarName}) => { throw new Error('import.meta.resolve is not supported in CJS config files') };`
              }
            }

            let injectedContents: string
            if (code.startsWith('#!')) {
              // 注入变量必须放在 hashbang 后，否则 Node 不再把首行识别为解释器声明。
              // getFileStartIndex 同时覆盖 CRLF 和少见行终止符（#21158、#23038）。
              const fileStartIndex = getFileStartIndex(code)
              const hashbang = code.slice(0, fileStartIndex)
              injectedContents =
                hashbang +
                (lineTerminatorRE.test(hashbang) ? '' : '\n') +
                injectValues +
                code.slice(fileStartIndex)
            } else {
              injectedContents = injectValues + code
            }

            return {
              code: injectedContents,
              map: null,
            }
          },
        },
      },
    ],
  })
  const result = await bundle.generate({
    format: isESM ? 'esm' : 'cjs',
    sourcemap: 'inline',
    /** 把内联 Source Map 中的相对来源恢复为配置文件附近的绝对路径。 */
    sourcemapPathTransform(relative) {
      return path.resolve(fileName, relative)
    },
    // 与旧 esbuild `splitting: false` 行为一致，生成一个可直接执行的入口 chunk。
    codeSplitting: false,
  })
  await bundle.close()

  const entryChunk = result.output.find(
    (chunk): chunk is OutputChunk => chunk.type === 'chunk' && chunk.isEntry,
  )!
  const bundleChunks = Object.fromEntries(
    result.output.flatMap((c) => (c.type === 'chunk' ? [[c.fileName, c]] : [])),
  )

  const allModules = new Set<string>()
  collectAllModules(bundleChunks, entryChunk.fileName, allModules)

  return {
    code: entryChunk.code,
    // `\0rolldown/runtime.js` 是打包器虚拟模块，不是应被文件监听器观察的真实依赖。
    dependencies: [...allModules].filter((m) => !m.startsWith('\0')),
    nativeIncompatibilities,
  }
}

/**
 * 从入口 chunk 递归收集静态和动态子 chunk 的真实 moduleIds。
 * analyzedModules 防止共享 chunk 或循环引用导致重复遍历；external 模块没有 chunk，直接
 * 停止递归，因为它们由运行时自行加载。
 */
function collectAllModules(
  bundle: Record<string, OutputChunk>,
  fileName: string,
  allModules: Set<string>,
  analyzedModules = new Set<string>(),
) {
  if (analyzedModules.has(fileName)) return
  analyzedModules.add(fileName)

  const chunk = bundle[fileName]
  if (!chunk) return // 外部模块不会出现在 bundle chunk 表中。

  for (const mod of chunk.moduleIds) {
    allModules.add(mod)
  }
  for (const i of chunk.imports) {
    collectAllModules(bundle, i, allModules, analyzedModules)
  }
  for (const i of chunk.dynamicImports) {
    collectAllModules(bundle, i, allModules, analyzedModules)
  }
}

/** Node 内部 CJS Module 的最小 `_compile` 能力声明。 */
interface NodeModuleWithCompile extends NodeModule {
  /** 以指定文件名在当前 CommonJS Module 上编译并执行代码。 */
  _compile(code: string, filename: string): any
}

/** 以 Vite 当前模块为基准创建的 CJS require，用于执行打包后的 CJS 配置。 */
const _require = createRequire(/** #__KEEP__ */ import.meta.url)

/**
 * 执行 bundleConfigFile 生成的单 chunk，并取出配置默认导出。
 *
 * ESM 无法临时注册按文件生效的 loader，所以把代码写成唯一 `.mjs` 后原生 import，再在
 * finally 中删除；CJS 则短暂替换目标扩展名的 `require.extensions` loader，把目标文件
 * 编译为打包代码。两条路径都必须绕过模块缓存，确保服务器重启读取到新配置。
 */
async function loadConfigFromBundledFile(
  fileName: string,
  bundledCode: string,
  isESM: boolean,
): Promise<UserConfigExport> {
  // ESM loader 不能在进程内按单文件临时注册，只能写临时文件后交给原生 import。
  if (isESM) {
    // Deno 在 node_modules 下强制采用 Node 模块语义，可能令配置中的 `npm:` import 失败；
    // 因此 Deno 把临时文件放在配置旁，Node 才优先使用 node_modules/.vite-temp。
    const nodeModulesDir =
      typeof process.versions.deno === 'string'
        ? undefined
        : findNearestNodeModules(path.dirname(fileName))

    let viteTempDir = nodeModulesDir
      ? path.resolve(nodeModulesDir, '.vite-temp')
      : undefined
    if (viteTempDir) {
      try {
        await fsp.mkdir(viteTempDir, {
          recursive: true,
        })
      } catch (e) {
        if (e.code === 'EACCES') {
          // node_modules 不可写时退回配置文件旁，不让权限问题阻断配置加载。
          viteTempDir = undefined
        } else {
          throw e
        }
      }
    }
    const hash = `timestamp-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const tempFileName = viteTempDir
      ? path.resolve(viteTempDir, `${path.basename(fileName)}.${hash}.mjs`)
      : `${fileName}.${hash}.mjs`

    // 告知 Vite Task 忽略临时目录/文件，避免本次读写反过来改变构建缓存指纹。
    const pathToIgnore = viteTempDir ?? tempFileName
    ignoreInput(pathToIgnore)
    ignoreOutput(pathToIgnore)
    await fsp.writeFile(tempFileName, bundledCode)
    try {
      return (await import(pathToFileURL(tempFileName).href)).default
    } finally {
      fs.unlink(tempFileName, () => {}) // 清理失败不应覆盖真正的配置执行结果。
    }
  }
  // CJS 可以通过 `_require.extensions` 为目标文件临时安装自定义 loader。
  else {
    const extension = path.extname(fileName)
    // 不使用 fsp.realpath()：它与 fs.realpath.native 一样，可能在 Windows 返回大写盘符，
    // 而 Node loader 使用小写盘符，导致目标路径比较失败：
    // https://github.com/vitejs/vite/issues/12923
    const realFileName = await promisifiedRealpath(fileName)
    const loaderExt = extension in _require.extensions ? extension : '.js'
    const defaultLoader = _require.extensions[loaderExt]!
    /** 仅为真实配置路径编译打包代码，其他同扩展名文件仍交给原 loader；成功 require 后恢复原 loader。 */
    _require.extensions[loaderExt] = (module: NodeModule, filename: string) => {
      if (filename === realFileName) {
        ;(module as NodeModuleWithCompile)._compile(bundledCode, filename)
      } else {
        defaultLoader(module, filename)
      }
    }
    // 服务器因配置变化重启时必须清缓存，否则 require 会继续返回旧导出。
    delete _require.cache[_require.resolve(fileName)]
    const raw = _require(fileName)
    _require.extensions[loaderExt] = defaultLoader
    return raw.__esModule ? raw.default : raw
  }
}

/**
 * 按钩子 order 串行运行插件 `config` 钩子，并把每次返回值立刻合入当前配置。
 * 串行与“立即合并”保证后一个插件能读取前一个插件的结果；返回原对象表示插件已就地修改，
 * 无需再次合并。这里也集中报告插件仍写入 Rollup/esbuild 旧字段的迁移告警。
 */
async function runConfigHook(
  config: InlineConfig,
  plugins: Plugin[],
  configEnv: ConfigEnv,
): Promise<InlineConfig> {
  let conf = config

  const tempLogger = createLogger(config.logLevel, {
    allowClearScreen: config.clearScreen,
    customLogger: config.customLogger,
  })
  const context = new BasicMinimalPluginContext<
    Omit<PluginContextMeta, 'watchMode'>
  >(basePluginContextMeta, tempLogger)

  for (const p of getSortedPluginsByHook('config', plugins)) {
    const hook = p.config
    const handler = getHookHandler(hook)
    const res = await handler.call(context, conf, configEnv)
    if (res && res !== conf) {
      if (hasBothRollupOptionsAndRolldownOptions(res)) {
        context.warn(
          `Both \`rollupOptions\` and \`rolldownOptions\` were specified by ${JSON.stringify(p.name)} plugin. ` +
            `\`rollupOptions\` specified by that plugin will be ignored.`,
        )
      }
      if (res.esbuild) {
        context.warn(
          `\`esbuild\` option was specified by ${JSON.stringify(p.name)} plugin. ` +
            `This option is deprecated, please use \`oxc\` instead.`,
        )
      }
      if (res.optimizeDeps?.esbuildOptions) {
        context.warn(
          `\`optimizeDeps.esbuildOptions\` option was specified by ${JSON.stringify(p.name)} plugin. ` +
            `This option is deprecated, please use \`optimizeDeps.rolldownOptions\` instead.`,
        )
      }
      conf = mergeConfig(conf, res)
    }
  }

  return conf
}

/**
 * 对解析开始时已经存在的每个 Environment 串行运行插件 `configEnvironment` 钩子。
 * 每个钩子的返回值立即合入当前环境，后一插件能读取它。非 client 环境的顶层继承值
 * 已在调用前分别深克隆；这里继续使用对应环境对象，保留钩子的原地修改。
 */
async function runConfigEnvironmentHook(
  environments: Record<string, EnvironmentOptions>,
  plugins: Plugin[],
  logger: Logger,
  configEnv: ConfigEnv,
  isSsrTargetWebworkerSet: boolean,
): Promise<void> {
  const context = new BasicMinimalPluginContext<
    Omit<PluginContextMeta, 'watchMode'>
  >(basePluginContextMeta, logger)

  const environmentNames = Object.keys(environments)
  for (const p of getSortedPluginsByHook('configEnvironment', plugins)) {
    const hook = p.configEnvironment
    const handler = getHookHandler(hook)
    for (const name of environmentNames) {
      const res = await handler.call(context, name, environments[name], {
        ...configEnv,
        isSsrTargetWebworker: isSsrTargetWebworkerSet && name === 'ssr',
      })
      if (res) {
        environments[name] = mergeConfig(environments[name], res)
      }
    }
  }
}

/**
 * 把 Vite 5.1 已删除的 `optimizeDeps.disabled` 转成最接近的新配置并输出迁移告警。
 * `true/'dev'` 可近似为关闭发现与 include；`false/'build'` 已没有等价作用，只提示删除。
 */
function optimizeDepsDisabledBackwardCompatibility(
  resolved: ResolvedConfig,
  optimizeDeps: DepOptimizationOptions,
  optimizeDepsPath: string = '',
) {
  const optimizeDepsDisabled = optimizeDeps.disabled
  if (optimizeDepsDisabled !== undefined) {
    if (optimizeDepsDisabled === true || optimizeDepsDisabled === 'dev') {
      const commonjsOptionsInclude = resolved.build.commonjsOptions.include
      const commonjsPluginDisabled =
        Array.isArray(commonjsOptionsInclude) &&
        commonjsOptionsInclude.length === 0
      optimizeDeps.noDiscovery = true
      optimizeDeps.include = undefined
      if (commonjsPluginDisabled) {
        resolved.build.commonjsOptions.include = undefined
      }
      resolved.logger.warn(
        colors.yellow(`(!) Experimental ${optimizeDepsPath}optimizeDeps.disabled and deps pre-bundling during build were removed in Vite 5.1.
    To disable the deps optimizer, set ${optimizeDepsPath}optimizeDeps.noDiscovery to true and ${optimizeDepsPath}optimizeDeps.include as undefined or empty.
    Please remove ${optimizeDepsPath}optimizeDeps.disabled from your config.
    ${
      commonjsPluginDisabled
        ? 'Empty config.build.commonjsOptions.include will be ignored to support CJS during build. This config should also be removed.'
        : ''
    }
  `),
      )
    } else if (
      optimizeDepsDisabled === false ||
      optimizeDepsDisabled === 'build'
    ) {
      resolved.logger.warn(
        colors.yellow(`(!) Experimental ${optimizeDepsPath}optimizeDeps.disabled and deps pre-bundling during build were removed in Vite 5.1.
    Setting it to ${optimizeDepsDisabled} now has no effect.
    Please remove ${optimizeDepsPath}optimizeDeps.disabled from your config.
  `),
      )
    }
  }
}
