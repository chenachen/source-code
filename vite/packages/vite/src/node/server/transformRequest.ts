import fsp from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import getEtag from 'etag'
import MagicString from 'magic-string'
import { init, parse as parseImports } from 'es-module-lexer'
import type {
  ModuleType,
  PartialResolvedId,
  SourceDescription,
  SourceMap,
} from 'rolldown'
import colors from 'picocolors'
import type { EnvironmentModuleNode } from '../server/moduleGraph'
import {
  createDebugger,
  ensureWatchedFile,
  injectQuery,
  isObject,
  monotonicDateNow,
  prettifyUrl,
  removeImportQuery,
  removeTimestampQuery,
  stripBase,
  timeFrom,
} from '../utils'
import { ssrTransform } from '../ssr/ssrTransform'
import { checkPublicFile } from '../publicDir'
import { cleanUrl, slash, unwrapId } from '../../shared/utils'
import {
  applySourcemapIgnoreList,
  extractSourcemapFromFile,
  injectSourcesContent,
} from './sourcemap'
import { isFileLoadingAllowed } from './middlewares/static'
import { throwClosedServerError } from './pluginContainer'
import type { DevEnvironment } from './environment'
import { isServerAccessDeniedForTransform } from './middlewares/transform'

/** resolve 成功但 load/磁盘回退均未得到源码。 */
export const ERR_LOAD_URL = 'ERR_LOAD_URL'
/** 源码 import 了只能从 HTML/根 URL 引用的 publicDir 文件。 */
export const ERR_LOAD_PUBLIC_URL = 'ERR_LOAD_PUBLIC_URL'
/** 资源查询指向 server.fs 不允许读取的真实文件。 */
export const ERR_DENIED_ID = 'ERR_DENIED_ID'

/** 分别由 DEBUG=vite:load/transform/cache 启用的阶段诊断日志。 */
const debugLoad = createDebugger('vite:load')
/** 记录插件 transform 阶段的耗时与跳过情况。 */
const debugTransform = createDebugger('vite:transform')
/** 记录普通内存缓存与 HMR 软失效缓存命中。 */
const debugCache = createDebugger('vite:cache')

/** 一次开发态模块处理的最终缓存/响应结果。 */
export interface TransformResult {
  /** 已完成插件转换（或 Module Runner 转换）的代码。 */
  code: string
  /** 合并后的 Source Map；空 mappings 明确表示无需生成 fallback map。 */
  map:
    | SourceMap
    | {
        /** 空值表示调用链明确不需要可用的 Source Map 映射。 */
        mappings: ''
      }
    | null
  /** 旧 SSR 兼容标记。 */
  ssr?: boolean
  /** client 响应使用的弱 ETag。 */
  etag?: string
  /** 静态依赖 URL 列表，主要由 SSR transform 返回。 */
  deps?: string[]
  /** 动态依赖 URL 列表。 */
  dynamicDeps?: string[]
}

/** 旧 transformRequest 公开选项。 */
export interface TransformOptions {
  /**
   * @deprecated 现在从 Environment 本身推断。
   */
  ssr?: boolean
}

/** transformRequest 内部调用路径使用的安全检查选项。 */
interface TransformOptionsInternal {
  /** 是否跳过 `server.fs` 检查；用于自定义 transport 声明和内部预热路径；预热不再执行这里的检查。 */
  skipFsCheck: boolean
}

// TODO：概念上它就是 `environment.transformRequest(url, options)`，且已依赖 Environment 的
// _closing/_pendingRequests/_registerRequestProcessing 私有状态。当前单独保留主要为了历史追踪和
// 避免 DevEnvironment 类过大，未来可迁入类内。

/**
 * 合并同 URL 的并发请求，检测处理中失效，并执行 resolve → load → transform → 缓存。
 * recoverable Environment 关闭后会提前抛 ERR_CLOSED_SERVER，让浏览器用新实例重试。
 */
export function transformRequest(
  environment: DevEnvironment,
  url: string,
  options: TransformOptionsInternal,
): Promise<TransformResult | null> {
  if (environment._closing && environment.config.dev.recoverable)
    throwClosedServerError()

  // 模块可能在处理途中因新依赖预构建、配置重载、源文件变化或虚拟模块失效而失效。记录开始
  // 时的单调时间，完成后与 lastInvalidationTimestamp 比较：旧请求可以返回给原调用者，但
  // 不能写入缓存，否则下一次请求会复用过期结果。
  const timestamp = monotonicDateNow()

  url = removeTimestampQuery(url)

  const pending = environment._pendingRequests.get(url)
  if (pending) {
    return environment.moduleGraph.getModuleByUrl(url).then((module) => {
      if (!module || pending.timestamp > module.lastInvalidationTimestamp) {
        // 在途请求开始于最近一次失效之后，可安全共享同一 Promise。
        return pending.request
      } else {
        // 时序：请求 1 → 模块失效 → 请求 2。请求 1 已过期，先清除其 pending 槽位，再让请求 2
        // 建立新的 transform；abort 只停止复用，不强行取消正在执行的插件 Promise。
        pending.abort()
        return transformRequest(environment, url, options)
      }
    })
  }

  const request = doTransform(environment, url, options, timestamp)

  // 过期请求与新请求可能共用 URL；每个 clearCache 只删除自己仍拥有的当前槽位一次。
  let cleared = false
  /** 仅删除一次当前 URL 的在途请求槽位。 */
  const clearCache = () => {
    if (!cleared) {
      environment._pendingRequests.delete(url)
      cleared = true
    }
  }

  // 处理期间缓存 Promise 合并并发；settle 后清除，长期结果由 ModuleNode.transformResult 保存。
  environment._pendingRequests.set(url, {
    request,
    timestamp,
    abort: clearCache,
  })

  return request.finally(clearCache)
}

/** 查询 URL/ID 两级模块缓存；未命中时解析，并启动真实 loadAndTransform。 */
async function doTransform(
  environment: DevEnvironment,
  url: string,
  options: TransformOptionsInternal,
  timestamp: number,
) {
  const { pluginContainer } = environment

  let module = await environment.moduleGraph.getModuleByUrl(url)
  if (module) {
    // URL 已入图时先尝试软失效恢复或 transformResult 内存缓存。
    const cached = await getCachedTransformResult(
      environment,
      url,
      module,
      timestamp,
    )
    if (cached) return cached
  }

  const resolved = module
    ? undefined
    : ((await pluginContainer.resolveId(url, undefined)) ?? undefined)

  // 同一模块可能尚未按 URL 入图，先通过插件解析到规范 ID。
  const id = module?.id ?? resolved?.id ?? url

  module ??= environment.moduleGraph.getModuleById(id)
  if (module) {
    // 不同 URL 可映射到同一已加载 ID；补登记 URL→现有节点，再查 ID 级缓存。
    await environment.moduleGraph._ensureEntryFromUrl(url, undefined, resolved)
    // 尝试复用规范 ID 对应节点上已有的变换缓存。
    const cached = await getCachedTransformResult(
      environment,
      url,
      module,
      timestamp,
    )
    if (cached) return cached
  }

  const result = loadAndTransform(
    environment,
    id,
    url,
    options,
    timestamp,
    module,
    resolved,
  )

  const { depsOptimizer } = environment
  if (!depsOptimizer?.isOptimizedDepFile(id)) {
    // 优化依赖由 optimizer 自己跟踪完成；普通模块纳入首轮静态 import 稳定检测。
    environment._registerRequestProcessing(id, () => result)
  }

  return result
}

/** 依次尝试软失效快速修补和普通 transformResult 内存缓存。 */
async function getCachedTransformResult(
  environment: DevEnvironment,
  url: string,
  module: EnvironmentModuleNode,
  timestamp: number,
) {
  const prettyUrl = debugCache ? prettifyUrl(url, environment.config.root) : ''

  // 软失效保留旧转换，只重写 import 时间戳。
  const softInvalidatedTransformResult = await handleModuleSoftInvalidation(
    environment,
    module,
    timestamp,
  )
  if (softInvalidatedTransformResult) {
    debugCache?.(`[memory-hmr] ${prettyUrl}`)
    return softInvalidatedTransformResult
  }

  // 无失效状态且已有结果时直接复用。
  const cached = module.transformResult
  if (cached) {
    debugCache?.(`[memory] ${prettyUrl}`)
    return cached
  }
}

/**
 * 执行一次真实模块处理：访问控制 → 插件/文件 load → 入图 → 插件 transform → Source Map
 * 规范化 → 可选 Module Runner transform → 新鲜度检查与缓存。
 */
async function loadAndTransform(
  environment: DevEnvironment,
  id: string,
  url: string,
  options: TransformOptionsInternal,
  timestamp: number,
  mod?: EnvironmentModuleNode,
  resolved?: PartialResolvedId,
) {
  const { config, pluginContainer, logger } = environment
  const prettyUrl =
    debugLoad || debugTransform ? prettifyUrl(url, config.root) : ''

  const moduleGraph = environment.moduleGraph

  if (
    !options.skipFsCheck &&
    id[0] !== '\0' &&
    isServerAccessDeniedForTransform(config, id)
  ) {
    const err: any = new Error(`Denied ID ${id}`)
    err.code = ERR_DENIED_ID
    err.id = id
    throw err
  }

  let code: string | null = null
  let map: SourceDescription['map'] = null
  let moduleType: ModuleType | undefined

  // load hookFirst：首个插件结果拥有模块；全部为空才回退磁盘文本读取。
  const loadStart = debugLoad ? performance.now() : 0
  const loadResult = await pluginContainer.load(id)

  if (loadResult == null) {
    const file = cleanUrl(id)

    // 仅在 fs 允许时回退 UTF-8 文本读取。二进制应已由专用插件 load；root 外 URL（如 API、
    // service-worker 路由）不能被盲目当磁盘路径读取。
    if (
      options.skipFsCheck ||
      isFileLoadingAllowed(environment.getTopLevelConfig(), slash(file))
    ) {
      try {
        code = await fsp.readFile(file, 'utf-8')
        debugLoad?.(`${timeFrom(loadStart)} [fs] ${prettyUrl}`)
      } catch (e) {
        if (e.code !== 'ENOENT' && e.code !== 'EISDIR') {
          throw e
        }
      }
      if (code != null && environment.pluginContainer.watcher) {
        ensureWatchedFile(
          environment.pluginContainer.watcher,
          file,
          config.root,
        )
      }
    }
    if (code) {
      try {
        const extracted = extractSourcemapFromFile(code, file, logger)
        if (extracted) {
          code = extracted.code
          map = extracted.map
        }
      } catch (e) {
        logger.warn(`Failed to load source map for ${file}.\n${e}`, {
          timestamp: true,
        })
      }
    }
  } else {
    debugLoad?.(`${timeFrom(loadStart)} [plugin] ${prettyUrl}`)
    if (isObject(loadResult)) {
      code = loadResult.code
      map = loadResult.map
      moduleType = loadResult.moduleType
    } else {
      code = loadResult
    }
  }
  if (code == null) {
    const isPublicFile = checkPublicFile(url, environment.getTopLevelConfig())
    let publicDirName = path.relative(config.root, config.publicDir)
    if (publicDirName[0] !== '.') publicDirName = '/' + publicDirName
    // publicDir 文件绕过插件转换，只能通过 HTML/root URL 引用；给出比普通不存在更具体的错误。
    const msg = isPublicFile
      ? `This file is in ${publicDirName} and will be copied as-is during ` +
        `build without going through the plugin transforms, and therefore ` +
        `should not be imported from source code. It can only be referenced ` +
        `via HTML tags.`
      : `Does the file exist?`
    const importerMod: EnvironmentModuleNode | undefined =
      moduleGraph.idToModuleMap.get(id)?.importers.values().next().value
    const importer = importerMod?.file || importerMod?.url
    const err: any = new Error(
      `Failed to load url ${url} (resolved id: ${id})${
        importer ? ` in ${importer}` : ''
      }. ${msg}`,
    )
    err.code = isPublicFile ? ERR_LOAD_PUBLIC_URL : ERR_LOAD_URL
    throw err
  }
  if (moduleType === undefined) {
    // 插件未声明 moduleType 时只为非 JS 已知扩展名补类型；JS 保持容器默认行为。
    const guessedModuleType = getModuleTypeFromId(id)
    if (guessedModuleType && guessedModuleType !== 'js') {
      moduleType = guessedModuleType
    }
  }

  if (environment._closing && environment.config.dev.recoverable)
    throwClosedServerError()

  // load 成功后才确保入图，避免不存在/API URL 污染模块图。
  mod ??= await moduleGraph._ensureEntryFromUrl(url, undefined, resolved)

  // transform 串行贯穿全部插件，code/map/moduleType 逐步传递。
  const transformStart = debugTransform ? performance.now() : 0
  const transformResult = await pluginContainer.transform(code, id, {
    inMap: map,
    moduleType,
  })
  const originalCode = code
  if (transformResult.code === originalCode) {
    // 最终代码字符串未变时保留原 code/map；即使插件仅返回新 map，此分支也不采用它。
    // debug 日志把这次转换标为 skipped。
    debugTransform?.(
      timeFrom(transformStart) + colors.dim(` [skipped] ${prettyUrl}`),
    )
  } else {
    debugTransform?.(`${timeFrom(transformStart)} ${prettyUrl}`)
    code = transformResult.code!
    map = transformResult.map
  }

  let normalizedMap:
    | SourceMap
    | {
        /** 插件显式返回的空映射哨兵。 */
        mappings: ''
      }
    | null
  if (typeof map === 'string') {
    normalizedMap = JSON.parse(map)
  } else if (map) {
    normalizedMap = map as
      | SourceMap
      | {
          /** 保留 SourceDescription 中允许的空 mappings 形式。 */
          mappings: ''
        }
  } else {
    normalizedMap = null
  }

  if (normalizedMap && 'version' in normalizedMap && mod.file) {
    if (normalizedMap.mappings) {
      await injectSourcesContent(normalizedMap, mod.file, logger)
    }

    const sourcemapPath = `${mod.file}.map`
    applySourcemapIgnoreList(
      normalizedMap,
      sourcemapPath,
      config.server.sourcemapIgnoreList,
      logger,
    )

    if (path.isAbsolute(mod.file)) {
      let modDirname
      for (
        let sourcesIndex = 0;
        sourcesIndex < normalizedMap.sources.length;
        ++sourcesIndex
      ) {
        const sourcePath = normalizedMap.sources[sourcesIndex]
        if (sourcePath) {
          // 把绝对 source 改为相对当前模块路径，给调试器机会映射为可读工作区文件，而不是
          // 显示宿主机器绝对路径。
          if (path.isAbsolute(sourcePath)) {
            modDirname ??= path.dirname(mod.file)
            normalizedMap.sources[sourcesIndex] = path.relative(
              modDirname,
              sourcePath,
            )
          }
        }
      }
    }
  }

  if (environment._closing && environment.config.dev.recoverable)
    throwClosedServerError()

  const topLevelConfig = environment.getTopLevelConfig()
  // moduleRunnerTransform 开启时把 ESM 转为 Module Runner 协议；关闭时生成带 ETag 的转换结果。
  const result = environment.config.dev.moduleRunnerTransform
    ? await ssrTransform(code, normalizedMap, url, originalCode, {
        json: {
          stringify:
            topLevelConfig.json.stringify === true &&
            topLevelConfig.json.namedExports !== true,
        },
      })
    : ({
        code,
        map: normalizedMap,
        etag: getEtag(code, { weak: true }),
      } satisfies TransformResult)

  // 只有处理开始时间晚于最近失效时间才写缓存；过期请求仍可结束，但下一请求必须重做。
  if (timestamp > mod.lastInvalidationTimestamp)
    moduleGraph.updateModuleTransformResult(mod, result)

  return result
}

/**
 * 处理软失效：复用旧 `transformResult`，只修补必要的导入时间戳。
 *
 * client 需给已 HMR 更新的依赖追加新 `?t=`；SSR 的模块缓存/执行由 Module Runner 控制，代码
 * 无需变化。硬失效返回空，走完整 load/transform。
 */
async function handleModuleSoftInvalidation(
  environment: DevEnvironment,
  mod: EnvironmentModuleNode,
  timestamp: number,
) {
  const transformResult = mod.invalidationState

  // 每次请求消费一次 invalidationState，后续失效会重新写入。
  mod.invalidationState = undefined

  // 未失效或硬失效都不能走快速修补。
  if (!transformResult || transformResult === 'HARD_INVALIDATED') return

  if (mod.transformResult) {
    throw new Error(
      `Internal server error: Soft-invalidated module "${mod.url}" should not have existing transform result`,
    )
  }

  let result: TransformResult
  // SSR 软失效直接复用旧结果。
  if (transformResult.ssr) {
    result = transformResult
  }
  // client 重新扫描 import specifier，为对应依赖写入最新 HMR 时间戳。
  else {
    await init
    const source = transformResult.code
    const s = new MagicString(source)
    const [imports] = parseImports(source, mod.id || undefined)

    for (const imp of imports) {
      let rawUrl = source.slice(imp.s, imp.e)
      if (rawUrl === 'import.meta') continue

      const hasQuotes = rawUrl[0] === '"' || rawUrl[0] === "'"
      if (hasQuotes) {
        rawUrl = rawUrl.slice(1, -1)
      }

      const urlWithoutTimestamp = removeTimestampQuery(rawUrl)
      // hmrUrl 必须与 importAnalysis 的 base/import query/虚拟 ID 规范化完全一致，才能命中图节点。
      const hmrUrl = unwrapId(
        stripBase(
          removeImportQuery(urlWithoutTimestamp),
          environment.config.base,
        ),
      )
      for (const importedMod of mod.importedModules) {
        if (importedMod.url !== hmrUrl) continue
        if (importedMod.lastHMRTimestamp > 0) {
          const replacedUrl = injectQuery(
            urlWithoutTimestamp,
            `t=${importedMod.lastHMRTimestamp}`,
          )
          const start = hasQuotes ? imp.s + 1 : imp.s
          const end = hasQuotes ? imp.e - 1 : imp.e
          s.overwrite(start, end, replacedUrl)
        }

        if (imp.d === -1 && environment.config.dev.preTransformRequests) {
          // 已知静态直接 import 可投机预热，避免浏览器下一请求形成瀑布。
          environment.warmupRequest(hmrUrl)
        }

        break
      }
    }

    // 时间戳替换沿用旧 map，并重算内容 ETag；URL 长度变化时没有重新生成该行后续字符的列映射。
    const code = s.toString()
    result = {
      ...transformResult,
      code,
      etag: getEtag(code, { weak: true }),
    }
  }

  // 修补过程中若再次失效，同样不能覆盖更新后的失效状态。
  if (timestamp > mod.lastInvalidationTimestamp)
    environment.moduleGraph.updateModuleTransformResult(mod, result)

  return result
}

/** 与 Rolldown 默认扩展名模块类型保持一致的映射。 */
// 参考 https://github.com/rolldown/rolldown/blob/cc66f4b7189dfb3a248608d02f5962edb09b11f8/crates/rolldown/src/utils/normalize_options.rs#L95-L111
const defaultModuleTypes: Record<string, ModuleType | undefined> = {
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'jsx',
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  tsx: 'tsx',
  json: 'json',
  txt: 'text',
  css: 'css',
}

// 参考 https://github.com/rolldown/rolldown/blob/bf53a100edf1780d5a5aa41f0bc0459c5696543e/crates/rolldown/src/utils/load_source.rs#L53-L89
/**
 * 逐个检查 ID 中每个 `.` 后的完整剩余串，命中类型表即返回；`foo.a.ts` 可命中 ts，
 * `foo.ts?raw` 不会自动去 query，因此不命中。
 */
export function getModuleTypeFromId(id: string): ModuleType | undefined {
  let pos = -1
  while ((pos = id.indexOf('.', pos + 1)) >= 0) {
    const ext = id.slice(pos + 1)
    const moduleType = defaultModuleTypes[ext]
    if (moduleType) {
      return moduleType
    }
  }
}
