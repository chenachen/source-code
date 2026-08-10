/** 动态 import 变量插件透传配置；匹配项决定哪些模块参与变量模式转换。 */
export interface RollupDynamicImportVarsOptions {
  /**
   * 要处理的文件；空数组表示不额外限制，默认包含全部候选文件。
   * @default []
   */
  include?: string | RegExp | (string | RegExp)[]
  /**
   * 要排除的文件；默认不额外排除。
   * @default []
   */
  exclude?: string | RegExp | (string | RegExp)[]
  /**
   * @deprecated 该选项已不产生任何效果，将在未来版本移除。
   */
  warnOnError?: boolean
}
