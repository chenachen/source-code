import path from 'node:path'
import colors from 'picocolors'
import type { RawSourceMap } from '@jridgewell/remapping'
import type { InternalModuleFormat, SourceMap } from 'rolldown'
import { resolveTsconfig } from 'rolldown/experimental'
import { TsconfigCache } from 'rolldown/utils'
import type {
  EsbuildLoader,
  EsbuildMessage,
  EsbuildTransformOptions,
  EsbuildTransformResult as RawEsbuildTransformResult,
} from '#types/internal/esbuildOptions'
import type { FSWatcher } from '#dep-types/chokidar'
import {
  combineSourcemaps,
  createDebugger,
  createFilter,
  ensureWatchedFile,
  generateCodeFrame,
} from '../utils'
import type { ViteDevServer } from '../server'
import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
import { cleanUrl } from '../../shared/utils'

/** 创建当前插件命名空间的调试日志器，默认不产生用户可见输出。 */
const debug = createDebugger('vite:esbuild')

// IIFE 开头形如 `var MyLib = function() {`；压缩后空格消失、参数名也会改写。
const IIFE_BEGIN_RE =
  /(?:const|var)\s+\S+\s*=\s*\(?function\([^()]*\)\s*\{\s*"use strict";/

/** 判断文件名是否已有有效扩展名，以决定是否从 loader 补写后缀。 */
const validExtensionRE = /\.\w+$/
/** 识别 JSX/TSX 文件后缀，决定是否拼接 `jsxInject` 内容。 */
const jsxExtensionsRE = /\.(?:j|t)sx\b/

// 最终现代构建始终保留 dynamic import 与 import.meta；需要兼容更旧浏览器时由
// plugin-legacy 提供方案，它也用这两个特性检测现代代码。
// 浏览器支持基线：https://caniuse.com/es6-module-dynamic-import,mdn-javascript_operators_import_meta#:~:text=Feature%20summary
export const defaultEsbuildSupported = {
  'dynamic-import': true,
  'import-meta': true,
}

/** 扩展 esbuild 转换选项，加入 Vite 的文件过滤与 JSX 注入配置。 */
export interface ESBuildOptions extends EsbuildTransformOptions {
  /** 仅匹配这些模式的文件会进入处理流程。 */
  include?: string | RegExp | ReadonlyArray<string | RegExp>
  /** 匹配这些模式的文件会被排除在处理流程外。 */
  exclude?: string | RegExp | ReadonlyArray<string | RegExp>
  /** 每个 JSX 模块转换后需要追加的导入或辅助代码。 */
  jsxInject?: string
  /**
   * 该字段不生效，请改用 `build.minify`。
   */
  minify?: never
}

/** 表示归一化为 Vite SourceMap 类型后的 esbuild 转换结果。 */
export type ESBuildTransformResult = Omit<RawEsbuildTransformResult, 'map'> & {
  /** 与转换后代码对应的 sourcemap。 */
  map: SourceMap
}

/** 声明 Vite 会从 tsconfig 读取并转交给 esbuild 的字段子集。 */
type TSConfigJSON = {
  /** 当前 tsconfig 继承的父配置路径。 */
  extends?: string
  /** Vite 会筛选并转交给 esbuild 的 TypeScript 编译选项。 */
  compilerOptions?: {
    /** 是否按 tsconfig 要求为输出启用严格模式。 */
    alwaysStrict?: boolean
    /** 是否启用 TypeScript 旧版装饰器语义。 */
    experimentalDecorators?: boolean
    /** 控制仅类型导入在转译后的保留方式。 */
    importsNotUsedAsValues?: 'remove' | 'preserve' | 'error'
    /** 选择 JSX 的保留或 React 转换模式。 */
    jsx?: 'preserve' | 'react' | 'react-jsx' | 'react-jsxdev'
    /** 经典 JSX 转换调用的工厂函数名。 */
    jsxFactory?: string
    /** 经典 JSX 转换调用的 Fragment 工厂名。 */
    jsxFragmentFactory?: string
    /** 自动 JSX runtime 导入使用的包来源。 */
    jsxImportSource?: string
    /** 是否保留编译器判断为值位置的导入。 */
    preserveValueImports?: boolean
    /** TypeScript/esbuild 转译需要兼容的语言目标。 */
    target?: string
    /** 选择类字段使用 define 还是赋值语义。 */
    useDefineForClassFields?: boolean
    /** 是否为装饰器生成设计时类型元数据。 */
    emitDecoratorMetadata?: boolean
    /** 是否原样保留未显式标记为 type 的模块语法。 */
    verbatimModuleSyntax?: boolean
  }
  [key: string]: any
}
/** 表示可安全传入 esbuild 的 tsconfig 编译选项子集。 */
export type TSCompilerOptions = NonNullable<TSConfigJSON['compilerOptions']>

let esbuild: Promise<typeof import('esbuild')> | undefined
/** 惰性加载并缓存 esbuild 模块，避免未使用兼容 API 时加载依赖。 */
const importEsbuild = () => {
  esbuild ||= import('esbuild')
  return esbuild
}

let warnedTransformWithEsbuild = false
/** 只输出一次旧 esbuild 转换 API 的弃用警告，避免逐文件刷屏。 */
const warnTransformWithEsbuildUsageOnce = () => {
  if (warnedTransformWithEsbuild) return
  warnedTransformWithEsbuild = true

  // eslint-disable-next-line no-console -- logger cannot be used here
  console.warn(
    colors.yellow(
      '`transformWithEsbuild` is deprecated and will be removed in the future. ' +
        'Please migrate to `transformWithOxc`.',
    ),
  )
}

/**
 * 兼容旧公开 API：按文件/query 推断 loader，合并最近 tsconfig 的有效字段，执行
 * esbuild transform，并把输入 sourcemap 与错误位置归一化为 Vite 协议。
 * @deprecated 新代码应使用 `transformWithOxc`。
 */
export async function transformWithEsbuild(
  code: string,
  filename: string,
  options?: EsbuildTransformOptions,
  inMap?: object,
  config?: ResolvedConfig,
  watcher?: FSWatcher,
  /** @internal */
  ignoreEsbuildWarning = false,
): Promise<ESBuildTransformResult> {
  let loader = options?.loader

  if (!loader) {
    // Vue block 等虚拟 id 可能在 query 末尾携带有效扩展名；否则先去 query 再判断。
    const ext = path
      .extname(validExtensionRE.test(filename) ? filename : cleanUrl(filename))
      .slice(1)

    if (ext === 'cjs' || ext === 'mjs') {
      loader = 'js'
    } else if (ext === 'cts' || ext === 'mts') {
      loader = 'ts'
    } else {
      loader = ext as EsbuildLoader
    }
  }

  let tsconfigRaw = options?.tsconfigRaw

  // 字符串 tsconfigRaw 由用户完整控制，优先级最高且不再自动合并最近 tsconfig。
  if (typeof tsconfigRaw !== 'string') {
    // 只复制真正影响单文件转译结果的 compilerOptions。
    // https://esbuild.github.io/content-types/#tsconfig-json
    const meaningfulFields: Array<keyof TSCompilerOptions> = [
      'alwaysStrict',
      'experimentalDecorators',
      'importsNotUsedAsValues',
      'jsx',
      'jsxFactory',
      'jsxFragmentFactory',
      'jsxImportSource',
      'preserveValueImports',
      'target',
      'useDefineForClassFields',
      'verbatimModuleSyntax',
    ]
    const compilerOptionsForFile: TSCompilerOptions = {}
    if (loader === 'ts' || loader === 'tsx') {
      const result = resolveTsconfig(
        filename,
        getTSConfigResolutionCache(config),
      )
      if (result) {
        const { tsconfig: loadedTsconfig, tsconfigFilePaths } = result
        // 最近 tsconfig 可能在 root 外，开发态仍要显式加入 watcher。
        if (watcher && config) {
          for (const tsconfigFile of tsconfigFilePaths) {
            ensureWatchedFile(watcher, tsconfigFile, config.root)
          }
        }

        const loadedCompilerOptions = loadedTsconfig.compilerOptions ?? {}

        for (const field of meaningfulFields) {
          if (field in loadedCompilerOptions) {
            // @ts-expect-error TypeScript can't tell they are of the same type
            compilerOptionsForFile[field] = loadedCompilerOptions[field]
          }
        }
      }
    }

    const compilerOptions = {
      ...compilerOptionsForFile,
      ...tsconfigRaw?.compilerOptions,
    }

    // target 未声明时 esbuild 默认 useDefineForClassFields=true，而 TypeScript 默认 false；
    // Vite 显式选择后者，避免类字段语义因转译器不同而漂移。
    if (
      compilerOptions.useDefineForClassFields === undefined &&
      compilerOptions.target === undefined
    ) {
      compilerOptions.useDefineForClassFields = false
    }

    // esbuild 会让 tsconfig JSX 字段覆盖普通 options；Vite反向保证显式 API 选项优先。
    if (options) {
      if (options.jsx) compilerOptions.jsx = undefined
      if (options.jsxFactory) compilerOptions.jsxFactory = undefined
      if (options.jsxFragment) compilerOptions.jsxFragmentFactory = undefined
      if (options.jsxImportSource) compilerOptions.jsxImportSource = undefined
    }

    tsconfigRaw = {
      ...tsconfigRaw,
      compilerOptions,
    }
  }

  const resolvedOptions: EsbuildTransformOptions = {
    sourcemap: true,
    // sourcefile 保留完整 query，使虚拟模块 sourcemap 能回到准确 id。
    sourcefile: filename,
    ...options,
    loader,
    tsconfigRaw,
  }

  // 生态会把 Vite ESBuildOptions 整体传进旧 API；esbuild 会拒绝 Vite 扩展字段，
  // 调用前必须删除。
  // @ts-expect-error include exists in ESBuildOptions
  delete resolvedOptions.include
  // @ts-expect-error exclude exists in ESBuildOptions
  delete resolvedOptions.exclude
  // @ts-expect-error jsxInject exists in ESBuildOptions
  delete resolvedOptions.jsxInject

  let transform: typeof import('esbuild').transform
  try {
    transform = (await importEsbuild()).transform
  } catch (e) {
    throw new Error(
      'Failed to load `transformWithEsbuild`. ' +
        'It is deprecated and it now requires esbuild to be installed separately. ' +
        'If you are a package author, please migrate to `transformWithOxc` instead.',
      { cause: e },
    )
  }

  if (!ignoreEsbuildWarning) {
    warnTransformWithEsbuildUsageOnce()
  }

  try {
    const result = await transform(code, resolvedOptions)
    let map: SourceMap
    if (inMap && resolvedOptions.sourcemap) {
      const nextMap = JSON.parse(result.map)
      nextMap.sourcesContent = []
      map = combineSourcemaps(filename, [
        nextMap as RawSourceMap,
        inMap as RawSourceMap,
      ]) as SourceMap
    } else {
      map =
        resolvedOptions.sourcemap && resolvedOptions.sourcemap !== 'inline'
          ? JSON.parse(result.map)
          : { mappings: '' }
    }
    return {
      ...result,
      map,
    }
  } catch (e: any) {
    debug?.(`esbuild error with options used: `, resolvedOptions)
    // 把 esbuild 多条 diagnostics 拼成带源码框的 Vite 错误。
    if (e.errors) {
      e.frame = ''
      e.errors.forEach((m: EsbuildMessage) => {
        if (
          m.text === 'Experimental decorators are not currently enabled' ||
          m.text ===
            'Parameter decorators only work when experimental decorators are enabled'
        ) {
          m.text +=
            '. Vite 5 now uses esbuild 0.18 and you need to enable them by adding "experimentalDecorators": true in your "tsconfig.json" file.'
        }
        e.frame += `\n` + prettifyMessage(m, code)
      })
      e.loc = e.errors[0].location
    }
    throw e
  }
}

/**
 * 单模块 TS/JSX 转译插件。这里只转语法并关闭优化；最终 target 转换与压缩由
 * `buildEsbuildPlugin` 在 chunk 阶段执行，开发态则无需第二次优化。
 */
export function esbuildPlugin(config: ResolvedConfig): Plugin {
  const options = config.esbuild as ESBuildOptions
  const { jsxInject, include, exclude, ...esbuildTransformOptions } = options

  const filter = createFilter(include || /\.(m?ts|[jt]sx)$/, exclude || /\.js$/)

  // 单模块阶段只转译语法；优化会降低开发速度，也会与最终 chunk 压缩重复。
  const transformOptions: EsbuildTransformOptions = {
    target: 'esnext',
    ...esbuildTransformOptions,
    minify: false,
    minifyIdentifiers: false,
    minifySyntax: false,
    minifyWhitespace: false,
    treeShaking: false,
    // 未压缩时无需 keepNames；多次带 keepNames 转换还会破坏 tree-shaking（#9164）。
    keepNames: false,
    supported: {
      ...defaultEsbuildSupported,
      ...esbuildTransformOptions.supported,
    },
  }

  let server: ViteDevServer | undefined

  return {
    name: 'vite:esbuild',
    /** 开发服务器启动时启用 tsconfig 监听，使配置变化能使转换结果失效。 */
    configureServer(_server) {
      server = _server
    },
    /** 按文件过滤器调用 esbuild 转译，并按 jsxInject 配置补入公共代码。 */
    async transform(code, id) {
      if (filter(id) || filter(cleanUrl(id))) {
        const result = await transformWithEsbuild(
          code,
          id,
          transformOptions,
          undefined,
          config,
          server?.watcher,
        )
        if (result.warnings.length) {
          result.warnings.forEach((m) => {
            this.warn(prettifyMessage(m, code))
          })
        }
        if (jsxInject && jsxExtensionsRE.test(id)) {
          result.code = jsxInject + ';' + result.code
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

/** 把 Rollup 输出格式映射为 esbuild 支持的等价格式。 */
const rollupToEsbuildFormatMap: Record<
  string,
  EsbuildTransformOptions['format'] | undefined
> = {
  es: 'esm',
  cjs: 'cjs',

  // IIFE 库代码 `var Lib = (() => {})()` 若再指定 esbuild format=iife，会多包一层
  // `(() => { ... })()`，因此不给 format，让它只做 target/minify。
  //
  // treeShaking 仍可能删除顶层无副作用变量；当前 Rolldown 输出不会生成这种可删的
  // 库包装形态，这里依赖该约束。
  iife: undefined,
}

// #7188：esbuild 会把 helper 放在 UMD/IIFE wrapper 外，压缩后的短变量可能和页面全局
// 冲突。Vite把 helper 移入 wrapper，例如：
//    `<esbuild helpers> (function(){ /* 实际内容 */ })()`
// 改写为：
//    `(function(){ <esbuild helpers> /* 实际内容 */ })()`
// 不用正则，避免 #8738/#8099/#10900/#14065 一类回溯性能风险；indexOf/slice 足够。
// helper 与 wrapper 头部都不是源映射内容，无需为此创建 MagicString。
/** 把 esbuild 前置 helper 移入 UMD/IIFE 严格模式 wrapper，隔离全局变量名。 */
export const injectEsbuildHelpers = (
  esbuildCode: string,
  format: string,
): string => {
  const contentIndex =
    format === 'iife'
      ? Math.max(esbuildCode.search(IIFE_BEGIN_RE), 0)
      : format === 'umd'
        ? esbuildCode.indexOf(`(function(`) // 压缩与未压缩 UMD 都保留此前缀。
        : 0

  if (contentIndex > 0) {
    const esbuildHelpers = esbuildCode.slice(0, contentIndex)
    return esbuildCode
      .slice(contentIndex)
      .replace('"use strict";', (m: string) => m + esbuildHelpers)
  }
  return esbuildCode
}

/** 在最终 chunk 上执行 build.target 转换与可选 esbuild 压缩。 */
export const buildEsbuildPlugin = (): Plugin => {
  return {
    name: 'vite:esbuild-transpile',
    /** 仅在首选构建转换器为 esbuild 时启用 chunk 转译钩子。 */
    applyToEnvironment(environment) {
      return environment.config.esbuild !== false
    },
    /** 把 Rollup 输出格式和目标转换为 esbuild 选项，执行压缩或降级转换。 */
    async renderChunk(code, chunk, opts) {
      // legacy chunk 已由专门流程处理；再次转换可能产生对象属性简写等旧环境不安全语法。
      if (this.environment.config.isOutputOptionsForLegacyChunks?.(opts)) {
        return null
      }

      const config = this.environment.config
      const options = resolveEsbuildTranspileOptions(config, opts.format)

      if (!options) {
        return null
      }

      const res = await transformWithEsbuild(
        code,
        chunk.fileName,
        options,
        undefined,
        config,
        undefined,
        true,
      )

      if (config.build.lib) {
        res.code = injectEsbuildHelpers(res.code, opts.format)
      }

      return res
    },
  }
}

/**
 * 合并 target、format 与细粒度压缩选项；ES 库始终禁用 whitespace minify，
 * 保留 pure annotations 供下游 tree-shaking。
 */
export function resolveEsbuildTranspileOptions(
  config: ResolvedConfig,
  format: InternalModuleFormat,
): EsbuildTransformOptions | null {
  const target = config.build.target
  const minify = config.build.minify === 'esbuild'

  if ((!target || target === 'esnext') && !minify) {
    return null
  }

  // ES 库输出不能压缩空白，否则会移除 pure annotations 并破坏下游 tree-shaking。
  // https://github.com/vuejs/core/issues/2860#issuecomment-926882793
  const isEsLibBuild = config.build.lib && format === 'es'
  const esbuildOptions = config.esbuild || {}

  const options: EsbuildTransformOptions = {
    ...esbuildOptions,
    loader: 'js',
    target: target || undefined,
    format: rollupToEsbuildFormatMap[format],
    supported: {
      ...defaultEsbuildSupported,
      ...esbuildOptions.supported,
    },
  }

  // 未选择 esbuild 压缩时显式关闭全部优化，只执行 target/format 转换。
  if (!minify) {
    return {
      ...options,
      minify: false,
      minifyIdentifiers: false,
      minifySyntax: false,
      minifyWhitespace: false,
      treeShaking: false,
    }
  }

  // 用户设置任一细粒度开关时，补齐其余默认值而不使用总 minify 开关。
  if (
    options.minifyIdentifiers != null ||
    options.minifySyntax != null ||
    options.minifyWhitespace != null
  ) {
    if (isEsLibBuild) {
      // ES 库强制关闭 whitespace minify。
      return {
        ...options,
        minify: false,
        minifyIdentifiers: options.minifyIdentifiers ?? true,
        minifySyntax: options.minifySyntax ?? true,
        minifyWhitespace: false,
        treeShaking: true,
      }
    } else {
      return {
        ...options,
        minify: false,
        minifyIdentifiers: options.minifyIdentifiers ?? true,
        minifySyntax: options.minifySyntax ?? true,
        minifyWhitespace: options.minifyWhitespace ?? true,
        treeShaking: true,
      }
    }
  }

  // 未提供细粒度配置时使用 Vite默认压缩策略。
  if (isEsLibBuild) {
    // ES 库压缩标识符与语法，但保留空白/pure annotations。
    return {
      ...options,
      minify: false,
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: false,
      treeShaking: true,
    }
  } else {
    return {
      ...options,
      minify: true,
      treeShaking: true,
    }
  }
}

/** 把单条 esbuild diagnostic 格式化为黄色消息与源码框。 */
function prettifyMessage(m: EsbuildMessage, code: string): string {
  let res = colors.yellow(m.text)
  if (m.location) {
    res += `\n` + generateCodeFrame(code, m.location)
  }
  return res + `\n`
}

let globalTSConfigResolutionCache: TsconfigCache | undefined
/** 按配置保存 tsconfig 解析缓存，避免跨项目污染解析结果。 */
const tsconfigResolutionCacheMap = new WeakMap<ResolvedConfig, TsconfigCache>()

/** 获取全局或 config 隔离的最近 tsconfig 解析缓存。 */
export function getTSConfigResolutionCache(
  config?: ResolvedConfig,
): TsconfigCache {
  if (!config) {
    return (globalTSConfigResolutionCache ??= new TsconfigCache())
  }
  let cache = tsconfigResolutionCacheMap.get(config)
  if (!cache) {
    cache = new TsconfigCache()
    tsconfigResolutionCacheMap.set(config, cache)
  }
  return cache
}

/**
 * tsconfig 变化时清空转译缓存与所有环境模块图，并发送 full-reload，避免继续使用
 * 旧 compilerOptions 生成的模块结果。
 */
export function reloadOnTsconfigChange(
  server: ViteDevServer,
  changedFile: string,
): void {
  // 新增任意 tsconfig 都可能比缓存项更接近源码；extends 链也可能引用其他 JSON。
  if (changedFile.endsWith('.json')) {
    const cache = getTSConfigResolutionCache(server.config)
    if (changedFile.endsWith('/tsconfig.json')) {
      server.config.logger.info(
        `changed tsconfig file detected: ${changedFile} - Clearing cache and forcing full-reload to ensure TypeScript is compiled with updated config values.`,
        { clear: server.config.clearScreen, timestamp: true },
      )

      // TODO: 按受影响 tsconfig/模块做更细粒度失效，替代当前全量策略。

      // 清除所有用旧配置编译的模块结果。
      for (const environment of Object.values(server.environments)) {
        environment.moduleGraph.invalidateAll()
      }

      // 清空最近 tsconfig 缓存，让下次转换重新解析最新配置。
      cache.clear()

      // 通知全部环境页面重载并重新请求模块。
      for (const environment of Object.values(server.environments)) {
        environment.hot.send({
          type: 'full-reload',
          path: '*',
        })
      }
    }
  }
}
