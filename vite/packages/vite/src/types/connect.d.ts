// 这是 Connect 3.4.0 的内联类型快照。Vite 只用它描述 middleware/server 公共表面，
// 实际请求调度仍由 connect 包完成；内联可避免把 @types/connect 变成用户依赖。
// MIT Licensed https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE

// Type definitions for connect v3.4.0
// Project: https://github.com/senchalabs/connect
// Definitions by: Maxime LUCE <https://github.com/SomaticIT>
//                 Evan Hahn <https://github.com/EvanHahn>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="node" />
import * as http from 'node:http'

/** Connect 请求、中间件和可调用 server 的内联公共类型集合。 */
export namespace Connect {
  /** 可挂到中间件栈的处理函数或 Node HTTP server。 */
  export type ServerHandle = HandleFunction | http.Server

  /** Connect 扩展的 Node 请求，额外保留进入挂载路径处理前的原 URL。 */
  export class IncomingMessage extends http.IncomingMessage {
    /** 在中间件挂载点裁剪 req.url 前保存的原请求地址。 */
    originalUrl?: http.IncomingMessage['url'] | undefined
  }

  /** 不传错误时推进普通中间件；传错误时转入错误处理链。 */
  export type NextFunction = (err?: any) => void

  /** 只接收请求和响应的处理器，可直接完成响应。 */
  export type SimpleHandleFunction = (
    req: IncomingMessage,
    res: http.ServerResponse,
  ) => void
  /** 接收 next 的普通中间件，决定结束响应或继续后续栈。 */
  export type NextHandleFunction = (
    req: IncomingMessage,
    res: http.ServerResponse,
    next: NextFunction,
  ) => void
  /** 四参数错误处理中间件，首项为前序处理器传入的错误。 */
  export type ErrorHandleFunction = (
    err: any,
    req: IncomingMessage,
    res: http.ServerResponse,
    next: NextFunction,
  ) => void
  /** Connect 支持的直接响应、next 链和错误处理函数的联合。 */
  export type HandleFunction =
    | SimpleHandleFunction
    | NextHandleFunction
    | ErrorHandleFunction

  /** 一个挂载点与其处理器组成的有序中间件栈项。 */
  export interface ServerStackItem {
    /** 用于筛选请求及裁剪局部 req.url 的挂载路径。 */
    route: string
    /** 路径命中时要调用的中间件或子 server。 */
    handle: ServerHandle
  }

  /** 同时是请求处理函数与 EventEmitter 的 Connect 应用。 */
  export interface Server extends NodeJS.EventEmitter {
    /** 作为 Node server 的 request listener 调度中间件；next 可接收栈结束后的结果。 */
    (req: http.IncomingMessage, res: http.ServerResponse, next?: Function): void

    /** 应用挂载到父应用时使用的路径信息。 */
    route: string
    /** 按 use 注册顺序执行的挂载项列表。 */
    stack: ServerStackItem[]

    /**
     * 把中间件 handle 挂载到给定 route，默认为 `/`。route 是中间件挂载点；不为
     * `/` 时，只有请求 pathname 包含该前缀才会执行。
     *
     * 例如挂载到 `/admin` 的函数会处理 `/admin` 与 `/admin/settings`，但不会处理
     * `/` 或 `/posts`。
     */
    use(fn: NextHandleFunction): Server
    /** 在根挂载点注册普通、直接响应或错误处理函数，返回应用以支持链式调用。 */
    use(fn: HandleFunction): Server
    /** 在指定路径注册接收 next 的中间件，命中后由该处理器决定是否继续。 */
    use(route: string, fn: NextHandleFunction): Server
    /** 在指定路径注册任一受支持处理函数，保留其普通或错误处理签名。 */
    use(route: string, fn: HandleFunction): Server

    /**
     * 处理服务器请求，并沿中间件栈向下传递。
     */
    handle(
      req: http.IncomingMessage,
      res: http.ServerResponse,
      next: Function,
    ): void

    /**
     * 监听连接，参数签名与 Node `http.Server#listen()` 一致。
     *
     * Connect server 本质是 JavaScript 函数，因此同时提供 HTTP/HTTPS 时可分别用
     * 原生 server 包装同一个 app：
     *
     *      var connect = require('connect')
     *        , http = require('http')
     *        , https = require('https');
     *
     *      var app = connect();
     *
     *      http.createServer(app).listen(80);
     *      https.createServer(options, app).listen(443);
     */
    listen(
      port: number,
      hostname?: string,
      backlog?: number,
      callback?: Function,
    ): http.Server
    /** 以端口及可选主机启动 HTTP server，回调在开始监听后执行。 */
    listen(port: number, hostname?: string, callback?: Function): http.Server
    /** 使用 Unix socket 或命名管道路径监听，返回创建的 HTTP server。 */
    listen(path: string, callback?: Function): http.Server
    /** 把既有监听句柄及开始监听回调传给 Node HTTP server。 */
    listen(handle: any, listeningListener?: Function): http.Server
  }
}
