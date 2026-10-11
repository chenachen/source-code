/**
 * https://github.com/rollup/plugins/blob/master/packages/commonjs/types/index.d.ts
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file at
 * https://github.com/rollup/plugins/blob/master/LICENSE
 */
/**
 * @rollup/plugin-commonjs 的内联配置类型快照。
 *
 * Vite 保留 build.commonjsOptions 的历史配置类型。当前构建使用 Rolldown 内置 CJS
 * 转换，未把这些字段传入 @rollup/plugin-commonjs；下面描述的是旧插件选项语义。
 */
export interface RollupCommonJSOptions {
  /**
   * 指定插件处理文件的 minimatch 规则。默认包含 `.cjs` 和 extensions 中的扩展名；
   * 设置后可进一步缩小范围。文件不含 ESM 专属语句，或开启
   * transformMixedEsModules 时，才会分析并转换。
   *
   * @default undefined
   */
  include?: string | RegExp | readonly (string | RegExp)[]
  /**
   * 指定要忽略文件的 minimatch 规则。默认忽略 extensions 与 `.cjs` 之外的扩展名，
   * 此项可再排除其他文件；同时参见 include。
   *
   * @default undefined
   */
  exclude?: string | RegExp | readonly (string | RegExp)[]
  /**
   * 无扩展名导入按此顺序尝试 `.js` 之外的扩展名；非 JavaScript 文件必须先由其他
   * 插件转译。
   *
   * @default [ '.js' ]
   */
  extensions?: ReadonlyArray<string>
  /**
   * 为 true 时不处理源码中的 global 引用。
   *
   * @default false
   */
  ignoreGlobal?: boolean
  /**
   * 为 false 时跳过 CommonJS 模块 sourcemap，可提升性能。
   *
   * @default true
   */
  sourceMap?: boolean
  /**
   * 部分 require 无法静态解析为 import。为 false 时，遇到此类调用会直接抛错；使用
   * dynamicRequireTargets 时，无法命中目标也会抛错。为 true 时保留原 require，
   * 或把它作为动态目标解析失败后的兜底。
   *
   * @default false
   */
  ignoreDynamicRequires?: boolean
  /**
   * 是否转换同时包含 ESM import 与 CommonJS require 的混合模块。true 会把 require
   * 转为 import；false 保留 require，适合依赖环境探测或 Electron 等特殊 require
   * 语义的代码。另见 ignore。
   *
   * @default false
   */
  transformMixedEsModules?: boolean
  /**
   * 控制 require 是否严格保留 CommonJS 的首次调用求值语义。默认提升为文件顶部的
   * import，产物高效但可能改变副作用顺序，循环 require 尤其容易依赖惰性执行。
   *
   * true 把所有 CommonJS 文件包装为首次 require 时执行的函数，更接近 Node 语义，
   * 但会增加产物体积和运行成本。
   *
   * 默认 `auto` 只包装 CommonJS 循环中的文件，其余仍提升；这是多数项目的推荐值。
   *
   * false 完全禁止包装并提升全部文件，循环依赖常会因此出错。
   *
   * 也可传 minimatch 规则，只包装需要严格 require 语义的文件子集。
   *
   * `debug` 行为同 auto，但构建后会警告列出被包装 id，便于提炼匹配规则。
   *
   * @default "auto"
   */
  strictRequires?: boolean | string | RegExp | readonly (string | RegExp)[]
  /**
   * 指定必须保留 require、不做转换的模块 id 数组或判断函数。
   *
   * @default []
   */
  ignore?: ReadonlyArray<string> | ((id: string) => boolean)
  /**
   * 控制 try/catch 内的 require。此类调用通常表示可选依赖；若转成静态 import，会
   * 被提升到 try/catch 外并失去容错语义。
   *
   * - true：默认，保留 try 内全部 require；
   * - false：忽略 try/catch 边界并转换全部 require；
   * - remove：删除 try 内全部 require；
   * - string[]：只保留指定 id；
   * - 函数：逐 id 返回保留、转换或 remove。
   *
   * @default true
   */
  ignoreTryCatch?:
    | boolean
    | 'remove'
    | ReadonlyArray<string>
    | ((id: string) => boolean | 'remove')
  /**
   * 控制外部依赖按 ESM 还是 CommonJS 渲染。默认假定全部外部依赖是 CommonJS，
   * 因而使用默认导入以兼容 Node 的 CJS 互操作。
   *
   * true 假定全部外部依赖是 ESM，并遵循 requireReturnsDefault；未设置后者时使用
   * namespace import。
   *
   * 也可传 id 数组或判断函数，只把部分外部依赖视为 ESM。
   *
   * @default false
   */
  esmExternals?: boolean | ReadonlyArray<string> | ((id: string) => boolean)
  /**
   * 控制 CommonJS 文件 require ESM 时返回什么；启用 esmExternals 后也作用于外部
   * 模块。默认生成 namespace import：
   *
   * ```js
   * // 输入
   * const foo = require('foo');
   *
   * // 输出
   * import * as foo from 'foo';
   * ```
   *
   * 可全局设置以下值，或通过函数逐模块决定：
   *
   * - false：默认返回 namespace，并添加 `__esModule: true` 兼容标记；
   * - namespace：返回 namespace 但不加标记，产物更精简；
   * - auto：只有“仅默认导出”模块返回 default，其余返回 namespace；
   * - preferred：只要存在默认导出就优先返回 default；
   * - true：不检查是否存在，始终尝试返回 default；缺失时可能在构建期报错，但无需
   *   额外互操作 helper。
   *
   * 函数形式会为每个被 require 的 ESM/外部依赖传入对应 id，可返回不同策略。
   *
   * @default false
   */
  requireReturnsDefault?:
    | boolean
    | 'auto'
    | 'preferred'
    | 'namespace'
    | ((id: string) => boolean | 'auto' | 'preferred' | 'namespace')

  /**
   * 控制默认导出是否同时代表 module.exports。
   *
   * @default "auto"
   */
  defaultIsModuleExports?: boolean | 'auto' | ((id: string) => boolean | 'auto')
  /**
   * 为动态 require 或循环依赖模块模拟接近 Node 的 CommonJS 环境，并为这些模块
   * 自动启用 strictRequires。
   *
   * 极端情况下产物可能包含绝对路径。插件会尽量避免泄露本机目录，但目标离项目根
   * 很远时，可能需要把公共绝对前缀替换为 `/`。
   */
  dynamicRequireTargets?: string | ReadonlyArray<string>
  /**
   * dynamicRequireTargets 的公共根目录，用于缩短产物路径。设置得过高（如 `/`）会
   * 生成冗长路径并可能暴露本机目录名；默认使用当前工作目录。
   */
  dynamicRequireRoot?: string
}
