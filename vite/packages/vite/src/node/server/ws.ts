import path from 'node:path'
import type { IncomingMessage, Server } from 'node:http'
import { STATUS_CODES, createServer as createHttpServer } from 'node:http'
import type { ServerOptions as HttpsServerOptions } from 'node:https'
import { createServer as createHttpsServer } from 'node:https'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import crypto from 'node:crypto'
import colors from 'picocolors'
import type { WebSocket as WebSocketRaw } from 'ws'
import { WebSocketServer as WebSocketServerRaw_ } from 'ws'
import { isHostAllowed } from 'host-validation-middleware'
import type { WebSocket as WebSocketTypes } from '#dep-types/ws'
import type {
  ErrorPayload,
  FullReloadPayload,
  HotPayload,
} from '#types/hmrPayload'
import type { InferCustomEventPayload } from '#types/customEvent'
import type { ResolvedConfig } from '..'
import { isObject } from '../utils'
import type { NormalizedHotChannel, NormalizedHotChannelClient } from './hmr'
import { normalizeHotChannel } from './hmr'
import type { HttpServer } from '.'

/* Bun 会覆写 `ws` 包以接入原生实现。不能使用 Vite bundle 内的 JS 版本，因为 Bun 的 req.socket
 * 不允许直接读写底层 socket。
 */
const WebSocketServerRaw = process.versions.bun
  ? // @ts-expect-error Bun 运行时定义了 `import.meta.require`。
    import.meta.require('ws').WebSocketServer
  : WebSocketServerRaw_

/** HMR WebSocket 握手使用的 `Sec-WebSocket-Protocol` 值。 */
export const HMR_HEADER = 'vite-hmr'

/** 自定义 HMR 事件监听器，除 payload 外还接收发出事件的客户端包装。 */
export type WebSocketCustomListener<T> = (
  data: T,
  client: WebSocketClient,
) => void

/** 标记 Vite WebSocketServer 兼容对象的唯一符号。 */
export const isWebSocketServer: unique symbol = Symbol('isWebSocketServer')

/** Vite 开发服务器公开的 HMR WebSocket 通道。 */
export interface WebSocketServer extends NormalizedHotChannel {
  /** 处理 `import.meta.hot.send` 发来的自定义事件，也透传底层 ws server 事件。 */
  on: WebSocketTypes.Server['on'] & {
    /** 注册带类型推断的 Vite 自定义事件监听器。 */
    <T extends string>(
      event: T,
      listener: WebSocketCustomListener<InferCustomEventPayload<T>>,
    ): void
  }
  /** 注销事件监听器。 */
  off: WebSocketTypes.Server['off'] & {
    /** 移除先前注册的底层或自定义事件监听器。 */
    (event: string, listener: Function): void
  }
  /** 独立 WS server 模式下开始监听配置的 host/port。 */
  listen(): void
  /** 断开所有客户端并终止 server。 */
  close(): Promise<void>

  /** 供 normalizeHotChannel 辨认此对象已经是 server 通道。 */
  [isWebSocketServer]: true
  /** 取得当前所有已连接客户端的 JSON 发送包装。 */
  clients: Set<WebSocketClient>
}

/** 单个已连接 HMR 客户端及其底层 socket。 */
export interface WebSocketClient extends NormalizedHotChannelClient {
  /**
   * 底层 WebSocket 实例。
   * @advanced
   */
  socket: WebSocketTypes
}

/** 需要直接转发给 `ws` Server、而不是作为 Vite 自定义事件处理的事件名。 */
const wsServerEvents = [
  'connection',
  'error',
  'headers',
  'listening',
  'message',
]

/** 为禁用 WebSocket 时的通道接口提供无副作用实现。 */
function noop() {
  // 显式空实现。
}

/**
 * 用恒定时间比较请求 token 与当前进程 token，拒绝跨站 WebSocket 劫持。
 * 校验必须早于 `handleUpgrade`，否则恶意连接会先进入客户端集合。
 */
function hasValidToken(config: ResolvedConfig, url: URL) {
  const token = url.searchParams.get('token')
  if (!token) return false

  try {
    const isValidToken = crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(config.webSocketToken),
    )
    return isValidToken
  } catch {} // timingSafeEqual 在长度不一致时会抛错，统一视为校验失败。
  return false
}

/**
 * 创建默认 HMR WebSocket 通道。它可复用主 HTTP server、挂到用户自定义 server，或在 middleware
 * 模式创建独立 HTTP(S) server；对外统一为 NormalizedHotChannel。
 */
export function createWebSocketServer(
  server: HttpServer | null,
  config: ResolvedConfig,
  httpsOptions?: HttpsServerOptions,
): WebSocketServer {
  if (config.server.ws === false) {
    return {
      [isWebSocketServer]: true,
      /** WebSocket 被禁用时始终返回新的空客户端集合。 */
      get clients() {
        return new Set<WebSocketClient>()
      },
      /** 禁用态没有底层网络资源，关闭为空操作。 */
      async close() {
        // HMR 被禁用时无需释放资源。
      },
      on: noop as any as WebSocketServer['on'],
      off: noop as any as WebSocketServer['off'],
      setInvokeHandler: noop,
      handleInvoke: async () => ({
        error: {
          name: 'TransportError',
          message: 'handleInvoke not implemented',
          stack: new Error().stack,
        },
      }),
      listen: noop,
      send: noop,
    }
  }

  let wsHttpServer: Server | undefined = undefined

  const wsOptions = isObject(config.server.ws) ? config.server.ws : undefined
  const wsCustomServer = wsOptions?.server
  const wsPort = wsOptions?.port
  // TODO：主 server 可能因自动选择可用端口而尚未确定最终端口。
  const portsAreCompatible = !wsPort || wsPort === config.server.port
  const wsServer = wsCustomServer || (portsAreCompatible && server)
  let hmrServerWsListener: (
    req: InstanceType<typeof IncomingMessage>,
    socket: Duplex,
    head: Buffer,
  ) => void
  const customListeners = new Map<string, Set<WebSocketCustomListener<any>>>()
  const clientsMap = new WeakMap<WebSocketRaw, WebSocketClient>()
  const port = wsPort || 24678
  const host = wsOptions?.host || undefined
  const allowedHosts =
    config.server.allowedHosts === true
      ? config.server.allowedHosts
      : Object.freeze([...config.server.allowedHosts]) // 冻结数组，允许 host 校验层安全缓存。

  /** 在握手升级前校验协议、Host 与浏览器 token。 */
  const shouldHandle = (req: IncomingMessage) => {
    const protocol = req.headers['sec-websocket-protocol']!
    // vite-ping 必须在客户端重新获取 `/@vite/client` 前探测 server，因此允许任意来源；它不收发业务
    // payload，连接成功后也会立刻关闭。
    if (protocol === 'vite-ping') return true

    if (
      allowedHosts !== true &&
      !isHostAllowed(req.headers.host, allowedHosts)
    ) {
      return false
    }

    if (config.legacy?.skipWebSocketTokenCheck) {
      return true
    }

    // 浏览器 WebSocket 总会携带 Origin；存在该头时按浏览器请求执行 token 校验。
    if (req.headers.origin) {
      const parsedUrl = new URL(`http://example.com${req.url!}`)
      return hasValidToken(config, parsedUrl)
    }

    // 为兼容和便于非浏览器客户端使用，无 Origin 时允许无 token 连接。能绕开同源策略发这种请求的
    // 本地工具，本来就能直接访问开发服务器 HTTP 接口。
    return true
  }
  /** 把已通过校验的请求升级为 socket；ping 连接只验证可达性后立即关闭。 */
  const handleUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    isPing: boolean,
  ) => {
    wss.handleUpgrade(req, socket as Socket, head, (ws) => {
      // vite-ping 只验证握手可达性：直接正常关闭，不发 connection 事件，也不进入 wss.clients。
      if (isPing) {
        ws.close(/* 正常关闭 */ 1000)
        return
      }
      wss.emit('connection', ws, req)
    })
  }
  const wss: WebSocketServerRaw_ = new WebSocketServerRaw({ noServer: true })
  wss.shouldHandle = shouldHandle

  if (wsServer) {
    let hmrBase = config.base
    const wsPath = wsOptions?.path
    if (wsPath) {
      hmrBase = path.posix.join(hmrBase, wsPath)
    }
    hmrServerWsListener = (req, socket, head) => {
      const protocol = req.headers['sec-websocket-protocol']!
      const parsedUrl = new URL(`http://example.com${req.url!}`)
      if (
        [HMR_HEADER, 'vite-ping'].includes(protocol) &&
        parsedUrl.pathname === hmrBase
      ) {
        handleUpgrade(req, socket as Socket, head, protocol === 'vite-ping')
      }
    }
    wsServer.on('upgrade', hmrServerWsListener)
  } else {
    // 独立 server 的普通 HTTP 请求行为与 ws 自带 server 保持一致：
    // https://github.com/websockets/ws/blob/45e17acea791d865df6b255a55182e9c42e5877a/lib/websocket-server.js#L88-L96
    const route = ((_, res) => {
      const statusCode = 426
      const body = STATUS_CODES[statusCode]
      if (!body)
        throw new Error(`No body text found for the ${statusCode} status code`)

      res.writeHead(statusCode, {
        'Content-Length': body.length,
        'Content-Type': 'text/plain',
      })
      res.end(body)
    }) as Parameters<typeof createHttpServer>[1]
    // middleware 模式没有 Vite 主 HTTP 监听器，需要手工启动独立 WS server。
    if (httpsOptions) {
      wsHttpServer = createHttpsServer(httpsOptions, route)
    } else {
      wsHttpServer = createHttpServer(route)
    }
    wsHttpServer.on('upgrade', (req, socket, head) => {
      const protocol = req.headers['sec-websocket-protocol']!
      if (protocol === 'vite-ping' && server && !server.listening) {
        // WS 可能早于主 HTTP server 开始监听；主 server 尚未 ready 时拒绝 ping，让客户端继续重试。
        req.destroy()
        return
      }
      handleUpgrade(req, socket as Socket, head, protocol === 'vite-ping')
    })
    wsHttpServer.on(
      'error',
      (
        e: Error & {
          /** Node 网络错误码，用于识别端口占用。 */
          code: string
          /** 发生监听冲突的端口。 */
          port: number
        },
      ) => {
        if (e.code === 'EADDRINUSE') {
          config.logger.error(
            colors.red(
              `WebSocket server error: Port ${e.port} is already in use`,
            ),
            { error: e },
          )
        } else {
          config.logger.error(
            colors.red(`WebSocket server error:\n${e.stack || e.message}`),
            { error: e },
          )
        }
      },
    )
  }

  /** 把客户端发来的自定义事件分派给全部 Vite 监听器。 */
  const emitCustomEvent = <T extends string>(
    event: T,
    data: InferCustomEventPayload<T>,
    socket: WebSocketRaw,
  ) => {
    const listeners = customListeners.get(event)
    if (!listeners?.size) return

    const client = getSocketClient(socket)
    for (const listener of listeners) {
      listener(data, client)
    }
  }

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      if (!customListeners.size) return
      let parsed: any
      try {
        parsed = JSON.parse(String(raw))
      } catch {}
      if (!parsed || parsed.type !== 'custom' || !parsed.event) return
      emitCustomEvent(parsed.event, parsed.data, socket)
    })
    socket.on('error', (err) => {
      config.logger.error(`${colors.red(`ws error:`)}\n${err.stack}`, {
        timestamp: true,
        error: err,
      })
    })
    socket.on('close', () => {
      emitCustomEvent('vite:client:disconnect', undefined, socket)
    })

    emitCustomEvent('vite:client:connect', undefined, socket)

    socket.send(JSON.stringify({ type: 'connected' }))
    if (bufferedMessage) {
      socket.send(JSON.stringify(bufferedMessage))
      bufferedMessage = null
    }
  })

  wss.on(
    'error',
    (
      e: Error & {
        /** 底层 `ws` Server 的网络错误码。 */
        code: string
        /** 错误关联的监听端口。 */
        port: number
      },
    ) => {
      if (e.code === 'EADDRINUSE') {
        config.logger.error(
          colors.red(
            `WebSocket server error: Port ${e.port} is already in use`,
          ),
          { error: e },
        )
      } else {
        config.logger.error(
          colors.red(`WebSocket server error:\n${e.stack || e.message}`),
          { error: e },
        )
      }
    },
  )

  /** 包装原始 socket，使单客户端 send 与 server.ws.send 一样接受 HotPayload/自定义事件并编码 JSON。 */
  function getSocketClient(socket: WebSocketRaw) {
    if (!clientsMap.has(socket)) {
      clientsMap.set(socket, {
        send: (...args: any[]) => {
          let payload: HotPayload
          if (typeof args[0] === 'string') {
            payload = {
              type: 'custom',
              event: args[0],
              data: args[1],
            }
          } else {
            payload = args[0]
          }
          socket.send(JSON.stringify(payload))
        },
        socket,
      })
    }
    return clientsMap.get(socket)!
  }

  // 页面 reload 后若模块编译立即返回 500，error payload 可能早于新客户端连接；优化器也可能在连接前
  // 完成并要求 reload。无连接时只缓冲最后一个 error/full-reload，在下一客户端建立时补发。
  let bufferedMessage: ErrorPayload | FullReloadPayload | null = null

  const normalizedHotChannel = normalizeHotChannel(
    {
      /** 广播 HMR payload；无人连接时暂存最后一次错误或整页刷新。 */
      send(payload) {
        if (
          (payload.type === 'error' || payload.type === 'full-reload') &&
          !wss.clients.size
        ) {
          bufferedMessage = payload
          return
        }

        const stringified = JSON.stringify(payload)
        wss.clients.forEach((client) => {
          // readyState 1 表示连接已打开，其他状态不能 send。
          if (client.readyState === 1) {
            client.send(stringified)
          }
        })
      },
      /** 注册 Vite 自定义事件监听器。 */
      on(event: string, fn: any) {
        if (!customListeners.has(event)) {
          customListeners.set(event, new Set())
        }
        customListeners.get(event)!.add(fn)
      },
      /** 注销 Vite 自定义事件监听器。 */
      off(event: string, fn: any) {
        customListeners.get(event)?.delete(fn)
      },
      /** 在独立 WebSocket 模式下开始监听配置的地址。 */
      listen() {
        wsHttpServer?.listen(port, host)
      },
      /** 终止客户端，关闭 ws/独立 HTTP Server，并移除复用 server 的升级监听器。 */
      close() {
        // 使用 hmr.server 时必须移除 upgrade listener，否则重启后的旧监听器会吞掉所有 WS 连接。
        if (hmrServerWsListener && wsServer) {
          wsServer.off('upgrade', hmrServerWsListener)
        }
        return new Promise<void>((resolve, reject) => {
          wss.clients.forEach((client) => {
            client.terminate()
          })
          wss.close((err) => {
            if (err) {
              reject(err)
            } else {
              if (wsHttpServer) {
                wsHttpServer.close((err) => {
                  if (err) {
                    reject(err)
                  } else {
                    resolve()
                  }
                })
              } else {
                resolve()
              }
            }
          })
        })
      },
    },
    config.server.hmr !== false,
    // client send 已由上方包装，且要保留 `.socket`，所以不再让 normalizeHotChannel 包装 client。
    false,
  )
  return {
    ...normalizedHotChannel,

    on: ((event: string, fn: any) => {
      if (wsServerEvents.includes(event)) {
        wss.on(event, fn)
        return
      }
      normalizedHotChannel.on(event, fn)
    }) as WebSocketServer['on'],
    off: ((event: string, fn: any) => {
      if (wsServerEvents.includes(event)) {
        wss.off(event, fn)
        return
      }
      normalizedHotChannel.off(event, fn)
    }) as WebSocketServer['off'],
    /** 关闭规范化通道及其底层网络资源。 */
    async close() {
      await normalizedHotChannel.close()
    },

    [isWebSocketServer]: true,
    /** 把底层 socket 集合转换成公开的单客户端热通道包装。 */
    get clients() {
      return new Set(Array.from(wss.clients).map(getSocketClient))
    },
  }
}
