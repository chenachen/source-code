import type { Connect } from '#dep-types/connect'
import { joinUrlSegments, stripBase } from '../../utils'
import { cleanUrl, withTrailingSlash } from '../../../shared/utils'

// 仅在 base !== '/' 时注册；根 base 无需重写。

/**
 * 去掉已匹配请求的公共 base，让后续中间件始终处理无 base 的内部 URL。
 * 独立服务器还会把根路径重定向到 base，并为 base 外请求给出带建议地址的 404；middleware
 * mode 把这些路由决策留给宿主应用（#4057）。
 */
export function baseMiddleware(
  rawBase: string,
  middlewareMode: boolean,
): Connect.NextHandleFunction {
  /** 匹配 base 时裁剪 req.url；独立模式处理根重定向和 base 外 404，其余交给 next。 */
  return function viteBaseMiddleware(req, res, next) {
    const url = req.url!
    const pathname = cleanUrl(url)
    const base = rawBase

    if (pathname.startsWith(base)) {
      // 进入内部管线前移除 base，后续中间件无需同时兼容两种 URL 形态。
      req.url = stripBase(url, base)
      return next()
    }

    // middleware mode 的重定向/404 由宿主路由负责（#4057）。
    if (middlewareMode) {
      return next()
    }

    if (pathname === '/' || pathname === '/index.html') {
      // 根访问重定向到 base，同时保留查询串和 URL 中可能存在的剩余部分。
      res.writeHead(302, {
        Location: base + url.slice(pathname.length),
      })
      res.end()
      return
    }

    // base 外访问：HTML 返回可点击建议，资源请求返回纯文本，避免污染资源解析。
    const redirectPath =
      withTrailingSlash(url) !== base ? joinUrlSegments(base, url) : base
    if (req.headers.accept?.includes('text/html')) {
      res.writeHead(404, {
        'Content-Type': 'text/html',
      })
      res.end(
        `The server is configured with a public base URL of ${base} - ` +
          `did you mean to visit <a href="${redirectPath}">${redirectPath}</a> instead?`,
      )
      return
    } else {
      // 非 HTML 资源保持 text/plain。
      res.writeHead(404, {
        'Content-Type': 'text/plain',
      })
      res.end(
        `The server is configured with a public base URL of ${base} - ` +
          `did you mean to visit ${redirectPath} instead?`,
      )
      return
    }
  }
}
