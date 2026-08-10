import type { ViteHotContext } from '#types/hot'
import type { HMRLogger } from '../shared/hmr'
import type {
  DefineImportMetadata,
  SSRImportMetadata,
} from '../shared/ssrTransform'
import type {
  ExternalFetchResult,
  FetchFunctionOptions,
  FetchResult,
  ViteFetchResult,
} from '../shared/invokeMethods'
import type { ModuleRunnerTransport } from '../shared/moduleRunnerTransport'
import type { EvaluatedModuleNode, EvaluatedModules } from './evaluatedModules'
import type {
  ssrDynamicImportKey,
  ssrExportAllKey,
  ssrExportNameKey,
  ssrImportKey,
  ssrImportMetaKey,
  ssrModuleExportsKey,
} from './constants'
import type { InterceptorOptions } from './sourcemap/interceptor'

export type { DefineImportMetadata, SSRImportMetadata }

/** Runner 暴露给已转换模块的 `import.meta` 形状。 */
export interface ModuleRunnerImportMeta {
  /** 当前模块的规范 file URL。 */
  url: string
  /** 服务端静态替换后的公开环境变量视图。 */
  env: ImportMetaEnv
  /** 启用 HMR 时惰性创建的模块热更新上下文。 */
  hot?: ViteHotContext
  /** 当前模块所在目录的宿主路径。 */
  dirname: string
  /** 当前模块的宿主文件路径。 */
  filename: string
  /** 未在 transform 阶段静态替换时会显式失败的 glob 入口。 */
  glob: (...args: any[]) => any
  /** 相对指定父模块解析 specifier。 */
  resolve(specifier: string, parent?: string): string
  [key: string]: any
}

/**
 * `ssrTransform` 生成代码所依赖的执行协议。
 *
 * 属性名使用内部常量，既避免和用户变量冲突，也让不同求值器可以实现同一套导入、
 * 导出及 `import.meta` 语义。
 */
export interface ModuleRunnerContext {
  /** 当前模块稳定的 exports namespace。 */
  [ssrModuleExportsKey]: Record<string, any>
  /** 执行静态导入并记录导入元数据。 */
  [ssrImportKey]: (id: string, metadata?: DefineImportMetadata) => Promise<any>
  /** 执行运行时动态 import。 */
  [ssrDynamicImportKey]: (
    id: string,
    options?: ImportCallOptions,
  ) => Promise<any>
  /** 把另一个 namespace 的公开成员以 live binding 方式转出。 */
  [ssrExportAllKey]: (obj: any) => void
  /** 为具名导出登记惰性 getter。 */
  [ssrExportNameKey]: (name: string, getter: () => unknown) => void
  /** 当前模块可见的 import.meta 对象。 */
  [ssrImportMetaKey]: ModuleRunnerImportMeta
}

/** 将变换代码求值与宿主 external 模块加载解耦的执行器接口。 */
export interface ModuleEvaluator {
  /**
   * 求值器在转换代码前额外插入的行数，供 sourcemap 修正堆栈位置。
   */
  startOffset?: number
  /**
   * 执行经过 Vite 转换、仍由 Runner 管理依赖的模块。
   * @param context 转换代码使用的协议上下文
   * @param code 转换后的代码
   * @param module 当前模块节点
   */
  runInlinedModule(
    context: ModuleRunnerContext,
    code: string,
    module: Readonly<EvaluatedModuleNode>,
  ): Promise<any>
  /**
   * 通过宿主原生模块系统执行已 externalize 的模块。
   * @param file 外部模块的 file URL 或可导入标识
   */
  runExternalModule(file: string): Promise<any>
}

/** Runner 缓存中补齐规范 URL 与 ID 后的 fetchModule 结果。 */
export type ResolvedResult = (ExternalFetchResult | ViteFetchResult) & {
  /** 模块最初请求或服务端规范化后的 URL。 */
  url: string
  /** 用作模块图主键的规范解析 ID。 */
  id: string
}

/** 旧式直接 fetchModule 函数签名，用于兼容自定义集成。 */
export type FetchFunction = (
  id: string,
  importer?: string,
  options?: FetchFunctionOptions,
) => Promise<FetchResult>

/** Module Runner 的 HMR 日志配置。 */
export interface ModuleRunnerHmr {
  /**
   * 配置 HMR 日志器；设为 `false` 可关闭 HMR 日志。
   */
  logger?: false | HMRLogger
}

/** 创建 ModuleRunner 时注入的传输、缓存、求值辅助能力。 */
export interface ModuleRunnerOptions {
  /**
   * 与开发服务器通信的方法集合，负责取模块和收发 HMR 消息。
   */
  transport: ModuleRunnerTransport
  /**
   * 配置 sourcemap 拦截方式。若 `process.setSourceMapsEnabled` 可用则优先使用 `node`；
   * 否则默认通过 `prepareStackTrace` 覆盖 `Error.prepareStackTrace`。
   * 也可传入对象，定义如何读取未经过 Vite 处理的文件内容及 sourcemap。
   */
  sourcemapInterceptor?:
    | false
    | 'node'
    | 'prepareStackTrace'
    | InterceptorOptions
  /**
   * 关闭 HMR，或提供 HMR 配置。
   *
   * @default true
   */
  hmr?: boolean | ModuleRunnerHmr
  /**
   * 为每个模块创建 `import.meta` 对象。
   *
   * @default createDefaultImportMeta
   */
  createImportMeta?: (
    modulePath: string,
  ) => ModuleRunnerImportMeta | Promise<ModuleRunnerImportMeta>
  /**
   * 自定义模块缓存；未提供时，每个 ModuleRunner 实例创建独立缓存。
   */
  evaluatedModules?: EvaluatedModules
}

/** Module Runner 中 `import.meta.env` 的内建字段与用户扩展索引。 */
export interface ImportMetaEnv {
  [key: string]: any
  /** 部署 base URL。 */
  BASE_URL: string
  /** 当前 Vite mode。 */
  MODE: string
  /** 是否处于开发模式。 */
  DEV: boolean
  /** 是否处于生产模式。 */
  PROD: boolean
  /** 当前模块是否由 SSR 环境执行。 */
  SSR: boolean
}
