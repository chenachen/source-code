import fsp from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import colors from 'picocolors'
import type { RollupError } from 'rolldown'
import type { CustomPayload, HotPayload, Update } from '#types/hmrPayload'
import type {
  InvokeMethods,
  InvokeResponseData,
  InvokeSendData,
} from '../../shared/invokeMethods'
import { CLIENT_DIR } from '../constants'
import {
  createDebugger,
  formatAndTruncateFileList,
  monotonicDateNow,
  normalizePath,
} from '../utils'
import type { InferCustomEventPayload, ViteDevServer } from '..'
import { getHookHandler } from '../plugins'
import { isExplicitImportRequired } from '../plugins/importAnalysis'
import { getEnvFilesForMode } from '../env'
import type { Environment } from '../environment'
import { withTrailingSlash, wrapId } from '../../shared/utils'
import type { Plugin } from '../plugin'
import {
  ignoreDeprecationWarnings,
  warnFutureDeprecation,
} from '../deprecations'
import type { EnvironmentModuleNode } from './moduleGraph'
import type { ModuleNode } from './mixedModuleGraph'
import type { DevEnvironment } from './environment'
import { prepareError } from './middlewares/error'
import {
  BasicMinimalPluginContext,
  basePluginContextMeta,
} from './pluginContainer'
import type { HttpServer } from '.'
import { restartServerWithUrls } from '.'

/** `DEBUG=vite:hmr` 启用文件事件、传播边界和循环依赖诊断。 */
export const debugHmr: ((...args: any[]) => any) | undefined =
  createDebugger('vite:hmr')

/** 轻量 HMR 参数词法器用于跳过空白字符。 */
const whitespaceRE = /\s/

/** 规范化后的 Vite client 源码目录，用于识别运行时自身变更。 */
const normalizedClientDir = normalizePath(CLIENT_DIR)

/** 开发服务器与浏览器 client 建立 WebSocket 连接所需的完整参数。 */
export interface WsOptions {
  /** 连接协议，例如 ws 或 wss。 */
  protocol?: string
  /** 浏览器连接使用的主机名。 */
  host?: string
  /** 服务端实际监听端口。 */
  port?: number
  /** 注入浏览器 client 的显式连接端口，可与监听端口不同。 */
  clientPort?: number
  /** WebSocket endpoint 路径。 */
  path?: string
  /** 客户端等待连接建立的超时时间，单位毫秒。 */
  timeout?: number
  /** 可供 WebSocket 复用的既有 HTTP(S) Server。 */
  server?: HttpServer
}

/** 旧 `server.hmr` 配置入口；连接字段已迁移到 `server.ws`。 */
export interface HmrOptions {
  /**
   * @deprecated 请改用 `server.ws.protocol`。
   */
  protocol?: string
  /**
   * @deprecated 请改用 `server.ws.host`。
   */
  host?: string
  /**
   * @deprecated 请改用 `server.ws.port`。
   */
  port?: number
  /**
   * @deprecated 请改用 `server.ws.clientPort`。
   */
  clientPort?: number
  /**
   * @deprecated 请改用 `server.ws.path`。
   */
  path?: string
  /**
   * @deprecated 请改用 `server.ws.timeout`。
   */
  timeout?: number
  /** 是否在浏览器中显示编译错误浮层。 */
  overlay?: boolean
  /**
   * @deprecated 请改用 `server.ws.server`。
   */
  server?: HttpServer
}

/** 新 Environment API 的 hotUpdate hook 上下文；modules 只属于当前 Environment。 */
export interface HotUpdateOptions {
  /** watcher 事件类型。 */
  type: 'create' | 'update' | 'delete'
  /** 发生变化的规范化绝对文件路径。 */
  file: string
  /** 本轮事务共享的单调时间戳。 */
  timestamp: number
  /** 当前 Environment 中与文件关联的传播起点。 */
  modules: Array<EnvironmentModuleNode>
  /** 延迟读取变更后文件内容，规避编辑器覆盖写入中间态。 */
  read: () => string | Promise<string>
  /** 发起本轮更新的开发服务器。 */
  server: ViteDevServer
}

/** 兼容旧 handleHotUpdate hook 的上下文；modules 来自混合模块图。 */
export interface HmrContext {
  /** 发生变化的规范化绝对文件路径。 */
  file: string
  /** 本轮事务共享的单调时间戳。 */
  timestamp: number
  /** 旧 client/SSR 混合模块图中的传播起点。 */
  modules: Array<ModuleNode>
  /** 延迟读取稳定文件内容。 */
  read: () => string | Promise<string>
  /** 发起本轮更新的开发服务器。 */
  server: ViteDevServer
}

/** 从变更节点向 importer 回溯后找到的可接受边界，以及边界实际接受的直接依赖。 */
interface PropagationBoundary {
  /** 最终负责执行 accept callback 的模块。 */
  boundary: EnvironmentModuleNode & {
    /** HMR payload 只允许可执行的 JS/CSS 模块。 */
    type: 'js' | 'css'
  }
  /** boundary 实际接受并需要重新导入的直接依赖。 */
  acceptedVia: EnvironmentModuleNode
  /** 接受边界是否位于包含变更模块的循环 import 中。 */
  isWithinCircularImport: boolean
}

/** HotChannel 向单一连接发送协议消息的最小客户端视图。 */
export interface HotChannelClient {
  /** 向该连接发送一个完整 HMR payload。 */
  send(payload: HotPayload): void
}

/** 自定义 HMR 事件监听器；同时接收事件数据与来源连接。 */
export type HotChannelListener<T extends string = string> = (
  data: InferCustomEventPayload<T>,
  client: HotChannelClient,
) => void

/** 可由 WebSocket、进程内 EventEmitter 或用户 transport 实现的 HMR 通道。 */
export interface HotChannel<Api = any> {
  /**
   * 为 true 时 fetchModule 跳过文件系统访问检查；仅用于不会暴露到网络的可信 transport。
   */
  skipFsCheck?: boolean
  /**
   * 向所有客户端广播 payload。
   */
  send?(payload: HotPayload): void
  /**
   * 处理 `import.meta.hot.send` 发来的自定义事件。
   */
  on?<T extends string>(event: T, listener: HotChannelListener<T>): void
  /** 监听新客户端连接的旧兼容事件。 */
  on?(event: 'connection', listener: () => void): void
  /**
   * 注销事件监听器。
   */
  off?(event: string, listener: Function): void
  /**
   * 开始监听消息。
   */
  listen?(): void
  /**
   * 断开全部客户端；server 关闭或重启时调用。
   */
  close?(): Promise<unknown> | void

  /** transport 专属底层 API，供其集成层访问。 */
  api?: Api
}

/** 日志中 root 内文件显示相对路径，root 外文件保留完整路径。 */
export function getShortName(file: string, root: string): string {
  return file.startsWith(withTrailingSlash(root))
    ? path.posix.relative(root, file)
    : file
}

/** 归一化后的单连接客户端，同时支持协议与自定义事件两种 send 形态。 */
export interface NormalizedHotChannelClient {
  /** 向单个客户端发送协议 payload。 */
  send(payload: HotPayload): void
  /** 向单个客户端发送自定义事件。 */
  send(event: string, payload?: CustomPayload['data']): void
}

/** 服务端内部使用的必选 HotChannel 接口；可选 transport 方法均已归一。 */
export interface NormalizedHotChannel<Api = any> {
  /** 向所有客户端广播协议 payload。 */
  send(payload: HotPayload): void
  /** 向所有客户端广播自定义事件。 */
  send<T extends string>(event: T, payload?: InferCustomEventPayload<T>): void
  /** 处理 `import.meta.hot.send` 发来的自定义事件。 */
  on<T extends string>(
    event: T,
    listener: (
      data: InferCustomEventPayload<T>,
      client: NormalizedHotChannelClient,
    ) => void,
  ): void
  /**
   * @deprecated 请改监听 `vite:client:connect` 事件。
   */
  /** 监听旧 connection 事件，并由实现映射到 transport 连接生命周期。 */
  on(event: 'connection', listener: () => void): void
  /** 注销事件监听器。 */
  off(event: string, listener: Function): void
  /** @internal */
  setInvokeHandler(invokeHandlers: InvokeMethods | undefined): void
  /** 执行 RPC payload，并把成功值或可序列化错误封装为互斥响应。 */
  handleInvoke(payload: HotPayload): Promise<
    | {
        /** handler 的成功返回值。 */
        result: any
      }
    | {
        /** 跨 transport 返回的结构化错误。 */
        error: any
      }
  >
  /** 开始监听消息。 */
  listen(): void
  /** 断开全部客户端；server 关闭或重启时调用。 */
  close(): Promise<unknown> | void

  /** transport 专属底层 API。 */
  api?: Api
}

/**
 * 把可选方法、两种 send 重载、客户端包装和 RPC invoke 协议归一为服务端内部统一 HotChannel；HMR
 * 关闭时仍允许连接、ping、自定义事件与错误消息通过。
 */
export const normalizeHotChannel = (
  channel: HotChannel,
  enableHmr: boolean,
  normalizeClient = true,
): NormalizedHotChannel => {
  const normalizedListenerMap = new WeakMap<
    (data: any, client: NormalizedHotChannelClient) => void | Promise<void>,
    (data: any, client: HotChannelClient) => void | Promise<void>
  >()
  const normalizedClients = new WeakMap<
    HotChannelClient,
    NormalizedHotChannelClient
  >()

  let invokeHandlers: InvokeMethods | undefined
  let listenerForInvokeHandler:
    | ((data: InvokeSendData, client: HotChannelClient) => void)
    | undefined
  /** 按 RPC 方法名分派参数，并把异常转成可跨通道传输的诊断对象。 */
  const handleInvoke = async <T extends keyof InvokeMethods>(
    payload: HotPayload,
  ) => {
    if (!invokeHandlers) {
      return {
        error: {
          name: 'TransportError',
          message: 'invokeHandlers is not set',
          stack: new Error().stack,
        },
      }
    }

    const data: InvokeSendData<T> = (payload as CustomPayload).data
    const { name, data: args } = data
    try {
      const invokeHandler = invokeHandlers[name]
      // @ts-expect-error name 已把 invokeHandler 收窄为 InvokeMethods[T]，参数元组与之对应。
      const result = await invokeHandler(...args)
      return { result }
    } catch (error) {
      return {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
          ...error, // 保留 RollupError.loc/frame/plugin 等可枚举诊断字段。
        },
      }
    }
  }

  return {
    ...channel,
    on: (
      event: string,
      fn: (data: any, client: NormalizedHotChannelClient) => void,
    ) => {
      if (event === 'connection' || !normalizeClient) {
        channel.on?.(event, fn as () => void)
        return
      }

      /** 把 transport client 惰性包装成支持自定义事件重载的内部 client。 */
      const listenerWithNormalizedClient = (
        data: any,
        client: HotChannelClient,
      ) => {
        if (!normalizedClients.has(client)) {
          normalizedClients.set(client, {
            send: (...args) => {
              let payload: HotPayload
              if (typeof args[0] === 'string') {
                payload = {
                  type: 'custom',
                  event: args[0],
                  data: args[1],
                }
              } else {
                payload = args[0]
              }
              client.send(payload)
            },
          })
        }
        fn(data, normalizedClients.get(client)!)
      }
      normalizedListenerMap.set(fn, listenerWithNormalizedClient)

      channel.on?.(event, listenerWithNormalizedClient)
    },
    off: (event: string, fn: () => void) => {
      if (event === 'connection' || !normalizeClient) {
        channel.off?.(event, fn as () => void)
        return
      }

      const normalizedListener = normalizedListenerMap.get(fn)
      if (normalizedListener) {
        channel.off?.(event, normalizedListener)
      }
    },
    /** 安装或卸载 vite:invoke 的 RPC 分派器。 */
    setInvokeHandler(_invokeHandlers) {
      invokeHandlers = _invokeHandlers
      if (!_invokeHandlers) {
        if (listenerForInvokeHandler) {
          channel.off?.('vite:invoke', listenerForInvokeHandler)
        }
        return
      }

      listenerForInvokeHandler = async (payload, client) => {
        const responseInvoke = payload.id.replace('send', 'response') as
          | 'response'
          | `response:${string}`
        client.send({
          type: 'custom',
          event: 'vite:invoke',
          data: {
            name: payload.name,
            id: responseInvoke,
            data: (await handleInvoke({
              type: 'custom',
              event: 'vite:invoke',
              data: payload,
            }))!,
          } satisfies InvokeResponseData,
        })
      }
      channel.on?.('vite:invoke', listenerForInvokeHandler)
    },
    handleInvoke,
    send: (...args: any[]) => {
      let payload: HotPayload
      if (typeof args[0] === 'string') {
        payload = {
          type: 'custom',
          event: args[0],
          data: args[1],
        }
      } else {
        payload = args[0]
      }

      if (
        enableHmr ||
        payload.type === 'connected' ||
        payload.type === 'ping' ||
        payload.type === 'custom' ||
        payload.type === 'error'
      ) {
        channel.send?.(payload)
      }
    },
    /** 转发 transport 的开始监听动作。 */
    listen() {
      return channel.listen?.()
    },
    /** 转发 transport 的资源关闭动作。 */
    close() {
      return channel.close?.()
    },
  }
}

/**
 * 为一次文件更新建立 hot-update 插件调用顺序。
 *
 * @param plugins - 当前配置已启用的插件，原始顺序作为同组插件的稳定次序。
 * @returns 仅包含 `hotUpdate` 或旧 `handleHotUpdate` hook 的插件，按 pre、normal、post 排列。
 * @remarks 新 hook 的 `order` 优先；只有插件未提供新 hook 时才读取兼容 hook 的 `enforce`。
 */
export function getSortedPluginsByHotUpdateHook(
  plugins: readonly Plugin[],
): Plugin[] {
  const sortedPlugins: Plugin[] = []
  // 用三个区段索引直接插入结果，避免为每次 hook 排序额外创建 pre/normal/post 三个临时数组。
  let pre = 0,
    normal = 0,
    post = 0
  for (const plugin of plugins) {
    const hook = plugin.hotUpdate ?? plugin.handleHotUpdate
    if (hook) {
      if (typeof hook === 'object') {
        if (hook.order === 'pre') {
          sortedPlugins.splice(pre++, 0, plugin)
          continue
        }
        if (hook.order === 'post') {
          sortedPlugins.splice(pre + normal + post++, 0, plugin)
          continue
        }
      }
      sortedPlugins.splice(pre + normal++, 0, plugin)
    }
  }

  return sortedPlugins
}

/** 按 Environment 缓存已排序 HMR 插件，避免每次文件事件重复排序。 */
const sortedHotUpdatePluginsCache = new WeakMap<Environment, Plugin[]>()
/** 取得当前 Environment 的稳定 HMR hook 顺序。 */
function getSortedHotUpdatePlugins(environment: Environment): Plugin[] {
  let sortedPlugins = sortedHotUpdatePluginsCache.get(environment)
  if (!sortedPlugins) {
    sortedPlugins = getSortedPluginsByHotUpdateHook(environment.plugins)
    sortedHotUpdatePluginsCache.set(environment, sortedPlugins)
  }
  return sortedPlugins
}

/**
 * 文件 watcher 的 HMR 总入口：处理配置/env/client 特例，为每个 Environment 收集受影响模块、执行
 * hotUpdate/handleHotUpdate hooks，再并行传播更新或发送 full reload。
 */
export async function handleHMRUpdate(
  type: 'create' | 'delete' | 'update',
  file: string,
  server: ViteDevServer,
): Promise<void> {
  const { config } = server
  const mixedModuleGraph = ignoreDeprecationWarnings(() => server.moduleGraph)

  const environmentSnapshot = server.environments
  const environments = Object.values(environmentSnapshot)
  /** 插件 hook 重启服务器并替换 environments 后，判定当前事务已经过期。 */
  const isStale = () => server.environments !== environmentSnapshot
  const shortFile = getShortName(file, config.root)

  const isConfig = file === config.configFile
  const isConfigDependency = config.configFileDependencies.some(
    (name) => file === name,
  )

  const isEnv =
    config.envDir !== false &&
    getEnvFilesForMode(config.mode, config.envDir).includes(file)
  if (isConfig || isConfigDependency || isEnv) {
    // 配置、其依赖或 env 文件改变会影响整个管线，自动重启而非尝试局部热更新。
    debugHmr?.(`[config change] ${colors.dim(shortFile)}`)
    config.logger.info(
      colors.green(
        `${normalizePath(
          path.relative(process.cwd(), file),
        )} changed, restarting server...`,
      ),
      { clear: true, timestamp: true },
    )
    try {
      await restartServerWithUrls(server)
    } catch (e) {
      config.logger.error(colors.red(e))
    }
    return
  }

  debugHmr?.(`[file change] ${colors.dim(shortFile)}`)

  // 开发 client runtime 本身无法用旧 runtime 热替换，必须让页面重新获取新 client。
  if (file.startsWith(withTrailingSlash(normalizedClientDir))) {
    environments.forEach(({ hot }) =>
      hot.send({
        type: 'full-reload',
        path: '*',
        triggeredBy: path.resolve(config.root, file),
      }),
    )
    return
  }

  if (config.experimental.bundledDev) {
    // TODO：为 bundledDev 支持 handleHotUpdate/hotUpdate hooks。
    return
  }

  const timestamp = monotonicDateNow()
  const contextMeta = {
    type,
    file,
    timestamp,
    read: () => readModifiedFile(file),
    server,
  }
  const hotMap = new Map<
    Environment,
    {
      /** 当前 Environment 可被插件逐步收窄的更新上下文。 */
      options: HotUpdateOptions
      /** 该 Environment 的 hook 异常，延迟到其 HMR 调度阶段发送。 */
      error?: Error
    }
  >()

  for (const environment of environments) {
    const mods = new Set(environment.moduleGraph.getModulesByFile(file))
    if (type === 'create') {
      for (const mod of environment.moduleGraph._hasResolveFailedErrorModules) {
        mods.add(mod)
      }
    }
    const options = {
      ...contextMeta,
      modules: [...mods],
    }
    hotMap.set(environment, { options })
  }

  const mixedMods = new Set(mixedModuleGraph.getModulesByFile(file))

  const mixedHmrContext: HmrContext = {
    ...contextMeta,
    modules: [...mixedMods],
  }

  const contextForHandleHotUpdate = new BasicMinimalPluginContext(
    { ...basePluginContextMeta, watchMode: true },
    config.logger,
  )
  const clientEnvironment = server.environments.client
  const ssrEnvironment = server.environments.ssr
  const clientContext = clientEnvironment.pluginContainer.minimalContext
  const clientHotUpdateOptions = hotMap.get(clientEnvironment)!.options
  const ssrHotUpdateOptions = hotMap.get(ssrEnvironment)?.options
  try {
    for (const plugin of getSortedHotUpdatePlugins(clientEnvironment)) {
      if (plugin.hotUpdate) {
        const filteredModules = await getHookHandler(plugin.hotUpdate).call(
          clientContext,
          clientHotUpdateOptions,
        )
        if (isStale()) return
        if (filteredModules) {
          clientHotUpdateOptions.modules = filteredModules
          // 同步收窄兼容 mixed context，保证后续旧 hook 只看到新 hook 保留的模块。
          mixedHmrContext.modules = mixedHmrContext.modules.filter(
            (mixedMod) =>
              filteredModules.some((mod) => mixedMod.id === mod.id) ||
              ssrHotUpdateOptions?.modules.some(
                (ssrMod) => ssrMod.id === mixedMod.id,
              ),
          )
          mixedHmrContext.modules.push(
            ...filteredModules
              .filter(
                (mod) =>
                  !mixedHmrContext.modules.some(
                    (mixedMod) => mixedMod.id === mod.id,
                  ),
              )
              .map((mod) =>
                mixedModuleGraph.getBackwardCompatibleModuleNode(mod),
              ),
          )
        }
      } else if (type === 'update') {
        warnFutureDeprecation(
          config,
          'removePluginHookHandleHotUpdate',
          `Used in plugin "${plugin.name}".`,
          false,
        )
        // 将来需按 runtime 判断；当前为兼容旧 API，仍把 client/SSR 节点合并给 handleHotUpdate。
        const filteredModules = await getHookHandler(
          plugin.handleHotUpdate!,
        ).call(contextForHandleHotUpdate, mixedHmrContext)
        if (isStale()) return
        if (filteredModules) {
          mixedHmrContext.modules = filteredModules
          clientHotUpdateOptions.modules =
            clientHotUpdateOptions.modules.filter((mod) =>
              filteredModules.some((mixedMod) => mod.id === mixedMod.id),
            )
          clientHotUpdateOptions.modules.push(
            ...(filteredModules
              .filter(
                (mixedMod) =>
                  !clientHotUpdateOptions.modules.some(
                    (mod) => mod.id === mixedMod.id,
                  ),
              )
              .map((mixedMod) => mixedMod._clientModule)
              .filter(Boolean) as EnvironmentModuleNode[]),
          )
          if (ssrHotUpdateOptions) {
            ssrHotUpdateOptions.modules = ssrHotUpdateOptions.modules.filter(
              (mod) =>
                filteredModules.some((mixedMod) => mod.id === mixedMod.id),
            )
            ssrHotUpdateOptions.modules.push(
              ...(filteredModules
                .filter(
                  (mixedMod) =>
                    !ssrHotUpdateOptions.modules.some(
                      (mod) => mod.id === mixedMod.id,
                    ),
                )
                .map((mixedMod) => mixedMod._ssrModule)
                .filter(Boolean) as EnvironmentModuleNode[]),
            )
          }
        }
      }
    }
  } catch (error) {
    if (isStale()) return
    hotMap.get(clientEnvironment)!.error = error
  }

  for (const environment of environments) {
    if (environment.name === 'client') continue
    const hot = hotMap.get(environment)!
    const context = environment.pluginContainer.minimalContext
    try {
      for (const plugin of getSortedHotUpdatePlugins(environment)) {
        if (plugin.hotUpdate) {
          const filteredModules = await getHookHandler(plugin.hotUpdate).call(
            context,
            hot.options,
          )
          if (isStale()) return
          if (filteredModules) {
            hot.options.modules = filteredModules
          }
        }
      }
    } catch (error) {
      if (isStale()) return
      hot.error = error
    }
  }

  /** 执行单个 Environment 的更新传播，并把异常转换为 HMR error payload。 */
  async function hmr(environment: DevEnvironment) {
    if (isStale()) return
    try {
      const { options, error } = hotMap.get(environment)!
      if (error) {
        throw error
      }
      if (!options.modules.length) {
        // 未匹配模块的 HTML 仍可能是顶层页面模板，只能让 client reload。
        if (file.endsWith('.html') && environment.name === 'client') {
          environment.logger.info(
            colors.green(`page reload `) + colors.dim(shortFile),
            {
              clear: true,
              timestamp: true,
            },
          )
          environment.hot.send({
            type: 'full-reload',
            path: config.server.middlewareMode
              ? '*'
              : '/' + normalizePath(path.relative(config.root, file)),
          })
        } else {
          // watcher 看见文件变化但模块图没有节点，通常是未加载或非 JS 资源。
          debugHmr?.(
            `(${environment.name}) [no modules matched] ${colors.dim(shortFile)}`,
          )
        }
        return
      }

      updateModules(environment, shortFile, options.modules, timestamp)
    } catch (err) {
      environment.hot.send({
        type: 'error',
        err: prepareError(err),
      })
    }
  }

  if (isStale()) return

  const hotUpdateEnvironments =
    server.config.server.hotUpdateEnvironments ??
    ((server, hmr) => {
      // 默认并行处理所有 Environment；用户可通过 hotUpdateEnvironments 自定义调度/顺序。
      return Promise.all(
        Object.values(server.environments).map((environment) =>
          hmr(environment),
        ),
      )
    })

  await hotUpdateEnvironments(server, hmr)
}

/** HMR 传播结果：false 表示可局部更新，true/字符串表示需 reload 及可选原因。 */
type HasDeadEnd = string | boolean

/**
 * 从变更模块沿 importers 反向传播，收集 self/dependency/export accept 边界；先使相关模块图节点失效，
 * 再发送精确 update。任一路径到达死端、顶层 HTML 或 invalidate 循环时退化为 full reload。
 */
export function updateModules(
  environment: DevEnvironment,
  file: string,
  modules: EnvironmentModuleNode[],
  timestamp: number,
  firstInvalidatedBy?: string,
): void {
  const { hot } = environment
  const updates: Update[] = []
  const invalidatedModules = new Set<EnvironmentModuleNode>()
  const traversedModules = new Set<EnvironmentModuleNode>()
  // import.meta.hot.invalidate() 可使根模块以空集合再次进入；没有传播起点即视为 full reload。
  let needFullReload: HasDeadEnd = modules.length === 0

  for (const mod of modules) {
    const boundaries: PropagationBoundary[] = []
    const hasDeadEnd = propagateUpdate(mod, traversedModules, boundaries)

    environment.moduleGraph.invalidateModule(
      mod,
      invalidatedModules,
      timestamp,
      true,
    )

    if (needFullReload) {
      continue
    }

    if (hasDeadEnd) {
      needFullReload = hasDeadEnd
      continue
    }

    // 同一轮中边界又 invalidate 到 firstInvalidatedBy，说明 importer 链无法稳定接管本次更新，退回
    // full reload，避免递归 invalidate。
    if (
      firstInvalidatedBy &&
      boundaries.some(
        ({ acceptedVia }) =>
          normalizeHmrUrl(acceptedVia.url) === firstInvalidatedBy,
      )
    ) {
      needFullReload = 'circular import invalidate'
      continue
    }

    updates.push(
      ...boundaries.map(
        ({ boundary, acceptedVia, isWithinCircularImport }) => ({
          type: `${boundary.type}-update` as const,
          timestamp,
          path: normalizeHmrUrl(boundary.url),
          acceptedPath: normalizeHmrUrl(acceptedVia.url),
          explicitImportRequired:
            boundary.type === 'js'
              ? isExplicitImportRequired(acceptedVia.url)
              : false,
          isWithinCircularImport,
          firstInvalidatedBy,
        }),
      ),
    )
  }

  // HTML 可能是顶层请求模板，无法用模块 accept 替换整个文档。
  const isClientHtmlChange =
    file.endsWith('.html') &&
    environment.name === 'client' &&
    // 若 HTML 被当 JS 模块导入，则假设它不是 middleware 提供的顶层页面模板，可按普通模块传播。
    modules.every((mod) => mod.type !== 'js')

  if (needFullReload || isClientHtmlChange) {
    const reason =
      typeof needFullReload === 'string'
        ? colors.dim(` (${needFullReload})`)
        : ''
    environment.logger.info(
      colors.green(`page reload `) + colors.dim(file) + reason,
      { clear: !firstInvalidatedBy, timestamp: true },
    )
    hot.send({
      type: 'full-reload',
      triggeredBy: path.resolve(environment.config.root, file),
      path:
        !isClientHtmlChange ||
        environment.config.server.middlewareMode ||
        updates.length > 0 // 同批还有模块更新时，可能影响其他页面 URL，保守全局 reload。
          ? '*'
          : '/' + file,
    })
    return
  }

  if (updates.length === 0) {
    debugHmr?.(colors.yellow(`no update happened `) + colors.dim(file))
    return
  }

  const filePaths = [...new Set(updates.map((u) => u.path))]
  const { formatted, truncated } = formatAndTruncateFileList(filePaths)
  if (truncated) debugHmr?.(`hmr update ${filePaths.join(', ')}`)
  environment.logger.info(colors.green(`hmr update `) + colors.dim(formatted), {
    clear: !firstInvalidatedBy,
    timestamp: true,
  })
  hot.send({
    type: 'update',
    updates,
  })
}

/** importer 对该模块用到的 binding 是否全部包含在 acceptExports 声明中。 */
function areAllImportsAccepted(
  importedBindings: Set<string>,
  acceptedExports: Set<string>,
) {
  for (const binding of importedBindings) {
    if (!acceptedExports.has(binding)) {
      return false
    }
  }
  return true
}

/**
 * 深度优先沿 importer 反向传播。找到接受边界就停止该分支；到达无 importer、HTML、未接受动态边或不安全
 * 循环则返回死端原因。共享 traversedModules 防止图遍历重复，但 currentChain 保留当前路径供循环判断。
 */
function propagateUpdate(
  node: EnvironmentModuleNode,
  traversedModules: Set<EnvironmentModuleNode>,
  boundaries: PropagationBoundary[],
  currentChain: EnvironmentModuleNode[] = [node],
): HasDeadEnd {
  if (traversedModules.has(node)) {
    return false
  }
  traversedModules.add(node)

  // #7561：imports 尚未分析表示该节点未被浏览器真正加载，停止传播即可，不能把“没有 accept 信息”
  // 误判成死端并 reload。
  if (node.id && node.isSelfAccepting === undefined) {
    debugHmr?.(
      `[propagate update] stop propagation because not analyzed: ${colors.dim(
        node.id,
      )}`,
    )
    return false
  }

  if (node.isSelfAccepting) {
    // 只有 JS/CSS 节点会被标记 self-accepting。
    const boundary = node as EnvironmentModuleNode & {
      /** HMR 边界必须是可执行的 JS/CSS 模块。 */
      type: 'js' | 'css'
    }
    boundaries.push({
      boundary,
      acceptedVia: boundary,
      isWithinCircularImport: isNodeWithinCircularImports(node, currentChain),
    })
    return false
  }

  // 声明 acceptExports 的模块先作为部分自接受边界：它承诺“未接受的导出只要未被外部使用就安全”。而且
  // 被导入模块必须先于 importer 更新，后者重执行时才能拿到新 namespace。随后仍需逐个检查 importer
  // 实际使用的 binding；存在未接受导出时继续向上传播。
  if (node.acceptedHmrExports) {
    // 只有 JS/CSS 节点会记录 acceptedHmrExports。
    const boundary = node as EnvironmentModuleNode & {
      /** HMR 边界必须是可执行的 JS/CSS 模块。 */
      type: 'js' | 'css'
    }
    boundaries.push({
      boundary,
      acceptedVia: boundary,
      isWithinCircularImport: isNodeWithinCircularImports(node, currentChain),
    })
  } else {
    if (!node.importers.size) {
      return true
    }
  }

  for (const importer of node.importers) {
    const subChain = currentChain.concat(importer)

    if (importer.acceptedHmrDeps.has(node)) {
      // 只有 JS/CSS importer 会记录 acceptedHmrDeps。
      const boundary = importer as EnvironmentModuleNode & {
        /** 接受依赖更新的 importer 必须能作为 JS/CSS payload 执行。 */
        type: 'js' | 'css'
      }
      boundaries.push({
        boundary,
        acceptedVia: node,
        isWithinCircularImport: isNodeWithinCircularImports(importer, subChain),
      })
      continue
    }

    if (node.id && node.acceptedHmrExports && importer.importedBindings) {
      const importedBindingsFromNode = importer.importedBindings.get(node.id)
      if (
        importedBindingsFromNode &&
        areAllImportsAccepted(importedBindingsFromNode, node.acceptedHmrExports)
      ) {
        continue
      }
    }

    if (
      !currentChain.includes(importer) &&
      propagateUpdate(importer, traversedModules, boundaries, subChain)
    ) {
      return true
    }
  }
  return false
}

/**
 * 从接受边界继续递归 importer，检查它是否处在回到原变更节点的 import 环中。循环内重新导入无法恢复
 * 首次执行顺序，因此客户端即使能调用 accept，也要准备在 import 失败时整页 reload。
 *
 * @param node 接受 HMR 的传播边界。
 * @param nodeChain 从原变更节点走到该边界的链；最后一个元素是 node。
 * @param currentChain 从边界继续向 importer 反查的当前链。
 * @param traversedModules 已遍历节点，防止在图中无限递归。
 */
function isNodeWithinCircularImports(
  node: EnvironmentModuleNode,
  nodeChain: EnvironmentModuleNode[],
  currentChain: EnvironmentModuleNode[] = [node],
  traversedModules = new Set<EnvironmentModuleNode>(),
): boolean {
  // 用下图理解参数：箭头表示左侧 import 右侧。
  //
  // A -> B -> C -> ACCEPTED -> D -> E -> NODE
  //      ^--------------------------|
  //
  // ACCEPTED：接受 HMR 的边界，即 node 参数。
  // NODE：最初触发本轮 HMR 的变更节点。
  //
  // 上图会返回 true，此时各参数为：
  // `node`         : ACCEPTED
  // `nodeChain`    : [NODE, E, D, ACCEPTED]
  // `currentChain` : [ACCEPTED, C, B]
  //
  // 若从边界向 importer 反查时重新遇到 nodeChain 中节点，就证明 accept 边界位于 import 环内。

  if (traversedModules.has(node)) {
    return false
  }
  traversedModules.add(node)

  for (const importer of node.importers) {
    // 模块直接 import 自身不会改变跨模块执行顺序，可忽略。
    if (importer === node) continue

    // 当前 importer 若已在原变更链中，即闭合成循环。
    const importerIndex = nodeChain.indexOf(importer)
    if (importerIndex > -1) {
      // DEBUG 日志拼出完整闭环，帮助用户定位并拆除循环依赖。
      if (debugHmr) {
        // 对应上图：
        // `importer`                    : E
        // `currentChain` 反转后         : [B, C, ACCEPTED]
        // `nodeChain` 截取并反转后      : [D, E]
        // 合并结果                      : [E, B, C, ACCEPTED, D, E]
        const importChain = [
          importer,
          ...[...currentChain].reverse(),
          ...nodeChain.slice(importerIndex, -1).reverse(),
        ]
        debugHmr(
          colors.yellow(`circular imports detected: `) +
            importChain.map((m) => colors.dim(m.url)).join(' -> '),
        )
      }
      return true
    }

    // 当前分支未闭环，继续沿 importer 递归。
    if (!currentChain.includes(importer)) {
      const result = isNodeWithinCircularImports(
        importer,
        nodeChain,
        currentChain.concat(importer),
        traversedModules,
      )
      if (result) return result
    }
  }
  return false
}

/**
 * 通知运行端执行已脱离模块图节点的 dispose/prune。先更新其 HMR 时间戳，未来重新导入时 URL 必须变化，
 * 才会重新执行曾经清除的样式等副作用。
 */
export function handlePrunedModules(
  mods: Set<EnvironmentModuleNode>,
  { hot }: DevEnvironment,
): void {
  // 更新时间戳使未来重新导入跳过浏览器模块缓存，重新应用已经 dispose 的副作用。
  const t = monotonicDateNow()
  mods.forEach((mod) => {
    mod.lastHMRTimestamp = t
    mod.lastHMRInvalidationReceived = false
    debugHmr?.(`[dispose] ${colors.dim(mod.file)}`)
  })
  hot.send({
    type: 'prune',
    paths: [...mods].map((m) => m.url),
  })
}

/** accept/acceptExports 参数轻量词法器的有限状态。 */
const enum LexerState {
  /** 正在读取 accept 调用的首个参数。 */
  inCall,
  /** 正在读取单引号依赖字面量。 */
  inSingleQuoteString,
  /** 正在读取双引号依赖字面量。 */
  inDoubleQuoteString,
  /** 正在读取不允许插值的模板字面量。 */
  inTemplateString,
  /** 正在读取依赖字符串数组。 */
  inArray,
}

/**
 * 从 `import.meta.hot.accept()` 参数中词法提取被接受依赖。合法依赖参数只能是字符串字面量或字符串
 * 数组，无需为了这一小段语法对整个源文件运行重型 AST parser。
 *
 * @returns 没有显式依赖参数时返回 true，表示模块自接受。
 */
export function lexAcceptedHmrDeps(
  code: string,
  start: number,
  urls: Set<{
    /** 提取到的依赖字面量。 */
    url: string
    /** 字面量在源码中的起始偏移。 */
    start: number
    /** 字面量在源码中的结束偏移。 */
    end: number
  }>,
): boolean {
  let state: LexerState = LexerState.inCall
  // 状态最多只有 call/array 两层嵌套，保存一个 prevState 即可，无需通用栈。
  let prevState: LexerState = LexerState.inCall
  let currentDep: string = ''

  /** 把当前累积字面量及其源码范围写入结果集。 */
  function addDep(index: number) {
    urls.add({
      url: currentDep,
      start: index - currentDep.length - 1,
      end: index + 1,
    })
    currentDep = ''
  }

  for (let i = start; i < code.length; i++) {
    const char = code.charAt(i)
    switch (state) {
      case LexerState.inCall:
      case LexerState.inArray:
        if (char === `'`) {
          prevState = state
          state = LexerState.inSingleQuoteString
        } else if (char === `"`) {
          prevState = state
          state = LexerState.inDoubleQuoteString
        } else if (char === '`') {
          prevState = state
          state = LexerState.inTemplateString
        } else if (whitespaceRE.test(char)) {
          continue
        } else {
          if (state === LexerState.inCall) {
            if (char === `[`) {
              state = LexerState.inArray
            } else {
              // 首参既非字符串也非数组，说明它是直接 callback 或根本无参数；两者都表示自接受。
              return true // 词法扫描完成。
            }
          } else {
            if (char === `]`) {
              return false // 显式依赖数组扫描完成。
            } else if (char === ',') {
              continue
            } else {
              error(i)
            }
          }
        }
        break
      case LexerState.inSingleQuoteString:
        if (char === `'`) {
          addDep(i)
          if (prevState === LexerState.inCall) {
            // accept('foo', ...)：单依赖扫描完成。
            return false
          } else {
            state = prevState
          }
        } else {
          currentDep += char
        }
        break
      case LexerState.inDoubleQuoteString:
        if (char === `"`) {
          addDep(i)
          if (prevState === LexerState.inCall) {
            // accept('foo', ...)：单依赖扫描完成。
            return false
          } else {
            state = prevState
          }
        } else {
          currentDep += char
        }
        break
      case LexerState.inTemplateString:
        if (char === '`') {
          addDep(i)
          if (prevState === LexerState.inCall) {
            // accept(`foo`, ...)：无插值模板按普通字符串处理。
            return false
          } else {
            state = prevState
          }
        } else if (char === '$' && code.charAt(i + 1) === '{') {
          error(i)
        } else {
          currentDep += char
        }
        break
      default:
        throw new Error('unknown import.meta.hot lexer state')
    }
  }
  return false
}

/** 复用依赖字面量 lexer 提取 `acceptExports()` 的导出名。 */
export function lexAcceptedHmrExports(
  code: string,
  start: number,
  exportNames: Set<string>,
): boolean {
  const urls = new Set<{
    /** 复用依赖 lexer 暂存的导出名。 */
    url: string
    /** 导出名字面量的起始偏移。 */
    start: number
    /** 导出名字面量的结束偏移。 */
    end: number
  }>()
  lexAcceptedHmrDeps(code, start, urls)
  for (const { url } of urls) {
    exportNames.add(url)
  }
  return urls.size > 0
}

/** 把裸/虚拟 ID 包装成浏览器 `/@id/` 协议；相对和根绝对 URL 保持原样。 */
export function normalizeHmrUrl(url: string): string {
  if (url[0] !== '.' && url[0] !== '/') {
    url = wrapId(url)
  }
  return url
}

/** 抛出 accept 参数不是静态字符串/数组时的带位置解析错误。 */
function error(pos: number) {
  const err = new Error(
    `import.meta.hot.accept() can only accept string literals or an ` +
      `Array of string literals.`,
  ) as RollupError
  err.pos = pos
  throw err
}

/**
 * 读取编辑器稳定写入后的文件内容。
 * #610：Vue change 事件可能早于覆盖写入完成；首次读到空文件时短暂轮询 mtime 后重读。
 */
async function readModifiedFile(file: string): Promise<string> {
  const content = await fsp.readFile(file, 'utf-8')
  if (!content) {
    const mtime = (await fsp.stat(file)).mtimeMs

    for (let n = 0; n < 10; n++) {
      await new Promise((r) => setTimeout(r, 10))
      const newMtime = (await fsp.stat(file)).mtimeMs
      if (newMtime !== mtime) {
        break
      }
    }

    return await fsp.readFile(file, 'utf-8')
  } else {
    return content
  }
}

/** 进程内 HMR transport 暴露给服务端与运行端的两个事件方向。 */
export type ServerHotChannelApi = {
  /** 运行端向服务端发送事件的入口。 */
  innerEmitter: EventEmitter
  /** 服务端向运行端广播 payload 的出口。 */
  outsideEmitter: EventEmitter
}

/** 带进程内 EventEmitter API 的未归一 HotChannel。 */
export type ServerHotChannel = HotChannel<ServerHotChannelApi>
/** 带进程内 EventEmitter API 的服务端归一 HotChannel。 */
export type NormalizedServerHotChannel =
  NormalizedHotChannel<ServerHotChannelApi>

/**
 * 创建进程内 HMR 通道：innerEmitter 接收运行端发来的事件，outsideEmitter 暴露服务端发出的 payload。
 * transport 不经过网络，因此允许 fetchModule 跳过 fs 访问检查。
 */
export function createServerHotChannel(): ServerHotChannel {
  const innerEmitter = new EventEmitter()
  const outsideEmitter = new EventEmitter()

  return {
    skipFsCheck: true,
    /** 把服务端 payload 发到运行端订阅的 outsideEmitter。 */
    send(payload: HotPayload) {
      outsideEmitter.emit('send', payload)
    },
    /** 从运行端到服务端的事件入口注销监听器。 */
    off(event, listener: () => void) {
      innerEmitter.off(event, listener)
    },
    on: ((event: string, listener: () => unknown) => {
      innerEmitter.on(event, listener)
    }) as ServerHotChannel['on'],
    /** 移除两个方向的全部 listener，释放进程内通道。 */
    close() {
      innerEmitter.removeAllListeners()
      outsideEmitter.removeAllListeners()
    },
    /** 通知服务端进程内运行端已经连接。 */
    listen() {
      innerEmitter.emit('connection')
    },
    api: {
      innerEmitter,
      outsideEmitter,
    },
  }
}
