import type { Connect } from '#dep-types/connect'

/** 在 spa/mpa appType 的普通中间件都未处理请求时返回空 404；middleware mode 同样挂载。 */
export function notFoundMiddleware(): Connect.NextHandleFunction {
  /** 以空正文结束未被前序中间件处理的请求，状态码为404。 */
  return function vite404Middleware(_, res) {
    res.statusCode = 404
    res.end()
  }
}
