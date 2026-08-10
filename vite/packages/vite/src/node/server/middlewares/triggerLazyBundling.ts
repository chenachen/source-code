import type { Connect } from '#dep-types/connect'
import type { ViteDevServer } from '..'

/**
 * 处理 bundled-dev 客户端发出的 `/@vite/lazy` 请求，按需触发模块打包。
 *
 * `id` 标识待构建模块，`clientId` 让服务端把结果关联到请求方。无法识别或无法
 * 产生结果时继续 Connect 链；命中时返回可执行 JS，并在响应结束后登记 payload。
 */
export function triggerLazyBundlingMiddleware(
  server: ViteDevServer,
): Connect.NextHandleFunction {
  const bundledDev = server.environments.client.bundledDev
  if (!bundledDev) {
    throw new Error(
      'triggerLazyBundlingMiddleware can only be used for fullBundleMode',
    )
  }

  return async function viteTriggerLazyBundlingMiddleware(req, res, next) {
    if (!req.url?.startsWith('/@vite/lazy?')) {
      return next()
    }

    let params: URLSearchParams
    try {
      params = new URL(`http://localhost${req.url}`).searchParams
    } catch {
      // URL 无法解析时不抢占请求，交给后续中间件生成统一响应。
      return next()
    }

    const moduleId = params.get('id')
    const clientId = params.get('clientId')
    const result = await bundledDev.triggerLazyBundling(moduleId, clientId)
    if (result == null) {
      return next()
    }

    res!.setHeader('Content-Type', 'application/javascript')
    // 客户端实际收到触发脚本后，bundledDev 才能安全清理相应交付状态。
    res!.on('finish', () => bundledDev.markPayloadDelivered(result.filename))
    return res!.end(result.code)
  }
}
