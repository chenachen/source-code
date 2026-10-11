import { extname } from 'node:path'
import type { ModuleInfo, PartialResolvedId } from 'rolldown'
import { isDirectCSSRequest } from '../plugins/css'
import {
  monotonicDateNow,
  normalizePath,
  removeImportQuery,
  removeTimestampQuery,
} from '../utils'
import { FS_PREFIX } from '../constants'
import { cleanUrl } from '../../shared/utils'
import type { TransformResult } from './transformRequest'

/**
 * 单个 Environment 中一个规范模块身份及其转换/HMR 状态。
 * URL 是浏览器/Runner 请求身份，id 是插件 resolve 后身份，file 是去 query 的磁盘关联；三者
 * 不必相同。
 */
export class EnvironmentModuleNode {
  /** 所属 Environment 名称。 */
  environment: string
  /**
   * 对外提供的 URL，通常以 `/` 开头。
   */
  url: string
  /**
   * resolveId 得到的规范 ID，可包含 query；未解析前为 null。
   */
  id: string | null = null
  /** 从 ID 清理 query 后的文件路径/虚拟关联键。 */
  file: string | null = null
  /** 决定 HMR 软失效能力和直接 CSS 响应的粗粒度模块类型。 */
  type: 'js' | 'css' | 'asset'
  /** 插件容器维护的 Rolldown ModuleInfo。 */
  info?: ModuleInfo
  /** resolve/load/transform hook 合并的插件元数据。 */
  meta?: Record<string, any>
  /** 直接导入当前模块的反向边。 */
  importers: Set<EnvironmentModuleNode> = new Set()

  /** 当前模块直接导入的正向边。 */
  importedModules: Set<EnvironmentModuleNode> = new Set()

  /** 当前模块显式 accept 的 HMR 依赖。 */
  acceptedHmrDeps: Set<EnvironmentModuleNode> = new Set()
  /** 当前模块通过 acceptExports 接受的导出名；null 表示未声明。 */
  acceptedHmrExports: Set<string> | null = null
  /** 每个依赖实际导入的 binding，用于部分导出 HMR 分析。 */
  importedBindings: Map<string, Set<string>> | null = null
  /** 是否接受自身更新；构造早期可暂为 undefined。 */
  isSelfAccepting?: boolean
  /** 最近一次新鲜的转换结果；失效时清空。 */
  transformResult: TransformResult | null = null

  /** ssrLoadModule 兼容层回写的已求值 namespace；基础 ModuleRunner 另有自己的执行缓存。 */
  ssrModule: Record<string, any> | null = null
  /** 旧 SSR loader 缓存的模块求值异常；新 Module Runner 不再依赖。 */
  ssrError: Error | null = null

  /** 最近一次 HMR 传播使用的时间戳，写入 client import 的 `?t=`。 */
  lastHMRTimestamp = 0
  /**
   * client 调用 `import.meta.hot.invalidate` 后，同一模块可能被多个客户端重复上报。该标记
   * 在一次 HMR 周期内去重，避免重复传播更新。
   * @internal
   */
  lastHMRInvalidationReceived = false
  /** 最近一次非 HMR/内容失效的单调时间，用于阻止在途旧 transform 写缓存。 */
  lastInvalidationTimestamp = 0
  /**
   * 软失效只需更新 import 时间戳，保存旧 transformResult 供下一请求修补；硬失效必须完整重做。
   *
   * undefined 表示未失效；TransformResult 表示软失效；`HARD_INVALIDATED` 表示硬失效。
   * @internal
   */
  invalidationState: TransformResult | 'HARD_INVALIDATED' | undefined
  /**
   * 源码中的静态 import URL 子集。`importedModules` 还包含 watch/glob 等关系，只有静态边可在
   * 依赖变化时仅改写时间戳；其他边必须硬失效 importer。
   * @internal
   */
  staticImportedUrls?: Set<string>

  /**
   * 保存环境和请求身份，直接 CSS 请求标为 css，其余初始标为 js；尚不解析 ID 或文件。
   * @param setIsSelfAccepting 传 false 可把 isSelfAccepting 留给稍后分析设置，例如 #7870。
   */
  constructor(url: string, environment: string, setIsSelfAccepting = true) {
    this.environment = environment
    this.url = url
    this.type = isDirectCSSRequest(url) ? 'css' : 'js'
    if (setIsSelfAccepting) {
      this.isSelfAccepting = false
    }
  }
}

/** URL 规范化结果：公开 URL、插件 resolved ID 与 resolve meta。 */
export type ResolvedUrl = [
  url: string,
  resolvedId: string,
  meta: object | null | undefined,
]

/**
 * 单个 Environment 的模块图与多索引缓存。
 * 同一文件可因 query 对应多个 ModuleNode，同一 ID 也可由多个 URL 访问；图负责维持这些身份
 * 映射、import 双向边、HMR accept 信息和失效传播。
 */
export class EnvironmentModuleGraph {
  /** 所属 Environment 名称。 */
  environment: string

  /** 规范公开 URL → 模块。 */
  urlToModuleMap: Map<string, EnvironmentModuleNode> = new Map()
  /** resolve 后 ID → 模块。 */
  idToModuleMap: Map<string, EnvironmentModuleNode> = new Map()
  /** client ETag → 模块，用于请求进入 transform 前的 304 快路径。 */
  etagToModuleMap: Map<string, EnvironmentModuleNode> = new Map()
  // 同一文件可对应 `?raw`、`?url`、普通模块等多个节点。
  fileToModulesMap: Map<string, Set<EnvironmentModuleNode>> = new Map()

  /** 原始未解析 URL → 节点或正在解析的 Promise，用于并发去重。 @internal */
  _unresolvedUrlToModuleMap: Map<
    string,
    EnvironmentModuleNode | Promise<EnvironmentModuleNode>
  > = new Map()

  /** 当前 Environment 的 resolveId 回调。 @internal */
  _resolveId: (url: string) => Promise<PartialResolvedId | null>

  /** resolve 曾失败且用于错误恢复的节点集合。 @internal */
  _hasResolveFailedErrorModules: Set<EnvironmentModuleNode> = new Set()

  /** 创建空图并绑定 URL resolver；不预建任何节点。 */
  constructor(
    environment: string,
    resolveId: (url: string) => Promise<PartialResolvedId | null>,
  ) {
    this.environment = environment
    this._resolveId = resolveId
  }

  /** 按请求 URL 查节点；先走未解析 URL 快路径，必要时 resolve 扩展名/ID 后再查。 */
  async getModuleByUrl(
    rawUrl: string,
  ): Promise<EnvironmentModuleNode | undefined> {
    // 时间戳和 ?import 不参与长期模块身份；无扩展名原 URL 也可能已缓存。
    rawUrl = removeImportQuery(removeTimestampQuery(rawUrl))
    const mod = this._getUnresolvedUrlToModule(rawUrl)
    if (mod) {
      return mod
    }

    const [url] = await this._resolveUrl(rawUrl)
    return this.urlToModuleMap.get(url)
  }

  /** 按 resolved ID 查节点；HMR 时间戳不参与身份。 */
  getModuleById(id: string): EnvironmentModuleNode | undefined {
    return this.idToModuleMap.get(removeTimestampQuery(id))
  }

  /** 返回同一磁盘文件衍生的全部 query/类型节点。 */
  getModulesByFile(file: string): Set<EnvironmentModuleNode> | undefined {
    return this.fileToModulesMap.get(file)
  }

  /** 文件内容变化时，以共享 seen 集合硬失效其所有节点及未 accept 的 importers。 */
  onFileChange(file: string): void {
    const mods = this.getModulesByFile(file)
    if (mods) {
      const seen = new Set<EnvironmentModuleNode>()
      mods.forEach((mod) => {
        this.invalidateModule(mod, seen)
      })
    }
  }

  /** 文件删除时断开这些节点作为 importer 建立的反向边。 */
  onFileDelete(file: string): void {
    const mods = this.getModulesByFile(file)
    if (mods) {
      mods.forEach((mod) => {
        mod.importedModules.forEach((importedMod) => {
          importedMod.importers.delete(mod)
        })
      })
    }
  }

  /**
   * 失效模块并递归传播到未 accept 它的 importers。
   * 静态 JS importer 可软失效，仅在下一请求重写依赖时间戳；直接 CSS 和由硬失效经
   * watch/glob 等非静态边到达的 importer 必须完整重做；软失效可继续沿 JS importer
   * 向上传播。seen 同时阻止循环图无限递归。
   */
  invalidateModule(
    mod: EnvironmentModuleNode,
    seen: Set<EnvironmentModuleNode> = new Set(),
    timestamp: number = monotonicDateNow(),
    isHmr: boolean = false,
    /** @internal */
    softInvalidate = false,
  ): void {
    const prevInvalidationState = mod.invalidationState

    // 必须在 seen 判断前合并软/硬状态：同一递归中后到的硬失效需要升级先前软失效。软失效保存
    // 旧结果；没有旧结果时无法修补，只能退化为硬失效。
    if (softInvalidate) {
      mod.invalidationState ??= mod.transformResult ?? 'HARD_INVALIDATED'
    }
    // 硬失效优先级最高，后续软失效不能降级。
    else {
      mod.invalidationState = 'HARD_INVALIDATED'
    }

    // 已访问且最终失效状态没变化时停止，既防循环又允许软→硬升级后再传播一次。
    if (seen.has(mod) && prevInvalidationState === mod.invalidationState) {
      return
    }
    seen.add(mod)

    if (isHmr) {
      mod.lastHMRTimestamp = timestamp
      mod.lastHMRInvalidationReceived = false
    } else {
      // 非 HMR 失效记录时间，阻止更早启动的在途 transform 把旧结果写回。
      mod.lastInvalidationTimestamp = timestamp
    }

    // info/meta 属于插件处理上下文，不随单次 transformResult 一起抹除；清结果已足以触发重做。
    const etag = mod.transformResult?.etag
    if (etag) this.etagToModuleMap.delete(etag)

    mod.transformResult = null

    mod.ssrModule = null
    mod.ssrError = null

    mod.importers.forEach((importer) => {
      if (!importer.acceptedHmrDeps.has(mod)) {
        // 静态 import 可只更新 importer 中的时间戳；watch/glob 等非静态关系只有下游本身也是
        // 软失效时才能继续软传播。直接 CSS 无 JS import specifier 可改写，始终硬失效。
        const shouldSoftInvalidateImporter =
          (importer.staticImportedUrls?.has(mod.url) || softInvalidate) &&
          importer.type === 'js'
        this.invalidateModule(
          importer,
          seen,
          timestamp,
          isHmr,
          shouldSoftInvalidateImporter,
        )
      }
    })

    this._hasResolveFailedErrorModules.delete(mod)
  }

  /** 用同一时间戳和 seen 集合硬失效图中所有模块。 */
  invalidateAll(): void {
    const timestamp = monotonicDateNow()
    const seen = new Set<EnvironmentModuleNode>()
    this.idToModuleMap.forEach((mod) => {
      this.invalidateModule(mod, seen, timestamp)
    })
  }

  /**
   * 用 import analysis 的最新结果更新正向/反向依赖、HMR accept、binding 与静态边。
   * 不再被任何模块导入的旧依赖作为 Set 返回，供上层清理/处理。
   * 解析期间就会添加 dep.importers；若某个解析失败，已写入的边不会在这里回滚。
   *
   * @param staticImportedUrls importedModules 中来自源码静态 import 的 URL 子集；缺省不影响正确性，
   * 但失效时会进行更多完整 transform。
   */
  async updateModuleInfo(
    mod: EnvironmentModuleNode,
    importedModules: Set<string | EnvironmentModuleNode>,
    importedBindings: Map<string, Set<string>> | null,
    acceptedModules: Set<string | EnvironmentModuleNode>,
    acceptedExports: Set<string> | null,
    isSelfAccepting: boolean,
    /** @internal */
    staticImportedUrls?: Set<string>,
  ): Promise<Set<EnvironmentModuleNode> | undefined> {
    mod.isSelfAccepting = isSelfAccepting
    const prevImports = mod.importedModules
    let noLongerImported: Set<EnvironmentModuleNode> | undefined

    let resolvePromises = []
    let resolveResults = new Array(importedModules.size)
    let index = 0
    // 并行把字符串 URL 解析成节点，同时建立 dep.importers 反向边；已有节点直接复用。
    for (const imported of importedModules) {
      const nextIndex = index++
      if (typeof imported === 'string') {
        resolvePromises.push(
          this.ensureEntryFromUrl(imported).then((dep) => {
            dep.importers.add(mod)
            resolveResults[nextIndex] = dep
          }),
        )
      } else {
        imported.importers.add(mod)
        resolveResults[nextIndex] = imported
      }
    }

    if (resolvePromises.length) {
      await Promise.all(resolvePromises)
    }

    const nextImports = new Set(resolveResults)
    mod.importedModules = nextImports

    // 从已删除 import 的依赖上移除反向边，并报告成为孤儿的节点。
    prevImports.forEach((dep) => {
      if (!mod.importedModules.has(dep)) {
        dep.importers.delete(mod)
        if (!dep.importers.size) {
          // 依赖已没有任何 importer。
          ;(noLongerImported || (noLongerImported = new Set())).add(dep)
        }
      }
    })

    // HMR acceptedModules 同样规范化成节点，但不建立普通 import 反向边。
    resolvePromises = []
    resolveResults = new Array(acceptedModules.size)
    index = 0
    for (const accepted of acceptedModules) {
      const nextIndex = index++
      if (typeof accepted === 'string') {
        resolvePromises.push(
          this.ensureEntryFromUrl(accepted).then((dep) => {
            resolveResults[nextIndex] = dep
          }),
        )
      } else {
        resolveResults[nextIndex] = accepted
      }
    }

    if (resolvePromises.length) {
      await Promise.all(resolvePromises)
    }

    mod.acceptedHmrDeps = new Set(resolveResults)
    mod.staticImportedUrls = staticImportedUrls

    // 最后提交 accepted exports 与实际 imported bindings。
    mod.acceptedHmrExports = acceptedExports
    mod.importedBindings = importedBindings
    return noLongerImported
  }

  /** 确保 URL 有且只有一个图节点，并返回它。 */
  async ensureEntryFromUrl(
    rawUrl: string,
    setIsSelfAccepting = true,
  ): Promise<EnvironmentModuleNode> {
    return this._ensureEntryFromUrl(rawUrl, setIsSelfAccepting)
  }

  /**
   * ensureEntryFromUrl 的内部版本，可复用调用方已有 resolve 结果。
   * 原始 URL 的在途 Promise 成功后替换成节点；拒绝时没有删除槽位，同 URL 会复用该拒绝。
   * @internal
   */
  async _ensureEntryFromUrl(
    rawUrl: string,
    setIsSelfAccepting = true,
    // 调用方已 resolve 时避免重复插件调用。
    resolved?: PartialResolvedId,
  ): Promise<EnvironmentModuleNode> {
    // 原始 URL 的节点/在途 Promise 快路径负责并发去重。
    rawUrl = removeImportQuery(removeTimestampQuery(rawUrl))
    let mod = this._getUnresolvedUrlToModule(rawUrl)
    if (mod) {
      return mod
    }
    const modPromise = (async () => {
      const [url, resolvedId, meta] = await this._resolveUrl(rawUrl, resolved)
      mod = this.idToModuleMap.get(resolvedId)
      if (!mod) {
        mod = new EnvironmentModuleNode(
          url,
          this.environment,
          setIsSelfAccepting,
        )
        if (meta) mod.meta = meta
        this.urlToModuleMap.set(url, mod)
        mod.id = resolvedId
        this.idToModuleMap.set(resolvedId, mod)
        const file = (mod.file = cleanUrl(resolvedId))
        let fileMappedModules = this.fileToModulesMap.get(file)
        if (!fileMappedModules) {
          fileMappedModules = new Set()
          this.fileToModulesMap.set(file, fileMappedModules)
        }
        fileMappedModules.add(mod)
      }
      // 多个 URL 可映射同一 ID；新增 URL 也要指向现有节点。
      else if (!this.urlToModuleMap.has(url)) {
        this.urlToModuleMap.set(url, mod)
      }
      this._setUnresolvedUrlToModule(rawUrl, mod)
      return mod
    })()

    // resolve 完成前先缓存 Promise，使并发相同 URL 共享一次 resolver 与节点创建。
    this._setUnresolvedUrlToModule(rawUrl, modPromise)
    return modPromise
  }

  /**
   * 为没有独立请求 URL 的文件创建 asset 节点，例如被 `@import` 内联的 CSS 依赖。它仍需入图，
   * 文件变化才能沿 importer 触发 HMR。
   * 只登记 fileToModulesMap，ID 保持 null，不登记普通 URL/ID 请求索引。
   */
  createFileOnlyEntry(file: string): EnvironmentModuleNode {
    file = normalizePath(file)
    let fileMappedModules = this.fileToModulesMap.get(file)
    if (!fileMappedModules) {
      fileMappedModules = new Set()
      this.fileToModulesMap.set(file, fileMappedModules)
    }

    const url = `${FS_PREFIX}${file}`
    for (const m of fileMappedModules) {
      if ((m.url === url || m.id === file) && m.type === 'asset') {
        return m
      }
    }

    const mod = new EnvironmentModuleNode(url, this.environment)
    mod.type = 'asset'
    mod.file = file
    fileMappedModules.add(mod)
    return mod
  }

  /**
   * 规范化来访 URL：移除 `?t=`/`?import`，并补 resolved ID 的扩展名，使有/无扩展名请求映射
   * 到同一模块。
   */
  async resolveUrl(url: string): Promise<ResolvedUrl> {
    url = removeImportQuery(removeTimestampQuery(url))
    const mod = await this._getUnresolvedUrlToModule(url)
    if (mod?.id) {
      return [mod.url, mod.id, mod.meta]
    }
    return this._resolveUrl(url)
  }

  /** 更新节点转换结果，并仅为 client 维护 ETag 反向索引。 */
  updateModuleTransformResult(
    mod: EnvironmentModuleNode,
    result: TransformResult | null,
  ): void {
    if (this.environment === 'client') {
      const prevEtag = mod.transformResult?.etag
      if (prevEtag) this.etagToModuleMap.delete(prevEtag)
      if (result?.etag) this.etagToModuleMap.set(result.etag, mod)
    }

    mod.transformResult = result
  }

  /** 按 client 响应 ETag 找模块，用于 HTTP 304 快路径。 */
  getModuleByEtag(etag: string): EnvironmentModuleNode | undefined {
    return this.etagToModuleMap.get(etag)
  }

  /** 读取未解析 URL 的节点/在途 Promise。 @internal */
  _getUnresolvedUrlToModule(
    url: string,
  ): Promise<EnvironmentModuleNode> | EnvironmentModuleNode | undefined {
    return this._unresolvedUrlToModuleMap.get(url)
  }
  /** 写入未解析 URL 快速索引。 @internal */
  _setUnresolvedUrlToModule(
    url: string,
    mod: Promise<EnvironmentModuleNode> | EnvironmentModuleNode,
  ): void {
    this._unresolvedUrlToModuleMap.set(url, mod)
  }

  /** 执行 resolve 并让公开 URL 补齐 resolved ID 扩展名，虚拟 ID 除外。 @internal */
  async _resolveUrl(
    url: string,
    alreadyResolved?: PartialResolvedId,
  ): Promise<ResolvedUrl> {
    const resolved = alreadyResolved ?? (await this._resolveId(url))
    const resolvedId = resolved?.id || url
    if (
      url !== resolvedId &&
      !url.includes('\0') &&
      !url.startsWith(`virtual:`)
    ) {
      const ext = extname(cleanUrl(resolvedId))
      if (ext) {
        const pathname = cleanUrl(url)
        if (!pathname.endsWith(ext)) {
          url = pathname + ext + url.slice(pathname.length)
        }
      }
    }
    return [url, resolvedId, resolved?.meta]
  }
}
