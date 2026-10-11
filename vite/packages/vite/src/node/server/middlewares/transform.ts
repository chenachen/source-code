import path from 'node:path'
import fsp from 'node:fs/promises'
import colors from 'picocolors'
import type { ExistingRawSourceMap } from 'rolldown'
import type { Connect } from '#dep-types/connect'
import type { ViteDevServer } from '..'
import {
  createDebugger,
  fsPathFromId,
  injectQuery,
  isCSSRequest,
  isImportRequest,
  isJSRequest,
  normalizePath,
  prettifyUrl,
  removeImportQuery,
  removeTimestampQuery,
} from '../../utils'
import { send } from '../send'
import { ERR_DENIED_ID, ERR_LOAD_URL } from '../transformRequest'
import { applySourcemapIgnoreList } from '../sourcemap'
import { isHTMLProxy } from '../../plugins/html'
import {
  DEP_VERSION_RE,
  ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR,
  ERR_OPTIMIZE_DEPS_PROCESSING_ERROR,
  FS_PREFIX,
} from '../../constants'
import { isDirectCSSRequest, isDirectRequest } from '../../plugins/css'
import { ERR_CLOSED_SERVER } from '../pluginContainer'
import { cleanUrl, unwrapId, withTrailingSlash } from '../../../shared/utils'
import {
  ERR_OUTDATED_OPTIMIZED_DEP,
  NULL_BYTE_PLACEHOLDER,
} from '../../../shared/constants'
import type { ResolvedConfig } from '../../config'
import { checkLoadingAccess, respondWithAccessDenied } from './static'

/** `DEBUG=vite:cache` 启用的 HTTP/模块缓存命中日志。 */
const debugCache = createDebugger('vite:cache')

/** 不应进入模块 transform 的常见浏览器探测路径。 */
const knownIgnoreList = new Set(['/', '/favicon.ico'])

/** Sec-Fetch-Dest 中代表页面导航/嵌入文档的值。 */
const documentFetchDests = new Set([
  'document',
  'iframe',
  'frame',
  'fencedframe',
])
/** 判断请求目标是否为文档；文档交给 HTML/static fallback，不能按 JS 模块响应。 */
function isDocumentFetchDest(req: Connect.IncomingMessage) {
  const fetchDest = req.headers['sec-fetch-dest']
  return fetchDest !== undefined && documentFetchDests.has(fetchDest)
}

// TODO：与 asset/CSS 插件中的 url/raw/inline query 判断合并，避免安全边界规则漂移。
/** 识别请求资源 URL 导出的 `?url` 查询，进入文件访问检查。 */
const urlRE = /[?&]url\b/
/** 识别请求资源原始文本导出的 `?raw` 查询。 */
const rawRE = /[?&]raw\b/
/** 识别要求把资源内联进模块的 `?inline` 查询。 */
const inlineRE = /[?&]inline\b/
/** SVG 即使没有资源 query 也可能经过会读取真实文件的转换路径。 */
const svgRE = /\.svg\b/

/**
 * 对会触发真实文件读取的资源查询执行双重 fs 检查：既检查 clean 文件路径，也检查完整 ID。
 * 后者可阻止 query 中拼接的相对/特殊路径绕过 deny；普通 JS ID 留给 load 阶段按最终文件检查。
 */
export function isServerAccessDeniedForTransform(
  config: ResolvedConfig,
  id: string,
): boolean {
  if (rawRE.test(id) || urlRE.test(id) || inlineRE.test(id) || svgRE.test(id)) {
    return (
      checkLoadingAccess(config, cleanUrl(id)) !== 'allowed' ||
      checkLoadingAccess(config, id) !== 'allowed'
    )
  }
  return false
}

/**
 * 在进入异步 transform 管线前，用 URL+ETag→ModuleNode 反向索引快速返回 304。
 * 文档请求下放并追加 Vary，CSS 因 direct/import 两种身份可能混用 ETag，留给主中间件细判。
 */
export function cachedTransformMiddleware(
  server: ViteDevServer,
): Connect.NextHandleFunction {
  // 保留命名函数；`DEBUG=connect:dispatcher` 会把名称显示在调度日志中。
  /** 文档请求追加 Vary 后下放；非 CSS 请求仅在 ETag 与原 URL 同时命中时结束为 304。 */
  return function viteCachedTransformMiddleware(req, res, next) {
    const environment = server.environments.client

    if (isDocumentFetchDest(req)) {
      res.appendHeader('Vary', 'Sec-Fetch-Dest')
      return next()
    }

    // 必须同时匹配 ETag 和原 URL，避免相同内容的不同模块错误共享身份。
    const ifNoneMatch = req.headers['if-none-match']
    if (ifNoneMatch) {
      const moduleByEtag = environment.moduleGraph.getModuleByEtag(ifNoneMatch)
      if (
        moduleByEtag?.transformResult?.etag === ifNoneMatch &&
        moduleByEtag.url === req.url
      ) {
        // 同一 CSS 既可作为 JS 注入模块，又可 `<link>` 直接请求；浏览器可能把前者 ETag 带给
        // 后者，不能在此直接 304。
        const maybeMixedEtag = isCSSRequest(req.url!)
        if (!maybeMixedEtag) {
          debugCache?.(`[304] ${prettifyUrl(req.url!, server.config.root)}`)
          res.statusCode = 304
          return res.end()
        }
      }
    }

    next()
  }
}

/**
 * client HTTP 模块入口：规范化 URL，提供 Source Map，区分 CSS direct/import，调用
 * environment.transformRequest()，设置依赖缓存，并把预构建换代/关闭/访问拒绝映射为 HTTP。
 */
export function transformMiddleware(
  server: ViteDevServer,
): Connect.NextHandleFunction {
  // 保留命名函数；`DEBUG=connect:dispatcher` 会把名称显示在调度日志中。

  // publicDir 位于 root 内时，用户可能错误地把 `/public/foo` 当公开 URL，需要给出迁移提示。
  const { root, publicDir } = server.config
  const publicDirInRoot = publicDir.startsWith(withTrailingSlash(root))
  const publicPath = `${publicDir.slice(root.length)}/`

  /** 将 GET/HEAD 的模块或 map 请求分派到 client 环境；已知生命周期错误在此转换为 HTTP 状态。 */
  return async function viteTransformMiddleware(req, res, next) {
    const environment = server.environments.client

    if (
      (req.method !== 'GET' && req.method !== 'HEAD') ||
      knownIgnoreList.has(req.url!) ||
      isDocumentFetchDest(req)
    ) {
      return next()
    }

    let url: string
    try {
      url = decodeURI(removeTimestampQuery(req.url!)).replace(
        NULL_BYTE_PLACEHOLDER,
        '\0',
      )
    } catch (e) {
      if (e instanceof URIError) {
        server.config.logger.warn(
          colors.yellow(
            `Malformed URI sequence in request URL: ${removeTimestampQuery(req.url!)}`,
          ),
        )
        return next()
      }
      return next(e)
    }

    const withoutQuery = cleanUrl(url)

    try {
      const isSourceMap = withoutQuery.endsWith('.map')
      // Vite 自己生成 Source Map 引用，因此 `.map` 请求也由本层回答。
      if (isSourceMap) {
        const depsOptimizer = environment.depsOptimizer
        if (depsOptimizer?.isOptimizedDepUrl(url)) {
          // 浏览器请求优化依赖 map 说明对应预构建 JS 已加载；先把 URL 映射到预构建目录。
          const sourcemapPath = url.startsWith(FS_PREFIX)
            ? fsPathFromId(url)
            : normalizePath(path.resolve(server.config.root, url.slice(1)))
          // URL 可能含相对穿越片段；最终路径必须仍被 optimizer 识别为其产物。
          if (!depsOptimizer.isOptimizedDepFile(sourcemapPath)) {
            return next()
          }
          try {
            const map = JSON.parse(
              await fsp.readFile(sourcemapPath, 'utf-8'),
            ) as ExistingRawSourceMap

            applySourcemapIgnoreList(
              map,
              sourcemapPath,
              server.config.server.sourcemapIgnoreList,
              server.config.logger,
            )

            return send(req, res, JSON.stringify(map), 'json', {
              headers: server.config.server.headers,
            })
          } catch {
            // 新依赖触发重优化后，旧 JS 的 map 请求可能已过期。返回空 map 消除浏览器警告，
            // 这是正常换代而非服务器错误。
            const dummySourceMap = {
              version: 3,
              file: sourcemapPath.replace(/\.map$/, ''),
              sources: [],
              sourcesContent: [],
              names: [],
              mappings: ';;;;;;;;;',
            }
            return send(req, res, JSON.stringify(dummySourceMap), 'json', {
              cacheControl: 'no-cache',
              headers: server.config.server.headers,
            })
          }
        } else {
          const originalUrl = url.replace(/\.map($|\?)/, '$1')
          const map = (
            await environment.moduleGraph.getModuleByUrl(originalUrl)
          )?.transformResult?.map
          if (map) {
            return send(req, res, JSON.stringify(map), 'json', {
              headers: server.config.server.headers,
            })
          } else {
            return next()
          }
        }
      }

      if (publicDirInRoot && url.startsWith(publicPath)) {
        warnAboutExplicitPublicPathInUrl(url)
      }

      if (
        req.headers['sec-fetch-dest'] === 'script' ||
        isJSRequest(url) ||
        isImportRequest(url) ||
        isCSSRequest(url) ||
        isHTMLProxy(url)
      ) {
        // `?import` 只标记请求应进入模块管线，不参与实际插件 ID。
        url = removeImportQuery(url)
        // importAnalysis 会给浏览器不能直接表达的 resolved ID 加 Vite 包装前缀，此处解包还原。
        url = unwrapId(url)

        // CSS 的 `<link>` 直接响应与 JS import 注入模块是两个转换身份。
        if (isCSSRequest(url)) {
          if (
            req.headers.accept?.includes('text/css') &&
            !isDirectRequest(url)
          ) {
            url = injectQuery(url, 'direct')
          }

          // 规范化为 direct/import URL 后再查对应节点 ETag，避免两种 CSS 身份混用。
          const ifNoneMatch = req.headers['if-none-match']
          if (
            ifNoneMatch &&
            (await environment.moduleGraph.getModuleByUrl(url))?.transformResult
              ?.etag === ifNoneMatch
          ) {
            debugCache?.(`[304] ${prettifyUrl(url, server.config.root)}`)
            res.statusCode = 304
            return res.end()
          }
        }

        // 进入第 08 章主链：resolve → load → transform → ModuleGraph 缓存。
        const result = await environment.transformRequest(url)
        if (result) {
          const depsOptimizer = environment.depsOptimizer
          const type = isDirectCSSRequest(url) ? 'css' : 'js'
          const isDep =
            DEP_VERSION_RE.test(url) || depsOptimizer?.isOptimizedDepUrl(url)
          return send(req, res, result.code, type, {
            etag: result.etag,
            // 带版本 hash 的 npm 优化依赖内容不可变，可缓存一年；源码每次仍用 ETag 再验证。
            cacheControl: isDep ? 'max-age=31536000,immutable' : 'no-cache',
            headers: server.config.server.headers,
            map: result.map,
          })
        }
      }
    } catch (e) {
      if (e?.code === ERR_OPTIMIZE_DEPS_PROCESSING_ERROR) {
        // 已发送响应时不能重复写；否则用 504 表示当前请求暂时无法由正在处理的优化器满足。
        if (!res.writableEnded) {
          res.statusCode = 504
          res.statusMessage = 'Optimize Deps Processing Error'
          res.end()
        }
        // 优化器处理失败是意外错误，需要记录。
        server.config.logger.error(e.message)
        return
      }
      if (e?.code === ERR_OUTDATED_OPTIMIZED_DEP) {
        // 新依赖发现后旧优化产物请求已过期；页面 full reload 会发新请求，用 504 终止旧请求。
        if (!res.writableEnded) {
          res.statusCode = 504
          res.statusMessage = 'Outdated Optimize Dep'
          res.end()
        }
        // 这是 missing dependency discovery 的正常换代，不记录红色错误。
        return
      }
      if (e?.code === ERR_CLOSED_SERVER) {
        // recoverable Environment 重启时旧请求已无效；新 Server/full reload 会重发。
        if (!res.writableEnded) {
          res.statusCode = 504
          res.statusMessage = 'Outdated Request'
          res.end()
        }
        // 旧实例关闭属于正常生命周期，不记录错误。
        return
      }
      if (e?.code === ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR) {
        // 明确不存在的优化产物返回 404，并给用户可能需要 exclude 的提示。
        if (!res.writableEnded) {
          res.statusCode = 404
          res.end()
        }
        server.config.logger.warn(colors.yellow(e.message))
        return
      }
      if (e?.code === ERR_LOAD_URL) {
        // transform 无法 load 可能表示静态文件、HTML 或用户路由，交给后续中间件。
        return next()
      }
      if (e?.code === ERR_DENIED_ID) {
        const id: string = e.id
        let servingAccessResult = checkLoadingAccess(
          server.config,
          cleanUrl(id),
        )
        if (servingAccessResult === 'allowed') {
          servingAccessResult = checkLoadingAccess(server.config, id)
        }
        if (servingAccessResult === 'denied') {
          respondWithAccessDenied(id, server, res)
          return true
        }
        if (servingAccessResult === 'fallback') {
          next()
          return true
        }
        servingAccessResult satisfies 'allowed'
        throw new Error(`Unexpected access result for id ${id}`)
      }
      return next(e)
    }

    next()
  }

  /** publicDir 位于 root 内时，为 `/public/...` 错误引用生成按请求类型区分的建议。 */
  function warnAboutExplicitPublicPathInUrl(url: string) {
    let warning: string

    if (isImportRequest(url)) {
      const rawUrl = removeImportQuery(url)
      if (urlRE.test(url)) {
        warning =
          `Assets in the public directory are served at the root path.\n` +
          `Instead of ${colors.cyan(rawUrl)}, use ${colors.cyan(
            rawUrl.replace(publicPath, '/'),
          )}.`
      } else {
        warning =
          'Assets in public directory cannot be imported from JavaScript.\n' +
          `If you intend to import that asset, put the file in the src directory, and use ${colors.cyan(
            rawUrl.replace(publicPath, '/src/'),
          )} instead of ${colors.cyan(rawUrl)}.\n` +
          `If you intend to use the URL of that asset, use ${colors.cyan(
            injectQuery(rawUrl.replace(publicPath, '/'), 'url'),
          )}.`
      }
    } else {
      warning =
        `Files in the public directory are served at the root path.\n` +
        `Instead of ${colors.cyan(url)}, use ${colors.cyan(
          url.replace(publicPath, '/'),
        )}.`
    }

    server.config.logger.warn(colors.yellow(warning))
  }
}
