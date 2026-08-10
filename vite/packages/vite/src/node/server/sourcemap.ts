import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import convertSourceMap from 'convert-source-map'
import type { ExistingRawSourceMap, SourceMap } from 'rolldown'
import colors from 'picocolors'
import type { Logger } from '../logger'
import {
  blankReplacer,
  createDebugger,
  isParentDirectory,
  normalizePath,
} from '../utils'
import { cleanUrl } from '../../shared/utils'

/** `DEBUG=vite:sourcemap` 启用的缺失 source 诊断日志。 */
const debug = createDebugger('vite:sourcemap', {
  onlyWhenFocused: true,
})

/**
 * 从 node_modules 内文件路径提取其包根。scope 包会保留 `@scope/pkg` 两段；不在 node_modules
 * 时返回 undefined。该边界用于防止第三方 Source Map 读取包目录外的宿主文件。
 */
export function getNodeModulesPackageRoot(
  filePath: string,
): string | undefined {
  const normalized = normalizePath(filePath)
  const nodeModulesIndex = normalized.lastIndexOf('/node_modules/')
  if (nodeModulesIndex === -1) return undefined

  const packageStart = nodeModulesIndex + '/node_modules/'.length
  const rest = normalized.slice(packageStart)
  const firstSlash = rest.indexOf('/')

  let packageName: string
  if (rest.startsWith('@')) {
    // scope 包根由 `@scope/pkg` 两段组成。
    const secondSlash = rest.indexOf('/', firstSlash + 1)
    packageName = secondSlash === -1 ? rest : rest.slice(0, secondSlash)
  } else {
    packageName = firstSlash === -1 ? rest : rest.slice(0, firstSlash)
  }
  return normalized.slice(0, packageStart) + packageName
}

/**
 * 不应尝试从磁盘补 sourcesContent 的虚拟 source。标准虚拟模块以 null byte 开头，另兼容
 * esbuildDepPlugin 使用的特殊前缀。
 */
const virtualSourceRE = /^(?:dep:|browser-external:|virtual:)|\0/

/** injectSourcesContent 所需的最小 Source Map 结构。 */
interface SourceMapLike {
  /** Source Map 声明的源文件路径列表。 */
  sources: string[]
  /** 与 sources 同序的可选内联源码内容。 */
  sourcesContent?: (string | null)[]
  /** 解析相对 source 路径时使用的可选根目录。 */
  sourceRoot?: string
}

/** 解析 map.sourceRoot 的真实路径；虚拟模块、路径不存在或无权限时返回 undefined。 */
async function computeSourceRoute(map: SourceMapLike, file: string) {
  let sourceRoot: string | undefined
  try {
    // 虚拟模块、无权限或不存在路径无法得到真实 sourceRoot，静默回退 source 原路径。
    sourceRoot = await fsp.realpath(
      path.resolve(path.dirname(file), map.sourceRoot || ''),
    )
  } catch {}
  return sourceRoot
}

/**
 * 为缺失的 sourcesContent 并行读取源码。
 * 对 node_modules map，读取范围严格限制在所属包根，防止恶意包通过 `../../.env` 一类 source
 * 引用窃取宿主文件；缺失文件只告警，不让 transform 失败。
 */
export async function injectSourcesContent(
  map: SourceMapLike,
  file: string,
  logger: Logger,
): Promise<void> {
  let sourceRootPromise: Promise<string | undefined>

  const packageRoot = getNodeModulesPackageRoot(file)
  const missingSources: string[] = []
  const sourcesContent = map.sourcesContent || []
  const sourcesContentPromises: Promise<void>[] = []
  for (let index = 0; index < map.sources.length; index++) {
    const sourcePath = map.sources[index]
    if (
      sourcesContent[index] == null &&
      sourcePath &&
      !virtualSourceRE.test(sourcePath)
    ) {
      sourcesContentPromises.push(
        (async () => {
          // 仅为 null/undefined 槽位读取源码，保留上游已经内联的内容。
          sourceRootPromise ??= computeSourceRoute(map, file)
          const sourceRoot = await sourceRootPromise
          let resolvedSourcePath = cleanUrl(decodeURI(sourcePath))
          if (sourceRoot) {
            resolvedSourcePath = path.resolve(sourceRoot, resolvedSourcePath)
          }
          // 第三方 package Source Map 不能越过包根指向宿主敏感文件。
          if (packageRoot) {
            const resolvedSourcePathNormalized = normalizePath(
              path.resolve(resolvedSourcePath),
            )
            if (!isParentDirectory(packageRoot, resolvedSourcePathNormalized)) {
              sourcesContent[index] = null
              logger.warnOnce(
                colors.yellow(
                  `Sourcemap for ${JSON.stringify(file)} points to a source file outside its package: ${JSON.stringify(resolvedSourcePathNormalized)}`,
                ),
              )
              return
            }
          }
          sourcesContent[index] = await fsp
            .readFile(resolvedSourcePath, 'utf-8')
            .catch(() => {
              missingSources.push(resolvedSourcePath)
              return null
            })
        })(),
      )
    }
  }

  await Promise.all(sourcesContentPromises)

  map.sourcesContent = sourcesContent

  // 普通日志只提示存在缺失 source；开启 DEBUG=vite:sourcemap 才输出完整路径列表。
  if (missingSources.length) {
    logger.warnOnce(`Sourcemap for "${file}" points to missing source files`)
    debug?.(`Missing sources:\n  ` + missingSources.join(`\n  `))
  }
}

/** 把 Source Map 序列化为 base64 data URL。 */
export function genSourceMapUrl(map: SourceMap | string): string {
  if (typeof map !== 'string') {
    map = JSON.stringify(map)
  }
  return `data:application/json;base64,${Buffer.from(map).toString('base64')}`
}

/**
 * 给 JS/CSS 追加对应语法的内联 Source Map 引用；debug 模式额外把 map 作为注释展开，便于排查。
 */
export function getCodeWithSourcemap(
  type: 'js' | 'css',
  code: string,
  map: SourceMap,
): string {
  if (debug) {
    code += `\n/*${JSON.stringify(map, null, 2).replace(/\*\//g, '*\\/')}*/\n`
  }

  if (type === 'js') {
    code += `\n//# sourceMappingURL=${genSourceMapUrl(map)}`
  } else if (type === 'css') {
    code += `\n/*# sourceMappingURL=${genSourceMapUrl(map)} */`
  }

  return code
}

/**
 * 按配置函数把 source 索引追加到 `x_google_ignoreList`。保留上游已有索引并去重；返回非布尔值
 * 时告警但仍按 JavaScript truthiness 兼容处理。
 */
export function applySourcemapIgnoreList(
  map: ExistingRawSourceMap,
  sourcemapPath: string,
  sourcemapIgnoreList: (sourcePath: string, sourcemapPath: string) => boolean,
  logger?: Logger,
): void {
  let { x_google_ignoreList } = map
  if (x_google_ignoreList === undefined) {
    x_google_ignoreList = []
  }
  if (map.sources) {
    for (
      let sourcesIndex = 0;
      sourcesIndex < map.sources.length;
      ++sourcesIndex
    ) {
      const sourcePath = map.sources[sourcesIndex]
      if (!sourcePath) continue

      const ignoreList = sourcemapIgnoreList(
        path.isAbsolute(sourcePath)
          ? sourcePath
          : path.resolve(path.dirname(sourcemapPath), sourcePath),
        sourcemapPath,
      )
      if (logger && typeof ignoreList !== 'boolean') {
        logger.warn('sourcemapIgnoreList function must return a boolean.')
      }

      if (ignoreList && !x_google_ignoreList.includes(sourcesIndex)) {
        x_google_ignoreList.push(sourcesIndex)
      }
    }

    if (x_google_ignoreList.length > 0) {
      if (!map.x_google_ignoreList)
        map.x_google_ignoreList = x_google_ignoreList
    }
  }
}

/**
 * 从源码末尾提取内联或外部 Source Map，并用空白替换引用注释以保持行列位置稳定。
 */
export function extractSourcemapFromFile(
  code: string,
  filePath: string,
  logger: Logger,
):
  | {
      /** 用等长空白替换 Source Map 引用注释后的源码。 */
      code: string
      /** 从内联 data URL 或外部 map 文件解析出的映射。 */
      map: SourceMap
    }
  | undefined {
  const map = (
    convertSourceMap.fromSource(code) ||
    convertSourceMap.fromMapFileSource(
      code,
      createConvertSourceMapReadMap(filePath, logger),
    )
  )?.toObject()

  if (map) {
    return {
      code: code.replace(convertSourceMap.mapFileCommentRegex, blankReplacer),
      map,
    }
  }
}

/**
 * 创建 convert-source-map 的外部 map 读取器；node_modules 文件引用的 map 也必须留在所属包根。
 */
function createConvertSourceMapReadMap(
  originalFileName: string,
  logger: Logger,
) {
  const packageRoot = getNodeModulesPackageRoot(originalFileName)
  return (filename: string) => {
    const resolvedPath = path.resolve(path.dirname(originalFileName), filename)
    if (
      packageRoot &&
      !isParentDirectory(packageRoot, normalizePath(resolvedPath))
    ) {
      logger.warnOnce(
        colors.yellow(
          `Sourcemap in "${originalFileName}" references a map file outside its package: "${filename}"`,
        ),
      )
      return '{}'
    }
    return fs.readFileSync(resolvedPath, 'utf-8')
  }
}
