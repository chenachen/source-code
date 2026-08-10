import { performance } from 'node:perf_hooks'
import type { Connect } from '#dep-types/connect'
import { createDebugger, prettifyUrl, timeFrom } from '../../utils'

/** `DEBUG=vite:time` 启用的单请求耗时日志器。 */
const logTime = createDebugger('vite:time')

/** 包装 `res.end()`，在响应真正结束时记录总耗时和相对 root 的可读 URL。 */
export function timeMiddleware(root: string): Connect.NextHandleFunction {
  // 保留命名函数；`DEBUG=connect:dispatcher` 会把名称显示在调度日志中。
  return function viteTimeMiddleware(req, res, next) {
    const start = performance.now()
    const end = res.end
    res.end = (...args: readonly [any, any?, any?]) => {
      logTime?.(`${timeFrom(start)} ${prettifyUrl(req.url!, root)}`)
      return end.call(res, ...args)
    }
    next()
  }
}
