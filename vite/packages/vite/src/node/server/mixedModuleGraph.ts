import type { ModuleInfo } from 'rolldown'
import { monotonicDateNow } from '../utils'
import type { TransformResult } from './transformRequest'
import type {
  EnvironmentModuleGraph,
  EnvironmentModuleNode,
  ResolvedUrl,
} from './moduleGraph'

/**
 * 旧 ModuleNode/ModuleGraph 的 client+ssr 混合兼容层。
 *
 * 理想上新类型应直接使用这两个短名称，但会破坏大量生态代码；当前保留旧名称作为代理门面，
 * 新实现使用 EnvironmentModuleNode/EnvironmentModuleGraph。待旧 API 废弃后可重新评估命名。
 */

/** 与 Rolldown `ModuleInfo.meta` 相同的只读默认空对象。 */
const EMPTY_OBJECT = Object.freeze({})

/**
 * 把同一 ID 的 client/ssr EnvironmentModuleNode 合成旧 ModuleNode 视图。
 * client 专属字段优先；集合/对象按旧混合图语义合并；写入会同步到当前存在的两个底层节点。
 */
export class ModuleNode {
  /** 创建本代理的兼容 ModuleGraph。 */
  _moduleGraph: ModuleGraph
  /** 对应 client 节点，可能不存在。 */
  _clientModule: EnvironmentModuleNode | undefined
  /** 对应 ssr 节点，可能不存在。 */
  _ssrModule: EnvironmentModuleNode | undefined

  /** 保存底层节点对；不复制任何模块状态。 */
  constructor(
    moduleGraph: ModuleGraph,
    clientModule?: EnvironmentModuleNode,
    ssrModule?: EnvironmentModuleNode,
  ) {
    this._moduleGraph = moduleGraph
    this._clientModule = clientModule
    this._ssrModule = ssrModule
  }
  /** 读取 client 优先、ssr 兜底的标量字段。 */
  _get<T extends keyof EnvironmentModuleNode>(
    prop: T,
  ): EnvironmentModuleNode[T] {
    return (this._clientModule?.[prop] ?? this._ssrModule?.[prop])!
  }
  /** 把旧 API 写入同步到当前存在的 client/ssr 节点。 */
  _set<T extends keyof EnvironmentModuleNode>(
    prop: T,
    value: EnvironmentModuleNode[T],
  ): void {
    if (this._clientModule) {
      this._clientModule[prop] = value
    }
    if (this._ssrModule) {
      this._ssrModule[prop] = value
    }
  }

  /** 把一个 Environment 的节点 Set 包装为旧 ModuleNode Set 视图。 */
  _wrapModuleSet(
    prop: ModuleSetNames,
    module: EnvironmentModuleNode | undefined,
  ): Set<ModuleNode> {
    if (!module) {
      return new Set()
    }
    return createBackwardCompatibleModuleSet(this._moduleGraph, prop, module)
  }
  /** 合并 client/ssr 的 import 集合；相同 resolved ID 只保留一项。 */
  _getModuleSetUnion(prop: 'importedModules' | 'importers'): Set<ModuleNode> {
    const importedModules = new Set<ModuleNode>()
    const ids = new Set<string>()
    if (this._clientModule) {
      for (const mod of this._clientModule[prop]) {
        if (mod.id) ids.add(mod.id)
        importedModules.add(
          this._moduleGraph.getBackwardCompatibleModuleNode(mod),
        )
      }
    }
    if (this._ssrModule) {
      for (const mod of this._ssrModule[prop]) {
        if (mod.id && !ids.has(mod.id)) {
          importedModules.add(
            this._moduleGraph.getBackwardCompatibleModuleNode(mod),
          )
        }
      }
    }
    return importedModules
  }
  /** 用 Proxy 合并 ModuleInfo，字段 client 优先；meta 单独执行对象合并。 */
  _getModuleInfoUnion(prop: 'info'): ModuleInfo | undefined {
    const _clientValue = this._clientModule?.[prop]
    const _ssrValue = this._ssrModule?.[prop]

    if (_clientValue == null && _ssrValue == null) return undefined

    return new Proxy({} as any, {
      get: (_, key: string) => {
        // ModuleInfo.meta 必须走 this.meta 的对象合并，而不是直接选择单一 Environment。
        if (key === 'meta') {
          return this.meta || EMPTY_OBJECT
        }
        if (_clientValue) {
          if (key in _clientValue) {
            return _clientValue[key as keyof ModuleInfo]
          }
        }
        if (_ssrValue) {
          if (key in _ssrValue) {
            return _ssrValue[key as keyof ModuleInfo]
          }
        }
      },
    })
  }
  /** 合并对象字段：先 SSR、后 client，因此 client 同名 key 覆盖。 */
  _getModuleObjectUnion(prop: 'meta'): Record<string, any> | undefined {
    const _clientValue = this._clientModule?.[prop]
    const _ssrValue = this._ssrModule?.[prop]

    if (_clientValue == null && _ssrValue == null) return undefined

    const info: Record<string, any> = {}
    if (_ssrValue) {
      Object.assign(info, _ssrValue)
    }
    if (_clientValue) {
      Object.assign(info, _clientValue)
    }
    return info
  }

  /** 读取 client 优先、SSR 兜底的公开模块 URL。 */
  get url(): string {
    return this._get('url')
  }
  /** 同步更新当前存在的 client/SSR 节点 URL。 */
  set url(value: string) {
    this._set('url', value)
  }
  /** 读取 client 优先、SSR 兜底的 resolved ID。 */
  get id(): string | null {
    return this._get('id')
  }
  /** 同步更新当前存在的 client/SSR 节点 ID。 */
  set id(value: string | null) {
    this._set('id', value)
  }
  /** 读取两个 Environment 共用的磁盘文件身份。 */
  get file(): string | null {
    return this._get('file')
  }
  /** 同步更新当前存在的 client/SSR 节点文件身份。 */
  set file(value: string | null) {
    this._set('file', value)
  }
  /** 读取模块在转换管线中的归一化类型。 */
  get type(): 'js' | 'css' | 'asset' {
    return this._get('type')
  }
  /**
   * 惰性合并两端的 ModuleInfo。
   * info 本身在 pluginContainer 中就是 Proxy，兼容层不能展开复制。
   */
  get info(): ModuleInfo | undefined {
    return this._getModuleInfoUnion('info')
  }
  /** 合并 SSR 与 client 插件写入的 meta，client 同名键优先。 */
  get meta(): Record<string, any> | undefined {
    return this._getModuleObjectUnion('meta')
  }
  /** 返回 client/SSR importer 的去重并集。 */
  get importers(): Set<ModuleNode> {
    return this._getModuleSetUnion('importers')
  }
  /** 把 client 节点的依赖集合包装为旧 ModuleNode 视图。 */
  get clientImportedModules(): Set<ModuleNode> {
    return this._wrapModuleSet('importedModules', this._clientModule)
  }
  /** 把 SSR 节点的依赖集合包装为旧 ModuleNode 视图。 */
  get ssrImportedModules(): Set<ModuleNode> {
    return this._wrapModuleSet('importedModules', this._ssrModule)
  }
  /** 返回 client/SSR 依赖节点的去重并集。 */
  get importedModules(): Set<ModuleNode> {
    return this._getModuleSetUnion('importedModules')
  }
  /** 返回 client 侧声明接受更新的依赖集合。 */
  get acceptedHmrDeps(): Set<ModuleNode> {
    return this._wrapModuleSet('acceptedHmrDeps', this._clientModule)
  }
  /** 返回 client 侧可局部接受的导出名；SSR 不参与浏览器 HMR 边界。 */
  get acceptedHmrExports(): Set<string> | null {
    return this._clientModule?.acceptedHmrExports ?? null
  }
  /** 返回 client 导入者实际使用的 binding 集，用于 HMR 部分接受判断。 */
  get importedBindings(): Map<string, Set<string>> | null {
    return this._clientModule?.importedBindings ?? null
  }
  /** 返回 client 模块是否声明自接受更新。 */
  get isSelfAccepting(): boolean | undefined {
    return this._clientModule?.isSelfAccepting
  }
  /** 返回 client HTTP 请求使用的转换缓存。 */
  get transformResult(): TransformResult | null {
    return this._clientModule?.transformResult ?? null
  }
  /** 仅更新 client 转换缓存，避免把浏览器结果写入 SSR 图。 */
  set transformResult(value: TransformResult | null) {
    if (this._clientModule) {
      this._clientModule.transformResult = value
    }
  }
  /** 返回 SSR Environment 的转换缓存。 */
  get ssrTransformResult(): TransformResult | null {
    return this._ssrModule?.transformResult ?? null
  }
  /** 仅更新 SSR 转换缓存。 */
  set ssrTransformResult(value: TransformResult | null) {
    if (this._ssrModule) {
      this._ssrModule.transformResult = value
    }
  }
  /** 返回旧 SSR loader 缓存的已求值 namespace。 */
  get ssrModule(): Record<string, any> | null {
    return this._ssrModule?.ssrModule ?? null
  }
  /** 返回 SSR 求值失败时缓存的错误对象。 */
  get ssrError(): Error | null {
    return this._ssrModule?.ssrError ?? null
  }
  /** 返回两端最近 HMR 时间戳的较大值，保持旧混合图的单调视图。 */
  get lastHMRTimestamp(): number {
    return Math.max(
      this._clientModule?.lastHMRTimestamp ?? 0,
      this._ssrModule?.lastHMRTimestamp ?? 0,
    )
  }
  /** 把旧 API 写入的 HMR 时间戳同步到当前存在的两个节点。 */
  set lastHMRTimestamp(value: number) {
    if (this._clientModule) {
      this._clientModule.lastHMRTimestamp = value
    }
    if (this._ssrModule) {
      this._ssrModule.lastHMRTimestamp = value
    }
  }
  /** 返回两端最近一次失效时间戳的较大值。 */
  get lastInvalidationTimestamp(): number {
    return Math.max(
      this._clientModule?.lastInvalidationTimestamp ?? 0,
      this._ssrModule?.lastInvalidationTimestamp ?? 0,
    )
  }
  /** 返回 client 节点的软/硬失效状态。 */
  get invalidationState(): TransformResult | 'HARD_INVALIDATED' | undefined {
    return this._clientModule?.invalidationState
  }
  /** 返回 SSR 节点的软/硬失效状态。 */
  get ssrInvalidationState(): TransformResult | 'HARD_INVALIDATED' | undefined {
    return this._ssrModule?.invalidationState
  }
}

/** 惰性映射 iterator，不预先复制底层 Map/Set 全部内容。 */
function mapIterator<T, K = T>(
  iterable: IterableIterator<T>,
  transform: (value: T) => K,
): IterableIterator<K> {
  return {
    /** 让包装 iterator 自身满足可迭代协议。 */
    [Symbol.iterator](): IterableIterator<K> {
      return this
    },
    /** 拉取一个底层值并在返回前完成惰性映射。 */
    next(): IteratorResult<K> {
      const r = iterable.next()
      return r.done
        ? r
        : {
            value: transform(r.value),
            done: false,
          }
    },
  }
}

/**
 * 把 client 与 ssr 的独立 EnvironmentModuleGraph 暴露为旧混合 ModuleGraph API。
 * 该层只兼容两种历史 Environment，自定义 Environment 不会出现在此视图。
 */
export class ModuleGraph {
  /** @internal */
  _moduleGraphs: {
    /** 惰性取得当前 client 图，允许 Server 原地重启后切换实例。 */
    client: () => EnvironmentModuleGraph
    /** 惰性取得当前 SSR 图。 */
    ssr: () => EnvironmentModuleGraph
  }

  /** 惰性取得当前 client 图，重启后闭包可指向新实例。 @internal */
  get _client(): EnvironmentModuleGraph {
    return this._moduleGraphs.client()
  }

  /** 惰性取得当前 ssr 图。 @internal */
  get _ssr(): EnvironmentModuleGraph {
    return this._moduleGraphs.ssr()
  }

  /** client/ssr URL 索引的兼容 Map 视图。 */
  urlToModuleMap: Map<string, ModuleNode>
  /** client/ssr ID 索引的兼容 Map 视图。 */
  idToModuleMap: Map<string, ModuleNode>
  /** client ETag 索引的兼容视图。 */
  etagToModuleMap: Map<string, ModuleNode>

  /** 两图 fileToModules 的兼容并集。 */
  fileToModulesMap: Map<string, Set<ModuleNode>>

  /** 按底层 client/ssr 节点对稳定复用同一个 ModuleNode 代理身份。 */
  private moduleNodeCache = new DualWeakMap<
    EnvironmentModuleNode,
    EnvironmentModuleNode,
    ModuleNode
  >()

  /** 用惰性图 getter 创建所有兼容 Map；不复制图当前内容。 */
  constructor(moduleGraphs: {
    /** 返回当前 client Environment 的模块图。 */
    client: () => EnvironmentModuleGraph
    /** 返回当前 SSR Environment 的模块图。 */
    ssr: () => EnvironmentModuleGraph
  }) {
    this._moduleGraphs = moduleGraphs

    /** 按索引字段惰性构造 client 优先的双图并集。 */
    const getModuleMapUnion =
      (prop: 'urlToModuleMap' | 'idToModuleMap') => () => {
        // 旧图是 client/ssr 并集；client key 优先，SSR 只补缺失项。SSR 为空时直接返回 client
        // Map，避免无意义复制。
        if (this._ssr[prop].size === 0) {
          return this._client[prop]
        }
        const map = new Map(this._client[prop])
        for (const [key, module] of this._ssr[prop]) {
          if (!map.has(key)) {
            map.set(key, module)
          }
        }
        return map
      }

    this.urlToModuleMap = createBackwardCompatibleModuleMap(
      this,
      'urlToModuleMap',
      getModuleMapUnion('urlToModuleMap'),
    )
    this.idToModuleMap = createBackwardCompatibleModuleMap(
      this,
      'idToModuleMap',
      getModuleMapUnion('idToModuleMap'),
    )
    this.etagToModuleMap = createBackwardCompatibleModuleMap(
      this,
      'etagToModuleMap',
      () => this._client.etagToModuleMap,
    )
    this.fileToModulesMap = createBackwardCompatibleFileToModulesMap(this)
  }

  /** 同时查询 client/ssr ID，并返回稳定的双节点代理。 */
  getModuleById(id: string): ModuleNode | undefined {
    const clientModule = this._client.getModuleById(id)
    const ssrModule = this._ssr.getModuleById(id)
    if (!clientModule && !ssrModule) {
      return
    }
    return this.getBackwardCompatibleModuleNodeDual(clientModule, ssrModule)
  }

  /** 并行解析 client/SSR URL，并把命中的节点对包装为稳定兼容身份。 */
  async getModuleByUrl(
    url: string,
    _ssr?: boolean,
  ): Promise<ModuleNode | undefined> {
    // 旧混合图的 ssr 参数曾影响解析；新兼容视图并行查两图，以并集近似旧行为。
    const [clientModule, ssrModule] = await Promise.all([
      this._client.getModuleByUrl(url),
      this._ssr.getModuleByUrl(url),
    ])
    if (!clientModule && !ssrModule) {
      return
    }
    return this.getBackwardCompatibleModuleNodeDual(clientModule, ssrModule)
  }

  /**
   * 返回同一文件在 client/ssr 的节点并集；相同 ID 视为一对节点，只暴露一个代理。
   * Vite 5.1 及以前的 moduleGraph 本就混合两端，因此这里尽力维持旧观察结果。
   */
  getModulesByFile(file: string): Set<ModuleNode> | undefined {
    const clientModules = this._client.getModulesByFile(file)
    const ssrModules = this._ssr.getModulesByFile(file)
    if (!clientModules && !ssrModules) {
      return undefined
    }
    const result = new Set<ModuleNode>()
    if (clientModules) {
      for (const mod of clientModules) {
        result.add(this.getBackwardCompatibleBrowserModuleNode(mod)!)
      }
    }
    if (ssrModules) {
      for (const mod of ssrModules) {
        if (mod.id == null || !this._client.getModuleById(mod.id)) {
          result.add(this.getBackwardCompatibleServerModuleNode(mod)!)
        }
      }
    }
    return result
  }

  /** 同时让 client/ssr 图处理文件变化。 */
  onFileChange(file: string): void {
    this._client.onFileChange(file)
    this._ssr.onFileChange(file)
  }

  /** 同时让 client/ssr 图断开删除文件关系。 */
  onFileDelete(file: string): void {
    this._client.onFileDelete(file)
    this._ssr.onFileDelete(file)
  }

  /** 兼容节点按 environment 选择真实底层图；仅支持 client/ssr。 @internal */
  _getModuleGraph(environment: string): EnvironmentModuleGraph {
    switch (environment) {
      case 'client':
        return this._client
      case 'ssr':
        return this._ssr
      default:
        throw new Error(`Invalid module node environment ${environment}`)
    }
  }

  /**
   * 将旧 ModuleNode 的失效请求分别转发到其 client/SSR 底层节点。
   * seen 集也按端拆分，避免把兼容代理直接写入新图的递归去重集合。
   */
  invalidateModule(
    mod: ModuleNode,
    seen: Set<ModuleNode> = new Set(),
    timestamp: number = monotonicDateNow(),
    isHmr: boolean = false,
    /** @internal */
    softInvalidate = false,
  ): void {
    if (mod._clientModule) {
      this._client.invalidateModule(
        mod._clientModule,
        new Set(
          [...seen].map((mod) => mod._clientModule).filter(Boolean),
        ) as Set<EnvironmentModuleNode>,
        timestamp,
        isHmr,
        softInvalidate,
      )
    }
    if (mod._ssrModule) {
      // TODO：确认生态是否仍依赖兼容调用同时失效 SSR 节点。
      this._ssr.invalidateModule(
        mod._ssrModule,
        new Set(
          [...seen].map((mod) => mod._ssrModule).filter(Boolean),
        ) as Set<EnvironmentModuleNode>,
        timestamp,
        isHmr,
        softInvalidate,
      )
    }
  }

  /** 清空两张底层图的全部转换缓存与失效状态。 */
  invalidateAll(): void {
    this._client.invalidateAll()
    this._ssr.invalidateAll()
  }

  /* TODO：尚未发现生态使用该方法，待确认是否仍需为兼容实现。
  async updateModuleInfo(
    module: ModuleNode,
    importedModules: Set<string | ModuleNode>,
    importedBindings: Map<string, Set<string>> | null,
    acceptedModules: Set<string | ModuleNode>,
    acceptedExports: Set<string> | null,
    isSelfAccepting: boolean,
    ssr?: boolean,
    staticImportedUrls?: Set<string>, // 内部参数
  ): Promise<Set<ModuleNode> | undefined> {
    // 未实现
  }
  */

  /** 按旧 ssr 布尔选择底层图确保节点，再包装为兼容 ModuleNode。 */
  async ensureEntryFromUrl(
    rawUrl: string,
    ssr?: boolean,
    setIsSelfAccepting = true,
  ): Promise<ModuleNode> {
    const module = await (ssr ? this._ssr : this._client).ensureEntryFromUrl(
      rawUrl,
      setIsSelfAccepting,
    )
    return this.getBackwardCompatibleModuleNode(module)!
  }

  /** 两图同时创建 file-only 节点，并返回双节点代理。 */
  createFileOnlyEntry(file: string): ModuleNode {
    const clientModule = this._client.createFileOnlyEntry(file)
    const ssrModule = this._ssr.createFileOnlyEntry(file)
    return this.getBackwardCompatibleModuleNodeDual(clientModule, ssrModule)!
  }

  /** 按旧 ssr 布尔选择底层 URL resolver。 */
  async resolveUrl(url: string, ssr?: boolean): Promise<ResolvedUrl> {
    return ssr ? this._ssr.resolveUrl(url) : this._client.resolveUrl(url)
  }

  /** 按旧 ssr 布尔更新对应底层节点的 transformResult。 */
  updateModuleTransformResult(
    mod: ModuleNode,
    result: TransformResult | null,
    ssr?: boolean,
  ): void {
    const environment = ssr ? 'ssr' : 'client'
    this._getModuleGraph(environment).updateModuleTransformResult(
      (environment === 'client' ? mod._clientModule : mod._ssrModule)!,
      result,
    )
  }

  /** ETag 仅属于 client HTTP 响应，从 client 图查询并补配对 SSR 节点。 */
  getModuleByEtag(etag: string): ModuleNode | undefined {
    const mod = this._client.etagToModuleMap.get(etag)
    return mod && this.getBackwardCompatibleBrowserModuleNode(mod)
  }

  /** 为 client 节点查找同 ID SSR 节点并创建/复用代理。 */
  getBackwardCompatibleBrowserModuleNode(
    clientModule: EnvironmentModuleNode,
  ): ModuleNode {
    return this.getBackwardCompatibleModuleNodeDual(
      clientModule,
      clientModule.id ? this._ssr.getModuleById(clientModule.id) : undefined,
    )
  }

  /** 为 SSR 节点查找同 ID client 节点并创建/复用代理。 */
  getBackwardCompatibleServerModuleNode(
    ssrModule: EnvironmentModuleNode,
  ): ModuleNode {
    return this.getBackwardCompatibleModuleNodeDual(
      ssrModule.id ? this._client.getModuleById(ssrModule.id) : undefined,
      ssrModule,
    )
  }

  /** 按底层节点所属 Environment 进入对应包装路径。 */
  getBackwardCompatibleModuleNode(mod: EnvironmentModuleNode): ModuleNode {
    return mod.environment === 'client'
      ? this.getBackwardCompatibleBrowserModuleNode(mod)
      : this.getBackwardCompatibleServerModuleNode(mod)
  }

  /** 用节点对作为身份键，稳定返回同一 ModuleNode Proxy。 */
  getBackwardCompatibleModuleNodeDual(
    clientModule?: EnvironmentModuleNode,
    ssrModule?: EnvironmentModuleNode,
  ): ModuleNode {
    const cached = this.moduleNodeCache.get(clientModule, ssrModule)
    if (cached) {
      return cached
    }

    const moduleNode = new ModuleNode(this, clientModule, ssrModule)
    this.moduleNodeCache.set(clientModule, ssrModule, moduleNode)
    return moduleNode
  }
}

/**
 * 以两个可选弱引用 key 的组合缓存值；共享占位对象表示 undefined。
 * 用于 client-only、ssr-only 和双节点三种 ModuleNode 代理身份。
 */
class DualWeakMap<K1 extends WeakKey, K2 extends WeakKey, V> {
  /** 第一层 key 到第二层弱引用表；undefined 由共享占位对象表示。 */
  private map = new WeakMap<K1 | object, WeakMap<K2 | object, V>>()
  /** 代替 undefined 进入 WeakMap 的稳定对象身份。 */
  private undefinedKey = {}

  /** 按两个可选弱引用 key 查询已缓存值。 */
  get(key1: K1 | undefined, key2: K2 | undefined): V | undefined {
    const k1 = key1 ?? this.undefinedKey
    const k2 = key2 ?? this.undefinedKey
    return this.map.get(k1)?.get(k2)
  }

  /** 把值写入由两个可选 key 共同确定的缓存槽。 */
  set(key1: K1 | undefined, key2: K2 | undefined, value: V): void {
    const k1 = key1 ?? this.undefinedKey
    const k2 = key2 ?? this.undefinedKey
    if (!this.map.has(k1)) {
      this.map.set(k1, new Map<K2, V>())
    }

    const m = this.map.get(k1)!
    m.set(k2, value)
  }
}

/** 可包装成兼容只读 Set 的底层节点集合字段。 */
type ModuleSetNames = 'acceptedHmrDeps' | 'importedModules'

/** 创建把 EnvironmentModuleNode 惰性映射为 ModuleNode 的最小 Set 视图。 */
function createBackwardCompatibleModuleSet(
  moduleGraph: ModuleGraph,
  prop: ModuleSetNames,
  module: EnvironmentModuleNode,
): Set<ModuleNode> {
  return {
    /** 从兼容 key iterator 开始遍历集合。 */
    [Symbol.iterator]() {
      return this.keys()
    },
    /** 按模块 ID 映射到底层 Environment 节点后判断成员身份。 */
    has(key) {
      if (!key.id) {
        return false
      }
      const keyModule = moduleGraph
        ._getModuleGraph(module.environment)
        .getModuleById(key.id)
      return keyModule !== undefined && module[prop].has(keyModule)
    },
    /** Set 的 value 与 key 相同，统一复用 keys() 的惰性包装。 */
    values() {
      return this.keys()
    },
    /** 惰性把底层节点 key 转为稳定的旧 ModuleNode。 */
    keys() {
      return mapIterator(module[prop].keys(), (mod) =>
        moduleGraph.getBackwardCompatibleModuleNode(mod),
      )
    },
    /** 返回当前底层集合大小，不额外物化兼容集合。 */
    get size() {
      return module[prop].size
    },
    /** 以旧 ModuleNode 形态遍历底层集合，并保持原 thisArg。 */
    forEach(callback, thisArg) {
      return module[prop].forEach((mod) => {
        const backwardCompatibleMod =
          moduleGraph.getBackwardCompatibleModuleNode(mod)
        callback.call(
          thisArg,
          backwardCompatibleMod,
          backwardCompatibleMod,
          this,
        )
      })
    },
    // 当前只实现生态已使用的读取方法；若下游依赖 add/clear/delete 或新 Set 集合运算，再补充。
  } as Set<ModuleNode>
}

/** 创建把底层节点 Map 惰性包装成 ModuleNode Map 的兼容视图。 */
function createBackwardCompatibleModuleMap(
  moduleGraph: ModuleGraph,
  prop: 'urlToModuleMap' | 'idToModuleMap' | 'etagToModuleMap',
  getModuleMap: () => Map<string, EnvironmentModuleNode>,
): Map<string, ModuleNode> {
  return {
    /** Map 默认遍历 entries，避免预先复制双图内容。 */
    [Symbol.iterator]() {
      return this.entries()
    },
    /** 同时查询 client/SSR 索引并返回稳定双节点代理。 */
    get(key) {
      const clientModule = moduleGraph._client[prop].get(key)
      const ssrModule = moduleGraph._ssr[prop].get(key)
      if (!clientModule && !ssrModule) {
        return
      }
      return moduleGraph.getBackwardCompatibleModuleNodeDual(
        clientModule,
        ssrModule,
      )
    },
    /** 把兼容节点按所属端写回两张底层索引。 */
    set(key, mod) {
      const clientModule = mod._clientModule
      if (clientModule) {
        moduleGraph._client[prop].set(key, clientModule)
      }
      const ssrModule = mod._ssrModule
      if (ssrModule) {
        moduleGraph._ssr[prop].set(key, ssrModule)
      }
    },
    /** 返回 client 优先并集的键 iterator。 */
    keys() {
      return getModuleMap().keys()
    },
    /** 惰性把并集中的底层节点映射为兼容节点。 */
    values() {
      return mapIterator(getModuleMap().values(), (mod) =>
        moduleGraph.getBackwardCompatibleModuleNode(mod),
      )
    },
    /** 惰性返回键与兼容 ModuleNode 组成的条目。 */
    entries() {
      return mapIterator(getModuleMap().entries(), ([key, mod]) => [
        key,
        moduleGraph.getBackwardCompatibleModuleNode(mod),
      ])
    },
    /** 返回当前双图并集中的键数量。 */
    get size() {
      return getModuleMap().size
    },
    /** 以兼容节点形态遍历当前双图并集。 */
    forEach(callback, thisArg) {
      return getModuleMap().forEach((mod, key) => {
        const backwardCompatibleMod =
          moduleGraph.getBackwardCompatibleModuleNode(mod)
        callback.call(thisArg, backwardCompatibleMod, key, this)
      })
    },
  } as Map<string, ModuleNode>
}

/** 创建 client/ssr fileToModules 并集的兼容 Map 视图。 */
function createBackwardCompatibleFileToModulesMap(
  moduleGraph: ModuleGraph,
): Map<string, Set<ModuleNode>> {
  /** 生成 client 优先、按模块 ID 去重的 fileToModules 并集。 */
  const getFileToModulesMap = (): Map<string, Set<EnvironmentModuleNode>> => {
    // client key 优先；SSR 同文件节点按 ID 去重后补入。SSR 为空时直接暴露 client Map。
    if (!moduleGraph._ssr.fileToModulesMap.size) {
      return moduleGraph._client.fileToModulesMap
    }
    const map = new Map(moduleGraph._client.fileToModulesMap)
    for (const [key, modules] of moduleGraph._ssr.fileToModulesMap) {
      const modulesSet = map.get(key)
      if (!modulesSet) {
        map.set(key, modules)
      } else {
        for (const ssrModule of modules) {
          let hasModule = false
          for (const clientModule of modulesSet) {
            hasModule ||= clientModule.id === ssrModule.id
            if (hasModule) {
              break
            }
          }
          if (!hasModule) {
            modulesSet.add(ssrModule)
          }
        }
      }
    }
    return map
  }
  /** 把同一文件的一组底层节点映射为兼容节点集合。 */
  const getBackwardCompatibleModules = (
    modules: Set<EnvironmentModuleNode>,
  ): Set<ModuleNode> =>
    new Set(
      [...modules].map((mod) =>
        moduleGraph.getBackwardCompatibleModuleNode(mod),
      ),
    )

  return {
    /** Map 默认遍历文件到节点集合的 entries。 */
    [Symbol.iterator]() {
      return this.entries()
    },
    /** 合并指定文件在 client/SSR 图中的节点并转换为兼容集合。 */
    get(key) {
      const clientModules = moduleGraph._client.fileToModulesMap.get(key)
      const ssrModules = moduleGraph._ssr.fileToModulesMap.get(key)
      if (!clientModules && !ssrModules) {
        return
      }
      const modules = clientModules ?? new Set<EnvironmentModuleNode>()
      if (ssrModules) {
        for (const ssrModule of ssrModules) {
          if (ssrModule.id) {
            let found = false
            for (const mod of modules) {
              found ||= mod.id === ssrModule.id
              if (found) {
                break
              }
            }
            if (!found) {
              modules.add(ssrModule)
            }
          }
        }
      }
      return getBackwardCompatibleModules(modules)
    },
    /** 返回两图文件索引并集的键 iterator。 */
    keys() {
      return getFileToModulesMap().keys()
    },
    /** 惰性把每个底层节点集合转换为兼容集合。 */
    values() {
      return mapIterator(
        getFileToModulesMap().values(),
        getBackwardCompatibleModules,
      )
    },
    /** 惰性返回文件名与兼容节点集合组成的条目。 */
    entries() {
      return mapIterator(getFileToModulesMap().entries(), ([key, modules]) => [
        key,
        getBackwardCompatibleModules(modules),
      ])
    },
    /** 返回当前文件索引并集的键数量。 */
    get size() {
      return getFileToModulesMap().size
    },
    /** 以兼容节点集合遍历文件索引并集。 */
    forEach(callback, thisArg) {
      return getFileToModulesMap().forEach((modules, key) => {
        callback.call(thisArg, getBackwardCompatibleModules(modules), key, this)
      })
    },
  } as Map<string, Set<ModuleNode>>
}
