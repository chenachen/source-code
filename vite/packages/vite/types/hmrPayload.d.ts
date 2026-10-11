/** @deprecated 请改用 HotPayload。 */
export type HMRPayload = HotPayload
/** 服务端与运行端 transport 之间传输的完整 HMR 协议联合类型。 */
export type HotPayload =
  | ConnectedPayload
  | PingPayload
  | UpdatePayload
  | BundledDevUpdatePayload
  | FullReloadPayload
  | CustomPayload
  | ErrorPayload
  | PrunePayload

/** 服务端确认 HMR transport 已可收发消息的握手 payload。 */
export interface ConnectedPayload {
  /** 连接握手消息的判别字段。 */
  type: 'connected'
}

/** HMR transport 保活消息；接收端无需触发模块更新。 */
export interface PingPayload {
  /** 保活消息的判别字段。 */
  type: 'ping'
}

/** unbundled 开发模式下由服务端计算好边界的一批 HMR 更新。 */
export interface UpdatePayload {
  /** 边界更新消息的判别字段。 */
  type: 'update'
  /** 按本轮失效传播结果生成的 JS/CSS 更新边界。 */
  updates: Update[]
}

/**
 * Full-bundle-mode 更新通知；服务端只发送 changedIds 和 patch chunk，客户端自行计算 HMR 边界。
 */
export interface BundledDevUpdatePayload {
  /** bundled-dev patch 消息的判别字段。 */
  type: 'bundled-dev-update'
  /** 本轮变更或失效、需要客户端重新计算 HMR 边界的模块 ID。 */
  changedIds: string[]
  /** 当前客户端专属 HMR patch chunk URL。 */
  url: string
  /** 当前客户端单调递增的更新序号。 */
  seq: number
}

/** unbundled dev 的单个传播边界：path 执行 accept，acceptedPath 是需重新导入的依赖。 */
export interface Update {
  /** 决定客户端走模块重新导入或 CSS 链接替换流程。 */
  type: 'js-update' | 'css-update'
  /** 接管本次更新并登记 accept 回调的边界模块 URL。 */
  path: string
  /** 边界回调需要重新导入或替换的依赖 URL。 */
  acceptedPath: string
  /** 本轮更新版本戳，附加到请求 URL 以绕过旧模块缓存。 */
  timestamp: number
  /**
   * 重新导入时是否必须追加内部 `import` 查询标记。
   * @internal
   */
  explicitImportRequired?: boolean
  /**
   * 更新边界是否位于循环导入链中，用于客户端给出失效提示。
   * @internal
   */
  isWithinCircularImport?: boolean
  /**
   * 本轮主动失效传播的初始模块 URL。
   * @internal
   */
  firstInvalidatedBy?: string
  /** 可携带的失效模块列表；本版本 Vite 源码未填充或读取该字段。 @internal */
  invalidates?: string[]
}

/** 通知客户端清理不再被当前导入关系引用的模块；服务端图节点可以保留。 */
export interface PrunePayload {
  /** 模块清理消息的判别字段。 */
  type: 'prune'
  /** 应执行 prune 回调并删除持久热更新数据的模块 URL。 */
  paths: string[]
}

/** 通知客户端无法由 HMR 边界接管，需要回退到整页重载。 */
export interface FullReloadPayload {
  /** 整页重载消息的判别字段。 */
  type: 'full-reload'
  /** 触发更新的页面路径；提供 HTML 路径时客户端只重载匹配页面。 */
  path?: string
  /**
   * 触发此次重载的源文件绝对路径，供服务端模块运行器清理入口。
   * @internal
   */
  triggeredBy?: string
  /**
   * 设置后只有 bundling-fallback 页面执行 reload，其他页面忽略该消息。
   * @internal
   */
  ifFallback?: boolean
}

/** import.meta.hot.send/on 以及内部 invoke/生命周期事件共用的自定义消息信封。 */
export interface CustomPayload {
  /** 自定义事件消息的判别字段。 */
  type: 'custom'
  /** 与 `CustomEventMap` 或用户扩展对应的事件名。 */
  event: string
  /** 由事件发送方提供、经 transport 序列化的可选数据。 */
  data?: any
}

/** 可序列化的插件/转换错误；浏览器可渲染 overlay，其他运行端可转交 logger。 */
export interface ErrorPayload {
  /** 转换错误消息的判别字段。 */
  type: 'error'
  /** 从插件或转换流水线错误序列化出的可展示信息。 */
  err: {
    [name: string]: any
    /** 面向用户的错误摘要。 */
    message: string
    /** 服务端捕获的错误堆栈。 */
    stack: string
    /** 发生错误的模块 ID。 */
    id?: string
    /** 带定位标记的源码片段。 */
    frame?: string
    /** 抛出错误的插件名称。 */
    plugin?: string
    /** 插件附带的相关源码文本。 */
    pluginCode?: string
    /** 插件报告的结构化源码位置。 */
    loc?: {
      /** 插件提供时携带的源文件名。 */
      file?: string
      /** 错误所在行号。 */
      line: number
      /** 错误所在列号。 */
      column: number
    }
  }
}
