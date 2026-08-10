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

export namespace Connect {
  export type ServerHandle = HandleFunction | http.Server

  export class IncomingMessage extends http.IncomingMessage {
    originalUrl?: http.IncomingMessage['url'] | undefined
  }

  export type NextFunction = (err?: any) => void

  export type SimpleHandleFunction = (
    req: IncomingMessage,
    res: http.ServerResponse,
  ) => void
  export type NextHandleFunction = (
    req: IncomingMessage,
    res: http.ServerResponse,
    next: NextFunction,
  ) => void
  export type ErrorHandleFunction = (
    err: any,
    req: IncomingMessage,
    res: http.ServerResponse,
    next: NextFunction,
  ) => void
  export type HandleFunction =
    | SimpleHandleFunction
    | NextHandleFunction
    | ErrorHandleFunction

  export interface ServerStackItem {
    route: string
    handle: ServerHandle
  }

  export interface Server extends NodeJS.EventEmitter {
    (req: http.IncomingMessage, res: http.ServerResponse, next?: Function): void

    route: string
    stack: ServerStackItem[]

    /**
     * 把中间件 handle 挂载到给定 route，默认为 `/`。route 是中间件挂载点；不为
     * `/` 时，只有请求 pathname 包含该前缀才会执行。
     *
     * 例如挂载到 `/admin` 的函数会处理 `/admin` 与 `/admin/settings`，但不会处理
     * `/` 或 `/posts`。
     */
    use(fn: NextHandleFunction): Server
    use(fn: HandleFunction): Server
    use(route: string, fn: NextHandleFunction): Server
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
    listen(port: number, hostname?: string, callback?: Function): http.Server
    listen(path: string, callback?: Function): http.Server
    listen(handle: any, listeningListener?: Function): http.Server
  }
}
