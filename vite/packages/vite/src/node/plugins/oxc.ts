import path from 'node:path'
import type {
  TransformOptions as OxcTransformOptions,
  TransformResult as OxcTransformResult,
} from 'rolldown/utils'
import { transformSync } from 'rolldown/utils'
import { viteTransformPlugin as nativeTransformPlugin } from 'rolldown/experimental'
import type { RolldownError, RolldownLog, SourceMap } from 'rolldown'
import colors from 'picocolors'
import type { FSWatcher } from '#dep-types/chokidar'
import { createFilter, ensureWatchedFile, normalizePath } from '../utils'
import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
import { cleanUrl } from '../../shared/utils'
import type { Environment } from '..'
import type { ViteDevServer } from '../server'
import { JS_TYPES_RE } from '../constants'
import type { Logger } from '../logger'
import { type ESBuildOptions, getTSConfigResolutionCache } from './esbuild'

// IIFE 开头形如 `var MyLib = (function() {` 或 `this.nested.myLib = (function() {`；
// 构建后处理用它定位 banner/footer 应插入的函数体边界。
export const IIFE_BEGIN_RE: RegExp =
  /(?:(?:(?:const|var)\s+[^.\s]+|[^.\s]+\.[^.\s]+\.[^.\s]+)\s*=\s*|^|\n)\(?function\([^()]*\)\s*\{(?:\s*"use strict";)?/
// UMD 工厂开头形如 `})(this, function(exports, external1, external2) {`。
export const UMD_BEGIN_RE: RegExp =
  /\}\)\((?:this,\s*)?function\([^()]*\)\s*\{(?:\s*"use strict";)?/

/** 只有 JSX/TSX 文件才注入兼容的 `jsxInject` 前缀。 */
const jsxExtensionsRE = /\.(?:j|t)sx\b/
/** 判断原始 id 是否以扩展名结尾；Vue block 等 query id 需要先 cleanUrl。 */
const validExtensionRE = /\.\w+$/

/**
 * Vite 暴露的 Oxc transform 选项。
 * cwd/lang/sourcemap/helpers 等由 Vite 按文件与 Environment 控制，用户只能配置其余语义选项。
 */
export interface OxcOptions extends Omit<
  OxcTransformOptions,
  | 'cwd'
  | 'sourceType'
  | 'lang'
  | 'sourcemap'
  | 'helpers'
  | 'inject'
  | 'tsconfig'
  | 'inputMap'
> {
  /** 参与 Oxc 语法转换的文件过滤器；默认 TS/JSX，排除普通 `.js`。 */
  include?: string | RegExp | ReadonlyArray<string | RegExp>
  /** 从 Oxc 转换中排除的文件过滤器。 */
  exclude?: string | RegExp | ReadonlyArray<string | RegExp>
  /** 兼容旧 esbuild.jsxInject，在 JSX/TSX 输出前插入源码。 */
  jsxInject?: string
  /** 单独控制 JSX refresh 可参与的文件；可把非标准扩展名按 JS 解析。 */
  jsxRefreshInclude?: string | RegExp | ReadonlyArray<string | RegExp>
  /** 排除 React refresh 的文件。 */
  jsxRefreshExclude?: string | RegExp | ReadonlyArray<string | RegExp>
}

/** 把旧 Rollup JSX preset 名称映射为 Oxc classic/automatic runtime 配置。 */
export function getRollupJsxPresets(
  preset: 'react' | 'react-jsx',
): OxcJsxOptions {
  switch (preset) {
    case 'react':
      return {
        runtime: 'classic',
        pragma: 'React.createElement',
        pragmaFrag: 'React.Fragment',
        importSource: 'react',
      }
    case 'react-jsx':
      return {
        runtime: 'automatic',
        pragma: 'React.createElement',
        importSource: 'react',
      }
  }
  preset satisfies never
}

// 源自 Rolldown errors.ts：连接两段文本时保证中间恰好一个换行。
/** 去掉连接处的多余换行，再插入一个换行；空字符串也参与拼接。 */
function joinNewLine(s1: string, s2: string): string {
  // 去掉两端多余换行，避免多层 cause/stack 越拼越松散。
  return s1.replace(/\n+$/, '') + '\n' + s2.replace(/^\n+/, '')
}

/**
 * 按 Rolldown 的错误展示规则递归格式化 plugin/id/loc/frame/stack/cause。
 * Rust 侧带 `kind` 的诊断已经完整格式化，直接使用 message，避免重复前缀。
 */
function getErrorMessage(e: RolldownError): string {
  // 带 kind 代表 Rolldown Rust 侧自定义诊断，其 message 已含上下文。
  if (Object.hasOwn(e, 'kind')) {
    return e.message
  }

  let s = ''
  if (e.plugin) {
    s += `[plugin ${e.plugin}]`
  }
  const id = e.id ?? e.loc?.file
  if (id) {
    s += ' ' + id
    if (e.loc) {
      s += `:${e.loc.line}:${e.loc.column}`
    }
  }
  if (s) {
    s += '\n'
  }
  const message = `${e.name ?? 'Error'}: ${e.message}`
  s += message
  if (e.frame) {
    s = joinNewLine(s, e.frame)
  }
  // JS 插件错误的 stack 含调用来源，去掉重复首行后继续保留。
  if (e.stack) {
    s = joinNewLine(s, e.stack.replace(message, ''))
  }
  if (e.cause) {
    s = joinNewLine(s, 'Caused by:')
    s = joinNewLine(
      s,
      getErrorMessage(e.cause as any)
        .split('\n')
        .map((line) => '  ' + line)
        .join('\n'),
    )
  }
  return s
}

/**
 * 使用 Oxc 转换单个模块，自动推断语言、合成输入 map、读取 tsconfig 并规范化错误。
 * 同时提供 config 与 watcher 时，将解析器返回的 tsconfig 路径登记为监听文件。
 */
export async function transformWithOxc(
  code: string,
  filename: string,
  options?: OxcTransformOptions,
  inMap?: object,
  config?: ResolvedConfig,
  watcher?: FSWatcher,
): Promise<Omit<OxcTransformResult, 'errors'>> {
  let lang = options?.lang
  if (!lang) {
    // Vue block 等 id 的有效尾扩展可直接使用；普通带 query URL 则先 cleanUrl 再取扩展名。
    const ext = path
      .extname(validExtensionRE.test(filename) ? filename : cleanUrl(filename))
      .slice(1)

    if (ext === 'cjs' || ext === 'mjs') {
      lang = 'js'
    } else if (ext === 'cts' || ext === 'mts') {
      lang = 'ts'
    } else {
      lang = ext as 'js' | 'jsx' | 'ts' | 'tsx'
    }
  }

  const resolvedOptions = {
    sourcemap: true,
    ...options,
    inputMap: inMap as SourceMap | undefined,
    lang,
  }

  const result = transformSync(
    filename,
    code,
    resolvedOptions,
    getTSConfigResolutionCache(config),
  )
  if (
    watcher &&
    config &&
    result.tsconfigFilePaths &&
    result.tsconfigFilePaths.length > 0
  ) {
    for (const tsconfigFile of result.tsconfigFilePaths) {
      ensureWatchedFile(watcher, normalizePath(tsconfigFile), config.root)
    }
  }

  if (result.errors.length > 0) {
    // 沿用 Rolldown 聚合错误格式，消息最多展开 5 项，避免 overlay/终端被海量诊断淹没。
    let summary = `Transform failed with ${result.errors.length} error${result.errors.length < 2 ? '' : 's'}:\n`
    for (let i = 0; i < result.errors.length; i++) {
      summary += '\n'
      if (i >= 5) {
        summary += '...'
        break
      }
      summary += getErrorMessage(result.errors[i])
    }

    const wrapper = new Error(summary)
    // errors 先以 getter 暴露，console.error(wrapper) 不会在 message 已展示后又展开全部细节；
    // 外部若赋值则把 getter 固化为普通属性，保持 Error 可扩展行为。
    Object.defineProperty(wrapper, 'errors', {
      configurable: true,
      enumerable: true,
      /** 延迟暴露全部诊断，供消费方按需读取而不在默认 Error 展示中重复展开。 */
      get: () => result.errors,
      /** 外部替换诊断后将访问器固化为普通属性，保留可配置、可枚举的属性形态。 */
      set: (value) =>
        Object.defineProperty(wrapper, 'errors', {
          configurable: true,
          enumerable: true,
          value,
        }),
    })
    throw wrapper
  }
  return result
}

/** 已输出过的 UNSUPPORTED_TSCONFIG_OPTION 文本，跨模块去重。 */
const warnedMessages = new Set<string>()
/** 同一 tsconfig 不支持项只警告一次；其他 warning 每次交给插件上下文。 */
function shouldSkipWarning(warning: RolldownLog): boolean {
  if (warning.code === 'UNSUPPORTED_TSCONFIG_OPTION') {
    if (warnedMessages.has(warning.message)) return true
    warnedMessages.add(warning.message)
  }
  return false
}

/**
 * Vite 的 Oxc 语法转换插件：unbundled 逐模块调用 transformWithOxc，bundled 则委托
 * Rolldown 原生 transform 插件；分别把过滤器、JSX refresh 和 sourcemap 配置传给对应实现。
 */
export function oxcPlugin(config: ResolvedConfig): Plugin {
  const options = config.oxc as OxcOptions
  const {
    jsxInject,
    include,
    exclude,
    jsxRefreshInclude,
    jsxRefreshExclude,
    ...oxcTransformOptions
  } = options

  // 默认过滤器选入 TypeScript 与 JSX/TSX，并排除普通 .js；refresh filter 可另行扩展集合。
  const filter = createFilter(include || /\.(m?ts|[jt]sx)$/, exclude || /\.js$/)
  const jsxRefreshFilter =
    jsxRefreshInclude || jsxRefreshExclude
      ? createFilter(jsxRefreshInclude, jsxRefreshExclude)
      : undefined

  const jsxImportSource =
    (typeof oxcTransformOptions.jsx === 'object' &&
      oxcTransformOptions.jsx.importSource) ||
    'react'
  const jsxImportRuntime = `${jsxImportSource}/jsx-runtime`
  const jsxImportDevRuntime = `${jsxImportSource}/jsx-dev-runtime`

  /** 按当前文件内容和 Environment 关闭无效 refresh，并决定是否强制按 JS 解析。 */
  const getModifiedOxcTransformOptions = (
    oxcTransformOptions: OxcTransformOptions,
    id: string,
    code: string,
    environment: Environment,
  ): OxcTransformOptions => {
    const result: OxcTransformOptions = {
      ...oxcTransformOptions,
      sourcemap:
        environment.mode !== 'build' || !!environment.config.build.sourcemap,
    }

    const jsxOptions = result.jsx

    // 与 @vitejs/plugin-react 对齐：SSR、未命中 refresh filter、非 JSX 且不含 JSX runtime import
    // 时关闭 refresh，避免普通模块注入无效运行时代码。
    // https://github.com/vitejs/vite-plugin-react/blob/c8ecad052001b6fc42e508f18433e6b305bca641/packages/plugin-react/src/index.ts#L261-L269
    const [filepath] = id.split('?')
    const isJSX = filepath.endsWith('x')

    if (
      typeof jsxOptions === 'object' &&
      jsxOptions.refresh &&
      (environment.config.consumer === 'server' ||
        (jsxRefreshFilter && !jsxRefreshFilter(id)) ||
        !(
          isJSX ||
          code.includes(jsxImportRuntime) ||
          code.includes(jsxImportDevRuntime)
        ))
    ) {
      result.jsx = { ...jsxOptions, refresh: false }
    }
    if (jsxRefreshFilter?.(id) && !JS_TYPES_RE.test(cleanUrl(id))) {
      // 用户显式把非标准扩展纳入 refresh 时，按 JS 解析而不是把扩展名误作 Oxc language。
      result.lang = 'js'
    }

    return result
  }

  let server: ViteDevServer

  return {
    name: 'vite:oxc',
    /** bundled 环境返回 native 插件；unbundled 环境保留下方 JS transform hook。 */
    applyToEnvironment(environment) {
      if (environment.config.isBundled) {
        // bundled 路径把转换交给 Rust/native 插件，避免 JS hook 与 bundler 重复解析 AST。
        const {
          jsxInject,
          include = /\.(m?ts|[jt]sx)$/,
          exclude = /\.js$/,
          jsxRefreshInclude,
          jsxRefreshExclude,
          ..._transformOptions
        } = environment.config.oxc as Exclude<OxcOptions, false | undefined>

        const transformOptions: OxcTransformOptions = _transformOptions
        transformOptions.sourcemap =
          environment.config.mode !== 'build' ||
          !!environment.config.build.sourcemap

        return nativeTransformPlugin({
          root: environment.config.root,
          include,
          exclude,
          jsxRefreshInclude,
          jsxRefreshExclude,
          isServerConsumer: environment.config.consumer === 'server',
          jsxInject,
          transformOptions,
        })
      }
      return true
    },
    /** 保存开发服务器引用，后续 transform 读取 tsconfig 时可使用其 watcher。 */
    configureServer(_server) {
      server = _server
    },
    /** 按扩展名与过滤器调用 Oxc 转换，并规范化返回代码和 sourcemap。 */
    async transform(code, id) {
      // 同时测试原 id 与 clean id，兼容 query 模块；refresh filter 可单独扩展文件集合。
      if (filter(id) || filter(cleanUrl(id)) || jsxRefreshFilter?.(id)) {
        const modifiedOxcTransformOptions = getModifiedOxcTransformOptions(
          oxcTransformOptions,
          id,
          code,
          this.environment,
        )
        const result = await transformWithOxc(
          code,
          id,
          modifiedOxcTransformOptions,
          undefined,
          config,
          server?.watcher,
        )
        if (jsxInject && jsxExtensionsRE.test(id)) {
          // 兼容旧 esbuild.jsxInject；分号防止前缀与 Oxc 输出发生 ASI 粘连。
          result.code = jsxInject + ';' + result.code
        }
        for (const warning of result.warnings) {
          if (!shouldSkipWarning(warning)) {
            this.warn(warning)
          }
        }
        return {
          code: result.code,
          map: result.map,
          moduleType: 'js',
        }
      }
    },
  }
}

/** 排除字符串快捷值后，可逐字段写入的 Oxc JSX 对象配置。 */
type OxcJsxOptions = Exclude<OxcOptions['jsx'], string | undefined>

/**
 * 把旧 `esbuild` 配置中仍受支持的转换选项迁移为 OxcOptions。
 * 只映射 JSX、define 与 include/exclude；banner/footer 保留兼容插件并发出迁移警告。
 */
export function convertEsbuildConfigToOxcConfig(
  esbuildConfig: ESBuildOptions,
  logger: Logger,
): OxcOptions {
  const { jsxInject, include, exclude, ...esbuildTransformOptions } =
    esbuildConfig

  const oxcOptions: OxcOptions = {
    jsxInject,
    include,
    exclude,
  }

  if (esbuildTransformOptions.jsx === 'preserve') {
    oxcOptions.jsx = 'preserve'
  } else {
    const jsxOptions: OxcJsxOptions = {}

    switch (esbuildTransformOptions.jsx) {
      case 'automatic':
        jsxOptions.runtime = 'automatic'
        if (esbuildTransformOptions.jsxImportSource) {
          jsxOptions.importSource = esbuildTransformOptions.jsxImportSource
        }
        break
      case 'transform':
        jsxOptions.runtime = 'classic'
        if (esbuildTransformOptions.jsxFactory) {
          jsxOptions.pragma = esbuildTransformOptions.jsxFactory
        }
        if (esbuildTransformOptions.jsxFragment) {
          jsxOptions.pragmaFrag = esbuildTransformOptions.jsxFragment
        }
        break
      default:
        break
    }

    if (esbuildTransformOptions.jsxDev !== undefined) {
      jsxOptions.development = esbuildTransformOptions.jsxDev
    }
    if (esbuildTransformOptions.jsxSideEffects !== undefined) {
      // esbuild 描述“有副作用”，Oxc 描述“纯”，布尔语义必须取反（#22809）。
      jsxOptions.pure = !esbuildTransformOptions.jsxSideEffects
    }

    oxcOptions.jsx = jsxOptions
  }

  if (esbuildTransformOptions.define) {
    oxcOptions.define = esbuildTransformOptions.define
  }

  // banner/footer 由 esbuildBannerFooterCompatPlugin 继续兼容，但不属于 Oxc transform 配置。
  if (esbuildTransformOptions.banner) {
    warnDeprecatedShouldBeConvertedToPluginOptions(logger, 'banner')
  }
  if (esbuildTransformOptions.footer) {
    warnDeprecatedShouldBeConvertedToPluginOptions(logger, 'footer')
  }

  return oxcOptions
}

/** 提醒用户把已废弃 esbuild banner/footer 改写为 transform hook。 */
function warnDeprecatedShouldBeConvertedToPluginOptions(
  logger: Logger,
  name: string,
) {
  logger.warn(
    colors.yellow(
      `\`esbuild.${name}\` option was specified. ` +
        `But this option is deprecated and will be removed in future versions. ` +
        'This option can be achieved by using a plugin with transform hook, please use that instead.',
    ),
  )
}
