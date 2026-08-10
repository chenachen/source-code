import path from 'node:path'
import colors from 'picocolors'
import type {
  ExternalOption,
  InputOption,
  InternalModuleFormat,
  LogLevel,
  LogOrStringHandler,
  MinimalPluginContext,
  ModuleFormat,
  OutputAsset,
  OutputBundle,
  OutputChunk,
  OutputOptions,
  PluginContext,
  RenderedChunk,
  RolldownBuild,
  RolldownOptions,
  RolldownOutput,
  RolldownWatcher,
  RollupError,
  RollupLog,
  WarningHandlerWithDefault,
  WatcherOptions,
} from 'rolldown'
import { viteLoadFallbackPlugin as nativeLoadFallbackPlugin } from 'rolldown/experimental'
import { esmExternalRequirePlugin } from 'rolldown/plugins'
import type { EsbuildTarget } from '#types/internal/esbuildOptions'
import type { RollupCommonJSOptions } from '#dep-types/commonjs'
import type { RollupDynamicImportVarsOptions } from '#dep-types/dynamicImportVars'
import type { AssetMetadata, ChunkMetadata } from '#types/metadata'
import {
  DEFAULT_ASSETS_INLINE_LIMIT,
  ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET,
  ROLLUP_HOOKS,
  VERSION,
} from './constants'
import type {
  EnvironmentOptions,
  InlineConfig,
  ResolvedConfig,
  ResolvedEnvironmentOptions,
} from './config'
import { resolveConfig } from './config'
import type { PartialEnvironment } from './baseEnvironment'
import { buildReporterPlugin } from './plugins/reporter'
import { buildEsbuildPlugin } from './plugins/esbuild'
import { type TerserOptions, terserPlugin } from './plugins/terser'
import {
  arraify,
  asyncFlatten,
  createDebugger,
  displayTime,
  getPkgName,
  joinUrlSegments,
  mergeConfig,
  mergeWithDefaults,
  partialEncodeURIPath,
  setupRollupOptionCompat,
  unique,
} from './utils'
import { perEnvironmentPlugin } from './plugin'
import { manifestPlugin } from './plugins/manifest'
import { type Logger } from './logger'
import { buildImportAnalysisPlugin } from './plugins/importAnalysisBuild'
import { ssrManifestPlugin } from './ssr/ssrManifestPlugin'
import { findNearestMainPackageData, findNearestPackageData } from './packages'
import type { PackageCache } from './packages'
import {
  convertToWatcherOptions,
  getResolvedOutDirs,
  resolveChokidarOptions,
  resolveEmptyOutDir,
} from './watch'
import { webWorkerPostPlugin } from './plugins/worker'
import { getHookHandler } from './plugins'
import { BaseEnvironment } from './baseEnvironment'
import type { MinimalPluginContextWithoutEnvironment, Plugin } from './plugin'
import type { RollupPluginHooks } from './typeUtils'
import { type LicenseOptions, licensePlugin } from './plugins/license'
import {
  BasicMinimalPluginContext,
  basePluginContextMeta,
} from './server/pluginContainer'
import {
  isFutureDeprecationEnabled,
  warnFutureDeprecation,
} from './deprecations'
import { prepareOutDirPlugin } from './plugins/prepareOutDir'
import type { Environment } from './environment'

/** 单个构建 Environment 的输出、转换、资源与监听行为配置。 */
export interface BuildEnvironmentOptions {
  /**
   * 兼容性转换目标。转换由 esbuild 执行，最低支持 es2015；这里只转换语法，
   * 不注入 polyfill。
   *
   * 默认 `'baseline-widely-available'`：面向 2026-01-01 已进入 Baseline
   * Widely Available 的浏览器。
   * (Chrome 111+, Edge 111+, Firefox 114+, Safari 16.4+).
   *
   * 特殊值 `'esnext'` 只执行满足压缩器兼容性的最小转换。
   *
   * 自定义 target 详见 https://esbuild.github.io/api/#target 和
   * https://esbuild.github.io/content-types/#javascript。
   * @default 'baseline-widely-available'
   */
  target?: 'baseline-widely-available' | EsbuildTarget | false
  /**
   * 是否注入 module preload polyfill；不适用于库模式。
   * @default true
   * @deprecated 请改用 `modulePreload.polyfill`
   */
  polyfillModulePreload?: boolean
  /**
   * 配置 module preload；不适用于库模式。
   * @default true
   */
  modulePreload?: boolean | ModulePreloadOptions
  /**
   * 相对 `root` 的构建输出目录；目录存在时可在构建前清空。
   * @default 'dist'
   */
  outDir?: string
  /**
   * 相对 `outDir` 的 JS、CSS、图片等构建资源目录。
   * @default 'assets'
   */
  assetsDir?: string
  /**
   * 小于该字节数的静态资源会以内联字符串输出。也可传回调显式允许/拒绝某个文件；
   * 回调返回 `undefined` 时继续使用默认判断。
   *
   * 默认 `4096`（4 KiB），设为 `0` 可禁用基于大小的内联。
   * @default 4096
   */
  assetsInlineLimit?:
    | number
    | ((filePath: string, content: Buffer) => boolean | undefined)
  /**
   * 是否拆分 CSS。启用时，异步 chunk 对应的 CSS 会独立输出并在 chunk 加载时获取。
   * @default true
   */
  cssCodeSplit?: boolean
  /**
   * CSS 压缩可使用独立 target。某些运行时支持现代 JavaScript，但 CSS 能力较弱，
   * 例如不支持 `#RGBA` 的 Android 微信 WebView，此时不能直接复用 JS target。
   * @default target
   */
  cssTarget?: EsbuildTarget | false
  /**
   * 单独覆盖 CSS 压缩器，不再跟随 `build.minify`，以便分别配置 JS/CSS。
   * @default 客户端为 'lightningcss'；build.minify 关闭时为 false
   */
  cssMinify?: boolean | 'lightningcss' | 'esbuild'
  /**
   * `true` 生成独立 sourcemap；`inline` 把 map 作为 data URI 附在输出末尾；
   * `hidden` 同样生成独立文件，但不在 bundle 中写 sourcemap 注释。
   * @default false
   */
  sourcemap?: boolean | 'inline' | 'hidden'
  /**
   * 设为 `false` 关闭压缩，或指定 `'oxc'`、`'terser'`、`'esbuild'`。
   * @default 客户端构建为 'oxc'，SSR 构建为 false
   */
  minify?: boolean | 'oxc' | 'terser' | 'esbuild'
  /**
   * Terser 选项：
   * https://terser.org/docs/api-reference#minify-options
   *
   * 额外支持 `maxWorkers` 指定最大 worker 数，默认为 CPU 数减一。
   */
  terserOptions?: TerserOptions
  /**
   * 是否使用 import map 优化 chunk 缓存效率。
   * @default false
   * @experimental
   */
  chunkImportMap?: boolean
  /**
   * `rolldownOptions` 的兼容别名。
   * @deprecated 请改用 `rolldownOptions`。
   */
  rollupOptions?: RolldownOptions
  /**
   * 与 Vite 内部 Rolldown 选项合并。
   * https://rolldown.rs/reference/Interface.RolldownOptions
   */
  rolldownOptions?: RolldownOptions
  /**
   * 原用于传给 `@rollup/plugin-commonjs` 的选项。
   * @deprecated 当前无效，未来会移除。
   */
  commonjsOptions?: RollupCommonJSOptions
  /**
   * 传给动态 import variables 插件的选项。
   */
  dynamicImportVarsOptions?: RollupDynamicImportVarsOptions
  /**
   * 是否把 bundle 写入磁盘。
   * @default true
   */
  write?: boolean
  /**
   * 写入前是否清空 outDir。
   * @default outDir 位于项目 root 内时为 true
   */
  emptyOutDir?: boolean | null
  /**
   * 写入时是否把 public 目录复制到 outDir。
   * @default true
   */
  copyPublicDir?: boolean
  /**
   * 是否输出包含所有被打包依赖许可证的 `.vite/license.md`；传对象可自定义文件名。
   * @default false
   */
  license?: boolean | LicenseOptions
  /**
   * 是否在输出目录生成 `.vite/manifest.json`，把无 hash 源文件名映射到带 hash
   * 的构建文件。适用于由后端或框架自行生成 HTML 的场景。
   *
   * 示例：
   *
   * ```json
   * {
   *   "main.js": {
   *     "file": "main.68fe3fad.js",
   *     "css": "main.e6b63442.css",
   *     "imports": [...],
   *     "dynamicImports": [...]
   *   }
   * }
   * ```
   * @default false
   */
  manifest?: boolean | string
  /**
   * 启用库模式；按适合发布库的默认配置生成 ESM/CJS/UMD 等格式。
   * @default false
   */
  lib?: LibraryOptions | false
  /**
   * 生成面向 SSR 的构建；入口可通过该字符串、顶层 input 或 rolldownOptions.input 指定。
   * @default false
   */
  ssr?: boolean | string
  /**
   * 生成 SSR manifest，供生产运行时确定样式链接与资源 preload 指令。
   * @default false
   */
  ssrManifest?: boolean | string
  /**
   * SSR 构建中是否发射资产。
   * @default false
   */
  ssrEmitAssets?: boolean
  /**
   * 当前 Environment 构建时是否发射资产。框架可设置
   * `environments.ssr.build.emitAssets`；默认客户端为 true，其他环境为 false。
   */
  emitAssets?: boolean
  /**
   * 设为 false 不统计压缩后的 chunk 大小，可略微提升构建速度。
   * @default true
   */
  reportCompressedSize?: boolean
  /**
   * 调整 chunk 体积警告阈值（kB）。
   * @default 500
   */
  chunkSizeWarningLimit?: number
  /**
   * Rolldown watch 选项。
   * https://rollupjs.org/configuration-options/#watch
   * @default null
   */
  watch?: WatcherOptions | null
  /**
   * 创建 BuildEnvironment 实例；框架可据此提供自定义构建环境。
   */
  createEnvironment?: (
    name: string,
    config: ResolvedConfig,
  ) => Promise<BuildEnvironment> | BuildEnvironment
}

/** 顶层 build 配置的兼容别名，语义与 Environment 构建选项一致。 */
export type BuildOptions = BuildEnvironmentOptions

/** 库模式的入口、全局名、输出格式与文件命名规则。 */
export interface LibraryOptions {
  /**
   * 库入口；省略时使用顶层 `input`。
   */
  entry?: InputOption
  /**
   * 暴露的全局变量名；formats 包含 UMD 或 IIFE 时必填。
   */
  name?: string
  /**
   * 输出格式。单入口默认 `['es', 'umd']`，多入口默认 `['es', 'cjs']`；
   * UMD/IIFE 不支持多入口。
   * @default ['es', 'umd']
   */
  formats?: LibraryFormats[]
  /**
   * 库文件名。默认取项目 package.json 的 name，也可用函数按 format/entryName 生成。
   */
  fileName?: string | ((format: ModuleFormat, entryName: string) => string)
  /**
   * 库导入 CSS 时的输出文件名。默认复用字符串形式的 `build.lib.fileName`，
   * 否则回退 package.json 的 name。
   */
  cssFileName?: string
}

/** Vite 库模式当前支持的模块封装格式。 */
export type LibraryFormats = 'es' | 'cjs' | 'umd' | 'iife' // | 'system'

/** module preload polyfill 与动态依赖列表的用户配置。 */
export interface ModulePreloadOptions {
  /**
   * 是否注入 module preload polyfill；不适用于库模式。
   * @default true
   */
  polyfill?: boolean
  /**
   * 自定义某个动态 import 应 preload 的依赖列表。
   * @experimental
   */
  resolveDependencies?: ResolveModulePreloadDependenciesFn
}
/** 归一化后的 module preload 行为，可直接供构建插件使用。 */
export interface ResolvedModulePreloadOptions {
  /** 是否在 HTML 入口注入 modulepreload polyfill。 */
  polyfill: boolean
  /** 可选的依赖列表重写回调。 */
  resolveDependencies?: ResolveModulePreloadDependenciesFn
}

/** 按宿主 chunk/HTML 上下文重写单个动态导入的预加载依赖。 */
export type ResolveModulePreloadDependenciesFn = (
  filename: string,
  deps: string[],
  context: {
    /** 发起动态导入或引用资源的宿主模块 ID。 */
    hostId: string
    /** 宿主是 HTML 入口还是 JavaScript chunk。 */
    hostType: 'html' | 'js'
  },
) => string[]

/** 单个 Environment 已补齐默认值的构建配置。 */
export interface ResolvedBuildEnvironmentOptions extends Required<
  Omit<BuildEnvironmentOptions, 'polyfillModulePreload'>
> {
  /** 禁用预加载，或使用已解析的 polyfill/依赖回调。 */
  modulePreload: false | ResolvedModulePreloadOptions
}

/** 顶层兼容 BuildOptions 已补齐默认值后的类型。 */
export interface ResolvedBuildOptions extends Required<
  Omit<BuildOptions, 'polyfillModulePreload'>
> {
  /** 禁用预加载，或使用已解析的 polyfill/依赖回调。 */
  modulePreload: false | ResolvedModulePreloadOptions
}

/** 与消费方无关、可安全冻结复用的构建默认值。 */
const _buildEnvironmentOptionsDefaults = Object.freeze({
  target: 'baseline-widely-available',
  /** @deprecated */
  polyfillModulePreload: true,
  modulePreload: true,
  outDir: 'dist',
  assetsDir: 'assets',
  assetsInlineLimit: DEFAULT_ASSETS_INLINE_LIMIT,
  // cssCodeSplit
  // cssTarget
  // cssMinify
  sourcemap: false,
  // minify
  terserOptions: {},
  chunkImportMap: false,
  rolldownOptions: {},
  commonjsOptions: {
    include: [/node_modules/],
    extensions: ['.js', '.cjs'],
  },
  dynamicImportVarsOptions: {
    exclude: [/node_modules/],
  },
  write: true,
  emptyOutDir: null,
  copyPublicDir: true,
  license: false,
  manifest: false,
  lib: false,
  // ssr
  ssrManifest: false,
  ssrEmitAssets: false,
  // emitAssets
  reportCompressedSize: true,
  chunkSizeWarningLimit: 500,
  watch: null,
  // createEnvironment
} satisfies BuildEnvironmentOptions)
/** 对外暴露的只读构建默认值，供配置合并和生态检查。 */
export const buildEnvironmentOptionsDefaults: Readonly<
  Partial<BuildEnvironmentOptions>
> = _buildEnvironmentOptionsDefaults

/**
 * 把单个 Environment 的原始 build 配置归一化为无歧义的完整选项。
 *
 * 默认值依赖 consumer、bundled-dev、lib 与 SSR webworker；同时建立旧 Rollup
 * 选项别名，使后续构建只读取 `environment.config.build` 即可。
 */
export function resolveBuildEnvironmentOptions(
  raw: BuildEnvironmentOptions,
  logger: Logger,
  consumer: 'client' | 'server' | undefined,
  isBundledDev: boolean,
  input?: InputOption,
  isSsrTargetWebworkerEnvironment?: boolean,
): ResolvedBuildEnvironmentOptions {
  const deprecatedPolyfillModulePreload = raw.polyfillModulePreload
  const { polyfillModulePreload, ...rest } = raw
  raw = rest
  if (deprecatedPolyfillModulePreload !== undefined) {
    logger.warn(
      'polyfillModulePreload is deprecated. Use modulePreload.polyfill instead.',
    )
  }
  if (
    deprecatedPolyfillModulePreload === false &&
    raw.modulePreload === undefined
  ) {
    raw.modulePreload = { polyfill: false }
  }

  const merged = mergeWithDefaults(
    {
      ..._buildEnvironmentOptionsDefaults,
      cssCodeSplit: !raw.lib,
      minify: consumer === 'server' || isBundledDev ? false : 'oxc',
      rollupOptions: {},
      rolldownOptions: undefined,
      ssr: consumer === 'server',
      emitAssets: consumer === 'client',
      createEnvironment: (name, config) => new BuildEnvironment(name, config),
    } satisfies BuildEnvironmentOptions,
    raw,
  )
  setupRollupOptionCompat(merged, 'build')
  merged.rolldownOptions = {
    platform:
      consumer === 'client' || isSsrTargetWebworkerEnvironment
        ? 'browser'
        : 'node',
    ...merged.rolldownOptions,
  }
  if (merged.lib && merged.lib.entry == null && input != null) {
    // 顶层 input 可作为 lib entry，但不能为此修改用户传入的 lib 对象。
    merged.lib = { ...merged.lib, entry: input }
  }

  // 把用户友好的特殊 target 展开成转换器认识的目标数组。
  if (merged.target === 'baseline-widely-available') {
    merged.target = ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET
  }
  // Oxc 不接受重复 target；兼容过去 esbuild 容许重复项的配置。
  if (Array.isArray(merged.target)) {
    // 保持首次出现顺序，只去重。
    merged.target = unique(merged.target)
  }

  // CLI/config 文件可能传入字符串 "false"，统一归一化成布尔值。
  if ((merged.minify as string) === 'false') {
    merged.minify = false
  } else if (merged.minify === true) {
    merged.minify = 'oxc'
  }

  const defaultModulePreload = {
    polyfill: true,
  }

  const resolved: ResolvedBuildEnvironmentOptions = {
    ...merged,
    cssTarget: merged.cssTarget ?? merged.target,
    cssMinify:
      merged.cssMinify ??
      (consumer === 'server' ? 'lightningcss' : !!merged.minify),
    // modulePreload 最终只有 false 或带默认值的对象两种形态。
    modulePreload:
      merged.modulePreload === false
        ? false
        : merged.modulePreload === true
          ? defaultModulePreload
          : {
              ...defaultModulePreload,
              ...merged.modulePreload,
            },
  }
  // 上方对象展开会求值 merged 上的 rollupOptions 兼容 getter，并复制成普通属性；
  // 因此需要在 resolved 上重新建立 rollup/rolldown 双向兼容访问器。
  setupRollupOptionCompat(resolved, 'build')

  return resolved
}

/**
 * 组装构建专用插件。pre 负责输出目录、用户 Rolldown 插件与 worker 后处理；
 * post 负责 preload、压缩、license/manifest/report，并以 load fallback 收尾。
 */
export function resolveBuildPlugins(config: ResolvedConfig): {
  /** 在核心构建与输出插件之前执行的插件。 */
  pre: Plugin[]
  /** 在核心构建后处理阶段执行的插件。 */
  post: Plugin[]
} {
  const isBuild = config.command === 'build'
  return {
    pre: [
      ...(isBuild && !config.isWorker ? [prepareOutDirPlugin()] : []),
      perEnvironmentPlugin(
        'vite:rollup-options-plugins',
        async (environment) => {
          if (!isBuild && !environment.config.isBundled) {
            return false
          }
          return (
            await asyncFlatten(
              arraify(environment.config.build.rolldownOptions.plugins),
            )
          ).filter(Boolean) as Plugin[]
        },
      ),
      ...(config.isWorker ? [webWorkerPostPlugin(config)] : []),
    ],
    post: [
      ...(isBuild ? buildImportAnalysisPlugin(config) : []),
      ...(isBuild && config.build.minify === 'esbuild'
        ? [buildEsbuildPlugin()]
        : []),
      ...(isBuild ? [terserPlugin(config)] : []),
      ...(isBuild && !config.isWorker
        ? [
            licensePlugin(),
            manifestPlugin(),
            ssrManifestPlugin(),
            buildReporterPlugin(config),
          ]
        : []),
      nativeLoadFallbackPlugin(),
    ],
  }
}

/**
 * 兼容旧 Build API：解析配置后只构建第一个 Environment，并返回 Rolldown 结果或 watcher。
 * 多 Environment 编排应直接使用 `createBuilder()`。
 */
export async function build(
  inlineConfig: InlineConfig = {},
): Promise<RolldownOutput | RolldownOutput[] | RolldownWatcher> {
  const builder = await createBuilder(inlineConfig, true)
  const environment = Object.values(builder.environments)[0]
  if (!environment) throw new Error('No environment found')
  return builder.build(environment)
}

/** 以 production/build 语义解析配置，并允许 Builder 在解析阶段打补丁。 */
function resolveConfigToBuild(
  inlineConfig: InlineConfig = {},
  patchConfig?: (config: ResolvedConfig) => void,
  patchPlugins?: (resolvedPlugins: Plugin[]) => void,
): Promise<ResolvedConfig> {
  return resolveConfig(
    inlineConfig,
    'build',
    'production',
    'production',
    false,
    patchConfig,
    patchPlugins,
  )
}

/**
 * 将某个 Environment 的 Vite build 配置翻译成一次 Rolldown 构建配置。
 * 这里确定入口优先级、SSR/lib 签名、插件上下文、平台、文件名和压缩策略。
 */
export function resolveRolldownOptions(
  environment: Environment,
  chunkMetadataMap: ChunkMetadataMap,
): RolldownOptions {
  const { root, packageCache, base, build: options } = environment.config
  const libOptions = options.lib
  const { logger } = environment
  const ssr = environment.config.consumer === 'server'

  /** 把构建配置中的相对路径统一解析到项目 root。 */
  const resolve = (p: string) => path.resolve(root, p)
  const topLevelInput = environment.config.input
  if (libOptions && libOptions.entry == null) {
    throw new Error(
      `Either "build.lib.entry" or the top-level "input" option is required when "build.lib" is set.`,
    )
  }
  const input = libOptions
    ? options.rolldownOptions.input ||
      (typeof libOptions.entry === 'string'
        ? resolve(libOptions.entry)
        : Array.isArray(libOptions.entry)
          ? libOptions.entry.map(resolve)
          : Object.fromEntries(
              Object.entries(libOptions.entry!).map(([alias, file]) => [
                alias,
                resolve(file),
              ]),
            ))
    : typeof options.ssr === 'string'
      ? resolve(options.ssr)
      : options.rolldownOptions.input ||
        (topLevelInput ?? resolve('index.html'))

  if (ssr && typeof input === 'string' && input.endsWith('.html')) {
    throw new Error(
      `rolldownOptions.input should not be an html file when building for SSR. ` +
        `Please specify a dedicated SSR entry.`,
    )
  }
  if (options.cssCodeSplit === false) {
    const inputs =
      typeof input === 'string'
        ? [input]
        : Array.isArray(input)
          ? input
          : Object.values(input)
    if (inputs.some((input) => input.endsWith('.css'))) {
      throw new Error(
        `When "build.cssCodeSplit: false" is set, "rolldownOptions.input" should not include CSS files.`,
      )
    }
  }

  const outDir = resolve(options.outDir)

  // 构建插件仍使用 Rollup/Rolldown 签名，包装层把当前 Environment 注入 context 与兼容参数。
  const plugins = environment.plugins.map((p) =>
    injectEnvironmentToHooks(environment, chunkMetadataMap, p),
  )

  const rolldownOptions: RolldownOptions = {
    preserveEntrySignatures: ssr
      ? 'allow-extension'
      : libOptions
        ? 'strict'
        : false,
    // cache: options.watch ? undefined : false,
    ...options.rolldownOptions,
    output: options.rolldownOptions.output,
    input,
    plugins,
    external: options.rolldownOptions.external,
    /** 把 Rolldown 日志交给支持 Vite/用户钩子的统一日志入口。 */
    onLog(level, log) {
      onRollupLog(level, log, environment)
    },
    transform: {
      target: options.target === false ? undefined : options.target,
      ...options.rolldownOptions.transform,
      define: {
        ...options.rolldownOptions.transform?.define,
        // `define` 插件已经处理 NODE_ENV，禁用 Rolldown 内建的重复替换。
        'process.env.NODE_ENV': 'process.env.NODE_ENV',
      },
    },
    // TODO: Rolldown CSS 原生支持完全接入后，移除此 JS 代理兼容层。
    moduleTypes: {
      ...options.rolldownOptions.moduleTypes,
      '.css': 'js',
    },
    experimental: {
      ...options.rolldownOptions.experimental,
      viteMode: true,
      chunkImportMap: options.chunkImportMap
        ? {
            ...(typeof options.rolldownOptions.experimental?.chunkImportMap ===
            'object'
              ? options.rolldownOptions.experimental?.chunkImportMap
              : {}),
            baseUrl: base,
          }
        : options.rolldownOptions.experimental?.chunkImportMap,
    },
  }

  const isSsrTargetWebworkerEnvironment =
    environment.name === 'ssr' &&
    environment.getTopLevelConfig().ssr?.target === 'webworker'

  // webworker SSR 使用 browser platform，没有 createRequire；外部 CJS require
  // 必须改写为 ESM import，运行时才可装载。
  if (isSsrTargetWebworkerEnvironment) {
    plugins.push(esmExternalRequirePlugin())
  }

  /** 合并单个输出的 Vite 默认值，并拒绝与顶层构建配置冲突的字段。 */
  const buildOutputOptions = (output: OutputOptions = {}): OutputOptions => {
    // @ts-expect-error -- 兼容旧版嵌套 output.output；Rolldown 类型不再声明该字段。见 https://github.com/vitejs/vite/issues/5812#issuecomment-984345618
    if (output.output) {
      logger.warn(
        `You've set "rolldownOptions.output.output" in your config. ` +
          `This is deprecated and will override all Vite.js default output options. ` +
          `Please use "rolldownOptions.output" instead.`,
      )
    }
    if (output.file) {
      throw new Error(
        `Vite does not support "rolldownOptions.output.file". ` +
          `Please use "rolldownOptions.output.dir" and "rolldownOptions.output.entryFileNames" instead.`,
      )
    }
    if (output.sourcemap) {
      logger.warnOnce(
        colors.yellow(
          `Vite does not support "rolldownOptions.output.sourcemap". ` +
            `Please use "build.sourcemap" instead.`,
        ),
      )
    }

    const format = output.format || 'es'
    const jsExt =
      (ssr && !isSsrTargetWebworkerEnvironment) || libOptions
        ? resolveOutputJsExtension(
            format,
            findNearestPackageData(root, packageCache)?.data.type,
          )
        : 'js'
    return {
      dir: outDir,
      // 普通应用与 SSR 默认都输出 ES 格式。
      format,
      exports: 'auto',
      sourcemap: options.sourcemap,
      name: libOptions ? libOptions.name : undefined,
      // hoistTransitiveImports: libOptions ? false : undefined,
      // es2015 会启用 generatedCode.symbols：ESM 转 CJS chunk 与默认导出都需要
      // `Symbol.toStringTag`（#764、#1048）。
      generatedCode: {
        preset: 'es2015',
      },
      entryFileNames: ssr
        ? `[name].${jsExt}`
        : libOptions
          ? ({ name }) =>
              resolveLibFilename(
                libOptions,
                format,
                name,
                root,
                jsExt,
                packageCache,
              )
          : path.posix.join(options.assetsDir, `[name]-[hash].${jsExt}`),
      chunkFileNames: libOptions
        ? `[name]-[hash].${jsExt}`
        : path.posix.join(options.assetsDir, `[name]-[hash].${jsExt}`),
      assetFileNames: libOptions
        ? `[name].[ext]`
        : path.posix.join(options.assetsDir, `[name]-[hash].[ext]`),
      codeSplitting:
        output.codeSplitting ??
        (output.format === 'umd' ||
        output.format === 'iife' ||
        (isSsrTargetWebworkerEnvironment &&
          (typeof input === 'string' || Object.keys(input).length === 1))
          ? false
          : undefined),
      comments:
        typeof output.comments === 'boolean'
          ? output.comments
          : {
              // ES 库输出必须保留 pure annotations；压缩空白会删掉它们并破坏下游 tree-shaking。
              annotation:
                !options.minify ||
                (libOptions && (format === 'es' || format === 'esm')),
              jsdoc: !options.minify,
              legal: !options.minify,
              ...output.comments,
            },
      minify:
        options.minify === 'oxc'
          ? libOptions && (format === 'es' || format === 'esm')
            ? {
                compress: true,
                mangle: true,
                // 同理只做 compress/mangle，不让 codegen 压缩空白和移除 pure 标注。
                codegen: false,
              }
            : true
          : options.minify === false
            ? 'dce-only'
            : false,
      topLevelVar: true,
      ...output,
    }
  }

  // 库模式可能按 formats 展开为多个 output；应用构建通常只有一个。
  const outputs = resolveBuildOutputs(
    options.rolldownOptions.output,
    libOptions,
    logger,
  )

  if (Array.isArray(outputs)) {
    rolldownOptions.output = outputs.map(buildOutputOptions)
  } else {
    rolldownOptions.output = buildOutputOptions(outputs)
  }

  return rolldownOptions
}

/**
 * 执行单个 BuildEnvironment 的应用或库构建。
 * watch 模式返回长期 watcher；一次性模式依次 generate/write 全部 output，并在
 * 结果返回前回填 Vite chunk metadata。无论成功失败都关闭 Rolldown bundle。
 */
async function buildEnvironment(
  environment: BuildEnvironment,
): Promise<RolldownOutput | RolldownOutput[] | RolldownWatcher> {
  const { logger, config } = environment
  const { root, build: options } = config

  logger.info(
    colors.cyan(
      `vite v${VERSION} ${colors.green(
        `building ${environment.name} environment for ${environment.config.mode}...`,
      )}`,
    ),
  )

  let bundle: RolldownBuild | undefined
  let startTime: number | undefined
  try {
    const chunkMetadataMap = new ChunkMetadataMap()
    const rolldownOptions = resolveRolldownOptions(
      environment,
      chunkMetadataMap,
    )

    // watch 模式把 Vite/Chokidar 兼容选项转成 Rolldown watcher，并持续复用 metadata map。
    if (options.watch) {
      logger.info(colors.cyan(`\nwatching for file changes...`))

      const resolvedOutDirs = getResolvedOutDirs(
        root,
        options.outDir,
        options.rolldownOptions.output,
      )
      const emptyOutDir = resolveEmptyOutDir(
        options.emptyOutDir,
        root,
        resolvedOutDirs,
        logger,
      )
      const resolvedChokidarOptions = resolveChokidarOptions(
        {
          // @ts-expect-error -- Rolldown 不声明旧 chokidar 字段，Vite 仍读取它保持兼容。
          ...(rolldownOptions.watch || {}).chokidar,
          // @ts-expect-error -- 新 build.watch.chokidar 覆盖 Rolldown 兼容字段。
          ...options.watch.chokidar,
        },
        resolvedOutDirs,
        emptyOutDir,
        environment.config.cacheDir,
      )

      const { watch } = await import('rolldown')
      const watcher = watch({
        ...rolldownOptions,
        watch: {
          ...rolldownOptions.watch,
          ...options.watch,
          watcher: convertToWatcherOptions(resolvedChokidarOptions),
        },
      })

      watcher.on('event', (event) => {
        if (event.code === 'BUNDLE_START') {
          logger.info(colors.cyan(`\nbuild started...`))
          chunkMetadataMap.clearResetChunks()
        } else if (event.code === 'BUNDLE_END') {
          event.result.close()
          logger.info(colors.cyan(`built in ${event.duration}ms.`))
        } else if (event.code === 'ERROR') {
          const e = event.error
          enhanceRollupError(e)
          clearLine()
          logger.error(e.message, { error: e })
        }
      })

      return watcher
    }

    // 一次性模式先创建 bundle，再按每个 output 选择写盘或仅生成内存结果。
    const { rolldown } = await import('rolldown')
    startTime = Date.now()
    bundle = await rolldown(rolldownOptions)

    const res: RolldownOutput[] = []
    for (const output of arraify(rolldownOptions.output!)) {
      res.push(await bundle[options.write ? 'write' : 'generate'](output))
    }
    for (const output of res) {
      for (const chunk of output.output) {
        injectChunkMetadata(chunkMetadataMap, chunk)
      }
    }
    logger.info(
      `${colors.green(`✓ built in ${displayTime(Date.now() - startTime)}`)}`,
    )
    return Array.isArray(rolldownOptions.output) ? res : res[0]
  } catch (e) {
    enhanceRollupError(e)
    clearLine()
    if (startTime) {
      logger.error(
        `${colors.red('✗')} Build failed in ${displayTime(Date.now() - startTime)}`,
      )
      startTime = undefined
    }
    throw e
  } finally {
    if (bundle) await bundle.close()
  }
}

/** 给 Rolldown 错误补插件名、文件位置、统一 code frame，并重建可读 stack。 */
export function enhanceRollupError(e: RollupError): void {
  const stackOnly = extractStack(e)

  let msg = colors.red((e.plugin ? `[${e.plugin}] ` : '') + e.message)
  if (e.loc && e.loc.file && e.loc.file !== e.id) {
    msg += `\nfile: ${colors.cyan(
      `${e.loc.file}:${e.loc.line}:${e.loc.column}` +
        (e.id ? ` (${e.id})` : ''),
    )}`
  } else if (e.id) {
    msg += `\nfile: ${colors.cyan(
      e.id + (e.loc ? `:${e.loc.line}:${e.loc.column}` : ''),
    )}`
  }
  if (e.frame) {
    msg += `\n` + colors.yellow(normalizeCodeFrame(e.frame))
  }

  e.message = msg

  // stack 可能已在别处被读取并缓存，单改 message 不保证同步；这里显式重建，
  // 让增强后的详细消息稳定出现在 stack 顶部。
  if (stackOnly !== undefined) {
    e.stack = `${e.message}\n${stackOnly}`
  }
}

/**
 * 从 stack 中移除开头重复的 `name: message`，只保留调用栈部分；若前缀形态不符，
 * 则原样返回，避免误删第三方错误格式。
 */
function extractStack(e: RollupError) {
  const { stack, name = 'Error', message } = e

  // 没有 stack 时保留 undefined，调用方只增强 message。
  if (!stack) {
    return stack
  }

  const expectedPrefix = `${name}: ${message}\n`
  if (stack.startsWith(expectedPrefix)) {
    return stack.slice(expectedPrefix.length)
  }

  return stack
}

/** 给 Rolldown code frame 补首尾换行，与 esbuild 错误展示保持一致。 */
function normalizeCodeFrame(frame: string) {
  const trimmedPadding = frame.replace(/^\n|\n$/g, '')
  return `\n${trimmedPadding}\n`
}

/** Node 模块身份安全的 JavaScript 输出扩展名。 */
type JsExt = 'js' | 'cjs' | 'mjs'

/** 根据 package type 与输出 format 选择不会被 Node 误判模块系统的扩展名。 */
function resolveOutputJsExtension(
  format: ModuleFormat,
  type: string = 'commonjs',
): JsExt {
  if (type === 'module') {
    return format === 'cjs' || format === 'umd' ? 'cjs' : 'js'
  } else {
    return format === 'es' ? 'mjs' : 'js'
  }
}

/** 按用户函数/字符串、package name、入口别名和模块格式生成库入口文件名。 */
export function resolveLibFilename(
  libOptions: LibraryOptions,
  format: ModuleFormat,
  entryName: string,
  root: string,
  extension?: JsExt,
  packageCache?: PackageCache,
): string {
  if (typeof libOptions.fileName === 'function') {
    return libOptions.fileName(format, entryName)
  }

  const packageJson = findNearestMainPackageData(root, packageCache)?.data
  const name =
    libOptions.fileName ||
    (packageJson && typeof libOptions.entry === 'string'
      ? getPkgName(packageJson.name)
      : entryName)

  if (!name)
    throw new Error(
      'Name in package.json is required if option "build.lib.fileName" is not provided.',
    )

  extension ??= resolveOutputJsExtension(format, packageJson?.type)

  if (format === 'cjs' || format === 'es') {
    return `${name}.${extension}`
  }

  return `${name}.${format}.${extension}`
}

/**
 * 将库 formats 展开为 Rolldown outputs，并校验 UMD/IIFE 的单入口与全局 name 约束。
 * 用户显式提供 output 数组时，以该数组为准并忽略 `lib.formats`。
 */
export function resolveBuildOutputs(
  outputs: OutputOptions | OutputOptions[] | undefined,
  libOptions: LibraryOptions | false,
  logger: Logger,
): OutputOptions | OutputOptions[] | undefined {
  if (libOptions) {
    const libHasMultipleEntries =
      typeof libOptions.entry !== 'string' &&
      libOptions.entry &&
      Object.values(libOptions.entry).length > 1
    const libFormats =
      libOptions.formats ||
      (libHasMultipleEntries ? ['es', 'cjs'] : ['es', 'umd'])

    if (!Array.isArray(outputs)) {
      if (libFormats.includes('umd') || libFormats.includes('iife')) {
        if (libHasMultipleEntries) {
          throw new Error(
            'Multiple entry points are not supported when output formats include "umd" or "iife".',
          )
        }

        if (!libOptions.name) {
          throw new Error(
            'Option "build.lib.name" is required when output formats include "umd" or "iife".',
          )
        }
      }

      return libFormats.map((format) => ({ ...outputs, format }))
    }

    // 到这里 outputs 已由上方分支缩窄为数组。
    if (libOptions.formats) {
      logger.warn(
        colors.yellow(
          '"build.lib.formats" will be ignored because "build.rolldownOptions.output" is already an array format.',
        ),
      )
    }

    outputs.forEach((output) => {
      if (
        (output.format === 'umd' || output.format === 'iife') &&
        !output.name
      ) {
        throw new Error(
          'Entries in "build.rolldownOptions.output" must specify "name" when the format is "umd" or "iife".',
        )
      }
    })
  }

  return outputs
}

/** Vite 默认不向用户重复展示的 Rolldown 常见警告代码。 */
const warningIgnoreList = [`CIRCULAR_DEPENDENCY`, `THIS_IS_UNDEFINED`]
/** 动态导入变量兼容插件已知且无需重复输出的警告片段。 */
const dynamicImportWarningIgnoreList = [
  `Unsupported expression`,
  `statically analyzed`,
]

/** 在交互式非 CI 终端清除当前进度行。 */
export function clearLine(): void {
  const tty = process.stdout.isTTY && !process.env.CI
  if (tty) {
    process.stdout.clearLine(0)
    process.stdout.cursorTo(0)
  }
}

/**
 * 把 Rolldown 日志接入 Vite logger，同时兼容用户 `onLog` / `onwarn`。
 * 未解析 import 默认升级为构建错误，已知噪声警告过滤，插件名按 Rollup 格式补入。
 */
export function onRollupLog(
  level: LogLevel,
  log: RollupLog,
  environment: Environment,
): void {
  const debugLogger = createDebugger('vite:build')
  /** 执行 Vite 默认日志分类，并作为用户日志钩子的 fallback handler。 */
  const viteLog: LogOrStringHandler = (logLeveling, rawLogging) => {
    const logging =
      typeof rawLogging === 'object' ? rawLogging : { message: rawLogging }

    if (logging.code === 'UNRESOLVED_IMPORT') {
      const id = logging.id
      const exporter = logging.exporter
      // CommonJS external 是插件有意生成的虚拟 id；其他未解析 import 会破坏运行时，直接失败。
      if (!id || !id.endsWith('?commonjs-external')) {
        throw new Error(
          `[vite]: Rolldown failed to resolve import "${exporter}" from "${id}".\n` +
            `This is most likely unintended because it can break your application at runtime.\n` +
            `If you do want to externalize this module explicitly add it to\n` +
            `\`build.rolldownOptions.external\``,
        )
      }
    }

    if (logLeveling === 'warn') {
      if (
        logging.plugin === 'rollup-plugin-dynamic-import-variables' &&
        dynamicImportWarningIgnoreList.some((msg) =>
          logging.message.includes(msg),
        )
      ) {
        return
      }

      if (warningIgnoreList.includes(logging.code!)) {
        return
      }
    }

    // 补插件名，使消息格式与 Rollup 行为一致。
    let message = logging.message
    if (logging.plugin) {
      message = `[plugin ${logging.plugin}] ${message}`
    }

    switch (logLeveling) {
      case 'info':
        environment.logger.info(message)
        return
      case 'warn':
        environment.logger.warn(colors.yellow(message))
        return
      case 'error':
        environment.logger.error(colors.red(message))
        return
      case 'debug':
        debugLogger?.(message)
        return
      default:
        logLeveling satisfies never
        // 防御未知日志级别，至少以 info 展示而不是静默丢失。
        environment.logger.info(message)
        return
    }
  }

  clearLine()
  const userOnLog = environment.config.build.rolldownOptions?.onLog
  const userOnWarn = environment.config.build.rolldownOptions?.onwarn
  if (userOnLog) {
    if (userOnWarn) {
      const normalizedUserOnWarn = normalizeUserOnWarn(userOnWarn, viteLog)
      userOnLog(level, log, normalizedUserOnWarn)
    } else {
      userOnLog(level, log, viteLog)
    }
  } else if (userOnWarn) {
    const normalizedUserOnWarn = normalizeUserOnWarn(userOnWarn, viteLog)
    normalizedUserOnWarn(level, log)
  } else {
    viteLog(level, log)
  }
}

/** 把旧 `onwarn(log, defaultHandler)` 适配到带 level 的 `onLog` 协议。 */
function normalizeUserOnWarn(
  userOnWarn: WarningHandlerWithDefault,
  defaultHandler: LogOrStringHandler,
): LogOrStringHandler {
  return (logLevel, logging) => {
    if (logLevel === 'warn') {
      userOnWarn(normalizeLog(logging), (log) =>
        defaultHandler('warn', typeof log === 'function' ? log() : log),
      )
    } else {
      defaultHandler(logLevel, logging)
    }
  }
}

/** 把字符串日志包装为 Rolldown 的结构化日志对象。 */
const normalizeLog = (log: RollupLog | string): RollupLog =>
  typeof log === 'string' ? { message: log } : log

/** 执行用户 external 函数、字符串或正则数组，保持 Rollup 的三态返回值。 */
export function resolveUserExternal(
  user: ExternalOption,
  id: string,
  parentId: string | undefined,
  isResolved: boolean,
): boolean | null | void {
  if (typeof user === 'function') {
    return user(id, parentId, isResolved)
  } else if (Array.isArray(user)) {
    return user.some((test) => isExternal(id, test))
  } else {
    return isExternal(id, user)
  }
}

/** 判断单条字符串/正则 external 规则。 */
function isExternal(id: string, test: string | RegExp) {
  if (typeof test === 'string') {
    return id === test
  } else {
    return test.test(id)
  }
}

/**
 * 在 renderChunk 前后的不同 chunk 对象之间保存 Vite 扩展 metadata。
 *
 * Rolldown 可能为同一 preliminaryFileName 创建多个对象；外置 Map 让 CSS/assets
 * 插件共享集合。watch 重建首次 renderChunk 时重置，避免沿用上一轮引用。
 */
export class ChunkMetadataMap {
  /** preliminary file name 到共享 metadata 的长期映射。 */
  private _inner = new Map<string, ChunkMetadata | AssetMetadata>()
  /** 当前 watch 轮次已重置过的 chunk，防止后续插件再次清空。 */
  private _resetChunks = new Set<string>()

  /** 为 chunk/asset 选择跨输出阶段稳定的文件名键。 */
  private _getKey(chunk: RenderedChunk | OutputChunk | OutputAsset): string {
    return 'preliminaryFileName' in chunk
      ? chunk.preliminaryFileName
      : chunk.fileName
  }

  /** 按输出类别创建互不共享集合的初始 metadata。 */
  private _getDefaultValue(
    chunk: RenderedChunk | OutputChunk | OutputAsset,
  ): ChunkMetadata | AssetMetadata {
    return chunk.type === 'chunk'
      ? {
          importedAssets: new Set(),
          importedCss: new Set(),
          // 临时共享 chunk.modules，使 JS 侧插件对 modules 的修改能跨输出对象可见；
          // Rolldown 原生支持相同可变语义后可移除。
          __modules: chunk.modules,
        }
      : {
          importedAssets: new Set(),
          importedCss: new Set(),
        }
  }

  /** 取得或惰性创建指定输出对象对应的共享 metadata。 */
  get(
    chunk: RenderedChunk | OutputChunk | OutputAsset,
  ): ChunkMetadata | AssetMetadata {
    const key = this._getKey(chunk)
    if (!this._inner.has(key)) {
      this._inner.set(key, this._getDefaultValue(chunk))
    }
    return this._inner.get(key)!
  }

  /** watch 每轮只在该 chunk 第一次 renderChunk 时重置，后续插件继续共享同一集合。 */
  reset(chunk: RenderedChunk | OutputChunk | OutputAsset): void {
    const key = this._getKey(chunk)
    if (this._resetChunks.has(key)) return

    this._resetChunks.add(key)
    this._inner.set(key, this._getDefaultValue(chunk))
  }

  /** 开始下一轮 watch 构建前清空“本轮已重置”标记。 */
  clearResetChunks(): void {
    this._resetChunks.clear()
  }
}

/**
 * 克隆插件并包装所有构建钩子，把 Environment、旧 ssr 参数和 viteMetadata
 * 注入 Rolldown context/参数；保留 class 原型与对象式 hook 的 filter/order。
 */
export function injectEnvironmentToHooks(
  environment: Environment,
  chunkMetadataMap: ChunkMetadataMap,
  plugin: Plugin,
): Plugin {
  const { resolveId, load, transform } = plugin

  // 插件可能是 class 实例（如原生插件），不能用普通对象展开丢掉原型方法。
  const clone: Plugin = Object.assign(
    Object.create(Object.getPrototypeOf(plugin)),
    plugin,
  )

  for (const hook of Object.keys(clone) as RollupPluginHooks[]) {
    switch (hook) {
      case 'resolveId':
        clone[hook] = wrapEnvironmentResolveId(
          environment,
          resolveId,
          plugin.name,
        )
        break
      case 'load':
        clone[hook] = wrapEnvironmentLoad(environment, load, plugin.name)
        break
      case 'transform':
        clone[hook] = wrapEnvironmentTransform(
          environment,
          transform,
          plugin.name,
        )
        break
      default:
        if (ROLLUP_HOOKS.includes(hook)) {
          ;(clone as any)[hook] = wrapEnvironmentHook(
            environment,
            chunkMetadataMap,
            plugin,
            hook,
          )
        }
        break
    }
  }

  return clone
}

/** 包装时需要保留并同步的对象式 hook 最小形状。 */
type AbstractHook<Handler extends Function> = {
  /** 实际执行的钩子函数。 */
  handler: Handler
  /** 声明式调用过滤器，由底层 hook 类型具体限定。 */
  filter?: unknown
  /** pre/post 等钩子排序信息。 */
  order?: unknown
}
/** 原 hook 到各 Environment 包装副本的弱引用映射。 */
const wrappedHookMap = new WeakMap<
  AbstractHook<Function>,
  Array<AbstractHook<Function>>
>()
/**
 * 包装对象式 hook，同时把原 hook 后续发生的 filter/order 变更同步给全部副本。
 * sharedPlugins 下同一 hook 可为多个 Environment 各生成一个 wrapper。
 */
function wrapHookObject<
  Handler extends Function,
  Hook extends AbstractHook<Handler>,
>(hook: Hook, handler: Handler): Hook {
  const newHook = {
    ...hook,
    handler,
  }

  if (!wrappedHookMap.has(hook)) {
    wrappedHookMap.set(hook, [])
    Object.defineProperty(hook, 'filter', {
      /** 从首个包装副本读取当前 filter。 */
      get() {
        return wrappedHookMap.get(hook)![0].filter
      },
      /** 把运行期 filter 修改同步到全部 Environment 副本。 */
      set(v) {
        for (const h of wrappedHookMap.get(hook)!) {
          h.filter = v
        }
      },
    })
    Object.defineProperty(hook, 'order', {
      /** 从首个包装副本读取当前 order。 */
      get() {
        return wrappedHookMap.get(hook)![0].order
      },
      /** 把运行期 order 修改同步到全部 Environment 副本。 */
      set(v) {
        for (const h of wrappedHookMap.get(hook)!) {
          h.order = v
        }
      },
    })
  }
  wrappedHookMap.get(hook)!.push(newHook)

  return newHook
}

/** 为 resolveId context 注入 Environment，并补兼容 ssr flag。 */
function wrapEnvironmentResolveId(
  environment: Environment,
  hook: Plugin['resolveId'] | undefined,
  pluginName: string,
): Plugin['resolveId'] {
  if (!hook) return

  const fn = getHookHandler(hook)
  /** 调用原 resolveId 时注入 Environment context 与兼容 ssr 选项。 */
  const handler: Plugin['resolveId'] = function (id, importer, options) {
    return fn.call(
      injectEnvironmentInContext(this, environment),
      id,
      importer,
      injectSsrFlag(options, environment, pluginName),
    )
  }

  if ('handler' in hook) {
    return wrapHookObject(hook, handler)
  } else {
    return handler
  }
}

/** 为 load context 注入 Environment，并补兼容 ssr flag。 */
function wrapEnvironmentLoad(
  environment: Environment,
  hook: Plugin['load'] | undefined,
  pluginName: string,
): Plugin['load'] {
  if (!hook) return

  const fn = getHookHandler(hook)
  /** 调用原 load 时注入 Environment context 与兼容 ssr 选项。 */
  const handler: Plugin['load'] = function (id, ...args) {
    return fn.call(
      injectEnvironmentInContext(this, environment),
      id,
      injectSsrFlag(args[0], environment, pluginName),
    )
  }

  if ('handler' in hook) {
    return wrapHookObject(hook, handler)
  } else {
    return handler
  }
}

/** 为 transform context 注入 Environment，并补兼容 ssr flag。 */
function wrapEnvironmentTransform(
  environment: Environment,
  hook: Plugin['transform'] | undefined,
  pluginName: string,
): Plugin['transform'] {
  if (!hook) return

  const fn = getHookHandler(hook)
  /** 调用原 transform 时注入 Environment context 与兼容 ssr 选项。 */
  const handler: Plugin['transform'] = function (code, importer, ...args) {
    return fn.call(
      injectEnvironmentInContext(this, environment),
      code,
      importer,
      injectSsrFlag(args[0], environment, pluginName),
    )
  }

  if ('handler' in hook) {
    return wrapHookObject(hook, handler)
  } else {
    return handler
  }
}

/** 包装其余 Rolldown hook，并在关键输出阶段同步 Vite chunk metadata。 */
function wrapEnvironmentHook<HookName extends keyof Plugin>(
  environment: Environment,
  chunkMetadataMap: ChunkMetadataMap,
  plugin: Plugin,
  hookName: HookName,
): Plugin[HookName] {
  const hook = plugin[hookName]
  if (!hook) return

  const fn = getHookHandler(hook)
  if (typeof fn !== 'function') return hook

  /** 注入上下文，并在输出钩子调用前恢复对应 chunk 的共享 metadata。 */
  const handler: Plugin[HookName] = function (
    this: PluginContext,
    ...args: any[]
  ) {
    if (hookName === 'renderChunk') {
      injectChunkMetadata(chunkMetadataMap, args[1], true)
    }
    if (hookName === 'augmentChunkHash') {
      injectChunkMetadata(chunkMetadataMap, args[0])
    }
    if (hookName === 'generateBundle' || hookName === 'writeBundle') {
      const bundle = args[1] as OutputBundle
      for (const chunk of Object.values(bundle)) {
        injectChunkMetadata(chunkMetadataMap, chunk)
      }
    }
    return fn.call(injectEnvironmentInContext(this, environment), ...args)
  }

  if ('handler' in hook) {
    return wrapHookObject(hook, handler)
  } else {
    return handler
  }
}

/** 把外置 metadata 以不可替换属性挂回 chunk，并代理 modules 到共享对象。 */
function injectChunkMetadata(
  chunkMetadataMap: ChunkMetadataMap,
  chunk: RenderedChunk | OutputChunk | OutputAsset,
  resetChunkMetadata = false,
) {
  if (resetChunkMetadata) {
    chunkMetadataMap.reset(chunk)
  }
  // 使用 defineProperty，避免 Rolldown 把普通赋值误判为输出对象发生变化。
  // https://github.com/rolldown/rolldown/blob/f4c5ff27799f2b0152c689c398e61bc7d30429ff/packages/rolldown/src/utils/transform-to-rollup-output.ts#L87
  Object.defineProperty(chunk, 'viteMetadata', {
    value: chunkMetadataMap.get(chunk),
    enumerable: true,
  })
  if (chunk.type === 'chunk') {
    Object.defineProperty(chunk, 'modules', {
      /** 始终返回 metadata 中跨输出对象共享的 modules 表。 */
      get() {
        return chunk.viteMetadata!.__modules
      },
      enumerable: true,
    })
  }
}

/** 惰性补齐插件 context 的 Vite 版本与当前 Environment。 */
function injectEnvironmentInContext<Context extends MinimalPluginContext>(
  context: Context,
  environment: Environment,
) {
  context.meta.viteVersion ??= VERSION
  context.environment ??= environment
  return context
}

/**
 * 为旧插件注入 options.ssr；启用未来废弃检查时改为访问器，在实际读取时告警。
 */
function injectSsrFlag<T extends Record<string, any>>(
  options: T | undefined,
  environment: Environment,
  pluginName: string,
): T & {
  /** 旧插件钩子读取的服务端消费方标志。 */
  ssr?: boolean
} {
  let ssr = environment.config.consumer === 'server'
  const newOptions = { ...(options ?? {}), ssr } as T & {
    /** 旧插件钩子读取的服务端消费方标志。 */
    ssr?: boolean
  }

  if (
    isFutureDeprecationEnabled(
      environment?.getTopLevelConfig(),
      'removePluginHookSsrArgument',
    )
  ) {
    Object.defineProperty(newOptions, 'ssr', {
      /** 读取兼容 ssr 字段时输出 future deprecation 警告。 */
      get() {
        warnFutureDeprecation(
          environment?.getTopLevelConfig(),
          'removePluginHookSsrArgument',
          `Used in plugin "${pluginName}".`,
        )
        return ssr
      },
      /** 保持旧插件覆写 ssr 兼容参数的行为。 */
      set(v) {
        ssr = v
      },
    })
  }

  return newOptions
}

/*
  以下 URL 生成函数复制自 Rollup：
  https://github.com/rollup/rollup/blob/ce6cb93098850a46fa242e37b74a919e99a5de28/src/ast/nodes/MetaProperty.ts#L155-L203

  https://github.com/rollup/rollup
  The MIT License (MIT)
  Copyright (c) 2017 [these people](https://github.com/rollup/rollup/graphs/contributors)
  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
const needsEscapeRegEx = /[\n\r'\\\u2028\u2029]/
/** 在 JavaScript 单引号字面量中需要反斜杠转义的换行或引号字符。 */
const quoteNewlineRegEx = /([\n\r'\u2028\u2029])/g
/** 匹配需在生成字符串字面量中加倍的反斜杠。 */
const backSlashRegEx = /\\/g

/** 转义将被插入单引号 JavaScript 字符串的资源路径。 */
function escapeId(id: string): string {
  if (!needsEscapeRegEx.test(id)) return id
  return id.replace(backSlashRegEx, '\\\\').replace(quoteNewlineRegEx, '\\$1')
}

/** 生成用 URL 构造器把路径解析为绝对 href 的运行时代码。 */
const getResolveUrl = (path: string, URL = 'URL') => `new ${URL}(${path}).href`

/** 生成浏览器文档环境下相对当前脚本或 baseURI 的资源 URL 表达式。 */
const getRelativeUrlFromDocument = (relativePath: string, umd = false) =>
  getResolveUrl(
    `'${escapeId(partialEncodeURIPath(relativePath))}', ${
      umd ? `typeof document === 'undefined' ? location.href : ` : ''
    }document.currentScript && document.currentScript.tagName.toUpperCase() === 'SCRIPT' && document.currentScript.src || document.baseURI`,
  )

/** 生成 Node 环境把绝对文件路径转换成 file URL 的表达式。 */
const getFileUrlFromFullPath = (path: string) =>
  `require('u' + 'rl').pathToFileURL(${path}).href`

/** 生成 Node 环境把相对 __dirname 路径转换成 file URL 的表达式。 */
const getFileUrlFromRelativePath = (path: string) =>
  getFileUrlFromFullPath(`__dirname + '/${escapeId(path)}'`)

/** 各输出格式把相对资源路径解析为运行时 URL 的代码生成器。 */
const relativeUrlMechanisms: Record<
  InternalModuleFormat,
  (relativePath: string) => string
> = {
  // amd: (relativePath) => {
  //   if (relativePath[0] !== '.') relativePath = './' + relativePath
  //   return getResolveUrl(
  //     `require.toUrl('${escapeId(relativePath)}'), document.baseURI`,
  //   )
  // },
  cjs: (relativePath) =>
    `(typeof document === 'undefined' ? ${getFileUrlFromRelativePath(
      relativePath,
    )} : ${getRelativeUrlFromDocument(relativePath)})`,
  es: (relativePath) =>
    getResolveUrl(
      `'${escapeId(partialEncodeURIPath(relativePath))}', import.meta.url`,
    ),
  iife: (relativePath) => getRelativeUrlFromDocument(relativePath),
  // SystemJS 分支要求 Rollup 生成 `module` 参数。
  // system: (relativePath) =>
  //   getResolveUrl(
  //     `'${escapeId(partialEncodeURIPath(relativePath))}', module.meta.url`,
  //   ),
  umd: (relativePath) =>
    `(typeof document === 'undefined' && typeof location === 'undefined' ? ${getFileUrlFromRelativePath(
      relativePath,
    )} : ${getRelativeUrlFromDocument(relativePath, true)})`,
}
/* Rollup 复制代码结束。 */

/** 在 Rollup 格式机制之外补 worker-IIFE 的 self.location 基准。 */
const customRelativeUrlMechanisms = {
  ...relativeUrlMechanisms,
  'worker-iife': (relativePath) =>
    getResolveUrl(
      `'${escapeId(partialEncodeURIPath(relativePath))}', self.location.href`,
    ),
} as const satisfies Record<string, (relativePath: string) => string>

/** 用户 renderBuiltUrl hook 的参数协议与可选重写结果。 */
export type RenderBuiltAssetUrl = (
  filename: string,
  type: {
    /** 当前文件来自构建 asset 还是 public 目录。 */
    type: 'asset' | 'public'
    /** 引用该文件的宿主模块或 HTML ID。 */
    hostId: string
    /** 宿主代码可表达的 URL 语法类别。 */
    hostType: 'js' | 'css' | 'html'
    /** 当前输出是否面向服务端消费方。 */
    ssr: boolean
  },
) =>
  | string
  | {
      /** 强制启用或关闭相对 URL 生成。 */
      relative?: boolean
      /** 仅 JavaScript 宿主可使用的运行时 URL 表达式。 */
      runtime?: string
    }
  | undefined

/**
 * 把构建文件名转换成 JS 中可用的公开路径或运行时表达式。
 * `renderBuiltUrl` 优先级最高；否则相对 base 按 output format 生成运行时 URL，
 * 绝对 base 直接拼接 decodedBase。
 */
export function toOutputFilePathInJS(
  environment: PartialEnvironment,
  filename: string,
  type: 'asset' | 'public',
  hostId: string,
  hostType: 'js' | 'css' | 'html',
  toRelative: (
    filename: string,
    hostType: string,
  ) =>
    | string
    | {
        /** 在生成的 JavaScript 中求值的 URL 表达式。 */
        runtime: string
      },
):
  | string
  | {
      /** 在生成的 JavaScript 中求值的 URL 表达式。 */
      runtime: string
    } {
  const { experimental, base, decodedBase } = environment.config
  const ssr = environment.config.consumer === 'server' // was !!environment.config.build.ssr
  const { renderBuiltUrl } = experimental
  let relative = base === '' || base === './'
  if (renderBuiltUrl) {
    const result = renderBuiltUrl(filename, {
      hostId,
      hostType,
      type,
      ssr,
    })
    if (typeof result === 'object') {
      if (result.runtime) {
        return { runtime: result.runtime }
      }
      if (typeof result.relative === 'boolean') {
        relative = result.relative
      }
    } else if (result) {
      return result
    }
  }
  if (relative && !ssr) {
    return toRelative(filename, hostId)
  }
  return joinUrlSegments(decodedBase, filename)
}

/**
 * 为 ES/CJS/IIFE/UMD 与 worker-IIFE 选择各自可用的相对 URL 运行时机制。
 */
export function createToImportMetaURLBasedRelativeRuntime(
  format: InternalModuleFormat,
  isWorker: boolean,
): (filename: string, importer: string) => {
  /** 针对目标输出格式生成的运行时 URL 表达式。 */
  runtime: string
} {
  const formatLong = isWorker && format === 'iife' ? 'worker-iife' : format
  const toRelativePath = customRelativeUrlMechanisms[formatLong]
  return (filename, importer) => ({
    runtime: toRelativePath(
      path.posix.relative(path.dirname(importer), filename),
    ),
  })
}

/**
 * 生成 CSS/HTML 中的构建 URL。这两类宿主只能保存字符串，若 renderBuiltUrl
 * 返回 runtime 表达式则明确报错。
 */
export function toOutputFilePathWithoutRuntime(
  filename: string,
  type: 'asset' | 'public',
  hostId: string,
  hostType: 'js' | 'css' | 'html',
  config: ResolvedConfig,
  toRelative: (filename: string, hostId: string) => string,
): string {
  const { renderBuiltUrl } = config.experimental
  let relative = config.base === '' || config.base === './'
  if (renderBuiltUrl) {
    const result = renderBuiltUrl(filename, {
      hostId,
      hostType,
      type,
      ssr: !!config.build.ssr,
    })
    if (typeof result === 'object') {
      if (result.runtime) {
        throw new Error(
          `{ runtime: "${result.runtime}" } is not supported for assets in ${hostType} files: ${filename}`,
        )
      }
      if (typeof result.relative === 'boolean') {
        relative = result.relative
      }
    } else if (result) {
      return result
    }
  }
  if (relative && !config.build.ssr) {
    return toRelative(filename, hostId)
  } else {
    return joinUrlSegments(config.decodedBase, filename)
  }
}

/** CSS 宿主使用的纯字符串构建资源 URL 生成入口。 */
export const toOutputFilePathInCss: typeof toOutputFilePathWithoutRuntime =
  toOutputFilePathWithoutRuntime
/** HTML 宿主使用的纯字符串构建资源 URL 生成入口。 */
export const toOutputFilePathInHtml: typeof toOutputFilePathWithoutRuntime =
  toOutputFilePathWithoutRuntime

/** 单个命名生产构建的 Environment，记录是否已被 ViteBuilder 实际构建。 */
export class BuildEnvironment extends BaseEnvironment {
  /** 固定为 build，供调用方正向收窄 Environment 能力。 */
  mode = 'build' as const

  /** Builder 成功执行该 Environment 后置为 true。 */
  isBuilt = false
  /** 合并可选环境覆盖后初始化构建 Environment。 */
  constructor(
    name: string,
    config: ResolvedConfig,
    setup?: {
      /** 覆盖配置中同名 Environment 的构建选项。 */
      options?: EnvironmentOptions
    },
  ) {
    let options = config.environments[name]
    if (!options) {
      throw new Error(`Environment "${name}" is not defined in the config.`)
    }
    if (setup?.options) {
      options = mergeConfig(
        options,
        setup.options,
      ) as ResolvedEnvironmentOptions
    }
    super(name, config, options)
  }

  /** 幂等标记 Environment 已完成一次性初始化。 */
  async init(): Promise<void> {
    if (this._initiated) {
      return
    }
    this._initiated = true
  }
}

/** 编排多个命名 BuildEnvironment 的应用级构建控制器。 */
export interface ViteBuilder {
  /** 已初始化、可独立构建的命名 Environment。 */
  environments: Record<string, BuildEnvironment>
  /** Builder 使用的顶层已解析配置。 */
  config: ResolvedConfig
  /** 按 buildApp hook/用户编排构建应用。 */
  buildApp(): Promise<void>
  /** 构建指定 Environment，并标记 `isBuilt`。 */
  build(
    environment: BuildEnvironment,
  ): Promise<RolldownOutput | RolldownOutput[] | RolldownWatcher>
  /** 在启用时加载并运行 Vite DevTools 构建集成。 */
  runDevTools(): Promise<void>
}

/** 多 Environment 构建的共享策略与应用级编排回调。 */
export interface BuilderOptions {
  /**
   * 是否在多个 Environment 之间共享配置实例，以贴近开发服务器行为。
   *
   * @default false
   * @experimental
   */
  sharedConfigBuild?: boolean
  /**
   * 是否在多个 Environment 之间共享插件实例，以贴近开发服务器行为。
   *
   * @default false
   * @experimental
   */
  sharedPlugins?: boolean
  /** 覆盖默认逐 Environment 构建顺序的应用级回调。 */
  buildApp?: (builder: ViteBuilder) => Promise<void>
}

/** 不共享配置/插件的冻结 Builder 默认策略。 */
const _builderOptionsDefaults = Object.freeze({
  sharedConfigBuild: false,
  sharedPlugins: false,
  // buildApp
} satisfies BuilderOptions)
/** 对外暴露的只读 Builder 默认选项。 */
export const builderOptionsDefaults: Readonly<Partial<BuilderOptions>> =
  _builderOptionsDefaults

/** 给 Builder 选项补共享策略与空 buildApp 默认实现。 */
export function resolveBuilderOptions(
  options: BuilderOptions | undefined,
): ResolvedBuilderOptions | undefined {
  if (!options) return
  return mergeWithDefaults(
    { ..._builderOptionsDefaults, buildApp: async () => {} },
    options,
  )
}

/** 已补齐共享策略和 buildApp 回调的 Builder 选项。 */
export type ResolvedBuilderOptions = Required<BuilderOptions>

/**
 * 创建编排多个 BuildEnvironment 的 ViteBuilder。
 *
 * 默认每个 Environment 重新解析配置并创建独立插件实例；sharedConfigBuild/
 * sharedPlugins 可选择复用。legacy 模式只建立 client 或 ssr 单环境。
 * @experimental
 */
export async function createBuilder(
  inlineConfig: InlineConfig = {},
  useLegacyBuilder: null | boolean = false,
): Promise<ViteBuilder> {
  /** legacy 模式把当前 Environment 的 build 配置镜像到顶层兼容字段。 */
  const patchConfig = (resolved: ResolvedConfig) => {
    if (!(useLegacyBuilder ?? !resolved.builder)) return

    // 生态尚在读取顶层 config.build；legacy Builder 临时把它覆盖成当前环境配置。
    // 全部迁移到 environment.config.build 后可废弃该兼容镜像。
    const environmentName = resolved.build.ssr ? 'ssr' : 'client'
    ;(resolved.build as ResolvedBuildOptions) = {
      ...resolved.environments[environmentName].build,
    }
  }
  const config = await resolveConfigToBuild(inlineConfig, patchConfig)
  useLegacyBuilder ??= !config.builder
  const configBuilder = config.builder ?? resolveBuilderOptions({})!

  const environments: Record<string, BuildEnvironment> = {}

  const builder: ViteBuilder = {
    environments,
    config,
    /** 按插件 order 与用户 buildApp 回调编排应用构建，并保证至少构建一次。 */
    async buildApp() {
      const pluginContext = new BasicMinimalPluginContext(
        { ...basePluginContextMeta, watchMode: false },
        config.logger,
      )

      // 顺序：pre/normal buildApp hooks → config.builder.buildApp → post hooks。
      let configBuilderBuildAppCalled = false
      for (const p of config.getSortedPlugins('buildApp')) {
        const hook = p.buildApp
        if (
          !configBuilderBuildAppCalled &&
          typeof hook === 'object' &&
          hook.order === 'post'
        ) {
          configBuilderBuildAppCalled = true
          await configBuilder.buildApp(builder)
        }
        const handler = getHookHandler(hook)
        await handler.call(pluginContext, builder)
      }
      if (!configBuilderBuildAppCalled) {
        await configBuilder.buildApp(builder)
      }
      // 自定义编排若未构建任何环境，回退为依次构建全部环境，保证默认调用有产物。
      if (
        Object.values(builder.environments).every(
          (environment) => !environment.isBuilt,
        )
      ) {
        for (const environment of Object.values(builder.environments)) {
          await builder.build(environment)
        }
      }
    },
    /** 构建指定 Environment，并在成功后记录 isBuilt。 */
    async build(
      environment: BuildEnvironment,
    ): Promise<RolldownOutput | RolldownOutput[] | RolldownWatcher> {
      const output = await buildEnvironment(environment)
      environment.isBuilt = true
      return output
    },
    /** 惰性加载 DevTools 集成；失败只记录错误，不破坏已完成构建。 */
    async runDevTools() {
      if (config.devtools.enabled) {
        try {
          const { runDevTools } = await import('@vitejs/devtools/integration')
          await runDevTools(builder)
        } catch (e) {
          config.logger.error(
            colors.red(
              `Failed to run Vite DevTools: ${e?.message || e?.stack}`,
            ),
            { error: e },
          )
        }
      }
    },
  }

  /** 通过环境级工厂创建、初始化并登记 BuildEnvironment。 */
  async function setupEnvironment(name: string, config: ResolvedConfig) {
    const environment = await config.build.createEnvironment(name, config)
    await environment.init()
    environments[name] = environment
  }

  if (useLegacyBuilder) {
    await setupEnvironment(config.build.ssr ? 'ssr' : 'client', config)
  } else {
    const environmentConfigs: [string, ResolvedConfig][] = []
    for (const environmentName of Object.keys(config.environments)) {
      // 默认逐环境重新解析配置并创建新插件实例。构建生态通常假定插件创建后只处理
      // 一个 bundle；这与开发模式中同一插件并发服务多个环境不同。
      let environmentConfig = config
      if (!configBuilder.sharedConfigBuild) {
        /** 为当前 Environment 重新解析时镜像其 build 配置。 */
        const patchConfig = (resolved: ResolvedConfig) => {
          // 兼容仍读取顶层 config.build 的插件：每次解析时镜像当前环境配置。
          ;(resolved.build as ResolvedBuildOptions) = {
            ...resolved.environments[environmentName].build,
          }
        }
        /** 按共享策略把重新解析的插件替换为首次配置中的实例。 */
        const patchPlugins = (resolvedPlugins: Plugin[]) => {
          // 全局 sharedPlugins 或插件自身 sharedDuringBuild 可选择复用首次解析的实例。
          let j = 0
          for (let i = 0; i < resolvedPlugins.length; i++) {
            const environmentPlugin = resolvedPlugins[i]
            if (
              configBuilder.sharedPlugins ||
              environmentPlugin.sharedDuringBuild
            ) {
              for (let k = j; k < config.plugins.length; k++) {
                if (environmentPlugin.name === config.plugins[k].name) {
                  resolvedPlugins[i] = config.plugins[k]
                  j = k + 1
                  break
                }
              }
            }
          }
        }
        environmentConfig = await resolveConfigToBuild(
          inlineConfig,
          patchConfig,
          patchPlugins,
        )
      }
      environmentConfigs.push([environmentName, environmentConfig])
    }
    await Promise.all(
      environmentConfigs.map(
        async ([environmentName, environmentConfig]) =>
          await setupEnvironment(environmentName, environmentConfig),
      ),
    )
  }

  return builder
}

/** 插件在 buildApp 阶段接管 ViteBuilder 编排的钩子签名。 */
export type BuildAppHook = (
  this: MinimalPluginContextWithoutEnvironment,
  builder: ViteBuilder,
) => Promise<void>
