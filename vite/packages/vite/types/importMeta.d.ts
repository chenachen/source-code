// 本文件通过声明合并扩展内置 ImportMeta，因此不能包含任何顶层 import；否则会变成
// 外部模块，下面的接口也就不再进入全局作用域。
// <https://www.typescriptlang.org/docs/handbook/declaration-merging.html#module-augmentation>

// ViteTypeOptions 是留给用户声明合并的类型开关，行为由 __tests_dts__/typeOptions.ts
// 验证；添加 strictImportMetaEnv 键后，ImportMetaEnv 不再允许任意环境变量名。
/** 用户可通过声明合并加入类型开关；`strictImportMetaEnv` 会关闭环境变量索引兜底。 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 刻意允许用户扩展
interface ViteTypeOptions {
  // strictImportMetaEnv: unknown
}

/** 严格模式开启时移除 string 索引签名，否则允许用户访问自定义环境变量。 */
type ImportMetaEnvFallbackKey =
  'strictImportMetaEnv' extends keyof ViteTypeOptions ? never : string

/** Vite 始终注入的内置环境字段，加上由类型选项控制的用户字段兜底。 */
interface ImportMetaEnv extends Record<ImportMetaEnvFallbackKey, any> {
  /** 已解析的公共基础路径。 */
  BASE_URL: string
  /** 当前运行模式名称。 */
  MODE: string
  /** config.isProduction 的反值，与 MODE 的自定义名称独立。 */
  DEV: boolean
  /** config.isProduction 的值，由 NODE_ENV 等配置解析结果决定。 */
  PROD: boolean
  /** 当前转换环境的 consumer 是否为 server。 */
  SSR: boolean
}

/** Vite 为浏览器模块提供的 HMR、环境变量和 glob 导入能力。 */
interface ImportMeta {
  /** 当前模块的完整 URL，由 JavaScript 运行时提供。 */
  url: string

  /** 开发模式下当前模块的 HMR context；生产构建中通常不存在。 */
  readonly hot?: import('./hot.js').ViteHotContext

  /** 经 Vite 静态替换或运行时注入的环境变量。 */
  readonly env: ImportMetaEnv

  /** 在开发/构建源码转换时展开 glob 匹配并生成导入表的宏函数。 */
  glob: import('./importGlob.js').ImportGlobFunction
}
