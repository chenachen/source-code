import path from 'node:path'
import colors from 'picocolors'
import type { FetchFunctionOptions, FetchResult } from 'vite/module-runner'
import type { FSWatcher } from '#dep-types/chokidar'
import { BaseEnvironment } from '../baseEnvironment'
import type {
  EnvironmentOptions,
  ResolvedConfig,
  ResolvedEnvironmentOptions,
} from '../config'
import { mergeConfig, monotonicDateNow } from '../utils'
import { fetchModule } from '../ssr/fetchModule'
import type { DepsOptimizer } from '../optimizer'
import { isDepOptimizationDisabled } from '../optimizer'
import {
  createDepsOptimizer,
  createExplicitDepsOptimizer,
} from '../optimizer/optimizer'
import { ERR_OUTDATED_OPTIMIZED_DEP } from '../../shared/constants'
import { cleanUrl, promiseWithResolvers } from '../../shared/utils'
import type { ViteDevServer } from '../server'
import { EnvironmentModuleGraph } from './moduleGraph'
import type { EnvironmentModuleNode } from './moduleGraph'
import type {
  HotChannel,
  NormalizedHotChannel,
  NormalizedHotChannelClient,
} from './hmr'
import { getShortName, normalizeHotChannel, updateModules } from './hmr'
import type { TransformResult } from './transformRequest'
import { transformRequest } from './transformRequest'
import type { EnvironmentPluginContainer } from './pluginContainer'
import {
  ERR_CLOSED_SERVER,
  createEnvironmentPluginContainer,
} from './pluginContainer'
import { type WebSocketServer, isWebSocketServer } from './ws'
import { warmupFiles } from './warmup'
import { buildErrorMessage } from './middlewares/error'
import { BundledDev } from './bundledDev'

/** 创建单个开发 Environment 时注入的运行时通道与可选共享组件。 */
export interface DevEnvironmentContext {
  /** 是否启用 HMR 消息处理。 */
  hot: boolean
  /** 与目标运行时通信的自定义通道；缺省使用 no-op HotChannel。 */
  transport?: HotChannel | WebSocketServer
  /** 仅为本实例额外合并的 Environment 配置覆盖项。 */
  options?: EnvironmentOptions
  /** 远端 Module Runner 获取模块时使用的序列化选项。 */
  remoteRunner?: {
    /** 是否把 Source Map 内联到返回代码。 */
    inlineSourceMap?: boolean
  }
  /** 复用外部创建的依赖优化器。 */
  depsOptimizer?: DepsOptimizer
  /** 禁止 transport 通过 fetchModule 读取模块；用于浏览器 client Environment。 @internal */
  disableFetchModule?: boolean
  /** 禁止创建依赖优化器；完整打包开发模式自行处理依赖。 @internal */
  disableDepsOptimizer?: boolean
}

/**
 * 开发态单个运行目标的核心上下文。
 *
 * 每个实例独占配置覆盖、插件容器、模块图、依赖优化器和 HotChannel，使 client、ssr 及
 * 自定义运行时可以对同一 URL 得出不同解析/转换结果，而不再依赖旧 API 的 `ssr` 布尔值。
 */
export class DevEnvironment extends BaseEnvironment {
  /** 区分开发、构建与未知 Environment 的正向判别字段。 */
  mode = 'dev' as const
  /** 只记录当前 Environment 模块及依赖关系的模块图。 */
  moduleGraph: EnvironmentModuleGraph

  /** 当前 Environment 的依赖发现/预构建协调器；禁用时不存在。 */
  depsOptimizer?: DepsOptimizer
  /** Module Runner 拉取模块时的默认选项。 @internal */
  _remoteRunnerOptions: DevEnvironmentContext['remoteRunner']
  /** transport 是否声明自己已在远端执行文件系统访问控制。 @internal */
  _skipFsCheck: boolean

  /** 返回已初始化的插件容器；在 `init()` 前访问属于生命周期错误。 */
  get pluginContainer(): EnvironmentPluginContainer<DevEnvironment> {
    if (!this._pluginContainer)
      throw new Error(
        `${this.name} environment.pluginContainer called before initialized`,
      )
    return this._pluginContainer
  }
  /** `init()` 创建的 Environment 专属插件容器。 @internal */
  _pluginContainer: EnvironmentPluginContainer<DevEnvironment> | undefined

  /** 是否已进入关闭阶段。 @internal */
  _closing: boolean = false
  /** URL 对应的在途 transform 请求与中止函数。 @internal */
  _pendingRequests: Map<
    string,
    {
      /** 当前 URL 正在执行的转换任务，供并发请求复用。 */
      request: Promise<TransformResult | null>
      /** 任务开始的单调时间，用于判断它是否早于模块失效。 */
      timestamp: number
      /** 当前任务过期时释放 URL 槽位、允许新任务进入的函数。 */
      abort: () => void
    }
  >
  /** 判断首轮静态 import 爬取何时稳定的协调器。 @internal */
  _crawlEndFinder: CrawlEndFinder

  /**
   * 当前 Environment 的标准化 HotChannel。未提供或禁用时返回什么也不做的 no-op 通道，
   * 调用方因此无需为 HMR 开关增加空值分支。
   *
   * @example
   * environment.hot.send({ type: 'full-reload' })
   */
  hot: NormalizedHotChannel

  /** 完整打包开发模式的增量 bundle 管理器。 */
  public bundledDev?: BundledDev

  /**
   * 合成实例配置，建立模块图、运行时通信和依赖优化器；插件容器留给 `init()` 异步创建。
   */
  constructor(
    name: string,
    config: ResolvedConfig,
    context: DevEnvironmentContext,
  ) {
    let options = config.environments[name]
    if (!options) {
      throw new Error(`Environment "${name}" is not defined in the config.`)
    }
    if (context.options) {
      // 工厂可为单次实例追加覆盖，不修改 config.environments 中共享的已解析对象。
      options = mergeConfig(
        options,
        context.options,
      ) as ResolvedEnvironmentOptions
    }
    super(name, config, options)
    if (
      options.isBundled ||
      (name === 'client' && config.experimental.bundledDev)
    ) {
      // 完整打包开发模式自己处理依赖，不能再并行启动 optimizeDeps。
      context.disableDepsOptimizer = true
      this.bundledDev = new BundledDev(this)
    }

    this._pendingRequests = new Map()

    // 模块图按 Environment 隔离；URL 首次入图时由本实例插件管线解析。
    this.moduleGraph = new EnvironmentModuleGraph(name, (url: string) =>
      this.pluginContainer!.resolveId(url, undefined),
    )

    this._crawlEndFinder = setupOnCrawlEnd()

    this._remoteRunnerOptions = context.remoteRunner ?? {}
    // 只有自定义 transport 显式声明 skipFsCheck 才跳过本地校验；WebSocketServer 不能借此
    // 绕过 `/@fs/` 访问边界（#22159、#22163）。
    this._skipFsCheck = !!(
      context.transport &&
      !(isWebSocketServer in context.transport) &&
      context.transport.skipFsCheck
    )

    // 原生 WebSocketServer 已符合标准接口；普通 transport 需包装为可开关的 HotChannel。
    this.hot = context.transport
      ? isWebSocketServer in context.transport
        ? context.transport
        : normalizeHotChannel(context.transport, context.hot)
      : normalizeHotChannel({}, context.hot)

    // Module Runner 通过同一双向通道请求转换结果与 builtin 列表。
    this.hot.setInvokeHandler({
      fetchModule: (id, importer, options) => {
        if (context.disableFetchModule) {
          throw new Error('fetchModule is disabled in this environment')
        }
        return this.fetchModule(id, importer, options)
      },
      getBuiltins: async () => {
        // RegExp 不能直接跨结构化消息边界，拆成 source/flags 后由运行时重建（#21029）。
        return this.config.resolve.builtins.map((builtin) =>
          typeof builtin === 'string'
            ? { type: 'string', value: builtin }
            : { type: 'RegExp', source: builtin.source, flags: builtin.flags },
        )
      },
    })

    // 目标运行时执行 import.meta.hot.invalidate() 时，回传到所属模块图继续传播更新。
    this.hot.on(
      'vite:invalidate',
      ({ path, message, firstInvalidatedBy }, client) => {
        this.invalidateModule(
          {
            path,
            message,
            firstInvalidatedBy,
          },
          client,
        )
      },
    )

    // noDiscovery 仍需显式依赖优化器；完全禁用时不创建。也允许框架注入共享/定制实例。
    if (!context.disableDepsOptimizer) {
      const { optimizeDeps } = this.config
      if (context.depsOptimizer) {
        this.depsOptimizer = context.depsOptimizer
      } else if (isDepOptimizationDisabled(optimizeDeps)) {
        this.depsOptimizer = undefined
      } else {
        this.depsOptimizer = (
          optimizeDeps.noDiscovery
            ? createExplicitDepsOptimizer
            : createDepsOptimizer
        )(this)
      }
    }
  }

  /**
   * 幂等创建本 Environment 的插件容器。
   *
   * 重启时调用顺序是“新实例 init → 旧实例 close → 新实例 listen”。`previousInstance`
   * 允许自定义子类迁移状态，但使用前必须确认旧实例来自同一类或同一工厂。
   */
  async init(options?: {
    /** 顶层 Server 创建的共享文件监听器。 */
    watcher?: FSWatcher
    /** 重启前同名 Environment 的实例。 */
    previousInstance?: DevEnvironment
  }): Promise<void> {
    if (this._initiated) {
      return
    }
    this._initiated = true
    this._pluginContainer = await createEnvironmentPluginContainer(
      this,
      this.config.plugins,
      options?.watcher,
    )
  }

  /**
   * 把配置入口解析为受信任的绝对模块路径，供 fs 安全检查放行。默认 index.html 缺失可忽略，
   * 用户显式 input 的解析错误必须抛出。 @internal
   */
  async _registerInputsAsSafeModules(): Promise<void> {
    const input = this.config.input
    const entries =
      input == null
        ? ['index.html']
        : typeof input === 'string'
          ? [input]
          : Array.isArray(input)
            ? input
            : Object.values(input)

    /** 解析全部入口，并把落到磁盘的绝对路径加入顶层安全模块集合。 */
    const resolveEntries = async () => {
      const resolvedEntries = await Promise.all(
        entries.map((entry) =>
          this.pluginContainer.resolveId(entry, undefined, {
            isEntry: true,
            // 依赖扫描可能触发首次 buildStart；普通解析会等待扫描结束，而扫描又在等待
            // buildStart，形成环。标记 scan 后走扫描专用解析路径，打破死锁。
            scan: true,
          }),
        ),
      )
      for (const resolved of resolvedEntries) {
        if (resolved && !resolved.external) {
          const resolvedId = cleanUrl(resolved.id)
          if (path.isAbsolute(resolvedId)) {
            this.getTopLevelConfig().safeModulePaths.add(resolvedId)
          }
        }
      }
    }

    if (input == null) {
      await resolveEntries().catch(() => {})
    } else {
      await resolveEntries()
    }
  }

  /** 启动 HotChannel、bundle/依赖优化器，并按配置预热文件。重启时发生在旧实例关闭之后。 */
  async listen(server: ViteDevServer): Promise<void> {
    this.hot.listen()
    await Promise.all([this.bundledDev?.listen(), this.depsOptimizer?.init()])
    warmupFiles(server, this)
  }

  /**
   * 供 Module Runner 获取模块信息：内部执行 `transformRequest`，再包装为 Runner transport
   * 协议。它是运行时通信入口，不建议业务代码手工调用。
   */
  fetchModule(
    id: string,
    importer?: string,
    options?: FetchFunctionOptions,
  ): Promise<FetchResult> {
    return fetchModule(this, id, importer, {
      ...this._remoteRunnerOptions,
      ...options,
    })
  }

  /** 对单个模块触发当前 Environment 的 HMR 更新传播。 */
  async reloadModule(module: EnvironmentModuleNode): Promise<void> {
    if (this.config.server.hmr !== false && module.file) {
      updateModules(this, module.file, [module], monotonicDateNow())
    }
  }

  /** 经本 Environment 的 resolve/load/transform 插件管线处理 URL，并更新模块图缓存。 */
  transformRequest(url: string): Promise<TransformResult | null> {
    return transformRequest(this, url, { skipFsCheck: this._skipFsCheck })
  }

  /**
   * 低优先级预转换 URL。预热允许跳过重复 fs 检查；预期的优化器过期/服务器关闭错误静默
   * 放弃，其他错误只记录日志，不能形成未处理 Promise rejection。
   */
  async warmupRequest(url: string): Promise<void> {
    if (this.bundledDev) {
      // 完整打包模式已经由 bundle 覆盖模块，不需要逐 URL 预热。
      return
    }

    try {
      await transformRequest(this, url, { skipFsCheck: true })
    } catch (e) {
      if (
        e?.code === ERR_OUTDATED_OPTIMIZED_DEP ||
        e?.code === ERR_CLOSED_SERVER
      ) {
        // 优化结果换代或服务器关闭时，这个投机请求自然失效。
        return
      }
      // 预热不影响真实请求；记录意外错误，但不向未等待它的调用方泄漏 rejection。
      this.logger.error(
        buildErrorMessage(e, [`Pre-transform error: ${e.message}`], false),
        {
          error: e,
          timestamp: true,
        },
      )
    }
  }

  /** 处理运行时发回的 `import.meta.hot.invalidate()`，从当前模块的 importers 继续传播。 */
  protected invalidateModule(
    m: {
      /** 发起 invalidate 的模块 URL。 */
      path: string
      /** 客户端提供的可选诊断信息。 */
      message?: string
      /** 整条失效传播链最初的模块 URL。 */
      firstInvalidatedBy: string
    },
    _client: NormalizedHotChannelClient,
  ): void {
    if (this.bundledDev) {
      // 完整打包模式在客户端自行处理 invalidate，无需服务器遍历模块图。
      return
    }

    const mod = this.moduleGraph.urlToModuleMap.get(m.path)
    if (
      mod &&
      mod.isSelfAccepting &&
      mod.lastHMRTimestamp > 0 &&
      !mod.lastHMRInvalidationReceived
    ) {
      mod.lastHMRInvalidationReceived = true
      this.logger.info(
        colors.yellow(`hmr invalidate `) +
          colors.dim(m.path) +
          (m.message ? ` ${m.message}` : ''),
        { timestamp: true },
      )
      const file = getShortName(mod.file!, this.config.root)
      updateModules(
        this,
        file,
        // 自引用不能成为自己的更新边界，否则循环依赖可能无限传播。
        [...mod.importers].filter((imp) => imp !== mod),
        mod.lastHMRTimestamp,
        m.firstInvalidatedBy,
      )
    }
  }

  /**
   * 停止接收新工作，取消首轮爬取等待，并行关闭插件/bundle、优化器、非 WS HotChannel，
   * 同时等待所有在途 transform settle。单项失败不能跳过其他资源清理。
   */
  async close(): Promise<void> {
    this._closing = true

    this._crawlEndFinder.cancel()
    await Promise.allSettled([
      this.bundledDev ? this.bundledDev.close() : this.pluginContainer.close(),
      this.depsOptimizer?.close(),
      // WebSocketServer 被多个 Environment/顶层 Server 共享，Environment 关闭时不能销毁；
      // 自定义 HotChannel 则由本实例独占。
      isWebSocketServer in this.hot ? Promise.resolve() : this.hot.close(),
      (async () => {
        while (this._pendingRequests.size > 0) {
          await Promise.allSettled(
            [...this._pendingRequests.values()].map(
              (pending) => pending.request,
            ),
          )
        }
      })(),
    ])
  }

  /**
   * 等待首次 `transformRequest` 发现的静态 import 全部处理完成。从 load/transform hook 内
   * 调用时必须传当前 id，把调用者自身从等待集合排除，否则会形成自己等待自己的死锁。
   * 首轮模块图已稳定后调用会立即完成。
   *
   * @experimental
   */
  waitForRequestsIdle(ignoredId?: string): Promise<void> {
    return this._crawlEndFinder.waitForRequestsIdle(ignoredId)
  }

  /** 注册一个首轮静态 import 的后台处理任务。 @internal */
  _registerRequestProcessing(id: string, done: () => Promise<unknown>): void {
    this._crawlEndFinder.registerRequestProcessing(id, done)
  }
}

/** 在途集合清空后仍等待一小段静默期，吸收刚发现的后续静态 import。 */
const callCrawlEndIfIdleAfterMs = 50

/** 首轮静态 import 爬取完成检测器。 */
interface CrawlEndFinder {
  /** 登记一个首轮爬取发现的模块及其完成任务。 */
  registerRequestProcessing: (id: string, done: () => Promise<any>) => void
  /** 等待首轮爬取稳定，可排除正在调用该方法的 hook 模块。 */
  waitForRequestsIdle: (ignoredId?: string) => Promise<void>
  /** 取消关闭后尚未触发的稳定判定。 */
  cancel: () => void
}

/**
 * 创建“一次性稳定”检测器：每个 id 只注册一次，全部完成且连续 50ms 没有新任务时 resolve。
 * close 时只取消后续 resolve 检查，不再触发生命周期回调。
 */
function setupOnCrawlEnd(): CrawlEndFinder {
  const registeredIds = new Set<string>()
  const seenIds = new Set<string>()
  const onCrawlEndPromiseWithResolvers = promiseWithResolvers<void>()

  let timeoutHandle: NodeJS.Timeout | undefined

  let cancelled = false
  /** 阻止关闭后的延时回调把爬取错误地标记为正常完成。 */
  function cancel() {
    cancelled = true
  }

  /** 首次看到 id 时跟踪其完成 Promise；重复请求不延长首轮爬取。 */
  function registerRequestProcessing(
    id: string,
    done: () => Promise<any>,
  ): void {
    if (!seenIds.has(id)) {
      seenIds.add(id)
      registeredIds.add(id)
      done()
        .catch(() => {})
        .finally(() => markIdAsDone(id))
    }
  }

  /** 返回共享完成 Promise，并可先把当前 hook 的 id 从等待集合移除。 */
  function waitForRequestsIdle(ignoredId?: string): Promise<void> {
    if (ignoredId) {
      seenIds.add(ignoredId)
      markIdAsDone(ignoredId)
    } else {
      checkIfCrawlEndAfterTimeout()
    }
    return onCrawlEndPromiseWithResolvers.promise
  }

  /** 移除已完成 id，并尝试启动静默期计时。 */
  function markIdAsDone(id: string): void {
    registeredIds.delete(id)
    checkIfCrawlEndAfterTimeout()
  }

  /** 仅在没有在途 id 时重新安排静默期；新任务会让回调再次检查并退出。 */
  function checkIfCrawlEndAfterTimeout() {
    if (cancelled || registeredIds.size > 0) return

    if (timeoutHandle) clearTimeout(timeoutHandle)
    timeoutHandle = setTimeout(
      callOnCrawlEndWhenIdle,
      callCrawlEndIfIdleAfterMs,
    )
  }
  /** 静默期结束仍为空闲时，永久完成共享 Promise。 */
  function callOnCrawlEndWhenIdle() {
    if (cancelled || registeredIds.size > 0) return
    onCrawlEndPromiseWithResolvers.resolve()
  }

  return {
    registerRequestProcessing,
    waitForRequestsIdle,
    cancel,
  }
}
