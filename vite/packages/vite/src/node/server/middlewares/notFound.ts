import type { Connect } from '#dep-types/connect'

/** 独立服务器中所有业务中间件均未处理请求时，给出空 404 终止普通请求链。 */
export function notFoundMiddleware(): Connect.NextHandleFunction {
  // 保留命名函数；`DEBUG=connect:dispatcher` 会把名称显示在调度日志中。
  return function vite404Middleware(_, res) {
    res.statusCode = 404
    res.end()
  }
}
