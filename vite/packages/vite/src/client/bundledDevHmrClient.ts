import type {
  BundledDevUpdatePayload,
  Update,
  UpdatePayload,
} from '#types/hmrPayload'
import { HMRClient, HMRContext, type HMRLogger } from '../shared/hmr'
import type { NormalizedModuleRunnerTransport } from '../shared/moduleRunnerTransport'

/** bundled-dev HMR 所需的最小 Rolldown runtime 能力，便于隔离实验性 API 并在测试中替身。 */
export interface RolldownRuntimeLike {
  /** 返回运行时模块图中的直接 importer。 */
  getImporters(id: string): string[]
  /** 模块是否已在当前页面执行；未执行模块无需参与更新冒泡。 */
  isExecuted(id: string): boolean
  /** runtime 当前是否已有该模块的 factory；不判断它是否来自本次 patch。 */
  hasFactory(id: string): boolean
  /** 删除旧 namespace/执行缓存，但保留新 patch 注册的 factory。 */
  removeModuleCache(id: string): void
  /** 重新初始化模块及其当前 factory。 */
  initModule(id: string): unknown
  /** 读取重新初始化后的 exports namespace。 */
  loadExports(id: string): unknown
}

/** 客户端分析一组 changedIds 后得到的更新决策。 */
type HmrUpdate =
  /** 改动只涉及从未执行的模块，无需动作。 */
  | {
      /** 表示本次变更不影响当前页面已执行的模块。 */
      type: 'noop'
    }
  /** 没有安全边界、序列缺口或循环传播时，请求服务端完成整页重载。 */
  | {
      /** 选择整页重载分支。 */
      type: 'full-reload'
      /** 无法安全执行局部更新的可诊断原因。 */
      reason: string
    }
  | {
      /** 表示已找到可按序应用的 HMR 接受边界。 */
      type: 'boundaries'
      /** `[接受边界, 被该边界接受的依赖]` 对。 */
      boundaries: [string, string][]
      /** 从 changed module 到全部边界之间需要清除缓存的模块集合。 */
      updateSet: string[]
    }

/** bundled-dev HMR 客户端的 URL 与应用前钩子。 */
export interface BundledDevHMRClientOptions {
  /** HMR patch URL 使用的已解析 base。 */
  base: string
  /** 返回 `'reload'` 表示钩子已自行刷新页面，终止本次 patch 应用。 */
  beforeApply: () => 'reload' | 'continue'
}

/**
 * 在浏览器侧基于 Rolldown runtime 图计算并应用 bundled-dev HMR。
 *
 * 与普通 Vite HMR 由服务端给出 boundary 不同，这里服务端只发送 changedIds 与 patch；
 * 客户端根据实际执行图向 importer 冒泡，串行清缓存、重建模块并调用 accept callback。
 */
export class BundledDevHMRClient extends HMRClient {
  /** 所有 push/invalidate 串行执行，防止两个 patch 交叉清理同一模块缓存。 */
  private applyQueue = Promise.resolve()
  /** 最后消费的服务端 patch 序号；noop 也消费，序号不连续时请求 reload。 */
  private lastSeq = 0
  /** 一旦请求 full reload，忽略后续 patch，等待服务端完成重建后导航。 */
  private reloadPending = false

  /** 绑定日志、传输层、Rolldown runtime 与应用前钩子。 */
  constructor(
    logger: HMRLogger,
    transport: NormalizedModuleRunnerTransport,
    private runtime: RolldownRuntimeLike,
    private options: BundledDevHMRClientOptions,
  ) {
    super(logger, transport, async () => {
      throw new Error(
        'unreachable: full-bundle mode applies patches through its own queue',
      )
    })
  }

  /** 模块是否通过 `import.meta.hot.accept()` 接受自身更新。 */
  isSelfAccepted(id: string): boolean {
    return (
      this.hotModulesMap.get(id)?.callbacks.some((c) => c.deps.includes(id)) ??
      false
    )
  }

  /** parent 的 accept callback 是否显式接受依赖 id。 */
  acceptsDep(parent: string, id: string): boolean {
    return (
      this.hotModulesMap
        .get(parent)
        ?.callbacks.some((c) => c.deps.includes(id)) ?? false
    )
  }

  /**
   * 从已执行的 changedIds 向 importer 冒泡，收集 HMR boundary 与需失效的模块。
   * 沿未被 accept 边界截断的路径传播；回到本轮 invalidate 来源、到达无已执行 importer 根
   * 或形成路径环时退回整页重载。
   */
  computeHmrUpdate(
    changedIds: string[],
    opts?: {
      /** 首次调用 invalidate 的模块，用于检测传播回环。 */
      firstInvalidatedBy?: string
    },
  ): HmrUpdate {
    const boundaries: [string, string][] = []
    const updateSet = new Set<string>()
    const traversedModules = new Set<string>()
    for (const changed of changedIds) {
      if (!this.runtime.isExecuted(changed)) {
        continue
      }
      const fullReload = this.bubble(
        changed,
        [changed],
        updateSet,
        boundaries,
        opts?.firstInvalidatedBy,
        traversedModules,
      )
      if (fullReload) return fullReload
    }
    return boundaries.length
      ? { type: 'boundaries', boundaries, updateSet: [...updateSet] }
      : { type: 'noop' }
  }

  /** 单条向上冒泡路径；`stack` 检查路径环，`traversedModules` 去重跨路径共享祖先。 */
  private bubble(
    id: string,
    stack: string[],
    updateSet: Set<string>,
    boundaries: [string, string][],
    firstInvalidatedBy: string | undefined,
    traversedModules: Set<string>,
  ): HmrUpdate | undefined {
    if (traversedModules.has(id)) return
    traversedModules.add(id)
    updateSet.add(id)
    if (firstInvalidatedBy !== undefined && id === firstInvalidatedBy) {
      return {
        type: 'full-reload',
        reason: `update propagated back to ${firstInvalidatedBy}, which already called \`import.meta.hot.invalidate()\``,
      }
    }
    if (this.isSelfAccepted(id)) {
      boundaries.push([id, id])
      return
    }
    const parents = this.runtime
      .getImporters(id)
      .filter((p) => this.runtime.isExecuted(p))
    if (!parents.length) {
      return {
        type: 'full-reload',
        reason: `no hmr boundary found for module \`${id}\``,
      }
    }
    for (const parent of parents) {
      // 当前 parent 已接受 id，到此形成边界，不再继续向上清除。
      if (this.acceptsDep(parent, id)) {
        boundaries.push([parent, id])
        continue
      }
      if (stack.includes(parent)) {
        // import 环中没有明确边界时，局部重执行顺序不可靠，只能 full reload。
        return {
          type: 'full-reload',
          reason: `circular import chain between \`${id}\` and \`${parent}\``,
        }
      }
      const fullReload = this.bubble(
        parent,
        [...stack, parent],
        updateSet,
        boundaries,
        firstInvalidatedBy,
        traversedModules,
      )
      if (fullReload) return fullReload
    }
  }

  /** 把服务端 push 接到串行应用队列；失败仅警告，由下一次更新或 reload 恢复。 */
  handlePush(payload: BundledDevUpdatePayload): void {
    this.applyQueue = this.applyQueue
      .then(() => this.applyPush(payload))
      .catch((err) => {
        this.warnFailedUpdate(err, payload.changedIds)
      })
  }

  /** 处理模块主动调用 `hot.invalidate()`，无需等待服务端重新生成 patch。 */
  invalidateLocally(id: string, message?: string): void {
    this.logger.debug(`invalidate ${id}${message ? `: ${message}` : ''}`)
    this.applyQueue = this.applyQueue
      .then(() => this.applyInvalidate(id))
      .catch((err) => {
        this.warnFailedUpdate(err, id)
      })
  }

  /** Rolldown runtime 删除模块缓存前执行该模块登记的 dispose callback。 */
  handleModuleCacheRemoval(id: string): void {
    const disposer = this.disposeMap.get(id)
    if (disposer) {
      disposer(this.dataMap.get(id))
    }
  }

  /** 校验 push 序列、下载 ESM patch，再按预先计算的边界应用更新。 */
  private async applyPush({
    changedIds,
    url,
    seq,
  }: BundledDevUpdatePayload): Promise<void> {
    if (this.reloadPending) return
    if (seq !== this.lastSeq + 1) {
      // 丢失任一 patch 都可能漏掉 factory 或图变化，不能继续局部更新。
      this.requestFullReload(
        `hmr update sequence gap (expected ${this.lastSeq + 1}, got ${seq})`,
      )
      return
    }
    this.lastSeq = seq

    const update = this.computeHmrUpdate(changedIds)
    if (update.type === 'noop') return
    if (update.type === 'full-reload') {
      this.requestFullReload(update.reason)
      return
    }

    const listenerPayload = this.toUpdatePayload(update.boundaries, undefined)
    await this.notifyListeners('vite:beforeUpdate', listenerPayload)
    if (this.options.beforeApply() === 'reload') return

    try {
      // patch 作为 ESM 导入以注册 factory；export 语法使它无法作为 classic script 执行。
      await import(/* @vite-ignore */ this.options.base + url)
    } catch {
      this.requestFullReload(`failed to import hmr patch ${url}`)
      return
    }

    await this.applyUpdate(update)
    await this.notifyListeners('vite:afterUpdate', listenerPayload)
  }

  /**
   * 从 invalidate 模块的已执行 importers 开始重新计算边界。
   * 没有 rebuild，因此没有 patch 可下载，只能使用 runtime 中已有的 factory。
   */
  private async applyInvalidate(id: string): Promise<void> {
    if (this.reloadPending) return
    // 在队列实际执行时取来源；invalidateLocally 没保存前轮 callback 期间的来源。
    const firstInvalidatedBy = this.currentFirstInvalidatedBy ?? id
    const importers = this.runtime
      .getImporters(id)
      .filter((p) => this.runtime.isExecuted(p))
    if (!importers.length) {
      this.requestFullReload(
        `no importers to handle \`import.meta.hot.invalidate()\` called by \`${id}\``,
      )
      return
    }

    // 没有发生 rebuild，所以无需也无法获取 patch。
    const update = this.computeHmrUpdate(importers, { firstInvalidatedBy })
    if (update.type === 'noop') return
    if (update.type === 'full-reload') {
      this.requestFullReload(update.reason)
      return
    }

    const listenerPayload = this.toUpdatePayload(
      update.boundaries,
      firstInvalidatedBy,
    )
    await this.notifyListeners('vite:beforeUpdate', listenerPayload)
    if (this.options.beforeApply() === 'reload') return
    await this.applyUpdate(update, firstInvalidatedBy)
    await this.notifyListeners('vite:afterUpdate', listenerPayload)
  }

  /**
   * 按序应用一组 boundary：先确认 factory 齐全并捕获旧 callback，再统一清缓存，
   * 最后按 boundary 重建 acceptedVia、读取新 exports 并同步调用 callback；不等待 dispose/callback
   * 返回的 Promise，同步异常也不会回滚已经移除的缓存。
   */
  private async applyUpdate(
    update: Extract<
      HmrUpdate,
      {
        /** 将参数收窄为已经找到接受边界的更新决策。 */
        type: 'boundaries'
      }
    >,
    firstInvalidatedBy?: string,
  ): Promise<void> {
    // 删除缓存前确认更新集都有可初始化的 factory；此检查只验证存在性。
    for (const id of update.updateSet) {
      if (!this.runtime.hasFactory(id)) {
        this.requestFullReload(`no factory for module \`${id}\``)
        return
      }
    }

    // 缓存删除会触发 dispose 并可能改动 hotModulesMap，必须先冻结本轮 callback 列表。
    const applies = update.boundaries.map(([boundary, acceptedVia]) => ({
      boundary,
      acceptedVia,
      callbacks:
        this.hotModulesMap
          .get(boundary)
          ?.callbacks.filter((c) => c.deps.includes(acceptedVia)) ?? [],
    }))

    for (const id of update.updateSet) {
      this.runtime.removeModuleCache(id)
    }

    for (const { boundary, acceptedVia, callbacks } of applies) {
      // acceptedVia 先重建，callback 接收的 namespace 才是新版本。
      this.runtime.initModule(acceptedVia)
      const fresh = this.runtime.loadExports(acceptedVia)
      try {
        // 同步 callback 发出的 listener payload 可读到本轮来源；本地 invalidate 只排队 id，
        // 等下轮 applyInvalidate 执行时此字段已由 finally 清空。
        this.currentFirstInvalidatedBy = firstInvalidatedBy
        for (const { deps, fn } of callbacks) {
          fn(
            deps.map((dep) =>
              dep === acceptedVia ? (fresh as any) : undefined,
            ),
          )
        }
      } finally {
        this.currentFirstInvalidatedBy = undefined
      }
      this.logger.debug(
        `hot updated: ${
          boundary === acceptedVia ? boundary : `${acceptedVia} via ${boundary}`
        }`,
      )
    }
  }

  /** 把 bundled-dev boundary 转成普通 HMR listener 可理解的 UpdatePayload。 */
  private toUpdatePayload(
    boundaries: [string, string][],
    firstInvalidatedBy: string | undefined,
  ): UpdatePayload {
    const updates: Update[] = boundaries.map(([boundary, acceptedVia]) => ({
      type: 'js-update',
      path: boundary,
      acceptedPath: acceptedVia,
      timestamp: Date.now(),
      firstInvalidatedBy,
    }))
    return { type: 'update', updates }
  }

  /**
   * 只通知服务端“需要 reload”，不直接 `location.reload()`；服务端等完整 bundle 可用后
   * 再发送 full-reload，避免页面先进入 bundling fallback 并发生二次导航（#23106）。
   */
  private requestFullReload(reason: string): void {
    if (this.reloadPending) return
    this.reloadPending = true
    this.logger.debug(`full reload needed: ${reason}`)
    this.send({
      type: 'custom',
      event: 'vite:bundled-dev:reload-needed',
      data: { reason },
    })
  }
}

/** bundled-dev 版 HMRContext，把 `hot.invalidate()` 交给浏览器侧 runtime 图处理。 */
export class BundledDevHMRContext extends HMRContext {
  /** 把所属模块与 bundled-dev 专用客户端绑定到标准 HMRContext。 */
  constructor(
    private bundledDevClient: BundledDevHMRClient,
    private owner: string,
  ) {
    super(bundledDevClient, owner)
  }

  /** 通知用户 listener，并把当前模块加入串行本地失效队列。 */
  override invalidate(message: string): void {
    this.bundledDevClient.notifyListeners('vite:invalidate', {
      path: this.owner,
      message,
      firstInvalidatedBy:
        this.bundledDevClient.currentFirstInvalidatedBy ?? this.owner,
    })
    this.bundledDevClient.invalidateLocally(this.owner, message)
  }
}
