import type { ViteHotContext } from '#types/hot'
import { HMRClient, HMRContext, type HMRLogger } from '../shared/hmr'
import { cleanUrl, isPrimitive } from '../shared/utils'
import { analyzeImportedModDifference } from '../shared/ssrTransform'
import {
  type NormalizedModuleRunnerTransport,
  normalizeModuleRunnerTransport,
} from '../shared/moduleRunnerTransport'
import { createIsBuiltin } from '../shared/builtin'
import type { EvaluatedModuleNode } from './evaluatedModules'
import { EvaluatedModules } from './evaluatedModules'
import type {
  ModuleEvaluator,
  ModuleRunnerContext,
  ModuleRunnerOptions,
  ResolvedResult,
  SSRImportMetadata,
} from './types'
import { posixDirname, posixPathToFileHref, posixResolve } from './utils'
import {
  ssrDynamicImportKey,
  ssrExportAllKey,
  ssrExportNameKey,
  ssrImportKey,
  ssrImportMetaKey,
  ssrModuleExportsKey,
} from './constants'
import { hmrLogger, silentConsole } from './hmrLogger'
import { createHMRHandlerForRunner } from './hmrHandler'
import { enableSourceMapSupport } from './sourcemap/index'
import { ESModulesEvaluator } from './esmEvaluator'
import { createDefaultImportMeta } from './createImportMeta'

/** 接收 Module Runner 诊断格式串与参数的可选调试输出器。 */
interface ModuleRunnerDebugger {
  /** 输出一条惰性诊断消息。 */
  (formatter: unknown, ...args: unknown[]): void
}

/**
 * 在任意 JavaScript 运行时中执行 Vite 变换模块的客户端。
 *
 * 它通过 transport 向开发服务器请求解析/代码，维护独立 evaluated module graph，
 * 区分 internal/external 执行，并可接入 HMR 与 sourcemap 拦截器。
 */
export class ModuleRunner {
  /** 当前 Runner 独占或由调用方注入的已求值模块图。 */
  public evaluatedModules: EvaluatedModules
  /** 启用 HMR 时创建的客户端状态机。 */
  public hmrClient?: HMRClient

  /** 补齐 connect/invoke 等能力后的统一传输层。 */
  private readonly transport: NormalizedModuleRunnerTransport
  /** 恢复全局 sourcemap 拦截器的幂等清理函数。 */
  private readonly resetSourceMapSupport?: () => void
  /** 合并同一原始 URL 的并发模块信息请求。 */
  private readonly concurrentModuleNodePromises = new Map<
    string,
    Promise<EvaluatedModuleNode>
  >()
  /** 服务端规则编译出的运行时 builtin 判定器。 */
  private isBuiltin?: (id: string) => boolean
  /** builtin 规则首次拉取期间共享的初始化 Promise。 */
  private builtinsPromise?: Promise<void>

  /** close 后阻止继续访问 transport。 */
  private closed = false

  /** 初始化模块图、传输层、可选 HMR 和 sourcemap 支持。 */
  constructor(
    public options: ModuleRunnerOptions,
    public evaluator: ModuleEvaluator = new ESModulesEvaluator(),
    private debug?: ModuleRunnerDebugger | undefined,
  ) {
    this.evaluatedModules = options.evaluatedModules ?? new EvaluatedModules()
    this.transport = normalizeModuleRunnerTransport(options.transport)
    if (options.hmr !== false) {
      const optionsHmr = options.hmr ?? true
      const resolvedHmrLogger: HMRLogger =
        optionsHmr === true || optionsHmr.logger === undefined
          ? hmrLogger
          : optionsHmr.logger === false
            ? silentConsole
            : optionsHmr.logger
      this.hmrClient = new HMRClient(
        resolvedHmrLogger,
        this.transport,
        ({ acceptedPath }) => this.import(acceptedPath),
      )
      if (!this.transport.connect) {
        throw new Error(
          'HMR is not supported by this runner transport, but `hmr` option was set to true',
        )
      }
      this.transport.connect(createHMRHandlerForRunner(this))
    } else {
      this.transport.connect?.()
    }
    if (options.sourcemapInterceptor !== false) {
      this.resetSourceMapSupport = enableSourceMapSupport(this)
    }
  }

  /**
   * 执行 URL；接受文件路径、server URL 或相对 root 的 id。
   */
  public async import<T = any>(url: string): Promise<T> {
    const fetchedModule = await this.cachedModule(url)
    return await this.cachedRequest(url, fetchedModule)
  }

  /**
   * 清空模块缓存与全部 HMR listeners。
   */
  public clearCache(): void {
    this.evaluatedModules.clear()
    this.hmrClient?.clear()
  }

  /**
   * 清空缓存/listeners、恢复 sourcemap 全局钩子并断开 transport。
   */
  public async close(): Promise<void> {
    this.resetSourceMapSupport?.()
    this.clearCache()
    this.hmrClient = undefined
    this.closed = true
    await this.transport.disconnect?.()
  }

  /**
   * `close()` 调用后返回 true。
   */
  public isClosed(): boolean {
    return this.closed
  }

  /** 对 external ESM/CJS namespace 执行导入形态兼容检查与提示。 */
  private processImport(
    exports: Record<string, any>,
    fetchResult: ResolvedResult,
    metadata?: SSRImportMetadata,
  ) {
    if (!('externalize' in fetchResult)) {
      return exports
    }
    const { url, type } = fetchResult
    if (type !== 'module' && type !== 'commonjs') return exports
    analyzeImportedModDifference(exports, url, type, metadata)
    return exports
  }

  /** 沿尚未完成的 imports 图检查当前 callstack 是否构成间接循环。 */
  private isCircularRequest(
    mod: EvaluatedModuleNode,
    callstack: string[],
    visited = new Set<string>(),
  ): boolean {
    if (visited.has(mod.id)) {
      return false
    }
    visited.add(mod.id)

    for (const importedModuleId of mod.imports) {
      if (callstack.includes(importedModuleId)) {
        return true
      }

      const importedModule =
        this.evaluatedModules.getModuleById(importedModuleId)
      if (
        importedModule?.promise &&
        !importedModule.evaluated &&
        this.isCircularRequest(importedModule, callstack, visited)
      ) {
        return true
      }
    }

    return false
  }

  /**
   * 复用模块执行 Promise，并在循环依赖时提前返回已创建的 exports namespace，
   * 避免互相 await 死锁；已完成模块则直接等待缓存 Promise。
   */
  private async cachedRequest(
    url: string,
    mod: EvaluatedModuleNode,
    callstack: string[] = [],
    metadata?: SSRImportMetadata,
  ): Promise<any> {
    const meta = mod.meta!
    const moduleId = meta.id

    const importee = callstack[callstack.length - 1]

    if (importee) mod.importers.add(importee)

    // 已完成模块不可能再与当前栈互锁，直接复用结果。
    if (mod.evaluated && mod.promise) {
      return this.processImport(await mod.promise, meta, metadata)
    }

    if (mod.promise) {
      if (
        mod.exports &&
        (callstack.includes(moduleId) || this.isCircularRequest(mod, callstack))
      ) {
        return this.processImport(mod.exports, meta, metadata)
      }
      return this.processImport(await mod.promise, meta, metadata)
    }

    let debugTimer: any
    if (this.debug) {
      debugTimer = setTimeout(() => {
        /** 在慢模块告警触发时才格式化当前反向调用栈。 */
        const getStack = () =>
          `stack:\n${[...callstack, moduleId]
            .reverse()
            .map((p) => `  - ${p}`)
            .join('\n')}`

        this.debug!(
          `[module runner] module ${moduleId} takes over 2s to load.\n${getStack()}`,
        )
      }, 2000)
    }

    try {
      const promise = this.directRequest(url, mod, callstack)
      mod.promise = promise
      mod.evaluated = false
      return this.processImport(await promise, meta, metadata)
    } finally {
      mod.evaluated = true
      if (debugTimer) clearTimeout(debugTimer)
    }
  }

  /** 对同一原始 URL 的并发 fetch 合并为一个 Promise，并更新模块元信息缓存。 */
  private async cachedModule(
    url: string,
    importer?: string,
  ): Promise<EvaluatedModuleNode> {
    let cached = this.concurrentModuleNodePromises.get(url)
    if (!cached) {
      const cachedModule = this.evaluatedModules.getModuleByUrl(url)
      cached = this.getModuleInformation(url, importer, cachedModule).finally(
        () => {
          this.concurrentModuleNodePromises.delete(url)
        },
      )
      this.concurrentModuleNodePromises.set(url, cached)
    } else {
      this.debug?.('[module runner] using cached module info for', url)
    }

    return cached
  }

  /** 首次请求前从 server 获取 builtins 规则，并合并所有并发初始化。 */
  private ensureBuiltins(): Promise<void> | undefined {
    if (this.isBuiltin) return

    this.builtinsPromise ??= (async () => {
      try {
        this.debug?.('[module runner] fetching builtins from server')
        const serializedBuiltins = await this.transport.invoke(
          'getBuiltins',
          [],
        )
        const builtins = serializedBuiltins.map((builtin) =>
          typeof builtin === 'object' && builtin && 'type' in builtin
            ? builtin.type === 'string'
              ? builtin.value
              : new RegExp(builtin.source, builtin.flags)
            : // Vitest transport 直接返回原值，兼容该测试/自定义 transport 形态。
              builtin,
        )
        this.isBuiltin = createIsBuiltin(builtins)
        this.debug?.('[module runner] builtins loaded:', builtins)
      } finally {
        this.builtinsPromise = undefined
      }
    })()

    return this.builtinsPromise
  }

  /**
   * 向 transport 请求 external/cache/code 元信息，并把 server id/url 规范化到
   * evaluated graph；server 指示 invalidate 时清除旧执行状态。
   */
  private async getModuleInformation(
    url: string,
    importer: string | undefined,
    cachedModule: EvaluatedModuleNode | undefined,
  ): Promise<EvaluatedModuleNode> {
    if (this.closed) {
      throw new Error(`Vite module runner has been closed.`)
    }

    await this.ensureBuiltins()

    this.debug?.('[module runner] fetching', url)

    const isCached = !!(typeof cachedModule === 'object' && cachedModule.meta)

    const fetchedModule = // data/builtin 是已知 external，走快速路径，不发 RPC。
      (
        url.startsWith('data:') || this.isBuiltin?.(url)
          ? { externalize: url, type: 'builtin' }
          : await this.transport.invoke('fetchModule', [
              url,
              importer,
              {
                cached: isCached,
                startOffset: this.evaluator.startOffset,
              },
            ])
      ) as ResolvedResult

    if ('cache' in fetchedModule) {
      if (!cachedModule || !cachedModule.meta) {
        throw new Error(
          `Module "${url}" was mistakenly invalidated during fetch phase.`,
        )
      }
      return cachedModule
    }

    const moduleId =
      'externalize' in fetchedModule
        ? fetchedModule.externalize
        : fetchedModule.id
    const moduleUrl = 'url' in fetchedModule ? fetchedModule.url : url
    const module = this.evaluatedModules.ensureModule(moduleId, moduleUrl)

    if ('invalidate' in fetchedModule && fetchedModule.invalidate) {
      this.evaluatedModules.invalidateModule(module)
    }

    fetchedModule.url = moduleUrl
    fetchedModule.id = moduleId
    module.meta = fetchedModule

    return module
  }

  /**
   * 执行 internal/external 模块并建立 import.meta、导出 namespace 与依赖图边。
   * `protected` 允许运行时集成覆写 evaluator 或缓存桥接。
   */
  protected async directRequest(
    url: string,
    mod: EvaluatedModuleNode,
    _callstack: string[],
  ): Promise<any> {
    const fetchResult = mod.meta!
    const moduleId = fetchResult.id
    const callstack = [..._callstack, moduleId]

    /** 执行变换代码发起的静态 import，并同步 imports/importers 图边。 */
    const request = async (dep: string, metadata?: SSRImportMetadata) => {
      const importer = ('file' in fetchResult && fetchResult.file) || moduleId
      const depMod = await this.cachedModule(dep, importer)
      depMod.importers.add(moduleId)
      mod.imports.add(depMod.id)

      return this.cachedRequest(dep, depMod, callstack, metadata)
    }

    /** 动态 import 接受可 toString 的值，并把相对 specifier 相对当前 URL 解析。 */
    const dynamicRequest = async (dep: string) => {
      // JavaScript 允许 import() 参数是带 toString 的对象，先遵循语言强制转换。
      dep = String(dep)
      if (dep[0] === '.') {
        dep = posixResolve(posixDirname(url), dep)
      }
      return request(dep, { isDynamicImport: true })
    }

    if ('externalize' in fetchResult) {
      const { externalize } = fetchResult
      this.debug?.('[module runner] externalizing', externalize)
      const exports = await this.evaluator.runExternalModule(externalize)
      mod.exports = exports
      return exports
    }

    const { code, file } = fetchResult

    if (code == null) {
      const importer = callstack[callstack.length - 2]
      throw new Error(
        `[module runner] Failed to load "${url}"${
          importer ? ` imported from ${importer}` : ''
        }`,
      )
    }

    const createImportMeta =
      this.options.createImportMeta ?? createDefaultImportMeta

    const modulePath = cleanUrl(file || moduleId)
    // file href 消除 Windows `<DRIVE>:/` 与 URL scheme 的歧义（nodejs/node#31710）。
    const href = posixPathToFileHref(modulePath)
    const meta = await createImportMeta(modulePath)
    const exports = Object.create(null)
    Object.defineProperty(exports, Symbol.toStringTag, {
      value: 'Module',
      enumerable: false,
      configurable: false,
    })

    mod.exports = exports

    let hotContext: ViteHotContext | undefined
    if (this.hmrClient) {
      Object.defineProperty(meta, 'hot', {
        enumerable: true,
        get: () => {
          if (!this.hmrClient) {
            throw new Error(`[module runner] HMR client was closed.`)
          }
          this.debug?.('[module runner] creating hmr context for', mod.url)
          hotContext ||= new HMRContext(this.hmrClient, mod.url)
          return hotContext
        },
        set: (value) => {
          hotContext = value
        },
      })
    }

    const context: ModuleRunnerContext = {
      [ssrImportKey]: request,
      [ssrDynamicImportKey]: dynamicRequest,
      [ssrModuleExportsKey]: exports,
      [ssrExportAllKey]: (obj: any) => exportAll(exports, obj),
      [ssrExportNameKey]: (name, getter) =>
        Object.defineProperty(exports, name, {
          enumerable: true,
          configurable: true,
          get: getter,
        }),
      [ssrImportMetaKey]: meta,
    }

    this.debug?.('[module runner] executing', href)

    await this.evaluator.runInlinedModule(context, code, mod)

    return exports
  }
}

/**
 * 以 getter 转发 `export *`，过滤 default/__esModule 并保持 live binding；忽略
 * primitive/Array/Promise 和自导出，避免无意义属性遍历或递归栈溢出。
 */
function exportAll(exports: any, sourceModule: any) {
  // 模块 namespace 指向自身时递归定义会导致调用栈溢出。
  if (exports === sourceModule) return

  if (
    isPrimitive(sourceModule) ||
    Array.isArray(sourceModule) ||
    sourceModule instanceof Promise
  )
    return

  for (const key in sourceModule) {
    if (key !== 'default' && key !== '__esModule' && !(key in exports)) {
      try {
        Object.defineProperty(exports, key, {
          enumerable: true,
          configurable: true,
          get: () => sourceModule[key],
        })
      } catch {}
    }
  }
}
