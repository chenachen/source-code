import type {
  ErrorPayload,
  FullReloadPayload,
  PrunePayload,
  UpdatePayload,
} from './hmrPayload.js'

/** Vite HMR 通道内置事件名与其序列化 payload 的对应表，也允许用户声明合并扩展。 */
export interface CustomEventMap {
  /** 客户端应用一批模块更新前触发。 */
  'vite:beforeUpdate': UpdatePayload
  /** 客户端完成一批模块更新后触发。 */
  'vite:afterUpdate': UpdatePayload
  /** 客户端执行被移出模块图的清理回调前触发。 */
  'vite:beforePrune': PrunePayload
  /** 客户端执行整页重载前触发。 */
  'vite:beforeFullReload': FullReloadPayload
  /** 客户端收到服务端转换错误时触发。 */
  'vite:error': ErrorPayload
  /** 模块主动失效并请求继续向 importer 传播时携带传播起点。 */
  'vite:invalidate': InvalidatePayload
  /** HMR WebSocket 建立后暴露当前连接。 */
  'vite:ws:connect': WebSocketConnectionPayload
  /** HMR WebSocket 断开后暴露刚关闭的连接。 */
  'vite:ws:disconnect': WebSocketConnectionPayload
  /**
   * 浏览器把 console 或未捕获错误转发给开发服务器。
   * @internal
   */
  'vite:forward-console': ForwardConsolePayload
  /**
   * bundled-dev 客户端向服务端确认连接身份。
   * @internal
   */
  'vite:client-connected': {
    /** 页面客户端生成、用于选择该客户端专属 patch 的连接标识。 */
    clientId: string
  }
  /**
   * bundled-dev 客户端通知服务端无法继续热更新。
   * @internal
   */
  'vite:bundled-dev:reload-needed': {
    /** 触发整页重载回退的诊断原因。 */
    reason: string
  }

  /** 客户端连接建立后上报给服务端的生命周期事件。 */
  'vite:client:connect': undefined
  /** 客户端连接关闭后上报给服务端的生命周期事件。 */
  'vite:client:disconnect': undefined
}

/** HMR 连接建立或断开事件携带的底层 WebSocket。 */
export interface WebSocketConnectionPayload {
  /**
   * @experimental
   * 实验性暴露底层 WebSocket 实例，以收集真实使用场景；若没有合理用途可能移除。
   * 若插件依赖此字段，应反馈具体场景以推动稳定 API 设计。
   */
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  webSocket: WebSocket
}

/** import.meta.hot.invalidate 发出的失效原因与传播起点。 */
export interface InvalidatePayload {
  /** 主动调用 `invalidate()` 的模块 URL。 */
  path: string
  /** 模块提供的可选失效原因，用于传播诊断。 */
  message: string | undefined
  /** 本轮失效传播最初由哪个模块发起，用于检测传播回环。 */
  firstInvalidatedBy: string
}

/** 浏览器向服务端转发的 console、运行时错误和未处理 rejection 数据。 */
export type ForwardConsolePayload =
  | {
      /** 浏览器运行时错误事件的判别字段。 */
      type: 'error'
      /** 可序列化的错误名称、消息与可选堆栈。 */
      data: {
        /** Error 构造器名称。 */
        name: string
        /** 错误消息文本。 */
        message: string
        /** 浏览器提供时携带的错误堆栈。 */
        stack?: string
      }
    }
  | {
      /** 未处理 Promise rejection 的判别字段。 */
      type: 'unhandled-rejection'
      /** 从 rejection 原因规范化出的名称、消息与可选堆栈。 */
      data: {
        /** rejection 原因的错误名称。 */
        name: string
        /** rejection 原因的消息文本。 */
        message: string
        /** rejection 原因可用时携带的堆栈。 */
        stack?: string
      }
    }
  | {
      /** 普通 console 调用的判别字段。 */
      type: 'log'
      /** 已格式化的 console 级别与消息。 */
      data: {
        /** 原始 console 方法名，例如 log、warn 或 error。 */
        level: string
        /** 浏览器端格式化后的单条日志文本。 */
        message: string
      }
    }

/**
 * 由事件名推导内置 Vite 事件 payload；自定义字符串事件保持 any 以允许扩展。
 */
export type InferCustomEventPayload<T extends string> =
  T extends keyof CustomEventMap ? CustomEventMap[T] : any

/**
 * 内置事件名联合，同时保留可补全但不封闭的自定义字符串事件名。
 */
export type CustomEventName = keyof CustomEventMap | (string & {})
