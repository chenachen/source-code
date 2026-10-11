import postcss, {
  type LazyResult,
  type Message,
  type ProcessOptions,
  type Result,
  type SourceMap,
} from 'postcss'
import trimPlugin from './style/pluginTrim'
import scopedPlugin from './style/pluginScoped'
import {
  type PreprocessLang,
  type StylePreprocessor,
  type StylePreprocessorResults,
  processors,
} from './style/preprocessors'
import type { RawSourceMap } from '@vue/compiler-core'
import { cssVarsPlugin } from './style/cssVars'
import postcssModules from 'postcss-modules'

/** 单个 SFC style block 的同步编译选项。 */
export interface SFCStyleCompileOptions {
  /** style block 的原始内容。 */
  source: string
  /** 所属 `.vue` 文件名，用于 source map、预处理器和 CSS Modules 哈希。 */
  filename: string
  /** 组件作用域 ID，通常形如 `data-v-xxxx` 或不带前缀的哈希。 */
  id: string
  /** 是否重写选择器以限制样式作用域。 */
  scoped?: boolean
  /** 是否通过 trim 插件把 rule/at-rule 的 raws.before/after 空白规范为换行。 */
  trim?: boolean
  /** 是否按生产模式生成更短且稳定的 CSS 变量名。 */
  isProd?: boolean
  /** 上游预处理或 SFC block 生成的输入 source map。 */
  inMap?: RawSourceMap
  /** Sass/Less/Stylus 等预处理语言。 */
  preprocessLang?: PreprocessLang
  /** 原样传给对应样式预处理器的选项。 */
  preprocessOptions?: any
  /** 自定义预处理器模块加载方法，浏览器或 link 场景可注入实现。 */
  preprocessCustomRequire?: (id: string) => any
  /** 传给 PostCSS `process()` 的配置。 */
  postcssOptions?: any
  /** 注册在 CSS vars 之后、trim/scoped/CSS Modules 之前的用户插件；调用时机由 PostCSS hook 决定。 */
  postcssPlugins?: any[]
  /**
   * @deprecated 请改用 `inMap`；保留用于兼容旧版插件调用。
   */
  map?: RawSourceMap
}

/**
 * 与 postcss-modules 对齐的 CSS Modules 配置。
 * https://github.com/css-modules/postcss-modules
 */
export interface CSSModulesOptions {
  /** 未显式使用 `:local` / `:global` 时的默认选择器作用域。 */
  scopeBehaviour?: 'global' | 'local'
  /** CSS Modules 局部类名的字符串模板或自定义生成函数。 */
  generateScopedName?:
    string | ((name: string, filename: string, css: string) => string)
  /** 参与类名哈希的额外前缀。 */
  hashPrefix?: string
  /** 导出类名时是否额外生成 camelCase/dashes 形式，或只保留转换形式。 */
  localsConvention?: 'camelCase' | 'camelCaseOnly' | 'dashes' | 'dashesOnly'
  /** 是否把 `:global` 类名也加入 modules 导出对象。 */
  exportGlobals?: boolean
  /** 匹配后整份文件默认按 global 处理的路径规则。 */
  globalModulePaths?: RegExp[]
}

/** 异步样式编译选项；CSS Modules 只在异步管线中可用。 */
export interface SFCAsyncStyleCompileOptions extends SFCStyleCompileOptions {
  /** 内部管线标记；true 时返回 Promise 并允许异步 PostCSS 插件。 */
  isAsync?: boolean
  /** 启用 CSS Modules；必须等待 PostCSS 完成才能取得类名 JSON。 */
  modules?: boolean
  /** 传给 postcss-modules 的类名和导出规则。 */
  modulesOptions?: CSSModulesOptions
}

/** 样式编译结果，包括 CSS、映射、依赖、CSS Modules 和可恢复错误。 */
export interface SFCStyleCompileResults {
  /** 最终生成的 CSS 文本。 */
  code: string
  /** 串联预处理器、PostCSS 与输入映射后的 source map。 */
  map: RawSourceMap | undefined
  /** PostCSS 原始结果，供高级构建插件读取 messages 等信息。 */
  rawResult: Result | LazyResult | undefined
  /** 预处理器与 PostCSS 收集到的可恢复错误。 */
  errors: Error[]
  /** 启用 CSS Modules 后的原类名到局部类名映射。 */
  modules?: Record<string, string>
  /** 预处理器 import 和 PostCSS dependency 消息汇总的依赖路径。 */
  dependencies: Set<string>
}

/** 同步编译 style；不能使用异步 PostCSS 插件或 CSS Modules。 */
export function compileStyle(
  options: SFCStyleCompileOptions,
): SFCStyleCompileResults {
  return doCompileStyle({
    ...options,
    isAsync: false,
  }) as SFCStyleCompileResults
}

/** 异步编译 style，支持 CSS Modules 与异步 PostCSS 插件。 */
export function compileStyleAsync(
  options: SFCAsyncStyleCompileOptions,
): Promise<SFCStyleCompileResults> {
  return doCompileStyle({
    ...options,
    isAsync: true,
  }) as Promise<SFCStyleCompileResults>
}

/**
 * 先预处理为 CSS，再按 CSS vars → 用户插件 → trim → scoped → CSS Modules 注册插件。
 * PostCSS 分别执行 Once、节点访问和 OnceExit；注册顺序不表示每个插件整体先后执行。
 *
 * 所有预处理依赖和 PostCSS dependency message 会汇总返回，供构建工具监听 HMR。
 * 预处理器加载与 CSS Modules 配置检查在 try 之外，配置异常直接抛出；预处理器返回的
 * errors 先累积，仍用其 code 进入 PostCSS。同步处理异常返回空 code，可保留 LazyResult；
 * 异步拒绝则返回空 code 且清空 map/rawResult，保留此前已知依赖。
 */
export function doCompileStyle(
  options: SFCAsyncStyleCompileOptions,
): SFCStyleCompileResults | Promise<SFCStyleCompileResults> {
  const {
    filename,
    id,
    scoped = false,
    trim = true,
    isProd = false,
    modules = false,
    modulesOptions = {},
    preprocessLang,
    postcssOptions,
    postcssPlugins,
  } = options
  const preprocessor = preprocessLang && processors[preprocessLang]
  const preProcessedSource = preprocessor && preprocess(options, preprocessor)
  const map = preProcessedSource
    ? preProcessedSource.map
    : options.inMap || options.map
  const source = preProcessedSource ? preProcessedSource.code : options.source

  const shortId = id.replace(/^data-v-/, '')
  const longId = `data-v-${shortId}`

  const plugins = (postcssPlugins || []).slice()
  plugins.unshift(cssVarsPlugin({ id: shortId, isProd }))
  if (trim) {
    plugins.push(trimPlugin())
  }
  if (scoped) {
    plugins.push(scopedPlugin(longId))
  }
  let cssModules: Record<string, string> | undefined
  if (modules) {
    if (__GLOBAL__ || __ESM_BROWSER__) {
      throw new Error(
        '[@vue/compiler-sfc] `modules` option is not supported in the browser build.',
      )
    }
    if (!options.isAsync) {
      throw new Error(
        '[@vue/compiler-sfc] `modules` option can only be used with compileStyleAsync().',
      )
    }
    plugins.push(
      postcssModules({
        ...modulesOptions,
        getJSON: (_cssFileName: string, json: Record<string, string>) => {
          cssModules = json
        },
      }),
    )
  }

  const postCSSOptions: ProcessOptions = {
    ...postcssOptions,
    to: filename,
    from: filename,
  }
  if (map) {
    postCSSOptions.map = {
      inline: false,
      annotation: false,
      prev: map,
    }
  }

  let result: LazyResult | undefined
  let code: string | undefined
  let outMap: SourceMap | undefined
  // Stylus 的依赖列表可能包含输入 CSS，自身不应成为额外监听依赖。
  const dependencies = new Set(
    preProcessedSource ? preProcessedSource.dependencies : [],
  )
  // Sass 传 filename 时也会把当前文件列入 loadedUrls，统一删除自身避免重复触发 HMR。
  dependencies.delete(filename)

  const errors: Error[] = []
  if (preProcessedSource && preProcessedSource.errors.length) {
    errors.push(...preProcessedSource.errors)
  }

  /** 原样收集 dependency message.file；插件应提供可监听路径，本函数不做绝对化或自身过滤。 */
  const recordPlainCssDependencies = (messages: Message[]) => {
    messages.forEach(msg => {
      if (msg.type === 'dependency') {
        // file 由报告依赖的插件负责；Set 去重，但插件仍可把刚删掉的当前 filename 加回来。
        dependencies.add(msg.file)
      }
    })
    return dependencies
  }

  try {
    result = postcss(plugins).process(source, postCSSOptions)

    // 异步模式等待整个 LazyResult；错误转换成结果项，保持 API 与同步版本一致。
    if (options.isAsync) {
      return result
        .then(result => ({
          code: result.css || '',
          map: result.map && result.map.toJSON(),
          errors,
          modules: cssModules,
          rawResult: result,
          dependencies: recordPlainCssDependencies(result.messages),
        }))
        .catch(error => ({
          code: '',
          map: undefined,
          errors: [...errors, error],
          rawResult: undefined,
          dependencies,
        }))
    }

    recordPlainCssDependencies(result.messages)
    // 读取 css 会强制 LazyResult 同步执行；调用方必须确保没有异步插件。
    code = result.css
    outMap = result.map
  } catch (e: any) {
    errors.push(e)
  }

  return {
    code: code || ``,
    map: outMap && outMap.toJSON(),
    errors,
    rawResult: result,
    dependencies,
  }
}

/** 解析并执行指定 CSS 预处理器；浏览器构建要求调用方显式提供加载函数。 */
function preprocess(
  options: SFCStyleCompileOptions,
  preprocessor: StylePreprocessor,
): StylePreprocessorResults {
  if ((__ESM_BROWSER__ || __GLOBAL__) && !options.preprocessCustomRequire) {
    throw new Error(
      `[@vue/compiler-sfc] Style preprocessing in the browser build must ` +
        `provide the \`preprocessCustomRequire\` option to return the in-browser ` +
        `version of the preprocessor.`,
    )
  }

  return preprocessor(
    options.source,
    options.inMap || options.map,
    {
      filename: options.filename,
      ...options.preprocessOptions,
    },
    options.preprocessCustomRequire,
  )
}
