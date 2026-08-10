import path from 'node:path'
import fs from 'node:fs'
import type { Connect } from '#dep-types/connect'
import { createDebugger, joinUrlSegments } from '../../utils'
import { cleanUrl } from '../../../shared/utils'
import type { DevEnvironment } from '../environment'

/** `DEBUG=vite:html-fallback` 启用的 URL 重写诊断日志。 */
const debug = createDebugger('vite:html-fallback')

/**
 * 把页面导航 URL 规范化到实际 HTML 文件：依次尝试原 `.html`、目录 `index.html`、补 `.html`，
 * SPA 模式最终回退到根 `index.html`。它只改写 `req.url`，实际读取与 HTML 转换由后续中间件
 * 完成，因此文件系统安全检查仍不会被绕过。
 */
export function htmlFallbackMiddleware(
  root: string,
  spaFallback: boolean,
  clientEnvironment?: DevEnvironment,
): Connect.NextHandleFunction {
  const memoryFiles = clientEnvironment?.bundledDev?.memoryFiles

  /** 同时检查完整打包开发模式的内存文件和磁盘文件。 */
  function checkFileExists(relativePath: string) {
    return (
      memoryFiles?.has(
        // memoryFiles key 不带 URL 的首个 `/`。
        relativePath.slice(1),
      ) ?? fs.existsSync(path.join(root, relativePath))
    )
  }

  // 保留命名函数；`DEBUG=connect:dispatcher` 会把名称显示在调度日志中。
  return function viteHtmlFallbackMiddleware(req, _res, next) {
    if (
      // 只处理不会改变服务器状态的页面 GET/HEAD。
      (req.method !== 'GET' && req.method !== 'HEAD') ||
      // 浏览器默认 favicon 探测不是页面导航。
      req.url === '/favicon.ico' ||
      // 只接受 HTML 或通配 Accept；缺失/空值等价于 `*/*`。
      !(
        req.headers.accept === undefined ||
        req.headers.accept === '' ||
        req.headers.accept.includes('text/html') ||
        req.headers.accept.includes('*/*')
      )
    ) {
      return next()
    }

    const url = cleanUrl(req.url!)
    let pathname
    try {
      pathname = decodeURIComponent(url)
    } catch {
      // 畸形 URI 留给后续 404/宿主处理，不能让 decode 异常终止请求管线。
      return next()
    }

    // serveStaticMiddleware 会主动跳过 .html，fallback 必须自己先确认文件存在。
    if (pathname.endsWith('.html')) {
      if (checkFileExists(pathname)) {
        debug?.(`Rewriting ${req.method} ${req.url} to ${url}`)
        req.url = url
        return next()
      }
    }
    // 目录式 URL 尝试其 index.html。
    else if (pathname.endsWith('/')) {
      if (checkFileExists(joinUrlSegments(pathname, 'index.html'))) {
        const newUrl = url + 'index.html'
        debug?.(`Rewriting ${req.method} ${req.url} to ${newUrl}`)
        req.url = newUrl
        return next()
      }
    }
    // 无尾斜杠的扩展名省略 URL 尝试补 `.html`。
    else {
      if (checkFileExists(pathname + '.html')) {
        const newUrl = url + '.html'
        debug?.(`Rewriting ${req.method} ${req.url} to ${newUrl}`)
        req.url = newUrl
        return next()
      }
    }

    if (spaFallback) {
      debug?.(`Rewriting ${req.method} ${req.url} to /index.html`)
      req.url = '/index.html'
    }

    next()
  }
}
