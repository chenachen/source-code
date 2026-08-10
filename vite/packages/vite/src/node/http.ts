import fsp from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import type { OutgoingHttpHeaders as HttpServerHeaders } from 'node:http'
import type { ServerOptions as HttpsServerOptions } from 'node:https'
import colors from 'picocolors'
import type { Connect } from '#dep-types/connect'
import type { ProxyOptions } from './server/middlewares/proxy'
import type { Logger } from './logger'
import type { HttpServer } from './server'
import { wildcardHosts } from './constants'

/** Dev 与 Preview 共用的 HTTP Server 配置。 */
export interface CommonServerOptions {
  /**
   * 首选端口。非 strictPort 时占用会依次尝试后续端口，因此不保证是最终监听端口。
   */
  port?: number
  /** 端口占用时是否立即失败，而不是自动递增。 */
  strictPort?: boolean
  /**
   * 监听 IP/主机；`0.0.0.0` 或 true 暴露所有 IPv4 地址，包括 LAN/公网接口。
   */
  host?: string | boolean
  /**
   * 允许响应的 Host。localhost 及其子域、全部 IP 默认允许；HTTPS 跳过检查。
   *
   * 以 `.` 开头表示同时允许根域和全部子域，例如 `.example.com`。
   *
   * true 允许任意 Host，会暴露 DNS rebinding 风险，不推荐。
   */
  allowedHosts?: string[] | true
  /**
   * 启用 TLS + HTTP/2，并允许 HTTP/1 回退。
   */
  https?: HttpsServerOptions
  /** 启动后打开浏览器；字符串表示相对入口路径。 */
  open?: boolean | string
  /**
   * `{ 路径前缀: target/ProxyOptions }` 形式的 HTTP/WS 代理规则。
   *
   * @example
   * ```js
   * module.exports = {
   *   proxy: {
   *     // 字符串简写：/foo → http://localhost:4567/foo
   *     '/foo': 'http://localhost:4567',
   *     // 完整选项
   *     '/api': {
   *       target: 'http://jsonplaceholder.typicode.com',
   *       changeOrigin: true,
   *       rewrite: path => path.replace(/^\/api/, '')
   *     }
   *   }
   * }
   * ```
   * @see https://github.com/sagemathinc/http-proxy-3
   * @see https://github.com/sagemathinc/http-proxy-3#options
   */
  proxy?: Record<string, string | ProxyOptions>
  /**
   * CORS 配置。优先指定可信 origin；true 会向任意来源暴露开发源码。
   *
   * @default 仅允许 localhost、127.0.0.1、[::1] 及 localhost 子域。
   * @see https://github.com/expressjs/cors
   */
  cors?: CorsOptions | boolean
  /** 附加到 Server 响应的自定义 header。 */
  headers?: HttpServerHeaders
}

/**
 * expressjs/cors 兼容配置。
 * @see https://github.com/expressjs/cors#configuration-options
 */
export interface CorsOptions {
  /**
   * `Access-Control-Allow-Origin` 来源规则；避免 true，以免向不可信网站暴露源码。
   */
  origin?:
    | CorsOrigin
    | ((
        origin: string | undefined,
        cb: (err: Error, origins: CorsOrigin) => void,
      ) => void)
  /** `Access-Control-Allow-Methods`。 */
  methods?: string | string[]
  /** `Access-Control-Allow-Headers`。 */
  allowedHeaders?: string | string[]
  /** `Access-Control-Expose-Headers`。 */
  exposedHeaders?: string | string[]
  /** 是否允许携带凭据。 */
  credentials?: boolean
  /** 预检响应可缓存秒数。 */
  maxAge?: number
  /** 是否把 OPTIONS 预检继续交给后续中间件。 */
  preflightContinue?: boolean
  /** OPTIONS 成功响应状态码。 */
  optionsSuccessStatus?: number
}

/** CORS origin 可接受的静态形式。 */
export type CorsOrigin = boolean | string | RegExp | (string | RegExp)[]

/** 根据 HTTPS 配置创建 HTTP/1 或兼容 HTTP/1 的 HTTP/2 Secure Server。 */
export async function resolveHttpServer(
  app: Connect.Server,
  httpsOptions?: HttpsServerOptions,
): Promise<HttpServer> {
  if (!httpsOptions) {
    const { createServer } = await import('node:http')
    return createServer(app)
  }

  const { createSecureServer } = await import('node:http2')
  return createSecureServer(
    {
      // 提高 session 内存，避免大量模块请求触发 502 ENHANCE_YOUR_CALM。
      maxSessionMemory: 1000,
      // 提高 stream reset 限额，避免大量请求触发 ERR_HTTP2_PROTOCOL_ERROR（#21024）。
      streamResetBurst: 100000,
      streamResetRate: 33,
      ...httpsOptions,
      allowHTTP1: true,
    },
    // @ts-expect-error Connect handler 与 Node HTTP2 request listener 运行时兼容。
    app,
  )
}

/** 并行解析 TLS ca/cert/key/pfx：字符串路径存在时读文件，否则保留原字符串值。 */
export async function resolveHttpsConfig(
  https: HttpsServerOptions | undefined,
): Promise<HttpsServerOptions | undefined> {
  if (!https) return undefined

  const [ca, cert, key, pfx] = await Promise.all([
    readFileIfExists(https.ca),
    readFileIfExists(https.cert),
    readFileIfExists(https.key),
    readFileIfExists(https.pfx),
  ])
  return { ...https, ca, cert, key, pfx }
}

/** 尝试把字符串当文件路径读取；失败时它可能本就是 PEM 文本，原值返回。 */
async function readFileIfExists(value?: string | Buffer | any[]) {
  if (typeof value === 'string') {
    return fsp.readFile(path.resolve(value)).catch(() => value)
  }
  return value
}

/**
 * 让 OS 在首个 wildcard 接口选择临时端口，再验证同一具体端口对其余 wildcard 与指定
 * host 都可用。最多换三个候选，避免 port=0 在每个网卡上选择不同端口（#23158）。
 */
async function getAvailableEphemeralPort(
  specifiedHost: string | undefined,
): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    // 传 0 请求新候选；OS 通常每轮返回不同端口，少数平台不保证，但三轮已覆盖常见竞态。
    let port = 0
    let available = true
    for (const host of [...wildcardHosts, specifiedHost]) {
      // IPv6 被系统禁用等非占用错误不应让整个探测失败。
      const availablePort = await tryListen(port, host).catch(() => port)
      if (availablePort == null) {
        available = false
        break
      }
      port = availablePort
    }
    if (available) return port
  }
  return null
}

/** 检查端口在 IPv4/IPv6 wildcard 地址上是否已被占用。 */
async function isPortAvailable(port: number): Promise<boolean> {
  for (const host of wildcardHosts) {
    // IPv6 不可用等非 EADDRINUSE 错误按“该接口不阻塞”处理（#21642）。
    const available = await tryListen(port, host).catch(() => true)
    if (!available) return false
  }
  return true
}

/** 临时创建 TCP Server 探测 host:port；占用返回 null，其他错误视为该端口可继续判断。 */
function tryListen(
  port: number,
  host: string | undefined,
): Promise<number | null> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', (e: NodeJS.ErrnoException) => {
      server.close(() => resolve(e.code === 'EADDRINUSE' ? null : port))
    })
    server.once('listening', () => {
      const address = server.address()
      server.close(() =>
        resolve(typeof address === 'object' && address ? address.port : port),
      )
    })
    server.listen(port, host)
  })
}

/**
 * 在真实 HTTP Server 上尝试监听，并用一次性事件处理器返回结果。
 * 每次完成都移除双方 listener，避免端口回退循环累积 EventEmitter listener（#21451）。
 */
async function tryBindServer(
  httpServer: HttpServer,
  port: number,
  host: string | undefined,
): Promise<
  | {
      /** 表示指定地址已成功进入 listening 状态。 */
      success: true
    }
  | {
      /** 表示绑定失败且 error 保存原始 Node 网络错误。 */
      success: false
      /** 供调用方区分端口占用与其他网络错误。 */
      error: NodeJS.ErrnoException
    }
> {
  return new Promise((resolve) => {
    /** 清理成对监听器，并把绑定错误交还端口选择循环。 */
    const onError = (e: NodeJS.ErrnoException) => {
      httpServer.off('error', onError)
      httpServer.off('listening', onListening)
      resolve({ success: false, error: e })
    }
    /** 清理成对监听器，并报告当前端口已成功绑定。 */
    const onListening = () => {
      httpServer.off('error', onError)
      httpServer.off('listening', onListening)
      resolve({ success: true })
    }

    httpServer.on('error', onError)
    httpServer.on('listening', onListening)

    httpServer.listen(port, host)
  })
}

/** TCP/UDP 端口上限。 */
const MAX_PORT = 65535

/**
 * 为 HTTP Server 选择并绑定端口。
 *
 * port=0 先找所有目标接口共用的 OS 临时端口；普通端口先检查 wildcard 冲突。strictPort
 * 仍直接尝试指定 host，因为 wildcard 被占用不代表某个独立 IP 一定无法绑定（#22150）；
 * 非 strictPort 遇占用依次递增到 65535。只有 EADDRINUSE 触发换端口，其他错误原样抛出。
 */
export async function httpServerStart(
  httpServer: HttpServer,
  serverOptions: {
    /** 首选端口；0 表示请求操作系统分配临时端口。 */
    port: number
    /** 端口占用时是否禁止自动递增重试。 */
    strictPort: boolean | undefined
    /** 传给 Node server.listen 的规范化主机名。 */
    host: string | undefined
    /** 输出自动换端口提示的活动 logger。 */
    logger: Logger
  },
): Promise<number> {
  const { port: startPort, strictPort, host, logger } = serverOptions

  if (startPort === 0) {
    const port = await getAvailableEphemeralPort(host)
    if (port == null) {
      throw new Error('No available ephemeral port found')
    }

    const result = await tryBindServer(httpServer, port, host)
    if (result.success) {
      return port
    }
    if (result.error.code !== 'EADDRINUSE') {
      throw result.error
    }
    // 探测与真实 bind 之间可能被其他进程抢占；临时端口不再自动递增，明确报竞态。
    throw new Error(`Port ${port} is already in use`)
  }

  for (let port = startPort; port <= MAX_PORT; port++) {
    // 先查 wildcard，避免与监听所有接口的其他 Server 冲突（#21381）。
    const portAvailableOnWildcard = await isPortAvailable(port)

    // strictPort 仍直接绑定具体 host：某些平台允许它与被占用的另一个地址共存（#22150）。
    if (strictPort) {
      const result = await tryBindServer(httpServer, port, host)
      if (result.success) {
        if (!portAvailableOnWildcard) {
          logger.warn(
            colors.yellow(
              `Port ${port} is in use on a wildcard address, but ${host ?? 'localhost'}:${port} is available. ` +
                `There may be another server running on a wildcard IP on port ${port}.`,
            ),
          )
        }
        return port
      }
      if (result.error.code !== 'EADDRINUSE') {
        throw result.error
      }
      throw new Error(`Port ${port} is already in use`)
    }

    if (portAvailableOnWildcard) {
      const result = await tryBindServer(httpServer, port, host)
      if (result.success) {
        return port
      }
      if (result.error.code !== 'EADDRINUSE') {
        throw result.error
      }
    }
    logger.info(`Port ${port} is in use, trying another one...`)
  }
  throw new Error(
    `No available ports found between ${startPort} and ${MAX_PORT}`,
  )
}

/**
 * 处理 HTTP parser 在 request 事件前抛出的客户端错误，并返回 Node 对应状态码。
 * ECONNRESET/不可写 socket 直接忽略；header 过大额外给出 Vite 排障链接。
 */
export function setClientErrorHandler(
  server: HttpServer,
  logger: Logger,
): void {
  server.on('clientError', (err, socket) => {
    // 状态映射与 Node v26 `_http_server.js` 保持一致：
    // https://github.com/nodejs/node/blob/v26.2.0/lib/_http_server.js#L992
    let msg
    switch ((err as any).code) {
      case 'HPE_HEADER_OVERFLOW': {
        msg = '431 Request Header Fields Too Large'
        logger.warn(
          colors.yellow(
            'Server responded with status code 431. ' +
              'See https://vite.dev/guide/troubleshooting.html#_431-request-header-fields-too-large.',
          ),
        )
        break
      }
      case 'HPE_CHUNK_EXTENSIONS_OVERFLOW': {
        msg = '413 Payload Too Large'
        break
      }
      case 'ERR_HTTP_REQUEST_TIMEOUT': {
        msg = '408 Request Timeout'
        break
      }
      default: {
        msg = '400 Bad Request'
        break
      }
    }
    if ((err as any).code === 'ECONNRESET' || !socket.writable) {
      return
    }
    socket.end(`HTTP/1.1 ${msg}\r\nConnection: close\r\n\r\n`)
  })
}
