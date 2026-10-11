/** legacy 插件的浏览器目标、polyfill 注入与两类输出开关；仅构建时生成兼容产物。 */
export interface Options {
  /**
   * legacy Babel/browserslist 目标。未提供时读取项目 browserslist 配置，
   * 再回退到 last 2 versions and not dead, > 0.3%, Firefox ESR。
   */
  targets?: string | string[] | Record<string, string>
  /**
   * 现代输出的 browserslist 目标；默认 edge/chrome 105、firefox 106、Safari/iOS 16.4 及以上。
   * 同时转换为 Vite build.target，并用于现代 polyfill 使用分析。
   */
  modernTargets?: string | string[]
  /**
   * 默认自动分析 legacy polyfill；false 关闭自动分析，数组显式指定 core-js/regenerator 模块。
   */
  polyfills?: boolean | string[]
  /** 额外导入的 legacy polyfill 模块原样加入集合，不经过 core-js 名称转换。 */
  additionalLegacyPolyfills?: string[]
  /** 额外导入的现代 polyfill 模块原样加入集合。 */
  additionalModernPolyfills?: string[]
  /**
   * 默认不分析现代 polyfill；true 按使用分析，数组显式指定 core-js 模块。
   */
  modernPolyfills?: boolean | string[]
  /**
   * 默认生成 legacy 输出；不能与 renderModernChunks 同时为 false。
   */
  renderLegacyChunks?: boolean
  /**
   * 默认把 SystemJS 打包进 legacy polyfill；true 时由使用者另外提供运行时。
   */
  externalSystemJS?: boolean
  /**
   * 默认生成现代输出；关闭时 HTML 移除 module scripts 和 modulepreload links。
   */
  renderModernChunks?: boolean
  /**
   * @see https://babeljs.io/docs/assumptions
   *
   * Babel 转换假设，默认空对象；同时用于 polyfill 使用分析和 legacy 语法转换。
   */
  assumptions?: Record<string, boolean>
}
