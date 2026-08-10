import fs from 'node:fs'
import path from 'node:path'
import sirv from 'sirv'
import compression from '@polka/compression'
import connect from 'connect'
import corsMiddleware from 'cors'
import { disableCache } from '@voidzero-dev/vite-task-client'
import type { Connect } from '#dep-types/connect'
import type {
  HttpServer,
  ResolvedServerOptions,
  ResolvedServerUrls,
} from './server'
import { createServerCloseFn } from './server'
import type { CommonServerOptions } from './http'
import {
  httpServerStart,
  resolveHttpServer,
  resolveHttpsConfig,
  setClientErrorHandler,
} from './http'
import { openBrowser } from './server/openBrowser'
import { baseMiddleware } from './server/middlewares/base'
import { htmlFallbackMiddleware } from './server/middlewares/htmlFallback'
import { indexHtmlMiddleware } from './server/middlewares/indexHtml'
import { notFoundMiddleware } from './server/middlewares/notFound'
import { proxyMiddleware } from './server/middlewares/proxy'
import {
  getServerUrlByHost,
  normalizePath,
  resolveHostname,
  resolveServerUrls,
  setupSIGTERMListener,
  shouldServeFile,
  teardownSIGTERMListener,
} from './utils'
import { printServerUrls } from './logger'
import { bindCLIShortcuts } from './shortcuts'
import type { BindCLIShortcutsOptions, ShortcutsState } from './shortcuts'
import { resolveConfig } from './config'
import type { InlineConfig, ResolvedConfig } from './config'
import { DEFAULT_PREVIEW_PORT } from './constants'
import type { RequiredExceptFor } from './typeUtils'
import { hostValidationMiddleware } from './server/middlewares/hostCheck'
import {
  BasicMinimalPluginContext,
  basePluginContextMeta,
} from './server/pluginContainer'
import type { MinimalPluginContextWithoutEnvironment } from './plugin'

/** 预览服务器可配置项；复用开发服务器的通用 HTTP、代理与访问控制能力。 */
export interface PreviewOptions extends CommonServerOptions {}

/** 除 host、https、proxy 仍允许保留可选语义外，其他字段均已补齐默认值。 */
export interface ResolvedPreviewOptions extends RequiredExceptFor<
  PreviewOptions,
  'host' | 'https' | 'proxy'
> {}

/**
 * 将 preview 配置与已解析 server 配置合并。
 *
 * 预览服务器默认继承开发服务器的通用网络策略，唯独端口使用 4173，使 `dev`
 * 与 `preview` 无额外配置也能同时运行。preview 中显式值始终优先。
 */
export function resolvePreviewOptions(
  preview: PreviewOptions | undefined,
  server: ResolvedServerOptions,
): ResolvedPreviewOptions {
  // CommonServerOptions 逐项继承，不能用简单对象展开：需要保留 `undefined` 时回退
  // server 配置的语义，并为 port 单独应用预览默认值。
  return {
    port: preview?.port ?? DEFAULT_PREVIEW_PORT,
    strictPort: preview?.strictPort ?? server.strictPort,
    host: preview?.host ?? server.host,
    allowedHosts: preview?.allowedHosts ?? server.allowedHosts,
    https: preview?.https ?? server.https,
    open: preview?.open ?? server.open,
    proxy: preview?.proxy ?? server.proxy,
    cors: preview?.cors ?? server.cors,
    headers: preview?.headers ?? server.headers,
  }
}

/** 静态服务生产输出并暴露关闭、地址与快捷键能力的预览服务器。 */
export interface PreviewServer {
  /**
   * 已解析的 Vite 配置对象。
   */
  config: ResolvedConfig
  /**
   * 停止服务器；重复调用会复用同一个关闭 Promise。
   */
  close(): Promise<void>
  /**
   * Connect 应用实例。
   * - 可向预览服务器追加自定义中间件；
   * - 也可作为自定义 HTTP 服务器的 handler，或嵌入 Connect 风格框架。
   *
   * https://github.com/senchalabs/connect#use-middleware
   */
  middlewares: Connect.Server
  /**
   * Node 原生 HTTP/HTTPS 服务器实例。
   */
  httpServer: HttpServer
  /**
   * Vite CLI 打印的、经过 URL 编码的已解析地址；尚未监听或已经关闭时为 null。
   */
  resolvedUrls: ResolvedServerUrls | null
  /**
   * 打印当前已解析的服务器地址；调用前必须已经开始监听。
   */
  printUrls(): void
  /**
   * 为此预览服务器绑定交互式 CLI 快捷键。
   */
  bindCLIShortcuts(options?: BindCLIShortcutsOptions<PreviewServer>): void
  /**
   * @internal
   */
  _shortcutsState?: ShortcutsState<PreviewServer>
}

/** configurePreviewServer 钩子，可返回在内部中间件之后执行的安装/清理回调。 */
export type PreviewServerHook = (
  this: MinimalPluginContextWithoutEnvironment,
  server: PreviewServer,
) => (() => void) | void | Promise<(() => void) | void>

/**
 * 启动 Vite 预览服务器，用本地静态服务近似验证生产构建产物。
 *
 * 它不会运行开发期模块转换，而是解析 production 配置、挂载插件预览钩子、代理、
 * 压缩、base、静态产物与 HTML fallback。预览只能验证构建结果和服务行为，不能
 * 等价替代真实生产基础设施。
 */
export async function preview(
  inlineConfig: InlineConfig = {},
): Promise<PreviewServer> {
  // 预览服务器是长驻交互进程，响应依赖真实监听状态，不能由任务缓存回放。
  disableCache()

  const config = await resolveConfig(
    inlineConfig,
    'serve',
    'production',
    'production',
    true,
  )

  const clientOutDir = config.environments.client.build.outDir
  const distDir = path.resolve(config.root, clientOutDir)
  if (
    !fs.existsSync(distDir) &&
    // 插件若实现 configurePreviewServer，可能自行提供内容，因此不能提前判定缺产物。
    config.plugins.every((plugin) => !plugin.configurePreviewServer) &&
    // 仅 CLI `vite preview` 直接报错；编程调用者仍可能通过 httpServer/中间件定制服务。
    process.argv[1]?.endsWith(path.normalize('bin/vite.js')) &&
    process.argv[2] === 'preview'
  ) {
    throw new Error(
      `The directory "${clientOutDir}" does not exist. Did you build your project?`,
    )
  }

  const httpsOptions = await resolveHttpsConfig(config.preview.https)
  const app = connect() as Connect.Server
  const httpServer = await resolveHttpServer(app, httpsOptions)
  setClientErrorHandler(httpServer, config.logger)

  const options = config.preview
  const logger = config.logger

  const closeHttpServer = createServerCloseFn(httpServer)

  // 缓存关闭 Promise，避免插件、信号处理和用户代码同时关闭时重复操作底层 server。
  let closeServerPromise: Promise<void> | undefined
  /** 解除进程信号监听、关闭 HTTP Server 并清空已解析地址。 */
  const closeServer = async () => {
    teardownSIGTERMListener(closeServerAndExit)
    await closeHttpServer()
    server.resolvedUrls = null
  }

  const server: PreviewServer = {
    config,
    middlewares: app,
    httpServer,
    /** 幂等关闭预览服务器，所有并发调用共享同一 Promise。 */
    async close() {
      if (!closeServerPromise) {
        closeServerPromise = closeServer()
      }
      return closeServerPromise
    },
    resolvedUrls: null,
    /** 输出监听后解析出的本地与网络地址。 */
    printUrls() {
      if (server.resolvedUrls) {
        printServerUrls(server.resolvedUrls, options.host, logger.info)
      } else {
        throw new Error('Cannot print server URLs before server is listening.')
      }
    },
    /** 把预览服务器注册到共享交互式快捷键处理器。 */
    bindCLIShortcuts(options) {
      bindCLIShortcuts(server as PreviewServer, options)
    },
  }

  /** 响应进程信号：等待服务器关闭后设置退出码并结束进程。 */
  const closeServerAndExit = async (_: unknown, exitCode?: number) => {
    try {
      await server.close()
    } finally {
      process.exitCode ??= exitCode ? 128 + exitCode : undefined
      process.exit()
    }
  }

  setupSIGTERMListener(closeServerAndExit)

  // CORS 位于代理和静态内容之前，确保所有正常响应采用一致策略。
  const { cors } = config.preview
  if (cors !== false) {
    app.use(corsMiddleware(typeof cors === 'boolean' ? {} : cors))
  }

  // Host 校验防御 DNS rebinding；HTTPS 已由证书绑定主机身份，不需此层重复校验。
  const { allowedHosts } = config.preview
  if (allowedHosts !== true && !config.preview.https) {
    app.use(hostValidationMiddleware(allowedHosts, true))
  }

  // 插件前置钩子现在执行；其返回函数延迟到 Vite 内置核心中间件挂载后执行。
  const configurePreviewServerContext = new BasicMinimalPluginContext(
    { ...basePluginContextMeta, watchMode: false },
    config.logger,
  )
  const postHooks: ((() => void) | void)[] = []
  for (const hook of config.getSortedPluginHooks('configurePreviewServer')) {
    postHooks.push(await hook.call(configurePreviewServerContext, server))
  }

  // 代理必须先于静态文件，否则同路径的构建产物会抢占代理请求。
  const { proxy } = config.preview
  if (proxy) {
    app.use(proxyMiddleware(httpServer, proxy, config))
  }

  app.use(compression())

  // 非根 base 先改写/拒绝请求，再进入 dist 静态服务。
  if (config.base !== '/') {
    app.use(baseMiddleware(config.rawBase, false))
  }

  // sirv 以 dev 模式启用 ETag，但禁用扩展名猜测与默认 ignores；shouldServeFile
  // 额外保证最终路径仍位于 distDir，避免符号链接或路径穿越越界。
  const headers = config.preview.headers
  /** 为每个请求创建受 distDir 边界和自定义响应头约束的 sirv 处理器。 */
  const viteAssetMiddleware = (...args: readonly [any, any?, any?]) =>
    sirv(distDir, {
      etag: true,
      dev: true,
      extensions: [],
      ignores: false,
      /** 把用户配置的 preview.headers 写入静态资源响应。 */
      setHeaders(res) {
        if (headers) {
          for (const name in headers) {
            res.setHeader(name, headers[name]!)
          }
        }
      },
      /** 拒绝解析后逃逸 distDir 的文件路径。 */
      shouldServe(filePath) {
        return shouldServeFile(filePath, distDir)
      },
    })(...args)

  app.use(viteAssetMiddleware)

  // SPA/MPA 才需要 HTML fallback；custom appType 由宿主中间件自行决定路由。
  if (config.appType === 'spa' || config.appType === 'mpa') {
    app.use(htmlFallbackMiddleware(distDir, config.appType === 'spa'))
  }

  // 后置钩子在静态与 fallback 之后、Vite 最终 HTML/404 处理之前插入。
  postHooks.forEach((fn) => fn && fn())

  if (config.appType === 'spa' || config.appType === 'mpa') {
    // 即使是已构建 HTML，仍通过预览钩子处理，允许 configurePreviewServer 定制。
    const normalizedDistDir = normalizePath(distDir)
    app.use(indexHtmlMiddleware(normalizedDistDir, server))

    // 最终兜底 404 必须最后挂载，避免截断插件后置中间件。
    app.use(notFoundMiddleware())
  }

  const hostname = await resolveHostname(options.host)

  await httpServerStart(httpServer, {
    port: options.port,
    strictPort: options.strictPort,
    host: hostname.host,
    logger,
  })

  server.resolvedUrls = resolveServerUrls(
    httpServer,
    config.preview,
    hostname,
    httpsOptions,
    config,
  )

  if (options.open) {
    const url = getServerUrlByHost(server.resolvedUrls, options.host)
    if (url) {
      const path =
        typeof options.open === 'string' ? new URL(options.open, url).href : url
      openBrowser(path, true, logger)
    }
  }

  return server as PreviewServer
}
