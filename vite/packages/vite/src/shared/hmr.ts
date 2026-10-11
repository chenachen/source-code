import type { HotPayload, Update } from '#types/hmrPayload'
import type { ModuleNamespace, ViteHotContext } from '#types/hot'
import type { InferCustomEventPayload } from '#types/customEvent'
import type { NormalizedModuleRunnerTransport } from './moduleRunnerTransport'

/** 自定义 HMR 事件名到当前有效监听器列表的索引。 */
type CustomListenersMap = Map<string, ((data: any) => void)[]>

/** 一个已执行模块当前一代 `import.meta.hot.accept()` 登记的回调集合。 */
interface HotModule {
  /** 声明 accept 的模块 URL。 */
  id: string
  /** 当前一代模块执行登记的接受回调。 */
  callbacks: HotCallback[]
}

/** 一次 accept 登记的依赖集合与模块重载回调。 */
interface HotCallback {
  /** 当前运行环境可重新获取的依赖路径。 */
  deps: string[]
  /** 按 deps 顺序接收更新后 namespace。 */
  fn: (modules: Array<ModuleNamespace | undefined>) => void
}

/** HMR 内核依赖的错误与调试日志最小接口。 */
export interface HMRLogger {
  /** 记录更新失败或传输异常。 */
  error(msg: string | Error): void
  /** 记录成功更新、失效传播等诊断。 */
  debug(...msg: unknown[]): void
}

/**
 * 单个模块执行时暴露的 `import.meta.hot` 上下文。模块重执行会创建新实例，保留 data，替换旧 accept 回调和
 * 事件监听器，避免同一个 accept/on 在每轮更新后重复触发。
 * dispose/prune 索引不在构造时清空；再次调用对应注册方法时才覆盖该 owner 的旧条目。
 */
export class HMRContext implements ViteHotContext {
  /** 当前 context 新登记的监听器，用于下一次重执行时精确移除。 */
  private newListeners: CustomListenersMap

  /**
   * 初始化 owner 的持久 data，并从全局事件表移除上一代 context 实际登记过的监听器。
   * 只清该 owner 的 accept 数组，其他模块的回调与同名事件监听器保留。
   *
   * @param ownerPath - 当前执行模块的规范化 URL，同时作为全部生命周期表的键。
   */
  constructor(
    private hmrClient: HMRClient,
    private ownerPath: string,
  ) {
    if (!hmrClient.dataMap.has(ownerPath)) {
      hmrClient.dataMap.set(ownerPath, {})
    }

    // 文件热更新后会创建新 context；先清除上一代 accept 回调。
    const mod = hmrClient.hotModulesMap.get(ownerPath)
    if (mod) {
      mod.callbacks = []
    }

    // 同时从全局事件表移除上一代 context 登记的自定义监听器。
    const staleListeners = hmrClient.ctxToListenersMap.get(ownerPath)
    if (staleListeners) {
      for (const [event, staleFns] of staleListeners) {
        const listeners = hmrClient.customListenersMap.get(event)
        if (listeners) {
          hmrClient.customListenersMap.set(
            event,
            listeners.filter((l) => !staleFns.includes(l)),
          )
        }
      }
    }

    this.newListeners = new Map()
    hmrClient.ctxToListenersMap.set(ownerPath, this.newListeners)
  }

  /** 返回跨模块重执行保留的可变 data 对象。 */
  get data(): any {
    return this.hmrClient.dataMap.get(this.ownerPath)
  }

  /**
   * 按调用形态登记自接受、单依赖或依赖数组回调，不在注册时重新导入模块。
   * 自接受与单依赖包装器把 namespace 数组取成一个值；数组形式保留原顺序与完整数组。
   * 非函数/字符串/数组的 truthy deps 会抛错，实际依赖 URL 的规范化由服务端转换完成。
   */
  accept(deps?: any, callback?: any): void {
    if (typeof deps === 'function' || !deps) {
      // 自接受：hot.accept(() => {})。
      this.acceptDeps([this.ownerPath], ([mod]) => deps?.(mod))
    } else if (typeof deps === 'string') {
      // 显式接受一个依赖。
      this.acceptDeps([deps], ([mod]) => callback?.(mod))
    } else if (Array.isArray(deps)) {
      this.acceptDeps(deps, callback)
    } else {
      throw new Error(`invalid hot.accept() usage.`)
    }
  }

  /**
   * export 名由服务端 import analysis 用于部分接受判定，客户端不重新解析这些名称。
   * 运行端仍登记 owner 自身，并把重导入后的 namespace 交给回调。
   */
  acceptExports(
    _: string | readonly string[],
    callback?: (data: any) => void,
  ): void {
    this.acceptDeps([this.ownerPath], ([mod]) => callback?.(mod))
  }

  /** 登记模块缓存移除前的清理回调，覆盖 owner 的上一条；更新时接收持久 data 并被等待。 */
  dispose(cb: (data: any) => void): void {
    this.hmrClient.disposeMap.set(this.ownerPath, cb)
  }

  /** 登记模块从当前图移除时的清理回调，覆盖 owner 的上一条；prunePaths 在 dispose 后调用它。 */
  prune(cb: (data: any) => void): void {
    this.hmrClient.pruneMap.set(this.ownerPath, cb)
  }

  /** 为兼容旧 API 保留的无操作方法（#11036）。 */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  decline(): void {}

  /** 请求当前模块的 importer 继续处理更新；同步 accept 回调期间沿用该轮 firstInvalidatedBy，其他时刻以 owner 为来源。 */
  invalidate(message: string): void {
    const firstInvalidatedBy =
      this.hmrClient.currentFirstInvalidatedBy ?? this.ownerPath
    this.hmrClient.notifyListeners('vite:invalidate', {
      path: this.ownerPath,
      message,
      firstInvalidatedBy,
    })
    this.send('vite:invalidate', {
      path: this.ownerPath,
      message,
      firstInvalidatedBy,
    })
    this.hmrClient.logger.debug(
      `invalidate ${this.ownerPath}${message ? `: ${message}` : ''}`,
    )
  }

  /** 同时在全局表和当前 context 表登记自定义事件监听器。 */
  on<T extends string>(
    event: T,
    cb: (payload: InferCustomEventPayload<T>) => void,
  ): void {
    /** 向指定监听器索引追加当前回调。 */
    const addToMap = (map: Map<string, any[]>) => {
      const existing = map.get(event) || []
      existing.push(cb)
      map.set(event, existing)
    }
    addToMap(this.hmrClient.customListenersMap)
    addToMap(this.newListeners)
  }

  /** 从全局表和当前 context 表移除同一个自定义事件监听器。 */
  off<T extends string>(
    event: T,
    cb: (payload: InferCustomEventPayload<T>) => void,
  ): void {
    /** 从指定索引删除当前回调，并清理空事件项。 */
    const removeFromMap = (map: Map<string, any[]>) => {
      const existing = map.get(event)
      if (existing === undefined) {
        return
      }
      const pruned = existing.filter((l) => l !== cb)
      if (pruned.length === 0) {
        map.delete(event)
        return
      }
      map.set(event, pruned)
    }
    removeFromMap(this.hmrClient.customListenersMap)
    removeFromMap(this.newListeners)
  }

  /** 通过共享 transport 向开发服务器发送自定义 HMR 事件。 */
  send<T extends string>(event: T, data?: InferCustomEventPayload<T>): void {
    this.hmrClient.send({ type: 'custom', event, data })
  }

  /** 把已规范化的依赖列表追加到 owner 的 HotModule 记录。 */
  private acceptDeps(
    deps: string[],
    callback: HotCallback['fn'] = () => {},
  ): void {
    const mod: HotModule = this.hmrClient.hotModulesMap.get(this.ownerPath) || {
      id: this.ownerPath,
      callbacks: [],
    }
    mod.callbacks.push({
      deps,
      fn: callback,
    })
    this.hmrClient.hotModulesMap.set(this.ownerPath, mod)
  }
}

/**
 * 运行环境无关的 HMR 执行内核：保存 accept/dispose/prune/data 状态，并行获取本批更新模块，并在所有
 * fetch 完成后按服务端发送顺序同步调用 accept 回调，不等待返回的 Promise。浏览器和 Module Runner
 * 只需提供 transport 与导入器。
 */
export class HMRClient {
  /** 模块 URL 到当前 accept 回调的索引。 */
  public hotModulesMap: Map<string, HotModule> = new Map()
  /** 模块 URL 到缓存删除前 dispose 回调的索引。 */
  public disposeMap: Map<string, (data: any) => void | Promise<void>> =
    new Map()
  /** 模块 URL 到从当前图移除时 prune 回调的索引。 */
  public pruneMap: Map<string, (data: any) => void | Promise<void>> = new Map()
  /** 跨模块重执行保留的用户 data。 */
  public dataMap: Map<string, any> = new Map()
  /** 所有当前有效的自定义事件监听器。 */
  public customListenersMap: CustomListenersMap = new Map()
  /** 每个模块 context 本轮登记的监听器，用于重执行清理。 */
  public ctxToListenersMap: Map<string, CustomListenersMap> = new Map()
  /** 当前同步 accept 回调所属更新的 firstInvalidatedBy，回调结束后清空。 */
  public currentFirstInvalidatedBy: string | undefined

  /** 绑定日志器、传输层与环境特定的模块重新导入实现。 */
  constructor(
    public logger: HMRLogger,
    private transport: NormalizedModuleRunnerTransport,
    // 浏览器使用带时间戳的 dynamic import，Module Runner 可用自己的模块执行器实现重新加载。
    private importUpdatedModule: (update: Update) => Promise<ModuleNamespace>,
  ) {}

  /** 通知指定事件的监听器并等待它们返回的 Promise；异步拒绝由 allSettled 收集。 */
  public async notifyListeners<T extends string>(
    event: T,
    data: InferCustomEventPayload<T>,
  ): Promise<void>
  /**
   * 同步依次调用当前监听器，再并行等待返回值，异步拒绝不会取消其余已发起通知。
   * map 中的同步抛错会在 allSettled 建立前拒绝本方法，后续监听器尚未被调用。
   */
  public async notifyListeners(event: string, data: any): Promise<void> {
    const cbs = this.customListenersMap.get(event)
    if (cbs) {
      await Promise.allSettled(cbs.map((cb) => cb(data)))
    }
  }

  /** 异步发送 payload，并把传输失败交给 HMR logger。 */
  public send(payload: HotPayload): void {
    this.transport.send(payload).catch((err) => {
      this.logger.error(err)
    })
  }

  /** 清空所有模块生命周期与自定义事件状态。 */
  public clear(): void {
    this.hotModulesMap.clear()
    this.disposeMap.clear()
    this.pruneMap.clear()
    this.dataMap.clear()
    this.customListenersMap.clear()
    this.ctxToListenersMap.clear()
  }

  /**
   * 先并行等待本批 dispose，成功后并行等待 prune，最后删除 data；dispose 失败会跳过 prune，
   * finally 仍删除 data。其他 maps 保留，重新执行时由新 context 替换 callbacks/listeners。
   */
  public async prunePaths(paths: string[]): Promise<void> {
    try {
      await Promise.all(
        paths.map((path) => {
          const disposer = this.disposeMap.get(path)
          if (disposer) return disposer(this.dataMap.get(path))
        }),
      )
      await Promise.all(
        paths.map((path) => {
          const fn = this.pruneMap.get(path)
          if (fn) {
            return fn(this.dataMap.get(path))
          }
        }),
      )
    } finally {
      paths.forEach((path) => this.dataMap.delete(path))
    }
  }

  /** 输出重新导入失败的原始错误与统一用户提示。 */
  protected warnFailedUpdate(err: Error, path: string | string[]): void {
    if (!(err instanceof Error) || !err.message.includes('fetch')) {
      this.logger.error(err)
    }
    this.logger.error(
      `Failed to reload ${path}. ` +
        `This could be due to syntax errors or importing non-existent ` +
        `modules. (see errors above)`,
    )
  }

  /** 当前 microtask 批次中并行获取模块、稍后顺序提交的任务。 */
  private updateQueue: Promise<(() => void) | undefined>[] = []
  /** 是否已安排本轮 microtask 提交。 */
  private pendingUpdateQueue = false

  /**
   * 缓冲同一次源文件变化产生的多个 update：并行获取新模块，但等同一 microtask 收齐后按服务端发送
   * 顺序同步调用回调，不等待其返回 Promise。否则 HTTP 往返时序可能让依赖更新顺序漂移。
   * 首个调用负责等待并提交这一批；同窗口后续调用只追加任务，其返回并不表示整批已完成。
   * pending 标志在等待 fetch 前已释放，跨 payload 的顺序由外层 createHMRHandler 队列维持。
   *
   * @param payload - path 指接受边界，acceptedPath 指需要重新获取的模块，不一定是同一 URL。
   */
  public async queueUpdate(payload: Update): Promise<void> {
    this.updateQueue.push(this.fetchUpdate(payload))
    if (!this.pendingUpdateQueue) {
      this.pendingUpdateQueue = true
      await Promise.resolve()
      this.pendingUpdateQueue = false
      const loading = [...this.updateQueue]
      this.updateQueue = []
      ;(await Promise.all(loading)).forEach((fn) => fn && fn())
    }
  }

  /**
   * 固定旧一代合格 callbacks，等待可选 disposer 与模块导入，返回供批量提交阶段同步调用的函数。
   * 无已加载边界时直接跳过；导入失败会记录警告，回调仍可能收到 undefined namespace。
   * disposer 拒绝不经过导入错误的 catch，会拒绝 fetch 任务；accept 同步抛错则中断当次提交。
   * 多依赖回调仅在 acceptedPath 对应的位置得到新 namespace，未更新位置保持 undefined。
   * 提交期间设置 firstInvalidatedBy，finally 清空；回调返回的异步工作不处于这个同步作用域。
   */
  private async fetchUpdate(update: Update): Promise<(() => void) | undefined> {
    const { path, acceptedPath, firstInvalidatedBy } = update
    const mod = this.hotModulesMap.get(path)
    if (!mod) {
      // 代码分割项目中，服务端模块图可能包含浏览器尚未加载的分支；此时无需更新：
      // https://github.com/vitejs/vite/issues/721
      return
    }

    let fetchedModule: ModuleNamespace | undefined
    const isSelfUpdate = path === acceptedPath

    // 必须在重新导入前固定本次合格回调；新模块执行会清空并重新登记 mod.callbacks。
    const qualifiedCallbacks = mod.callbacks.filter(({ deps }) =>
      deps.includes(acceptedPath),
    )

    if (isSelfUpdate || qualifiedCallbacks.length > 0) {
      const disposer = this.disposeMap.get(acceptedPath)
      if (disposer) await disposer(this.dataMap.get(acceptedPath))
      try {
        fetchedModule = await this.importUpdatedModule(update)
      } catch (e) {
        this.warnFailedUpdate(e, acceptedPath)
      }
    }

    return () => {
      try {
        this.currentFirstInvalidatedBy = firstInvalidatedBy
        for (const { deps, fn } of qualifiedCallbacks) {
          fn(
            deps.map((dep) =>
              dep === acceptedPath ? fetchedModule : undefined,
            ),
          )
        }
        const loggedPath = isSelfUpdate ? path : `${acceptedPath} via ${path}`
        this.logger.debug(`hot updated: ${loggedPath}`)
      } finally {
        this.currentFirstInvalidatedBy = undefined
      }
    }
  }
}
