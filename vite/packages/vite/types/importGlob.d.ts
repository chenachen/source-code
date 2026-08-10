/** `string & {}` 保留任意查询字符串能力，同时不抹掉 `?raw`/`?url` 等编辑器补全。 */
type StringQueryType = `?${keyof KnownAsTypeMap}` | (string & {})
/** glob 导入接受的查询字符串简写或结构化查询参数。 */
type BaseQueryType = StringQueryType | Record<string, string | number | boolean>

/** 控制 `import.meta.glob` 的匹配范围、导入时机、导出选择与查询参数。 */
export interface ImportGlobOptions<
  Eager extends boolean,
  AsType extends string,
  QueryType extends BaseQueryType,
> {
  /**
   * 旧版资源导入类型。
   *
   * @deprecated 请改用 query，例如 `as: 'url'` 改为
   * `query: '?url', import: 'default'`。
   */
  as?: AsType
  /**
   * 是否生成静态立即导入；false 时返回动态导入函数。
   *
   * @default false
   */
  eager?: Eager
  /**
   * 只导入指定具名导出；设为 `default` 表示默认导出。
   */
  import?: string
  /**
   * 追加到每个匹配模块说明符上的自定义查询参数。
   */
  query?: QueryType
  /**
   * 是否同时搜索 node_modules 与 `.git` 等隐藏目录；开启可能显著扩大扫描范围。
   *
   * @default false
   */
  exhaustive?: boolean
  /**
   * 解析相对匹配路径时使用的基准目录。
   */
  base?: string
  /**
   * glob 匹配是否区分大小写。
   * @default true
   */
  caseSensitive?: boolean
}

/** 排除旧版 as 选项的重载辅助类型，避免 query/as 两套推导同时命中。 */
export type ImportGlobOptionsWithoutAs<
  Eager extends boolean,
  QueryType extends BaseQueryType,
> = Omit<ImportGlobOptions<Eager, string, QueryType>, 'as'> & {
  /** 禁止旧版 `as` 与基于 `query` 的重载同时参与类型推导。 */
  as?: never
}

/** 不预设 eager、as 与 query 字面量的通用 import.meta.glob 配置。 */
export type GeneralImportGlobOptions = ImportGlobOptions<
  boolean,
  string,
  BaseQueryType
>

/**
 * 当 tsconfig.lib 未包含 DOM 时提供空 Worker 声明；包含 DOM 的项目会通过接口合并
 * 得到完整 Worker 类型，不会与标准库声明冲突。
 */
declare global {
  /** DOM 库缺席时供 glob worker 查询返回值使用的可合并空壳。 */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Worker {}
}

/** Vite 已知资源模式到同步/异步导入值类型的映射。 */
export interface KnownAsTypeMap {
  /** `?raw` 查询返回模块文件的原始文本。 */
  raw: string
  /** `?url` 查询返回已解析的资源 URL。 */
  url: string
  /** `?worker` 查询返回 Worker 构造结果。 */
  worker: Worker
}

/** 将 raw/url/worker 资源模式映射为带问号的 query 字面量。 */
type KnownQueryTypeMap = {
  [K in keyof KnownAsTypeMap as `?${K}`]: KnownAsTypeMap[K]
}

/** `import.meta.glob` 的推导重载集合，根据 eager、query、as 与显式泛型决定值形态。 */
export interface ImportGlobFunction {
  /**
   * 以 glob 模式导入文件列表。
   *
   * 重载 1A：未提供泛型时，根据 eager 和 query 推导值类型。
   */
  <
    Eager extends boolean,
    Query extends BaseQueryType,
    T = Query extends keyof KnownQueryTypeMap
      ? KnownQueryTypeMap[Query]
      : unknown,
  >(
    glob: string | string[],
    options?: ImportGlobOptionsWithoutAs<Eager, Query>,
  ): (Eager extends true ? true : false) extends true
    ? Record<string, T>
    : Record<string, () => Promise<T>>
  /**
   * 以 glob 模式导入文件列表。
   *
   * 重载 1B：未提供泛型时，根据 eager 和旧版 as 推导（已弃用，请使用 query）。
   */
  <
    Eager extends boolean,
    As extends string,
    T = As extends keyof KnownAsTypeMap ? KnownAsTypeMap[As] : unknown,
  >(
    glob: string | string[],
    options?: ImportGlobOptions<Eager, As, BaseQueryType>,
  ): (Eager extends true ? true : false) extends true
    ? Record<string, T>
    : Record<string, () => Promise<T>>
  /**
   * 以 glob 模式导入文件列表。
   *
   * 重载 2：提供模块泛型且 eager 为 false，返回 Promise 工厂表。
   */
  <M>(
    glob: string | string[],
    options?: ImportGlobOptions<false, string, BaseQueryType>,
  ): Record<string, () => Promise<M>>
  /**
   * 以 glob 模式导入文件列表。
   *
   * 重载 3：提供模块泛型且 eager 为 true，返回立即模块值表。
   */
  <M>(
    glob: string | string[],
    options: ImportGlobOptions<true, string, BaseQueryType>,
  ): Record<string, M>
}
