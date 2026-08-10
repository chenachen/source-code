import type { Connect } from '#dep-types/connect'

/**
 * 拒绝 request-target 中包含 `#` 的非标准请求。
 * Node 会接收这类请求，但 Vite 中间件把 `#` 视为不会出现在服务器 URL 中的 fragment；若继续
 * 处理，尤其可能扰乱 `server.fs.deny` 路径校验（#19830）。
 */
export function rejectInvalidRequestMiddleware(): Connect.NextHandleFunction {
  // 保留命名函数；`DEBUG=connect:dispatcher` 会把名称显示在调度日志中。
  return function viteRejectInvalidRequestMiddleware(req, res, next) {
    // HTTP/1.1 与 HTTP/2 都不允许 request-target 包含 `#`：
    // (HTTP 1.1: https://datatracker.ietf.org/doc/html/rfc9112#section-3.2)
    // (HTTP 2: https://datatracker.ietf.org/doc/html/rfc9113#section-8.3.1-2.4.1)
    // 但 Node.js 仍允许接收；Vite 的 URL 解析和 server.fs.deny 均建立在它不存在的前提上。
    if (req.url?.includes('#')) {
      // RFC 9112 对非法 request-target 建议返回 400 Bad Request。
      // (https://datatracker.ietf.org/doc/html/rfc9112#section-3.2-4)
      res.writeHead(400)
      res.end()
      return
    }
    return next()
  }
}
