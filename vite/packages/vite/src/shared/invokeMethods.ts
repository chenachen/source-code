/** Runner 请求服务端模块时携带的缓存与求值器位置信息。 */
export interface FetchFunctionOptions {
  /** Runner 是否已缓存该 URL；服务端可据此只返回 cache 确认。 */
  cached?: boolean
  /** 求值器在代码前插入的行数，用于给 sourcemap mappings 增加偏移。 */
  startOffset?: number
}

/** `fetchModule` 跨 transport 返回的三种互斥结果。 */
export type FetchResult =
  | CachedFetchResult
  | ExternalFetchResult
  | ViteFetchResult

/** 服务端确认 Runner 缓存仍有效的轻量结果。 */
export interface CachedFetchResult {
  /**
   * Runner 已有缓存时，确认服务端一侧也未失效，无需重复传输代码。
   */
  cache: true
}

/** 交由宿主模块系统加载的 external 结果。 */
export interface ExternalFetchResult {
  /**
   * externalized 模块地址，磁盘模块通常以 `file://` 开头。
   * 默认交给宿主的动态 `import()`，不再经过 Vite transform 与 Runner 内联求值。
   */
  externalize: string
  /**
   * 模块类别，用于校验静态导入形态；例如命名导出不存在时模拟 Node 的错误。
   */
  type: 'module' | 'commonjs' | 'builtin' | 'network'
}

/** 由 Vite 转换并交给 Runner 内联求值的模块结果。 */
export interface ViteFetchResult {
  /**
   * 交给 Vite Runner 求值的变换代码；默认包进 async function。
   */
  code: string
  /**
   * 模块磁盘路径，用来构造 `import.meta.url/filename`；虚拟模块为 `null`。
   */
  file: string | null
  /**
   * 服务端模块图中的已解析模块 ID。
   */
  id: string
  /**
   * import 请求使用的规范化模块 URL。
   */
  url: string
  /**
   * 服务端本轮重新变换了模块，Runner 必须丢弃旧求值状态。
   */
  invalidate: boolean
}

/** Runner → server 的 RPC 请求包；有唯一后缀时需要等待响应。 */
export type InvokeSendData<
  T extends keyof InvokeMethods = keyof InvokeMethods,
> = {
  /** 要调用的白名单方法名。 */
  name: T
  /** `'send'` 表示无需按 ID 关联响应；`send:<id>` 表示普通 RPC。 */
  id: 'send' | `send:${string}`
  /** 按方法签名序列化的参数元组。 */
  data: Parameters<InvokeMethods[T]>
}

/** Server → Runner 的 RPC 响应包，以同一个 ID 携带 result 或序列化 error。 */
export type InvokeResponseData<
  T extends keyof InvokeMethods = keyof InvokeMethods,
> = {
  /** 与请求一致的方法名，便于诊断错配。 */
  name: T
  /** `'response'` 表示无关联 ID；`response:<id>` 对应一个等待中的请求。 */
  id: 'response' | `response:${string}`
  /** 成功结果与错误互斥的响应内容。 */
  data:
    | {
        /** 远端方法成功返回的值。 */
        result: Awaited<ReturnType<InvokeMethods[T]>>
        /** 成功响应不携带错误。 */
        error?: undefined
      }
    | {
        /** 失败响应不携带结果。 */
        result?: undefined
        /** 可跨 transport 序列化的远端异常。 */
        error: any
      }
}

/** transport 允许跨运行时调用的服务端方法白名单及其类型协议。 */
export type InvokeMethods = {
  /** 解析、变换或 externalize 一个模块。 */
  fetchModule: (
    id: string,
    importer?: string,
    options?: FetchFunctionOptions,
  ) => Promise<FetchResult>

  /** 返回可序列化的 builtin 字符串与正则规则。 */
  getBuiltins: () => Promise<
    Array<
      | {
          /** 字符串规则判别项。 */
          type: 'string'
          /** 要精确匹配的 builtin 标识。 */
          value: string
        }
      | {
          /** 正则规则判别项。 */
          type: 'RegExp'
          /** RegExp source。 */
          source: string
          /** RegExp flags。 */
          flags: string
        }
    >
  >
}
