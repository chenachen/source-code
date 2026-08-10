/**
 * 本文件最初基于 WMR 的 Rollup Plugin Container 实现重构为 TypeScript：
 * https://github.com/preactjs/wmr/blob/main/packages/wmr/src/lib/rollup-plugin-container.js
 */

/**
https://github.com/preactjs/wmr/blob/master/LICENSE

MIT License

Copyright (c) 2020 The Preact Authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseAst as rolldownParseAst } from 'rolldown/parseAst'
import type { ESTree } from 'rolldown/utils'
import type {
  AsyncPluginHooks,
  CustomPluginOptions,
  EmittedFile,
  FunctionPluginHooks,
  ImportKind,
  InputOptions,
  LoadResult,
  ModuleInfo,
  ModuleOptions,
  ModuleType,
  NormalizedInputOptions,
  OutputOptions,
  ParallelPluginHooks,
  PartialNull,
  PartialResolvedId,
  PluginContextMeta,
  ResolvedId,
  RollupError,
  RolldownFsModule as RollupFsModule,
  RollupLog,
  MinimalPluginContext as RollupMinimalPluginContext,
  PluginContext as RollupPluginContext,
  TransformPluginContext as RollupTransformPluginContext,
  SourceDescription,
  SourceMap,
  TransformResult,
} from 'rolldown'
import type { RawSourceMap } from '@jridgewell/remapping'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import MagicString from 'magic-string'
import colors from 'picocolors'
import type { FSWatcher } from '#dep-types/chokidar'
import type { Plugin } from '../plugin'
import {
  combineSourcemaps,
  createDebugger,
  ensureWatchedFile,
  generateCodeFrame,
  isExternalUrl,
  isObject,
  normalizePath,
  numberToPos,
  prettifyUrl,
  rolldownVersion,
  rollupVersion,
  timeFrom,
} from '../utils'
import { FS_PREFIX, VERSION as viteVersion } from '../constants'
import {
  createPluginHookUtils,
  getCachedFilterForPlugin,
  getHookHandler,
} from '../plugins'
import { cleanUrl, unwrapId } from '../../shared/utils'
import type { PluginHookUtils } from '../config'
import type { Environment } from '../environment'
import type { Logger } from '../logger'
import {
  isFutureDeprecationEnabled,
  warnFutureDeprecation,
} from '../deprecations'
import type { DevEnvironment } from './environment'
import { buildErrorMessage } from './middlewares/error'
import type {
  EnvironmentModuleGraph,
  EnvironmentModuleNode,
} from './moduleGraph'

/** 与 Rolldown/Rollup `ModuleInfo.meta` 默认值一致的共享只读空对象。 */
const EMPTY_OBJECT = Object.freeze({})

/** 只调试文件名含该子串的 Source Map 合并，避免大项目输出过量日志。 */
const debugSourcemapCombineFilter =
  process.env.DEBUG_VITE_SOURCEMAP_COMBINE_FILTER
/** `vite:sourcemap-combine` 调试输出器。 */
const debugSourcemapCombine = createDebugger('vite:sourcemap-combine', {
  onlyWhenFocused: true,
})
/** 汇总 raw ID 到 resolved ID 的首次映射。 */
const debugResolve = createDebugger('vite:resolve')
/** 记录单个 resolveId 插件耗时。 */
const debugPluginResolve = createDebugger('vite:plugin-resolve', {
  onlyWhenFocused: 'vite:plugin',
})
/** 记录单个 transform 插件耗时。 */
const debugPluginTransform = createDebugger('vite:plugin-transform', {
  onlyWhenFocused: 'vite:plugin',
})
/** BasicMinimalPluginContext 的 debug 日志出口。 */
const debugPluginContainerContext = createDebugger(
  'vite:plugin-container-context',
)

/** 服务器重启/关闭令当前请求过期时使用的稳定错误码。 */
export const ERR_CLOSED_SERVER = 'ERR_CLOSED_SERVER'

/**
 * 中断无法恢复的旧模块请求。
 * transform 中间件会识别该错误并返回 504 Request Timeout，让浏览器重新发起新请求，
 * 而不是把服务器重启误报成源码编译错误。
 */
export function throwClosedServerError(): never {
  const err: any = new Error(
    'The server is being restarted or closed. Request is outdated',
  )
  err.code = ERR_CLOSED_SERVER
  // 由 transform 中间件捕获并映射为 504。
  throw err
}

/** PluginContainer 在测试/兼容层可覆盖的 Rolldown 运行选项。 */
export interface PluginContainerOptions {
  /** 模块 ID 相对解析的工作目录。 */
  cwd?: string
  /** 模拟输出阶段时使用的 Rolldown 输出选项。 */
  output?: OutputOptions
  /** 预置的 ModuleInfo 容器。 */
  modules?: Map<
    string,
    {
      /** 该模块已经建立的 Rolldown 信息视图。 */
      info: ModuleInfo
    }
  >
  /** emitted file 的自定义写入实现。 */
  writeFile?: (name: string, source: string | Uint8Array) => void
}

/**
 * 为指定 Environment 创建开发态插件容器并解析 options 钩子。
 *
 * plugins 作为参数而不是直接读取 `environment.plugins`，允许同一 Environment 建立不同
 * 流水线；`createIdResolver` 就使用精简插件集合执行内部解析。
 */
export async function createEnvironmentPluginContainer<
  Env extends Environment = Environment,
>(
  environment: Env,
  plugins: readonly Plugin[],
  watcher?: FSWatcher,
  autoStart = true,
): Promise<EnvironmentPluginContainer<Env>> {
  const container = new EnvironmentPluginContainer(
    environment,
    plugins,
    watcher,
    autoStart,
  )
  await container.resolveRolldownOptions()
  return container
}

/**
 * 一次嵌套 `this.resolve()` 需要跳过的历史调用。
 * 以 plugin + id + importer 三元组跟踪，而不是只按插件跳过，避免不同请求被误判成递归
 * （#18903）。
 */
export type SkipInformation = {
  /** 本次解析的模块 ID。 */
  id: string
  /** 发起本次解析的模块。 */
  importer: string | undefined
  /** 已处理该三元组的插件。 */
  plugin: Plugin
  /** 同一调用链中该记录是否已被再次遇到。 */
  called?: boolean
}

/**
 * 单个 Environment 的开发态 Rolldown 插件模拟器。
 *
 * 它实现 options/buildStart/resolveId/load/transform/watchChange/buildEnd/closeBundle 等非
 * output 生命周期，把每个插件绑定到可复用 PluginContext，并与 ModuleGraph 同步 meta、
 * watch file 和 Source Map。生产构建使用真正的 Rolldown，不走此容器。
 */
class EnvironmentPluginContainer<Env extends Environment = Environment> {
  /** 每个插件复用一个上下文，保存当前活动模块和递归解析信息。 */
  private _pluginContextMap = new Map<Plugin, PluginContext>()
  /** options 钩子执行一次后的缓存。 */
  private _resolvedRolldownOptions?: InputOptions
  /** 尚未完成的异步 hook；关闭时必须等待，避免清理与插件任务竞态。 */
  private _processesing = new Set<Promise<any>>()
  /** 已输出过的 rawId→id 调试映射，防止重复刷屏。 */
  private _seenResolves: Record<string, true | undefined> = {}

  // 保存 load 钩子 addWatchFile 的结果，随后 transform 使用同一模块依赖集合。
  private _moduleNodeToLoadAddedImports = new WeakMap<
    EnvironmentModuleNode,
    Set<string> | null
  >()

  /** 按 hook order 查询已排序 handler。 */
  getSortedPluginHooks: PluginHookUtils['getSortedPluginHooks']
  /** 按 hook order 查询已排序插件。 */
  getSortedPlugins: PluginHookUtils['getSortedPlugins']

  /** 开发环境的模块图；build/scan Environment 可不提供。 */
  moduleGraph: EnvironmentModuleGraph | undefined
  /** 所有插件通过 addWatchFile 登记的路径。 */
  watchFiles: Set<string> = new Set()
  /** 无具体插件/模块归属的全局钩子上下文。 */
  minimalContext: MinimalPluginContext<Env>

  /** 是否已开始当前 Environment 的 buildStart 生命周期。 */
  private _started = false
  /** 合并并发首次启动请求的 buildStart 门闩。 */
  private _buildStartPromise: Promise<void> | undefined
  /** 关闭后阻止新的可恢复模块请求进入插件钩子。 */
  private _closed = false

  /**
   * @internal 请使用 `createEnvironmentPluginContainer()`，确保 options 钩子已完成解析。
   */
  constructor(
    public environment: Env,
    public plugins: readonly Plugin[],
    public watcher?: FSWatcher | undefined,
    autoStart = true,
  ) {
    this._started = !autoStart
    this.minimalContext = new MinimalPluginContext(
      { ...basePluginContextMeta, watchMode: true },
      environment,
    )
    const utils = createPluginHookUtils(plugins)
    this.getSortedPlugins = utils.getSortedPlugins
    this.getSortedPluginHooks = utils.getSortedPluginHooks
    this.moduleGraph =
      environment.mode === 'dev' ? environment.moduleGraph : undefined
  }

  /** 把 load 阶段登记的额外依赖绑定到模块图节点。 */
  private _updateModuleLoadAddedImports(
    id: string,
    addedImports: Set<string> | null,
  ): void {
    const module = this.moduleGraph?.getModuleById(id)
    if (module) {
      this._moduleNodeToLoadAddedImports.set(module, addedImports)
    }
  }

  /** 取回 load 阶段登记的依赖，供同一模块的 transform 上下文继承。 */
  private _getAddedImports(id: string): Set<string> | null {
    const module = this.moduleGraph?.getModuleById(id)
    return module
      ? this._moduleNodeToLoadAddedImports.get(module) || null
      : null
  }

  /**
   * 返回开发模块图中可支持的 ModuleInfo 视图。
   * 未支持字段通过 Proxy 抛出明确错误；`then` 特判为 undefined，避免 async 返回值把
   * ModuleInfo 误识别为 thenable。meta 会在 resolve/load/transform 阶段持续合并。
   */
  getModuleInfo(id: string): ModuleInfo | null {
    const module = this.moduleGraph?.getModuleById(id)
    if (!module) {
      return null
    }
    if (!module.info) {
      module.info = new Proxy(
        { id, meta: module.meta || EMPTY_OBJECT } as ModuleInfo,
        // 访问未实现字段立即报清晰错误，避免不兼容 Rollup 插件以隐晦方式继续失败。
        {
          /** 返回已实现字段，并拒绝开发容器无法提供的 output 信息。 */
          get(info: any, key: string) {
            if (key in info) {
              return info[key]
            }
            // Promise resolution 会探测 `then`；此时不能把 ModuleInfo 当错误字段处理。
            if (key === 'then') {
              return undefined
            }
            throw Error(
              `[vite] The "${key}" property of ModuleInfo is not supported.`,
            )
          },
        },
      )
    }
    return module.info ?? null
  }

  /** 跟踪异步 hook，并在 settle 后自动移出集合；同步返回值保持原样。 */
  private handleHookPromise<T>(maybePromise: undefined | T | Promise<T>) {
    if (!(maybePromise as any)?.then) {
      return maybePromise
    }
    const promise = maybePromise as Promise<T>
    this._processesing.add(promise)
    return promise.finally(() => this._processesing.delete(promise))
  }

  /** options 钩子解析后的最终 Rolldown InputOptions。 */
  get options(): InputOptions {
    return this._resolvedRolldownOptions!
  }

  /** 串行运行 options 钩子并缓存结果；重复读取不会再次触发插件副作用。 */
  async resolveRolldownOptions(): Promise<InputOptions> {
    if (!this._resolvedRolldownOptions) {
      let options = this.environment.config.build.rolldownOptions
      for (const optionsHook of this.getSortedPluginHooks('options')) {
        if (this._closed) {
          throwClosedServerError()
        }
        options =
          (await this.handleHookPromise(
            optionsHook.call(this.minimalContext, options),
          )) || options
      }
      this._resolvedRolldownOptions = options
    }
    return this._resolvedRolldownOptions
  }

  /** 惰性创建并缓存插件专属 PluginContext。 */
  private _getPluginContext(plugin: Plugin) {
    if (!this._pluginContextMap.has(plugin)) {
      this._pluginContextMap.set(plugin, new PluginContext(plugin, this))
    }
    return this._pluginContextMap.get(plugin)!
  }

  /**
   * 运行 Rolldown 并行钩子并忽略返回值。
   * 普通 handler 并行加入批次；声明 `sequential` 的 handler 会先等待当前批次清空，再独占
   * 执行，之后重新开始下一并行批次。
   */
  private async hookParallel<H extends AsyncPluginHooks & ParallelPluginHooks>(
    hookName: H,
    context: (plugin: Plugin) => ThisType<FunctionPluginHooks[H]>,
    args: (plugin: Plugin) => Parameters<FunctionPluginHooks[H]>,
    condition?: (plugin: Plugin) => boolean | undefined,
  ): Promise<void> {
    const parallelPromises: Promise<unknown>[] = []
    for (const plugin of this.getSortedPlugins(hookName)) {
      // 关闭后仍需让 buildEnd/closeBundle 完成善后，不能在通用调度器里抛 closed 错误。
      if (condition && !condition(plugin)) continue

      const hook = plugin[hookName]
      const handler: Function = getHookHandler(hook)
      if (
        (
          hook as {
            /** 要求该 handler 与前后并行批次隔离执行。 */
            sequential?: boolean
          }
        ).sequential
      ) {
        await Promise.all(parallelPromises)
        parallelPromises.length = 0
        await handler.apply(context(plugin), args(plugin))
      } else {
        parallelPromises.push(handler.apply(context(plugin), args(plugin)))
      }
    }
    await Promise.all(parallelPromises)
  }

  /**
   * 每个 Environment 最多启动一次 buildStart；并发首次请求共享同一个 Promise。
   * 开发模式完成插件初始化后，再把已声明输入登记为安全模块。
   */
  async buildStart(_options?: InputOptions): Promise<void> {
    if (this._started) {
      if (this._buildStartPromise) {
        await this._buildStartPromise
      }
      return
    }
    this._started = true
    const config = this.environment.getTopLevelConfig()
    const hookPromise = this.handleHookPromise(
      this.hookParallel(
        'buildStart',
        (plugin) => this._getPluginContext(plugin),
        () => [this.options as NormalizedInputOptions],
        (plugin) =>
          this.environment.name === 'client' ||
          config.server.perEnvironmentStartEndDuringDev ||
          plugin.perEnvironmentStartEndDuringDev,
      ),
    ) as Promise<void>
    this._buildStartPromise = (async () => {
      await hookPromise
      if (this.environment.mode === 'dev') {
        await this.environment._registerInputsAsSafeModules()
      }
    })()
    await this._buildStartPromise
    this._buildStartPromise = undefined
  }

  /**
   * 依次执行 resolveId，返回第一个非空结果（hookFirst）。
   *
   * 首次调用会惰性等待 buildStart；声明式 ID filter 在 handler 前执行；普通文件路径统一
   * normalize，外部 URL 与 `\0` 虚拟 ID 保持原样。skipCalls 精确阻止递归
   * `this.resolve()`，同时允许同一插件解析不同 id/importer（#18903）。
   */
  async resolveId(
    rawId: string,
    importer: string | undefined = join(
      this.environment.config.root,
      'index.html',
    ),
    options?: {
      /** 解析请求来自静态 import、动态 import 或 require 等语法类别。 */
      kind?: ImportKind
      /** import attributes；缺省时规范化为空对象。 */
      attributes?: Record<string, string>
      /** 插件链透传的自定义解析上下文。 */
      custom?: CustomPluginOptions
      /** @deprecated 请改用 `skipCalls`。 */
      skip?: Set<Plugin>
      /** 当前递归链中已处理的 plugin/id/importer 组合。 */
      skipCalls?: readonly SkipInformation[]
      /** 是否由依赖扫描器发起。 @internal */
      scan?: boolean
      /** 当前 ID 是否作为打包或扫描入口解析。 */
      isEntry?: boolean
    },
  ): Promise<PartialResolvedId | null> {
    if (!this._started) {
      this.buildStart()
      await this._buildStartPromise
    }
    const skip = options?.skip
    const skipCalls = options?.skipCalls
    const scan = !!options?.scan
    const ssr = this.environment.config.consumer === 'server'
    const ctx = new ResolveIdContext(this, skip, skipCalls, scan)
    const topLevelConfig = this.environment.getTopLevelConfig()

    const mergedSkip = new Set<Plugin>(skip)
    for (const call of skipCalls ?? []) {
      if (call.called || (call.id === rawId && call.importer === importer)) {
        mergedSkip.add(call.plugin)
      }
    }

    const resolveStart = debugResolve ? performance.now() : 0
    let id: string | null = null
    const partial: Partial<PartialResolvedId> = {}
    for (const plugin of this.getSortedPlugins('resolveId')) {
      if (this._closed && this.environment.config.dev.recoverable)
        throwClosedServerError()
      if (mergedSkip?.has(plugin)) continue

      const filter = getCachedFilterForPlugin(plugin, 'resolveId')
      if (filter && !filter(rawId)) continue

      ctx._plugin = plugin

      const normalizedOptions = {
        kind: options?.kind,
        attributes: options?.attributes ?? {},
        custom: options?.custom,
        isEntry: !!options?.isEntry,
        ssr,
        scan,
      }
      if (
        isFutureDeprecationEnabled(
          topLevelConfig,
          'removePluginHookSsrArgument',
        )
      ) {
        let ssrTemp = ssr
        Object.defineProperty(normalizedOptions, 'ssr', {
          /** 读取旧 ssr 参数时发出 future deprecation 告警。 */
          get() {
            warnFutureDeprecation(
              topLevelConfig,
              'removePluginHookSsrArgument',
              `Used in plugin "${plugin.name}".`,
            )
            return ssrTemp
          },
          /** 允许兼容插件在本次调用内覆写旧 ssr 标志。 */
          set(v) {
            ssrTemp = v
          },
        })
      }

      const pluginResolveStart = debugPluginResolve ? performance.now() : 0
      const handler = getHookHandler(plugin.resolveId)
      const result = await this.handleHookPromise(
        handler.call(ctx as any, rawId, importer, normalizedOptions),
      )
      if (!result) continue

      if (typeof result === 'string') {
        id = result
      } else {
        id = result.id
        Object.assign(partial, result)
      }

      debugPluginResolve?.(
        timeFrom(pluginResolveStart),
        plugin.name,
        prettifyUrl(id, this.environment.config.root),
      )

      // resolveId 是 hookFirst：第一个非空结果终止后续插件。
      break
    }

    if (debugResolve && rawId !== id && !rawId.startsWith(FS_PREFIX)) {
      const key = rawId + id
      // 同一映射只记录一次，避免每次模块请求重复刷屏。
      if (!this._seenResolves[key]) {
        this._seenResolves[key] = true
        debugResolve(
          `${timeFrom(resolveStart)} ${colors.cyan(rawId)} -> ${colors.dim(
            id,
          )}`,
        )
      }
    }

    if (id) {
      partial.id = isExternalUrl(id) || id[0] === '\0' ? id : normalizePath(id)
      return partial as PartialResolvedId
    } else {
      return null
    }
  }

  /**
   * 依次执行 load，返回第一个非 null/undefined 结果。
   * 对象结果的 meta 合并进 ModuleInfo；即使所有插件都未加载模块，也保存 addWatchFile
   * 依赖，使随后 transform 能继承 load 上下文（#11469、#14965）。
   */
  async load(id: string): Promise<LoadResult | null> {
    let ssr = this.environment.config.consumer === 'server'
    const topLevelConfig = this.environment.getTopLevelConfig()
    const options = { ssr }
    const ctx = new LoadPluginContext(this)
    for (const plugin of this.getSortedPlugins('load')) {
      if (this._closed && this.environment.config.dev.recoverable)
        throwClosedServerError()

      const filter = getCachedFilterForPlugin(plugin, 'load')
      if (filter && !filter(id)) continue

      ctx._plugin = plugin

      if (
        isFutureDeprecationEnabled(
          topLevelConfig,
          'removePluginHookSsrArgument',
        )
      ) {
        Object.defineProperty(options, 'ssr', {
          /** 读取旧 ssr 参数时发出 future deprecation 告警。 */
          get() {
            warnFutureDeprecation(
              topLevelConfig,
              'removePluginHookSsrArgument',
              `Used in plugin "${plugin.name}".`,
            )
            return ssr
          },
          /** 保存插件对旧 ssr 标志的本次调用内覆写。 */
          set(v) {
            ssr = v
          },
        })
      }

      const handler = getHookHandler(plugin.load)
      const result = await this.handleHookPromise(
        handler.call(ctx as any, id, options),
      )
      if (result != null) {
        if (isObject(result)) {
          ctx._updateModuleInfo(id, result)
        }
        this._updateModuleLoadAddedImports(id, ctx._addedImports)
        return result
      }
    }
    this._updateModuleLoadAddedImports(id, ctx._addedImports)
    return null
  }

  /**
   * 把源码依次通过全部 transform 钩子。
   *
   * 每个插件读到前一插件的 code/moduleType；对象结果可追加 Source Map 与 ModuleInfo
   * meta，字符串结果只替换 code。声明式 filter 针对“当前”code/moduleType 执行，错误
   * 交给 TransformPluginContext 补齐插件名、代码帧和原始 Source Map 位置。
   */
  async transform(
    code: string,
    id: string,
    options?: {
      /** 上游转换已有的 Source Map，作为插件链合成起点。 */
      inMap?: SourceDescription['map']
      /** 当前转换结果的模块类型，供声明式 hook filter 判断。 */
      moduleType?: string
    },
  ): Promise<{
    /** 全部 transform handler 串行处理后的源码。 */
    code: string
    /** 合成后的 Source Map；空 mappings 对象是显式空映射哨兵。 */
    map:
      | SourceMap
      | {
          /** 表示插件明确返回了有效但无映射内容的 Map。 */
          mappings: ''
        }
      | null
    /** 最后一个插件确定的模块类型。 */
    moduleType?: ModuleType
  }> {
    let ssr = this.environment.config.consumer === 'server'
    const topLevelConfig = this.environment.getTopLevelConfig()
    const optionsWithSSR = options
      ? { ...options, ssr, moduleType: options.moduleType ?? 'js' }
      : { ssr, moduleType: 'js' }
    const inMap = options?.inMap

    const ctx = new TransformPluginContext(this, id, code, inMap as SourceMap)
    ctx._addedImports = this._getAddedImports(id)

    for (const plugin of this.getSortedPlugins('transform')) {
      if (this._closed && this.environment.config.dev.recoverable)
        throwClosedServerError()

      const filter = getCachedFilterForPlugin(plugin, 'transform')
      if (filter && !filter(id, code, optionsWithSSR.moduleType)) continue

      if (
        isFutureDeprecationEnabled(
          topLevelConfig,
          'removePluginHookSsrArgument',
        )
      ) {
        Object.defineProperty(optionsWithSSR, 'ssr', {
          /** 读取旧 ssr 参数时发出 future deprecation 告警。 */
          get() {
            warnFutureDeprecation(
              topLevelConfig,
              'removePluginHookSsrArgument',
              `Used in plugin "${plugin.name}".`,
            )
            return ssr
          },
          /** 保存插件对旧 ssr 标志的本次调用内覆写。 */
          set(v) {
            ssr = v
          },
        })
      }

      ctx._updateActiveInfo(plugin, id, code)
      const start = debugPluginTransform ? performance.now() : 0
      let result: TransformResult | string | undefined
      const handler = getHookHandler(plugin.transform)
      try {
        result = await this.handleHookPromise(
          handler.call(ctx as any, code, id, optionsWithSSR),
        )
      } catch (e) {
        ctx.error(e)
      }
      if (!result) continue
      debugPluginTransform?.(
        timeFrom(start),
        plugin.name,
        prettifyUrl(id, this.environment.config.root),
      )
      if (isObject(result)) {
        if (result.code !== undefined) {
          code = result.code as string
          if (result.map) {
            if (debugSourcemapCombine) {
              // @ts-expect-error SourceMap 类型无 name；仅在调试链中注入插件名。
              result.map.name = plugin.name
            }
            ctx.sourcemapChain.push(result.map)
          }
        }
        if (result.moduleType !== undefined) {
          optionsWithSSR.moduleType = result.moduleType
        }
        ctx._updateModuleInfo(id, result)
      } else {
        code = result
      }
    }
    return {
      code,
      map: ctx._getCombinedSourcemap(),
      moduleType: optionsWithSSR.moduleType,
    }
  }

  /** 按并行钩子规则通知当前 Environment 文件创建、更新或删除。 */
  async watchChange(
    id: string,
    change: {
      /** watcher 观察到的文件生命周期事件。 */
      event: 'create' | 'update' | 'delete'
    },
  ): Promise<void> {
    const config = this.environment.getTopLevelConfig()
    await this.hookParallel(
      'watchChange',
      (plugin) => this._getPluginContext(plugin),
      () => [id, change],
      (plugin) =>
        this.environment.name === 'client' ||
        config.server.perEnvironmentWatchChangeDuringDev ||
        plugin.perEnvironmentWatchChangeDuringDev,
    )
  }

  /**
   * 幂等关闭容器：先阻止新可恢复请求，等待在途 hook settle，再运行 buildEnd 和
   * closeBundle。使用 allSettled 确保某个在途任务失败不会跳过其他插件的清理。
   */
  async close(): Promise<void> {
    if (this._closed) return
    this._closed = true
    await Promise.allSettled(Array.from(this._processesing))
    const config = this.environment.getTopLevelConfig()
    await this.hookParallel(
      'buildEnd',
      (plugin) => this._getPluginContext(plugin),
      () => [],
      (plugin) =>
        this.environment.name === 'client' ||
        config.server.perEnvironmentStartEndDuringDev ||
        plugin.perEnvironmentStartEndDuringDev,
    )
    await this.hookParallel(
      'closeBundle',
      (plugin) => this._getPluginContext(plugin),
      () => [],
    )
  }
}

/** 所有插件上下文共享的 Vite、兼容 Rollup 与实际 Rolldown 版本。 */
export const basePluginContextMeta: {
  /** 当前 Vite 包版本。 */
  viteVersion: string
  /** 面向旧插件公开的 Rollup 兼容版本。 */
  rollupVersion: string
  /** 实际执行插件协议的 Rolldown 版本。 */
  rolldownVersion: string
} = {
  viteVersion,
  rollupVersion,
  rolldownVersion,
}

/**
 * 配置/全局钩子使用的最小日志上下文。
 * 它把 Rolldown 风格字符串、对象或惰性日志统一成 RollupLog，并通过 Vite Logger 输出；
 * `debug` 仅进入调试命名空间，`error` 始终抛出。
 */
export class BasicMinimalPluginContext<Meta = PluginContextMeta> {
  /** 保存版本元信息与日志出口，供全局钩子复用。 */
  constructor(
    public meta: Meta,
    private _logger: Logger,
  ) {}

  // FIXME：全局上下文尚无单一插件归属，未来应提供更精确的 pluginName。
  /** 最小全局上下文没有可靠插件归属，按兼容协议返回空名称。 */
  // eslint-disable-next-line @typescript-eslint/class-literal-property-style
  get pluginName(): string {
    return ''
  }

  /** 输出带统一格式的调试日志。 */
  debug(rawLog: string | RollupLog | (() => string | RollupLog)): void {
    const log = this._normalizeRawLog(rawLog)
    const msg = buildErrorMessage(log, [`debug: ${log.message}`], false)
    debugPluginContainerContext?.(msg)
  }

  /** 输出带时间戳的 info 日志。 */
  info(rawLog: string | RollupLog | (() => string | RollupLog)): void {
    const log = this._normalizeRawLog(rawLog)
    const msg = buildErrorMessage(log, [`info: ${log.message}`], false)
    this._logger.info(msg, { clear: true, timestamp: true })
  }

  /** 输出带黄色 warning 前缀的告警。 */
  warn(rawLog: string | RollupLog | (() => string | RollupLog)): void {
    const log = this._normalizeRawLog(rawLog)
    const msg = buildErrorMessage(
      log,
      [colors.yellow(`warning: ${log.message}`)],
      false,
    )
    this._logger.warn(msg, { clear: true, timestamp: true })
  }

  /** 把字符串/错误对象统一抛出，终止当前 hook。 */
  error(e: string | RollupError): never {
    const err = (typeof e === 'string' ? new Error(e) : e) as RollupError
    throw err
  }

  /** 惰性执行日志工厂，并把字符串包装成 Error 形状。 */
  private _normalizeRawLog(
    rawLog: string | RollupLog | (() => string | RollupLog),
  ): RollupLog {
    const logValue = typeof rawLog === 'function' ? rawLog() : rawLog
    return typeof logValue === 'string' ? new Error(logValue) : logValue
  }
}

/** 在最小上下文上增加当前 Environment，供非全局钩子使用。 */
class MinimalPluginContext<T extends Environment = Environment>
  extends BasicMinimalPluginContext
  implements RollupMinimalPluginContext
{
  /** 当前钩子所属 Environment，也是日志和配置的所有权边界。 */
  public environment: T
  /** 把 Environment logger 绑定到最小插件上下文。 */
  constructor(meta: PluginContextMeta, environment: T) {
    super(meta, environment.logger)
    this.environment = environment
  }
}

/** 开发态 PluginContext 暴露的 Promise 文件系统 API。 */
const fsModule: RollupFsModule = {
  appendFile: fsp.appendFile,
  copyFile: fsp.copyFile,
  mkdir: fsp.mkdir as RollupFsModule['mkdir'],
  mkdtemp: fsp.mkdtemp,
  readdir: fsp.readdir,
  readFile: fsp.readFile as RollupFsModule['readFile'],
  realpath: fsp.realpath,
  rename: fsp.rename,
  rmdir: fsp.rmdir,
  stat: fsp.stat,
  lstat: fsp.lstat,
  unlink: fsp.unlink,
  writeFile: fsp.writeFile,
}

/**
 * 单插件可复用的 Rolldown 兼容上下文。
 * 保存当前插件、模块源码、递归 resolve 跳过信息，并实现 parse/resolve/load/module info、
 * watch file 和结构化日志；开发服务器不支持的 output 方法只告警。
 */
class PluginContext
  extends MinimalPluginContext
  implements Omit<RollupPluginContext, 'cache'>
{
  /** 旧插件读取的 SSR 标记；实际来源是当前 Environment consumer。 */
  ssr = false
  /** 当前解析是否来自依赖扫描。 */
  _scan = false
  /** 当前 handler 正在处理的模块 ID，用于错误归因。 */
  _activeId: string | null = null
  /** 当前 handler 读到的源码，用于代码帧和 Source Map 回溯。 */
  _activeCode: string | null = null
  /** 旧版按插件集合跳过 resolve 的兼容状态。 */
  _resolveSkips?: Set<Plugin>
  /** 精确到 plugin/id/importer 的递归 resolve 调用链。 */
  _resolveSkipCalls?: readonly SkipInformation[]

  /** 返回当前活动插件名，供结构化日志和错误归因。 */
  override get pluginName(): string {
    return this._plugin.name
  }

  /** 将一个插件与其 Environment 容器绑定为可复用上下文。 */
  constructor(
    public _plugin: Plugin,
    public _container: EnvironmentPluginContainer,
  ) {
    super(_container.minimalContext.meta, _container.environment)
  }

  /** Rolldown 风格的异步文件系统 API。 */
  fs: RollupFsModule = fsModule

  /** 使用 Rolldown parser 把源码解析成 ESTree Program。 */
  parse(code: string, opts: any): ESTree.Program {
    return rolldownParseAst(code, opts)
  }

  /**
   * 在当前 Environment 中再次进入 resolveId 流水线。
   * 默认 `skipSelf: true`，但只跳过相同 plugin/id/importer 三元组；不同子请求仍允许当前
   * 插件参与。显式 false 则不追加当前调用记录（#18903）。
   */
  async resolve(
    id: string,
    importer?: string,
    options?: {
      /** import attributes 原样传递到下一轮 resolveId。 */
      attributes?: Record<string, string>
      /** 插件定义的自定义解析上下文。 */
      custom?: CustomPluginOptions
      /** 标记该请求是否为入口解析。 */
      isEntry?: boolean
      /** 默认跳过当前同一调用；设为 false 时允许插件递归处理。 */
      skipSelf?: boolean
    },
  ): Promise<ResolvedId | null> {
    let skipCalls: readonly SkipInformation[] | undefined
    if (options?.skipSelf === false) {
      skipCalls = this._resolveSkipCalls
    } else if (this._resolveSkipCalls) {
      const skipCallsTemp = [...this._resolveSkipCalls]
      const sameCallIndex = this._resolveSkipCalls.findIndex(
        (c) =>
          c.id === id && c.importer === importer && c.plugin === this._plugin,
      )
      if (sameCallIndex !== -1) {
        skipCallsTemp[sameCallIndex] = {
          ...skipCallsTemp[sameCallIndex],
          called: true,
        }
      } else {
        skipCallsTemp.push({ id, importer, plugin: this._plugin })
      }
      skipCalls = skipCallsTemp
    } else {
      skipCalls = [{ id, importer, plugin: this._plugin }]
    }

    let out = await this._container.resolveId(id, importer, {
      attributes: options?.attributes,
      custom: options?.custom,
      isEntry: !!options?.isEntry,
      skip: this._resolveSkips,
      skipCalls,
      scan: this._scan,
    })
    if (typeof out === 'string') out = { id: out }
    return out as ResolvedId | null
  }

  /**
   * 模拟 Rolldown `this.load()`：确保模块图节点存在，运行 load 与 transform，再返回
   * ModuleInfo。transform 不能省略，否则调用方会读到转换前 meta（#11469、#14965）。
   */
  async load(
    options: {
      /** 要加载并确保进入模块图的 resolved ID。 */
      id: string
      /** Rolldown 兼容字段；开发容器当前不单独解析完整依赖表。 */
      resolveDependencies?: boolean
    } & Partial<PartialNull<ModuleOptions>>,
  ): Promise<ModuleInfo> {
    // 模块可能尚未经过普通请求入口，先确保 ModuleGraph 中存在节点。
    await this._container.moduleGraph?.ensureEntryFromUrl(unwrapId(options.id))
    // 单文件加载无法实现全部 Rolldown ModuleOptions，但至少同步已支持的 ModuleInfo 字段。
    this._updateModuleInfo(options.id, options)

    const loadResult = await this._container.load(options.id)
    const code = typeof loadResult === 'object' ? loadResult?.code : loadResult
    if (code != null) {
      await this._container.transform(code, options.id)
    }

    const moduleInfo = this.getModuleInfo(options.id)
    // 正常开发环境已通过 ensureEntryFromUrl 建立节点；类型无法证明这一点，且精简容器可
    // 没有 moduleGraph，所以仍保留显式失败分支。
    if (!moduleInfo) throw Error(`Failed to load module with id ${options.id}`)
    return moduleInfo
  }

  /** 返回当前 Environment 的模块信息；未知模块为 null。 */
  getModuleInfo(id: string): ModuleInfo | null {
    return this._container.getModuleInfo(id)
  }

  /** 把 hook 结果中的 meta 浅合并进既有 ModuleInfo。 */
  _updateModuleInfo(
    id: string,
    {
      meta
    }: {
      /** 当前钩子新增或覆写的插件元数据。 */
      meta?: object | null
    },
  ): void {
    if (meta) {
      const moduleInfo = this.getModuleInfo(id)
      if (moduleInfo) {
        moduleInfo.meta = { ...moduleInfo.meta, ...meta }
      }
    }
  }

  /** 遍历当前 Environment 模块图中的全部模块 ID。 */
  getModuleIds(): IterableIterator<string> {
    return this._container.moduleGraph
      ? this._container.moduleGraph.idToModuleMap.keys()
      : Array.prototype[Symbol.iterator]()
  }

  /** 登记插件额外依赖，并确保底层 watcher 实际观察该文件。 */
  addWatchFile(id: string): void {
    this._container.watchFiles.add(id)
    if (this._container.watcher)
      ensureWatchedFile(
        this._container.watcher,
        id,
        this.environment.config.root,
      )
  }

  /** 返回当前容器累计的额外监听文件快照。 */
  getWatchFiles(): string[] {
    return [...this._container.watchFiles]
  }

  /** serve 无 output 阶段，emitFile 只输出兼容告警并返回空引用 ID。 */
  emitFile(_assetOrFile: EmittedFile): string {
    this._warnIncompatibleMethod(`emitFile`)
    return ''
  }

  /** serve 无 output asset，setAssetSource 只输出兼容告警。 */
  setAssetSource(): void {
    this._warnIncompatibleMethod(`setAssetSource`)
  }

  /** serve 无产物文件名，getFileName 只输出兼容告警并返回空字符串。 */
  getFileName(): string {
    this._warnIncompatibleMethod(`getFileName`)
    return ''
  }

  /** 为 debug 日志补齐插件名、活动模块和位置后输出。 */
  override debug(log: string | RollupLog | (() => string | RollupLog)): void {
    const err = this._formatLog(typeof log === 'function' ? log() : log)
    super.debug(err)
  }

  /** 为 info 日志补齐插件名、活动模块和位置后输出。 */
  override info(log: string | RollupLog | (() => string | RollupLog)): void {
    const err = this._formatLog(typeof log === 'function' ? log() : log)
    super.info(err)
  }

  /** 为 warn 日志补齐插件名、活动模块、位置与代码帧后输出。 */
  override warn(
    log: string | RollupLog | (() => string | RollupLog),
    position?:
      | number
      | {
          /** 从零开始的源码列号。 */
          column: number
          /** 从一开始的源码行号。 */
          line: number
        },
  ): void {
    const err = this._formatLog(
      typeof log === 'function' ? log() : log,
      position,
    )
    super.warn(err)
  }

  /**
   * 格式化后抛出插件错误；transform/error 中间件随后把它交给统一错误响应页面。
   */
  override error(
    e: string | RollupError,
    position?:
      | number
      | {
          /** 从零开始的源码列号。 */
          column: number
          /** 从一开始的源码行号。 */
          line: number
        },
  ): never {
    // 由 transform 中间件捕获，再传给统一 error 中间件。
    throw this._formatLog(e, position)
  }

  /**
   * 把 Rolldown 多种错误位置格式统一为 plugin/id/loc/frame。
   * transform 错误还通过组合 Source Map 回溯到原始源文件；CSS 预处理器报告 include
   * 文件时优先读取该文件生成代码帧。
   */
  private _formatLog<E extends RollupLog>(
    e: string | E,
    position?:
      | number
      | {
          /** 从零开始的源码列号。 */
          column: number
          /** 从一开始的源码行号。 */
          line: number
        },
  ): E {
    const err = (typeof e === 'string' ? new Error(e) : e) as E
    if (err.pluginCode) {
      return err // 已含 pluginCode，通常表示插件之前已调用 this.error 格式化。
    }
    err.plugin = this._plugin.name
    if (this._activeId && !err.id) err.id = this._activeId
    if (this._activeCode) {
      err.pluginCode = this._activeCode

      // 部分 Rollup 插件（如 json）写 err.position 而不是 err.pos，三种形式都兼容。
      const pos = position ?? err.pos ?? (err as any).position

      if (pos != null) {
        let errLocation
        try {
          errLocation = numberToPos(this._activeCode, pos)
        } catch (err2) {
          this.environment.logger.error(
            colors.red(
              `Error in error handler:\n${err2.stack || err2.message}\n`,
            ),
            // 额外换行把“格式化错误”与原始插件错误分开。
            { error: err2 },
          )
          throw err
        }
        err.loc = err.loc || {
          file: err.id,
          ...errLocation,
        }
        err.frame = err.frame || generateCodeFrame(this._activeCode, pos)
      } else if (err.loc) {
        // CSS 预处理器可能把位置指向被 include 的另一个文件。
        if (!err.frame) {
          let code = this._activeCode
          if (err.loc.file) {
            err.id = normalizePath(err.loc.file)
            try {
              code = fs.readFileSync(err.loc.file, 'utf-8')
            } catch {}
          }
          err.frame = generateCodeFrame(code, err.loc)
        }
      } else if ((err as any).line && (err as any).column) {
        err.loc = {
          file: err.id,
          line: (err as any).line,
          column: (err as any).column,
        }
        err.frame = err.frame || generateCodeFrame(this._activeCode, err.loc)
      }

      // TODO：把 transform 专属 Source Map 回溯移到子类 override。
      if (
        this instanceof TransformPluginContext &&
        typeof err.loc?.line === 'number' &&
        typeof err.loc.column === 'number'
      ) {
        const rawSourceMap = this._getCombinedSourcemap()
        if (rawSourceMap && 'version' in rawSourceMap) {
          const traced = new TraceMap(rawSourceMap as any)
          const { source, line, column } = originalPositionFor(traced, {
            line: Number(err.loc.line),
            column: Number(err.loc.column),
          })
          if (source) {
            err.loc = { file: source, line, column }
          }
        }
      }
    } else if (err.loc) {
      if (!err.frame) {
        let code = err.pluginCode
        if (err.loc.file) {
          err.id = normalizePath(err.loc.file)
          if (!code) {
            try {
              code = fs.readFileSync(err.loc.file, 'utf-8')
            } catch {}
          }
        }
        if (code) {
          err.frame = generateCodeFrame(`${code}`, err.loc)
        }
      }
    }

    if (
      typeof err.loc?.column !== 'number' &&
      typeof err.loc?.line !== 'number' &&
      !err.loc?.file
    ) {
      delete err.loc
    }

    return err
  }

  /** 提示插件调用了 serve 阶段无法模拟的 output context 方法。 */
  _warnIncompatibleMethod(method: string): void {
    this.environment.logger.warn(
      colors.cyan(`[plugin:${this._plugin.name}] `) +
        colors.yellow(
          `context method ${colors.bold(
            `${method}()`,
          )} is not supported in serve mode. This plugin is likely not vite-compatible.`,
        ),
    )
  }
}

/** resolveId 流水线共用的可变上下文；每次调用前切换当前插件。 */
class ResolveIdContext extends PluginContext {
  /** 保存本轮递归跳过记录与扫描标志，随后每个 resolve hook 复用。 */
  constructor(
    container: EnvironmentPluginContainer,
    skip: Set<Plugin> | undefined,
    skipCalls: readonly SkipInformation[] | undefined,
    scan: boolean,
  ) {
    super(null!, container)
    this._resolveSkips = skip
    this._resolveSkipCalls = skipCalls
    this._scan = scan
  }
}

/**
 * load 上下文；除全局 watchFiles 外，单独记录本模块新增依赖，供 transform 延续使用。
 */
class LoadPluginContext extends PluginContext {
  /** 当前模块在 load/transform 中通过 addWatchFile 登记的依赖。 */
  _addedImports: Set<string> | null = null

  /** 创建按模块累计 addWatchFile 结果的 load 上下文。 */
  constructor(container: EnvironmentPluginContainer) {
    super(null!, container)
  }

  /** 同时写入当前模块依赖集合与容器全局 watcher。 */
  override addWatchFile(id: string): void {
    if (!this._addedImports) {
      this._addedImports = new Set()
    }
    this._addedImports.add(id)
    super.addWatchFile(id)
  }
}

/**
 * transform 专属上下文：记录原始源码、各插件 Source Map 链与当前活动插件。
 * Map 采用惰性组合，只有最终返回、错误回溯或插件调用 getCombinedSourcemap 时才计算。
 */
class TransformPluginContext
  extends LoadPluginContext
  implements Omit<RollupTransformPluginContext, 'cache'>
{
  /** 当前模块 ID。 */
  filename: string
  /** 进入整个 transform 流水线前的原始源码。 */
  originalCode: string
  /** 预留的原始 Source Map 字段。 */
  originalSourcemap: SourceMap | null = null
  /** 尚未合并的输入/插件 Source Map，顺序与转换顺序一致。 */
  sourcemapChain: NonNullable<SourceDescription['map']>[] = []
  /** 已合并 Map、空映射哨兵或显式 null。 */
  combinedMap:
    | SourceMap
    | {
        /** 表示插件链明确产出了有效空映射。 */
        mappings: ''
      }
    | null = null

  /** 保存 transform 输入与可选上游 Map，等待插件链结束后再合成。 */
  constructor(
    container: EnvironmentPluginContainer,
    id: string,
    code: string,
    inMap?: SourceMap | string,
  ) {
    super(container)

    this.filename = id
    this.originalCode = code
    if (inMap) {
      if (debugSourcemapCombine) {
        // @ts-expect-error SourceMap 类型无 name；仅为调试链标记输入 Map。
        inMap.name = '$inMap'
      }
      this.sourcemapChain.push(inMap)
    }
  }

  /**
   * 惰性合并 sourcemapChain。
   * `{ mappings: '' }` 是“有效但无映射”的兼容哨兵；缺少 version 的其他对象表示插件
   * 显式清空 Map。MagicString 未给 filename 时生成空 source，需替换为当前 ID/原始源码
   * 才满足 Source Map 规范并兼容 Rollup（#13657）。
   */
  _getCombinedSourcemap():
    | SourceMap
    | {
        /** Rolldown/Rollup 约定的有效空映射。 */
        mappings: ''
      }
    | null {
    if (
      debugSourcemapCombine &&
      debugSourcemapCombineFilter &&
      this.filename.includes(debugSourcemapCombineFilter)
    ) {
      debugSourcemapCombine('----------', this.filename)
      debugSourcemapCombine(this.combinedMap)
      debugSourcemapCombine(this.sourcemapChain)
      debugSourcemapCombine('----------')
    }

    let combinedMap = this.combinedMap
    // 已缓存的空映射哨兵可以直接返回并清空待处理链。
    if (
      combinedMap &&
      !('version' in combinedMap) &&
      combinedMap.mappings === ''
    ) {
      this.sourcemapChain.length = 0
      return combinedMap
    }

    for (let m of this.sourcemapChain) {
      if (typeof m === 'string') m = JSON.parse(m)
      if (!('version' in (m as SourceMap))) {
        // `{ mappings: '' }` 保留为 Rolldown/Rollup 认可的空映射。
        if ((m as SourceMap).mappings === '') {
          combinedMap = { /** 保留 Rolldown/Rollup 约定的空映射哨兵。 */ mappings: '' }
          break
        }
        // 其他无 version 值表示插件主动使 Source Map 失效。
        combinedMap = null
        break
      }
      if (!combinedMap) {
        const sm = m as SourceMap
        // Source Map 规范不允许 sources:[null]，而 sources:[''] 表示 Map 自身路径；但
        // MagicString 未传 filename 时会生成这两种值。Rollup 接受它们，Vite 将其修复为
        // 当前模块 ID 和原始源码。
        if (sm.sources.length === 1 && !sm.sources[0]) {
          combinedMap = {
            ...sm,
            sources: [this.filename],
            sourcesContent: [this.originalCode],
          }
        } else {
          combinedMap = sm
        }
      } else {
        combinedMap = combineSourcemaps(cleanUrl(this.filename), [
          m as RawSourceMap,
          combinedMap as RawSourceMap,
        ]) as SourceMap
      }
    }
    if (combinedMap !== this.combinedMap) {
      this.combinedMap = combinedMap
      this.sourcemapChain.length = 0
    }
    return this.combinedMap
  }

  /**
   * 返回标准 SourceMap。若插件链没有可用映射，则为原始源码生成 identity-like 高精度 Map。
   */
  getCombinedSourcemap(): SourceMap {
    const map = this._getCombinedSourcemap()
    if (!map || (!('version' in map) && map.mappings === '')) {
      return new MagicString(this.originalCode).generateMap({
        includeContent: true,
        hires: 'boundary',
        source: cleanUrl(this.filename),
      }) as SourceMap
    }
    return map
  }

  /** 切换当前 transform 插件及其输入代码，供日志/错误归因。 */
  _updateActiveInfo(plugin: Plugin, id: string, code: string): void {
    this._plugin = plugin
    this._activeId = id
    this._activeCode = code
  }
}

export type {
  EnvironmentPluginContainer,
  TransformPluginContext,
  TransformResult,
}

/**
 * 旧 `server.pluginContainer` 多 Environment 兼容门面。
 * 新代码应直接使用目标 `environment.pluginContainer`；此类根据 environment/ssr 参数转发，
 * 未提供时默认 client，并合并 client/ssr ModuleInfo 视图。
 */
class PluginContainer {
  /** 保存可按名称选择的 Environment，兼容旧 ssr 布尔转发。 */
  constructor(private environments: Record<string, Environment>) {}

  /**
   * 选择兼容调用目标：显式 Environment 优先，其次旧 ssr 布尔值，最后 client。
   */
  private _getEnvironment(options?: {
    /** 旧 API 的服务端选择标志。 */
    ssr?: boolean
    /** 新 API 显式指定的 Environment，优先于 ssr。 */
    environment?: Environment
  }) {
    return options?.environment
      ? options.environment
      : this.environments[options?.ssr ? 'ssr' : 'client']
  }

  /** 取得所选 DevEnvironment 的真实插件容器。 */
  private _getPluginContainer(options?: {
    /** 旧 API 的服务端选择标志。 */
    ssr?: boolean
    /** 新 API 显式指定的 Environment。 */
    environment?: Environment
  }) {
    return (this._getEnvironment(options) as DevEnvironment).pluginContainer
  }

  /**
   * 合并 client/ssr ModuleInfo 兼容视图。
   * 普通字段 client 优先、ssr 回退；meta 合并两侧且 client 覆盖同名键（#18895）。
   */
  getModuleInfo(id: string): ModuleInfo | null {
    const clientModuleInfo = (
      this.environments.client as DevEnvironment
    ).pluginContainer.getModuleInfo(id)
    const ssrModuleInfo = (
      this.environments.ssr as DevEnvironment
    ).pluginContainer.getModuleInfo(id)

    if (clientModuleInfo == null && ssrModuleInfo == null) return null

    return new Proxy({} as any, {
      get: (_, key: string) => {
        // 旧入口中的 meta 代表两个 Environment 的模块元数据，因此不能只取 client。
        if (key === 'meta') {
          const meta: Record<string, any> = {}
          if (ssrModuleInfo) {
            Object.assign(meta, ssrModuleInfo.meta)
          }
          if (clientModuleInfo) {
            Object.assign(meta, clientModuleInfo.meta)
          }
          return meta
        }
        if (clientModuleInfo) {
          if (key in clientModuleInfo) {
            return clientModuleInfo[key as keyof ModuleInfo]
          }
        }
        if (ssrModuleInfo) {
          if (key in ssrModuleInfo) {
            return ssrModuleInfo[key as keyof ModuleInfo]
          }
        }
      },
    })
  }

  /** 兼容返回 client Environment 的 Rolldown options。 */
  get options(): InputOptions {
    return (this.environments.client as DevEnvironment).pluginContainer.options
  }

  // 兼容默认只从 client 触发 buildStart/watchChange；声明 perEnvironment* 的插件会由各
  // Environment 自身容器额外触发。

  /** 转发到 client 容器的 buildStart。 */
  async buildStart(_options?: InputOptions): Promise<void> {
    return (
      this.environments.client as DevEnvironment
    ).pluginContainer.buildStart(_options)
  }

  /** 转发到 client 容器的 watchChange。 */
  async watchChange(
    id: string,
    change: {
      /** watcher 观察到的文件生命周期事件。 */
      event: 'create' | 'update' | 'delete'
    },
  ): Promise<void> {
    return (
      this.environments.client as DevEnvironment
    ).pluginContainer.watchChange(id, change)
  }

  /** 按 environment/ssr 选择容器并转发 resolveId。 */
  async resolveId(
    rawId: string,
    importer?: string,
    options?: {
      /** import attributes 原样传递给目标 Environment。 */
      attributes?: Record<string, string>
      /** 插件定义的自定义解析上下文。 */
      custom?: CustomPluginOptions
      /** @deprecated 请改用 `skipCalls`。 */
      skip?: Set<Plugin>
      /** 当前递归解析链已经处理的精确调用记录。 */
      skipCalls?: readonly SkipInformation[]
      /** 旧 API 的服务端 Environment 选择标志。 */
      ssr?: boolean
      /** 是否由依赖扫描器发起。 @internal */
      scan?: boolean
      /** 当前 ID 是否为入口。 */
      isEntry?: boolean
    },
  ): Promise<PartialResolvedId | null> {
    return this._getPluginContainer(options).resolveId(rawId, importer, options)
  }

  /** 按旧 ssr 参数选择容器并转发 load。 */
  async load(
    id: string,
    options?: {
      /** 旧 API 的服务端 Environment 选择标志。 */
      ssr?: boolean
    },
  ): Promise<LoadResult | null> {
    return this._getPluginContainer(options).load(id)
  }

  /** 按显式 Environment 或旧 ssr 参数选择容器并转发 transform。 */
  async transform(
    code: string,
    id: string,
    options?: {
      /** 旧 API 的服务端 Environment 选择标志。 */
      ssr?: boolean
      /** 新 API 显式指定的 Environment。 */
      environment?: Environment
      /** 进入兼容 transform 前已有的 Source Map。 */
      inMap?: SourceDescription['map']
    },
  ): Promise<{
    /** 目标 Environment 插件链处理后的源码。 */
    code: string
    /** 合成后的 Source Map；空 mappings 对象表示有效空映射。 */
    map:
      | SourceMap
      | {
          /** Rolldown/Rollup 约定的空映射哨兵。 */
          mappings: ''
        }
      | null
  }> {
    return this._getPluginContainer(options).transform(code, id, options)
  }

  /**
   * 兼容门面不拥有资源；每个 Environment 的真实容器会分别关闭。
   */
  async close(): Promise<void> {
    // 空操作：关闭逻辑由每个 Environment 执行。
  }
}

/**
 * 创建旧 `server.pluginContainer` 兼容门面。
 *
 * 全局 buildStart/buildEnd/watchChange/closeBundle 旧语义默认代表 client 且只执行一次；
 * 其他方法未传 Environment 时也回退 client，传旧 `ssr: true` 时改用 ssr。
 */
export function createPluginContainer(
  environments: Record<string, Environment>,
): PluginContainer {
  return new PluginContainer(environments)
}

export type { PluginContainer }
