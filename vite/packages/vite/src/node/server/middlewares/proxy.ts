import type * as http from 'node:http'
import * as httpProxy from 'http-proxy-3'
import colors from 'picocolors'
import type { Connect } from '#dep-types/connect'
import { createDebugger } from '../../utils'
import type { CommonServerOptions, ResolvedConfig } from '../..'
import type { HttpServer } from '..'

/** `DEBUG=vite:proxy` 启用的代理路由日志器。 */
const debug = createDebugger('vite:proxy')

/** 单个 HTTP/WS 代理路由选项。 */
export interface ProxyOptions extends httpProxy.ServerOptions {
  /** 转发前重写请求路径。 */
  rewrite?: (path: string) => string
  /** 在使用前配置底层 ProxyServer，例如注册事件监听器。 */
  configure?: (proxy: httpProxy.ProxyServer, options: ProxyOptions) => void
  /**
   * webpack-dev-server 风格的路由旁路函数。
   * HTTP 返回 string 时改写 URL 后交给 Vite；WS 返回 string 时只改 URL 并结束本 listener。
   * false 返回 404；其他非字符串结果继续代理。
   */
  bypass?: (
    req: http.IncomingMessage,
    /** WebSocket upgrade 请求没有 ServerResponse，因此为 undefined。 */
    res: http.ServerResponse | undefined,
    options: ProxyOptions,
  ) =>
    | void
    | null
    | undefined
    | false
    | string
    | Promise<void | null | undefined | boolean | string>
  /**
   * 把 WebSocket 请求的 Origin header 改写为代理目标。
   *
   * **谨慎启用：改写 Origin 可能使代理暴露于 [CSRF 攻击](https://owasp.org/www-community/attacks/csrf)。**
   */
  rewriteWsOrigin?: boolean | undefined
}

/** 按 rewriteWsOrigin 选项把 WS 上游请求的 Origin 改为 target origin。 */
const rewriteOriginHeader = (
  proxyReq: http.ClientRequest,
  options: ProxyOptions,
  config: ResolvedConfig,
) => {
  // 浏览器的同源 WS 也可能携带 Origin，而上游 WS 服务通常会校验它；显式启用时改成
  // target origin（#16558）。
  if (options.rewriteWsOrigin) {
    const { target } = options

    if (proxyReq.headersSent) {
      config.logger.warn(
        colors.yellow(
          `Unable to rewrite Origin header as headers are already sent.`,
        ),
      )
      return
    }

    if (proxyReq.getHeader('origin') && target) {
      const changedOrigin =
        typeof target === 'object'
          ? `${target.protocol ?? 'http:'}//${target.host}`
          : target

      proxyReq.setHeader('origin', changedOrigin)
    }
  }
}

/**
 * 创建同时处理普通 HTTP 和 `upgrade` WebSocket 的代理层。
 * 路由 key 以 `^` 开头时按正则匹配，否则按 URL 前缀匹配；HTTP 首个命中项拥有请求；WS 还要求该规则启用 ws 或使用 ws/wss target。
 */
export function proxyMiddleware(
  httpServer: HttpServer | null,
  options: NonNullable<CommonServerOptions['proxy']>,
  config: ResolvedConfig,
): Connect.NextHandleFunction {
  // 每个 context 一个 ProxyServer；仅配置 proxy 时才进入本工厂并承担实例成本。
  const proxies: Record<string, [httpProxy.ProxyServer, ProxyOptions]> = {}

  Object.keys(options).forEach((context) => {
    let opts = options[context]
    if (!opts) {
      return
    }
    if (typeof opts === 'string') {
      // 字符串简写默认改写 HTTP Host，符合常见后端代理预期。
      opts = { target: opts, changeOrigin: true }
    }
    const proxy = httpProxy.createProxyServer(opts)

    if (opts.configure) {
      opts.configure(proxy, opts)
    }

    proxy.on('error', (err, _req, res) => {
      // HTTP 分支收到 ServerResponse，WS 分支收到 net.Socket；HTTP 上游失败必须明确返回 502
      // Bad Gateway，而不是落到 Vite 500（#21652）。
      if ('req' in res) {
        config.logger.error(
          `${colors.red(`http proxy error: ${res.req.url}`)}\n${err.stack}`,
          {
            timestamp: true,
            error: err,
          },
        )
        if (!res.headersSent && !res.writableEnded) {
          res
            .writeHead(502, {
              'Content-Type': 'text/plain',
            })
            .end()
        }
      } else {
        config.logger.error(`${colors.red(`ws proxy error:`)}\n${err.stack}`, {
          timestamp: true,
          error: err,
        })
        res.end()
      }
    })

    proxy.on('proxyReqWs', (proxyReq, _req, socket, options) => {
      rewriteOriginHeader(proxyReq, options, config)

      socket.on('error', (err) => {
        config.logger.error(
          `${colors.red(`ws proxy socket error:`)}\n${err.stack}`,
          {
            timestamp: true,
            error: err,
          },
        )
      })
    })

    // http-proxy 会修改选项对象；保存当前顶层选项的浅拷贝，供 bypass/rewrite 路径使用。
    proxies[context] = [proxy, { ...opts }]
  })

  if (httpServer) {
    // WebSocket 不经过 Connect request 中间件，必须直接监听底层 HTTP upgrade。
    httpServer.on('upgrade', async (req, socket, head) => {
      const url = req.url!
      for (const context in proxies) {
        if (doesProxyContextMatchUrl(context, url)) {
          const [proxy, opts] = proxies[context]
          if (
            opts.ws ||
            opts.target?.toString().startsWith('ws:') ||
            opts.target?.toString().startsWith('wss:')
          ) {
            if (opts.bypass) {
              try {
                const bypassResult = await opts.bypass(req, undefined, opts)
                if (typeof bypassResult === 'string') {
                  // WS 没有后续 Connect 管线；字符串只改写 URL，并停止本代理 listener。
                  // 其他 upgrade listener 独立执行，不由这里的 return 顺序转交。
                  debug?.(`bypass: ${req.url} -> ${bypassResult}`)
                  req.url = bypassResult
                  return
                }
                if (bypassResult === false) {
                  // false 明确拒绝升级，以最小 HTTP 404 响应结束 socket。
                  debug?.(`bypass: ${req.url} -> 404`)
                  socket.end('HTTP/1.1 404 Not Found\r\n\r\n', '')
                  return
                }
              } catch (err) {
                config.logger.error(
                  `${colors.red(`ws proxy bypass error:`)}\n${err.stack}`,
                  {
                    timestamp: true,
                    error: err,
                  },
                )
                return
              }
            }

            if (opts.rewrite) {
              // rewrite 使用进入代理前的原 URL，避免同一 listener 内累积改写。
              req.url = opts.rewrite(url)
            }
            debug?.(`${req.url} -> ws ${opts.target}`)
            proxy.ws(req, socket, head)
            return
          }
        }
      }
    })
  }

  /** 使用首条命中规则处理HTTP请求；bypass可结束/改写/报错，正常路径重写后交给代理。 */
  return async function viteProxyMiddleware(req, res, next) {
    const url = req.url!
    for (const context in proxies) {
      if (doesProxyContextMatchUrl(context, url)) {
        const [proxy, opts] = proxies[context]
        const options: httpProxy.ServerOptions = {}

        if (opts.bypass) {
          try {
            const bypassResult = await opts.bypass(req, res, opts)
            if (typeof bypassResult === 'string') {
              debug?.(`bypass: ${req.url} -> ${bypassResult}`)
              req.url = bypassResult
              // bypass 回调可以自行写完响应；此时不能继续 next 导致二次响应（#19318）。
              if (res.writableEnded) {
                return
              }
              return next()
            }
            if (bypassResult === false) {
              // false 的契约是由 Vite 直接返回 404，不再代理或进入后续中间件（#14579）。
              debug?.(`bypass: ${req.url} -> 404`)
              res.statusCode = 404
              return res.end()
            }
          } catch (e) {
            debug?.(`bypass: ${req.url} -> ${e}`)
            return next(e)
          }
        }

        debug?.(`${req.url} -> ${opts.target || opts.forward}`)
        if (opts.rewrite) {
          req.url = opts.rewrite(req.url!)
        }
        proxy.web(req, res, options)
        return
      }
    }
    next()
  }
}

/** 先尝试以^开头规则的正则匹配；未命中时仍允许context的字面URL前缀匹配。 */
function doesProxyContextMatchUrl(context: string, url: string): boolean {
  return (
    (context[0] === '^' && new RegExp(context).test(url)) ||
    url.startsWith(context)
  )
}
