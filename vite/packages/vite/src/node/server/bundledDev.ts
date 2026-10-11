import { setTimeout } from 'node:timers/promises'
import {
  type BindingClientHmrUpdate,
  type DevEngine,
  dev,
} from 'rolldown/experimental'
import type { RolldownOutput } from 'rolldown'
import colors from 'picocolors'
import getEtag from 'etag'
import { ChunkMetadataMap, resolveRolldownOptions } from '../build'
import { BUNDLED_DEV_CLIENT_FILENAME } from '../constants'
import { getHmrImplementation } from '../plugins/clientInjections'
import { createDebugger, formatAndTruncateFileList } from '../utils'
import type { DevEnvironment } from './environment'
import { type NormalizedHotChannelClient, debugHmr, getShortName } from './hmr'
import { prepareError } from './middlewares/error'

/** full bundle 开发模式的独立调试命名空间。 */
const debug = createDebugger('vite:full-bundle-mode')

/** Rolldown dev engine 针对单个客户端生成的 HMR 结果。 */
type HmrOutput = BindingClientHmrUpdate['update']

/** 存在内存中的构建文件；etag 可延迟到首次读取时计算。 */
type MemoryFile = {
  /** 可直接返回的文本或二进制文件内容。 */
  source: string | Uint8Array
  /** 对已物化内容计算出的可选 HTTP ETag。 */
  etag?: string
}

/**
 * full bundle 输出的惰性内存文件表。
 *
 * 构建回调可先保存生成函数，只有浏览器真正请求文件时才提取代码并计算 ETag；
 * 首次读取后会用物化结果替换函数，避免重复计算。
 */
export class MemoryFiles {
  /** 文件名到物化结果或一次性惰性生成器的映射。 */
  private files = new Map<string, MemoryFile | (() => MemoryFile)>()

  /** 返回当前登记的内存文件数量，不会触发惰性物化。 */
  get size(): number {
    return this.files.size
  }

  /** 读取文件；首次命中生成器时物化并用结果替换生成器。 */
  get(file: string): MemoryFile | undefined {
    const result = this.files.get(file)
    if (result === undefined) {
      return undefined
    }
    if (typeof result === 'function') {
      const content = result()
      this.files.set(file, content)
      return content
    }
    return result
  }

  /** 登记已物化文件或按需生成函数，同名文件直接覆盖。 */
  set(file: string, content: MemoryFile | (() => MemoryFile)): void {
    this.files.set(file, content)
  }

  /** 判断指定文件名是否已经存在于输出表。 */
  has(file: string): boolean {
    return this.files.has(file)
  }

  /** 清除全部增量构建输出和惰性生成器。 */
  clear(): void {
    this.files.clear()
  }
}

/**
 * 将 Rolldown experimental dev engine 接入 Vite HMR 协议的 full bundle 控制器。
 *
 * 与按请求转换不同，它维护完整增量构建、每个浏览器客户端的模块交付状态、内存
 * 输出和按需 chunk。文件变化先由 Rolldown 判断 Noop/HMR/FullReload，再通过
 * Vite hot channel 发给正确客户端；页面刷新必须等最新输出成功生成，避免刷新后
 * 仍拿到旧 bundle 或短暂闪现错误 overlay。
 */
export class BundledDev {
  /** Rolldown dev engine 在 listen 中异步创建，访问前必须完成初始化。 */
  private _devEngine!: DevEngine
  /** 注入内存文件表的 bundled-dev 客户端运行时代码。 */
  private viteRuntime?: string
  /** 区分首轮构建与后续 stale/HMR 恢复逻辑。 */
  private initialBuildCompleted = false
  /** 标记控制器已经关闭，阻止异步首轮构建回调继续发送消息。 */
  private _closed = false
  /** hot channel 连接对象与稳定 clientId 的双向索引。 */
  private clients = new Clients()
  /** 合并短时间内多个全量刷新请求，避免一次变更导致连续 reload。 */
  private debouncedFullReload = debounce(20, () => {
    this.environment.hot.send({ type: 'full-reload', path: '*' })
    this.environment.logger.info(colors.green(`page reload`), {
      timestamp: true,
    })
  })

  /** HMR 已判定需刷新，但正在等待 onOutput 提供可用的最新产物。 */
  private fullReloadPending = false

  /** 只需要刷新的客户端集合；与面向所有客户端的 fullReloadPending 分开维护。 */
  private reloadNeededClientIds = new Set<string>()
  /** 合并指定客户端的刷新请求，并仅在最新构建成功后发送。 */
  private debouncedReloadNeededFlush = debounce(20, () => {
    if (this.lastBuildError || this.reloadNeededClientIds.size === 0) return
    for (const clientId of this.reloadNeededClientIds) {
      this.clients.get(clientId)?.send({ type: 'full-reload', path: '*' })
    }
    this.reloadNeededClientIds.clear()
    this.environment.logger.info(colors.green(`page reload`), {
      timestamp: true,
    })
  })

  /** 最近一次输出构建错误，用于阻止刷新并向新连接客户端重放 overlay。 */
  private lastBuildError: Error | null = null

  /** 由中间件按 URL 直接提供的当前增量输出。 */
  memoryFiles: MemoryFiles = new MemoryFiles()

  /** full bundle 当前只支持 client 环境，服务端环境会在构造期明确拒绝。 */
  constructor(private environment: DevEnvironment) {
    if (environment.name !== 'client') {
      throw new Error(
        'currently full bundle mode is only available for client environment',
      )
    }
  }

  /** 获取已初始化 engine，防止生命周期调用顺序错误被伪装成 undefined 异常。 */
  private get devEngine(): DevEngine {
    if (!this._devEngine) {
      throw new Error(`dev engine was not yet initialized`)
    }
    return this._devEngine
  }

  /** 已生成但尚未在 HTTP finish 后登记发送完成的 HMR/懒构建 payload 文件名。 */
  private pendingPayloadFilenames = new Set<string>()

  /** 内存表除客户端 runtime 外是否已经包含真正的应用构建输出。 */
  get hasBuildOutput(): boolean {
    return (
      this.memoryFiles.size > 1 ||
      (this.memoryFiles.size === 1 &&
        !this.memoryFiles.has(BUNDLED_DEV_CLIENT_FILENAME))
    )
  }

  /**
   * 初始化 Rolldown dev engine、注册 HMR 通道事件，并在后台启动首轮构建。
   *
   * 返回表示监听链路已经装配完成，不等待整个首轮 bundle；首轮完成后仅在没有
   * 构建错误时发送 fallback reload，让先到达的浏览器切换到真实输出。
   */
  async listen(): Promise<void> {
    this._closed = false
    debug?.('INITIAL: setup bundle options')
    const rolldownOptions = await this.getRolldownOptions()
    // dev engine 当前只支持一组输出选项，多输出构建无法保持单一内存 URL 映射。
    if (
      Array.isArray(rolldownOptions.output) &&
      rolldownOptions.output.length > 1
    ) {
      throw new Error('multiple output options are not supported in dev mode')
    }
    const outputOptions = (
      Array.isArray(rolldownOptions.output)
        ? rolldownOptions.output[0]
        : rolldownOptions.output
    )!

    this.environment.hot.on(
      'vite:client-connected',
      async (payload, client) => {
        this.clients.setupIfNeeded(client, payload.clientId)
        this.devEngine.registerClient(payload.clientId)
      },
    )
    this.environment.hot.on('vite:client:connect', (_payload, client) => {
      // 新页面若连接于构建失败之后，也必须看到缓存错误，而不是停留在空白状态。
      if (this.lastBuildError) {
        debug?.('REPLAY: replaying last build error to newly connected client')

        client.send({
          type: 'error',
          err: prepareError(this.lastBuildError),
        })
      }
    })
    this.environment.hot.on('vite:client:disconnect', (_payload, client) => {
      const clientId = this.clients.delete(client)
      if (clientId) {
        this.devEngine.removeClient(clientId)
        this.reloadNeededClientIds.delete(clientId)
      }
    })
    this.environment.hot.on(
      'vite:bundled-dev:reload-needed',
      (payload, client) => {
        const clientId = this.clients.getId(client)
        if (!clientId) return
        debug?.(
          `TRIGGER: client ${clientId} requested a page reload (${payload.reason})`,
        )
        this.environment.logger.info(
          colors.green(`bundling for page reload `) +
            colors.dim(payload.reason),
          { clear: true, timestamp: true },
        )
        this.reloadNeededClientIds.add(clientId)
        this.ensureOutputAndFlushReloadNeeded()
      },
    )

    this._devEngine = await dev(rolldownOptions, outputOptions, {
      /** 按 clientId 分派增量结果；错误广播给已登记客户端，等待刷新集合在成功更新后重新生成输出。 */
      onHmrUpdates: (result) => {
        if (result instanceof Error) {
          this.environment.logger.error(
            colors.red(`✘ Build error: ${result.message}`),
            {
              error: result,
            },
          )
          // Rolldown 暂未提供错误所属 clientId，只能向所有已连接客户端广播。
          for (const client of this.clients.getAll()) {
            client.send({
              type: 'error',
              err: prepareError(result),
            })
          }
          return
        }
        const { updates, changedFiles } = result
        if (changedFiles.length === 0) {
          return
        }
        if (updates.every((update) => update.update.type === 'Noop')) {
          debug?.(`ignored file change for ${changedFiles.join(', ')}`)
          return
        }
        for (const { clientId, update } of updates) {
          const client = this.clients.get(clientId)
          if (client) {
            this.handleHmrOutput(client, changedFiles, update)
          }
        }
        // 某次编辑已请求刷新但重建失败，页面会停在错误 overlay 后等待。修复错误后
        // HMR 构建成功时必须主动补生成最新输出，否则等待集合永远不会收到 reload。
        if (this.reloadNeededClientIds.size) {
          this.ensureOutputAndFlushReloadNeeded()
        }
      },
      /** 保存构建错误或最新内存输出；仅成功输出允许兑现待发送的全局/指定客户端刷新。 */
      onOutput: (result) => {
        if (result instanceof Error) {
          this.environment.logger.error(
            colors.red(`✘ Build error: ${result.message}`),
            {
              error: result,
            },
          )
          this.lastBuildError = result
          this.fullReloadPending = false
          this.environment.hot.send({
            type: 'error',
            err: prepareError(result),
          })
          return
        }
        this.lastBuildError = null

        this.storeOutputFiles(result.output)

        // 只有新输出成功进入内存表后才兑现 HMR 的刷新请求，避免页面重新加载旧文件。
        if (this.fullReloadPending) {
          this.fullReloadPending = false
          this.debouncedFullReload()
        }
        if (this.reloadNeededClientIds.size) {
          this.debouncedReloadNeededFlush()
        }
      },
      /** 将增量新增资源合并进内存文件表，保留未变化文件。 */
      onAdditionalAssets: (result) => {
        this.storeOutputFiles(result.output)
      },
      watch: {
        skipWrite: true,
      },
    })
    debug?.('INITIAL: setup dev engine')
    this.devEngine.run().then(
      () => {
        debug?.('INITIAL: run done')
      },
      (e) => {
        debug?.('INITIAL: run error', e)
      },
    )
    this.viteRuntime = await getHmrImplementation(
      this.environment.getTopLevelConfig(),
    )
    this.storeOutputFiles([])
    this.waitForInitialBuildFinish().then(() => {
      if (this._closed) return
      debug?.('INITIAL: build done')
      this.initialBuildCompleted = true
      if (!this.lastBuildError) {
        this.environment.hot.send({
          type: 'full-reload',
          path: '*',
          ifFallback: true,
        })
      }
    })
  }

  /**
   * 等待首轮构建真正产生应用输出或进入错误状态。
   *
   * ensureCurrentBuildFinish 可能完成一次没有可服务输出的阶段，因此循环检查 bundle
   * state；入口、ensureCurrentBuildFinish 与重试等待后检查 close，外层发送前再检查 _closed。
   */
  private async waitForInitialBuildFinish(): Promise<void> {
    if (this._closed) return
    await this.devEngine.ensureCurrentBuildFinish()
    if (this._closed) return

    let state = await this.devEngine.getBundleState()
    while (!this.hasBuildOutput && !state.lastBuildErrored) {
      await setTimeout(10)
      if (this._closed) return
      await this.devEngine.ensureCurrentBuildFinish()
      if (this._closed) return
      state = await this.devEngine.getBundleState()
    }
  }

  /** 确保最新 bundle 已物化，再批量刷新等待中的指定客户端。 */
  private ensureOutputAndFlushReloadNeeded(): void {
    this.devEngine.ensureLatestBuildOutput().then(
      () => this.debouncedReloadNeededFlush(),
      () => {},
    )
  }

  /**
   * 在页面访问时检查 bundle 状态，必要时触发完整输出再刷新。
   *
   * HMR 阶段自身失败时强制 full build，提供恢复通道；普通 stale 输出仅在首轮完成
   * 且当前无构建错误时再生。返回值告诉调用方本次访问是否触发了再构建。
   */
  async triggerBundleRegenerationIfStale(): Promise<boolean> {
    const bundleState = await this.devEngine.getBundleState()

    // HMR 生成器本身失败时，普通增量路径可能无法自愈；一次 full build 是兜底恢复通道。
    if (
      this.initialBuildCompleted &&
      bundleState.lastBuildErrored &&
      bundleState.lastErrorStage === 'Hmr'
    ) {
      debug?.(`TRIGGER: access after HMR-stage failure, forcing full rebuild`)

      this.devEngine.triggerFullBuild()
      this.devEngine.ensureLatestBuildOutput().then(() => {
        this.debouncedFullReload()
      })
      return true
    }

    const shouldTrigger =
      bundleState.hasStaleOutput &&
      !bundleState.lastBuildErrored &&
      this.initialBuildCompleted
    if (shouldTrigger) {
      this.devEngine.ensureLatestBuildOutput().then(() => {
        this.debouncedFullReload()
      })
      debug?.(`TRIGGER: access to stale bundle, triggered bundle re-generation`)
    }
    return shouldTrigger
  }

  /**
   * 为指定客户端按需编译入口，并登记待交付 payload。
   * 缺少 moduleId/clientId 时不触发编译，让中间件继续正常的 404/后续处理。
   */
  async triggerLazyBundling(
    moduleId: string | null,
    clientId: string | null,
  ): Promise<
    | {
        /** Rolldown 为该客户端生成的惰性入口代码。 */
        code: string
        /** lazy 中间件 finish 回调用于登记交付的唯一文件名。 */
        filename: string
      }
    | undefined
  > {
    if (!moduleId || !clientId) {
      return
    }
    debug?.(
      `TRIGGER-LAZY: trigger lazy bundling for module ${moduleId} for client ${clientId}`,
    )
    const result = await this.devEngine.compileEntry(moduleId, clientId)
    this.pendingPayloadFilenames.add(result.filename)
    return result
  }

  /**
   * serving 中间件在 payload 响应完成后调用。
   *
   * HTTP finish 后通知 DevEngine 登记 payload 发送完成，推进其按客户端维护的 ship map；
   * finish 表示内容交给操作系统发送，并非浏览器的接收或执行确认。
   *
   * 注意：payload 文件名在所有客户端之间全局唯一。
   */
  markPayloadDelivered(filename: string): void {
    if (this.pendingPayloadFilenames.delete(filename)) {
      this.devEngine.notifyPayloadDelivered(filename)
    }
  }

  /** 标记关闭、清空内存产物，engine 关闭成功后复位首轮标记；不取消本类的 debounce timer。 */
  async close(): Promise<void> {
    this._closed = true
    this.memoryFiles.clear()
    await this._devEngine?.close()
    this.initialBuildCompleted = false
  }

  /**
   * 把 Rolldown 输出与 Vite runtime 写入惰性内存文件表。
   *
   * 增量构建会复用未变化文件，因此这里不能先 clear；新同名输出覆盖旧值。runtime
   * 立即计算弱 ETag，构建文件则延迟到首次 HTTP 读取时物化。
   */
  private storeOutputFiles(output: RolldownOutput['output'][number][]): void {
    if (this.viteRuntime) {
      this.memoryFiles.set(BUNDLED_DEV_CLIENT_FILENAME, {
        source: this.viteRuntime,
        etag: getEtag(Buffer.from(this.viteRuntime), { weak: true }),
      })
    }
    for (const outputFile of output) {
      this.memoryFiles.set(outputFile.fileName, () => {
        const source =
          outputFile.type === 'chunk' ? outputFile.code : outputFile.source
        return {
          source,
          etag: getEtag(Buffer.from(source), { weak: true }),
        }
      })
    }
  }

  /**
   * 从普通 build 配置派生 full bundle dev engine 所需的可预测输出设置。
   *
   * 默认启用 lazy devMode、跳过公共 runtime 注入，并固定文件命名、关闭压缩、开启
   * sourcemap，使客户端能稳定按 URL 请求增量 payload。
   */
  private async getRolldownOptions() {
    const chunkMetadataMap = new ChunkMetadataMap()
    const rolldownOptions = resolveRolldownOptions(
      this.environment,
      chunkMetadataMap,
    )
    rolldownOptions.experimental ??= {}
    rolldownOptions.experimental.devMode = {
      lazy: true,
      ...(typeof rolldownOptions.experimental.devMode === 'object'
        ? rolldownOptions.experimental.devMode
        : {}),
      implement: '',
      skipCommonRuntimeInjection: true,
    }

    // Rolldown inlineConst 在该模式仍有已知正确性问题，开发模式显式关闭：
    // https://github.com/vitejs/vite/issues/21843
    rolldownOptions.optimization ??= {}
    rolldownOptions.optimization.inlineConst = false

    // 固定输出路径后无需额外 renderChunk 改名，内存中间件和 HMR 消息可直接共享文件名。
    if (Array.isArray(rolldownOptions.output)) {
      for (const output of rolldownOptions.output) {
        output.entryFileNames = 'assets/[name].js'
        output.chunkFileNames = 'assets/[name]-[hash].js'
        output.assetFileNames = 'assets/[name]-[hash][extname]'
        output.minify = false
        output.sourcemap = true
      }
    } else {
      rolldownOptions.output ??= {}
      rolldownOptions.output.entryFileNames = 'assets/[name].js'
      rolldownOptions.output.chunkFileNames = 'assets/[name]-[hash].js'
      rolldownOptions.output.assetFileNames = 'assets/[name]-[hash][extname]'
      rolldownOptions.output.minify = false
      rolldownOptions.output.sourcemap = true
    }

    return rolldownOptions
  }

  /** 将 Rolldown 的单客户端 HMR 结果翻译为 Vite 日志、内存 payload 与通道消息。 */
  private handleHmrOutput(
    client: NormalizedHotChannelClient,
    files: string[],
    hmrOutput: HmrOutput,
  ) {
    if (hmrOutput.type === 'Noop') return

    const shortFile = files
      .map((file) => getShortName(file, this.environment.config.root))
      .join(', ')
    if (hmrOutput.type === 'FullReload') {
      const reason = hmrOutput.reason
        ? colors.dim(` (${hmrOutput.reason})`)
        : ''
      this.environment.logger.info(
        colors.green(`trigger page reload `) + colors.dim(shortFile) + reason,
        { clear: true, timestamp: true },
      )
      // invalidate 已完全在客户端处理，因此服务端 FullReload 都来自文件变化。等到
      // onOutput 成功后再刷新，可避免构建失败时页面先 reload、随后闪现错误 overlay。
      this.fullReloadPending = true
      return
    }

    debug?.(`handle hmr output for ${shortFile}`, {
      ...hmrOutput,
      code: typeof hmrOutput.code === 'string' ? '[code]' : hmrOutput.code,
    })

    this.pendingPayloadFilenames.add(hmrOutput.filename)
    this.memoryFiles.set(hmrOutput.filename, {
      // 强制 HMR patch 含 ESM 语法，令跨源 classic script 无法执行，缓解类似
      // GHSA-4v9v-hfq4-rm2v 的本地开发服务器/XSSI 攻击。也可用 CORP 响应头达到
      // 类似效果，但 Sec-Fetch-* 对非 potentially-trustworthy 来源并不总会发送。
      // https://github.com/webpack/webpack-dev-server/security/advisories/GHSA-4v9v-hfq4-rm2v
      // https://green.sapphi.red/blog/local-server-security-best-practices#_2-using-xssi-and-modifying-the-prototype
      // https://green.sapphi.red/blog/local-server-security-best-practices#properly-check-the-request-origin
      source: hmrOutput.code + '\n; export {}',
    })
    if (hmrOutput.sourcemapFilename && hmrOutput.sourcemap) {
      this.memoryFiles.set(hmrOutput.sourcemapFilename, {
        source: hmrOutput.sourcemap,
      })
    }
    client.send({
      type: 'bundled-dev-update',
      changedIds: hmrOutput.changedIds,
      url: hmrOutput.filename,
      seq: hmrOutput.seq,
    })
    const { formatted, truncated } = formatAndTruncateFileList(
      hmrOutput.changedIds,
    )
    if (truncated) debugHmr?.(`hmr update ${hmrOutput.changedIds.join(', ')}`)
    this.environment.logger.info(
      colors.green(`hmr update `) + colors.dim(formatted),
      {
        clear: true,
        timestamp: true,
      },
    )
  }
}

/** HMR 连接对象与 Rolldown clientId 的双向映射，支持消息路由和断开清理。 */
class Clients {
  /** 从 hot channel 客户端对象查找其稳定 Rolldown clientId。 */
  private clientToId = new Map<NormalizedHotChannelClient, string>()
  /** 从 Rolldown clientId 查找需要接收 HMR 消息的客户端对象。 */
  private idToClient = new Map<string, NormalizedHotChannelClient>()

  /** 登记客户端；同一连接若宣告不同 ID，拒绝继续以免 HMR 状态串线。 */
  setupIfNeeded(client: NormalizedHotChannelClient, clientId: string) {
    const id = this.clientToId.get(client)
    if (id && id !== clientId) {
      throw new Error(
        'client ID conflict detected. Please restart the dev server.',
      )
    }
    this.clientToId.set(client, clientId)
    this.idToClient.set(clientId, client)
  }

  /** 按稳定 clientId 返回当前连接。 */
  get(id: string): NormalizedHotChannelClient | undefined {
    return this.idToClient.get(id)
  }

  /** 返回连接对象已经登记的稳定 clientId。 */
  getId(client: NormalizedHotChannelClient): string | undefined {
    return this.clientToId.get(client)
  }

  /** 返回当前登记的全部客户端，用于广播构建错误。 */
  getAll(): NormalizedHotChannelClient[] {
    return Array.from(this.idToClient.values())
  }

  /** 从双向索引删除连接，并返回供 dev engine 注销的 clientId。 */
  delete(client: NormalizedHotChannelClient): string | undefined {
    const id = this.clientToId.get(client)
    if (id) {
      this.clientToId.delete(client)
      this.idToClient.delete(id)
      return id
    }
  }
}

/** trailing-edge 防抖；每次调用都会把执行时间推迟到最后一次触发后的 `time`。 */
function debounce(time: number, cb: () => void) {
  let timer: ReturnType<typeof globalThis.setTimeout> | null
  return () => {
    if (timer) {
      globalThis.clearTimeout(timer)
      timer = null
    }
    timer = globalThis.setTimeout(cb, time)
  }
}
