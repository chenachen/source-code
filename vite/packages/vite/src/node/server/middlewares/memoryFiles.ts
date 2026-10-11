import * as mrmime from 'mrmime'
import type { Connect } from '#dep-types/connect'
import { cleanUrl } from '../../../shared/utils'
import type { ViteDevServer } from '..'

/**
 * 在 full bundle 开发模式下，从内存构建结果响应非 HTML 静态请求。
 *
 * HTML 继续交给 indexHtml 中间件处理内存输出与 fallback。其余请求先安全解码，再按无前导
 * `/` 的构建文件名查询 memoryFiles；命中时处理 ETag、MIME、自定义响应头，
 * 并在 finish 后登记发送完成；此事件表示交给操作系统，不是浏览器接收/执行确认。
 */
export function memoryFilesMiddleware(
  server: ViteDevServer,
): Connect.NextHandleFunction {
  const bundledDev = server.environments.client.bundledDev
  const memoryFiles = bundledDev?.memoryFiles
  if (!bundledDev || !memoryFiles) {
    throw new Error('memoryFilesMiddleware can only be used for fullBundleMode')
  }
  const headers = server.config.server.headers

  /** 查无前导斜杠的内存文件；HTML和未命中请求交给next，命中时发送内容或304。 */
  return function viteMemoryFilesMiddleware(req, res, next) {
    const cleanedUrl = cleanUrl(req.url!)
    if (cleanedUrl.endsWith('.html')) {
      return next()
    }

    let pathname
    try {
      pathname = decodeURIComponent(cleanedUrl)
    } catch {
      // 非法百分号编码不是内存文件请求，让后续中间件决定错误响应。
      return next()
    }
    // 内存构建结果使用不带 URL 首个 `/` 的输出文件名作为键。
    const filePath = pathname.slice(1)

    const file = memoryFiles.get(filePath)
    if (file) {
      if (file.etag) {
        if (req.headers['if-none-match'] === file.etag) {
          res.statusCode = 304
          res.end()
          return
        }
        res.setHeader('Etag', file.etag)
      }

      const mime = mrmime.lookup(filePath)
      if (mime) {
        res.setHeader('Content-Type', mime)
      }

      for (const name in headers) {
        res.setHeader(name, headers[name]!)
      }

      // finish 表示响应已交底层发送；提前中断且没有 finish 时不登记 payload 交付。
      res.on('finish', () => bundledDev.markPayloadDelivered(filePath))
      return res.end(file.source)
    }
    next()
  }
}
