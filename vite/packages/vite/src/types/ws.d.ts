// 这是经 Vite 调整后内联的 ws 8.5 DefinitelyTyped 声明快照，用于描述 HMR
// WebSocket 服务端公共类型而不引入额外类型依赖；连接实现仍来自 ws 包本身。
// Source: https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/ws/index.d.ts

// Type definitions for ws 8.5
// Project: https://github.com/websockets/ws
// Definitions by: Paul Loyd <https://github.com/loyd>
//                 Margus Lamp <https://github.com/mlamp>
//                 Philippe D'Alva <https://github.com/TitaneBoy>
//                 reduckted <https://github.com/reduckted>
//                 teidesu <https://github.com/teidesu>
//                 Bartosz Wojtkowiak <https://github.com/wojtkowiak>
//                 Kyle Hensel <https://github.com/k-yle>
//                 Samuel Skeen <https://github.com/cwadrupldijjit>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="node" />

import { EventEmitter } from 'node:events'
import type {
  Agent,
  ClientRequest,
  ClientRequestArgs,
  Server as HTTPServer,
  IncomingMessage,
  OutgoingHttpHeaders,
} from 'node:http'
import type { Server as HTTPSServer } from 'node:https'
import type { Duplex, DuplexOptions } from 'node:stream'
import type { SecureContextOptions } from 'node:tls'
import type { URL } from 'node:url'
import type { ZlibOptions } from 'node:zlib'

// WebSocket 连接对象。
/** ws 连接实例的内联类型：提供帧收发、关闭和浏览器/Node 两种事件接口。 */
declare class WebSocket extends EventEmitter {
  /** 连接尚未打开。 */
  static readonly CONNECTING: 0
  /** 连接已打开，可进行通信。 */
  static readonly OPEN: 1
  /** 连接正在关闭。 */
  static readonly CLOSING: 2
  /** 连接已关闭。 */
  static readonly CLOSED: 3

  /** 决定接收到的二进制消息以 Buffer、ArrayBuffer 或分片数组交给消费者。 */
  binaryType: 'nodebuffer' | 'arraybuffer' | 'fragments'
  /** 等待发送完成的数据字节数，用于观察当前连接的发送积压。 */
  readonly bufferedAmount: number
  /** 本次握手协商出的 WebSocket 扩展名称。 */
  readonly extensions: string
  /** WebSocket 是否已暂停发出事件。 */
  readonly isPaused: boolean
  /** 本次握手选择的应用子协议；与 ws/wss URL 协议不同。 */
  readonly protocol: string
  /** 当前连接状态。 */
  readonly readyState:
    | typeof WebSocket.CONNECTING
    | typeof WebSocket.OPEN
    | typeof WebSocket.CLOSING
    | typeof WebSocket.CLOSED
  /** 用于建立当前连接的服务器 URL。 */
  readonly url: string

  /** 连接尚未打开。 */
  readonly CONNECTING: 0
  /** 连接已打开，可进行通信。 */
  readonly OPEN: 1
  /** 连接正在关闭。 */
  readonly CLOSING: 2
  /** 连接已关闭。 */
  readonly CLOSED: 3

  /** 浏览器事件风格的连接打开处理器，null 表示未设置。 */
  onopen: ((event: WebSocket.Event) => void) | null
  /** 浏览器事件风格的错误处理器，接收 ErrorEvent。 */
  onerror: ((event: WebSocket.ErrorEvent) => void) | null
  /** 浏览器事件风格的关闭处理器，接收关闭码和原因等信息。 */
  onclose: ((event: WebSocket.CloseEvent) => void) | null
  /** 浏览器事件风格的消息处理器，从 MessageEvent.data 读取内容。 */
  onmessage: ((event: WebSocket.MessageEvent) => void) | null

  /** 构造尚未绑定地址的连接壳，供服务端接受 upgrade 时填充底层 socket。 */
  constructor(address: null)
  /** 向地址发起客户端握手，可传 HTTP/TLS 与 WebSocket 选项。 */
  constructor(
    address: string | URL,
    options?: WebSocket.ClientOptions | ClientRequestArgs,
  )
  /** 向地址发起客户端握手，并提供单个或多个候选子协议。 */
  constructor(
    address: string | URL,
    protocols?: string | string[],
    options?: WebSocket.ClientOptions | ClientRequestArgs,
  )

  /** 启动关闭握手，可指定关闭码及原因；需要立即终止时使用 terminate。 */
  close(code?: number, data?: string | Buffer): void
  /** 发送 ping 控制帧；mask 控制掩码，回调报告帧发送失败。 */
  ping(data?: any, mask?: boolean, cb?: (err: Error) => void): void
  /** 发送 pong 控制帧，数据和掩码选项与 ping 对应。 */
  pong(data?: any, mask?: boolean, cb?: (err: Error) => void): void
  /** 发送文本或二进制数据，回调接收发送失败；含 options 的重载可控制帧格式。 */
  send(data: any, cb?: (err?: Error) => void): void
  /** 发送文本或二进制数据，回调接收发送失败；含 options 的重载可控制帧格式。 */
  send(
    data: any,
    options: {
      /** 是否对待发送帧加掩码，通常由客户端或服务端角色决定。 */
      mask?: boolean | undefined
      /** 是否把此次消息编码为二进制帧，而非文本帧。 */
      binary?: boolean | undefined
      /** 在已协商压缩扩展时，是否压缩此次消息。 */
      compress?: boolean | undefined
      /** 当前帧是否结束此次消息；false 表示还会有后续分片。 */
      fin?: boolean | undefined
    },
    cb?: (err?: Error) => void,
  ): void
  /** 直接销毁底层连接，不等待正常关闭握手完成。 */
  terminate(): void

  /**
   * 暂停 WebSocket 发出事件；缓冲数据耗尽前仍可能收到少量事件。状态为 CONNECTING
   * 或 CLOSED 时不产生效果。
   */
  pause(): void
  /**
   * 恢复已暂停连接的事件；状态为 CONNECTING 或 CLOSED 时不产生效果。
   */
  resume(): void

  // HTML5 WebSocket 风格事件。
  /** 注册浏览器风格的 'message' 监听器；消息通过 MessageEvent.data 交给回调，options.once 控制是否只执行一次。 */
  addEventListener(
    method: 'message',
    cb: (event: WebSocket.MessageEvent) => void,
    options?: WebSocket.EventListenerOptions,
  ): void
  /** 注册浏览器风格的 'close' 监听器；CloseEvent 提供关闭码、原因和正常关闭标志，options.once 控制是否只执行一次。 */
  addEventListener(
    method: 'close',
    cb: (event: WebSocket.CloseEvent) => void,
    options?: WebSocket.EventListenerOptions,
  ): void
  /** 注册浏览器风格的 'error' 监听器；ErrorEvent 提供原始错误及消息，options.once 控制是否只执行一次。 */
  addEventListener(
    method: 'error',
    cb: (event: WebSocket.ErrorEvent) => void,
    options?: WebSocket.EventListenerOptions,
  ): void
  /** 注册浏览器风格的 'open' 监听器；Event 表示连接已经打开，options.once 控制是否只执行一次。 */
  addEventListener(
    method: 'open',
    cb: (event: WebSocket.Event) => void,
    options?: WebSocket.EventListenerOptions,
  ): void

  /** 移除 'message' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  removeEventListener(
    method: 'message',
    cb: (event: WebSocket.MessageEvent) => void,
  ): void
  /** 移除 'close' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  removeEventListener(
    method: 'close',
    cb: (event: WebSocket.CloseEvent) => void,
  ): void
  /** 移除 'error' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  removeEventListener(
    method: 'error',
    cb: (event: WebSocket.ErrorEvent) => void,
  ): void
  /** 移除 'open' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  removeEventListener(
    method: 'open',
    cb: (event: WebSocket.Event) => void,
  ): void

  // Node EventEmitter 风格事件。
  /** 注册持续监听回调：关闭事件，回调可读取关闭码及原因。 */
  on(
    event: 'close',
    listener: (this: WebSocket, code: number, reason: Buffer) => void,
  ): this
  /** 注册持续监听回调：连接错误事件，回调接收原始错误。 */
  on(event: 'error', listener: (this: WebSocket, err: Error) => void): this
  /** 注册持续监听回调：客户端 HTTP 升级成功事件，回调接收响应信息。 */
  on(
    event: 'upgrade',
    listener: (this: WebSocket, request: IncomingMessage) => void,
  ): this
  /** 注册持续监听回调：消息事件，Node 回调以数据和 isBinary 两项区分内容。 */
  on(
    event: 'message',
    listener: (
      this: WebSocket,
      data: WebSocket.RawData,
      isBinary: boolean,
    ) => void,
  ): this
  /** 注册持续监听回调：连接打开事件，回调无需消息参数。 */
  on(event: 'open', listener: (this: WebSocket) => void): this
  /** 注册持续监听回调：ping/pong 控制帧事件，回调接收 Buffer 数据。 */
  on(
    event: 'ping' | 'pong',
    listener: (this: WebSocket, data: Buffer) => void,
  ): this
  /** 注册持续监听回调：非预期握手响应事件，回调接收 ClientRequest 和 IncomingMessage。 */
  on(
    event: 'unexpected-response',
    listener: (
      this: WebSocket,
      request: ClientRequest,
      response: IncomingMessage,
    ) => void,
  ): this
  /** 注册持续监听回调：关闭事件，回调可读取关闭码及原因。 */
  on(
    event: string | symbol,
    listener: (this: WebSocket, ...args: any[]) => void,
  ): this

  /** 只处理第一次匹配事件并自动移除回调：关闭事件，回调可读取关闭码及原因。 */
  once(
    event: 'close',
    listener: (this: WebSocket, code: number, reason: Buffer) => void,
  ): this
  /** 只处理第一次匹配事件并自动移除回调：连接错误事件，回调接收原始错误。 */
  once(event: 'error', listener: (this: WebSocket, err: Error) => void): this
  /** 只处理第一次匹配事件并自动移除回调：客户端 HTTP 升级成功事件，回调接收响应信息。 */
  once(
    event: 'upgrade',
    listener: (this: WebSocket, request: IncomingMessage) => void,
  ): this
  /** 只处理第一次匹配事件并自动移除回调：消息事件，Node 回调以数据和 isBinary 两项区分内容。 */
  once(
    event: 'message',
    listener: (
      this: WebSocket,
      data: WebSocket.RawData,
      isBinary: boolean,
    ) => void,
  ): this
  /** 只处理第一次匹配事件并自动移除回调：连接打开事件，回调无需消息参数。 */
  once(event: 'open', listener: (this: WebSocket) => void): this
  /** 只处理第一次匹配事件并自动移除回调：ping/pong 控制帧事件，回调接收 Buffer 数据。 */
  once(
    event: 'ping' | 'pong',
    listener: (this: WebSocket, data: Buffer) => void,
  ): this
  /** 只处理第一次匹配事件并自动移除回调：非预期握手响应事件，回调接收 ClientRequest 和 IncomingMessage。 */
  once(
    event: 'unexpected-response',
    listener: (
      this: WebSocket,
      request: ClientRequest,
      response: IncomingMessage,
    ) => void,
  ): this
  /** 只处理第一次匹配事件并自动移除回调：关闭事件，回调可读取关闭码及原因。 */
  once(
    event: string | symbol,
    listener: (this: WebSocket, ...args: any[]) => void,
  ): this

  /** 移除 'close' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  off(
    event: 'close',
    listener: (this: WebSocket, code: number, reason: Buffer) => void,
  ): this
  /** 移除 'error' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  off(event: 'error', listener: (this: WebSocket, err: Error) => void): this
  /** 移除 'upgrade' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  off(
    event: 'upgrade',
    listener: (this: WebSocket, request: IncomingMessage) => void,
  ): this
  /** 移除 'message' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  off(
    event: 'message',
    listener: (
      this: WebSocket,
      data: WebSocket.RawData,
      isBinary: boolean,
    ) => void,
  ): this
  /** 移除 'open' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  off(event: 'open', listener: (this: WebSocket) => void): this
  /** 移除 'ping' | 'pong' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  off(
    event: 'ping' | 'pong',
    listener: (this: WebSocket, data: Buffer) => void,
  ): this
  /** 移除 'unexpected-response' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  off(
    event: 'unexpected-response',
    listener: (
      this: WebSocket,
      request: ClientRequest,
      response: IncomingMessage,
    ) => void,
  ): this
  /** 移除 string | symbol 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  off(
    event: string | symbol,
    listener: (this: WebSocket, ...args: any[]) => void,
  ): this

  /** 注册持续监听回调：关闭事件，回调可读取关闭码及原因。 */
  addListener(
    event: 'close',
    listener: (code: number, reason: Buffer) => void,
  ): this
  /** 注册持续监听回调：连接错误事件，回调接收原始错误。 */
  addListener(event: 'error', listener: (err: Error) => void): this
  /** 注册持续监听回调：客户端 HTTP 升级成功事件，回调接收响应信息。 */
  addListener(
    event: 'upgrade',
    listener: (request: IncomingMessage) => void,
  ): this
  /** 注册持续监听回调：消息事件，Node 回调以数据和 isBinary 两项区分内容。 */
  addListener(
    event: 'message',
    listener: (data: WebSocket.RawData, isBinary: boolean) => void,
  ): this
  /** 注册持续监听回调：连接打开事件，回调无需消息参数。 */
  addListener(event: 'open', listener: () => void): this
  /** 注册持续监听回调：ping/pong 控制帧事件，回调接收 Buffer 数据。 */
  addListener(event: 'ping' | 'pong', listener: (data: Buffer) => void): this
  /** 注册持续监听回调：非预期握手响应事件，回调接收 ClientRequest 和 IncomingMessage。 */
  addListener(
    event: 'unexpected-response',
    listener: (request: ClientRequest, response: IncomingMessage) => void,
  ): this
  /** 注册持续监听回调：关闭事件，回调可读取关闭码及原因。 */
  addListener(event: string | symbol, listener: (...args: any[]) => void): this

  /** 移除 'close' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  removeListener(
    event: 'close',
    listener: (code: number, reason: Buffer) => void,
  ): this
  /** 移除 'error' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  removeListener(event: 'error', listener: (err: Error) => void): this
  /** 移除 'upgrade' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  removeListener(
    event: 'upgrade',
    listener: (request: IncomingMessage) => void,
  ): this
  /** 移除 'message' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  removeListener(
    event: 'message',
    listener: (data: WebSocket.RawData, isBinary: boolean) => void,
  ): this
  /** 移除 'open' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  removeListener(event: 'open', listener: () => void): this
  /** 移除 'ping' | 'pong' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  removeListener(event: 'ping' | 'pong', listener: (data: Buffer) => void): this
  /** 移除 'unexpected-response' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  removeListener(
    event: 'unexpected-response',
    listener: (request: ClientRequest, response: IncomingMessage) => void,
  ): this
  /** 移除 string | symbol 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
  removeListener(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this
}

/** 保留 ws 默认连接类的值别名，供命名空间内部引用构造器。 */
declare const WebSocketAlias: typeof WebSocket
/** 保留 ws 默认连接类的类型与值别名，供命名空间内部引用。 */
interface WebSocketAlias extends WebSocket {}

/** ws 的连接、服务端、握手验证、压缩和事件附属类型命名空间。 */
declare namespace WebSocket {
  /**
   * WebSocket 收到的原始消息数据；message 回调的 isBinary 区分文本与二进制。
   */
  type RawData = Buffer | ArrayBuffer | Buffer[]

  /**
   * WebSocket 收到的文本或二进制消息 payload。
   */
  type Data = string | Buffer | ArrayBuffer | Buffer[]

  /**
   * 证书与密钥数据可接受的输入类型。
   */
  type CertMeta = string | string[] | Buffer | Buffer[]

  /**
   * 同步检查入站握手的回调；返回布尔值决定是否接受连接。
   */
  type VerifyClientCallbackSync = (info: {
    /** 入站升级请求的 Origin 头，用于握手来源判断。 */
    origin: string
    /** 握手请求是否经由安全传输到达。 */
    secure: boolean
    /** 原始 HTTP 升级请求，可读取头部和请求地址。 */
    req: IncomingMessage
  }) => boolean

  /**
   * 异步检查入站握手的回调；通过 callback 的布尔参数决定是否接受连接。
   */
  type VerifyClientCallbackAsync = (
    info: {
      /** 入站升级请求的 Origin 头，异步校验可据此决定是否接受。 */
      origin: string;
      /** 握手是否经由安全传输到达。 */
      secure: boolean;
      /** 待异步验证的原始 HTTP 升级请求。 */
      req: IncomingMessage
    },
    callback: (
      res: boolean,
      code?: number,
      message?: string,
      headers?: OutgoingHttpHeaders,
    ) => void,
  ) => void

  /** 客户端握手、HTTP/TLS 连接及消息处理选项的兼容类型。 */
  interface ClientOptions extends SecureContextOptions {
    /** 透传给连接请求的协议选项。 */
    protocol?: string | undefined
    /** 是否跟随握手 HTTP 响应中的重定向。 */
    followRedirects?: boolean | undefined
    /** 为客户端待发送帧填写掩码 Buffer，供自定义掩码生成实现使用。 */
    generateMask?(mask: Buffer): void
    /** 等待握手完成的最长毫秒数。 */
    handshakeTimeout?: number | undefined
    /** 开启重定向时允许跟随的最大次数。 */
    maxRedirects?: number | undefined
    /** 是否协商 permessage-deflate，或给出其具体压缩参数。 */
    perMessageDeflate?: boolean | PerMessageDeflateOptions | undefined
    /** 客户端建立连接时绑定的本地网络地址。 */
    localAddress?: string | undefined
    /** 握手使用的 WebSocket 协议版本。 */
    protocolVersion?: number | undefined
    /** 追加到 HTTP 升级请求中的头字段。 */
    headers?: { [key: string]: string } | undefined
    /** 客户端握手发送的 Origin 头值。 */
    origin?: string | undefined
    /** 用于建立 HTTP/HTTPS 连接的自定义 Agent。 */
    agent?: Agent | undefined
    /** 透传给底层连接请求的主机选项。 */
    host?: string | undefined
    /** 底层网络地址解析使用的 IP 地址族。 */
    family?: number | undefined
    /** 自定义 TLS 服务器身份检查回调；此快照以布尔值描述校验结果。 */
    checkServerIdentity?(servername: string, cert: CertMeta): boolean
    /** TLS 连接是否拒绝未通过证书验证的服务器。 */
    rejectUnauthorized?: boolean | undefined
    /** 允许接收的最大消息字节数，限制过大消息。 */
    maxPayload?: number | undefined
    /** 是否省略文本消息的 UTF-8 校验。 */
    skipUTF8Validation?: boolean | undefined
  }

  /** permessage-deflate 协商和 zlib 压缩/解压资源使用选项。 */
  interface PerMessageDeflateOptions {
    /** 是否要求服务端在消息之间不复用压缩上下文。 */
    serverNoContextTakeover?: boolean | undefined
    /** 是否要求客户端在消息之间不复用压缩上下文。 */
    clientNoContextTakeover?: boolean | undefined
    /** 服务端压缩窗口位数的协商上限。 */
    serverMaxWindowBits?: number | undefined
    /** 客户端压缩窗口位数的协商上限。 */
    clientMaxWindowBits?: number | undefined
    /** 创建 zlib 压缩器时透传的选项。 */
    zlibDeflateOptions?:
      | {
          /** 压缩操作使用的 zlib flush 模式。 */
          flush?: number | undefined
          /** 完成压缩时使用的 zlib flush 模式。 */
          finishFlush?: number | undefined
          /** zlib 内部输出缓冲块的字节数。 */
          chunkSize?: number | undefined
          /** zlib 压缩窗口的位数。 */
          windowBits?: number | undefined
          /** zlib 压缩级别，影响压缩率与计算成本。 */
          level?: number | undefined
          /** zlib 为压缩状态分配的内存级别。 */
          memLevel?: number | undefined
          /** zlib 压缩算法采用的策略标识。 */
          strategy?: number | undefined
          /** 提供给压缩器的预置字典数据。 */
          dictionary?: Buffer | Buffer[] | DataView | undefined
          /** 底层 zlib 是否请求包含引擎信息的结果。 */
          info?: boolean | undefined
        }
      | undefined
    /** 创建 zlib 解压器时透传的选项。 */
    zlibInflateOptions?: ZlibOptions | undefined
    /** 达到该字节阈值后才考虑压缩消息，具体处理受上下文复用策略影响。 */
    threshold?: number | undefined
    /** 同时运行的 zlib 压缩/解压任务上限。 */
    concurrencyLimit?: number | undefined
  }

  /** 浏览器风格事件的公共类型，包含名称及发出事件的连接。 */
  interface Event {
    /** 当前事件的名称，例如 open。 */
    type: string
    /** 发出该事件的 WebSocket 连接。 */
    target: WebSocket
  }

  /** 浏览器风格连接错误事件，保留原始错误和可展示消息。 */
  interface ErrorEvent {
    /** 触发此次事件的原始错误对象。 */
    error: any
    /** 供日志或界面显示的错误消息。 */
    message: string
    /** 错误事件的名称。 */
    type: string
    /** 发生错误的连接实例。 */
    target: WebSocket
  }

  /** 浏览器风格关闭事件，描述握手结果、关闭码及原因。 */
  interface CloseEvent {
    /** 连接是否通过完整关闭握手正常结束。 */
    wasClean: boolean
    /** 本次关闭使用的 WebSocket 状态码。 */
    code: number
    /** 关闭帧携带的原因文本。 */
    reason: string
    /** 关闭事件的名称。 */
    type: string
    /** 已关闭的连接实例。 */
    target: WebSocket
  }

  /** 浏览器风格消息事件，payload 放在 data 而非独立回调参数中。 */
  interface MessageEvent {
    /** 收到的文本或二进制消息数据。 */
    data: Data
    /** 消息事件的名称。 */
    type: string
    /** 收到消息的连接实例。 */
    target: WebSocket
  }

  /** 浏览器风格监听器的注册选项。 */
  interface EventListenerOptions {
    /** 为 true 时监听器只处理第一次匹配事件。 */
    once?: boolean | undefined
  }

  /** WebSocket 服务端的监听、升级验证和连接管理选项。 */
  interface ServerOptions {
    /** 独立 HTTP 监听器绑定的主机地址。 */
    host?: string | undefined
    /** 独立 HTTP 监听器使用的端口。 */
    port?: number | undefined
    /** 底层监听 socket 的待接受连接队列上限。 */
    backlog?: number | undefined
    /** 复用既有 HTTP/HTTPS server 的 upgrade 事件，不另建监听端口。 */
    server?: HTTPServer | HTTPSServer | undefined
    /** 同步返回或异步回调决定是否接受入站握手。 */
    verifyClient?:
      | VerifyClientCallbackAsync
      | VerifyClientCallbackSync
      | undefined
    /** 从客户端提出的子协议集合中选择一个；false 表示不选择子协议。 */
    handleProtocols?: (
      protocols: Set<string>,
      request: IncomingMessage,
    ) => string | false
    /** 只接受请求 pathname 与该路径匹配的升级请求。 */
    path?: string | undefined
    /** 不创建 HTTP server；由宿主主动调用 handleUpgrade 交接请求。 */
    noServer?: boolean | undefined
    /** 是否在 clients 集合中记录连接，供广播和关闭等管理使用。 */
    clientTracking?: boolean | undefined
    /** 是否启用或如何配置服务端 permessage-deflate 协商。 */
    perMessageDeflate?: boolean | PerMessageDeflateOptions | undefined
    /** 允许接收的最大消息字节数。 */
    maxPayload?: number | undefined
    /** 是否跳过文本消息 UTF-8 校验。 */
    skipUTF8Validation?: boolean | undefined
    /** 用于创建已接受连接的自定义 WebSocket 类。 */
    WebSocket?: typeof WebSocket.WebSocket | undefined
  }

  /** 独立监听器的网络地址；Unix socket 地址由 address 方法返回字符串。 */
  interface AddressInfo {
    /** 实际绑定的网络地址。 */
    address: string
    /** 实际绑定地址的 IP 地址族名称。 */
    family: string
    /** 实际监听端口，端口为 0 时可在监听后读取系统分配值。 */
    port: number
  }

  // WebSocket 服务器。
  /** ws 服务端实例的类型，管理 HTTP 升级、已连接客户端与服务端事件。 */
  class Server<T extends WebSocket = WebSocket> extends EventEmitter {
    /** 创建此服务端实例时采用的选项。 */
    options: ServerOptions
    /** 服务端配置的升级请求路径。 */
    path: string
    /** 启用 clientTracking 后收集的当前客户端连接。 */
    clients: Set<T>

    /** 按配置创建 WebSocket server；独立监听器就绪时执行可选回调。 */
    constructor(options?: ServerOptions, callback?: () => void)

    /** 取得底层监听地址或 Unix socket 路径；noServer 模式没有独立监听地址。 */
    address(): AddressInfo | string
    /** 停止接受新连接；回调在服务端关闭完成或发生错误后执行，已有客户端需另行协调关闭。 */
    close(cb?: (err?: Error) => void): void
    /** 验证并接管 HTTP upgrade 的请求、Duplex socket 与已读头数据，成功后回调连接。 */
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      upgradeHead: Buffer,
      callback: (client: T, request: IncomingMessage) => void,
    ): void
    /** 按当前服务端规则判断是否接管该升级请求；兼容子类异步判断的类型。 */
    shouldHandle(request: IncomingMessage): boolean | Promise<boolean>

    // 服务器事件。
    /** 注册持续监听回调：新连接事件，回调接收已升级连接和原始请求。 */
    on(
      event: 'connection',
      cb: (this: Server<T>, socket: T, request: IncomingMessage) => void,
    ): this
    /** 注册持续监听回调：连接错误事件，回调接收原始错误。 */
    on(event: 'error', cb: (this: Server<T>, error: Error) => void): this
    /** 注册持续监听回调：升级响应头事件，回调可读取待发送头列表和请求。 */
    on(
      event: 'headers',
      cb: (
        this: Server<T>,
        headers: string[],
        request: IncomingMessage,
      ) => void,
    ): this
    /** 监听服务端关闭或开始监听的事件，回调不接收连接关闭码或消息参数。 */
    on(event: 'close' | 'listening', cb: (this: Server<T>) => void): this
    /** 注册持续监听回调：新连接事件，回调接收已升级连接和原始请求。 */
    on(
      event: string | symbol,
      listener: (this: Server<T>, ...args: any[]) => void,
    ): this

    /** 只处理第一次匹配事件并自动移除回调：新连接事件，回调接收已升级连接和原始请求。 */
    once(
      event: 'connection',
      cb: (this: Server<T>, socket: T, request: IncomingMessage) => void,
    ): this
    /** 只处理第一次匹配事件并自动移除回调：连接错误事件，回调接收原始错误。 */
    once(event: 'error', cb: (this: Server<T>, error: Error) => void): this
    /** 只处理第一次匹配事件并自动移除回调：升级响应头事件，回调可读取待发送头列表和请求。 */
    once(
      event: 'headers',
      cb: (
        this: Server<T>,
        headers: string[],
        request: IncomingMessage,
      ) => void,
    ): this
    /** 仅监听首次服务端关闭或开始监听的事件，回调不接收连接关闭码或消息参数。 */
    once(event: 'close' | 'listening', cb: (this: Server<T>) => void): this
    /** 只处理第一次匹配事件并自动移除回调：新连接事件，回调接收已升级连接和原始请求。 */
    once(
      event: string | symbol,
      listener: (this: Server<T>, ...args: any[]) => void,
    ): this

    /** 移除 'connection' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
    off(
      event: 'connection',
      cb: (this: Server<T>, socket: T, request: IncomingMessage) => void,
    ): this
    /** 移除 'error' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
    off(event: 'error', cb: (this: Server<T>, error: Error) => void): this
    /** 移除 'headers' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
    off(
      event: 'headers',
      cb: (
        this: Server<T>,
        headers: string[],
        request: IncomingMessage,
      ) => void,
    ): this
    /** 移除 'close' | 'listening' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
    off(event: 'close' | 'listening', cb: (this: Server<T>) => void): this
    /** 移除 string | symbol 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
    off(
      event: string | symbol,
      listener: (this: Server<T>, ...args: any[]) => void,
    ): this

    /** 注册持续监听回调：新连接事件，回调接收已升级连接和原始请求。 */
    addListener(
      event: 'connection',
      cb: (client: T, request: IncomingMessage) => void,
    ): this
    /** 注册持续监听回调：连接错误事件，回调接收原始错误。 */
    addListener(event: 'error', cb: (err: Error) => void): this
    /** 注册持续监听回调：升级响应头事件，回调可读取待发送头列表和请求。 */
    addListener(
      event: 'headers',
      cb: (headers: string[], request: IncomingMessage) => void,
    ): this
    /** 监听服务端关闭或开始监听的事件，回调不接收连接关闭码或消息参数。 */
    addListener(event: 'close' | 'listening', cb: () => void): this
    /** 注册持续监听回调：新连接事件，回调接收已升级连接和原始请求。 */
    addListener(
      event: string | symbol,
      listener: (...args: any[]) => void,
    ): this

    /** 移除 'connection' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
    removeListener(event: 'connection', cb: (client: T) => void): this
    /** 移除 'error' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
    removeListener(event: 'error', cb: (err: Error) => void): this
    /** 移除 'headers' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
    removeListener(
      event: 'headers',
      cb: (headers: string[], request: IncomingMessage) => void,
    ): this
    /** 移除 'close' | 'listening' 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
    removeListener(event: 'close' | 'listening', cb: () => void): this
    /** 移除 string | symbol 事件此前登记的同一回调，避免继续接收该监听器的通知。 */
    removeListener(
      event: string | symbol,
      listener: (...args: any[]) => void,
    ): this
  }

  /** 服务端类的值别名，可沿该名称调用构造器。 */
  const WebSocketServer: typeof Server
  /** 服务端类的命名空间别名，使值构造器和实例类型都可沿该名称引用。 */
  interface WebSocketServer extends Server {}
  /** 命名空间内的连接类值别名，与外层导出的 WebSocket 构造器对应。 */
  const WebSocket: typeof WebSocketAlias
  /** ws 连接实例的内联类型：提供帧收发、关闭和浏览器/Node 两种事件接口。 */
  interface WebSocket extends WebSocketAlias {}

  // WebSocket 双工流。
  /** 把 WebSocket 收发转换成 Node Duplex 流，options 传给流层。 */
  function createWebSocketStream(
    websocket: WebSocket,
    options?: DuplexOptions,
  ): Duplex
}

// export = WebSocket
export { WebSocket, WebSocketAlias }
