import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import type * as net from 'node:net'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import type * as http from 'node:http'
import { performance } from 'node:perf_hooks'
import type { Http2SecureServer } from 'node:http2'
import connect from 'connect'
import corsMiddleware from 'cors'
import colors from 'picocolors'
import chokidar from 'chokidar'
import launchEditorMiddleware from 'launch-editor-middleware'
import { determineAgent } from '@vercel/detect-agent'
import { disableCache } from '@voidzero-dev/vite-task-client'
import type { SourceMap } from 'rolldown'
import type { ModuleRunner } from 'vite/module-runner'
import type { FSWatcher, WatchOptions } from '#dep-types/chokidar'
import type { Connect } from '#dep-types/connect'
import type { CommonServerOptions } from '../http'
import type {
  ForwardConsoleOptions,
  ResolvedForwardConsoleOptions,
} from '../../shared/forwardConsole'
import {
  httpServerStart,
  resolveHttpServer,
  resolveHttpsConfig,
  setClientErrorHandler,
} from '../http'
import type { InlineConfig, ResolvedConfig } from '../config'
import { isResolvedConfig, resolveConfig } from '../config'
import {
  type Hostname,
  diffDnsOrderChange,
  getServerUrlByHost,
  isInNodeModules,
  isObject,
  isParentDirectory,
  mergeConfig,
  mergeWithDefaults,
  monotonicDateNow,
  normalizePath,
  resolveHostname,
  resolveServerUrls,
  setupHmrWsOptionCompat,
  setupSIGTERMListener,
  teardownSIGTERMListener,
} from '../utils'
import { ssrLoadModule } from '../ssr/ssrModuleLoader'
import { ssrFixStacktrace, ssrRewriteStacktrace } from '../ssr/ssrStacktrace'
import { ssrTransform } from '../ssr/ssrTransform'
import { reloadOnTsconfigChange } from '../plugins/esbuild'
import { bindCLIShortcuts } from '../shortcuts'
import type { BindCLIShortcutsOptions, ShortcutsState } from '../shortcuts'
import {
  CLIENT_DIR,
  DEFAULT_DEV_PORT,
  defaultAllowedOrigins,
} from '../constants'
import type { Logger } from '../logger'
import { printServerUrls } from '../logger'
import { warnFutureDeprecation } from '../deprecations'
import {
  createNoopWatcher,
  getResolvedOutDirs,
  resolveChokidarOptions,
  resolveEmptyOutDir,
} from '../watch'
import { initPublicFiles } from '../publicDir'
import { getEnvFilesForMode } from '../env'
import type { RequiredExceptFor } from '../typeUtils'
import type { MinimalPluginContextWithoutEnvironment } from '../plugin'
import type { PluginContainer } from './pluginContainer'
import {
  BasicMinimalPluginContext,
  basePluginContextMeta,
  createPluginContainer,
} from './pluginContainer'
import type { WebSocketServer } from './ws'
import { createWebSocketServer } from './ws'
import { baseMiddleware } from './middlewares/base'
import { proxyMiddleware } from './middlewares/proxy'
import { htmlFallbackMiddleware } from './middlewares/htmlFallback'
import {
  cachedTransformMiddleware,
  transformMiddleware,
} from './middlewares/transform'
import {
  createDevHtmlTransformFn,
  indexHtmlMiddleware,
} from './middlewares/indexHtml'
import {
  servePublicMiddleware,
  serveRawFsMiddleware,
  serveStaticMiddleware,
} from './middlewares/static'
import { timeMiddleware } from './middlewares/time'
import { ModuleGraph } from './mixedModuleGraph'
import type { ModuleNode } from './mixedModuleGraph'
import { notFoundMiddleware } from './middlewares/notFound'
import { errorMiddleware } from './middlewares/error'
import type { HmrOptions, NormalizedHotChannel, WsOptions } from './hmr'
import { handleHMRUpdate, updateModules } from './hmr'
import { openBrowser as _openBrowser } from './openBrowser'
import type { TransformOptions, TransformResult } from './transformRequest'
import { searchForPackageRoot, searchForWorkspaceRoot } from './searchRoot'
import type { DevEnvironment } from './environment'
import { hostValidationMiddleware } from './middlewares/hostCheck'
import { rejectInvalidRequestMiddleware } from './middlewares/rejectInvalidRequest'
import { memoryFilesMiddleware } from './middlewares/memoryFiles'
import { triggerLazyBundlingMiddleware } from './middlewares/triggerLazyBundling'

/** 已用于创建 Server 的 ResolvedConfig；防止同一可变配置对象被多个服务器共享污染。 */
const usedConfigs = new WeakSet<ResolvedConfig>()

/** 开发服务器专属配置。 */
export interface ServerOptions extends CommonServerOptions {
  /** HMR 行为与旧 WebSocket 连接选项；设为 false 关闭 HMR。 */
  hmr?: HmrOptions | boolean
  /**
   * WebSocket 连接选项；设为 false 关闭 WebSocket Server 与客户端连接。
   */
  ws?: WsOptions | false
  /**
   * 启动时提前转换并缓存文件，缩短首次页面加载并减少 transform 瀑布。
   * @deprecated 请改用 `environments[name].dev.warmup`。
   */
  warmup?: {
    /** client 端预热文件，支持 glob。 */
    clientFiles?: string[]
    /** SSR 端预热文件，支持 glob。 */
    ssrFiles?: string[]
  }
  /**
   * Chokidar 监听选项；设为 null 完全关闭文件系统监听。
   * @see https://github.com/paulmillr/chokidar/tree/3.6.0#api
   */
  watch?: WatchOptions | null
  /**
   * 把 Vite 作为已有服务器的 Connect 中间件，不自行监听端口。
   * @default false
   */
  middlewareMode?:
    | boolean
    | {
        /**
         * 要挂载到的父 HTTP Server；HMR WebSocket 需要通过它代理连接。
         */
        server: HttpServer
      }
  /** `/@fs/` 文件访问白名单/黑名单配置。 */
  fs?: FileSystemServeOptions
  /**
   * 生成资源 URL 时使用的 origin。
   *
   * @example `http://127.0.0.1:8080`
   */
  origin?: string
  /** 提前转换已知直接 import。 @default true */
  preTransformRequests?: boolean
  /**
   * 决定开发 Source Map 的哪些源码进入 `x_google_ignoreList`，使浏览器调试器默认跳过。
   *
   * 默认忽略包含 node_modules 的路径；false 完全关闭，函数可按 sourcePath/mapPath 决定。
   * @see https://developer.chrome.com/blog/devtools-better-angular-debugging/#the-x_google_ignorelist-source-map-extension
   */
  sourcemapIgnoreList?:
    | false
    | ((sourcePath: string, sourcemapPath: string) => boolean)
  /**
   * 为每个 Environment 运行 buildStart/buildEnd。兼容默认只在 client 调用一次。
   * @default false
   * @experimental
   */
  perEnvironmentStartEndDuringDev?: boolean
  /**
   * 为每个 Environment 运行 watchChange。兼容默认只在 client 调用一次。
   * @default false
   * @experimental
   */
  perEnvironmentWatchChangeDuringDev?: boolean
  /**
   * 自定义多 Environment HMR 任务调度；默认并行传播所有环境。
   * @experimental
   */
  hotUpdateEnvironments?: (
    server: ViteDevServer,
    hmr: (environment: DevEnvironment) => Promise<void>,
  ) => Promise<void>

  /** 把浏览器 console/未处理错误转发到开发服务器终端。 */
  forwardConsole?: boolean | ForwardConsoleOptions
}

/** 已补齐默认值的开发服务器配置。 */
export interface ResolvedServerOptions extends Omit<
  RequiredExceptFor<
    ServerOptions,
    | 'host'
    | 'https'
    | 'proxy'
    | 'hmr'
    | 'ws'
    | 'watch'
    | 'origin'
    | 'hotUpdateEnvironments'
  >,
  'fs' | 'middlewareMode' | 'sourcemapIgnoreList' | 'forwardConsole'
> {
  /** 文件系统访问配置，所有可选字段均已解析为确定值。 */
  fs: Required<FileSystemServeOptions>
  /** 是否作为中间件运行，以及可选的父 HTTP Server。 */
  middlewareMode: NonNullable<ServerOptions['middlewareMode']>
  /** 已归一化为可直接调用的 sourcemap 忽略判定函数。 */
  sourcemapIgnoreList: Exclude<
    ServerOptions['sourcemapIgnoreList'],
    false | undefined
  >
  /** 浏览器 console 转发的最终开关、错误类型与日志级别。 */
  forwardConsole: ResolvedForwardConsoleOptions
}

/** 开发服务器直接读取磁盘文件时的安全边界。 */
export interface FileSystemServeOptions {
  /**
   * 严格拒绝访问 allow 外路径；false 关闭本层文件访问限制。
   *
   * @default true
   */
  strict?: boolean

  /**
   * 允许访问的目录。接受绝对路径或相对 root 路径；缺省自动向上搜索 workspace root。
   */
  allow?: string[]

  /**
   * 即使位于 allow 内也禁止访问的 picomatch 模式；deny 优先于 allow。
   *
   * @default ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**\/.git/**']
   */
  deny?: string[]
}

/** configureServer 钩子；返回函数在内部中间件注册后作为 post hook 调用。 */
export type ServerHook = (
  this: MinimalPluginContextWithoutEnvironment,
  server: ViteDevServer,
) => (() => void) | void | Promise<(() => void) | void>

/** Vite 支持的 Node HTTP/HTTPS/HTTP2 Server 类型。 */
export type HttpServer = http.Server | Http2SecureServer

/**
 * 规范化浏览器 console 转发配置。
 * 缺省时仅在 Agent 环境自动开启；true 转发 warn/error 和未处理错误，详细对象按字段推导
 * enabled，false 返回稳定的全关闭结构。
 */
export async function resolveForwardConsoleOptions(
  value: boolean | ForwardConsoleOptions | undefined,
): Promise<ResolvedForwardConsoleOptions> {
  value ??= (await determineAgent()).isAgent

  if (value === false) {
    return {
      enabled: false,
      unhandledErrors: false,
      logLevels: [],
    }
  }

  if (value === true) {
    return {
      enabled: true,
      unhandledErrors: true,
      logLevels: ['error', 'warn'],
    }
  }

  const unhandledErrors = value.unhandledErrors ?? true
  const logLevels = value.logLevels ?? []

  return {
    enabled: unhandledErrors || logLevels.length > 0,
    unhandledErrors,
    logLevels,
  }
}

/** 开发服务器实例及其公开 Node API。 */
export interface ViteDevServer {
  /** 创建本服务器的最终 ResolvedConfig。 */
  config: ResolvedConfig
  /**
   * Connect 应用：可注册自定义中间件，也可作为已有 HTTP/Connect 框架的 handler。
   *
   * @see https://github.com/senchalabs/connect#use-middleware
   */
  middlewares: Connect.Server
  /** 原生 Node HTTP Server；middleware mode 下为 null。 */
  httpServer: HttpServer | null
  /**
   * Chokidar watcher。server.watch=null 时为 no-op 实现，add/unwatch 不产生作用。
   */
  watcher: FSWatcher
  /** HMR WebSocket Server，提供 `send(payload)`。 */
  ws: WebSocketServer
  /**
   * `environments.client.hot` 的兼容别名；多环境操作应遍历 environments。
   */
  hot: NormalizedHotChannel
  /** 旧多环境 PluginContainer 兼容门面。 */
  pluginContainer: PluginContainer
  /** 附加到本服务器的 client、ssr 与自定义模块执行 Environment。 */
  environments: Record<'client' | 'ssr' | (string & {}), DevEnvironment>
  /** 合并 client/ssr 的旧 ModuleGraph 兼容视图。 */
  moduleGraph: ModuleGraph
  /**
   * CLI 打印的 URL 编码后地址；middleware mode 或尚未监听端口时为 null。
   */
  resolvedUrls: ResolvedServerUrls | null
  /**
   * 不经过 HTTP 中间件，直接解析、加载并转换 URL。
   */
  transformRequest(
    url: string,
    options?: TransformOptions,
  ): Promise<TransformResult | null>
  /**
   * 只预热 transform 缓存；内部处理并报告错误，Promise 不会因转换失败而 reject。
   */
  warmupRequest(url: string, options?: TransformOptions): Promise<void>
  /** 应用 Vite 内置与用户插件 HTML 转换。 */
  transformIndexHtml(
    url: string,
    html: string,
    originalUrl?: string,
  ): Promise<string>
  /** 把模块代码转换成 SSR 可执行格式。 */
  ssrTransform(
    code: string,
    inMap:
      | SourceMap
      | {
          /** 空字符串表示上游明确关闭 sourcemap 生成。 */
          mappings: ''
        }
      | null,
    url: string,
    originalCode?: string,
  ): Promise<TransformResult | null>
  /** 加载并实例化一个 SSR 模块。 */
  ssrLoadModule(
    url: string,
    opts?: {
      /** 加载失败时是否在抛出前按模块 Source Map 修正堆栈。 */
      fixStacktrace?: boolean
    },
  ): Promise<Record<string, any>>
  /** 返回经 Source Map 修正的 SSR stack 字符串。 */
  ssrRewriteStacktrace(stack: string): string
  /** 原地修正 SSR Error 的 stacktrace。 */
  ssrFixStacktrace(e: Error): void
  /**
   * 对 ModuleGraph 节点触发 HMR；hmr=false 时为空操作。
   */
  reloadModule(module: ModuleNode): Promise<void>
  /** 初始化必要组件并开始监听端口。 */
  listen(port?: number, isRestart?: boolean): Promise<ViteDevServer>
  /** 幂等停止服务器、watcher、WS、Environment 与后台任务。 */
  close(): Promise<void>
  /** 打印本地/网络访问 URL。 */
  printUrls(): void
  /** 绑定终端快捷键，并保存状态供重启复用。 */
  bindCLIShortcuts(options?: BindCLIShortcutsOptions<ViteDevServer>): void
  /**
   * 原位重启服务器，同时保留用户持有的 ViteDevServer/Connect 引用。
   *
   * @param forceOptimize - 强制依赖优化器重新预构建，等价于 CLI `--force`。
   */
  restart(forceOptimize?: boolean): Promise<void>
  /** 用最终 resolved URL 打开浏览器。 */
  openBrowser(): void
  /**
   * 等待首批静态 import 全部处理。若在 load/transform 钩子中调用，必须传当前 id 将其从
   * 等待集合排除，否则会等待自己形成死锁；首批爬取结束后再调用会立即完成。
   */
  waitForRequestsIdle: (ignoredId?: string) => Promise<void>
  /** 重启后把闭包内实际 Server 重新绑定到用户持有的实例。 @internal */
  _setInternalServer(server: ViteDevServer): void
  /** 当前串行重启 Promise。 @internal */
  _restartPromise: Promise<void> | null
  /** 重启时是否强制预构建。 @internal */
  _forceOptimizeOnRestart: boolean
  /** CLI 快捷键复用状态。 @internal */
  _shortcutsState?: ShortcutsState<ViteDevServer>
  /** 当前真实监听端口。 @internal */
  _currentServerPort?: number | undefined
  /** 上次解析配置得到的端口，用于判断重启时是否显式改端口。 @internal */
  _configServerPort?: number | undefined
  /** 旧 SSR API 共享的 ModuleRunner。 @internal */
  _ssrCompatModuleRunner?: ModuleRunner
}

/** Server 监听后解析出的本地与局域网 URL。 */
export interface ResolvedServerUrls {
  /** 回环地址及 localhost 的本地访问 URL。 */
  local: string[]
  /** 可从局域网接口访问的 URL。 */
  network: string[]
  /**
   * 与 network 同序的网卡名称；显式 host 等无法确定网卡时对应项为 undefined。
   */
  networkInterfaceNames?: (string | undefined)[]
}

/**
 * 创建标准 Vite Dev Server。
 * 这里只完成配置、组件与中间件初始化；调用方仍需 `await server.listen()` 开始监听。
 */
export function createServer(
  inlineConfig: InlineConfig | ResolvedConfig = {},
): Promise<ViteDevServer> {
  return _createServer(inlineConfig, { listen: true })
}

/**
 * Dev Server 的内部构造器，也供原位重启复用。
 *
 * 主阶段：解析配置 → 建立 HTTP/WS/watcher → 并行创建 Environment → 组装兼容 API →
 * 注册 watcher/SIGTERM → 排列中间件 → 建立一次性初始化门闩。previous* 字段把旧
 * Environment、快捷键和并发重启状态传给新实例，使重启能够迁移资源而不替换用户引用。
 *
 * @param options.listen - middleware mode 初始化时是否同时启动 Environment listen；公开创建为
 * true，重启构造为 false。普通模式在底层 HTTP listen 前始终启动 Environment。
 */
export async function _createServer(
  inlineConfig: ResolvedConfig | InlineConfig | undefined = {},
  options: {
    /** middleware mode 初始化时是否立即启动 Environment listen；重启构造为 false。 */
    listen: boolean
    /** 重启前的 Environment，用于迁移可复用状态。 */
    previousEnvironments?: Record<string, DevEnvironment>
    /** 重启前保存的 CLI 快捷键绑定状态。 */
    previousShortcutsState?: ShortcutsState<ViteDevServer>
    /** 已在进行的重启 Promise，避免新实例启动第二次并发重启。 */
    previousRestartPromise?: Promise<void> | null
    /** 上一次重启是否请求强制依赖优化。 */
    previousForceOptimizeOnRestart?: boolean
  },
): Promise<ViteDevServer> {
  // Dev Server 是长运行交互进程，网络响应/HMR 更新无法从任务缓存安全重放。
  disableCache()

  const config = isResolvedConfig(inlineConfig)
    ? inlineConfig
    : await resolveConfig(inlineConfig, 'serve')

  if (usedConfigs.has(config)) {
    throw new Error(`There is already a server associated with the config.`)
  }

  if (config.command !== 'serve') {
    throw new Error(
      `Config was resolved for a "build", expected a "serve" command.`,
    )
  }

  usedConfigs.add(config)

  // public 文件扫描可与 HTTPS、watch 配置解析并行，稍后在创建 watcher 前等待。
  const initPublicFilesPromise = initPublicFiles(config)

  const { root, server: serverConfig } = config
  const httpsOptions = await resolveHttpsConfig(config.server.https)
  const { middlewareMode } = serverConfig

  const resolvedOutDirs = getResolvedOutDirs(
    config.root,
    config.build.outDir,
    config.build.rolldownOptions.output,
  )
  const emptyOutDir = resolveEmptyOutDir(
    config.build.emptyOutDir,
    config.root,
    resolvedOutDirs,
  )
  const resolvedWatchOptions = resolveChokidarOptions(
    {
      disableGlobbing: true,
      ...serverConfig.watch,
    },
    resolvedOutDirs,
    emptyOutDir,
    config.cacheDir,
  )

  const middlewares = connect() as Connect.Server
  const httpServer = middlewareMode
    ? null
    : await resolveHttpServer(middlewares, httpsOptions)

  const ws = createWebSocketServer(httpServer, config, httpsOptions)

  const publicFiles = await initPublicFilesPromise
  const { publicDir } = config

  if (httpServer) {
    setClientErrorHandler(httpServer, config.logger)
  }

  // 只有严格的 null 表示关闭 watcher；undefined 使用默认监听。
  // eslint-disable-next-line eqeqeq
  const watchEnabled = serverConfig.watch !== null
  const watcher = watchEnabled
    ? (chokidar.watch(
        // 配置依赖和 env 文件可能位于 root 外，必须逐项显式加入。
        [
          ...(config.experimental.bundledDev ? [] : [root]),
          ...config.configFileDependencies,
          ...getEnvFilesForMode(config.mode, config.envDir),
          // publicDir 也可能位于 root 外，单独监听。
          ...(publicDir && publicFiles ? [publicDir] : []),
        ],

        resolvedWatchOptions,
      ) as FSWatcher)
    : createNoopWatcher(resolvedWatchOptions)

  const environments: Record<string, DevEnvironment> = {}

  // 各 Environment 无初始化顺序依赖，可并行创建；重启时由新实例迁移旧状态。
  await Promise.all(
    Object.entries(config.environments).map(
      async ([name, environmentOptions]) => {
        const environment = await environmentOptions.dev.createEnvironment(
          name,
          config,
          {
            ws,
          },
        )
        environments[name] = environment

        const previousInstance =
          options.previousEnvironments?.[environment.name]
        await environment.init({ watcher, previousInstance })
      },
    ),
  )

  // 为旧 server.moduleGraph/pluginContainer API 建立 client+ssr 兼容门面。

  let moduleGraph = new ModuleGraph({
    /** 读取当前 client 环境的模块图，供兼容图惰性访问。 */
    client: () => environments.client.moduleGraph,
    /** 读取当前 ssr 环境的模块图，供兼容图惰性访问。 */
    ssr: () => environments.ssr.moduleGraph,
  })
  let pluginContainer = createPluginContainer(environments)

  const closeHttpServer = createServerCloseFn(httpServer)

  const devHtmlTransformFn = createDevHtmlTransformFn(config)

  // close Promise 作为幂等门闩，确保资源清理只启动一次（#19204）。
  let closeServerPromise: Promise<void> | undefined
  /** 发起各资源关闭，等待已发起的异步任务 settle；单项 Promise 拒绝不会跳过最终字段复位。 */
  const closeServer = async () => {
    if (!middlewareMode) {
      teardownSIGTERMListener(closeServerAndExit)
    }

    await Promise.allSettled([
      watcher.close(),
      ws.close(),
      Promise.allSettled(
        Object.values(server.environments).map((environment) =>
          environment.close(),
        ),
      ),
      closeHttpServer(),
      server._ssrCompatModuleRunner?.close(),
    ])
    server.resolvedUrls = null
    server._ssrCompatModuleRunner = undefined
  }

  // hot 可被兼容插件替换，所以使用闭包字段而不是只读 getter。
  let hot = ws
  let server: ViteDevServer = {
    config,
    middlewares,
    httpServer,
    watcher,
    ws,
    /** 读取可替换的旧 hot API，并在访问时发出迁移提示。 */
    get hot() {
      warnFutureDeprecation(config, 'removeServerHot')
      return hot
    },
    /** 允许兼容层替换旧 hot channel 实现。 */
    set hot(h) {
      hot = h
    },

    environments,
    /** 返回跨 Environment 的旧 PluginContainer 兼容门面。 */
    get pluginContainer() {
      warnFutureDeprecation(config, 'removeServerPluginContainer')
      return pluginContainer
    },
    /** 允许兼容插件替换旧 PluginContainer 门面。 */
    set pluginContainer(p) {
      pluginContainer = p
    },
    /** 返回合并 client/ssr 的旧 ModuleGraph 兼容视图。 */
    get moduleGraph() {
      warnFutureDeprecation(config, 'removeServerModuleGraph')
      return moduleGraph
    },
    /** 允许兼容插件替换旧 ModuleGraph 视图。 */
    set moduleGraph(graph) {
      moduleGraph = graph
    },

    // listen 事件发生前没有可靠端口/地址。
    resolvedUrls: null,
    /** 按 runner 协议转换 SSR 代码，并应用当前 JSON 配置。 */
    ssrTransform(
      code: string,
      inMap:
        | SourceMap
        | {
            /** 透传调用方显式关闭 sourcemap 的哨兵值。 */
            mappings: ''
          }
        | null,
      url: string,
      originalCode = code,
    ) {
      return ssrTransform(code, inMap, url, originalCode, {
        json: {
          stringify:
            config.json.stringify === true && config.json.namedExports !== true,
        },
      })
    },
    /** 将旧 transformRequest API 路由到 client 或 ssr Environment。 */
    transformRequest(url, options) {
      warnFutureDeprecation(config, 'removeServerTransformRequest')
      const environment = server.environments[options?.ssr ? 'ssr' : 'client']
      return environment.transformRequest(url)
    },
    /** 将旧预热 API 路由到目标 Environment，并吞掉由其负责记录的失败。 */
    warmupRequest(url, options) {
      warnFutureDeprecation(config, 'removeServerWarmupRequest')
      const environment = server.environments[options?.ssr ? 'ssr' : 'client']
      return environment.warmupRequest(url)
    },
    /** 运行开发 HTML 转换管线。 */
    transformIndexHtml(url, html, originalUrl) {
      return devHtmlTransformFn(server, url, html, originalUrl)
    },
    /** 通过兼容 ModuleRunner 加载 SSR 模块。 */
    async ssrLoadModule(
      url,
      opts?: {
        /** 加载异常抛出前是否修正堆栈。 */
        fixStacktrace?: boolean
      },
    ) {
      warnFutureDeprecation(config, 'removeSsrLoadModule')
      return ssrLoadModule(url, server, opts?.fixStacktrace)
    },
    /** 原地修正旧 SSR API 抛出错误的堆栈。 */
    ssrFixStacktrace(e) {
      warnFutureDeprecation(
        config,
        'removeSsrLoadModule',
        "ssrFixStacktrace doesn't need to be used for Environment Module Runners.",
      )
      ssrFixStacktrace(e, server.environments.ssr.moduleGraph)
    },
    /** 返回经 SSR 模块图 Source Map 重写后的堆栈文本。 */
    ssrRewriteStacktrace(stack: string) {
      warnFutureDeprecation(
        config,
        'removeSsrLoadModule',
        "ssrRewriteStacktrace doesn't need to be used for Environment Module Runners.",
      )
      return ssrRewriteStacktrace(stack, server.environments.ssr.moduleGraph)
        .result
    },
    /** 将旧 ModuleNode 映射到所属 Environment 并触发 HMR 更新。 */
    async reloadModule(module) {
      warnFutureDeprecation(config, 'removeServerReloadModule')
      if (serverConfig.hmr !== false && module.file) {
        // TODO：是否还应同步旧 mixed moduleGraph？
        const environmentModule = (module._clientModule ?? module._ssrModule)!
        updateModules(
          environments[environmentModule.environment]!,
          module.file,
          [environmentModule],
          monotonicDateNow(),
        )
      }
    },
    /** 初始化开发服务、监听端口并在需要时打开浏览器。 */
    async listen(port?: number, isRestart?: boolean) {
      const hostname = await resolveHostname(config.server.host)
      if (httpServer) {
        // prepend 保证用户 listening listener 运行时 resolvedUrls 已可读取。
        httpServer.prependListener('listening', () => {
          server.resolvedUrls = resolveServerUrls(
            httpServer,
            config.server,
            hostname,
            httpsOptions,
            config,
          )
        })
      }
      await startServer(server, hostname, port)
      if (httpServer) {
        if (!isRestart && config.server.open) server.openBrowser()
      }
      return server
    },
    /** 根据最终 resolved URL 预取入口并调用平台浏览器启动器。 */
    openBrowser() {
      const options = server.config.server
      const url = getServerUrlByHost(server.resolvedUrls, options.host)
      if (url) {
        const path =
          typeof options.open === 'string'
            ? new URL(options.open, url).href
            : url

        // 打开浏览器前已知道入口 URL；并行发起 HTML 请求，可让静态 import 爬取先行。
        // 只有 preTransformRequests 启用时才发起这次预取。
        if (server.config.server.preTransformRequests) {
          setTimeout(() => {
            const getMethod = path.startsWith('https:') ? httpsGet : httpGet

            getMethod(
              path,
              {
                headers: {
                  // 允许 history fallback 把路径回退到 index.html。
                  Accept: 'text/html',
                },
              },
              (res) => {
                res.on('end', () => {
                  // 响应本身丢弃；处理 HTML 时发现的脚本已进入预转换。
                })
              },
            )
              .on('error', () => {
                // 这是纯优化请求，失败不能影响真正打开浏览器。
              })
              .end()
          }, 0)
        }

        _openBrowser(path, true, server.config.logger)
      } else {
        server.config.logger.warn('No URL available to open in browser')
      }
    },
    /** 幂等关闭 watcher、WebSocket、HTTP Server、Environment 与 runner。 */
    async close() {
      if (!closeServerPromise) {
        closeServerPromise = closeServer()
      }
      return closeServerPromise
    },
    /** 打印已经解析的访问地址；尚未监听时给出明确错误。 */
    printUrls() {
      if (server.resolvedUrls) {
        printServerUrls(
          server.resolvedUrls,
          serverConfig.host,
          config.logger.info,
        )
      } else if (middlewareMode) {
        throw new Error('Cannot print server URLs in middleware mode.')
      } else {
        throw new Error(
          'Cannot print server URLs before server.listen is called.',
        )
      }
    },
    /** 把终端快捷键绑定到当前稳定的 Server 引用。 */
    bindCLIShortcuts(options) {
      bindCLIShortcuts(server, options)
    },
    /** 串行执行原位重启；并发调用共享首次调用的任务和 forceOptimize 值。 */
    async restart(forceOptimize?: boolean) {
      // 并发重启共享 Promise，防止多个新 Server 争抢端口（#21636、#21810）。
      if (!server._restartPromise) {
        server._forceOptimizeOnRestart = !!forceOptimize
        server._restartPromise = restartServer(server).finally(() => {
          server._restartPromise = null
          server._forceOptimizeOnRestart = false
        })
      }
      return server._restartPromise
    },

    /** 等待 client Environment 的首轮静态依赖爬取结束。 */
    waitForRequestsIdle(ignoredId?: string): Promise<void> {
      return environments.client.waitForRequestsIdle(ignoredId)
    },

    /** 将稳定的外部对象重新指向重启后创建的内部 Server。 */
    _setInternalServer(_server: ViteDevServer) {
      // 重启后把闭包重新绑定到用户一直持有的 Server 实例。
      server = _server
    },
    _restartPromise: options.previousRestartPromise ?? null,
    _forceOptimizeOnRestart: options.previousForceOptimizeOnRestart ?? false,
    _shortcutsState: options.previousShortcutsState,
  }

  // 代理始终反射当前闭包 server，使 configureServer 钩子的对象在重启后也保持一致。
  const reflexServer = new Proxy(server, {
    /** 每次读取都转到闭包内当前 server，重启后继续看到新实现。 */
    get: (_, property: keyof ViteDevServer) => {
      return server[property]
    },
    /** 将 configureServer 的属性写入转发到当前 server。 */
    set: (_, property: keyof ViteDevServer, value: never) => {
      server[property] = value
      return true
    },
  })

  /** SIGTERM 时先完整关闭资源，再按信号约定设置退出码并退出进程。 */
  const closeServerAndExit = async (_: unknown, exitCode?: number) => {
    try {
      await server.close()
    } finally {
      process.exitCode ??= exitCode ? 128 + exitCode : undefined
      process.exit()
    }
  }

  if (!middlewareMode) {
    setupSIGTERMListener(closeServerAndExit)
  }

  /** 根据总 HMR 开关把 watcher 事件交给 HMR 主流程。 */
  const onHMRUpdate = async (
    type: 'create' | 'delete' | 'update',
    file: string,
  ) => {
    if (serverConfig.hmr !== false) {
      await handleHMRUpdate(type, file, server)
    }
  }

  /** 统一处理文件创建/删除：插件通知、public 索引、模块图失效与 HMR。 */
  const onFileAddUnlink = async (file: string, isUnlink: boolean) => {
    file = normalizePath(file)
    reloadOnTsconfigChange(server, file)

    await Promise.all(
      Object.values(server.environments).map((environment) =>
        environment.pluginContainer.watchChange(file, {
          event: isUnlink ? 'delete' : 'create',
        }),
      ),
    )

    if (publicDir && publicFiles) {
      if (file.startsWith(publicDir)) {
        const path = file.slice(publicDir.length)
        publicFiles[isUnlink ? 'delete' : 'add'](path)
        if (!isUnlink) {
          const clientModuleGraph = server.environments.client.moduleGraph
          const moduleWithSamePath =
            await clientModuleGraph.getModuleByUrl(path)
          const etag = moduleWithSamePath?.transformResult?.etag
          if (etag) {
            // 同路径 public 文件在下次请求应优先于已转换模块；删除旧 ETag 快路径，避免
            // 继续返回模块缓存。
            clientModuleGraph.etagToModuleMap.delete(etag)
          }
        }
      }
    }
    if (isUnlink) {
      // 删除文件时断开节点作为 importer 的反向边；节点及 URL/ID/file 索引仍保留。
      for (const environment of Object.values(server.environments)) {
        environment.moduleGraph.onFileDelete(file)
      }
    }
    await onHMRUpdate(isUnlink ? 'delete' : 'create', file)
  }

  /** 统一处理内容更新：插件通知、模块图失效与 HMR。 */
  const onFileChange = async (file: string) => {
    file = normalizePath(file)
    reloadOnTsconfigChange(server, file)

    await Promise.all(
      Object.values(server.environments).map((environment) =>
        environment.pluginContainer.watchChange(file, { event: 'update' }),
      ),
    )
    // 内容更新使每个 Environment 的 transform 结果失效。
    for (const environment of Object.values(server.environments)) {
      environment.moduleGraph.onFileChange(file)
    }
    await onHMRUpdate('update', file)
  }

  // watcher 不等待异步回调，必须显式 catch，避免 watchChange/HMR 拒绝成为未处理异常
  // （#22188）。
  watcher.on('change', (file) => {
    onFileChange(file).catch((e) => server.config.logger.error(e))
  })

  watcher.on('add', (file) => {
    onFileAddUnlink(file, false).catch((e) => server.config.logger.error(e))
  })
  watcher.on('unlink', (file) => {
    onFileAddUnlink(file, true).catch((e) => server.config.logger.error(e))
  })

  if (!middlewareMode && httpServer) {
    httpServer.once('listening', () => {
      // 非 strictPort/端口 0 时实际端口可能不同，监听后回写最终值。
      serverConfig.port = (httpServer.address() as net.AddressInfo).port
    })
  }

  // 前置内部中间件 -------------------------------------------------------------

  // 仅 DEBUG 时记录请求耗时。
  if (process.env.DEBUG) {
    middlewares.use(timeMiddleware(root))
  }

  middlewares.use(rejectInvalidRequestMiddleware())

  // CORS 必须在静态/转换响应前设置 header。
  const { cors } = serverConfig
  if (cors !== false) {
    middlewares.use(corsMiddleware(typeof cors === 'boolean' ? {} : cors))
  }

  // Host 校验防止 DNS rebinding 攻击。
  const { allowedHosts } = serverConfig
  // HTTPS 连接还要通过 TLS 证书验证，此处按 HTTPS 配置跳过 Host 校验。
  if (allowedHosts !== true && !serverConfig.https) {
    middlewares.use(hostValidationMiddleware(allowedHosts, false))
  }

  // 用户 configureServer 前置钩子 ---------------------------------------------

  const configureServerContext = new BasicMinimalPluginContext(
    { ...basePluginContextMeta, watchMode: true },
    config.logger,
  )
  const postHooks: ((() => void) | void)[] = []
  for (const hook of config.getSortedPluginHooks('configureServer')) {
    postHooks.push(await hook.call(configureServerContext, reflexServer))
  }

  // 内部中间件 -----------------------------------------------------------------

  if (!config.experimental.bundledDev) {
    middlewares.use(cachedTransformMiddleware(server))
  }

  // 代理应在 base/静态/transform 前截获匹配路径。
  const { proxy } = serverConfig
  if (proxy) {
    const middlewareServer =
      (isObject(middlewareMode) ? middlewareMode.server : null) || httpServer
    middlewares.use(proxyMiddleware(middlewareServer, proxy, config))
  }

  // 非根 base 先重写或拒绝请求路径。
  if (config.base !== '/') {
    middlewares.use(baseMiddleware(config.rawBase, !!middlewareMode))
  }

  // 编辑器跳转 API。
  middlewares.use('/__open-in-editor', launchEditorMiddleware())

  // HMR ping；保留命名函数，`DEBUG=connect:dispatcher` 会显示该名称。
  middlewares.use(
    /** 特定 Accept 的 HTTP 可达性探测返回 204，其他请求继续后续中间件。 */
    function viteHMRPingMiddleware(req, res, next) {
      if (req.headers.accept === 'text/x-vite-ping') {
        res.writeHead(204).end()
      } else {
        next()
      }
    }
  )

  // public 文件必须位于 transform 前，确保原样提供且不进入插件转换。
  if (publicDir) {
    middlewares.use(servePublicMiddleware(server, publicFiles))
  }

  if (config.experimental.bundledDev) {
    middlewares.use(triggerLazyBundlingMiddleware(server))
    middlewares.use(memoryFilesMiddleware(server))
  } else {
    // 普通开发模式的模块转换主入口。
    middlewares.use(transformMiddleware(server))

    // /@fs/ 与 root 静态文件在 transform 未处理时兜底。
    middlewares.use(serveRawFsMiddleware(server))
    middlewares.use(serveStaticMiddleware(server))
  }

  // SPA/MPA HTML fallback 在静态/模块请求之后判断导航请求。
  if (config.appType === 'spa' || config.appType === 'mpa') {
    middlewares.use(
      htmlFallbackMiddleware(
        root,
        config.appType === 'spa',
        server.environments.client,
      ),
    )
  }

  // 用户 configureServer post 钩子 --------------------------------------------

  // post hook 仍放在 HTML 中间件前，使用户可返回自定义内容取代 index.html。
  postHooks.forEach((fn) => fn && fn())

  if (config.appType === 'spa' || config.appType === 'mpa') {
    // 转换并返回 index.html。
    middlewares.use(indexHtmlMiddleware(root, server))

    // HTML 仍未命中时返回 404。
    middlewares.use(notFoundMiddleware())
  }

  // 统一错误处理最后注册，捕获前面 next(err)。
  middlewares.use(errorMiddleware(server, !!middlewareMode))

  // 端口冲突回退会多次调用 httpServer.listen；Promise 门闩保证初始化/buildStart 只执行
  // 一次，其他调用等待同一任务。
  let initingServer: Promise<void> | undefined
  let serverInited = false
  /** 普通开发模式只启动一次 client buildStart；按监听阶段启动各 Environment。 */
  const initServer = async (onListen: boolean) => {
    if (serverInited) return
    if (initingServer) return initingServer

    initingServer = (async function () {
      if (!config.experimental.bundledDev) {
        // 兼容旧行为：初始化时只启动 client buildStart；其他 Environment 在首次 resolveId
        // 时惰性启动，直接 load/transform 不会触发该启动分支。
        await environments.client.pluginContainer.buildStart()
      }

      // 独立 Server 或真实 listen 时启动所有 Environment 的 listen 生命周期（含 WS）。
      if (onListen || options.listen) {
        await Promise.all(
          Object.values(environments).map((e) => e.listen(server)),
        )
      }

      initingServer = undefined
      serverInited = true
    })()
    return initingServer
  }

  if (!middlewareMode && httpServer) {
    // 包装原生 listen，在端口真正暴露前完成插件/Environment 初始化。
    const listen = httpServer.listen.bind(httpServer)
    /** 等待一次性初始化后调用原 listen；初始化失败向 HTTP server 发出 error，保留失败门闩。 */
    httpServer.listen = (async (port: number, ...args: any[]) => {
      try {
        await initServer(true)
      } catch (e) {
        httpServer.emit('error', e)
        return
      }
      return listen(port, ...args)
    }) as any
  } else {
    await initServer(false)
  }

  return server
}

/**
 * 选择端口并启动底层 HTTP Server。
 * 重启时若配置端口没变，优先复用上次真实端口，避免非 strictPort 回退后浏览器标签 URL
 * 突然切回原端口（#14418）；用户显式修改端口则采用新值。
 */
async function startServer(
  server: ViteDevServer,
  hostname: Hostname,
  inlinePort?: number,
): Promise<void> {
  const httpServer = server.httpServer
  if (!httpServer) {
    throw new Error('Cannot call server.listen in middleware mode.')
  }

  const options = server.config.server
  const configPort = inlinePort ?? options.port
  // 非 strictPort 时真实端口可能与配置不同；配置没变就复用真实端口。
  const port =
    configPort === server._configServerPort
      ? (server._currentServerPort ?? configPort)
      : configPort
  server._configServerPort = configPort

  const serverPort = await httpServerStart(httpServer, {
    port,
    strictPort: options.strictPort,
    host: hostname.host,
    logger: server.config.logger,
  })
  server._currentServerPort = serverPort
}

/**
 * 创建 HTTP Server 的关闭函数。
 * 主动销毁所有 keep-alive/socket，避免 `server.close()` 长时间等待；从未 listen 的 Server
 * 直接完成，防止 Node 抛 ERR_SERVER_NOT_RUNNING。
 */
export function createServerCloseFn(
  server: HttpServer | null,
): () => Promise<void> {
  if (!server) {
    return () => Promise.resolve()
  }

  let hasListened = false
  const openSockets = new Set<net.Socket>()

  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => {
      openSockets.delete(socket)
    })
  })

  server.once('listening', () => {
    hasListened = true
  })

  return () =>
    new Promise<void>((resolve, reject) => {
      openSockets.forEach((s) => s.destroy())
      if (hasListened) {
        server.close((err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      } else {
        resolve()
      }
    })
}

/** 把 fs.allow 的相对目录按 root 解析并统一路径分隔符。 */
function resolvedAllowDir(root: string, dir: string): string {
  return normalizePath(path.resolve(root, dir))
}

/** 可静态确定的 ServerOptions 默认值；fs.allow、sourcemapIgnoreList 等字段稍后解析。 */
const _serverConfigDefaults = Object.freeze({
  port: DEFAULT_DEV_PORT,
  strictPort: false,
  host: 'localhost',
  allowedHosts: [],
  https: undefined,
  open: false,
  proxy: undefined,
  cors: { origin: defaultAllowedOrigins },
  headers: {},
  // hmr/ws 需要先建立兼容代理。
  warmup: {
    clientFiles: [],
    ssrFiles: [],
  },
  // watch 缺省交给 Chokidar 默认值。
  middlewareMode: false,
  fs: {
    strict: true,
    // allow 缺省搜索 workspace root。
    deny: [
      '.env',
      '.env.*',
      '*.{crt,pem,key,p12,pfx,cer,der}',
      '.npmrc',
      '.yarnrc.yml',
      '**/.git/**',
    ],
  },
  // origin 保持用户提供的值；缺省为 undefined，资源 URL 可直接使用 base。
  preTransformRequests: true,
  // sourcemapIgnoreList 缺省使用 isInNodeModules。
  perEnvironmentStartEndDuringDev: false,
  perEnvironmentWatchChangeDuringDev: false,
  // hotUpdateEnvironments 缺省并行全部 Environment。
  forwardConsole: undefined,
} satisfies ServerOptions)

/** 公开的只读 ServerOptions 默认值。 */
export const serverConfigDefaults: Readonly<Partial<ServerOptions>> =
  _serverConfigDefaults

/** allowedHosts 环境变量中会破坏 Host header/配置语义的保留字符。 */
const RESERVED_ALLOWED_HOSTS_CHARACTERS_RE = /[\\"']/

/**
 * 合并 Server 默认值并解析 fs 安全边界、workspace/package manager 额外路径、HMR/WS 兼容
 * 配置与 console 转发。相对 fs.allow 项最终全部转为规范化绝对路径。
 */
export async function resolveServerOptions(
  root: string,
  raw: ServerOptions | undefined,
  logger: Logger,
): Promise<ResolvedServerOptions> {
  const _server = mergeWithDefaults(
    {
      ..._serverConfigDefaults,
      // 保持 undefined，后续才能区分“用户未设置”与显式 localhost。
      host: undefined,
      sourcemapIgnoreList: isInNodeModules,
    },
    raw ?? {},
  )

  setupHmrWsOptionCompat(_server)

  const workspaceRoot = searchForWorkspaceRoot(root)
  const server: ResolvedServerOptions = {
    ..._server,
    fs: {
      ..._server.fs,
      // 仅在用户没有显式 allow 时搜索 workspace root。
      allow: raw?.fs?.allow ?? [workspaceRoot],
    },
    /** false 转为空判定函数；其余情况保留已合并的用户函数或默认 isInNodeModules。 */
    sourcemapIgnoreList:
      _server.sourcemapIgnoreList === false
        ? () => false
        : _server.sourcemapIgnoreList,
    forwardConsole: await resolveForwardConsoleOptions(_server.forwardConsole),
  }

  let allowDirs = server.fs.allow

  const cwd = searchForPackageRoot(root)
  if (process.versions.pnp) {
    // execSync 的 cwd 必须存在，而用户 root 可能尚未创建；使用最近 package root。
    try {
      const enableGlobalCache =
        execSync('yarn config get enableGlobalCache', { cwd })
          .toString()
          .trim() === 'true'
      const yarnCacheDir = execSync(
        `yarn config get ${enableGlobalCache ? 'globalFolder' : 'cacheFolder'}`,
        { cwd },
      )
        .toString()
        .trim()
      allowDirs.push(yarnCacheDir)
    } catch (e) {
      logger.warn(`Get yarn cache dir error: ${e.message}`, {
        timestamp: true,
      })
    }
  }

  // pnpm Global Virtual Store 可能把包文件放在 workspace 外，从 workspace 根的
  // node_modules/.modules.yaml 尝试读取 virtualStoreDir（#22757、#22825）。
  // 此实现使用 JSON.parse，只有内容同时是合法 JSON 才会命中；普通 YAML 内容会进入 catch。
  const pnpmModulesYaml = path.join(
    workspaceRoot,
    'node_modules',
    '.modules.yaml',
  )
  try {
    const content = fs.readFileSync(pnpmModulesYaml, 'utf-8')
    const parsed = JSON.parse(content)
    const virtualStoreDir = parsed.virtualStoreDir
    if (virtualStoreDir) {
      if (path.isAbsolute(virtualStoreDir)) {
        allowDirs.push(virtualStoreDir)
      } else if (virtualStoreDir.startsWith('..')) {
        allowDirs.push(
          path.resolve(
            path.join(workspaceRoot, 'node_modules'),
            virtualStoreDir,
          ),
        )
      }
    }
  } catch {
    // 文件不存在、不可读或无法按 JSON 解析时，静默跳过额外目录。
  }

  allowDirs = allowDirs.map((i) => resolvedAllowDir(root, i))

  // 仅当 Vite client 运行时代码不在现有 allow 内时追加，避免重复/过宽路径。
  const resolvedClientDir = resolvedAllowDir(root, CLIENT_DIR)
  if (!allowDirs.some((dir) => isParentDirectory(dir, resolvedClientDir))) {
    allowDirs.push(resolvedClientDir)
  }

  server.fs.allow = allowDirs

  if (server.origin?.endsWith('/')) {
    server.origin = server.origin.slice(0, -1)
    logger.warn(
      colors.yellow(
        `${colors.bold('(!)')} server.origin should not end with "/". Using "${
          server.origin
        }" instead.`,
      ),
    )
  }

  if (
    process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS &&
    Array.isArray(server.allowedHosts)
  ) {
    const rawAdditionalHosts =
      process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS
    if (RESERVED_ALLOWED_HOSTS_CHARACTERS_RE.test(rawAdditionalHosts)) {
      logger.warn(
        colors.yellow(
          `${colors.bold('(!)')} Skipping additional allowed hosts from environment variable due to reserved characters. Received: "${rawAdditionalHosts}".`,
        ),
      )
    } else {
      const additionalHosts = rawAdditionalHosts
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean)
      server.allowedHosts = [...server.allowedHosts, ...additionalHosts]
    }
  }

  return server
}

/**
 * 用同一 inlineConfig 构造新 Server，再把它原位移植到旧实例。
 * 配置文件、插件、中间件和 Environment 全部重建，但用户持有的 server 与 middlewares
 * 引用保持不变；普通模式重新监听旧真实端口，middleware mode 只重启 Environment。
 */
async function restartServer(server: ViteDevServer) {
  global.__vite_start_time = performance.now()

  let inlineConfig = server.config.inlineConfig
  if (server._forceOptimizeOnRestart) {
    inlineConfig = mergeConfig(inlineConfig, {
      forceOptimizeDeps: true,
    })
  }

  // 先完整构造新实例；成功前不关闭旧 Server，配置错误时旧服务仍可继续工作。
  {
    let newServer: ViteDevServer | null = null
    try {
      // 延迟 WS/Environment listen，直到旧 Server 已关闭并释放端口。
      newServer = await _createServer(inlineConfig, {
        listen: false,
        previousEnvironments: server.environments,
        previousShortcutsState: server._shortcutsState,
        previousRestartPromise: server._restartPromise,
        previousForceOptimizeOnRestart: server._forceOptimizeOnRestart,
      })
    } catch (err: any) {
      server.config.logger.error(err.message, {
        timestamp: true,
      })
      server.config.logger.error('server restart failed', { timestamp: true })
      return
    }

    // 暂时解除旧快捷键 readline 所有权，关闭时不销毁；新实例随后复用，避免 stdin 异常。
    server._shortcutsState = undefined

    await server.close()

    // 把新 Server 字段赋给旧对象，同时迁移配置/真实端口记忆。
    const middlewares = server.middlewares
    newServer._configServerPort = server._configServerPort
    newServer._currentServerPort = server._currentServerPort
    Object.assign(server, newServer)

    // 保留原 Connect 实例，只替换 stack；middleware mode 中
    // `app.use(vite.middlewares)` 的引用才能在重启后继续生效（#15166）。
    middlewares.stack = newServer.middlewares.stack
    server.middlewares = middlewares

    // 新方法闭包重新指向用户持有的旧对象。
    newServer._setInternalServer(server)
  }

  const {
    logger,
    server: { port, middlewareMode },
  } = server.config
  if (!middlewareMode) {
    await server.listen(port, true)
  } else {
    await Promise.all(
      Object.values(server.environments).map((e) => e.listen(server)),
    )
  }
  logger.info('server restarted.', { timestamp: true })

  if (
    (server._shortcutsState as ShortcutsState<ViteDevServer> | undefined)
      ?.options
  ) {
    bindCLIShortcuts(
      server,
      { print: false },
      // 快捷键重启前已通过环境检查，此处直接复绑并避免重复输出。
      true,
    )
  }
}

/**
 * 重启 Vite Server；仅当端口、host 或 DNS 地址排序发生变化时重新打印 URL。
 * middleware mode 没有可打印 URL，直接重启。
 */
export async function restartServerWithUrls(
  server: ViteDevServer,
): Promise<void> {
  if (server.config.server.middlewareMode) {
    await server.restart()
    return
  }

  const { port: prevPort, host: prevHost } = server.config.server
  const prevUrls = server.resolvedUrls

  await server.restart()

  const {
    logger,
    server: { port, host },
  } = server.config
  if (
    (port ?? DEFAULT_DEV_PORT) !== (prevPort ?? DEFAULT_DEV_PORT) ||
    host !== prevHost ||
    diffDnsOrderChange(prevUrls, server.resolvedUrls)
  ) {
    logger.info('')
    server.printUrls()
  }
}
