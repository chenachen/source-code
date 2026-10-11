import path from 'node:path'
import fsp from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { pathToFileURL } from 'node:url'
import * as mrmime from 'mrmime'
import type {
  NormalizedOutputOptions,
  PluginContext,
  RenderedChunk,
} from 'rolldown'
import MagicString from 'magic-string'
import colors from 'picocolors'
import picomatch from 'picomatch'
import { makeIdFiltersToMatchWithQuery } from 'rolldown/filter'
import {
  createToImportMetaURLBasedRelativeRuntime,
  toOutputFilePathInJS,
} from '../build'
import type { Plugin } from '../plugin'
import type { ResolvedConfig } from '../config'
import { checkPublicFile } from '../publicDir'
import {
  encodeURIPath,
  getHash,
  injectQuery,
  joinUrlSegments,
  normalizePath,
  rawRE,
  removeLeadingSlash,
  removeUrlQuery,
  urlRE,
} from '../utils'
import {
  DEFAULT_ASSETS_INLINE_LIMIT,
  DEFAULT_ASSETS_RE,
  FS_PREFIX,
} from '../constants'
import {
  cleanUrl,
  splitFileAndPostfix,
  withTrailingSlash,
} from '../../shared/utils'
import type { Environment } from '../environment'
import type { PartialEnvironment } from '../baseEnvironment'
import { getImportMapFilename } from './html'

// referenceId 使用 base64url 字符集但以 `$` 替代 `-`；正则需允许该字符。
export const assetUrlRE: RegExp = /__VITE_ASSET__([\w$]+)__(?:\$_(.*?)__)?/g

/** 识别 JavaScript sourcemap 文件，避免把映射文件再次当作普通资源处理。 */
const jsSourceMapRE = /\.[cm]?js\.map$/

/** 识别显式禁止内联的查询参数，使资源始终走文件发射路径。 */
export const noInlineRE: RegExp = /[?&]no-inline\b/
/** 识别显式要求内联的查询参数，使资源优先转换为 data URL。 */
export const inlineRE: RegExp = /[?&]inline\b/

/** 按环境缓存资源文件到最终 URL 的映射，防止不同环境共享构建状态。 */
const assetCache = new WeakMap<Environment, Map<string, string>>()

/** 每个 Environment 的 CSS entry JS chunk 名 → CSS referenceId/逻辑名称映射。 */
export const cssEntriesMap: WeakMap<
  Environment,
  Map<
    string,
    {
      /** Rollup 为 CSS 入口资源分配的引用 ID。 */
      referenceId: string
      /** CSS 入口用于生成产物名的逻辑名称。 */
      name: string
    }
  >
> = new WeakMap()

/** 给 mrmime 补 Vite 需要的兼容 MIME 映射；每次创建 asset 插件时调用。 */
export function registerCustomMime(): void {
  // https://github.com/lukeed/mrmime/issues/3
  // IANA 登记 ico 为 image/vnd.microsoft.icon，但 image/x-icon 的浏览器兼容性更好：
  // https://github.com/h5bp/html5-boilerplate/issues/219
  mrmime.mimes.ico = 'image/x-icon'
  // https://mimesniff.spec.whatwg.org/#matching-an-image-type-pattern
  mrmime.mimes.cur = 'image/x-icon'
  // https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Containers#flac
  mrmime.mimes.flac = 'audio/flac'
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
  mrmime.mimes.eot = 'application/vnd.ms-fontobject'
}

/**
 * renderChunk 阶段把 JS 及其内联 CSS 字符串中的 asset/public 占位符替换为最终 URL；asset 引用同时登记 importedAssets。
 * 此时已知 chunk 文件名，才能正确计算 relative base 或 renderBuiltUrl runtime 表达式。
 */
export function renderAssetUrlInJS(
  pluginContext: PluginContext,
  chunk: RenderedChunk,
  opts: NormalizedOutputOptions,
  code: string,
): MagicString | undefined {
  const { environment } = pluginContext
  const toRelativeRuntime = createToImportMetaURLBasedRelativeRuntime(
    opts.format,
    environment.config.isWorker,
  )

  let match: RegExpExecArray | null
  let s: MagicString | undefined

  // JS 写入的 URL（如 img.src = "__VITE_ASSET__..."）已有字符串引号。

  // JS 内联 CSS 也位于外层字符串：var css = "background:url(__VITE_ASSET__...)"。

  // 两者 wrapper 已由上游正确转义，此处只替换占位符内部文本。

  assetUrlRE.lastIndex = 0
  while ((match = assetUrlRE.exec(code))) {
    s ||= new MagicString(code)
    const [full, referenceId, postfix = ''] = match
    const file = pluginContext.getFileName(referenceId)
    chunk.viteMetadata!.importedAssets.add(cleanUrl(file))
    const filename = file + postfix
    const replacement = toOutputFilePathInJS(
      environment,
      filename,
      'asset',
      chunk.fileName,
      'js',
      toRelativeRuntime,
    )
    const replacementString =
      typeof replacement === 'string'
        ? JSON.stringify(encodeURIPath(replacement)).slice(1, -1)
        : `"+${replacement.runtime}+"`
    s.update(match.index, match.index + full.length, replacementString)
  }

  // public 占位符不对应 emitFile referenceId，从 config 级 hash→URL cache 恢复原路径。

  const publicAssetUrlMap = publicAssetUrlCache.get(
    environment.getTopLevelConfig(),
  )!
  publicAssetUrlRE.lastIndex = 0
  while ((match = publicAssetUrlRE.exec(code))) {
    s ||= new MagicString(code)
    const [full, hash] = match
    const publicUrl = publicAssetUrlMap.get(hash)!.slice(1)
    const replacement = toOutputFilePathInJS(
      environment,
      publicUrl,
      'public',
      chunk.fileName,
      'js',
      toRelativeRuntime,
    )
    const replacementString =
      typeof replacement === 'string'
        ? JSON.stringify(encodeURIPath(replacement)).slice(1, -1)
        : `"+${replacement.runtime}+"`
    s.update(match.index, match.index + full.length, replacementString)
  }

  return s
}

/**
 * 资源模块插件：`?raw` 导出文本，普通 asset/`?url` 导出开发 URL 或构建占位符，并在 renderChunk 替换
 * 最终路径；同时清理由 standalone asset entry 产生的空 JS chunk。
 */
export function assetPlugin(config: ResolvedConfig): Plugin {
  registerCustomMime()

  return {
    name: 'vite:asset',

    perEnvironmentStartEndDuringDev: true,

    /** 为当前环境重建资源 URL 与 CSS 入口缓存，隔离监听模式的前后两轮构建。 */
    buildStart() {
      assetCache.set(this.environment, new Map())
      cssEntriesMap.set(this.environment, new Map())
    },

    resolveId: {
      filter: {
        id: [
          urlRE,
          DEFAULT_ASSETS_RE,
          ...makeIdFiltersToMatchWithQuery(config.rawAssetsInclude).map((v) =>
            typeof v === 'string' ? picomatch.makeRe(v, { dot: true }) : v,
          ),
        ],
      },
      /** 只接管 Vite 资源或 `?url` 请求；公共目录绝对路径保留原 ID 交给加载钩子。 */
      handler(id) {
        if (!config.assetsInclude(cleanUrl(id)) && !urlRE.test(id)) {
          return
        }
        // 指向 public 的根绝对 import 不通过普通文件 resolver，在这里保留原 ID 交给 load。
        const publicFile = checkPublicFile(id, config)
        if (publicFile) {
          return id
        }
      },
    },

    load: {
      filter: {
        id: {
          include: [
            rawRE,
            urlRE,
            DEFAULT_ASSETS_RE,
            ...makeIdFiltersToMatchWithQuery(config.rawAssetsInclude),
          ],
          // 按 Rollup 约定，null-byte ID 应由创建它的插件处理，asset 插件不得抢占。
          exclude: /^\0/,
        },
      },
      /** 读取 raw 资源或把普通资源转换为开发 URL、data URL、构建占位符导出。 */
      async handler(id) {
        // ?raw 直接从磁盘/public 读取并导出字符串。
        if (rawRE.test(id)) {
          const file = checkPublicFile(id, config) || cleanUrl(id)
          this.addWatchFile(file)
          // 仍登记 watch file，使文本内容变化可触发 HMR。
          return {
            code: `export default ${JSON.stringify(
              await fsp.readFile(file, 'utf-8'),
            )}`,
            map: { mappings: '' },
            moduleType: 'js', // 避免 Rolldown 对 `?raw&.txt` 再按 text 模块补一次 export default。
          }
        }

        if (!urlRE.test(id) && !config.assetsInclude(cleanUrl(id))) {
          return
        }

        id = removeUrlQuery(id)
        let url = await fileToUrl(this, id)

        // asset ModuleNode 已失效时继承 HMR timestamp，绕过浏览器缓存。
        if (!url.startsWith('data:') && this.environment.mode === 'dev') {
          const mod = this.environment.moduleGraph.getModuleById(id)
          if (mod && mod.lastHMRTimestamp > 0) {
            url = injectQuery(url, `t=${mod.lastHMRTimestamp}`)
          }
        }

        return {
          code: `export default ${JSON.stringify(encodeURIPath(url))}`,
          // asset 本身作为 entry 时禁止与其他入口共享，保证可独立追踪；生成的空 JS chunk 稍后删除。
          moduleSideEffects:
            config.command === 'build' && this.getModuleInfo(id)?.isEntry
              ? 'no-treeshake'
              : false,
          meta: config.command === 'build' ? { 'vite:asset': true } : undefined,
          moduleType: 'js', // 避免 `.txt` 等原生模块类型再次生成 export default。
        }
      },
    },

    ...(config.command === 'build'
      ? {
          /** 把 JavaScript 中的资源占位符替换为最终 URL，并按配置生成 sourcemap。 */
          renderChunk(code, chunk, opts) {
            const s = renderAssetUrlInJS(this, chunk, opts, code)

            if (s) {
              return {
                code: s.toString(),
                map: this.environment.config.build.sourcemap
                  ? s.generateMap({ hires: 'boundary' })
                  : null,
              }
            } else {
              return null
            }
          },
        }
      : {}),

    /** 移除无引用的纯资源空入口；禁用资源发射的环境还会剔除非 JS 资产。 */
    generateBundle(_, bundle) {
      // 删除仅包装 standalone asset entry 且没有任何 importer 的空 JS chunk。
      let importedFiles: Set<string> | undefined
      for (const file in bundle) {
        const chunk = bundle[file]
        if (
          chunk.type === 'chunk' &&
          chunk.isEntry &&
          chunk.moduleIds.length === 1 &&
          config.assetsInclude(chunk.moduleIds[0]) &&
          this.getModuleInfo(chunk.moduleIds[0])?.meta['vite:asset']
        ) {
          if (!importedFiles) {
            importedFiles = new Set()
            for (const file in bundle) {
              const chunk = bundle[file]
              if (chunk.type === 'chunk') {
                for (const importedFile of chunk.imports) {
                  importedFiles.add(importedFile)
                }
                for (const importedFile of chunk.dynamicImports) {
                  importedFiles.add(importedFile)
                }
              }
            }
          }
          if (!importedFiles.has(file)) {
            delete bundle[file]
          }
        }
      }

      // 关闭 emitAssets 时剔除资产；保留 JS map、名字以 ssr-manifest.json 结尾的文件及启用的 chunk import map。
      if (
        config.command === 'build' &&
        !this.environment.config.build.emitAssets
      ) {
        const chunkImportMapEnabled =
          this.environment.config.build.chunkImportMap
        for (const file in bundle) {
          if (
            bundle[file].type === 'asset' &&
            !file.endsWith('ssr-manifest.json') &&
            !jsSourceMapRE.test(file) &&
            !(
              chunkImportMapEnabled &&
              file === getImportMapFilename(this.environment.config)
            )
          ) {
            delete bundle[file]
          }
        }
      }
    },

    /** 文件变化时删除当前环境中以规范化 id 为键的资源 URL 缓存项。 */
    watchChange(id) {
      assetCache.get(this.environment)?.delete(normalizePath(id))
    },
  }
}

/** 按 Environment 的 isBundled 选择开发 URL 或 inline/emit 路径；bundled dev 也使用后者。 */
export async function fileToUrl(
  pluginContext: PluginContext,
  id: string,
  asFileUrl = false,
): Promise<string> {
  const { environment } = pluginContext
  if (!environment.config.isBundled) {
    return fileToDevUrl(environment, id, asFileUrl)
  } else {
    return fileToBuiltUrl(pluginContext, id)
  }
}

/** 把本地/public 资源转换成开发 URL、/@fs/ URL、file URL 或显式 inline data URL。 */
export async function fileToDevUrl(
  environment: Environment,
  id: string,
  asFileUrl = false,
): Promise<string> {
  const config = environment.getTopLevelConfig()
  const publicFile = checkPublicFile(id, config)

  // `?inline` 无条件读文件并生成 data URL。
  if (inlineRE.test(id)) {
    const file = publicFile || cleanUrl(id)
    const content = await fsp.readFile(file)
    return assetToDataURL(environment, file, content)
  }

  // SVG 在开发态也应用 shouldInline 的通用规则；这里不传构建 context，因此不执行 lib/entry 判断。
  const cleanedId = cleanUrl(id)
  if (cleanedId.endsWith('.svg')) {
    const file = publicFile || cleanedId
    const content = await fsp.readFile(file)
    if (shouldInline(environment, file, id, content, undefined, undefined)) {
      return assetToDataURL(environment, file, content)
    }
  }

  if (asFileUrl) {
    return pathToFileURL(cleanedId).href
  }

  let rtn: string
  if (publicFile) {
    // public 文件开发态保持原根 URL，不改成磁盘路径。
    rtn = id
  } else if (id.startsWith(withTrailingSlash(config.root))) {
    // root 内文件映射为短根绝对 URL。
    rtn = '/' + path.posix.relative(config.root, id)
  } else {
    // root 外文件使用 /@fs/ 绝对协议，由静态中间件专门处理并执行 fs allow 校验。
    rtn = path.posix.join(FS_PREFIX, id)
  }
  const base = joinUrlSegments(config.server.origin ?? '', config.decodedBase)
  return joinUrlSegments(base, removeLeadingSlash(rtn))
}

/** 从公共资源占位符哈希反查原始文件名，供产物 URL 重写阶段使用。 */
export function getPublicAssetFilename(
  hash: string,
  config: ResolvedConfig,
): string | undefined {
  return publicAssetUrlCache.get(config)?.get(hash)
}

// 内层映射为 hash → 原 public URL；WeakMap 按 config 隔离。
export const publicAssetUrlCache: WeakMap<
  ResolvedConfig,
  Map<string, string>
> = new WeakMap()

/** 匹配构建期写入的公共资源占位符，并捕获原 URL 的哈希。 */
export const publicAssetUrlRE: RegExp = /__VITE_PUBLIC_ASSET__([a-z\d]{8})__/g

/** 开发态拼 base；构建态把 public URL 编码成不经 emitFile 的稳定 hash 占位符。 */
export function publicFileToBuiltUrl(
  url: string,
  config: ResolvedConfig,
): string {
  if (config.command !== 'build') {
    // 开发态不需要相对输出目录或 renderBuiltUrl，直接拼公开 base。
    return joinUrlSegments(config.decodedBase, url)
  }
  const hash = getHash(url)
  let cache = publicAssetUrlCache.get(config)
  if (!cache) {
    cache = new Map<string, string>()
    publicAssetUrlCache.set(config, cache)
  }
  if (!cache.get(hash)) {
    cache.set(hash, url)
  }
  return `__VITE_PUBLIC_ASSET__${hash}__`
}

/** Git LFS 指针文件的固定头部，默认大小策略用它排除未拉取的指针内容。 */
const GIT_LFS_PREFIX = Buffer.from('version https://git-lfs.github.com')
/** 判断缓冲区是否仍是 Git LFS 指针，避免生成无效的 data URL。 */
function isGitLfsPlaceholder(content: Buffer): boolean {
  if (content.length < GIT_LFS_PREFIX.length) return false
  // Git LFS 未拉取对象以固定前缀开头；显式内联/库模式可绕过默认排除。
  return GIT_LFS_PREFIX.compare(content, 0, GIT_LFS_PREFIX.length) === 0
}

/** 构建态按策略 inline 或 emit asset，并返回 data URL / public 占位符 / referenceId 占位符。 */
async function fileToBuiltUrl(
  pluginContext: PluginContext,
  id: string,
  skipPublicCheck = false,
  forceInline?: boolean,
): Promise<string> {
  const environment = pluginContext.environment
  const topLevelConfig = environment.getTopLevelConfig()
  if (!skipPublicCheck) {
    const publicFile = checkPublicFile(id, topLevelConfig)
    if (publicFile) {
      if (inlineRE.test(id)) {
        // public?inline 需把 URL 改回真实磁盘文件，才能读取内容。
        id = publicFile
      } else {
        return publicFileToBuiltUrl(id, topLevelConfig)
      }
    }
  }

  const cache = assetCache.get(environment)!
  const cached = cache.get(id)
  if (cached) {
    return cached
  }

  let { file, postfix } = splitFileAndPostfix(id)
  const content = await fsp.readFile(file)

  let url: string
  if (
    shouldInline(environment, file, id, content, pluginContext, forceInline)
  ) {
    url = assetToDataURL(environment, file, content)
  } else {
    // 非 inline：交给 Rolldown emitFile，最终文件名留到 renderChunk 获取。
    const originalFileName = normalizePath(
      path.relative(environment.config.root, file),
    )
    const referenceId = pluginContext.emitFile({
      type: 'asset',
      // name 只取 basename；originalFileName 另保留 root 相对结构供 assetFileNames/manifest 使用。
      name: path.basename(file),
      originalFileName,
      source: content,
    })

    if (environment.config.command === 'build' && noInlineRE.test(postfix)) {
      postfix = postfix.replace(noInlineRE, '').replace(/^&/, '?')
    }

    if (
      environment.config.command === 'serve' &&
      environment.config.isBundled
    ) {
      const outputFilename = pluginContext.getFileName(referenceId)
      url = toOutputFilePathInJSForBundledDev(environment, outputFilename)
    } else {
      url = `__VITE_ASSET__${referenceId}__${postfix ? `$_${postfix}__` : ``}`
    }
  }

  cache.set(id, url)
  return url
}

/** bundled dev 的 asset 输出固定按 assets/dummy.js 推导；不支持 relative base/runtime renderBuiltUrl。 */
export function toOutputFilePathInJSForBundledDev(
  environment: PartialEnvironment,
  filename: string,
): string {
  const outputUrl = toOutputFilePathInJS(
    environment,
    filename,
    'asset',
    // bundled dev chunk 固定发射到 assets 目录，用 dummy.js 提供相对位置上下文。
    'assets/dummy.js',
    'js',
    // bundled dev 不支持 relative base，因此相对 runtime 回调不应被调用。
    () => {
      throw new Error('unreachable')
    },
  )
  // bundled dev 不支持 renderBuiltUrl 返回 runtime 表达式。
  if (typeof outputUrl === 'object') throw new Error('unreachable')
  return outputUrl
}

/** 以 importer 为基准把源码 URL 解析为文件，再复用构建 asset inline/emit 协议。 */
export async function urlToBuiltUrl(
  pluginContext: PluginContext,
  url: string,
  importer: string,
  forceInline?: boolean,
): Promise<string> {
  const topLevelConfig = pluginContext.environment.getTopLevelConfig()
  if (checkPublicFile(url, topLevelConfig)) {
    return publicFileToBuiltUrl(url, topLevelConfig)
  }
  const file = normalizePath(
    url[0] === '/'
      ? path.join(topLevelConfig.root, url)
      : path.join(path.dirname(importer), url),
  )
  return fileToBuiltUrl(
    pluginContext,
    file,
    // 上方已检查 public，避免重复文件系统查询。
    true,
    forceInline,
  )
}

/** 依次检查 query、构建 lib/entry、forceInline、文件类型、回调及默认大小/LFS 规则。 */
function shouldInline(
  environment: Environment,
  file: string,
  id: string,
  content: Buffer,
  /** 只应在构建阶段传入；存在它也表示允许执行 entry/lib 等构建专属判断。 */
  buildPluginContext: PluginContext | undefined,
  forceInline: boolean | undefined,
): boolean {
  if (noInlineRE.test(id)) return false
  if (inlineRE.test(id)) return true
  // 仅传入构建 plugin context 时执行 lib/entry 专属规则。
  if (buildPluginContext) {
    if (environment.config.build.lib) return true
    if (buildPluginContext.getModuleInfo(id)?.isEntry) return false
  }
  if (forceInline !== undefined) return forceInline
  if (file.endsWith('.html')) return false
  // 未被前面的显式 query/lib/forceInline 决定时，带 fragment 的 SVG 保持外置文件。
  if (file.endsWith('.svg') && id.includes('#')) return false
  let limit: number
  const { assetsInlineLimit } = environment.config.build
  if (typeof assetsInlineLimit === 'function') {
    const userShouldInline = assetsInlineLimit(file, content)
    if (userShouldInline != null) return userShouldInline
    limit = DEFAULT_ASSETS_INLINE_LIMIT
  } else {
    limit = Number(assetsInlineLimit)
  }
  return content.length < limit && !isGitLfsPlaceholder(content)
}

/** 按 MIME 类型把资源编码为 data URL，并对 SVG 使用更紧凑的文本编码。 */
function assetToDataURL(
  environment: Environment,
  file: string,
  content: Buffer,
) {
  if (environment.config.build.lib && isGitLfsPlaceholder(content)) {
    environment.logger.warn(
      colors.yellow(`Inlined file ${file} was not downloaded via Git LFS`),
    )
  }

  if (file.endsWith('.svg')) {
    return svgToDataURL(content)
  } else {
    const mimeType = mrmime.lookup(file) ?? 'application/octet-stream'
    // 非 SVG 按 MIME + base64 生成 data URL。
    return `data:${mimeType};base64,${content.toString('base64')}`
  }
}

/** 识别同时包含嵌套单双引号的 SVG，避免不安全的文本型 data URL。 */
const nestedQuotesRE = /"[^"']*'[^"]*"|'[^'"]*"[^']*'/

// SVG 编码策略参考 Iconify 实现：
// https://github.com/iconify/iconify/blob/main/packages/utils/src/svg/url.ts
/** 压缩并转义 SVG 文本；遇到嵌套引号时回退 Base64 以保证 URL 可解析。 */
function svgToDataURL(content: Buffer): string {
  const stringContent = content.toString()
  // 含 text/foreignObject/嵌套引号时，文本变换可能改变语义，且转义成本抵消 data URI 优势，回退 base64。
  if (
    stringContent.includes('<text') ||
    stringContent.includes('<foreignObject') ||
    nestedQuotesRE.test(stringContent)
  ) {
    return `data:image/svg+xml;base64,${content.toString('base64')}`
  } else {
    return (
      'data:image/svg+xml,' +
      stringContent
        .trim()
        .replaceAll(/>\s+</g, '><')
        .replaceAll('"', "'")
        .replaceAll('%', '%25')
        .replaceAll('#', '%23')
        .replaceAll('<', '%3c')
        .replaceAll('>', '%3e')
        // srcset 不允许裸空格，统一编码为 %20。未压缩 URI 偶尔比 base64 大，但 gzip/brotli 压缩效果
        // 明显更好：https://github.com/vitejs/vite/pull/14643#issuecomment-1766288673
        .replaceAll(/\s+/g, '%20')
    )
  }
}
