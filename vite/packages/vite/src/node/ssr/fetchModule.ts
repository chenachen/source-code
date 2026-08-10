import { pathToFileURL } from 'node:url'
import type { FetchResult } from 'vite/module-runner'
import type { EnvironmentModuleNode, TransformResult } from '..'
import { tryNodeResolve } from '../plugins/resolve'
import { isBuiltin, isExternalUrl, isFilePathESM } from '../utils'
import { unwrapId } from '../../shared/utils'
import {
  MODULE_RUNNER_SOURCEMAPPING_SOURCE,
  SOURCEMAPPING_URL,
} from '../../shared/constants'
import { genSourceMapUrl } from '../server/sourcemap'
import type { DevEnvironment } from '../server/environment'

/** Module Runner 拉取模块时的缓存、Source Map 与 wrapper 偏移选项。 */
export interface FetchModuleOptions {
  /** 客户端是否已缓存该模块，用于省略重复 code 传输。 */
  cached?: boolean
  /** 是否只保留 Module Runner 消费的内联 sourcemap。 */
  inlineSourceMap?: boolean
  /** evaluator 在生成函数前注入的行数，用于偏移 mappings。 */
  startOffset?: number
}

/**
 * 在 DevEnvironment 中解析、externalize 或变换一个 Module Runner 请求。
 * 返回 external 元信息、cache 确认，或带稳定 id/url/file 的可执行代码。
 * @experimental
 */
export async function fetchModule(
  environment: DevEnvironment,
  url: string,
  importer?: string,
  options: FetchModuleOptions = {},
): Promise<FetchResult> {
  if (
    url.startsWith('data:') ||
    isBuiltin(environment.config.resolve.builtins, url)
  ) {
    return { externalize: url, type: 'builtin' }
  }

  // 无法静态分析的动态 import 可能在运行时产生 file URL，仍需走本地解析。
  const isFileUrl = url.startsWith('file://')

  if (isExternalUrl(url) && !isFileUrl) {
    return { externalize: url, type: 'network' }
  }

  // 无 importer 表示入口，入口始终 internalize；依赖的裸导入才尝试交给 Node externalize。
  if (!isFileUrl && importer && url[0] !== '.' && url[0] !== '/') {
    const { isProduction, root } = environment.config
    const { externalConditions, dedupe, preserveSymlinks } =
      environment.config.resolve

    const resolved = tryNodeResolve(url, importer, {
      mainFields: ['main'],
      conditions: externalConditions,
      externalConditions,
      external: [],
      noExternal: [],
      extensions: ['.js', '.cjs', '.json'],
      dedupe,
      preserveSymlinks,
      tsconfigPaths: false,
      isBuild: false,
      isProduction,
      root,
      packageCache: environment.config.packageCache,
      builtins: environment.config.resolve.builtins,
    })
    if (!resolved) {
      const err: any = new Error(
        `Cannot find module '${url}' imported from '${importer}'`,
      )
      err.code = 'ERR_MODULE_NOT_FOUND'
      throw err
    }
    const file = pathToFileURL(resolved.id).toString()
    const type = isFilePathESM(resolved.id, environment.config.packageCache)
      ? 'module'
      : 'commonjs'
    return { externalize: file, type }
  }

  url = unwrapId(url)

  const mod = await environment.moduleGraph.ensureEntryFromUrl(url)
  const cached = !!mod.transformResult

  // runner 与服务端都已有缓存时只返回确认，避免再次传输代码和 sourcemap。
  if (options.cached && cached) {
    return { cache: true }
  }

  let result = await environment.transformRequest(url)

  if (!result) {
    throw new Error(
      `[vite] transform failed for module '${url}'${
        importer ? ` imported from '${importer}'` : ''
      }.`,
    )
  }

  if (options.inlineSourceMap !== false) {
    result = inlineSourceMap(mod, result, options.startOffset)
  }

  // evaluator 用函数执行代码，shebang 不是函数体合法语法；等长空格保持映射列位置。
  if (result.code[0] === '#')
    result.code = result.code.replace(/^#!.*/, (s) => ' '.repeat(s.length))

  return {
    code: result.code,
    file: mod.file,
    id: mod.id!,
    url: mod.url,
    invalidate: !cached,
  }
}

/** 匹配代码末尾非 Vite Module Runner 协议生成的 base64 Source Map 注释。 */
const OTHER_SOURCE_MAP_REGEXP = new RegExp(
  `//# ${SOURCEMAPPING_URL}=data:application/json[^,]+base64,([A-Za-z0-9+/=]+)$`,
  'gm',
)

/**
 * 移除其他内联 map，只附加 Module Runner 使用的 sourceURL 与 Vite map；可按
 * evaluator wrapper 行数前置空 mappings，减少传输并保证栈位置。
 */
function inlineSourceMap(
  mod: EnvironmentModuleNode,
  result: TransformResult,
  startOffset: number | undefined,
) {
  const map = result.map
  let code = result.code

  if (
    !map ||
    !('version' in map) ||
    code.includes(MODULE_RUNNER_SOURCEMAPPING_SOURCE)
  )
    return result

  // runner 只消费最终 Vite map，移除上游 data map 可显著缩小 RPC payload。
  OTHER_SOURCE_MAP_REGEXP.lastIndex = 0
  if (OTHER_SOURCE_MAP_REGEXP.test(code))
    code = code.replace(OTHER_SOURCE_MAP_REGEXP, '')

  const sourceMap = startOffset
    ? Object.assign({}, map, {
        mappings: ';'.repeat(startOffset) + map.mappings,
      })
    : map
  result.code = `${code.trimEnd()}\n//# sourceURL=${
    mod.id
  }\n${MODULE_RUNNER_SOURCEMAPPING_SOURCE}\n//# ${SOURCEMAPPING_URL}=${genSourceMapUrl(sourceMap)}\n`

  return result
}
