import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import postcssrc from 'postcss-load-config'
import type {
  ExistingRawSourceMap,
  InternalModuleFormat,
  MinimalPluginContext,
  OutputAsset,
  OutputChunk,
  RenderedChunk,
  RenderedModule,
  RollupError,
  SourceMapInput,
} from 'rolldown'
import { dataToEsm } from '@rollup/pluginutils'
import colors from 'picocolors'
import MagicString from 'magic-string'
import type * as PostCSS from 'postcss'
import type Sass from 'sass'
import type Stylus from 'stylus'
import type Less from 'less'
import type { RawSourceMap } from '@jridgewell/remapping'
import { WorkerWithFallback } from 'artichokie'
import { globSync } from 'tinyglobby'
import type {
  TransformAttributeResult as LightningCssTransformAttributeResult,
  TransformResult as LightningCssTransformResult,
} from 'lightningcss'
import type { LightningCSSOptions } from '#types/internal/lightningcssOptions'
import type {
  LessPreprocessorBaseOptions,
  SassModernPreprocessBaseOptions,
  StylusPreprocessorBaseOptions,
} from '#types/internal/cssPreprocessorOptions'
import type { EsbuildTransformOptions } from '#types/internal/esbuildOptions'
import type { CustomPluginOptionsVite } from '#types/metadata'
import { getCodeWithSourcemap, injectSourcesContent } from '../server/sourcemap'
import type { EnvironmentModuleNode } from '../server/moduleGraph'
import {
  createToImportMetaURLBasedRelativeRuntime,
  resolveUserExternal,
  toOutputFilePathInCss,
  toOutputFilePathInJS,
} from '../build'
import type { LibraryOptions } from '../build'
import {
  CLIENT_PUBLIC_PATH,
  CSS_LANGS_RE,
  DEV_PROD_CONDITION,
  ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET,
  SPECIAL_QUERY_RE,
} from '../constants'
import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
import { checkPublicFile } from '../publicDir'
import {
  _dirname,
  arraify,
  asyncReplace,
  combineSourcemaps,
  createSerialPromiseQueue,
  emptyCssComments,
  encodeURIPath,
  escapeRegex,
  generateCodeFrame,
  getFileStartIndex,
  getHash,
  getPackageManagerCommand,
  getPkgName,
  injectQuery,
  isCSSRequest,
  isDataUrl,
  isExternalUrl,
  isObject,
  joinUrlSegments,
  lineTerminatorRE,
  mergeWithDefaults,
  normalizePath,
  processSrcSet,
  removeDirectQuery,
  removeUrlQuery,
  stripBomTag,
  urlRE,
} from '../utils'
import type { Logger } from '../logger'
import { cleanUrl, isWindows, slash } from '../../shared/utils'
import { NULL_BYTE_PLACEHOLDER } from '../../shared/constants'
import { createBackCompatIdResolver } from '../idResolver'
import type { ResolveIdFn } from '../idResolver'
import { PartialEnvironment } from '../baseEnvironment'
import type { TransformPluginContext } from '../server/pluginContainer'
import { searchForWorkspaceRoot } from '../server/searchRoot'
import { type DevEnvironment } from '..'
import type { PackageCache } from '../packages'
import { findNearestMainPackageData } from '../packages'
import { nodeResolveWithVite } from '../nodeResolve'
import { addToHTMLProxyTransformResult, getImportMap } from './html'
import {
  assetUrlRE,
  cssEntriesMap,
  fileToUrl,
  publicAssetUrlCache,
  publicAssetUrlRE,
  publicFileToBuiltUrl,
  renderAssetUrlInJS,
} from './asset'
import type { ESBuildOptions } from './esbuild'
import { getChunkOriginalFileName } from './manifest'
import { IIFE_BEGIN_RE, UMD_BEGIN_RE } from './oxc'

/** 复用 UTF-8 解码器，把 CSS 资源字节转换为可处理文本。 */
const decoder = new TextDecoder()
// 调试 CSS 阶段时可临时启用 createDebugger('vite:css')。

/**
 * Vite 当前 `postcss-load-config` 版本支持的配置形状（如 postcss.config.js）。重新导出它可让用户编写
 * 类型安全的 PostCSS 配置：
 *
 * ```ts
 * import type { PostcssUserConfig } from 'vite'
 *
 * const config: PostcssUserConfig = { plugins: [] }
 * export default config
 * ```
 */
export type { Config as PostcssUserConfig } from 'postcss-load-config'

/** 定义 CSS、CSS Modules、预处理器和 Lightning CSS 的用户配置入口。 */
export interface CSSOptions {
  /**
   * 实验性地使用 Lightning CSS 处理 CSS Modules、资源和 imports；需要另行安装对应 peer dependency。
   *
   * @default 'postcss'
   * @experimental
   */
  transformer?: 'postcss' | 'lightningcss'
  /**
   * https://github.com/css-modules/postcss-modules
   */
  modules?: CSSModulesOptions | false
  /**
   * 各 CSS 预处理器选项。
   *
   * 除各处理器原生选项外，Vite 支持 additionalData，用于给每份样式内容注入公共代码。
   */
  preprocessorOptions?: {
    /** SCSS 预处理配置。 */
    scss?: SassPreprocessorOptions
    /** Sass/SCSS `@import` 使用的解析器。 */
    sass?: SassPreprocessorOptions
    /** Less `@import` 使用的解析器。 */
    less?: LessPreprocessorOptions
    /** Stylus 预处理配置。 */
    styl?: StylusPreprocessorOptions
    /** Stylus 预处理配置的别名入口。 */
    stylus?: StylusPreprocessorOptions
  }

  /**
   * 设置后尽可能在 worker 执行预处理器；true 表示使用 CPU 数量减一。
   *
   * @default true
   */
  preprocessorMaxWorkers?: number | true
  /** 内联 PostCSS 配置或配置文件搜索选项。 */
  postcss?:
    | string
    | (PostCSS.ProcessOptions & {
        /** 按顺序执行的 PostCSS 插件列表。 */
        plugins?: PostCSS.AcceptedPlugin[]
      })
  /**
   * 开发态是否生成 CSS sourcemap。
   * @default false
   * @experimental
   */
  devSourcemap?: boolean

  /**
   * @experimental
   */
  lightningcss?: LightningCSSOptions
}

/** 定义 CSS Modules 的作用域、类名生成和导出回调配置。 */
export interface CSSModulesOptions {
  /** 接收 CSS Modules 生成的类名映射，并保存到当前模块的转换结果。 */
  getJSON?: (
    cssFileName: string,
    json: Record<string, string>,
    outputFileName: string,
  ) => void
  /** CSS Modules 未显式标记时采用的默认作用域。 */
  scopeBehaviour?: 'global' | 'local'
  /** 这些路径匹配的模块强制按全局 CSS 处理。 */
  globalModulePaths?: RegExp[]
  /** 是否把全局类名也暴露为模块导出。 */
  exportGlobals?: boolean
  /** 把原类名与文件上下文转换为作用域类名。 */
  generateScopedName?:
    | string
    | ((name: string, filename: string, css: string) => string)
  /** 参与 CSS Modules 类名哈希的额外前缀。 */
  hashPrefix?: string
  /**
   * 默认 undefined，保留原 class 名格式。
   */
  localsConvention?:
    | 'camelCase'
    | 'camelCaseOnly'
    | 'dashes'
    | 'dashesOnly'
    | ((
        originalClassName: string,
        generatedClassName: string,
        inputFile: string,
      ) => string)
}

/** 保存不可变的 CSS 默认配置，解析用户配置时以此补齐缺省值。 */
const _cssConfigDefaults = Object.freeze({
  /** @experimental */
  transformer: 'postcss',
  // modules/preprocessorOptions 保持未配置，由具体编译分支解释。
  preprocessorMaxWorkers: true,
  // postcss 默认自动查找配置文件。
  /** @experimental */
  devSourcemap: false,
  // lightningcss 仅 transformer 选中时补默认值。
} satisfies CSSOptions)
/** CSS 配置默认值；对象被冻结，解析时克隆合并而不原位修改。 */
export const cssConfigDefaults: Readonly<Partial<CSSOptions>> =
  _cssConfigDefaults

/** 表示完成默认值归一化后的 CSS 配置，并保留可选 Lightning CSS 设置。 */
export type ResolvedCSSOptions = Omit<CSSOptions, 'lightningcss'> &
  Required<Pick<CSSOptions, 'transformer' | 'devSourcemap'>> & {
    /** 传给 Lightning CSS 的转换配置。 */
    lightningcss?: LightningCSSOptions
  }

/** 合并 CSS 默认值；选择 Lightning CSS 时补齐对象和 baseline widely available targets。 */
export function resolveCSSOptions(
  options: CSSOptions | undefined,
): ResolvedCSSOptions {
  const resolved = mergeWithDefaults(_cssConfigDefaults, options ?? {})
  if (resolved.transformer === 'lightningcss') {
    resolved.lightningcss ??= {}
    resolved.lightningcss.targets ??= convertTargets(
      ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET,
    )
  }
  return resolved
}

/** 识别带 `.module` 约定的 CSS 文件，以启用 CSS Modules 转换。 */
const cssModuleRE = new RegExp(`\\.module${CSS_LANGS_RE.source}`)
/** 识别直接 CSS 请求；此类请求返回样式文本而非运行时注入模块。 */
const directRequestRE = /[?&]direct\b/
/** 识别 HTML 内联样式代理模块，使其复用 CSS 插件管线。 */
const htmlProxyRE = /[?&]html-proxy\b/
/** 从 HTML 代理请求中提取内联样式的序号。 */
const htmlProxyIndexRE = /&index=(\d+)/
/** 识别 CommonJS 代理请求，避免把代理包装层误作普通 CSS。 */
const commonjsProxyRE = /[?&]commonjs-proxy/
/** 识别 CSS 请求的内联模式，使结果作为文本嵌入调用模块。 */
const inlineRE = /[?&]inline\b/
/** 识别要求返回内联 CSS 文本的内部查询参数。 */
const inlineCSSRE = /[?&]inline-css\b/
/** 识别来自 HTML `style` 属性的代理请求，以采用属性专用转义规则。 */
const styleAttrRE = /[?&]style-attr\b/
/** 识别 CSS URL 中形似函数调用的值，避免把运行时函数误当文件路径。 */
const functionCallRE = /^[A-Z_][.\w-]*\(/i
/** 识别只执行编译、不注入或发射样式的内部请求。 */
const transformOnlyRE = /[?&]transform-only\b/
/** 匹配未转义双引号，供内联样式属性结果安全转义。 */
const nonEscapedDoubleQuoteRe = /(?<!\\)"/g

/** 未显式指定名称时使用的 CSS 产物文件名。 */
const defaultCssBundleName = 'style.css'

/** 列出需要独立预处理器编译的样式语言后缀。 */
const enum PreprocessLang {
  /** 表示 less 语言分支，值与文件扩展名或解析器标识保持一致。 */
  less = 'less',
  /** 表示 sass 语言分支，值与文件扩展名或解析器标识保持一致。 */
  sass = 'sass',
  /** 表示 scss 语言分支，值与文件扩展名或解析器标识保持一致。 */
  scss = 'scss',
  /** 表示 styl 语言分支，值与文件扩展名或解析器标识保持一致。 */
  styl = 'styl',
  /** 表示 stylus 语言分支，值与文件扩展名或解析器标识保持一致。 */
  stylus = 'stylus',
}
/** 列出纯 CSS 语言分支，供统一的 CssLang 类型包含 `.css` 后缀。 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- bug in typescript-eslint
const enum PureCssLang {
  /** 表示 css 语言分支，值与文件扩展名或解析器标识保持一致。 */
  css = 'css',
}
/** 列出由 PostCSS 语法插件解析的 CSS 方言后缀。 */
const enum PostCssDialectLang {
  /** 表示 sss 语言分支，值与文件扩展名或解析器标识保持一致。 */
  sss = 'sugarss',
}
/** 汇总 Vite CSS 管线能够识别的全部样式语言后缀。 */
type CssLang =
  | keyof typeof PureCssLang
  | keyof typeof PreprocessLang
  | keyof typeof PostCssDialectLang

/** 是否为 `.module.<css-lang>` 请求。 */
export const isModuleCSSRequest = (request: string): boolean =>
  cssModuleRE.test(request)

/** 是否为浏览器直接请求 CSS 内容的 `<css-lang>?direct`。 */
export const isDirectCSSRequest = (request: string): boolean =>
  CSS_LANGS_RE.test(request) && directRequestRE.test(request)

/** 判断请求是否带 direct 标记，以选择返回 CSS 文本而非注入代码。 */
export const isDirectRequest = (request: string): boolean =>
  directRequestRE.test(request)

/** 按环境缓存 CSS Modules 类名映射，供 SSR 与依赖分析复用。 */
const cssModulesCache = new WeakMap<
  ResolvedConfig,
  Map<string, Record<string, string>>
>()

/** 记录构建中被移除的纯 CSS chunk，供依赖和元数据回填。 */
export const removedPureCssFilesCache: WeakMap<
  ResolvedConfig,
  Map<string, RenderedChunk>
> = new WeakMap()

// 只用于关闭 CSS code split、全构建生成单个样式文件时稳定 bundle 名称。
export const cssBundleNameCache: WeakMap<ResolvedConfig, string> = new WeakMap()

/** 按解析配置缓存 PostCSS 配置 Promise，避免每个 CSS 文件重复查找配置。 */
const postcssConfigCache = new WeakMap<
  ResolvedConfig,
  PostCSSConfigResult | null | Promise<PostCSSConfigResult | null>
>()

/** 判断 CSS 公共资源 URL 是否需要先编码为占位符，以便构建末期统一改写。 */
function encodePublicUrlsInCSS(config: ResolvedConfig) {
  return config.command === 'build'
}

/** 匹配 CSS 转换阶段生成的资源 URL 占位符。 */
const cssUrlAssetRE = /__VITE_CSS_URL__([\da-f]+)__/g

/**
 * 用户插件之前运行的 CSS 编译插件：识别 query，执行预处理器/PostCSS/Lightning CSS，重写 URL，登记
 * watch deps，并缓存 CSS Modules exports；不负责开发态 JS 注入或构建态抽取。
 */
export function cssPlugin(config: ResolvedConfig): Plugin {
  const isBuild = config.command === 'build'
  let moduleCache: Map<string, Record<string, string>>

  const idResolver = createBackCompatIdResolver(config, {
    preferRelative: true,
    tryIndex: false,
    extensions: [],
  })

  let preprocessorWorkerController: PreprocessorWorkerController | undefined

  // 提前启动 PostCSS 配置解析；真正 transform 仍会 await 同一缓存 Promise 并报告错误。
  if (config.css.transformer !== 'lightningcss') {
    resolvePostcssConfig(config).catch(() => {
      /* 错误由实际使用配置的 transform 再报告。 */
    })
  }

  return {
    name: 'vite:css',

    /** 为本轮构建重建 CSS Modules、纯 CSS chunk 缓存，并创建预处理器 worker 控制器。 */
    buildStart() {
      // watch 重构建也必须新建缓存，不能复用上一轮 CSS Modules/纯 CSS chunk 状态。
      moduleCache = new Map<string, Record<string, string>>()
      cssModulesCache.set(config, moduleCache)

      removedPureCssFilesCache.set(config, new Map<string, RenderedChunk>())

      preprocessorWorkerController = createPreprocessorWorkerController(
        normalizeMaxWorkers(config.css.preprocessorMaxWorkers),
      )
      preprocessorWorkerControllerCache.set(
        config,
        preprocessorWorkerController,
      )
    },

    /** 关闭本轮构建的预处理器 worker 控制器，等待在途任务结束。 */
    async buildEnd() {
      await preprocessorWorkerController?.close()
    },

    load: {
      filter: {
        id: CSS_LANGS_RE,
      },
      /** 把构建态 `*.css?url` 改写为 transform-only 导入与 CSS URL 占位符导出。 */
      handler(id) {
        if (urlRE.test(id)) {
          if (isModuleCSSRequest(id)) {
            throw new Error(
              `?url is not supported with CSS modules. (tried to import ${JSON.stringify(
                id,
              )})`,
            )
          }

          // *.css?url：开发态由 asset 插件直接返回 URL；构建态先 transform-only 编译，再以占位符等待
          // cssPostPlugin 生成最终资源 URL。
          if (isBuild) {
            id = injectQuery(removeUrlQuery(id), 'transform-only')
            return (
              `import ${JSON.stringify(id)};` +
              `export default "__VITE_CSS_URL__${Buffer.from(id).toString(
                'hex',
              )}__"`
            )
          }
        }
      },
    },
    transform: {
      filter: {
        id: {
          include: CSS_LANGS_RE,
          exclude: [commonjsProxyRE, SPECIAL_QUERY_RE],
        },
      },
      /** 编译 CSS/预处理器源码，解析 URL 与依赖，并记录 CSS Modules 映射。 */
      async handler(raw, id) {
        const { environment } = this
        /** 先按 CSS 导入语义解析资源 URL，再回退为当前文件的相对路径解析。 */
        const resolveUrl = (url: string, importer?: string) =>
          idResolver(environment, url, importer)

        /** 先按 CSS 导入语义解析 URL，再回退公共目录与静态资源解析路径。 */
        const urlResolver: CssUrlResolver = async (url, importer) => {
          const decodedUrl = decodeURI(url)
          if (checkPublicFile(decodedUrl, config)) {
            if (encodePublicUrlsInCSS(config)) {
              return [publicFileToBuiltUrl(decodedUrl, config), undefined]
            } else {
              const base = joinUrlSegments(
                config.server.origin ?? '',
                config.base,
              )
              return [joinUrlSegments(base, decodedUrl), undefined]
            }
          }
          const [id, fragment] = decodedUrl.split('#')
          let resolved = await resolveUrl(id, importer)
          if (resolved) {
            if (fragment) resolved += '#' + fragment
            let url = await fileToUrl(this, resolved)
            // 资源模块已失效时继承 HMR timestamp，确保 CSS 中的 URL 绕过浏览器缓存。
            if (!url.startsWith('data:') && this.environment.mode === 'dev') {
              const mod = [
                ...(this.environment.moduleGraph.getModulesByFile(resolved) ??
                  []),
              ].find((mod) => mod.type === 'asset')
              if (mod?.lastHMRTimestamp) {
                url = injectQuery(url, `t=${mod.lastHMRTimestamp}`)
              }
            }
            return [url, cleanUrl(resolved)]
          }
          if (config.command === 'build') {
            const isExternal = config.build.rolldownOptions.external
              ? resolveUserExternal(
                  config.build.rolldownOptions.external,
                  decodedUrl, // 原 id 无法解析，external matcher 只能以原始 URL 作为候选 id。
                  id,
                  false,
                )
              : false

            if (!isExternal) {
              // #9800：构建期无法解析的 CSS URL 保持原样交给运行时，同时只警告一次。
              config.logger.warnOnce(
                `\n${decodedUrl} referenced in ${id} didn't resolve at build time, it will remain unchanged to be resolved at runtime`,
              )
            }
          }
          return [url, undefined]
        }

        const {
          code: css,
          modules,
          deps,
          map,
        } = await compileCSS(
          environment,
          id,
          raw,
          preprocessorWorkerController!,
          urlResolver,
        )
        if (modules) {
          moduleCache.set(id, modules)
        }

        if (deps) {
          for (const file of deps) {
            this.addWatchFile(file)
          }
        }

        return {
          code: css,
          map,
        }
      },
    },
  }
}

/**
 * 用户插件之后运行的 CSS 消费/产物插件：开发态把 CSS 变成自接受的 JS 注入模块；构建态按 chunk 聚合、
 * 排序、压缩并发射 CSS asset，同时删除只承载 CSS 的空 JS chunk。
 */
export function cssPostPlugin(config: ResolvedConfig): Plugin {
  // styles 不能在 buildStart 重置；watch 重构建时过早清空会让仍需复用的样式丢失。
  const styles = new Map<string, string>()
  // CSS 发射严格串行，保证相同模块图得到确定性资源顺序。
  let codeSplitEmitQueue = createSerialPromiseQueue<string>()
  const urlEmitQueue = createSerialPromiseQueue<unknown>()
  let pureCssChunks: Set<RenderedChunk>
  let chunkCssReferences: Map<string, string>

  // 多个 Rolldown output 共享同一份抽取 CSS；JS 输出格式不会改变 CSS，所以只发射一次。
  let hasEmitted = false
  let chunkCSSMap: Map<string, string>

  const rolldownOptionsOutput = config.build.rolldownOptions.output
  const assetFileNames = (
    Array.isArray(rolldownOptionsOutput)
      ? rolldownOptionsOutput[0]
      : rolldownOptionsOutput
  )?.assetFileNames
  /** 计算 CSS 资源相对输出根的目录，供资源引用生成正确相对路径。 */
  const getCssAssetDirname = (
    cssAssetName: string,
    originalFileName?: string,
  ) => {
    const cssAssetNameDir = path.dirname(cssAssetName)
    if (!assetFileNames) {
      return path.join(config.build.assetsDir, cssAssetNameDir)
    } else if (typeof assetFileNames === 'string') {
      return path.join(path.dirname(assetFileNames), cssAssetNameDir)
    } else {
      return path.dirname(
        assetFileNames({
          type: 'asset',
          name: cssAssetName,
          names: [cssAssetName],
          originalFileName,
          originalFileNames: originalFileName ? [originalFileName] : [],
          source: '/* vite internal call, ignore */',
        }),
      )
    }
  }

  /** 依据 Rollup assetFileNames 计算单 CSS 包的最终名称。 */
  function getCssBundleName() {
    const cached = cssBundleNameCache.get(config)
    if (cached) return cached

    const cssBundleName = config.build.lib
      ? resolveLibCssFilename(
          config.build.lib,
          config.root,
          config.packageCache,
        )
      : defaultCssBundleName
    cssBundleNameCache.set(config, cssBundleName)
    return cssBundleName
  }

  return {
    name: 'vite:css-post',

    /** 为每次 render 重建纯 CSS chunk、引用、CSS 内容与串行发射队列状态。 */
    renderStart() {
      // 每个 render，包括 watch 重构建，都重新建立输出级缓存。
      pureCssChunks = new Set<RenderedChunk>()
      chunkCssReferences = new Map<string, string>()
      hasEmitted = false
      chunkCSSMap = new Map()
      codeSplitEmitQueue = createSerialPromiseQueue()
    },

    transform: {
      filter: {
        id: {
          include: CSS_LANGS_RE,
          exclude: [commonjsProxyRE, SPECIAL_QUERY_RE],
        },
      },
      /** 消费已编译 CSS：缓存 HTML 内联样式，或生成开发注入代码和构建元数据。 */
      async handler(css, id) {
        css = stripBomTag(css)

        // HTML inline style proxy 不生成独立模块内容；把编译结果按 proxy index 缓存，供 build-html 的
        // generateBundle 或开发 devHtmlHook 替换 inline-style 标记。
        const inlineCSS = inlineCSSRE.test(id)
        const isHTMLProxy = htmlProxyRE.test(id)
        if (inlineCSS && isHTMLProxy) {
          if (styleAttrRE.test(id)) {
            css = css.replace(/"/g, '&quot;')
          }
          const index = htmlProxyIndexRE.exec(id)?.[1]
          if (index == null) {
            throw new Error(`HTML proxy index in "${id}" not found`)
          }
          addToHTMLProxyTransformResult(
            `${getHash(cleanUrl(id))}_${Number.parseInt(index)}`,
            css,
          )
          return {
            code: `export default ''`,
            map: { mappings: '' },
          }
        }

        const inlined = inlineRE.test(id)
        const modules = cssModulesCache.get(config)!.get(id)

        // #6984/#7552：普通 foo.module.css 导出 class 映射；带 ?inline 则导出 CSS 字符串。
        const modulesCode =
          modules &&
          !inlined &&
          dataToEsm(modules, { namedExports: true, preferConst: true })

        if (config.command === 'serve') {
          /** 在追加或替换 CSS 内容后生成对应映射，并与已有 sourcemap 合并。 */
          const getContentWithSourcemap = async (content: string) => {
            if (config.css.devSourcemap) {
              const sourcemap = this.getCombinedSourcemap()
              if (sourcemap.mappings) {
                await injectSourcesContent(
                  sourcemap,
                  cleanUrl(id),
                  config.logger,
                )
              }
              return getCodeWithSourcemap('css', content, sourcemap)
            }
            return content
          }

          if (isDirectCSSRequest(id)) {
            return null
          }
          if (inlined) {
            return `export default ${JSON.stringify(css)}`
          }
          if (this.environment.config.consumer === 'server') {
            return modulesCode || 'export {}'
          }

          const cssContent = await getContentWithSourcemap(css)
          const code = [
            this.environment.config.isBundled
              ? `const { updateStyle: __vite__updateStyle, removeStyle: __vite__removeStyle } = import.meta.hot._internal`
              : `import { updateStyle as __vite__updateStyle, removeStyle as __vite__removeStyle } from ${JSON.stringify(
                  path.posix.join(config.base, CLIENT_PUBLIC_PATH),
                )}`,
            `const __vite__id = ${JSON.stringify(id)}`,
            `const __vite__css = ${JSON.stringify(cssContent)}`,
            `__vite__updateStyle(__vite__id, __vite__css)`,
            // CSS Modules 编辑后 exports 可能变化，不能像纯 CSS 那样无条件自接受，需向 importer 传播。
            `${modulesCode || 'import.meta.hot.accept()'}`,
            `import.meta.hot.prune(() => __vite__removeStyle(__vite__id))`,
          ].join('\n')
          return { code, map: { mappings: '' }, moduleType: 'js' }
        }

        // 构建态 CSS 处理 -------------------------------------------------------

        // 非 inline CSS 留给 renderChunk 按 JS chunk 聚合。
        if (!inlined) {
          styles.set(id, css)
        }

        let code: string
        if (modulesCode) {
          code = modulesCode
        } else if (inlined) {
          let content = css
          if (config.build.cssMinify) {
            content = await minifyCSS(content, config, true, id)
          }
          code = `export default ${JSON.stringify(content)}`
        } else {
          // 普通 CSS 的 JS 代理为空，真实内容稍后抽取成 asset。
          code = ''
        }

        return {
          code,
          map: { mappings: '' },
          // 普通 CSS 代理必须保留到 renderChunk，才能从 chunk.modules 取回并聚合样式。
          moduleSideEffects: modulesCode || inlined ? false : 'no-treeshake',
          moduleType: 'js',
        }
      },
    },

    ...(config.command === 'build'
      ? {
          /** 汇总 chunk 样式、解析资源占位符，并按 code-split 配置发射 CSS 或注入运行时代码。 */
          async renderChunk(code, chunk, opts, meta) {
            let chunkCSS: string | undefined
            const renderedModules = new Proxy(
              {} as Record<string, RenderedModule | undefined>,
              {
                /** 为 chunk 模块表提供按需 CSS 元数据，供渲染阶段按模块访问样式结果。 */
                get(_target, p) {
                  for (const name in meta.chunks) {
                    const modules = meta.chunks[name].modules
                    const module = modules[p as string]
                    if (module) {
                      return module
                    }
                  }
                },
              },
            )
            // 动态入口若只 import CSS，最终 JS code 为空但仍需生成对应 CSS chunk。
            const isJsChunkEmpty = code === '' && !chunk.isEntry
            let isPureCssChunk = chunk.exports.length === 0
            const ids = Object.keys(chunk.modules)
            for (const id of ids) {
              if (styles.has(id)) {
                // ?transform-only 专供 ?url 生成独立 CSS 资源，不得混入普通 CSS chunk。
                if (transformOnlyRE.test(id)) {
                  continue
                }

                // cssScopeTo 把样式绑定到 importer 的特定 export；若这些 export 未进入最终 chunk，样式也
                // 可跳过，实现与 tree-shaking 对齐的 CSS 删除。
                const cssScopeTo =
                  this.getModuleInfo(id)?.meta?.vite?.cssScopeTo
                if (
                  cssScopeTo &&
                  !isCssScopeToRendered(cssScopeTo, renderedModules)
                ) {
                  continue
                }

                // CSS Module 还有 JS exports，因此所在 chunk 不能算纯 CSS 占位 chunk。
                if (cssModuleRE.test(id)) {
                  isPureCssChunk = false
                }

                chunkCSS = (chunkCSS || '') + styles.get(id)
              } else if (!isJsChunkEmpty) {
                // styles 只记录 CSS；chunk 含任一无 style 的真实 JS 模块，就不是纯 CSS chunk。
                isPureCssChunk = false
              }
            }

            const publicAssetUrlMap = publicAssetUrlCache.get(config)!

            // 把编译阶段留下的 asset/public 占位符解析为当前 CSS 输出位置对应的最终 URL。
            /** 把 CSS 中的资源占位符改写为相对当前 chunk 或 CSS 资源的最终 URL。 */
            const resolveAssetUrlsInCss = (
              chunkCSS: string,
              cssAssetName: string,
              originalFileName?: string,
            ) => {
              const encodedPublicUrls = encodePublicUrlsInCSS(config)

              const relative = config.base === './' || config.base === ''
              const cssAssetDirname =
                encodedPublicUrls || relative
                  ? slash(getCssAssetDirname(cssAssetName, originalFileName))
                  : undefined

              /** 把产物文件名转换为相对当前 CSS 资源的引用路径。 */
              const toRelative = (filename: string) => {
                // relative base 下，抽取 CSS 内 URL 必须相对 CSS asset 所在目录计算。
                const relativePath = normalizePath(
                  path.relative(cssAssetDirname!, filename),
                )
                return relativePath[0] === '.'
                  ? relativePath
                  : './' + relativePath
              }

              // 普通 asset 占位符通过 referenceId 取最终文件名，并登记进 chunk metadata。
              chunkCSS = chunkCSS.replace(
                assetUrlRE,
                (_, fileHash, postfix = '') => {
                  const filename = this.getFileName(fileHash) + postfix
                  chunk.viteMetadata!.importedAssets.add(cleanUrl(filename))
                  return encodeURIPath(
                    toOutputFilePathInCss(
                      filename,
                      'asset',
                      cssAssetName,
                      'css',
                      config,
                      toRelative,
                    ),
                  )
                },
              )
              // public URL 在构建期编码后也需按 CSS 输出目录/base 恢复。
              if (encodedPublicUrls) {
                const relativePathToPublicFromCSS = normalizePath(
                  path.relative(cssAssetDirname!, ''),
                )
                chunkCSS = chunkCSS.replace(publicAssetUrlRE, (_, hash) => {
                  const publicUrl = publicAssetUrlMap.get(hash)!.slice(1)
                  return encodeURIPath(
                    toOutputFilePathInCss(
                      publicUrl,
                      'public',
                      cssAssetName,
                      'css',
                      config,
                      () => `${relativePathToPublicFromCSS}/${publicUrl}`,
                    ),
                  )
                })
              }
              return chunkCSS
            }

            /** 仅在产物名缺少扩展名时补上目标扩展名，保留已有后缀。 */
            function ensureFileExt(name: string, ext: string) {
              return normalizePath(
                path.format({ ...path.parse(name), base: undefined, ext }),
              )
            }

            let s: MagicString | undefined
            const urlEmitTasks: Array<{
              /** 当前 CSS 资源在产物中的文件名。 */
              cssAssetName: string
              /** CSS 资源对应的原始入口名。 */
              originalFileName: string
              /** 当前阶段传递或生成的文本内容。 */
              content: string
              /** 该片段在原始源码中的起始偏移。 */
              start: number
              /** 该片段在原始源码中的结束偏移。 */
              end: number
            }> = []

            if (code.includes('__VITE_CSS_URL__')) {
              let match: RegExpExecArray | null
              cssUrlAssetRE.lastIndex = 0
              while ((match = cssUrlAssetRE.exec(code))) {
                const [full, idHex] = match
                const id = Buffer.from(idHex, 'hex').toString()
                const originalFileName = cleanUrl(id)
                const cssAssetName = ensureFileExt(
                  path.basename(originalFileName),
                  '.css',
                )
                if (!styles.has(id)) {
                  throw new Error(
                    `css content for ${JSON.stringify(id)} was not found`,
                  )
                }

                let cssContent = styles.get(id)!

                cssContent = resolveAssetUrlsInCss(
                  cssContent,
                  cssAssetName,
                  originalFileName,
                )

                urlEmitTasks.push({
                  cssAssetName,
                  originalFileName,
                  content: cssContent,
                  start: match.index,
                  end: match.index + full.length,
                })
              }
            }

            // 即使当前 chunk 没有 CSS ?url，也要进入同一串行队列，保证后续发射操作与其他 chunk 的相对
            // 顺序稳定。
            await urlEmitQueue.run(async () =>
              Promise.all(
                urlEmitTasks.map(async (info) => {
                  info.content = await finalizeCss(info.content, config)
                }),
              ),
            )
            if (urlEmitTasks.length > 0) {
              const toRelativeRuntime =
                createToImportMetaURLBasedRelativeRuntime(
                  opts.format,
                  config.isWorker,
                )
              s ||= new MagicString(code)

              for (const {
                cssAssetName,
                originalFileName,
                content,
                start,
                end,
              } of urlEmitTasks) {
                const referenceId = this.emitFile({
                  type: 'asset',
                  name: cssAssetName,
                  originalFileName,
                  source: content,
                })

                const filename = this.getFileName(referenceId)
                chunk.viteMetadata!.importedAssets.add(cleanUrl(filename))
                const replacement = toOutputFilePathInJS(
                  this.environment,
                  filename,
                  'asset',
                  chunk.fileName,
                  'js',
                  toRelativeRuntime,
                )
                const replacementString =
                  typeof replacement === 'string'
                    ? JSON.stringify(encodeURIPath(replacement)).slice(1, -1)
                    : `"+${replacement.runtime}+"`
                s.update(start, end, replacementString)
              }
            }

            if (chunkCSS !== undefined) {
              if (
                isPureCssChunk &&
                (opts.format === 'es' || opts.format === 'cjs')
              ) {
                // 这是无 JS exports 的共享纯 CSS chunk，之后删除空 JS 占位文件。
                pureCssChunks.add(chunk)
              }

              if (this.environment.config.build.cssCodeSplit) {
                if (
                  (opts.format === 'es' || opts.format === 'cjs') &&
                  !chunk.fileName.includes('-legacy')
                ) {
                  const isEntry = chunk.isEntry && isPureCssChunk
                  const cssFullAssetName = ensureFileExt(chunk.name, '.css')
                  // facade 不是 CSS 表示 JS entry 间接导入样式；此时 CSS asset 与 JS chunk 一样只取
                  // basename，避免把 JS entry 目录结构错误带进 CSS 名称。
                  const cssAssetName =
                    chunk.isEntry &&
                    (!chunk.facadeModuleId ||
                      !isCSSRequest(chunk.facadeModuleId))
                      ? path.basename(cssFullAssetName)
                      : cssFullAssetName
                  const originalFileName = getChunkOriginalFileName(
                    chunk,
                    config.root,
                    this.environment.config.isOutputOptionsForLegacyChunks?.(
                      opts,
                    ) ?? false,
                  )

                  chunkCSS = resolveAssetUrlsInCss(
                    chunkCSS,
                    cssAssetName,
                    originalFileName,
                  )

                  // 等待此前 chunk 的 finalize，维持确定性发射顺序。
                  chunkCSS = await codeSplitEmitQueue.run(async () => {
                    return finalizeCss(chunkCSS!, config)
                  })

                  // 发射当前 JS chunk 对应的 CSS sidecar，并写入 viteMetadata。
                  const referenceId = this.emitFile({
                    type: 'asset',
                    name: cssAssetName,
                    originalFileName,
                    source: chunkCSS,
                  })
                  chunkCssReferences.set(chunk.fileName, referenceId)
                  if (isEntry) {
                    cssEntriesMap
                      .get(this.environment)!
                      .set(chunk.fileName, { referenceId, name: chunk.name })
                  }
                  chunk.viteMetadata!.importedCss.add(
                    this.getFileName(referenceId),
                  )
                } else if (this.environment.config.consumer === 'client') {
                  // legacy/non ES 输出无法用独立 CSS 动态加载协议时，把样式注入 JS。

                  // entry CSS 也会被 build-html 从 importedCss 注入 index.html，表面上可能重复：
                  // https://github.com/vitejs/vite/issues/2062#issuecomment-782388010
                  // 但 entry chunk 本身也可能由 dynamic import 加载，因此不能删除 JS 内联样式（#10285）。

                  chunkCSS = await finalizeCss(chunkCSS, config)
                  let cssString = JSON.stringify(chunkCSS)
                  cssString =
                    renderAssetUrlInJS(
                      this,
                      chunk,
                      opts,
                      cssString,
                    )?.toString() || cssString
                  const style = `__vite_style__`
                  const injectCode =
                    `var ${style} = document.createElement('style');` +
                    `${style}.textContent = ${cssString};` +
                    `document.head.appendChild(${style});`

                  s ||= new MagicString(code)
                  injectInlinedCSS(s, this, code, opts.format, injectCode)
                }
              } else {
                // 不 code split 时先按最终单一 bundle 位置解析 URL；public URL 使用绝对输出语义。
                chunkCSS = resolveAssetUrlsInCss(
                  chunkCSS,
                  getCssBundleName(),
                  defaultCssBundleName,
                )
                // 聚合完成后的 finalizeCss 统一留到 generateBundle，避免逐 chunk 重复压缩/hoist。

                chunkCSSMap.set(chunk.fileName, chunkCSS)
              }
            }

            if (s) {
              if (config.build.sourcemap) {
                return {
                  code: s.toString(),
                  map: s.generateMap({ hires: 'boundary' }),
                }
              } else {
                return { code: s.toString() }
              }
            }
            return null
          },

          /** 把关联 CSS 内容加入 chunk 哈希，确保样式变化会使引用它的产物失效。 */
          augmentChunkHash(chunk) {
            if (chunk.viteMetadata?.importedCss.size) {
              let hash = ''
              for (const id of chunk.viteMetadata.importedCss) {
                hash += id
              }
              return hash
            }
          },
        }
      : {}),

    /** 等待 CSS 发射队列完成，移除纯 CSS chunk，并为非拆分模式发射合并样式。 */
    async generateBundle(opts, bundle) {
      // modern/legacy 双输出共享 CSS，legacy output 不重复发射。
      if (this.environment.config.isOutputOptionsForLegacyChunks?.(opts)) {
        return
      }

      // vite:asset 会清理 renderChunk 阶段的早期资源；cssCodeSplit=false 在此处仍可能发射 CSS，因此本
      // 插件必须自行遵守 emitAssets。
      const canEmitAssets =
        config.command !== 'build' || this.environment.config.build.emitAssets

      // 关闭 code split 时按入口使用顺序聚合为单一 CSS bundle。
      if (
        canEmitAssets &&
        !this.environment.config.build.cssCodeSplit &&
        !hasEmitted
      ) {
        let extractedCss = ''
        const collected = new Set<OutputChunk>()
        // dynamicImports 按入口遍历时首次出现的顺序填充。
        const dynamicImports = new Set<string>()

        /** 递归收集 chunk 及其静态、动态依赖关联的 CSS，避免重复遍历。 */
        function collect(chunk: OutputChunk | OutputAsset | undefined) {
          if (!chunk || chunk.type !== 'chunk' || collected.has(chunk)) return
          collected.add(chunk)

          // 先递归同步 imports，其样式优先级最低。
          chunk.imports.forEach((importName) => collect(bundle[importName]))
          // 动态 imports 先只记录确定性顺序，最后追加以获得最高覆盖优先级。
          chunk.dynamicImports.forEach((importName) =>
            dynamicImports.add(importName),
          )
          // 再追加当前 chunk 样式，使 importer 可覆盖其同步依赖。
          extractedCss += chunkCSSMap.get(chunk.preliminaryFileName) ?? ''
        }

        // Rolldown 保证 bundle 枚举确定性；若这里漂移属于打包器 bug，可据此稳定 CSS 顺序。
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === 'chunk' && chunk.isEntry) {
            collect(chunk)
          }
        }
        // 最后收集动态 chunk，让异步页面/组件样式覆盖此前公共样式。
        for (const chunkName of dynamicImports) {
          collect(bundle[chunkName])
        }

        // 聚合非空时统一 finalize 并发射单一资源。
        if (extractedCss) {
          hasEmitted = true
          extractedCss = await finalizeCss(extractedCss, config)
          this.emitFile({
            name: getCssBundleName(),
            type: 'asset',
            source: extractedCss,
            // 单一 CSS 是隐式入口；用默认 bundle 名作为 originalFileName，同时作为 manifest key。
            originalFileName: defaultCssBundleName,
          })
        }
      }

      // cssCodeSplit=false 时 HTML 只引用单一 stylesheet，无需建立逐 chunk CSS import map。
      if (
        this.environment.config.build.chunkImportMap &&
        chunkCssReferences.size
      ) {
        // import map hash 是独立于内容的 JS chunk 稳定身份；每个 chunk 至多一个 CSS sidecar，可复用该
        // 身份并换成 .css，再映射到 CSS 内容 hash 文件。
        const importMap = getImportMap(bundle, this.environment.config)!
        const importMapReverseMapping = Object.fromEntries(
          Object.entries(importMap.mapping).map(([k, v]) => [v, k]),
        )
        const chunksByPreliminaryFileName = new Map(
          Object.values(bundle)
            .filter((output): output is OutputChunk => output.type === 'chunk')
            .map((chunk) => [chunk.preliminaryFileName, chunk]),
        )

        for (const [chunkFileName, referenceId] of chunkCssReferences) {
          const chunk = chunksByPreliminaryFileName.get(chunkFileName)
          if (!chunk) continue

          const stableChunkFileName =
            importMapReverseMapping[chunk.fileName] ?? chunk.fileName
          const extension = path.posix.extname(stableChunkFileName)
          const stableCssFileName = `${stableChunkFileName.slice(
            0,
            extension ? -extension.length : undefined,
          )}.css`
          importMap.content.imports[config.base + stableCssFileName] =
            config.base + this.getFileName(referenceId)
        }
        importMap.asset.source = JSON.stringify(importMap.content)
      }

      // 删除纯 CSS 产生的空 JS chunk，并修补所有 importer 的 imports/metadata/code。
      if (pureCssChunks.size) {
        // rendered chunk 的 fileName 仍含 !~{hash}~ 占位符，与 bundle 最终 filename 不同；通过
        // preliminaryFileName 建立纯 CSS chunk 到最终文件名的映射。
        const prelimaryNameToChunkMap = Object.fromEntries(
          Object.values(bundle)
            .filter((chunk): chunk is OutputChunk => chunk.type === 'chunk')
            .map((chunk) => [chunk.preliminaryFileName, chunk.fileName]),
        )

        // watch 模式每个 output format 单独调用 generateBundle；pureCssChunks 可能还含其他 output 的
        // 节点，必须过滤当前 bundle 实际存在的文件。
        const pureCssChunkNames = [...pureCssChunks]
          .map((pureCssChunk) => prelimaryNameToChunkMap[pureCssChunk.fileName])
          .filter(Boolean)
        const pureCssChunkNameSet = new Set(pureCssChunkNames)

        let importMapReverseMapping: Record<string, string> | undefined
        if (this.environment.config.build.chunkImportMap) {
          const importMap = getImportMap(bundle, this.environment.config)!
          importMapReverseMapping = Object.fromEntries(
            Object.entries(importMap.mapping).map(([k, v]) => [v, k]),
          )
        }
        const pureCssChunkNamesInCode = importMapReverseMapping
          ? pureCssChunkNames.map(
              (name) => importMapReverseMapping![name] ?? name,
            )
          : pureCssChunkNames

        const replaceEmptyChunk = getEmptyChunkReplacer(
          pureCssChunkNamesInCode,
          opts.format,
        )

        for (const file in bundle) {
          const chunk = bundle[file]
          if (chunk.type === 'chunk') {
            let chunkImportsPureCssChunk = false
            // 从 importer 的 JS imports 删除纯 CSS 空 chunk，并把它的 emitted CSS/assets 元数据转移到
            // importer，使 HTML preload/manifest 仍能追踪真实资源。
            chunk.imports = chunk.imports.filter((file) => {
              if (pureCssChunkNameSet.has(file)) {
                const { importedCss, importedAssets } = (
                  bundle[file] as OutputChunk
                ).viteMetadata!
                importedCss.forEach((file) =>
                  chunk.viteMetadata!.importedCss.add(file),
                )
                importedAssets.forEach((file) =>
                  chunk.viteMetadata!.importedAssets.add(file),
                )
                chunkImportsPureCssChunk = true
                return false
              }
              return true
            })
            if (chunkImportsPureCssChunk) {
              chunk.code = replaceEmptyChunk(chunk.code)
            }
          }
        }

        const removedPureCssFiles = removedPureCssFilesCache.get(config)!
        pureCssChunkNames.forEach((fileName) => {
          const emptyJsPlaceholder = bundle[fileName] as OutputChunk
          if (emptyJsPlaceholder.isEntry) {
            const { importedAssets, importedCss } =
              emptyJsPlaceholder.viteMetadata!
            const cssReferenceId = cssEntriesMap
              .get(this.environment)!
              .get(emptyJsPlaceholder.preliminaryFileName)!.referenceId
            const realCssEntryName = this.getFileName(cssReferenceId)
            const realCssEntry = bundle[realCssEntryName]!
            importedCss.delete(realCssEntryName)
            if (importedAssets.size) {
              realCssEntry.viteMetadata!.importedAssets = importedAssets
            }
            if (importedCss.size) {
              realCssEntry.viteMetadata!.importedCss = importedCss
            }
          }

          removedPureCssFiles.set(fileName, emptyJsPlaceholder)
          delete bundle[fileName]
          delete bundle[`${fileName}.map`]
        })
      }

      const cssAssets = Object.values(bundle).filter(
        (asset): asset is OutputAsset =>
          asset.type === 'asset' && asset.fileName.endsWith('.css'),
      )
      for (const cssAsset of cssAssets) {
        if (typeof cssAsset.source === 'string') {
          cssAsset.source = cssAsset.source.replace(viteHashUpdateMarkerRE, '')
        }
      }
    },
  }
}

/** 按 IIFE/UMD wrapper、ES hashbang 边界选择安全位置，把 legacy CSS 注入代码插入生成 chunk。 */
export function injectInlinedCSS(
  s: MagicString,
  ctx: Pick<MinimalPluginContext, 'error'>,
  code: string,
  format: InternalModuleFormat,
  injectCode: string,
): void {
  let injectionPoint: number
  if (format === 'iife' || format === 'umd') {
    const m = (format === 'iife' ? IIFE_BEGIN_RE : UMD_BEGIN_RE).exec(code)
    if (!m) {
      ctx.error('Injection point for inlined CSS not found')
    }
    injectionPoint = m.index + m[0].length
  } else if (format === 'es') {
    // ES legacy 输出通常从文件头插入。
    if (code.startsWith('#!')) {
      const fileStartIndex = getFileStartIndex(code)
      const hashbang = code.slice(0, fileStartIndex)
      if (!lineTerminatorRE.test(hashbang)) {
        // shebang 无换行时不能在同一行插代码，追加换行后再放注入代码以保持可执行。
        s.append(`\n${injectCode}`)
        return
      }
      injectionPoint = fileStartIndex
    } else {
      injectionPoint = 0
    }
  } else {
    ctx.error('Non supported format')
  }
  s.appendRight(injectionPoint, injectCode)
}

/** 把 CSS @import/addWatchFile 依赖和自接受状态补进开发态模块图，供 HMR 传播使用。 */
export function cssAnalysisPlugin(config: ResolvedConfig): Plugin {
  return {
    name: 'vite:css-analysis',

    /** CSS 模块图分析只在开发态非 bundled 环境启用。 */
    applyToEnvironment(environment) {
      return !environment.config.isBundled
    },

    transform: {
      filter: {
        id: {
          include: CSS_LANGS_RE,
          exclude: [commonjsProxyRE, SPECIAL_QUERY_RE],
        },
      },
      /** 把 CSS 导入依赖和自接受状态写入开发模块图，供 HMR 正确传播。 */
      handler(_, id) {
        const { moduleGraph } = this.environment as DevEnvironment
        const thisModule = moduleGraph.getModuleById(id)

        // 这里只把 CSS @import 和其他 addWatchFile 依赖写入模块图；JS import 的 HMR 边由
        // import-analysis 插件维护。
        if (thisModule) {
          // CSS Modules 导出 class 映射，编辑后值可能改变，不能自接受。
          const isSelfAccepting =
            !cssModulesCache.get(config)?.get(id) &&
            !inlineRE.test(id) &&
            !htmlProxyRE.test(id)
          // pluginContainer.addWatchFile 会把依赖挂到当前 transform context 的 _addedImports。
          const pluginImports = (this as unknown as TransformPluginContext)
            ._addedImports
          if (pluginImports) {
            // 用 file-only 节点记录依赖，使 @import 文件变化能反向触发根 CSS proxy 更新。
            const depModules = new Set<string | EnvironmentModuleNode>()
            for (const file of pluginImports) {
              depModules.add(moduleGraph.createFileOnlyEntry(file))
            }
            moduleGraph.updateModuleInfo(
              thisModule,
              depModules,
              null,
              // 根 CSS proxy 通过 isSelfAccepting 接管更新，不需要显式 accepted deps 列表。
              new Set(),
              null,
              isSelfAccepting,
            )
          } else {
            thisModule.isSelfAccepting = isSelfAccepting
          }
        }
      },
    },
  }
}

/** 判断 CSS 模块是否会进入当前渲染 chunk，避免重复拼接无关样式。 */
function isCssScopeToRendered(
  cssScopeTo: Exclude<CustomPluginOptionsVite['cssScopeTo'], undefined>,
  renderedModules: Record<string, RenderedModule | undefined>,
) {
  const [importerId, exp] = cssScopeTo
  const importer = renderedModules[importerId]
  return (
    importer && (exp === undefined || importer.renderedExports.includes(exp))
  )
}

/**
 * 创建删除纯 CSS 空 JS chunk import/require 的替换器，同时用等长注释尽量保持 sourcemap 位置。
 * @param pureCssChunkNames 需要从生成代码中移除的纯 CSS chunk 文件名。
 * @param outputFormat 决定匹配 ESM import 还是 CJS require。
 */
export function getEmptyChunkReplacer(
  pureCssChunkNames: string[],
  outputFormat: InternalModuleFormat,
): (code: string) => string {
  const emptyChunkFiles = pureCssChunkNames
    .map((file) => escapeRegex(path.basename(file)))
    .join('|')

  // CJS minifier 可能用逗号运算符串联 require；删除中间调用时需保留连接下一个 require 的逗号，或补
  // 分号终止表达式链。
  const emptyChunkRE = new RegExp(
    outputFormat === 'es'
      ? `\\bimport\\s*["'][^"']*(?:${emptyChunkFiles})["'];`
      : `(\\b|,\\s*)require\\(\\s*["'\`][^"'\`]*(?:${emptyChunkFiles})["'\`]\\)(;|,)`,
    'g',
  )

  return (code: string) =>
    code.replace(
      emptyChunkRE,
      // 用等长注释替换 CSS import，尽量保留后续 sourcemap 位置。
      (m, p1, p2) => {
        if (outputFormat === 'es') {
          return `/* empty css ${''.padEnd(m.length - 15)}*/`
        }
        if (p2 === ';') {
          // 原调用以分号结束时，把分号前移并去掉可能的前导逗号。
          return `${p2}/* empty css ${''.padEnd(m.length - 16)}*/`
        }
        // 以逗号结束时删除尾逗号，但保留连接前一表达式的前导逗号。
        return `${p1}/* empty css ${''.padEnd(m.length - 15 - p1.length)}*/`
      },
    )
}

/** 识别含 Windows 盘符的 file URL，以采用平台兼容的路径转换。 */
const fileURLWithWindowsDriveRE = /^file:\/\/\/[a-zA-Z]:\//

/** 聚合 CSS、Sass 与 Less 的 `@import` 解析器，按语法选择解析策略。 */
export interface CSSAtImportResolvers {
  /** 标准 CSS `@import` 使用的解析器。 */
  css: ResolveIdFn
  /** Sass/SCSS `@import` 使用的解析器。 */
  sass: ResolveIdFn
  /** Less `@import` 使用的解析器。 */
  less: ResolveIdFn
}

/** 为 CSS/Sass/Less 惰性创建带各自扩展名、mainFields、conditions 与 partial 规则的 @import resolver。 */
export function createCSSResolvers(
  config: ResolvedConfig,
): CSSAtImportResolvers {
  let cssResolve: ResolveIdFn | undefined
  let sassResolve: ResolveIdFn | undefined
  let lessResolve: ResolveIdFn | undefined
  return {
    /** 惰性创建标准 CSS `@import` 解析器，并在后续文件间复用。 */
    get css() {
      return (cssResolve ??= createBackCompatIdResolver(config, {
        extensions: ['.css'],
        mainFields: ['style'],
        conditions: ['style', DEV_PROD_CONDITION],
        tryIndex: false,
        preferRelative: true,
      }))
    },

    /** 惰性创建 Sass 导入解析器，按 Sass 的扩展名和索引文件规则查找。 */
    get sass() {
      if (!sassResolve) {
        const resolver = createBackCompatIdResolver(config, {
          extensions: ['.scss', '.sass', '.css'],
          mainFields: ['sass', 'style'],
          conditions: ['sass', 'style', DEV_PROD_CONDITION],
          tryIndex: true,
          tryPrefix: '_',
          preferRelative: true,
          skipMainField: true,
        })
        sassResolve = async (...args) => {
          // Sass modern API 的 canonicalize 会先传已解析 file URL，再传原 specifier；先转回文件路径以
          // 复用 Vite resolver。
          if (args[1].startsWith('file://')) {
            args[1] = fileURLToPath(args[1], {
              windows:
                // file:///foo 没有 Windows drive，不能强制按 Windows 路径转换。
                isWindows && !fileURLWithWindowsDriveRE.test(args[1])
                  ? false
                  : undefined,
            })
          }
          return resolver(...args)
        }
      }
      return sassResolve
    },

    /** 惰性创建 Less 导入解析器，按 Less 的扩展名和目录规则查找。 */
    get less() {
      return (lessResolve ??= createBackCompatIdResolver(config, {
        extensions: ['.less', '.css'],
        mainFields: ['less', 'style'],
        conditions: ['less', 'style', DEV_PROD_CONDITION],
        tryIndex: false,
        preferRelative: true,
      }))
    },
  }
}

/** 按当前 CSS 语言返回允许参与 `@import` 解析的解析器顺序。 */
function getCssResolversKeys(
  resolvers: CSSAtImportResolvers,
): Array<keyof CSSAtImportResolvers> {
  return Object.keys(resolvers) as unknown as Array<keyof CSSAtImportResolvers>
}

/** 调用对应语言预处理器，并返回代码、映射及新增依赖集合。 */
async function compileCSSPreprocessors(
  environment: PartialEnvironment,
  id: string,
  lang: PreprocessLang,
  code: string,
  workerController: PreprocessorWorkerController,
): Promise<{
  /** 转换后代码。 */
  code: string
  /** 与预处理结果对应的 sourcemap；空 mappings 表示有意终止上游映射链。 */
  map?:
    ExistingRawSourceMap
    | {
        /** 用空字符串标记不再存在可追溯的源码映射。 */
        mappings: ''
      }
  /** 转换过程中解析出的文件依赖集合。 */
  deps?: Set<string>
}> {
  const { config } = environment
  const { preprocessorOptions, devSourcemap } = config.css
  const atImportResolvers = getAtImportResolvers(
    environment.getTopLevelConfig(),
  )
  const opts = {
    ...((preprocessorOptions && preprocessorOptions[lang]) || {}),
    // filename 是预处理器解析相对 import/URL 的基准，必须使用去 query 的真实文件名。
    filename: cleanUrl(id),
    enableSourcemap: devSourcemap ?? false,
  }

  const preProcessor = workerController[lang]
  const preprocessResult = await preProcessor(
    environment,
    code,
    config.root,
    opts,
    atImportResolvers,
  )
  if (preprocessResult.error) {
    throw preprocessResult.error
  }

  let deps: Set<string> | undefined
  if (preprocessResult.deps.length > 0) {
    const normalizedFilename = normalizePath(opts.filename)
    // Sass 有时把入口文件本身也登记为 dep；过滤它避免自依赖触发重复 HMR。
    deps = new Set(
      [...preprocessResult.deps].filter(
        (dep) => normalizePath(dep) !== normalizedFilename,
      ),
    )
  }

  return {
    code: preprocessResult.code,
    map: combineSourcemapsIfExists(
      opts.filename,
      preprocessResult.map,
      preprocessResult.additionalMap,
    ),
    deps,
  }
}

/** 按解析配置缓存 `@import` 解析器，避免为每个文件重复构造。 */
const configToAtImportResolvers = new WeakMap<
  ResolvedConfig,
  CSSAtImportResolvers
>()
/** 取得当前配置的 CSS 导入解析器；首次调用时创建并写入缓存。 */
function getAtImportResolvers(config: ResolvedConfig) {
  let atImportResolvers = configToAtImportResolvers.get(config)
  if (!atImportResolvers) {
    atImportResolvers = createCSSResolvers(config)
    configToAtImportResolvers.set(config, atImportResolvers)
  }
  return atImportResolvers
}

/** 统一 CSS 编译入口：预处理器 → PostCSS/Lightning CSS → sourcemap 合并，并汇总 watch deps/modules。 */
async function compileCSS(
  environment: PartialEnvironment,
  id: string,
  code: string,
  workerController: PreprocessorWorkerController,
  urlResolver?: CssUrlResolver,
): Promise<{
  /** 转换后代码。 */
  code: string
  /** 与转换后代码对应的 sourcemap。 */
  map?: SourceMapInput
  /** CSS Modules 的原类名到导出名映射。 */
  modules?: Record<string, string>
  /** 转换过程中解析出的文件依赖集合。 */
  deps?: Set<string>
}> {
  const { config } = environment
  const lang = CSS_LANGS_RE.exec(id)?.[1] as CssLang | undefined
  const deps = new Set<string>()

  // 第一阶段先执行 Sass/Less/Stylus 等语法预处理。
  // 保存第一阶段预处理映射，稍后与 PostCSS 或 Lightning CSS 的映射合并。
  let preprocessorMap:
    ExistingRawSourceMap
    | {
        /** 用空字符串标记不再存在可追溯的源码映射。 */
        mappings: ''
      }
    | undefined
  if (isPreProcessor(lang)) {
    const preprocessorResult = await compileCSSPreprocessors(
      environment,
      id,
      lang,
      code,
      workerController,
    )
    code = preprocessorResult.code
    preprocessorMap = preprocessorResult.map
    preprocessorResult.deps?.forEach((dep) => deps.add(dep))
  } else if (lang === 'sss' && config.css.transformer === 'lightningcss') {
    const sssResult = await transformSugarSS(environment, id, code)
    code = sssResult.code
    preprocessorMap = sssResult.map
  }

  const transformResult = await (config.css.transformer === 'lightningcss'
    ? compileLightningCSS(
        environment,
        id,
        code,
        deps,
        workerController,
        urlResolver,
      )
    : compilePostCSS(
        environment,
        id,
        code,
        deps,
        lang,
        workerController,
        urlResolver,
      ))

  if (!transformResult) {
    return {
      code,
      map: config.css.devSourcemap ? preprocessorMap : { mappings: '' },
      deps,
    }
  }

  return {
    ...transformResult,
    map: config.css.devSourcemap
      ? combineSourcemapsIfExists(
          cleanUrl(id),
          typeof transformResult.map === 'string'
            ? JSON.parse(transformResult.map)
            : transformResult.map,
          preprocessorMap,
        )
      : { mappings: '' },
    deps,
  }
}

/** 执行 PostCSS 配置、CSS Modules 与 URL 重写，并汇总转换结果。 */
async function compilePostCSS(
  environment: PartialEnvironment,
  id: string,
  code: string,
  deps: Set<string>,
  lang: CssLang | undefined,
  workerController: PreprocessorWorkerController,
  urlResolver?: CssUrlResolver,
): Promise<
  | {
      /** 转换后代码。 */
      code: string
      /** 与转换后代码对应的 sourcemap。 */
      map?: Exclude<SourceMapInput, string>
      /** CSS Modules 的原类名到导出名映射。 */
      modules?: Record<string, string>
    }
  | undefined
> {
  const { config } = environment
  const { modules: modulesOptions, devSourcemap } = config.css
  const isModule = modulesOptions !== false && cssModuleRE.test(id)
  // 开发态浏览器虽能直接消费普通 @import，但仍需内联遍历以登记 watch 依赖。
  const needInlineImport = code.includes('@import')
  const hasUrl = cssUrlRE.test(code) || cssImageSetRE.test(code)
  const postcssConfig = await resolvePostcssConfig(
    environment.getTopLevelConfig(),
  )

  // 无方言、配置、Modules、@import、URL 时可跳过 PostCSS 快路径。
  if (
    lang !== 'sss' &&
    !postcssConfig &&
    !isModule &&
    !needInlineImport &&
    !hasUrl
  ) {
    return
  }

  // 以下按需组装 PostCSS 插件链。
  const atImportResolvers = getAtImportResolvers(
    environment.getTopLevelConfig(),
  )
  const postcssPlugins = postcssConfig?.plugins.slice() ?? []

  if (needInlineImport) {
    postcssPlugins.unshift(
      (await importPostcssImport()).default({
        /** 先处理 public 文件，再用 Vite CSS resolver 解析 `@import`；失败时保留原 ID。 */
        async resolve(id, basedir, _importOptions, atRule) {
          const publicFile = checkPublicFile(
            id,
            environment.getTopLevelConfig(),
          )
          if (publicFile) {
            return publicFile
          }

          const resolved = await atImportResolvers.css(
            environment,
            id,
            // 只有其他插件注入且无 source 的 @import 节点缺 importer；此时 resolver 回退项目 root。
            atRule.source?.input.file,
          )

          if (resolved) {
            return path.resolve(resolved)
          }

          // 原 postcss-import 未解析时会回退 resolve 包；Vite 为缩小 bundle 移除了该依赖，因此在这里
          // 主动给出明确错误。
          if (!path.isAbsolute(id)) {
            environment.logger.error(
              colors.red(
                `Unable to resolve \`@import "${id}"\` from ${basedir}`,
              ),
            )
          }

          return id
        },
        /** 读取 `@import` 文件；预处理语言先编译并把新依赖并入当前模块。 */
        async load(id) {
          const code = await fs.promises.readFile(id, 'utf-8')
          const lang = CSS_LANGS_RE.exec(id)?.[1] as CssLang | undefined
          if (isPreProcessor(lang)) {
            const result = await compileCSSPreprocessors(
              environment,
              id,
              lang,
              code,
              workerController,
            )
            result.deps?.forEach((dep) => deps.add(dep))
            // TODO：支持被 @import 预处理文件的 sourcemap 合并。
            return result.code
          }
          return code
        },
        /** 为 CSS Modules 的 cascade layer 生成稳定且不冲突的名称。 */
        nameLayer(index) {
          return `vite--anon-layer-${getHash(id)}-${index}`
        },
      }),
    )
  }

  if (
    urlResolver &&
    // 只要存在任一 PostCSS 插件（含内置插件），就必须追加 URL 重写器：前置插件可能注入源文件中原本
    // 不存在的 url()/image-set()。
    (postcssPlugins.length > 0 || isModule || hasUrl)
  ) {
    postcssPlugins.push(
      UrlRewritePostcssPlugin({
        resolver: urlResolver,
        deps,
        logger: environment.logger,
      }),
    )
  }

  let modules: Record<string, string> | undefined

  if (isModule) {
    postcssPlugins.unshift(
      (await importPostcssModules()).default({
        ...modulesOptions,
        localsConvention: modulesOptions?.localsConvention,
        /** 接收 CSS Modules 生成的类名映射，并保存到当前模块的转换结果。 */
        getJSON(
          cssFileName: string,
          _modules: Record<string, string>,
          outputFileName: string,
        ) {
          modules = _modules
          if (modulesOptions && typeof modulesOptions.getJSON === 'function') {
            modulesOptions.getJSON(cssFileName, _modules, outputFileName)
          }
        },
        /** 依次尝试当前语言允许的 resolver，为 CSS Modules `composes` 定位文件。 */
        async resolve(id: string, importer: string) {
          for (const key of getCssResolversKeys(atImportResolvers)) {
            const resolved = await atImportResolvers[key](
              environment,
              id,
              importer,
            )
            if (resolved) {
              return path.resolve(resolved)
            }
          }

          return id
        },
      }),
    )
  }

  const postcssOptions = postcssConfig?.options ?? {}
  const postcssParser =
    lang === 'sss' ? await loadSss(config.root) : postcssOptions.parser

  if (!postcssPlugins.length && !postcssParser) {
    return
  }

  const result = await runPostCSS(
    id,
    code,
    postcssPlugins,
    { ...postcssOptions, parser: postcssParser },
    deps,
    environment.logger,
    devSourcemap,
  )
  return { ...result, modules }
}

/** 使用 SugarSS 语法解析输入，再把结果交给标准 PostCSS 流程。 */
async function transformSugarSS(
  environment: PartialEnvironment,
  id: string,
  code: string,
) {
  const { config } = environment
  const { devSourcemap } = config.css

  const sssParser = await loadSss(config.root)
  const result = await runPostCSS(
    id,
    code,
    [],
    { parser: sssParser },
    undefined,
    environment.logger,
    devSourcemap,
  )
  return result
}

/** 运行 PostCSS 插件链，统一收集消息中的依赖、模块映射和 sourcemap。 */
async function runPostCSS(
  id: string,
  code: string,
  plugins: PostCSS.AcceptedPlugin[],
  options: PostCSS.ProcessOptions,
  deps: Set<string> | undefined,
  logger: Logger,
  enableSourcemap: boolean,
) {
  let postcssResult: PostCSS.Result
  try {
    const source = removeDirectQuery(id)
    const postcss = await importPostcss()

    // PostCSS 是未打进 Vite bundle 的可选依赖，首次实际需要时再惰性加载。
    postcssResult = await postcss.default(plugins).process(code, {
      ...options,
      to: source,
      from: source,
      ...(enableSourcemap
        ? {
            map: {
              inline: false,
              annotation: false,
              // PostCSS 可能返回虚拟 source，Vite无法另行读取其内容，因此必须内嵌 sourcesContent。
              sourcesContent: true,
              // 若直接传 prev: preprocessorMap，结果 sources 可能重复文件名；Vite 稍后统一 combine。
              // 有意不传：prev: preprocessorMap,
            },
          }
        : {}),
    })

    // 把 PostCSS 插件消息中的单文件/目录依赖汇总为 watcher deps。
    for (const message of postcssResult.messages) {
      if (message.type === 'dependency') {
        deps?.add(normalizePath(message.file as string))
      } else if (message.type === 'dir-dependency') {
        // https://github.com/postcss/postcss/blob/main/docs/guidelines/plugin.md#3-dependencies
        const { dir, glob: globPattern = '**' } = message
        const files = globSync(globPattern, {
          absolute: true,
          cwd: path.resolve(path.dirname(id), dir),
          expandDirectories: false,
          ignore: ['**/node_modules/**'],
        })
        for (let i = 0; i < files.length; i++) {
          deps?.add(files[i])
        }
      } else if (message.type === 'warning') {
        const warning = message as PostCSS.Warning
        let msg = `[vite:css][postcss] ${warning.text}`
        msg += `\n${generateCodeFrame(
          code,
          {
            line: warning.line,
            column: warning.column - 1, // PostCSS 列号从 1 开始，code frame 使用 0-based。
          },
          warning.endLine !== undefined && warning.endColumn !== undefined
            ? {
                line: warning.endLine,
                column: warning.endColumn - 1, // 同上，转换为 0-based。
              }
            : undefined,
        )}`
        logger.warn(colors.yellow(msg))
      }
    }
  } catch (e) {
    e.message = `[postcss] ${e.message}`
    e.code = code
    e.loc = {
      file: e.file,
      line: e.line,
      column: e.column - 1, // PostCSS 错误列号从 1 开始。
    }
    throw e
  }

  if (!enableSourcemap) {
    return {
      code: postcssResult.css,
      map: { mappings: '' as const },
    }
  }

  const rawPostcssMap = postcssResult.map.toJSON()
  const postcssMap = await formatPostcssSourceMap(
    // PostCSS 类型把 version 声明为 string，运行时实际为数字 3。
    rawPostcssMap as Omit<RawSourceMap, 'version'> as ExistingRawSourceMap,
    cleanUrl(id),
  )

  return {
    code: postcssResult.css,
    map: postcssMap,
  }
}

/** 缓存首次动态导入的模块实例，后续调用直接复用已解析结果。 */
function createCachedImport<T>(imp: () => Promise<T>): () => T | Promise<T> {
  let cached: T | Promise<T>
  return () => {
    if (!cached) {
      cached = imp().then((module) => {
        cached = module
        return module
      })
    }
    return cached
  }
}
/** 惰性加载并缓存 `postcss-import`，仅在需要解析导入时产生开销。 */
const importPostcssImport = createCachedImport(() => import('postcss-import'))
/** 惰性加载并缓存 `postcss-modules`，仅在模块样式中产生开销。 */
const importPostcssModules = createCachedImport(() => import('postcss-modules'))
/** 惰性加载并缓存 PostCSS 主模块。 */
const importPostcss = createCachedImport(() => import('postcss'))

/** 按配置缓存预处理器 worker 控制器，使并发池不跨配置串用。 */
const preprocessorWorkerControllerCache = new WeakMap<
  ResolvedConfig,
  PreprocessorWorkerController
>()
let alwaysFakeWorkerWorkerControllerCache:
  | PreprocessorWorkerController
  | undefined

/** 描述公开 `preprocessCSS` API 返回的代码、映射、模块名和依赖。 */
export interface PreprocessCSSResult {
  /** 转换后代码。 */
  code: string
  /** 与转换后代码对应的 sourcemap。 */
  map?: SourceMapInput
  /** CSS Modules 的原类名到导出名映射。 */
  modules?: Record<string, string>
  /** 转换过程中解析出的文件依赖集合。 */
  deps?: Set<string>
}

/** @experimental 在插件钩子外复用 Vite CSS 编译链，返回代码、map、modules 与依赖。 */
export async function preprocessCSS(
  code: string,
  filename: string,
  config: ResolvedConfig,
): Promise<PreprocessCSSResult> {
  let workerController = preprocessorWorkerControllerCache.get(config)

  if (!workerController) {
    // 脱离插件生命周期调用 preprocessCSS 时没有 workerController；复用永远在主线程执行的 fake
    // controller，因为它不像真实 worker pool 那样要求调用 close。
    alwaysFakeWorkerWorkerControllerCache ||=
      createPreprocessorWorkerController(0)
    workerController = alwaysFakeWorkerWorkerControllerCache
  }

  // preprocessCSS 固定使用 client Environment。CSS 通常只供 client 消费，server build 还需与 client
  // asset chunk 名一致才能去重 link；若未来出现依 Environment 编译 CSS 的需求，应重新审视此约束。
  const environment: PartialEnvironment = new PartialEnvironment(
    'client',
    config,
  )

  return await compileCSS(environment, filename, code, workerController)
}

/** 把 PostCSS 相对/虚拟 sources 规范为 Vite sourcemap 使用的绝对或 null-byte ID。 */
export async function formatPostcssSourceMap(
  rawMap: ExistingRawSourceMap,
  file: string,
): Promise<ExistingRawSourceMap> {
  const inputFileDir = path.dirname(file)

  // 真实 Sourcemap.sources 可能为 null，但 Rolldown 类型未表达；调用方保证此处可遍历。
  const sources = rawMap.sources!.map((source) => {
    const cleanSource = cleanUrl(decodeURIComponent(source!))

    // PostCSS `<input css ...>` 等虚拟 source 用 null byte 标记，避免被当磁盘绝对路径。
    if (cleanSource[0] === '<' && cleanSource.endsWith('>')) {
      return `\0${cleanSource}`
    }

    return normalizePath(path.resolve(inputFileDir, cleanSource))
  })

  return {
    file,
    mappings: rawMap.mappings,
    names: rawMap.names,
    sources,
    sourcesContent: rawMap.sourcesContent,
    version: rawMap.version,
  }
}

/** 仅在映射存在时合并预处理器与后续转换的 sourcemap，并保留空映射语义。 */
function combineSourcemapsIfExists(
  filename: string,
  map1:
    ExistingRawSourceMap
    | {
        /** 用空字符串标记第一段转换已主动截断映射链。 */
        mappings: ''
      }
    | undefined,
  map2:
    ExistingRawSourceMap
    | {
        /** 用空字符串标记第二段转换已主动截断映射链。 */
        mappings: ''
      }
    | undefined,
):
  ExistingRawSourceMap
  | {
      /** 合并结果以空字符串表示没有可继续追溯的源码位置。 */
      mappings: ''
    }
  | undefined {
  if (!map1 || !map2) {
    return map1
  }
  if (map1.mappings === '' || map2.mappings === '') {
    return { mappings: '' }
  }
  return combineSourcemaps(filename, [
    // ExistingRawSourceMap.version 类型是 number，实际始终为 3；combine API 使用另一份 RawSourceMap 类型。
    map1 as RawSourceMap,
    map2 as RawSourceMap,
  ]) as ExistingRawSourceMap
}

/** 开发态 CSS 哈希占位标记，客户端据此识别内容版本。 */
const viteHashUpdateMarker = '/*$vite$:1*/'
/** 匹配已有 CSS 哈希标记，以便热更新时替换而非重复追加。 */
const viteHashUpdateMarkerRE = /\/\*\$vite\$:\d+\*\//

/** 执行 CSS 压缩或格式整理，并按配置补齐最终 sourcemap。 */
async function finalizeCss(css: string, config: ResolvedConfig) {
  // 按 CSS 规范把外部 @import/@charset 提升到聚合 chunk 顶部（#1845/#6333）。
  if (css.includes('@import') || css.includes('@charset')) {
    css = hoistAtRules(css)
  }
  if (config.build.cssMinify) {
    css = await minifyCSS(css, config, false)
  }
  // Vite 5.4.3 给 CSS link 增加 crossorigin 后，Chromium 可能因旧缓存条目缺少该请求属性而
  // 阻止相同内容 hash 的 CSS。追加内部 marker 强制跨版本生成新 hash；generateBundle 发射前再移除，
  // 不污染最终 CSS 内容。
  // 回归：https://github.com/vitejs/vite/issues/18038
  // 浏览器背景：https://www.hacksoft.io/blog/handle-images-cors-error-in-chrome
  // Chromium issue：https://issues.chromium.org/issues/40381978
  css += viteHashUpdateMarker
  return css
}

/** 表示已加载的 PostCSS 处理选项与规范化插件列表。 */
interface PostCSSConfigResult {
  /** 传给下游处理器的规范化选项。 */
  options: PostCSS.ProcessOptions
  /** 按顺序执行的 PostCSS 插件列表。 */
  plugins: PostCSS.AcceptedPlugin[]
}

/** 从内联配置或配置文件解析 PostCSS，并把搜索失败包装成 CSS 错误。 */
async function resolvePostcssConfig(
  config: ResolvedConfig,
): Promise<PostCSSConfigResult | null> {
  let result = postcssConfigCache.get(config)
  if (result !== undefined) {
    return await result
  }

  // Vite config 内联对象优先；字符串指定搜索目录，否则从 root 向 workspace 边界查配置文件。
  const inlineOptions = config.css.postcss
  if (isObject(inlineOptions)) {
    const options = { ...inlineOptions }

    delete options.plugins
    result = {
      options,
      plugins: inlineOptions.plugins || [],
    }
  } else {
    const searchPath =
      typeof inlineOptions === 'string' ? inlineOptions : config.root
    const stopDir = searchForWorkspaceRoot(config.root)
    result = postcssrc({}, searchPath, { stopDir }).catch((e) => {
      if (!e.message.includes('No PostCSS Config found')) {
        if (e instanceof Error) {
          const { name, message, stack } = e
          e.name = 'Failed to load PostCSS config'
          e.message = `Failed to load PostCSS config (searchPath: ${searchPath}): [${name}] ${message}\n${stack}`
          e.stack = '' // stack 已拼进 message，清空避免日志重复打印。
          throw e
        } else {
          throw new Error(`Failed to load PostCSS config: ${e}`)
        }
      }
      return null
    })
    // 成功后把缓存 Promise 替换为结果对象，后续调用无额外 microtask/then 链。
    result.then(
      (resolved) => {
        postcssConfigCache.set(config, resolved)
      },
      () => {
        /* 保留 rejected Promise，让后续 transform 得到同一错误。 */
      },
    )
  }

  postcssConfigCache.set(config, result)
  return result
}

/** 定义 CSS URL 到文件或公共资源路径的异步解析契约。 */
type CssUrlResolver = (
  url: string,
  importer?: string,
) =>
  | [url: string, id: string | undefined]
  | Promise<[url: string, id: string | undefined]>
/**
 * CSS URL 引用替换器。
 *
 * 返回 false 表示保持原内容不变。
 */
type CssUrlReplacer = (
  unquotedUrl: string,
  rawUrl: string,
) => string | false | Promise<string | false>
// https://drafts.csswg.org/css-syntax-3/#identifier-code-point
export const cssUrlRE: RegExp =
  /(?<!@import\s+)(?<=^|[^\w\-\u0080-\uffff])url\((\s*('[^']+'|"[^"]+")\s*|(?:\\.|[^'")\\])+)\)/
/** 匹配 CSS 中的 `data-uri()` 扩展调用并提取参数。 */
export const cssDataUriRE: RegExp =
  /(?<=^|[^\w\-\u0080-\uffff])data-uri\((\s*('[^']+'|"[^"]+")\s*|[^'")]+)\)/
/** 匹配指向 CSS 文件的 `@import`，供 URL 解析与重写。 */
export const importCssRE: RegExp =
  /@import\s+(?:url\()?('[^']+\.css'|"[^"]+\.css"|[^'"\s)]+\.css)/
// 假设 CSS 函数名不会超过 256 个字符，限制前瞻范围以避免灾难性回溯。
/** 提取 `image-set()` 参数区域，长度上限避免恶意输入触发过量回溯。 */
// eslint-disable-next-line regexp/no-unused-capturing-group -- doesn't detect asyncReplace usage
const cssImageSetRE = /(?<=image-set\()((?:[\w-]{1,256}\([^)]*\)|[^)])*)(?=\))/

/** 创建 PostCSS URL 重写插件，在树遍历结束时统一处理声明与导入规则。 */
const UrlRewritePostcssPlugin: PostCSS.PluginCreator<{
  /** 解析变量动态导入中的模块 ID，并将裸导入规范化为可展开的相对路径。 */
  resolver: CssUrlResolver
  /** 转换过程中解析出的文件依赖集合。 */
  deps: Set<string>
  /** 用于报告无法解析资源等非致命问题的环境日志器。 */
  logger: Logger
}> = (opts) => {
  if (!opts) {
    throw new Error('base or replace is required')
  }

  return {
    postcssPlugin: 'vite-url-rewrite',
    /** 在 PostCSS 完成遍历后并行重写 URL、导入与 image-set 引用。 */
    OnceExit(root) {
      const promises: Promise<void>[] = []
      root.walkDecls((declaration) => {
        const importer = declaration.source?.input.file
        if (!importer) {
          opts.logger.warnOnce(
            '\nA PostCSS plugin did not pass the `from` option to `postcss.parse`. ' +
              'This may cause imported assets to be incorrectly transformed. ' +
              "If you've recently added a PostCSS plugin that raised this warning, " +
              'please contact the package author to fix the issue.',
          )
        }
        const isCssUrl = cssUrlRE.test(declaration.value)
        const isCssImageSet = cssImageSetRE.test(declaration.value)
        if (isCssUrl || isCssImageSet) {
          /** 根据声明属性选择 URL、data-uri 或 image-set 重写器，并保留原始格式。 */
          const replacerForDeclaration = async (rawUrl: string) => {
            const [newUrl, resolvedId] = await opts.resolver(rawUrl, importer)
            if (resolvedId) {
              opts.deps.add(resolvedId)
            }
            return newUrl
          }
          if (isCssUrl && isCssImageSet) {
            promises.push(
              rewriteCssUrls(declaration.value, replacerForDeclaration)
                .then((url) => rewriteCssImageSet(url, replacerForDeclaration))
                .then((url) => {
                  declaration.value = url
                }),
            )
          } else {
            const rewriterToUse = isCssImageSet
              ? rewriteCssImageSet
              : rewriteCssUrls
            promises.push(
              rewriterToUse(declaration.value, replacerForDeclaration).then(
                (url) => {
                  declaration.value = url
                },
              ),
            )
          }
        }
      })
      if (promises.length) {
        return Promise.all(promises) as any
      }
    },
  }
}
UrlRewritePostcssPlugin.postcss = true

/** 重写普通 `url()` 中的资源地址，并保留引号与空白格式。 */
function rewriteCssUrls(
  css: string,
  replacer: CssUrlReplacer,
): Promise<string> {
  return asyncReplace(css, cssUrlRE, async (match) => {
    const [matched, rawUrl] = match
    return await doUrlReplace(rawUrl.trim(), matched, replacer)
  })
}

/** 解析并重写 `data-uri()` 引用，使文件内容可内联进 CSS。 */
function rewriteCssDataUris(
  css: string,
  replacer: CssUrlReplacer,
): Promise<string> {
  return asyncReplace(css, cssDataUriRE, async (match) => {
    const [matched, rawUrl] = match
    return await doUrlReplace(rawUrl.trim(), matched, replacer, 'data-uri')
  })
}

/** 重写 `@import` 的 CSS 文件地址，并记录解析到的依赖。 */
function rewriteImportCss(
  css: string,
  replacer: CssUrlReplacer,
): Promise<string> {
  return asyncReplace(css, importCssRE, async (match) => {
    const [matched, rawUrl] = match
    return await doImportCSSReplace(rawUrl, matched, replacer)
  })
}

// TODO：image()/cross-fade() 内也可能包含需处理的 URL。
// https://drafts.csswg.org/css-images-4/#image-notation
// https://drafts.csswg.org/css-images-4/#cross-fade-function
const cssNotProcessedRE = /(?:gradient|element|cross-fade|image)\(/

/** 逐项重写 `image-set()` 候选 URL，同时保留分辨率描述符。 */
async function rewriteCssImageSet(
  css: string,
  replacer: CssUrlReplacer,
): Promise<string> {
  return await asyncReplace(css, cssImageSetRE, async (match) => {
    const [, rawUrl] = match
    const url = await processSrcSet(rawUrl, async ({ url }) => {
      // image-set 的单项既可能是裸 URL，也可能仍包着 url(...)。
      if (cssUrlRE.test(url)) {
        return await rewriteCssUrls(url, replacer)
      }
      if (!cssNotProcessedRE.test(url)) {
        return await doUrlReplace(url, url, replacer)
      }
      return url
    })
    return url
  })
}
/** 判断 URL 是否应保持原样，例如外部协议、数据 URL 或 CSS 变量。 */
function skipUrlReplacer(unquotedUrl: string) {
  return (
    isExternalUrl(unquotedUrl) ||
    isDataUrl(unquotedUrl) ||
    unquotedUrl[0] === '#' ||
    functionCallRE.test(unquotedUrl) ||
    // 已编码为 Vite asset/public 占位符时不要二次处理。
    unquotedUrl.startsWith('__VITE_ASSET__') ||
    unquotedUrl.startsWith('__VITE_PUBLIC_ASSET__')
  )
}
/** 解析单个 CSS 资源 URL；无法解析时记录警告并保留原值。 */
async function doUrlReplace(
  rawUrl: string,
  matched: string,
  replacer: CssUrlReplacer,
  funcName: string = 'url',
) {
  let wrap = ''
  const first = rawUrl[0]
  let unquotedUrl = rawUrl
  if (first === `"` || first === `'`) {
    wrap = first
    unquotedUrl = rawUrl.slice(1, -1)
  }
  if (skipUrlReplacer(unquotedUrl)) {
    return matched
  }
  // 解析前移除 CSS 转义，恢复真实文件名。
  unquotedUrl = unquotedUrl.replace(/\\(\W)/g, '$1')

  let newUrl = await replacer(unquotedUrl, rawUrl)
  if (newUrl === false) {
    return matched
  }

  // 替换后可能新增空格或 `)`，即使原 URL 无引号，新 URL 也必须补引号。
  if (wrap === '' && (newUrl !== encodeURI(newUrl) || newUrl.includes(')'))) {
    wrap = '"'
  }
  // 单引号 wrapper 与 URL 自身单引号冲突时改用双引号；优先双引号，因为 SVG 内联通常把原双引号转为
  // 单引号，冲突概率更低。
  if (wrap === "'" && newUrl.includes("'")) {
    wrap = '"'
  }
  // 使用双引号 wrapper 时转义 URL 中仍存在的双引号。
  if (wrap === '"' && newUrl.includes('"')) {
    newUrl = newUrl.replace(nonEscapedDoubleQuoteRe, '\\"')
  }
  return `${funcName}(${wrap}${newUrl}${wrap})`
}

/** 解析 CSS 导入并登记依赖；外部或无法解析的地址保持不变。 */
async function doImportCSSReplace(
  rawUrl: string,
  matched: string,
  replacer: CssUrlReplacer,
) {
  let wrap = ''
  const first = rawUrl[0]
  let unquotedUrl = rawUrl
  if (first === `"` || first === `'`) {
    wrap = first
    unquotedUrl = rawUrl.slice(1, -1)
  }
  if (skipUrlReplacer(unquotedUrl)) {
    return matched
  }

  const newUrl = await replacer(unquotedUrl, rawUrl)
  if (newUrl === false) {
    return matched
  }

  const prefix = matched.includes('url(') ? 'url(' : ''
  return `@import ${prefix}${wrap}${newUrl}${wrap}`
}

/** 根据 build.cssMinify 选择 esbuild/Lightning CSS，并统一 inline 与 asset 的尾换行约定和错误位置。 */
async function minifyCSS(
  css: string,
  config: ResolvedConfig,
  inlined: boolean,
  filename: string = defaultCssBundleName,
) {
  // inline CSS 不应以换行结尾，普通 CSS asset 则保留一个尾换行：
  // https://github.com/vitejs/vite/pull/13893#issuecomment-1678628198

  if (config.build.cssMinify === 'esbuild') {
    const { transform, formatMessages } = await importEsbuild()
    try {
      const { code, warnings } = await transform(css, {
        loader: 'css',
        target: config.build.cssTarget || undefined,
        sourcefile: filename,
        ...resolveMinifyCssEsbuildOptions(config.esbuild || {}),
      })
      if (warnings.length) {
        const msgs = await formatMessages(warnings, { kind: 'warning' })
        config.logger.warn(
          colors.yellow(`[esbuild css minify]\n${msgs.join('\n')}`),
        )
      }
      // esbuild 输出自带尾换行；inline 场景单独 trimEnd。
      return inlined ? code.trimEnd() : code
    } catch (e) {
      if (e.errors) {
        e.message = '[esbuild css minify] ' + e.message
        const msgs = await formatMessages(e.errors, { kind: 'error' })
        e.frame = '\n' + msgs.join('\n')
        e.loc = e.errors[0].location
      }
      throw e
    }
  }

  try {
    const { code, warnings } = (await importLightningCSS()).transform({
      ...config.css.lightningcss,
      targets: convertTargets(config.build.cssTarget),
      filename,
      code: Buffer.from(css),
      minify: true,
      // 语法转换/CSS Modules/visitor 已在 compileLightningCSS 完成，压缩阶段必须关闭以免重复处理。
      cssModules: undefined,
      visitor: undefined,
      customAtRules: undefined,
    })

    for (const warning of warnings) {
      let msg = `[lightningcss minify] ${warning.message}`
      msg += `\n${generateCodeFrame(css, {
        line: warning.loc.line,
        column: warning.loc.column - 1, // Lightning CSS 列号为 1-based。
      })}`
      config.logger.warn(colors.yellow(msg))
    }

    // Node 返回 Buffer、Deno 返回 Uint8Array，统一用 TextDecoder 解码。Lightning CSS 不带尾换行，
    // 非 inline asset 手工补一个。
    return decoder.decode(code) + (inlined ? '' : '\n')
  } catch (e) {
    e.message = `[lightningcss minify] ${e.message}`
    const friendlyMessage = getLightningCssErrorMessageForIeSyntaxes(css)
    if (friendlyMessage) {
      e.message += friendlyMessage
    }

    if (e.loc) {
      e.loc = {
        line: e.loc.line,
        column: e.loc.column - 1, // 转成 Vite code frame 使用的 0-based 列号。
      }
      e.frame = generateCodeFrame(css, e.loc)
    }
    throw e
  }
}

/** 把 CSS 压缩配置归一化为 esbuild 可接受的目标与字符集选项。 */
function resolveMinifyCssEsbuildOptions(
  options: ESBuildOptions,
): EsbuildTransformOptions {
  const base: EsbuildTransformOptions = {
    charset: options.charset,
    logLevel: options.logLevel,
    logLimit: options.logLimit,
    logOverride: options.logOverride,
    legalComments: options.legalComments,
  }

  if (
    options.minifyIdentifiers != null ||
    options.minifySyntax != null ||
    options.minifyWhitespace != null
  ) {
    return {
      ...base,
      minifyIdentifiers: options.minifyIdentifiers ?? true,
      minifySyntax: options.minifySyntax ?? true,
      minifyWhitespace: options.minifyWhitespace ?? true,
    }
  } else {
    return { ...base, minify: true }
  }
}

/** 匹配需要提取和规范化的 CSS `@import` 规则。 */
const atImportRE =
  /@import(?:\s*(?:url\([^)]*\)|"(?:[^"]|(?<=\\)")*"|'(?:[^']|(?<=\\)')*').*?|[^;]*);/g
/** 匹配 CSS `@charset` 声明，以确保合并后只保留合法位置。 */
const atCharsetRE =
  /@charset(?:\s*(?:"(?:[^"]|(?<=\\)")*"|'(?:[^']|(?<=\\)')*').*?|[^;]*);/g

/** 聚合多个 CSS 文件后，把 @import 按原顺序提升到顶部，并只保留/提升第一个 @charset。 */
export function hoistAtRules(css: string): string {
  const s = new MagicString(css)
  const cleanCss = emptyCssComments(css)
  let match: RegExpExecArray | null

  // #1845：CSS @import 只能位于文件顶部；正则匹配到不在引号中的分号为止。
  atImportRE.lastIndex = 0
  while ((match = atImportRE.exec(cleanCss))) {
    s.remove(match.index, match.index + match[0].length)
    // 使用 appendLeft(0) 而不是 prepend，保留多个 @import 的原始顺序。
    s.appendLeft(0, match[0])
  }

  // #6333：@charset 必须是首条规则；删除全部声明，只把第一个提升到顶部。
  atCharsetRE.lastIndex = 0
  let foundCharset = false
  while ((match = atCharsetRE.exec(cleanCss))) {
    s.remove(match.index, match.index + match[0].length)
    if (!foundCharset) {
      s.prepend(match[0])
      foundCharset = true
    }
  }

  return s.toString()
}

// 预处理器支持；整体协议主要沿用 @vue/compiler-sfc。

/** 描述预处理器附加内容回调返回的源码及可选 sourcemap。 */
type PreprocessorAdditionalDataResult =
  | string
  | {
      /** 注入附加数据后的完整样式源码。 */
      content: string;
      /** 附加数据回调为新源码提供的映射。 */
      map?: ExistingRawSourceMap
    }

/** 定义预处理前追加源码的静态文本或异步回调形式。 */
type PreprocessorAdditionalData =
  | string
  | ((
      source: string,
      filename: string,
    ) =>
      | PreprocessorAdditionalDataResult
      | Promise<PreprocessorAdditionalDataResult>)

/** 扩展 Sass 配置，并允许在每个文件编译前注入附加源码。 */
export type SassPreprocessorOptions = {
  /** 在原始样式前后注入的可选附加源码。 */
  additionalData?: PreprocessorAdditionalData
} & SassModernPreprocessBaseOptions

/** 扩展 Less 配置，并允许在每个文件编译前注入附加源码。 */
export type LessPreprocessorOptions = {
  /** 在原始样式前后注入的可选附加源码。 */
  additionalData?: PreprocessorAdditionalData
} & LessPreprocessorBaseOptions

/** 扩展 Stylus 配置，并允许在每个文件编译前注入附加源码。 */
export type StylusPreprocessorOptions = {
  /** 在原始样式前后注入的可选附加源码。 */
  additionalData?: PreprocessorAdditionalData
} & StylusPreprocessorBaseOptions

/** 定义 Vite 传给各样式预处理器的文件名、并发和映射选项。 */
type StylePreprocessorInternalOptions = {
  /** 预处理器允许使用的最大 worker 数；true 表示自动计算。 */
  maxWorkers?: number | true
  /** 当前处理文件的规范化文件名。 */
  filename: string
  /** 是否要求预处理器生成 sourcemap。 */
  enableSourcemap: boolean
}

/** 组合 Sass 用户配置与 Vite 内部预处理控制字段。 */
type SassStylePreprocessorInternalOptions = StylePreprocessorInternalOptions &
  SassPreprocessorOptions

/** 组合 Less 用户配置与 Vite 内部预处理控制字段。 */
type LessStylePreprocessorInternalOptions = StylePreprocessorInternalOptions &
  LessPreprocessorOptions

/** 组合 Stylus 用户配置与 Vite 内部预处理控制字段。 */
type StylusStylePreprocessorInternalOptions = StylePreprocessorInternalOptions &
  StylusPreprocessorOptions

/** 约束样式预处理器的编译入口和 worker 关闭生命周期。 */
type StylePreprocessor<Options extends StylePreprocessorInternalOptions> = {
  /** 编译一种样式语言并返回规范化结果。 */
  process: (
    environment: PartialEnvironment,
    source: string,
    root: string,
    options: Options,
    resolvers: CSSAtImportResolvers,
  ) => StylePreprocessorResults | Promise<StylePreprocessorResults>
  /** 释放该预处理器持有的 worker 与模块资源。 */
  close: () => void | Promise<void>
}

/** 描述预处理器输出、依赖、映射以及可延后抛出的错误。 */
export interface StylePreprocessorResults {
  /** 转换后代码。 */
  code: string
  /** 与转换后代码对应的 sourcemap。 */
  map?: ExistingRawSourceMap | undefined
  /** 附加源码回调产生、需与编译映射合并的 sourcemap。 */
  additionalMap?: ExistingRawSourceMap | undefined
  /** worker 延后返回、由主线程按插件协议抛出的错误。 */
  error?: RollupError
  /** 转换过程中解析出的文件依赖集合。 */
  deps: string[]
}

/** 缓存已解析的预处理器包路径，避免对同一根目录重复查找。 */
const loadedPreprocessorPath: Partial<
  Record<PreprocessLang | PostCssDialectLang | 'sass-embedded', string>
> = {}

/** 从项目根目录解析可选预处理器包；缺失时给出可操作的安装错误。 */
function loadPreprocessorPath(
  lang: PreprocessLang | PostCssDialectLang | 'sass-embedded',
  root: string,
): string {
  const cached = loadedPreprocessorPath[lang]
  if (cached) {
    return cached
  }

  // 先从项目 root 解析，允许用户控制版本；再回退当前 Vite 安装位置。
  const resolved =
    nodeResolveWithVite(lang, undefined, { root }) ??
    nodeResolveWithVite(lang, _dirname, { root })
  if (resolved) return (loadedPreprocessorPath[lang] = resolved)

  // 找不到可选预处理器时给出当前包管理器对应的安装命令。
  const installCommand = getPackageManagerCommand('install')
  throw new Error(
    `Preprocessor dependency "${lang}" not found. Did you install it? Try \`${installCommand} -D ${lang}\`.`,
  )
}

/** 按配置选择 Sass 实现，并返回包名与解析后的入口路径。 */
function loadSassPackage(
  root: string,
  skipEmbedded = false,
): {
  /** 实际选中的 Sass 包名，用于动态导入和错误回退。 */
  name: 'sass' | 'sass-embedded'
  /** 解析得到的文件系统路径。 */
  path: string
} {
  // 默认优先 sass-embedded；明确 skipEmbedded 时直接使用 sass。
  if (!skipEmbedded) {
    try {
      const path = loadPreprocessorPath('sass-embedded', root)
      return { name: 'sass-embedded', path }
    } catch (e1) {
      try {
        const path = loadPreprocessorPath(PreprocessLang.sass, root)
        return { name: 'sass', path }
      } catch {
        throw e1
      }
    }
  }

  // sass-embedded 不可用或被跳过时解析普通 sass。
  const path = loadPreprocessorPath(PreprocessLang.sass, root)
  return { name: 'sass', path }
}

let cachedSss: PostCSS.Syntax | Promise<PostCSS.Syntax>
/** 加载 SugarSS 语法模块；依赖缺失时转换为 Vite 配置错误。 */
async function loadSss(root: string): Promise<PostCSS.Syntax> {
  if (!cachedSss) {
    cachedSss = (async () => {
      const sssPath = loadPreprocessorPath(PostCssDialectLang.sss, root)
      const resolved = (await import(pathToFileURL(sssPath).href)).default
      return (cachedSss = resolved)
    })()
  }
  return cachedSss
}

/** 声明 worker 包装代码引用的浏览器 `window` 全局，实际值由运行环境提供。 */
declare const window: unknown
/** 声明 worker 包装代码引用的浏览器 `location` 全局，实际值由运行环境提供。 */
declare const location:
  {
      /** 当前文档的绝对 URL，旧版 Sass 可能把它附加到错误路径。 */
      href: string
    }
  | undefined

// Unix 环境若 shim 了 location，Dart Sass 可能给路径错误附加 location.href：
// https://github.com/sass/dart-sass/issues/710
/** 清理 Sass 旧实现产生的异常 file URL，恢复可交给解析器的路径。 */
function cleanScssBugUrl(url: string) {
  if (
    // 只有同时存在浏览器式 window/location 全局时才应用这个兼容清理。
    typeof window !== 'undefined' &&
    typeof location !== 'undefined' &&
    typeof location.href === 'string'
  ) {
    const prefix = location.href.replace(/\/$/, '')
    return url.replace(prefix, '')
  } else {
    return url
  }
}

// #region Sass（.scss/.sass 处理器）
/** 创建 Sass worker 调度器，并在真实 worker 与当前线程执行之间切换。 */
const makeScssWorker = (
  environment: PartialEnvironment,
  resolvers: CSSAtImportResolvers,
  _maxWorkers: number | undefined,
) => {
  let compilerPromise: Promise<Sass.AsyncCompiler> | undefined

  // Sass 自带长期存活 compiler API，复用它而不另建通用 worker pool。
  /** 表示样式预处理器 worker 的实例类型，供主线程保持方法签名一致。 */
  type WorkerType = InstanceType<
    typeof WorkerWithFallback<
      [
        sassPath: string,
        data: string,
        // additionalData 函数不可结构化克隆；主线程已应用，这里固定为 undefined。
        options: SassStylePreprocessorInternalOptions & {
          /** 在原始样式前后注入的可选附加源码。 */
          additionalData: undefined
        },
      ],
      ScssWorkerResult
    >
  >

  const worker: WorkerType = {
    /** 复用 Sass async compiler 编译源码，并通过 Vite importer 解析及重定位导入 URL。 */
    async run(sassPath, data, options) {
      const sass: typeof Sass = await import(sassPath)
      compilerPromise ??= sass.initAsyncCompiler()
      const compiler = await compilerPromise

      const sassOptions = { ...options } as Sass.StringOptions<'async'>
      sassOptions.url = pathToFileURL(options.filename)
      sassOptions.sourceMap = options.enableSourcemap

      /** 判断预处理器 URL 是否无需基于导入文件重新定位。 */
      const skipRebaseUrls = (unquotedUrl: string, rawUrl: string) => {
        const isQuoted = rawUrl[0] === '"' || rawUrl[0] === "'"
        // 匹配 url($foo)，变量值需由 Sass 求值，不能提前 rebase。
        if (!isQuoted && unquotedUrl[0] === '$') {
          return true
        }
        // 同理跳过 url(#{foo}) 与 url('#{foo}') 插值。
        return unquotedUrl.startsWith('#{')
      }

      const internalImporter: Sass.Importer<'async'> = {
        /** 把 Sass 导入 URL 解析为规范 file URL；无法解析时交还 Sass 后续 importer。 */
        async canonicalize(url, context) {
          const importer = context.containingUrl
            ? fileURLToPath(context.containingUrl)
            : options.filename
          const resolved = await resolvers.sass(
            environment,
            url,
            cleanScssBugUrl(importer),
          )
          if (
            resolved &&
            (resolved.endsWith('.css') ||
              resolved.endsWith('.scss') ||
              resolved.endsWith('.sass'))
          ) {
            return pathToFileURL(resolved)
          }
          return null
        },
        /** 读取已规范化的 Sass 导入文件，重定位其 URL 并返回匹配语法。 */
        async load(canonicalUrl) {
          const ext = path.extname(canonicalUrl.pathname)
          let syntax: Sass.Syntax = 'scss'
          if (ext === '.sass') {
            syntax = 'indented'
          } else if (ext === '.css') {
            syntax = 'css'
          }
          const result = await rebaseUrls(
            environment,
            fileURLToPath(canonicalUrl),
            options.filename,
            resolvers.sass,
            skipRebaseUrls,
          )
          const contents =
            result.contents ?? (await fsp.readFile(result.file, 'utf-8'))
          return { contents, syntax, sourceMapUrl: canonicalUrl }
        },
      }
      sassOptions.importers = [
        ...(sassOptions.importers ?? []),
        internalImporter,
      ]
      sassOptions.importer ??= internalImporter

      const result = await compiler.compileStringAsync(data, sassOptions)
      return {
        css: result.css,
        map: result.sourceMap ? JSON.stringify(result.sourceMap) : undefined,
        stats: {
          includedFiles: result.loadedUrls
            .filter((url) => url.protocol === 'file:')
            .map((url) => fileURLToPath(url)),
        },
      } satisfies ScssWorkerResult
    },
    /** 停止 Sass worker 调度器并释放线程资源。 */
    async stop() {
      const compiler = await compilerPromise
      await compiler?.dispose()
      compilerPromise = undefined
    },
  }

  return worker
}

/** 描述 Sass worker 返回的 CSS、映射及参与编译的文件列表。 */
type ScssWorkerResult = {
  /** Sass 编译生成的 CSS 文本。 */
  css: string
  /** 与转换后代码对应的 sourcemap。 */
  map?: string | undefined
  /** Sass 返回的本次编译统计信息。 */
  stats: {
    /** 编译实际读取的文件，用于建立 watcher 依赖。 */
    includedFiles: string[]
  }
}

/** 实现 Sass/SCSS 预处理器适配层，负责 worker 生命周期与路径重写。 */
const scssProcessor = (
  maxWorkers: number | undefined,
): StylePreprocessor<SassStylePreprocessorInternalOptions> => {
  let worker: ReturnType<typeof makeScssWorker> | undefined
  let failedSassEmbedded: boolean | undefined
  const normalizedErrors = new WeakSet<Error>()

  return {
    /** 停止 Sass worker 或长期存活的 async compiler。 */
    async close() {
      await worker?.stop()
    },
    /** 选择 Sass 实现、应用 additionalData，并归一化代码、映射与依赖。 */
    async process(environment, source, root, options, resolvers) {
      let sassPackage = loadSassPackage(root, failedSassEmbedded ?? false)
      if (failedSassEmbedded === undefined) {
        failedSassEmbedded = false
        try {
          await import(sassPackage.path)
        } catch (e) {
          if (/sass-embedded-[a-z0-9]+-[a-z0-9]+/i.test(e.message)) {
            failedSassEmbedded = true
            sassPackage = loadSassPackage(root, failedSassEmbedded)
          }
        }
      }

      worker ??= makeScssWorker(environment, resolvers, maxWorkers)

      const { content: data, map: additionalMap } = await getSource(
        source,
        options.filename,
        options.additionalData,
        options.enableSourcemap,
      )

      const optionsWithoutAdditionalData = {
        ...options,
        additionalData: undefined,
      }
      try {
        const result = await worker.run(
          pathToFileURL(sassPackage.path).href,
          data,
          optionsWithoutAdditionalData,
        )
        const deps = result.stats.includedFiles.map((f) => cleanScssBugUrl(f))
        const map: ExistingRawSourceMap | undefined = result.map
          ? JSON.parse(result.map.toString())
          : undefined

        if (map) {
          // 真实 Sourcemap.sources 可能为 null，但 Rolldown 类型未表达；Sass 有 map 时这里预期可遍历。
          map.sources = map.sources!.map((url) =>
            url!.startsWith('file://')
              ? normalizePath(fileURLToPath(url!))
              : url,
          )
        }

        return {
          code: result.css.toString(),
          map,
          additionalMap,
          deps,
        }
      } catch (e) {
        if (!normalizedErrors.has(e)) {
          // 规范化 Sass 错误为 Vite/Rolldown 可展示的 message/id/frame/位置。
          e.message = `[sass] ${e.message}`
          e.id = e.file
          e.frame = e.formatted
          // modern API 没有 line/column，从 e.span 提取；span 为 0-based，公开错误位置加一。
          if (e.span?.start) {
            e.line = e.span.start.line + 1
            e.column = e.span.start.column + 1
            // modern API 也无 formatted；message 已内含 code frame，直接复用，避免像 legacy API 一样
            // 再生成一份重复 frame。
            e.frame = e.message
          }
          // Sass 可能复用同一个 Error 实例；WeakSet 防止重复加前缀/改位置。
          normalizedErrors.add(e)
        }
        return { code: '', error: e, deps: [] }
      }
    },
  }
}
// #endregion Sass

/**
 * Sass/Less 会把 @import 内容内联到根文件；其中相对 url()/data-uri()/CSS @import 必须从被导入文件
 * 目录重新定位，再改写成以根文件目录为基准的路径。
 */
async function rebaseUrls(
  environment: PartialEnvironment,
  file: string,
  rootFile: string,
  resolver: ResolveIdFn,
  ignoreUrl?: (unquotedUrl: string, rawUrl: string) => boolean,
): Promise<{
  /** 解析并规范化后的导入文件路径。 */
  file: string;
  /** URL 重定位后需交给预处理器的替换内容；未变化时省略。 */
  contents?: string
}> {
  file = path.resolve(file) // 规范成当前 OS 分隔符的绝对路径。
  // 被导入文件与根文件同目录时无需 rebase。
  const fileDir = path.dirname(file)
  const rootDir = path.dirname(rootFile)
  if (fileDir === rootDir) {
    return { file }
  }

  const content = await fsp.readFile(file, 'utf-8')
  // 先做廉价特征检测，无 url/data-uri/@import 时避免字符串重写。
  const hasUrls = cssUrlRE.test(content)
  const hasDataUris = cssDataUriRE.test(content)
  const hasImportCss = importCssRE.test(content)

  if (!hasUrls && !hasDataUris && !hasImportCss) {
    return { file }
  }

  let rebased
  /** 把预处理器导入文件中的相对 URL 重定位到入口文件可解析的位置。 */
  const rebaseFn = async (unquotedUrl: string, rawUrl: string) => {
    if (ignoreUrl?.(unquotedUrl, rawUrl)) return false
    if (unquotedUrl[0] === '/') return unquotedUrl
    const absolute =
      (await resolver(environment, unquotedUrl, file)) ||
      path.resolve(fileDir, unquotedUrl)
    const relative = path.relative(rootDir, absolute)
    return normalizePath(relative)
  }

  // 修正 Less 中 `@import "foo.css"` 这类保留为 CSS import 的路径。
  if (hasImportCss) {
    rebased = await rewriteImportCss(content, rebaseFn)
  }

  if (hasUrls) {
    rebased = await rewriteCssUrls(rebased || content, rebaseFn)
  }

  if (hasDataUris) {
    rebased = await rewriteCssDataUris(rebased || content, rebaseFn)
  }

  return {
    file,
    contents: rebased,
  }
}

// #region Less（.less 处理器）
/** 创建 Less worker 调度器，并在无法序列化插件时回退当前线程。 */
const makeLessWorker = (
  environment: PartialEnvironment,
  resolvers: CSSAtImportResolvers,
  maxWorkers: number | undefined,
) => {
  /** 判断预处理器 URL 是否无需基于导入文件重新定位。 */
  const skipRebaseUrls = (unquotedUrl: string, _rawUrl: string) => {
    // 跳过插值 url('@{foo}') 和变量 url(@foo)，由 Less 求值后再决定路径。
    return unquotedUrl[0] === '@'
  }

  /** 按 Less 导入语义解析文件，并补试 `.less` 与目录入口。 */
  const viteLessResolve = async (
    filename: string,
    dir: string,
    rootFile: string,
    mime: string | undefined,
  ) => {
    const resolved = await resolvers.less(
      environment,
      filename,
      // Less 只暴露 importer 目录而非文件，Vite 无法像 CSS/Sass 那样提供真实 importer；因此
      // resolve.tsconfigPaths 不适用于 .less 内部，详见该选项文档。
      path.join(dir, '*'),
    )
    if (!resolved) return undefined

    // Less JavaScript plugin 不是样式文件，不重写其中 URL。
    if (mime === 'application/javascript') {
      const file = path.resolve(resolved) // 确保使用当前操作系统的路径分隔形式。
      return { resolved: file }
    }

    const result = await rebaseUrls(
      environment,
      resolved,
      rootFile,
      resolvers.less,
      skipRebaseUrls,
    )
    return {
      resolved,
      contents: 'contents' in result ? result.contents : undefined,
    }
  }

  const worker = new WorkerWithFallback(
    async () => {
      const [fsp, path] = await Promise.all([
        import('node:fs/promises'),
        import('node:path'),
      ])

      let ViteLessManager: any
      /** 创建 Less 文件管理器插件，把导入解析委托给 Vite resolver。 */
      const createViteLessPlugin = (
        less: typeof Less,
        rootFile: string,
      ): Less.Plugin => {
        const { FileManager } = less
        ViteLessManager ??= class ViteManager extends FileManager {
          /** 触发 Less 导入解析的根入口文件。 */
          rootFile
          /** function Object() { [native code] } */
          constructor(rootFile: string) {
            super()
            this.rootFile = rootFile
          }
          /** 判断 Less 文件管理器是否应接管给定文件名。 */
          override supports(filename: string) {
            return !/^(?:https?:)?\/\//.test(filename)
          }
          /** 声明该 Less 文件管理器不提供同步加载路径。 */
          override supportsSync() {
            return false
          }
          /** 通过 Vite resolver 定位 Less 导入并返回文件内容与规范文件名。 */
          override async loadFile(
            filename: string,
            dir: string,
            opts: any,
            env: any,
          ): Promise<Less.FileLoadResult> {
            const result = await viteLessResolve(
              filename,
              dir,
              this.rootFile,
              opts.mime,
            )
            if (result) {
              return {
                filename: path.resolve(result.resolved),
                contents:
                  result.contents ??
                  (await fsp.readFile(result.resolved, 'utf-8')),
              }
            } else {
              return super.loadFile(filename, dir, opts, env)
            }
          }
        }

        return {
          /** 把 Vite Less 文件管理器注册到当前 Less 插件管理器。 */
          install(_, pluginManager) {
            pluginManager.addFileManager(new ViteLessManager(rootFile))
          },
          minVersion: [3, 0, 0],
        }
      }

      return async (
        lessPath: string,
        content: string,
        // additionalData 函数已在主线程应用，此处固定 undefined 才能传入 worker。
        options: LessStylePreprocessorInternalOptions & {
          /** 在原始样式前后注入的可选附加源码。 */
          additionalData: undefined
        },
      ) => {
        const nodeLess: typeof Less = (await import(lessPath)).default
        const viteResolverPlugin = createViteLessPlugin(
          nodeLess,
          options.filename,
        )
        const result = await nodeLess.render(content, {
          // 默认允许从 node_modules 解析 @import。
          paths: ['node_modules'],
          ...options,
          plugins: [viteResolverPlugin, ...(options.plugins || [])],
          ...(options.enableSourcemap
            ? {
                sourceMap: {
                  outputSourceFiles: true,
                  // Less 类型未声明，但运行时支持该选项。
                  disableSourcemapAnnotation: true,
                  sourceMapFileInline: false,
                } as Less.SourceMapOption,
              }
            : {}),
        })
        return result
      }
    },
    {
      parentFunctions: { viteLessResolve },
      /** Less 插件可能包含函数；存在插件时回退本地线程以保留其行为。 */
      shouldUseFake(_lessPath, _content, options) {
        // Less plugins 含函数、不可序列化；存在插件时回退主线程 fake worker。
        return !!options.plugins && options.plugins.length > 0
      },
      max: maxWorkers,
    },
  )
  return worker
}

/** 实现 Less 预处理器适配层，汇总输出、映射和导入依赖。 */
const lessProcessor = (
  maxWorkers: number | undefined,
): StylePreprocessor<LessStylePreprocessorInternalOptions> => {
  let worker: ReturnType<typeof makeLessWorker> | undefined

  return {
    /** 停止 Less worker，释放线程池。 */
    close() {
      worker?.stop()
    },
    /** 应用 additionalData 后调用 Less，并归一化代码、映射与导入依赖。 */
    async process(environment, source, root, options, resolvers) {
      const lessPath = loadPreprocessorPath(PreprocessLang.less, root)
      worker ??= makeLessWorker(environment, resolvers, maxWorkers)

      const { content, map: additionalMap } = await getSource(
        source,
        options.filename,
        options.additionalData,
        options.enableSourcemap,
      )

      let result: Less.RenderOutput | undefined
      const optionsWithoutAdditionalData = {
        ...options,
        additionalData: undefined,
      }
      try {
        result = await worker.run(
          pathToFileURL(lessPath).href,
          content,
          optionsWithoutAdditionalData,
        )
      } catch (e) {
        const error = e as Less.RenderError
        // 统一 Less 错误为 RollupError loc。
        const normalizedError: RollupError = new Error(
          `[less] ${error.message || error.type}`,
        ) as RollupError
        normalizedError.loc = {
          file: error.filename || options.filename,
          line: error.line,
          column: error.column,
        }
        return { code: '', error: normalizedError, deps: [] }
      }

      const map: ExistingRawSourceMap | undefined =
        result.map && JSON.parse(result.map)
      if (map) {
        delete map.sourcesContent
      }

      return {
        code: result.css.toString(),
        map,
        additionalMap,
        deps: result.imports,
      }
    },
  }
}
// #endregion Less

// #region Stylus（.styl 处理器）
/** 创建 Stylus worker 调度器，并在自定义函数存在时选择本地执行。 */
const makeStylWorker = (maxWorkers: number | undefined) => {
  const worker = new WorkerWithFallback(
    () => {
      return async (
        stylusPath: string,
        content: string,
        root: string,
        // additionalData 函数已在主线程应用，此处固定 undefined。
        options: StylusStylePreprocessorInternalOptions & {
          /** 在原始样式前后注入的可选附加源码。 */
          additionalData: undefined
        },
      ) => {
        const stylus: typeof Stylus = (await import(stylusPath)).default

        const ref = stylus(content, {
          // 默认允许从 node_modules 解析 @import。
          paths: ['node_modules'],
          ...options,
        })
        if (options.define) {
          for (const key in options.define) {
            ref.define(key, options.define[key])
          }
        }
        if (options.enableSourcemap) {
          ref.set('sourcemap', {
            comment: false,
            inline: false,
            basePath: root,
          })
        }

        return {
          code: ref.render(),
          // @ts-expect-error sourcemap exists
          map: ref.sourcemap as ExistingRawSourceMap | undefined,
          deps: ref.deps(),
        }
      }
    },
    {
      /** Stylus define/Evaluator 含函数时无法跨线程克隆，需回退本地执行。 */
      shouldUseFake(_stylusPath, _content, _root, options) {
        // define 可含函数，Evaluator 本身也是函数，均不可序列化；这些场景回退主线程。
        return !!(
          (options.define &&
            Object.values(options.define).some(
              (d) => typeof d === 'function',
            )) ||
          options.Evaluator
        )
      },
      max: maxWorkers,
    },
  )
  return worker
}

/** 实现 Stylus 预处理器适配层，并归一化依赖与 sourcemap。 */
const stylProcessor = (
  maxWorkers: number | undefined,
): StylePreprocessor<StylusStylePreprocessorInternalOptions> => {
  let worker: ReturnType<typeof makeStylWorker> | undefined

  return {
    /** 停止 Stylus worker，释放线程池。 */
    close() {
      worker?.stop()
    },
    /** 应用 additionalData 后调用 Stylus，并归一化代码、映射与依赖。 */
    async process(_environment, source, root, options, _resolvers) {
      const stylusPath = loadPreprocessorPath(PreprocessLang.stylus, root)
      worker ??= makeStylWorker(maxWorkers)

      // 注入 additionalData 时强制加换行；Stylus 语句可能没有分号，直接拼接会造成语法粘连。
      const { content, map: additionalMap } = await getSource(
        source,
        options.filename,
        options.additionalData,
        options.enableSourcemap,
        '\n',
      )
      // Stylus 内置 deps() 不返回 options.imports，需手工把它们加入依赖集合。
      const importsDeps = (options.imports ?? []).map((dep: string) =>
        path.resolve(dep),
      )
      const optionsWithoutAdditionalData = {
        ...options,
        additionalData: undefined,
      }
      try {
        const { code, map, deps } = await worker.run(
          pathToFileURL(stylusPath).href,
          content,
          root,
          optionsWithoutAdditionalData,
        )
        return {
          code,
          map: formatStylusSourceMap(map, root),
          additionalMap,
          // 合并显式 imports 与 Stylus 实际计算出的依赖。
          deps: [...deps, ...importsDeps],
        }
      } catch (e) {
        const wrapped = new Error(`[stylus] ${e.message}`)
        wrapped.name = e.name
        wrapped.stack = e.stack
        return { code: '', error: wrapped, deps: [] }
      }
    },
  }
}

/** 把 Stylus 生成的路径和 sourceRoot 归一化为 Vite 可合并的 sourcemap。 */
function formatStylusSourceMap(
  mapBefore: ExistingRawSourceMap | undefined,
  root: string,
): ExistingRawSourceMap | undefined {
  if (!mapBefore) return undefined
  const map = { ...mapBefore }

  /** 把 Stylus sourcemap 中相对 sourceRoot 的路径还原为绝对文件路径。 */
  const resolveFromRoot = (p: string | null) =>
    normalizePath(path.resolve(root, p!))

  if (map.file) {
    map.file = resolveFromRoot(map.file)
  }
  // 真实 Sourcemap.sources 可能为 null，但 Rolldown 类型未表达；有 map 时这里预期可遍历。
  map.sources = map.sources!.map(resolveFromRoot)

  return map
}
// #endregion Stylus

/** 读取 sourcemap 引用的源文件，并递归合并其上游映射。 */
async function getSource(
  source: string,
  filename: string,
  additionalData: PreprocessorAdditionalData | undefined,
  enableSourcemap: boolean,
  sep: string = '',
): Promise<{
  /** 追加用户 additionalData 后的完整源码。 */
  content: string;
  /** additionalData 回调提供或合并后的源码映射。 */
  map?: ExistingRawSourceMap
}> {
  if (!additionalData) return { content: source }

  if (typeof additionalData === 'function') {
    const newContent = await additionalData(source, filename)
    if (typeof newContent === 'string') {
      return { content: newContent }
    }
    return newContent
  }

  if (!enableSourcemap) {
    return { content: additionalData + sep + source }
  }

  const ms = new MagicString(source)
  ms.appendLeft(0, sep)
  ms.appendLeft(0, additionalData)

  const map = ms.generateMap({ hires: 'boundary' })
  map.file = filename
  map.sources = [filename]

  return {
    content: ms.toString(),
    map,
  }
}

/** 创建共享预处理器控制器，惰性初始化 Sass、Less 与 Stylus worker。 */
const createPreprocessorWorkerController = (maxWorkers: number | undefined) => {
  const scss = scssProcessor(maxWorkers)
  const less = lessProcessor(maxWorkers)
  const styl = stylProcessor(maxWorkers)

  /** 按当前环境调用 Sass 处理器，并把结果统一为预处理器公共结构。 */
  const sassProcess: StylePreprocessor<SassStylePreprocessorInternalOptions>['process'] =
    (environment, source, root, options, resolvers) => {
      const opts: SassStylePreprocessorInternalOptions = { ...options }
      opts.syntax = 'indented'
      return scss.process(environment, source, root, opts, resolvers)
    }

  /** 并行关闭 Sass、Less 与 Stylus 处理器持有的 worker。 */
  const close = async () => {
    await Promise.all([less.close(), scss.close(), styl.close()])
  }

  return {
    [PreprocessLang.less]: less.process,
    [PreprocessLang.scss]: scss.process,
    [PreprocessLang.sass]: sassProcess,
    [PreprocessLang.styl]: styl.process,
    [PreprocessLang.stylus]: styl.process,
    close,
  } as const satisfies Record<PreprocessLang | 'close', unknown>
}

/** 把布尔或数字 worker 配置换算为实际并发数，并保留主线程容量。 */
const normalizeMaxWorkers = (maxWorker: number | true | undefined) => {
  if (maxWorker === undefined) return 0
  if (maxWorker === true) return undefined
  return maxWorker
}

/** 表示预处理器 worker 控制器的公开返回类型。 */
type PreprocessorWorkerController = ReturnType<
  typeof createPreprocessorWorkerController
>

/** 保存可用预处理语言集合，供扩展名快速判定。 */
const preprocessorSet = new Set([
  PreprocessLang.less,
  PreprocessLang.sass,
  PreprocessLang.scss,
  PreprocessLang.styl,
  PreprocessLang.stylus,
] as const)

/** 判断语言后缀是否需要 Sass、Less 或 Stylus 预处理。 */
function isPreProcessor(lang: any): lang is PreprocessLang {
  return lang && preprocessorSet.has(lang)
}

/** 识别绝对协议 URL 与协议相对 URL，避免交给本地解析器。 */
const absoluteOrProtocolRelativeUrlRE = /^(?:[a-z]+:)?\/\//i

/** 惰性加载并缓存 esbuild，供 CSS 压缩兼容路径使用。 */
const importEsbuild = createCachedImport(() => import('esbuild'))

/** 惰性加载并缓存 Lightning CSS，避免默认路径加载可选依赖。 */
const importLightningCSS = createCachedImport(() => import('lightningcss'))
/** 调用 Lightning CSS 转换源码，并归一化模块导出、依赖和错误位置。 */
async function compileLightningCSS(
  environment: PartialEnvironment,
  id: string,
  src: string,
  deps: Set<string>,
  workerController: PreprocessorWorkerController,
  urlResolver?: CssUrlResolver,
): Promise<{
  /** 转换后代码。 */
  code: string
  /** 与转换后代码对应的 sourcemap。 */
  map?: string | undefined
  /** CSS Modules 的原类名到导出名映射。 */
  modules?: Record<string, string>
}> {
  const { config } = environment
  const filename = removeDirectQuery(id)

  let res: LightningCssTransformAttributeResult | LightningCssTransformResult
  try {
    res = styleAttrRE.test(id)
      ? (await importLightningCSS()).transformStyleAttribute({
          filename,
          code: Buffer.from(src),
          targets: config.css.lightningcss?.targets,
          minify: config.isProduction && !!config.build.cssMinify,
          analyzeDependencies: true,
        })
      : await (
          await importLightningCSS()
        ).bundleAsync({
          ...config.css.lightningcss,
          filename,
          // CSS Modules 生成 scoped name 时需要稳定 projectRoot，避免 cwd 改变 hash。
          projectRoot: config.root,
          resolver: {
            /** 读取 Lightning CSS 请求的依赖文件，并把访问记录到构建依赖集合。 */
            async read(filePath) {
              if (filePath === filename) {
                return src
              }

              const code = fs.readFileSync(filePath, 'utf-8')
              const lang = CSS_LANGS_RE.exec(filePath)?.[1] as
                | CssLang
                | undefined
              if (isPreProcessor(lang)) {
                const result = await compileCSSPreprocessors(
                  environment,
                  id,
                  lang,
                  code,
                  workerController,
                )
                result.deps?.forEach((dep) => deps.add(dep))
                // TODO：合并被 Lightning CSS resolver 读取的预处理器 sourcemap。
                return result.code
              } else if (lang === 'sss') {
                const sssResult = await transformSugarSS(environment, id, code)
                // TODO：合并 SugarSS sourcemap。
                return sssResult.code
              }
              return code
            },
            /** 为 Lightning CSS 的依赖请求解析 public 文件或本地 CSS 路径。 */
            async resolve(id, from) {
              const publicFile = checkPublicFile(
                id,
                environment.getTopLevelConfig(),
              )
              if (publicFile) {
                return publicFile
              }

              // postcss-import 会自行识别 external URL，Lightning CSS resolver 需要显式返回 external。
              if (absoluteOrProtocolRelativeUrlRE.test(id)) {
                return { external: id }
              }

              // 注意：PostCSS 模式的 CSS Modules composes 会依次尝试全部 resolver；Lightning CSS 模式
              // 只使用当前文件语言对应的 resolver。
              const atImportResolvers = getAtImportResolvers(
                environment.getTopLevelConfig(),
              )
              const lang = CSS_LANGS_RE.exec(from)?.[1] as CssLang | undefined
              let resolver: ResolveIdFn
              switch (lang) {
                case 'css':
                case 'sss':
                case 'styl':
                case 'stylus':
                case undefined:
                  resolver = atImportResolvers.css
                  break
                case 'sass':
                case 'scss':
                  resolver = atImportResolvers.sass
                  break
                case 'less':
                  resolver = atImportResolvers.less
                  break
                default:
                  throw new Error(`Unknown lang: ${lang satisfies never}`)
              }

              const resolved = await resolver(environment, id, from)
              if (resolved) {
                deps.add(resolved)
                return resolved
              }
              return id
            },
          },
          minify: config.isProduction && !!config.build.cssMinify,
          sourceMap:
            config.command === 'build'
              ? !!config.build.sourcemap
              : config.css.devSourcemap,
          analyzeDependencies: { preserveImports: true },
          cssModules: cssModuleRE.test(id)
            ? (config.css.lightningcss?.cssModules ?? true)
            : undefined,
        })
  } catch (e) {
    e.message = `[lightningcss] ${e.message}`
    if (e.loc) {
      e.loc = {
        file: e.fileName.replace(NULL_BYTE_PLACEHOLDER, '\0'),
        line: e.loc.line,
        column: e.loc.column - 1, // Lightning CSS 列号为 1-based。
      }
      try {
        const code = fs.readFileSync(e.fileName, 'utf-8')
        const friendlyMessage = getLightningCssErrorMessageForIeSyntaxes(code)
        if (friendlyMessage) {
          e.message += friendlyMessage
        }
      } catch {}
    }
    throw e
  }

  for (const warning of res.warnings) {
    let msg = `[vite:css][lightningcss] ${warning.message}`
    msg += `\n${generateCodeFrame(src, {
      line: warning.loc.line,
      column: warning.loc.column - 1, // 转为 code frame 使用的 0-based。
    })}`
    environment.logger.warn(colors.yellow(msg))
  }

  // Node 返回 Buffer、Deno 返回 Uint8Array，统一用 TextDecoder 正确解码 CSS。
  let css = decoder.decode(res.code)
  for (const dep of res.dependencies!) {
    switch (dep.type) {
      case 'file': {
        deps.add(dep.filePath)
        break
      }
      case 'glob': {
        for (const file of globSync(dep.glob)) {
          deps.add(file)
        }
        const files = globSync(dep.glob, {
          absolute: true,
          expandDirectories: false,
          ignore: ['**/node_modules/**'],
        })
        for (let i = 0; i < files.length; i++) {
          deps.add(files[i])
        }
        break
      }
      case 'url': {
        let replaceUrl: string
        if (skipUrlReplacer(dep.url)) {
          replaceUrl = dep.url
        } else if (urlResolver) {
          const [newUrl, resolvedId] = await urlResolver(
            dep.url,
            dep.loc.filePath.replace(NULL_BYTE_PLACEHOLDER, '\0'),
          )
          if (resolvedId) {
            deps.add(resolvedId)
          }
          replaceUrl = newUrl
        } else {
          replaceUrl = dep.url
        }

        css = css.replace(
          dep.placeholder,
          // Lightning CSS 固定生成 url("placeholder")，不会使用单引号/裸形式，所以替换值只需转义
          // 双引号。
          () => replaceUrl.replaceAll('"', '\\"'),
        )
        break
      }
      case 'import': {
        // 使用函数 replacer，让 URL 中 `$` 序列按字面插入，不被 String.replace 当替换模式解释。
        css = css.replace(dep.placeholder, () => dep.url)
        break
      }
      default:
        throw new Error(
          `Unsupported dependency type: ${(dep satisfies never as any).type}`,
        )
    }
  }

  let modules: Record<string, string> | undefined
  if ('exports' in res && res.exports) {
    modules = {}
    // https://github.com/parcel-bundler/lightningcss/issues/291
    const sortedEntries = Object.entries(res.exports).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )
    for (const [key, value] of sortedEntries) {
      modules[key] = value.name
      // https://lightningcss.dev/css-modules.html#class-composition
      for (const c of value.composes) {
        modules[key] += ' ' + c.name
      }
    }
  }

  return {
    code: css,
    map: 'map' in res ? res.map?.toString() : undefined,
    modules,
  }
}

// 针对 Lightning CSS 旧 IE hack 给出可操作错误提示：
// https://github.com/parcel-bundler/lightningcss/issues/39
/** 为 Lightning CSS 不支持的旧 IE 语法补充更明确的迁移提示。 */
function getLightningCssErrorMessageForIeSyntaxes(
  code: string,
): string | undefined {
  const commonIeMessage =
    ', which was used in the past to support old Internet Explorer versions.' +
    ' This is not a valid CSS syntax and will be ignored by modern browsers. ' +
    '\nWhile this is not supported by LightningCSS, you can set `css.lightningcss.errorRecovery: true` to strip these codes.'
  if (/[\s;{]\*[a-zA-Z-][\w-]+\s*:/.test(code)) {
    // https://stackoverflow.com/a/1667560
    return (
      '.\nThis file contains star property hack (e.g. `*zoom`)' +
      commonIeMessage
    )
  }
  if (/min-width:\s*0\\0/.test(code)) {
    // https://stackoverflow.com/a/14585820
    return (
      '.\nThis file contains @media zero hack (e.g. `@media (min-width: 0\\0)`)' +
      commonIeMessage
    )
  }
  return undefined
}

// 把 esbuild target 语法转换为 Lightning CSS targets 位编码：
// https://esbuild.github.io/api/#target
// https://github.com/parcel-bundler/lightningcss/blob/master/node/targets.d.ts

/** 把 browserslist 浏览器名称映射为 Lightning CSS 使用的目标键。 */
const map: Record<
  string,
  keyof NonNullable<LightningCSSOptions['targets']> | false | undefined
> = {
  chrome: 'chrome',
  edge: 'edge',
  firefox: 'firefox',
  hermes: false,
  ie: 'ie',
  ios: 'ios_saf',
  node: false,
  opera: 'opera',
  rhino: false,
  safari: 'safari',
}

/** 把 ECMAScript 目标版本映射为近似的浏览器版本集合。 */
const esMap: Record<number, string[]> = {
  // https://caniuse.com/?search=es2015
  2015: ['chrome49', 'edge13', 'safari10', 'ios10', 'firefox44', 'opera36'],
  // https://caniuse.com/?search=es2016
  2016: ['chrome50', 'edge13', 'safari10', 'ios10', 'firefox43', 'opera37'],
  // https://caniuse.com/?search=es2017
  2017: ['chrome58', 'edge15', 'safari11', 'ios11', 'firefox52', 'opera45'],
  // https://caniuse.com/?search=es2018
  2018: ['chrome63', 'edge79', 'safari12', 'ios12', 'firefox58', 'opera50'],
  // https://caniuse.com/?search=es2019
  2019: ['chrome73', 'edge79', 'safari12.1', 'ios12.1', 'firefox64', 'opera60'],
  // https://caniuse.com/?search=es2020
  2020: ['chrome80', 'edge80', 'safari14.1', 'ios14.5', 'firefox80', 'opera67'],
  // https://caniuse.com/?search=es2021
  2021: ['chrome85', 'edge85', 'safari14.1', 'ios14.5', 'firefox80', 'opera71'],
  // https://caniuse.com/?search=es2022
  2022: ['chrome94', 'edge94', 'safari16.4', 'ios16.4', 'firefox93', 'opera80'],
  // https://caniuse.com/?search=es2023
  2023: [
    'chrome110',
    'edge110',
    'safari16.4',
    'ios16.4',
    'firefox146',
    'opera96',
  ],
  // https://caniuse.com/sr-es15
  2024: [
    'chrome119',
    'edge119',
    'safari17.4',
    'ios17.4',
    'firefox145',
    'opera105',
  ],
  // https://caniuse.com/?feats=mdn-javascript_builtins_set_union%2Cmdn-javascript_builtins_iterator_toarray%2Cmdn-javascript_statements_import_import_attributes_type_json%2Cmdn-javascript_regular_expressions_named_capturing_group_duplicate_named_capturing_groups%2Cmdn-javascript_regular_expressions_modifier%2Cmdn-javascript_builtins_promise_try%2Cmdn-javascript_builtins_float16array%2Cmdn-javascript_builtins_regexp_escape
  2025: [
    'chrome136',
    'edge136',
    'safari26.0',
    'ios26.0',
    'firefox138',
    'opera121',
  ],
}

/** 识别 `es6` 或年份形式的 JavaScript 目标名称。 */
const esRE = /es(6|\d{4})/
/** 判断目标名称是否含显式版本号，辅助浏览器目标转换。 */
const versionRE = /\d/

/** 缓存 browserslist 到 Lightning CSS targets 的转换结果。 */
const convertTargetsCache = new Map<
  string | string[],
  LightningCSSOptions['targets']
>()
/** 把 esbuild 风格 browser/ES 年份 target 转成 Lightning CSS 的 24-bit 版本编码，并缓存结果。 */
export const convertTargets = (
  esbuildTarget: string | string[] | false,
): LightningCSSOptions['targets'] => {
  if (!esbuildTarget) return {}
  const cached = convertTargetsCache.get(esbuildTarget)
  if (cached) return cached
  const targets: LightningCSSOptions['targets'] = {}

  const entriesWithoutES = arraify(esbuildTarget).flatMap((e) => {
    const match = esRE.exec(e)
    if (!match) return e
    const year = match[1] === '6' ? 2015 : Number(match[1])
    if (!esMap[year]) throw new Error(`Unsupported target "${e}"`)
    return esMap[year]
  })

  for (const entry of entriesWithoutES) {
    if (entry === 'esnext') continue
    const index = entry.search(versionRE)
    if (index >= 0) {
      const browser = map[entry.slice(0, index)]
      if (browser === false) continue // Node/Hermes 等无 CSS 浏览器 target 映射，忽略。
      if (browser) {
        const [major, minor = 0] = entry
          .slice(index)
          .split('.')
          .map((v) => parseInt(v, 10))
        if (!isNaN(major) && !isNaN(minor)) {
          const version = (major << 16) | (minor << 8)
          if (!targets[browser] || version < targets[browser]!) {
            targets[browser] = version
          }
          continue
        }
      }
    }
    throw new Error(`Unsupported target "${entry}"`)
  }

  convertTargetsCache.set(esbuildTarget, targets)
  return targets
}

/** library build CSS 文件名优先级：cssFileName → fileName → 最近 package.json name。 */
export function resolveLibCssFilename(
  libOptions: LibraryOptions,
  root: string,
  packageCache?: PackageCache,
): string {
  if (typeof libOptions.cssFileName === 'string') {
    return `${libOptions.cssFileName}.css`
  } else if (typeof libOptions.fileName === 'string') {
    return `${libOptions.fileName}.css`
  }

  const packageJson = findNearestMainPackageData(root, packageCache)?.data
  const name = packageJson ? getPkgName(packageJson.name) : undefined

  if (!name)
    throw new Error(
      'Name in package.json is required if option "build.lib.cssFileName" is not provided.',
    )

  return `${name}.css`
}
