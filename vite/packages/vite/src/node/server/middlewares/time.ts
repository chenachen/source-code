import { performance } from 'node:perf_hooks'
import type { Connect } from '#dep-types/connect'
import { createDebugger, prettifyUrl, timeFrom } from '../../utils'

/** `DEBUG=vite:time` 启用的单请求耗时日志器。 */
const logTime = createDebugger('vite:time')

/** 包装 res.end，在调用结束方法时记录 elapsed 和相对root的URL；不等待finish发送事件。 */
export function timeMiddleware(root: string): Connect.NextHandleFunction {
  /** 保存请求开始时间并替换res.end，安装完毕后继续后续中间件。 */
  return function viteTimeMiddleware(req, res, next) {
    const start = performance.now()
    const end = res.end
    /** 在本次end调用前记录耗时，再保留res作为this并转发全部参数给原方法。 */
    res.end = (...args: readonly [any, any?, any?]) => {
      logTime?.(`${timeFrom(start)} ${prettifyUrl(req.url!, root)}`)
      return end.call(res, ...args)
    }
    next()
  }
}
