import path from 'node:path'
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http'
import type { Options } from 'sirv'
import sirv from 'sirv'
import escapeHtml from 'escape-html'
import type { Connect } from '#dep-types/connect'
import type { ViteDevServer } from '../../server'
import type { ResolvedConfig } from '../../config'
import { FS_PREFIX } from '../../constants'
import {
  decodeURIIfPossible,
  fsPathFromUrl,
  isFileReadable,
  isImportRequest,
  isInternalRequest,
  isParentDirectory,
  isSameFilePath,
  normalizePath,
  removeLeadingSlash,
  urlRE,
} from '../../utils'
import {
  cleanUrl,
  isWindows,
  slash,
  withTrailingSlash,
} from '../../../shared/utils'

/** 被浏览器按 JavaScript 执行、但系统 MIME 数据库可能误判的常见扩展名。 */
const knownJavascriptExtensionRE = /\.(?:[tj]sx?|[cm][tj]s)$/
/** sirv 的 shouldServe 向外层抛出的文件访问拒绝错误码。 */
const ERR_DENIED_FILE = 'ERR_DENIED_FILE'

/**
 * 生成三类静态服务共享的 sirv 配置：开发态 ETag、无扩展名猜测、自定义响应头和最终文件
 * 访问控制。安全判断放在 sirv 已解析出的真实路径上，可覆盖目录 index、符号链接等映射。
 */
const sirvOptions = ({
  config,
  getHeaders,
  disableFsServeCheck,
}: {
  /** 提供 root、响应头与文件系统访问规则的最终配置。 */
  config: ResolvedConfig
  /** 按请求读取当前用户响应头，允许配置对象在启动后被兼容层更新。 */
  getHeaders: () => OutgoingHttpHeaders | undefined
  /** publicDir 等已由更外层限定范围的服务可关闭通用 fs allow/deny 检查。 */
  disableFsServeCheck?: boolean
}): Options => {
  return {
    dev: true,
    etag: true,
    extensions: [],
    /** 修正常见模块 MIME，并附加用户配置的响应头。 */
    setHeaders(res, pathname) {
      // 匹配 js/jsx/ts/tsx/mts/mjs/cjs/cts 等。系统 MIME 把 .ts/.mts 保留给 video/mp2t，
      // 但 Vite 服务的它们几乎总是 JS/TS 模块，必须强制 text/javascript（#19453）。
      if (knownJavascriptExtensionRE.test(pathname)) {
        res.setHeader('Content-Type', 'text/javascript')
      }
      const headers = getHeaders()
      if (headers) {
        for (const name in headers) {
          res.setHeader(name, headers[name]!)
        }
      }
    },
    shouldServe: disableFsServeCheck
      ? undefined
      : (filePath) => {
          // 区分“存在但禁止”和“不存在/可让后续中间件处理”，不能把未知 API URL 误报 403。
          const servingAccessResult = checkLoadingAccess(config, filePath)
          if (servingAccessResult === 'denied') {
            const error: any = new Error('denied access')
            error.code = ERR_DENIED_FILE
            error.path = filePath
            throw error
          }
          if (servingAccessResult === 'fallback') {
            return false
          }
          servingAccessResult satisfies 'allowed'
          return true
        },
  }
}

/**
 * 原样提供 publicDir 文件。public 资源优先于 transform，但 import/internal/带 `?url` 等请求
 * 必须继续进入插件管线；已扫描文件 Set 避免每个请求都进行 existsSync（#15195）。
 */
export function servePublicMiddleware(
  server: ViteDevServer,
  publicFiles?: Set<string>,
): Connect.NextHandleFunction {
  const dir = server.config.publicDir
  const serve = sirv(
    dir,
    sirvOptions({
      config: server.config,
      getHeaders: () => server.config.server.headers,
      disableFsServeCheck: true,
    }),
  )

  /** 把请求 URL 转为与 publicFiles 索引一致的规范化路径。 */
  const toFilePath = (url: string) => {
    let filePath = cleanUrl(url)
    if (filePath.includes('%')) {
      try {
        filePath = decodeURI(filePath)
      } catch {
        // 畸形转义保留原字符串，让后续中间件决定 404，而不是抛出 500。
      }
    }
    return normalizePath(filePath)
  }

  // 保留命名函数；`DEBUG=connect:dispatcher` 会把名称显示在调度日志中。
  return function viteServePublicMiddleware(req, res, next) {
    // 内存 Set 随 watcher/重启更新。import、内部路径和资源查询必须跳过 public 原样响应，
    // 例如 `/public-file.js?url` 仍要由 asset 插件生成 URL 导出（#17915）。
    if (
      (publicFiles && !publicFiles.has(toFilePath(req.url!))) ||
      isImportRequest(req.url!) ||
      isInternalRequest(req.url!) ||
      // 让 `/public-file.js?url` 进入转换管线。
      urlRE.test(req.url!)
    ) {
      return next()
    }
    serve(req, res, next)
  }
}

/**
 * 从项目 root 提供普通静态文件，并在交给 sirv 前应用 resolve.alias。
 * HTML、内部 URL 与 scheme-relative URL 主动下放给专用中间件。
 */
export function serveStaticMiddleware(
  server: ViteDevServer,
): Connect.NextHandleFunction {
  const dir = server.config.root
  const serve = sirv(
    dir,
    sirvOptions({
      config: server.config,
      getHeaders: () => server.config.server.headers,
    }),
  )

  // 保留命名函数；`DEBUG=connect:dispatcher` 会把名称显示在调度日志中。
  return function viteServeStaticMiddleware(req, res, next) {
    // HTML/目录请求需要 fallback 与 HTML transform；内部 URL 有各自协议处理器。
    const cleanedUrl = cleanUrl(req.url!)
    if (
      cleanedUrl.endsWith('/') ||
      path.extname(cleanedUrl) === '.html' ||
      isInternalRequest(req.url!) ||
      // `//host/path` 会被 URL 构造器解释为 scheme-relative 地址，不是项目文件路径（#19059）。
      req.url?.startsWith('//')
    ) {
      return next()
    }

    const url = new URL(req.url!, 'http://example.com')
    const pathname = decodeURIIfPossible(url.pathname)
    if (pathname === undefined) {
      return next()
    }

    // 静态请求也应用 alias，使绝对导入和直接资源访问遵循同一映射。
    let redirectedPathname: string | undefined
    for (const { find, replacement } of server.config.resolve.alias) {
      const matches =
        typeof find === 'string'
          ? pathname.startsWith(find)
          : find.test(pathname)
      if (matches) {
        redirectedPathname = pathname.replace(find, replacement)
        break
      }
    }
    if (redirectedPathname) {
      // dir 已规范化为 POSIX 分隔符；替换结果若是 root 内绝对路径，转回请求相对路径。
      if (redirectedPathname.startsWith(withTrailingSlash(dir))) {
        redirectedPathname = redirectedPathname.slice(dir.length)
      }
    }

    const resolvedPathname = redirectedPathname || pathname
    let fileUrl = path.resolve(dir, removeLeadingSlash(resolvedPathname))
    if (resolvedPathname.endsWith('/') && fileUrl[fileUrl.length - 1] !== '/') {
      fileUrl = withTrailingSlash(fileUrl)
    }
    if (redirectedPathname) {
      url.pathname = encodeURI(redirectedPathname)
      req.url = url.href.slice(url.origin.length)
    }

    try {
      serve(req, res, next)
    } catch (e) {
      if (e && 'code' in e && e.code === ERR_DENIED_FILE) {
        respondWithAccessDenied(e.path, server, res)
        return
      }
      throw e
    }
  }
}

/**
 * 处理 `/@fs/absolute/path` 协议，从文件系统根提供位于项目 root 外但获准访问的文件。
 * 常见于 monorepo 链接包引用其同目录资源；最终仍经过 server.fs allow/deny 检查。
 */
export function serveRawFsMiddleware(
  server: ViteDevServer,
): Connect.NextHandleFunction {
  const serveFromRoot = sirv(
    '/',
    sirvOptions({
      config: server.config,
      getHeaders: () => server.config.server.headers,
    }),
  )

  // 保留命名函数；`DEBUG=connect:dispatcher` 会把名称显示在调度日志中。
  return function viteServeRawFsMiddleware(req, res, next) {
    // root 外文件统一改写为 `/@fs/`，以文件系统根为 sirv root 才能定位真实绝对路径。
    if (req.url!.startsWith(FS_PREFIX)) {
      const url = new URL(req.url!, 'http://example.com')
      const pathname = decodeURIIfPossible(url.pathname)
      if (pathname === undefined) {
        return next()
      }

      let newPathname = pathname.slice(FS_PREFIX.length)
      if (isWindows) newPathname = newPathname.replace(/^[A-Z]:/i, '')
      url.pathname = encodeURI(newPathname)
      req.url = url.href.slice(url.origin.length)

      try {
        serveFromRoot(req, res, next)
      } catch (e) {
        if (e && 'code' in e && e.code === ERR_DENIED_FILE) {
          respondWithAccessDenied(e.path, server, res)
          return
        }
        throw e
      }
    } else {
      next()
    }
  }
}

/**
 * 根据 `server.fs` 配置判断 URL 是否允许由 Vite 加载。
 * @deprecated 改用接收规范化绝对路径的 `isFileLoadingAllowed`。
 */
export function isFileServingAllowed(
  config: ResolvedConfig,
  url: string,
): boolean
/** 兼容旧参数顺序：从 ViteDevServer 提取最终配置并检查 URL。 */
export function isFileServingAllowed(
  url: string,
  server: ViteDevServer,
): boolean
/** 归一化两种历史调用签名并委托给绝对路径安全检查。 */
export function isFileServingAllowed(
  configOrUrl: ResolvedConfig | string,
  urlOrServer: string | ViteDevServer,
): boolean {
  const config = (
    typeof urlOrServer === 'string' ? configOrUrl : urlOrServer.config
  ) as ResolvedConfig
  const url = (
    typeof urlOrServer === 'string' ? urlOrServer : configOrUrl
  ) as string

  if (!config.server.fs.strict) return true
  const filePath = fsPathFromUrl(url)
  return isFileLoadingAllowed(config, filePath)
}

/**
 * 判断 filePath 是 targetPath 本身或其真实子路径。
 *
 * 警告：函数不校验参数，只能传入规范化绝对路径；不能用字符串 startsWith，否则
 * `/parent-other` 会被误判为 `/parent` 的子项（#14241）。
 *
 * @param targetPath - 规范化绝对目标路径。
 * @param filePath - 规范化绝对文件路径。
 */
export function isFileInTargetPath(
  targetPath: string,
  filePath: string,
): boolean {
  return (
    isSameFilePath(targetPath, filePath) ||
    isParentDirectory(targetPath, filePath)
  )
}

/** Windows 绝对路径开头唯一允许出现的盘符冒号。 */
const windowsDriveRE = /^[A-Z]:/i

/**
 * 按 `server.fs.strict/deny/allow` 和 safeModulePaths 判断绝对文件路径是否允许加载。
 *
 * 优先级是：关闭 strict → Windows 特殊路径防护 → deny → safeModulePaths → allow。调用方必须
 * 传规范化绝对路径；本函数不负责路径解析或存在性判断。
 */
export function isFileLoadingAllowed(
  config: ResolvedConfig,
  filePath: string,
): boolean {
  const { fs } = config.server

  if (!fs.strict) return true

  if (isWindows && filePath.includes('~')) {
    // Windows 8.3 短文件名可用 `ENV~1` 绕过 `.env` deny。虽然 `~` 是合法字符，安全起见
    // strict 模式一律拒绝这类路径（#22572）。
    return false
  }

  const hasDriveLetter = isWindows && windowsDriveRE.test(filePath)
  const hasColon = (hasDriveLetter ? filePath.slice(2) : filePath).includes(':')
  if (hasColon) {
    // 盘符之外的 `:` 可能访问 NTFS Alternate Data Stream，例如 `.env::$DATA`（#22572）。
    return false
  }

  // Node 的 `fs.readFile('/foo.png/')` 可能实际读取 `/foo.png`，deny 必须先去尾斜杠，防止
  // 通过它绕过 glob（#20968）。
  const filePathWithoutTrailingSlash = filePath.endsWith('/')
    ? filePath.slice(0, -1)
    : filePath
  if (config.fsDenyGlob(filePathWithoutTrailingSlash)) return false

  if (config.safeModulePaths.has(filePath)) return true

  if (fs.allow.some((uri) => isFileInTargetPath(uri, filePath))) return true

  return false
}

/**
 * 把路径访问判定细分为 allowed、denied、fallback。
 * 只有真实可读但不在允许范围内的文件返回 denied；不存在路径可能是 API/虚拟路由，应继续
 * 交给后续中间件，最终无人处理才 404（#20410）。
 */
export function checkLoadingAccess(
  config: ResolvedConfig,
  path: string,
): 'allowed' | 'denied' | 'fallback' {
  if (isFileLoadingAllowed(config, slash(path))) {
    return 'allowed'
  }
  if (isFileReadable(path)) {
    return 'denied'
  }
  // 不存在的文件可能是 API；中间件均未处理时自然进入 404。
  return 'fallback'
}

/** 记录一次 allow list 提示，并向请求返回转义后的 403 Restricted HTML。 */
export function respondWithAccessDenied(
  id: string,
  server: ViteDevServer,
  res: ServerResponse,
): void {
  const urlMessage = `The request id "${id}" is outside of Vite serving allow list.`
  const hintMessage = `
${server.config.server.fs.allow.map((i) => `- ${i}`).join('\n')}

Refer to docs https://vite.dev/config/server-options.html#server-fs-allow for configurations and more details.`

  server.config.logger.error(urlMessage)
  server.config.logger.warnOnce(hintMessage + '\n')
  res.statusCode = 403
  res.write(renderRestrictedErrorHTML(urlMessage + '\n' + hintMessage))
  res.end()
}

/** 把纯文本拒绝原因转义后嵌入最小 HTML；模板标签写法保留 IDE 高亮。 */
function renderRestrictedErrorHTML(msg: string): string {
  const html = String.raw
  return html`
    <body>
      <h1>403 Restricted</h1>
      <p>${escapeHtml(msg).replace(/\n/g, '<br/>')}</p>
      <style>
        body {
          padding: 1em 2em;
        }
      </style>
    </body>
  `
}
