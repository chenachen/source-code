import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build, normalizePath } from 'vite'
import MagicString from 'magic-string'
import type {
  BuildOptions,
  HtmlTagDescriptor,
  Plugin,
  ResolvedConfig,
  Rollup,
} from 'vite'
import type {
  PluginItem as BabelPlugin,
  types as BabelTypes,
} from '@babel/core'
import colors from 'picocolors'
import browserslist from 'browserslist'
import type { Options } from './types'
import {
  createModernChunkLegacyGuard,
  detectModernBrowserCode,
  dynamicFallbackInlineCode,
  legacyEntryId,
  legacyPolyfillId,
  safari10NoModuleFix,
  systemJSInlineCode,
} from './snippets'

// Babel 仅在构建路径使用，首次需要时才动态加载。
let babel: Promise<typeof import('@babel/core')> | undefined
/** 延迟加载并共享 Babel import Promise；开发服务不会走构建转换路径。 */
async function loadBabel() {
  return (babel ??= import('@babel/core'))
}

/** 加载按使用注入全局 polyfill 的两个 Babel 插件；core-js 版本取本插件解析到的依赖。 */
async function loadPolyfillPlugins(): Promise<BabelPlugin[]> {
  return [
    [
      (await import('babel-plugin-polyfill-corejs3')).default,
      {
        method: 'usage-global',
        version: _require('core-js/package.json').version,
        shippedProposals: true,
      },
    ],
    [
      (await import('babel-plugin-polyfill-regenerator')).default,
      {
        method: 'usage-global',
      },
    ],
  ]
}


/** 从 CommonJS 默认导出读取 browserslist 配置加载器，避免依赖命名导出兼容。 */
const { loadConfig: browserslistLoadConfig } = browserslist

// 此实验性 URL 规则与 Vite core build.ts 保持一致；本插件在 HTML 注入时独立使用。
/** 为 HTML 中的构建资源计算 URL；优先使用 renderBuiltUrl 返回值，拒绝 runtime 表达式，否则按相对 base 或 decodedBase 拼接。 */
function toOutputFilePathInHtml(
  filename: string,
  type: 'asset' | 'public',
  hostId: string,
  hostType: 'js' | 'css' | 'html',
  config: ResolvedConfig,
  toRelative: (filename: string, importer: string) => string,
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
    // @ts-expect-error `decodedBase` is internal
    return joinUrlSegments(config.decodedBase, filename)
  }
}
/** 相对 base 时按 HTML 的 root 相对目录计算返回根目录的前缀；显式 base 直接用于资源链接。 */
function getBaseInHTML(urlRelativePath: string, config: ResolvedConfig) {

  return config.base === './' || config.base === ''
    ? path.posix.join(
        path.posix.relative(urlRelativePath, '').slice(0, -2),
        './',
      )
    : config.base
}
/** 拼接 URL 段并统一连接处的斜杠；任一段为空时返回另一段。 */
function joinUrlSegments(a: string, b: string): string {
  if (!a || !b) {
    return a || b || ''
  }
  if (a.endsWith('/')) {
    a = a.substring(0, a.length - 1)
  }
  if (b[0] !== '/') {
    b = '/' + b
  }
  return a + b
}

/** 把产物文件名转换为指定 HTML 的资源地址，复用实验性 renderBuiltUrl 与相对 base 规则。 */
function toAssetPathFromHtml(
  filename: string,
  htmlPath: string,
  config: ResolvedConfig,
): string {
  const relativeUrlPath = normalizePath(path.relative(config.root, htmlPath))
  /** 以当前 HTML 的相对目录为基准生成产物 URL。 */
  const toRelative = (filename: string, _hostId: string) =>
    getBaseInHTML(relativeUrlPath, config) + filename
  return toOutputFilePathInHtml(
    filename,
    'asset',
    htmlPath,
    'html',
    config,
    toRelative,
  )
}

/** 构建 define 阶段留下的 LEGACY 占位标识；现代 chunk 替为 false，legacy Babel 转换替为 true。 */
const legacyEnvVarMarker = `__VITE_IS_LEGACY__`
/** legacy Babel 转换中替为 false 的现代环境占位标识。 */
const modernEnvVarMarker = `__VITE_IS_MODERN__`


/** Vite core 与本插件协作压缩 legacy 输出所需的最低版本。 */
const legacyOxcMinificationSupportedVersion = '8.1.4'

/** 取预发布后缀之前的数字版本段；非数字段按 0 处理，供三段版本比较使用。 */
function parseVersionCore(v: string): number[] {
  return v
    .split('-', 1)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
}

/** 比较 major/minor/patch 三段；相同核心版本下，预发布低于正式版，不比较预发布标识之间的顺序。 */
function isVersionGte(version: string, minVersion: string): boolean {
  const core = parseVersionCore(version)
  const minCore = parseVersionCore(minVersion)
  for (let i = 0; i < 3; i++) {
    if (core[i] !== minCore[i]) return core[i] > minCore[i]
  }
  // 同核心版本时，待比较版本带预发布后缀而最低版本为正式版则不满足。
  return !version.includes('-') || minVersion.includes('-')
}

/** 以插件模块为解析起点读取 core-js 的 package.json。 */
const _require = createRequire(import.meta.url)

/** 识别同一文件名段中有前缀的 hash 占位符，为插入 legacy 后缀选择分支。 */
const nonLeadingHashInFileNameRE = /[^/]+\[hash(?::\d+)?\]/
/** 匹配 hash 占位符及其前一个非单词分隔符，保留原分隔符插入 legacy。 */
const prefixedHashInFileNameRE = /\W?\[hash(?::\d+)?\]/
/** 匹配 rel 为带引号 modulepreload 的 link 标签；仅生成 legacy HTML 时移除它们。 */
export const modulePreloadLinkRE: RegExp =
  /<link(?![\w-])[^>]*?\srel=(['"])modulepreload\1[^>]*>/g


/** 现代输出的默认语法目标，覆盖动态 import、import.meta.resolve 与 async generator 的检测需求。 */
const modernTargetsEsbuild = [
  'es2020',
  'edge105',
  'firefox106',
  'chrome105',
  'safari16.4',
  'ios16.4',
]
// 对应上方目标的 browserslist 写法。
// https://github.com/evanw/esbuild/issues/121#issuecomment-646956379
/** 与现代浏览器默认目标对应的 browserslist 查询，供 Babel polyfill 使用分析。 */
const modernTargetsBabel =
  'edge>=105, firefox>=106, chrome>=105, safari>=16.4, chromeAndroid>=105, iOS>=16.4'

/** 按输出 options 对象身份标记已执行 legacy 转换的输出，供 Vite core 判断压缩等兼容路径。 */
const outputOptionsForLegacyChunks =
  new WeakSet<Rollup.NormalizedOutputOptions>()

/** 仅在当前 Vite 支持且选择 Oxc 时启用 Rolldown 输出压缩；可覆盖压缩阶段的语法 target。 */
function resolveLegacyOutputMinify(
  minify: BuildOptions['minify'],
  supportsOxc: boolean | undefined,
  target?: BuildOptions['target'],
): Rollup.OutputOptions['minify'] {
  const usesOxc = supportsOxc && (minify === 'oxc' || minify === true)
  if (!usesOxc) return false
  if (target === undefined || target === false) return true
  return { compress: { target } }
}

/** 将 legacy 子构建的压缩器映射为受支持的 Oxc、回退 terser 或禁用。 */
function resolveLegacyBuildMinify(
  minify: BuildOptions['minify'],
  supportsOxc: boolean | undefined,
): BuildOptions['minify'] {
  const usesOxc = supportsOxc && (minify === 'oxc' || minify === true)
  return usesOxc ? 'oxc' : minify ? 'terser' : false
}

/**
 * 组合配置、polyfill 生成与 chunk/HTML 后处理三个插件。
 * 两类输出不能同时关闭；共享 facade 映射把子构建 polyfill 和 legacy 入口关联到 HTML，按输出收集的 polyfill 在 generateBundle 汇总。
 */
function viteLegacyPlugin(options: Options = {}): Plugin[] {
  let config: ResolvedConfig
  let targets: Options['targets']
  const modernTargets: Options['modernTargets'] =
    options.modernTargets || modernTargetsBabel

  const genLegacy = options.renderLegacyChunks !== false
  const genModern = options.renderModernChunks !== false
  if (!genLegacy && !genModern) {
    throw new Error(
      '`renderLegacyChunks` and `renderModernChunks` cannot be both false',
    )
  }

  const debugFlags = (process.env.DEBUG || '').split(',')
  const isDebug =
    debugFlags.includes('vite:*') || debugFlags.includes('vite:legacy')

  const assumptions = options.assumptions || {}

  const facadeToLegacyChunkMap = new Map()
  const facadeToLegacyImportMap = new Map<string | null, Rollup.OutputAsset>()
  const facadeToLegacyPolyfillMap = new Map()
  const facadeToModernPolyfillMap = new Map()
  const modernPolyfills = new Set<string>()
  const legacyPolyfills = new Set<string>()
  // renderChunk 可并行完成；先按每个输出的 chunk 顺序建表，再在 generateBundle 合并。
  const outputToChunkFileNameToPolyfills = new WeakMap<
    Rollup.NormalizedOutputOptions,
    Map<string, { modern: Set<string>; legacy: Set<string> }> | null
  >()

  if (Array.isArray(options.modernPolyfills) && genModern) {
    options.modernPolyfills.forEach((i) => {
      modernPolyfills.add(
        i.includes('/') ? `core-js/${i}` : `core-js/modules/${i}.js`,
      )
    })
  }
  if (Array.isArray(options.additionalModernPolyfills)) {
    options.additionalModernPolyfills.forEach((i) => {
      modernPolyfills.add(i)
    })
  }
  if (Array.isArray(options.polyfills)) {
    options.polyfills.forEach((i) => {
      if (i.startsWith(`regenerator`)) {
        legacyPolyfills.add(`regenerator-runtime/runtime.js`)
      } else {
        legacyPolyfills.add(
          i.includes('/') ? `core-js/${i}` : `core-js/modules/${i}.js`,
        )
      }
    })
  }
  if (Array.isArray(options.additionalLegacyPolyfills)) {
    options.additionalLegacyPolyfills.forEach((i) => {
      legacyPolyfills.add(i)
    })
  }

  let overriddenBuildTarget = false
  let overriddenBuildTargetOnlyModern = false
  let overriddenDefaultModernTargets = false
  const legacyConfigPlugin: Plugin = {
    name: 'vite:legacy-config',

    /** 仅客户端构建重设语法目标及必要 CSS target；为 LEGACY 注入构建占位标识，serve/SSR 则定义为 false。 */
    async config(config, env) {
      if (env.command === 'build' && !config.build?.ssr) {
        if (!config.build) {
          config.build = {}
        }

        if (genLegacy && !config.build.cssTarget) {
          // 用 chrome61 CSS target 避免压缩器生成 legacy 浏览器不支持的 HexRGBA。
          // 兼容表：https://github.com/evanw/esbuild/blob/78e04680228cf989bdd7d471e02bbc2c8d345dc9/internal/compat/css_table.go
          // HSL/rebeccapurple 本身会被压缩改写，此处关键是 HexRGBA。
          config.build.cssTarget = 'chrome61'
        }

        if (genLegacy) {
          // 这里的现代默认目标与 Vite core 默认目标不同。
          // https://github.com/vitejs/vite/pull/10052#issuecomment-1242076461
          overriddenBuildTarget = config.build.target !== undefined
          overriddenDefaultModernTargets = options.modernTargets !== undefined
        } else {
          overriddenBuildTargetOnlyModern = config.build.target !== undefined
        }

        if (options.modernTargets) {
          // 转换器包仅提供 ESM，使用动态 import。
          const { default: browserslistToEsbuild } =
            await import('browserslist-to-esbuild')
          config.build.target = browserslistToEsbuild(options.modernTargets)
        } else {
          config.build.target = modernTargetsEsbuild
        }
      }

      return {
        define: {
          'import.meta.env.LEGACY':
            env.command === 'serve' || config.build?.ssr
              ? false
              : legacyEnvVarMarker,
        },
      }
    },
    /** 报告目标被覆盖及 worker 插件用法限制；不执行 chunk 转换。 */
    configResolved(config) {
      if (overriddenBuildTarget) {
        config.logger.warn(
          colors.yellow(
            `plugin-legacy overrode 'build.target'. You should pass 'targets' as an option to this plugin with the list of legacy browsers to support instead.`,
          ),
        )
      }
      if (overriddenBuildTargetOnlyModern) {
        config.logger.warn(
          colors.yellow(
            `plugin-legacy overrode 'build.target'. You should pass 'modernTargets' as an option to this plugin with the list of browsers to support instead.`,
          ),
        )
      }
      if (overriddenDefaultModernTargets) {
        config.logger.warn(
          colors.yellow(
            `plugin-legacy 'modernTargets' option overrode the builtin targets of modern chunks. Some versions of browsers between legacy and modern may not be supported.`,
          ),
        )
      }
      if (config.isWorker) {
        config.logger.warn(
          colors.yellow(
            `plugin-legacy should not be passed to 'worker.plugins'. Pass to 'plugins' instead. Note that generating legacy chunks for workers are not supported by plugin-legacy.`,
          ),
        )
      }
    },
  }

  let supportsLegacyOxcMinification: boolean | undefined
  const legacyGenerateBundlePlugin: Plugin = {
    name: 'vite:legacy-generate-polyfill-chunk',
    apply: 'build',

    /** 按当前输出合并收集到的 polyfill，并子构建 ES 现代 polyfill 或 IIFE legacy polyfill；legacy 的 Promise 需求也覆盖 SystemJS。 */
    async generateBundle(opts, bundle) {
      if (config.build.ssr) {
        return
      }

      const chunkFileNameToPolyfills =
        outputToChunkFileNameToPolyfills.get(opts)
      if (chunkFileNameToPolyfills == null) {
        throw new Error(
          'Internal @vitejs/plugin-legacy error: discovered polyfills should exist',
        )
      }

      if (!isLegacyBundle(bundle)) {
        // 按预建表顺序合并本输出的现代 polyfill。
        for (const { modern } of chunkFileNameToPolyfills.values()) {
          modern.forEach((p) => modernPolyfills.add(p))
        }
        if (!modernPolyfills.size) {
          return
        }
        if (isDebug) {
          console.log(
            `[@vitejs/plugin-legacy] modern polyfills:`,
            modernPolyfills,
          )
        }
        await buildPolyfillChunk(
          this,
          config.mode,
          modernPolyfills,
          bundle,
          facadeToModernPolyfillMap,
          config.build,
          'es',
          opts,
          true,
          genLegacy,
          supportsLegacyOxcMinification,
        )
        return
      }

      if (!genLegacy) {
        return
      }

      // 按预建表顺序合并本输出的 legacy polyfill。
      for (const { legacy } of chunkFileNameToPolyfills.values()) {
        legacy.forEach((p) => legacyPolyfills.add(p))
      }

      // 此处处理 legacy 输出。
      if (options.polyfills !== false) {
        // SystemJS 依赖 Promise，额外检测其解析和聚合 API 是否需要 polyfill。
        // https://github.com/systemjs/systemjs#ie11-support
        await detectPolyfills(
          `Promise.resolve(); Promise.all();`,
          targets,
          assumptions,
          legacyPolyfills,
        )
      }

      if (legacyPolyfills.size || !options.externalSystemJS) {
        if (isDebug) {
          console.log(
            `[@vitejs/plugin-legacy] legacy polyfills:`,
            legacyPolyfills,
          )
        }

        await buildPolyfillChunk(
          this,
          config.mode,
          legacyPolyfills,
          bundle,
          facadeToLegacyPolyfillMap,
          // 未支持 legacy Oxc 时，启用压缩的 polyfill 子构建回退到 terser。
          config.build,
          'iife',
          opts,
          options.externalSystemJS,
          false,
          supportsLegacyOxcMinification,
          // 限制 legacy polyfill 压缩产生的语法。
          'es2015',
        )
      }
    },
  }

  const legacyPostPlugin: Plugin = {
    name: 'vite:legacy-post-process',
    enforce: 'post',
    apply: 'build',

    /** 将本次输出的 chunk polyfill 收集表重置为待初始化状态。 */
    renderStart(opts) {
      // 每次输出重新收集，不复用上一轮表。
      outputToChunkFileNameToPolyfills.set(opts, null)
    },

    /** 拒绝 library 模式，检测 core 的 legacy Oxc 能力，并在客户端 legacy 构建中把 legacy 输出排到现代输出之前。 */
    configResolved(_config) {
      if (_config.build.lib) {
        throw new Error('@vitejs/plugin-legacy does not support library mode.')
      }
      config = _config

      const viteVersion = this.meta.viteVersion
      supportsLegacyOxcMinification =
        !!viteVersion &&
        isVersionGte(viteVersion, legacyOxcMinificationSupportedVersion)

      if (!supportsLegacyOxcMinification && config.build.minify === 'oxc') {
        config.logger.warn(
          colors.yellow(
            `'oxc' minifier is not supported for legacy chunks by Vite version ${viteVersion}. ` +
              `Please upgrade to Vite version ${legacyOxcMinificationSupportedVersion} or later.`,
          ),
        )
      }

      if (isDebug) {
        console.log(`[@vitejs/plugin-legacy] modernTargets:`, modernTargets)
      }

      if (!genLegacy || config.build.ssr) {
        return
      }

      targets =
        options.targets ||
        browserslistLoadConfig({ path: config.root }) ||
        'last 2 versions and not dead, > 0.3%, Firefox ESR'
      if (isDebug) {
        console.log(`[@vitejs/plugin-legacy] targets:`, targets)
      }

      /** 保留用户输出命名规则，在 name、带前缀 hash 或扩展名前插入 legacy 标识；未配置时使用默认资源目录。 */
      const getLegacyOutputFileName = (
        fileNames:
          | string
          | ((chunkInfo: Rollup.PreRenderedChunk) => string)
          | undefined,
        defaultFileName = '[name]-legacy-[hash].js',
      ): string | ((chunkInfo: Rollup.PreRenderedChunk) => string) => {
        if (!fileNames) {
          return path.posix.join(config.build.assetsDir, defaultFileName)
        }

        return (chunkInfo) => {
          let fileName =
            typeof fileNames === 'function' ? fileNames(chunkInfo) : fileNames

          if (fileName.includes('[name]')) {
            // [name]-[hash].[format] -> [name]-legacy-[hash].[format]
            fileName = fileName.replace('[name]', '[name]-legacy')
          } else if (nonLeadingHashInFileNameRE.test(fileName)) {
            // custom[hash].[format] -> [name]-legacy[hash].[format]
            // custom-[hash].[format] -> [name]-legacy-[hash].[format]
            // custom.[hash].[format] -> [name]-legacy.[hash].[format]
            // custom.[hash:10].[format] -> custom-legacy.[hash:10].[format]
            fileName = fileName.replace(prefixedHashInFileNameRE, '-legacy$&')
          } else {
            // entry.js -> entry-legacy.js
            // entry.min.js -> entry-legacy.min.js
            fileName = fileName.replace(/(.+?)\.(.+)/, '$1-legacy.$2')
          }

          return fileName
        }
      }

      /** 复制用户输出选项，先以 ESM 渲染供 Babel 后处理，并使用 legacy 文件名及兼容压缩目标。 */
      const createLegacyOutput = (
        options: Rollup.OutputOptions = {},
      ): Rollup.OutputOptions => {
        return {
          ...options,
          format: 'esm',
          entryFileNames: getLegacyOutputFileName(options.entryFileNames),
          chunkFileNames: getLegacyOutputFileName(options.chunkFileNames),
          minify: resolveLegacyOutputMinify(
            config.build.minify,
            supportsLegacyOxcMinification,
            // 限制 legacy 压缩产生的语法。
            'es2015',
          ),
        }
      }

      const { rolldownOptions } = config.build
      const { output } = rolldownOptions
      if (Array.isArray(output)) {
        rolldownOptions.output = [
          ...output.map(createLegacyOutput),
          ...(genModern ? output : []),
        ]
      } else {
        rolldownOptions.output = [
          createLegacyOutput(output),
          ...(genModern ? [output || {}] : []),
        ]
      }

      /** 向 Vite core 注入按 options 对象身份查询的判定；对应输出进入 legacy renderChunk 后才被登记。 */
      // @ts-expect-error is readonly but should be injected here
      _config.isOutputOptionsForLegacyChunks = (
        opts: Rollup.NormalizedOutputOptions,
      ): boolean => outputOptionsForLegacyChunks.has(opts)
    },

    /**
     * 按 chunk 文件名选择现代保护代码或 legacy Babel/SystemJS 转换，并收集本 chunk 的 polyfill。
     * 每个输出按 chunks 的键顺序预建收集表，避免异步 hook 完成顺序改变合并次序；SSR 不处理，legacy 输出同时登记 options 身份。
     */
    async renderChunk(raw, chunk, opts, { chunks }) {
      if (config.build.ssr) {
        return null
      }

      // 首个 hook 调用按 chunks 的键顺序初始化收集表。
      let chunkFileNameToPolyfills = outputToChunkFileNameToPolyfills.get(opts)
      if (chunkFileNameToPolyfills == null) {
        chunkFileNameToPolyfills = new Map()
        for (const fileName in chunks) {
          chunkFileNameToPolyfills.set(fileName, {
            modern: new Set(),
            legacy: new Set(),
          })
        }
        outputToChunkFileNameToPolyfills.set(opts, chunkFileNameToPolyfills)
      }
      const polyfillsDiscovered = chunkFileNameToPolyfills.get(chunk.fileName)
      if (polyfillsDiscovered == null) {
        throw new Error(
          `Internal @vitejs/plugin-legacy error: discovered polyfills for ${chunk.fileName} should exist`,
        )
      }

      if (!isLegacyChunk(chunk)) {
        if (
          options.modernPolyfills &&
          !Array.isArray(options.modernPolyfills) &&
          genModern
        ) {
          // 自动模式按目标浏览器分析使用到的现代 polyfill。
          await detectPolyfills(
            raw,
            modernTargets,
            assumptions,
            polyfillsDiscovered.modern,
          )
        }

        const ms = new MagicString(raw)

        if (genLegacy && chunk.isEntry) {
          // 在现代入口之前执行能力 guard，不支持的浏览器会先抛错。
          ms.prepend(createModernChunkLegacyGuard(chunk.fileName))
        }

        if (raw.includes(legacyEnvVarMarker)) {
          const re = new RegExp(legacyEnvVarMarker, 'g')
          let match
          while ((match = re.exec(raw))) {
            ms.overwrite(
              match.index,
              match.index + legacyEnvVarMarker.length,
              `false`,
            )
          }
        }

        if (config.build.sourcemap) {
          return {
            code: ms.toString(),
            map: ms.generateMap({ hires: 'boundary' }),
          }
        }
        return {
          code: ms.toString(),
        }
      }

      if (!genLegacy) {
        return null
      }

      outputOptionsForLegacyChunks.add(opts)

      // false 或显式列表关闭自动使用分析；显式列表已在工厂阶段加入集合。
      const needPolyfills =
        options.polyfills !== false && !Array.isArray(options.polyfills)

      // 用 Babel preset-env 降低 legacy 语法。
      const sourceMaps = !!config.build.sourcemap
      const babel = await loadBabel()

      // 先独立转 SystemJS，再执行使用分析与 polyfill import 移除。
      const resultSystem = babel.transform(raw, {
        babelrc: false,
        configFile: false,
        ast: true,
        code: false,
        sourceMaps,
        plugins: [
          // @ts-expect-error -- not typed
          (await import('@babel/plugin-transform-dynamic-import')).default,
          // @ts-expect-error -- not typed
          (await import('@babel/plugin-transform-modules-systemjs')).default,
        ],
      })

      const polyfillPlugins = needPolyfills ? await loadPolyfillPlugins() : []
      const babelTransformOptions: babel.TransformOptions = {
        babelrc: false,
        configFile: false,
        cloneInputAst: false,
        compact: !!config.build.minify,
        sourceMaps,
        inputSourceMap: undefined,
        targets,
        assumptions,
        browserslistConfigFile: false,
        // presets 逆序应用：最后的 polyfill 插件先按使用注入 imports，
        // preset-env 再转换语法，最后收集/移除注入的 imports 并用 IIFE 包装。
        presets: [
          [
            () => ({
              plugins: [
                recordAndRemovePolyfillBabelPlugin(polyfillsDiscovered.legacy),
                replaceLegacyEnvBabelPlugin(),
                replaceModernEnvBabelPlugin(),
                wrapIIFEBabelPlugin(),
              ],
            }),
          ],
          [
            (await import('@babel/preset-env')).default,
            {
              bugfixes: true,
              modules: false,
              shippedProposals: true,
            },
          ],
          [() => ({ plugins: polyfillPlugins })],
        ],
      }
      let result: babel.BabelFileResult | null
      if (resultSystem) {
        result = babel.transformFromAstSync(
          resultSystem.ast!,
          undefined,
          babelTransformOptions,
        )
      } else {
        result = babel.transform(raw, babelTransformOptions)
      }
      if (result) return { code: result.code!, map: result.map }
      return null
    },

    /**
     * 先记录 legacy facade 与 import map，再按输出开关注入现代 polyfill、Safari 修复、legacy polyfill/入口及动态回退。
     * 现代与 legacy 共存时，legacy HTML 只登记关联；最终脚本的 data-src 保持内联文本稳定，CSP hash 可复用。缺失应有的入口或 polyfill 时抛错。
     */
    transformIndexHtml(html, { chunk, bundle }) {
      if (config.build.ssr) return
      if (!chunk) return
      if (chunk.fileName.includes('-legacy')) {
        // legacy 输出先构建；有现代输出时这里只登记 facade 关联，HTML 由后续现代输出生成。
        facadeToLegacyChunkMap.set(chunk.facadeModuleId, chunk.fileName)
        if (config.environments.client.build.chunkImportMap) {
          facadeToLegacyImportMap.set(
            chunk.facadeModuleId,
            bundle![getImportMapFilename(config)]! as Rollup.OutputAsset,
          )
        }
        if (genModern) {
          return
        }
      }
      if (!genModern) {
        html = html
          .replace(/<script type="module".*?<\/script>/g, '')
          .replace(modulePreloadLinkRE, '')
      }

      const tags: HtmlTagDescriptor[] = []
      const htmlFilename = chunk.facadeModuleId?.replace(/\?.*$/, '')

      // 1. 注入现代 polyfill。
      if (genModern) {
        const modernPolyfillFilename = facadeToModernPolyfillMap.get(
          chunk.facadeModuleId,
        )

        if (modernPolyfillFilename) {
          tags.push({
            tag: 'script',
            attrs: {
              type: 'module',
              crossorigin: true,
              src: toAssetPathFromHtml(
                modernPolyfillFilename,
                chunk.facadeModuleId!,
                config,
              ),
            },
          })
        } else if (modernPolyfills.size) {
          throw new Error(
            `No corresponding modern polyfill chunk found for ${htmlFilename}`,
          )
        }
      }

      if (!genLegacy) {
        return { html, tags }
      }

      // 2. 注入 SystemJS import map。
      if (config.environments.client.build.chunkImportMap) {
        const importMap = facadeToLegacyImportMap.get(chunk.facadeModuleId)!
        const decoder = new TextDecoder()
        tags.push({
          tag: 'script',
          attrs: { type: 'systemjs-importmap' },
          children:
            typeof importMap.source === 'string'
              ? importMap.source
              : decoder.decode(importMap.source),
          injectTo: 'head',
        })
      }

      // 3. 注入 Safari 10 nomodule 修复。
      if (genModern) {
        tags.push({
          tag: 'script',
          attrs: { nomodule: genModern },
          children: safari10NoModuleFix,
          injectTo: 'body',
        })
      }

      // 4. 注入 legacy polyfill。
      const legacyPolyfillFilename = facadeToLegacyPolyfillMap.get(
        chunk.facadeModuleId,
      )
      if (legacyPolyfillFilename) {
        tags.push({
          tag: 'script',
          attrs: {
            nomodule: genModern,
            crossorigin: true,
            id: legacyPolyfillId,
            src: toAssetPathFromHtml(
              legacyPolyfillFilename,
              chunk.facadeModuleId!,
              config,
            ),
          },
          injectTo: 'body',
        })
      } else if (legacyPolyfills.size) {
        throw new Error(
          `No corresponding legacy polyfill chunk found for ${htmlFilename}`,
        )
      }

      // 5. 注入 legacy 入口。
      const legacyEntryFilename = facadeToLegacyChunkMap.get(
        chunk.facadeModuleId,
      )
      if (legacyEntryFilename) {
        // SystemJS 用 assets/foo.js 路径导入对应的具名 register。
        tags.push({
          tag: 'script',
          attrs: {
            nomodule: genModern,
            crossorigin: true,
            // 入口路径放到 data-src 属性，内联脚本内容固定，CSP hash 可复用。
            id: legacyEntryId,
            'data-src': toAssetPathFromHtml(
              legacyEntryFilename,
              chunk.facadeModuleId!,
              config,
            ),
          },
          children: systemJSInlineCode,
          injectTo: 'body',
        })
      } else {
        throw new Error(
          `No corresponding legacy entry chunk found for ${htmlFilename}`,
        )
      }

      // 6. 现代能力检测未通过时，动态加载 legacy polyfill 与入口。
      if (legacyPolyfillFilename && legacyEntryFilename && genModern) {
        tags.push({
          tag: 'script',
          attrs: { type: 'module' },
          children: detectModernBrowserCode,
          injectTo: 'head',
        })
        tags.push({
          tag: 'script',
          attrs: { type: 'module' },
          children: dynamicFallbackInlineCode,
          injectTo: 'head',
        })
      }

      return {
        html,
        tags,
      }
    },

    /** 现代输出也会生成时，从 legacy bundle 删除重复资源；保留 map、legacy 产物和 import map。 */
    generateBundle(_opts, bundle) {
      if (config.build.ssr) {
        return
      }

      if (isLegacyBundle(bundle) && genModern) {
        const importMapFilename = getImportMapFilename(config)
        // 现代输出也会生成时删除 legacy bundle 中重复的资源。
        for (const name in bundle) {
          if (
            bundle[name].type === 'asset' &&
            !name.endsWith('.map') &&
            !name.includes('-legacy') && // 保留 legacy 产物
            name !== importMapFilename // 由 import analysis build 插件处理
          ) {
            delete bundle[name]
          }
        }
      }
    },
  }

  return [legacyConfigPlugin, legacyGenerateBundlePlugin, legacyPostPlugin]
}

/** 读取 chunkImportMap 的自定义 fileName，否则使用 importmap.json。 */
function getImportMapFilename(config: ResolvedConfig): string {
  const chunkImportMap =
    config.build.rolldownOptions.experimental?.chunkImportMap
  if (typeof chunkImportMap === 'object' && chunkImportMap.fileName) {
    return chunkImportMap.fileName
  }
  return 'importmap.json'
}

/** 用 Babel usage-global 分析 code，把生成的 core-js/regenerator 导入加入调用者提供的集合；不输出转换代码。 */
export async function detectPolyfills(
  code: string,
  targets: any,
  assumptions: Record<string, boolean>,
  list: Set<string>,
): Promise<void> {
  const babel = await loadBabel()
  const result = babel.transform(code, {
    ast: true,
    code: false,
    babelrc: false,
    configFile: false,
    compact: false,
    targets,
    assumptions,
    browserslistConfigFile: false,
    plugins: await loadPolyfillPlugins(),
  })
  for (const node of result!.ast!.program.body) {
    if (node.type === 'ImportDeclaration') {
      const source = node.source.value
      if (
        source.startsWith('core-js/') ||
        source.startsWith('regenerator-runtime/')
      ) {
        list.add(source)
      }
    }
  }
}

/**
 * 从插件所在目录子构建 polyfill 入口，关闭文件写入，再把入口及 sourcemap 作为预构建产物发回父 bundle。
 * 每个已有 facade 都关联到这个 polyfill 文件名，HTML 后处理据此查找；格式、命名和 sourcemap 设置继承父输出，legacy 可覆盖压缩 target。
 */
async function buildPolyfillChunk(
  ctx: Rollup.PluginContext,
  mode: string,
  imports: Set<string>,
  bundle: Rollup.OutputBundle,
  facadeToChunkMap: Map<string, string>,
  buildOptions: BuildOptions,
  format: 'iife' | 'es',
  rollupOutputOptions: Rollup.NormalizedOutputOptions,
  excludeSystemJS?: boolean,
  prependModenChunkLegacyGuard?: boolean,
  supportsLegacyOxcMinification?: boolean,
  overrideMinifyCompressTarget?: BuildOptions['target'],
) {
  const { assetsDir, sourcemap, target } = buildOptions
  const minifyCompressTarget = overrideMinifyCompressTarget ?? target
  const minify = resolveLegacyBuildMinify(
    buildOptions.minify,
    supportsLegacyOxcMinification,
  )
  const res = await build({
    mode,
    // polyfill 与 SystemJS 均从插件安装位置解析。
    root: path.dirname(fileURLToPath(import.meta.url)),
    configFile: false,
    logLevel: 'error',
    plugins: [
      polyfillsPlugin(imports, excludeSystemJS),
      prependModenChunkLegacyGuard && prependModenChunkLegacyGuardPlugin(),
    ],
    build: {
      write: false,
      minify,
      assetsDir,
      sourcemap,
      rolldownOptions: {
        input: {
          polyfills: polyfillId,
        },
        output: {
          format,
          hashCharacters: rollupOutputOptions.hashCharacters,
          entryFileNames: rollupOutputOptions.entryFileNames,
          sourcemapBaseUrl: rollupOutputOptions.sourcemapBaseUrl,
          minify: resolveLegacyOutputMinify(
            buildOptions.minify,
            supportsLegacyOxcMinification,
            minifyCompressTarget,
          ),
        },
      },
    },
    // 关闭 esbuild 转换；此子构建只打包 polyfill。
    esbuild: false,
    optimizeDeps: {
      esbuildOptions: {
        // 保留 esbuild 兼容选项的 es5 目标，避免旧转换路径注入 ES2015 helper；
        // 这里的 CommonJS 输入 core-js 本身不使用 ES2015+ 语法。
        target: 'es5',
      },
    },
  })
  const _polyfillChunk = Array.isArray(res) ? res[0] : res
  if (!('output' in _polyfillChunk)) return
  const polyfillChunk = _polyfillChunk.output.find(
    (chunk) => chunk.type === 'chunk' && chunk.isEntry,
  ) as Rollup.OutputChunk

  // 为所有带 facade 的 chunk 登记 polyfill 文件，HTML 转换据此查找。
  for (const key in bundle) {
    const chunk = bundle[key]
    if (chunk.type === 'chunk' && chunk.facadeModuleId) {
      facadeToChunkMap.set(chunk.facadeModuleId, polyfillChunk.fileName)
    }
  }

  // 以预构建 chunk 形式发回父 bundle。
  ctx.emitFile({
    type: 'prebuilt-chunk',
    name: polyfillChunk.name,
    fileName: polyfillChunk.fileName,
    code: polyfillChunk.code,
    facadeModuleId: polyfillChunk.facadeModuleId ?? undefined,
    isEntry: polyfillChunk.isEntry,
    isDynamicEntry: polyfillChunk.isDynamicEntry,
    exports: [],
    map: polyfillChunk.map ?? undefined,
    sourcemapFileName: polyfillChunk.sourcemapFileName ?? undefined,
  })
  if (polyfillChunk.sourcemapFileName) {
    const polyfillChunkMapAsset = _polyfillChunk.output.find(
      (chunk) =>
        chunk.type === 'asset' &&
        chunk.fileName === polyfillChunk.sourcemapFileName,
    ) as Rollup.OutputAsset | undefined
    if (polyfillChunkMapAsset) {
      ctx.emitFile({
        type: 'asset',
        fileName: polyfillChunkMapAsset.fileName,
        source: polyfillChunkMapAsset.source,
      })
    }
  }
}

/** polyfill 子构建使用的空字符虚拟入口。 */
const polyfillId = '\0vite/legacy-polyfills'

/** 提供 polyfill 子构建的虚拟入口，按集合生成静态导入并可附加 SystemJS。 */
function polyfillsPlugin(
  imports: Set<string>,
  excludeSystemJS?: boolean,
): Plugin {
  return {
    name: 'vite:legacy-polyfills',
    /** 仅解析本插件的 polyfill 虚拟入口。 */
    resolveId(id) {
      if (id === polyfillId) {
        return id
      }
    },
    /** 为虚拟入口生成 polyfill imports；未排除 SystemJS 时附加其压缩运行时。 */
    load(id) {
      if (id === polyfillId) {
        return (
          [...imports].map((i) => `import ${JSON.stringify(i)};`).join('') +
          (excludeSystemJS ? '' : `import "systemjs/dist/s.min.js";`)
        )
      }
    },
  }
}

/** 为现代 polyfill 子构建前置浏览器能力 guard，并按子构建 sourcemap 设置生成映射。 */
function prependModenChunkLegacyGuardPlugin(): Plugin {
  let sourceMapEnabled!: boolean
  return {
    name: 'vite:legacy-prepend-moden-chunk-legacy-guard',
    /** 记录子构建是否需要 guard 的 sourcemap。 */
    configResolved(config) {
      sourceMapEnabled = !!config.build.sourcemap
    },
    /** 把带 chunk 唯一标识的现代能力 guard 放在代码之前；需要映射时用 MagicString。 */
    renderChunk(code, chunk) {
      const modernChunkLegacyGuard = createModernChunkLegacyGuard(
        chunk.fileName,
      )
      if (!sourceMapEnabled) {
        return modernChunkLegacyGuard + code
      }

      const ms = new MagicString(code)
      ms.prepend(modernChunkLegacyGuard)
      return {
        code: ms.toString(),
        map: ms.generateMap({ hires: 'boundary' }),
      }
    },
  }
}

/** 按生成文件名是否包含 -legacy 识别 legacy chunk。 */
function isLegacyChunk(chunk: Rollup.RenderedChunk) {
  return chunk.fileName.includes('-legacy')
}

/** 找到首个入口 chunk，再按其 -legacy 文件名标识判断当前 bundle。 */
function isLegacyBundle(bundle: Rollup.OutputBundle) {
  const entryChunk = Object.values(bundle).find(
    (output) => output.type === 'chunk' && output.isEntry,
  )

  return !!entryChunk && entryChunk.fileName.includes('-legacy')
}

/** 创建 Babel 后处理插件，把注入的 import 记录到 polyfill 集合并从 chunk AST 删除。 */
function recordAndRemovePolyfillBabelPlugin(
  polyfills: Set<string>,
): BabelPlugin {
  return ({ types: t }: { types: typeof BabelTypes }): BabelPlugin => ({
    name: 'vite-remove-polyfill-import',
    /** 在 Babel 转换完成后收集并移除顶层 import，由独立 polyfill chunk 提供运行时实现。 */
    post({ path }) {
      path.get('body').forEach((p) => {
        if (t.isImportDeclaration(p.node)) {
          polyfills.add(p.node.source.value)
          p.remove()
        }
      })
    },
  })
}

/** 创建 Babel visitor，把 LEGACY 占位 Identifier 替为 true。 */
function replaceLegacyEnvBabelPlugin(): BabelPlugin {
  return ({ types: t }): BabelPlugin => ({
    name: 'vite-replace-env-legacy',
    visitor: {
      /** 在 legacy AST 中把匹配占位名称的 Identifier 替为布尔 true。 */
      Identifier(path) {
        if (path.node.name === legacyEnvVarMarker) {
          path.replaceWith(t.booleanLiteral(true))
        }
      },
    },
  })
}

/** 创建 Babel visitor，把现代环境占位 Identifier 替为 false。 */
function replaceModernEnvBabelPlugin(): BabelPlugin {
  return ({ types: t }): BabelPlugin => ({
    name: 'vite-replace-env-modern',
    visitor: {
      /** 在 legacy AST 中把匹配现代占位名称的 Identifier 替为布尔 false。 */
      Identifier(path) {
        if (path.node.name === modernEnvVarMarker) {
          path.replaceWith(t.booleanLiteral(false))
        }
      },
    },
  })
}

/** 创建 Babel 后处理插件，将转换后的 Program body 放进立即执行函数。 */
function wrapIIFEBabelPlugin(): BabelPlugin {
  return ({ types: t, template }): BabelPlugin => {
    const buildIIFE = template(';(function(){%%body%%})();')

    return {
      name: 'vite-wrap-iife',
      /** 以插件实例的 isWrapped 标记避免重复包装，再用 IIFE Program 替换当前 AST。 */
      post({ path }) {
        if (!this.isWrapped) {
          this.isWrapped = true
          path.replaceWith(t.program(buildIIFE({ body: path.node.body })))
        }
      },
    }
  }
}

/** 四段固定 HTML 内联脚本的 SHA-256 base64 值，供 CSP script-src 使用；不包含逐 chunk 的 guard。 */
export const cspHashes: string[] = [
  safari10NoModuleFix,
  systemJSInlineCode,
  detectModernBrowserCode,
  dynamicFallbackInlineCode,
].map((i) => crypto.hash('sha256', i, 'base64'))

export type { Options }

export default viteLegacyPlugin

// require 兼容入口。
/** 将 require 兼容导出转发到主插件工厂，并在下方附带相同辅助导出。 */
function viteLegacyPluginCjs(this: unknown, options: Options): Plugin[] {
  return viteLegacyPlugin.call(this, options)
}
Object.assign(viteLegacyPluginCjs, {
  cspHashes,
  default: viteLegacyPluginCjs,
  detectPolyfills,
})

export { viteLegacyPluginCjs as 'module.exports' }
