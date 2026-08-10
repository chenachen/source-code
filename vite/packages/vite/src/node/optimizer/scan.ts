import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { scan } from 'rolldown/experimental'
import type { TransformOptions as OxcTransformOptions } from 'rolldown/utils'
import { transformSync } from 'rolldown/utils'
import type { PartialResolvedId, Plugin } from 'rolldown'
import colors from 'picocolors'
import { glob } from 'tinyglobby'
import {
  CSS_LANGS_RE,
  JS_TYPES_RE,
  KNOWN_ASSET_TYPES,
  SPECIAL_QUERY_RE,
} from '../constants'
import {
  arraify,
  asyncFlatten,
  createDebugger,
  dataUrlRE,
  deepClone,
  externalRE,
  isInNodeModules,
  isObject,
  isOptimizable,
  moduleListContains,
  multilineCommentsRE,
  normalizePath,
  singlelineCommentsRE,
  virtualModulePrefix,
  virtualModuleRE,
} from '../utils'
import type { EnvironmentPluginContainer } from '../server/pluginContainer'
import {
  ERR_CLOSED_SERVER,
  createEnvironmentPluginContainer,
} from '../server/pluginContainer'
import { BaseEnvironment } from '../baseEnvironment'
import type { DevEnvironment } from '../server/environment'
import { transformGlobImport } from '../plugins/importMetaGlob'
import { cleanUrl } from '../../shared/utils'
import { getRollupJsxPresets } from '../plugins/oxc'

/** 仅用于冷启动依赖扫描的轻量 Environment；有插件容器，但不暴露模块图/server 运行状态。 */
export class ScanEnvironment extends BaseEnvironment {
  /** 标记该 Environment 只执行依赖扫描，不建立开发模块图。 */
  mode = 'scan' as const

  /** 返回初始化后的扫描插件容器；过早访问会暴露生命周期错误。 */
  get pluginContainer(): EnvironmentPluginContainer {
    if (!this._pluginContainer)
      throw new Error(
        `${this.name} environment.pluginContainer called before initialized`,
      )
    return this._pluginContainer
  }
  /** 惰性创建的 scan 模式插件容器。 @internal */
  _pluginContainer: EnvironmentPluginContainer | undefined

  /** 幂等创建不自动 buildStart 的轻量插件容器。 */
  async init(): Promise<void> {
    if (this._initiated) {
      return
    }
    this._initiated = true
    this._pluginContainer = await createEnvironmentPluginContainer(
      this,
      this.plugins,
      undefined,
      false,
    )
  }
}

/** 把 DevEnvironment 窄化为 ScanEnvironment 视图，禁止 scanner 访问模块图与 server。 */
export function devToScanEnvironment(
  environment: DevEnvironment,
): ScanEnvironment {
  return {
    mode: 'scan',
    /** 复用原 DevEnvironment 名称，保持条件与日志归属。 */
    get name() {
      return environment.name
    },
    /** 返回原开发服务器的顶层 ResolvedConfig。 */
    getTopLevelConfig() {
      return environment.getTopLevelConfig()
    },
    /** 复用目标 Environment 的已解析局部配置。 */
    get config() {
      return environment.config
    },
    /** 复用目标 Environment logger。 */
    get logger() {
      return environment.logger
    },
    /** 复用真实插件容器执行 resolver，避免扫描语义与开发请求分叉。 */
    get pluginContainer() {
      return environment.pluginContainer
    },
    /** 复用目标 Environment 已筛选的插件列表。 */
    get plugins() {
      return environment.plugins
    },
  } as unknown as ScanEnvironment
}

/** 与 optimizer 共用 `DEBUG=vite:deps` 的扫描入口/结果日志。 */
const debug = createDebugger('vite:deps')

/** scanner 需要先抽取 script 块的 HTML 与常见 SFC 扩展名。 */
const htmlTypesRE = /\.(?:html|vue|svelte|astro|imba)$/

// 只用于 Vue `<script setup lang=ts>`/Svelte TS 块的轻量 import 提取。TS 转换会删除模板中才使用的
// import，阻断继续 crawl；es-module-lexer 不支持 TS，完整 AST 又太慢。scanner 允许假阴性由运行时
// 发现补齐，假阳性会在 resolve 时忽略，因此无需成为完备解析器。
export const importsRE: RegExp =
  /(?<!\/\/.*)(?<=^|;|\*\/)\s*import(?!\s+type)(?:[\w*{}\n\r\t, ]+from)?\s*("[^"]+"|'[^']+')\s*(?=$|;|\/\/|\/\*)/gm

/**
 * 从推断入口用 Rolldown scan 快速 crawl，收集“可优化裸依赖 → 入口文件”和无法 resolve 的依赖。
 * 返回 cancel + result，允许服务器关闭时终止后台扫描。
 */
export function scanImports(environment: ScanEnvironment): {
  /** 标记取消，使尚未 build 的 scanner 提前退出。 */
  cancel: () => Promise<void>
  /** 扫描完成后的依赖与无法解析 specifier 集合。 */
  result: Promise<{
    /** 可预构建裸依赖到真实入口路径的映射。 */
    deps: Record<string, string>
    /** 无法解析的 specifier 到 importer 的映射。 */
    missing: Record<string, string>
  }>
} {
  const start = performance.now()
  const { config } = environment

  const scanContext = { cancelled: false }
  /** 标记后台 scanner 取消；后续阶段在创建/执行 context 前检查。 */
  async function cancel() {
    scanContext.cancelled = true
  }

  /** 计算入口、执行 Rolldown crawl，并稳定排序发现结果。 */
  async function scan() {
    const entries = await computeEntries(environment)
    if (!entries.length) {
      if (
        !config.optimizeDeps.entries &&
        !config.optimizeDeps.include &&
        !config.input
      ) {
        environment.logger.warn(
          colors.yellow(
            '(!) Could not auto-determine entry point from rolldownOptions or html files ' +
              'and there are no explicit optimizeDeps.include patterns. ' +
              'Skipping dependency pre-bundling.',
          ),
        )
      }
      return
    }
    if (scanContext.cancelled) return

    debug?.(
      `Crawling dependencies using entries: ${entries
        .map((entry) => `\n  ${colors.dim(entry)}`)
        .join('')}`,
    )
    const deps: Record<string, string> = {}
    const missing: Record<string, string> = {}

    const context = await prepareRolldownScanner(
      environment,
      entries,
      deps,
      missing,
    )
    if (scanContext.cancelled) return

    try {
      await context.build()
      return {
        // 固定依赖顺序，保证相同集合得到相同 browserHash 与可读日志。
        deps: orderedDependencies(deps),
        missing,
      }
    } catch (e) {
      // scanner 在后台运行；server 先关闭时 resolve 会抛 ERR_CLOSED_SERVER，这是取消控制流，不报
      // 依赖扫描错误。
      if (
        e.errors?.some(
          (error: {
            /** 插件容器关闭错误的稳定识别码。 */
            pluginCode?: string
          }) => error.pluginCode === ERR_CLOSED_SERVER,
        )
      ) {
        return
      }
      const prependMessage = colors.red(`\
  Failed to scan for dependencies from entries:
  ${entries.join('\n')}

  `)
      e.message = prependMessage + e.message
      throw e
    } finally {
      if (debug) {
        const duration = (performance.now() - start).toFixed(2)
        const depsStr =
          Object.keys(orderedDependencies(deps))
            .sort()
            .map((id) => `\n  ${colors.cyan(id)} -> ${colors.dim(deps[id])}`)
            .join('') || colors.dim('no dependencies found')
        debug(`Scan completed in ${duration}ms: ${depsStr}`)
      }
    }
  }
  const result = scan()

  return {
    cancel,
    result: result.then((res) => res ?? { deps: {}, missing: {} }),
  }
}

/** 入口优先级：optimizeDeps.entries → config/build input → 所有 HTML；最后过滤虚拟/不可扫描/缺失项。 */
async function computeEntries(environment: ScanEnvironment) {
  let entries: string[] = []

  const explicitEntryPatterns = environment.config.optimizeDeps.entries
  const input =
    environment.config.input ?? environment.config.build.rolldownOptions.input

  if (explicitEntryPatterns) {
    entries = await globEntries(explicitEntryPatterns, environment)
  } else if (input) {
    /** 用扫描插件容器把用户 build input 解析为真实入口 ID。 */
    const resolvePath = async (p: string) => {
      const id = (
        await environment.pluginContainer.resolveId(p, undefined, {
          isEntry: true,
          scan: true,
        })
      )?.id
      if (id === undefined) {
        throw new Error(
          `failed to resolve rolldownOptions.input value: ${JSON.stringify(p)}.`,
        )
      }
      return id
    }
    if (typeof input === 'string') {
      entries = [await resolvePath(input)]
    } else if (Array.isArray(input)) {
      entries = await Promise.all(input.map(resolvePath))
    } else if (isObject(input)) {
      entries = await Promise.all(Object.values(input).map(resolvePath))
    } else {
      throw new Error('invalid rolldownOptions.input value.')
    }
  } else {
    entries = await globEntries('**/*.html', environment)
  }

  // 非支持类型、虚拟 ID 与不存在文件不作为磁盘 scanner 入口。
  entries = entries.filter(
    (entry) =>
      isScannable(entry, environment.config.optimizeDeps.extensions) &&
      fs.existsSync(entry),
  )

  return entries
}

/** 合并用户 Rolldown scan 选项、JSX 配置与 Vite scan plugins，返回延迟 build 句柄。 */
async function prepareRolldownScanner(
  environment: ScanEnvironment,
  entries: string[],
  deps: Record<string, string>,
  missing: Record<string, string>,
): Promise<{
  /** 执行一次仅收集 import 图、不生成 bundle 的 Rolldown scan。 */
  build: () => Promise<void>
}> {
  const { plugins: pluginsFromConfig = [], ...rolldownOptions } =
    environment.config.optimizeDeps.rolldownOptions ?? {}

  const transformOptions = deepClone(rolldownOptions.transform) ?? {}
  if (transformOptions.jsx === undefined) {
    transformOptions.jsx = {}
  } else if (
    transformOptions.jsx === 'react' ||
    transformOptions.jsx === 'react-jsx'
  ) {
    transformOptions.jsx = getRollupJsxPresets(transformOptions.jsx)
  }
  if (typeof transformOptions.jsx === 'object') {
    transformOptions.jsx.development ??= !environment.config.isProduction
  }
  const transformSyncJsxOptions: OxcTransformOptions['jsx'] =
    transformOptions.jsx === false ? undefined : transformOptions.jsx

  const plugins = await asyncFlatten(arraify(pluginsFromConfig))
  plugins.push(
    ...rolldownScanPlugin(
      environment,
      deps,
      missing,
      entries,
      transformSyncJsxOptions,
    ),
  )

  /** 以最终入口、转换选项和扫描插件启动 Rolldown scan。 */
  async function build() {
    await scan({
      ...rolldownOptions,
      transform: transformOptions,
      input: entries,
      logLevel: 'silent',
      plugins,
    })
  }

  return { build }
}

/** 按 ID 排序依赖 record，使同一集合的 JSON/hash 与日志稳定。 */
function orderedDependencies(deps: Record<string, string>) {
  const depsList = Object.entries(deps)
  // 只要集合相同，不受异步 resolve 完成顺序影响。
  depsList.sort((a, b) => a[0].localeCompare(b[0]))
  return Object.fromEntries(depsList)
}

/**
 * 展开入口 pattern。显式包含 node_modules 的 pattern 单独允许依赖目录；默认忽略 outDir，未自定义
 * entries 时还忽略测试/coverage。
 */
async function globEntries(
  patterns: string | string[],
  environment: ScanEnvironment,
) {
  const nodeModulesPatterns: string[] = []
  const regularPatterns: string[] = []

  for (const pattern of arraify(patterns)) {
    if (pattern.includes('node_modules')) {
      nodeModulesPatterns.push(pattern)
    } else {
      regularPatterns.push(pattern)
    }
  }

  const sharedOptions = {
    absolute: true,
    cwd: environment.config.root,
    ignore: [
      `**/${environment.config.build.outDir}/**`,
      // 自动推断时忽略常见非应用入口目录；用户显式 entries 则尊重其选择。
      ...(environment.config.optimizeDeps.entries
        ? []
        : [`**/__tests__/**`, `**/coverage/**`]),
    ],
  }

  const results = await Promise.all([
    glob(nodeModulesPatterns, sharedOptions),
    glob(regularPatterns, {
      ...sharedOptions,
      ignore: [...sharedOptions.ignore, '**/node_modules/**'],
    }),
  ])

  return results.flat()
}

/** HTML/SFC script 块在送入 scanner 前使用的语法 loader。 */
type Loader = 'js' | 'ts' | 'jsx' | 'tsx'

/** 宽松提取 HTML/SFC script 开始标签与内容的扫描正则。 */
export const scriptRE: RegExp =
  /(<script(?:\s+[a-z_:][-\w:]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^"'<>=\s]+))?)*\s*>)(.*?)<\/script>/gis
/** 在提取 script 前清除 HTML 注释，避免注释内标签形成假入口。 */
export const commentRE: RegExp = /<!--.*?-->/gs
/** 从 script 标签提取 src 属性。 */
const srcRE = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s'">]+))/i
/** 从 script 标签提取 MIME/module type。 */
const typeRE = /\btype\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s'">]+))/i
/** 从 SFC script 标签提取 lang。 */
const langRE = /\blang\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s'">]+))/i
/** 兼容 Svelte 4 `context="module"` 的属性提取。 */
const svelteScriptModuleRE =
  /\bcontext\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s'">]+))/i
/** 识别 Svelte 5 `<script module>`。 */
const svelteModuleRE = /\smodule\b/i

/**
 * scanner 插件组：复用 Vite resolver，HTML-like 文件拆脚本虚拟模块，裸依赖记录后 externalize，
 * linked package 继续 crawl，CSS/asset/query 停止扫描，并预先展开 import.meta.glob。
 */
function rolldownScanPlugin(
  environment: ScanEnvironment,
  depImports: Record<string, string>,
  missing: Record<string, string>,
  entries: string[],
  jsxOptions: OxcTransformOptions['jsx'],
): Plugin[] {
  // resolve key 包含 importer 目录与 options；同目录模块共享结果，减少重复文件系统查找。
  const seen = new Map<string, string | undefined>()
  /** 通过真实 Environment 插件容器执行带 scan 标志的 ID 解析。 */
  async function resolveId(
    id: string,
    importer?: string,
    options?: Parameters<EnvironmentPluginContainer['resolveId']>[2],
  ): Promise<PartialResolvedId | null> {
    return environment.pluginContainer.resolveId(
      id,
      importer && normalizePath(importer),
      { scan: true, ...options },
    )
  }
  /** 按 id、importer 目录与 options 缓存 scanner 的高频 resolve 结果。 */
  const resolve = async (
    id: string,
    importer?: string,
    options?: Parameters<typeof resolveId>[2],
  ) => {
    const key = JSON.stringify([
      id,
      importer && path.dirname(importer),
      options,
    ])
    if (seen.has(key)) {
      return seen.get(key)
    }
    const resolved = await resolveId(id, importer, options)
    const res = resolved?.id
    seen.set(key, res)
    return res
  }

  const optimizeDepsOptions = environment.config.optimizeDeps
  const include = optimizeDepsOptions.include
  const exclude = [
    ...(optimizeDepsOptions.exclude ?? []),
    '@vite/client',
    '@vite/env',
  ]

  /** 阻止非入口依赖继续 crawl，同时保留显式 scanner 入口。 */
  const externalUnlessEntry = ({
    path
  }: {
    /** 当前已解析或待保留的模块路径。 */
    path: string
  }) => ({
    id: path,
    external: !entries.includes(path),
  })

  /** 必要时先把 TS/JSX 转成 JS，再展开 import.meta.glob 供 scanner 观察依赖。 */
  const doTransformGlobImport = async (
    contents: string,
    id: string,
    loader: Loader,
  ) => {
    let transpiledContents: string
    // transformGlobImport 只接受 JS，TS/JSX 先用 Oxc 去类型/语法转换。
    if (loader !== 'js') {
      const result = transformSync(id, contents, {
        ...(jsxOptions !== undefined ? { jsx: jsxOptions } : {}),
        lang: loader,
        tsconfig: false,
      })
      if (result.errors.length > 0) {
        throw new AggregateError(result.errors, 'oxc transform error')
      }
      transpiledContents = result.code
    } else {
      transpiledContents = contents
    }

    const result = await transformGlobImport(
      transpiledContents,
      id,
      environment.config.root,
      resolve,
    )

    return result?.s.toString() || transpiledContents
  }

  const scripts: Record<
    string,
    {
      /** 虚拟 script 模块的可扫描源码。 */
      contents: string
      /** 交给 Rolldown scanner 的模块语法类型。 */
      loader: Loader
    }
  > = {}

  /** 把一个 HTML/SFC 文件拆成相互隔离的 script 虚拟模块入口。 */
  const htmlTypeOnLoadCallback = async (id: string): Promise<string> => {
    let raw = await fsp.readFile(id, 'utf-8')
    // HTML 注释中的 `<script>` 不应被扫描，先替换为空注释占位。
    raw = raw.replace(commentRE, '<!---->')
    const isHtml = id.endsWith('.html')
    let js = ''
    let scriptId = 0
    const matches = raw.matchAll(scriptRE)
    for (const [, openTag, content] of matches) {
      const typeMatch = typeRE.exec(openTag)
      const type = typeMatch && (typeMatch[1] || typeMatch[2] || typeMatch[3])
      const langMatch = langRE.exec(openTag)
      const lang = langMatch && (langMatch[1] || langMatch[2] || langMatch[3])
      // 纯 HTML 只扫描 type=module；框架 SFC 的普通 script 也可能参与组件编译。
      if (isHtml && type !== 'module') {
        continue
      }
      // 跳过 application/ld+json 等非 JS script type。
      if (
        type &&
        !(
          type.includes('javascript') ||
          type.includes('ecmascript') ||
          type === 'module'
        )
      ) {
        continue
      }
      let loader: Loader = 'js'
      if (lang === 'ts' || lang === 'tsx' || lang === 'jsx') {
        loader = lang
      } else if (id.endsWith('.astro')) {
        loader = 'ts'
      }
      const srcMatch = srcRE.exec(openTag)
      if (srcMatch) {
        const src = srcMatch[1] || srcMatch[2] || srcMatch[3]
        js += `import ${JSON.stringify(src)}\n`
      } else if (content.trim()) {
        // 每个 script 块用独立虚拟模块：Svelte/Vue 同时有 module/local 块，HTML 也可有多个模块块；
        // 若拼成同一作用域，重复变量会报错。TS 额外附加 side-effect imports，防止模板中使用但
        // 转译器判定“源码未使用”的依赖被删除。
        const contents =
          content + (loader.startsWith('ts') ? extractImportPaths(content) : '')

        const key = `${id}?id=${scriptId++}`
        if (contents.includes('import.meta.glob')) {
          scripts[key] = {
            loader: 'js', // glob 展开前已经转译为 JS。
            contents: await doTransformGlobImport(contents, id, loader),
          }
        } else {
          scripts[key] = {
            loader,
            contents,
          }
        }

        const virtualModulePath = JSON.stringify(virtualModulePrefix + key)

        let addedImport = false

        // Svelte module script 的 exports 是模块导出，普通 script 的 exports 是组件 props；普通块只
        // import 不 export *，避免多个块同名 prop 在扫描入口重导出冲突。
        if (id.endsWith('.svelte')) {
          let isModule = svelteModuleRE.test(openTag) // Svelte 5 `<script module>`。
          if (!isModule) {
            // 兼容 Svelte 4 `<script context="module">`。
            const contextMatch = svelteScriptModuleRE.exec(openTag)
            const context =
              contextMatch &&
              (contextMatch[1] || contextMatch[2] || contextMatch[3])
            isModule = context === 'module'
          }
          if (!isModule) {
            addedImport = true
            js += `import ${virtualModulePath}\n`
          }
        }

        if (!addedImport) {
          js += `export * from ${virtualModulePath}\n`
        }
      }
    }

    // 简单字符串搜索可能把字符串内容误认成 export default；Svelte/Astro 代码本身不能这样导出，
    // 因此只对 Vue 保留检测，其余安全补默认导出让扫描模块合法。
    if (!id.endsWith('.vue') || !js.includes('export default')) {
      js += '\nexport default {}'
    }

    return js
  }

  const ASSET_TYPE_RE = new RegExp(`\\.(${KNOWN_ASSET_TYPES.join('|')})$`)

  return [
    {
      name: 'vite:dep-scan:resolve-external-url',
      resolveId: {
        // 协议 URL 交给运行时，不 crawl。
        filter: { id: externalRE },
        handler: (id) => ({ id, external: true }),
      },
    },
    {
      name: 'vite:dep-scan:resolve-data-url',
      resolveId: {
        // data URL 不依赖磁盘图。
        filter: { id: dataUrlRE },
        handler: (id) => ({ id, external: true }),
      },
    },
    {
      // Svelte 普通 script、Vue script setup 等局部块虚拟模块。
      name: 'vite:dep-scan:local-scripts',
      resolveId: {
        filter: { id: virtualModuleRE },
        handler: (id) => ({ id }),
      },
      load: {
        filter: { id: virtualModuleRE },
        /** 读取先前从 HTML/SFC 抽取并缓存的单个 script 块。 */
        handler(id) {
          const script = scripts[id.replace(virtualModulePrefix, '')]
          return {
            code: script.contents,
            moduleType: script.loader,
          }
        },
      },
    },

    {
      name: 'vite:dep-scan:resolve',
      /** 解析并分类入口、裸依赖、linked package、资源与特殊查询。 */
      async resolveId(id, importer) {
        // resolver 应看到原 SFC 文件作为 importer，而非内部虚拟前缀。
        importer =
          importer && virtualModuleRE.test(importer)
            ? importer.replace(virtualModulePrefix, '')
            : importer

        // HTML/SFC：后续 load 抽取 script 内容。
        if (htmlTypesRE.test(id)) {
          const resolved = await resolve(id, importer)
          if (!resolved) return
          // node_modules 中 HTML-like 类型若配置为可优化扩展，应由裸依赖分支登记为入口，而不是继续
          // 展开其内部源码。
          if (
            isInNodeModules(resolved) &&
            isOptimizable(resolved, optimizeDepsOptions)
          )
            return
          if (shouldExternalizeDep(resolved, id)) {
            return externalUnlessEntry({ path: id })
          }
          return resolved
        }

        // 裸 import：依赖登记后 externalize 停止 crawl；正则排除 Windows volume `C:`。
        if (/^[\w@][^:]/.test(id)) {
          if (moduleListContains(exclude, id)) {
            return externalUnlessEntry({ path: id })
          }
          if (depImports[id]) {
            return externalUnlessEntry({ path: id })
          }
          const resolved = await resolve(id, importer)
          if (resolved) {
            if (shouldExternalizeDep(resolved, id)) {
              return externalUnlessEntry({ path: id })
            }
            if (isInNodeModules(resolved) || include?.includes(id)) {
              // node_modules/强制 include 是预构建边界：记录可优化入口并停止向包内 crawl。
              if (isOptimizable(resolved, optimizeDepsOptions)) {
                depImports[id] = resolved
              }
              return externalUnlessEntry({ path: id })
            } else if (isScannable(resolved, optimizeDepsOptions.extensions)) {
              // linked/workspace 包视为源码，继续 crawl，直到遇到其真实依赖。
              return path.resolve(resolved)
            } else {
              return externalUnlessEntry({ path: id })
            }
          } else {
            missing[id] = normalizePath(importer!)
          }
        }

        // 非 JS 文件类型在 raw ID 上尽早 externalize；必须晚于裸包解析，因为包名也可能以扩展名结尾。

        // CSS 由 CSS 插件处理，不参与依赖扫描。
        if (CSS_LANGS_RE.test(id)) {
          return externalUnlessEntry({ path: id })
        }

        // JSON/WASM 不继续 crawl。
        if (/\.(?:json|json5|wasm)$/.test(id)) {
          return externalUnlessEntry({ path: id })
        }

        // 已知静态资源停止扫描。
        if (ASSET_TYPE_RE.test(id)) {
          return externalUnlessEntry({ path: id })
        }

        // `?worker`/`?raw` 等 Vite 特殊请求是独立插件入口。
        if (SPECIAL_QUERY_RE.test(id)) {
          return {
            id,
            external: true,
          }
        }

        // 兜底复用 Vite resolver，支持 URL、alias 与省略扩展名。
        const resolved = await resolve(id, importer)
        if (resolved) {
          if (
            shouldExternalizeDep(resolved, id) ||
            !isScannable(resolved, optimizeDepsOptions.extensions)
          ) {
            return externalUnlessEntry({ path: id })
          }
          return path.resolve(cleanUrl(resolved))
        }

        // 解析失败多半是未知类型；externalize 让主开发管线稍后给准确错误。
        return externalUnlessEntry({ path: id })
      },
    },
    {
      name: 'vite:dep-scan:load:html',
      load: {
        // HTML/SFC script 块拼成只用于 scanner 的 JS 模块入口。
        filter: { id: htmlTypesRE },
        /** 把 HTML/SFC 转为 scanner 专用 JS 聚合入口。 */
        async handler(id) {
          return {
            code: await htmlTypeOnLoadCallback(id),
            moduleType: 'js',
          }
        },
      },
    },
    // JSX/TSX 还需注入用户 jsxInject，并预先展开 import.meta.glob；否则隐式导入/Glob 依赖不会被
    // scanner 看见。
    ...(environment.config.esbuild && environment.config.esbuild.jsxInject
      ? [
          {
            name: 'vite:dep-scan:transform:jsx-inject',
            transform: {
              filter: {
                id: /\.[jt]sx$/,
              },
              /** 在 JSX/TSX scanner 输入前注入用户配置的隐式 JSX import。 */
              handler(code) {
                const esbuildConfig = environment.config.esbuild
                if (esbuildConfig && esbuildConfig.jsxInject) {
                  code = esbuildConfig.jsxInject + `\n` + code
                }
                return code
              },
            },
          } satisfies Plugin,
        ]
      : []),
    {
      name: 'vite:dep-scan:transform:js-glob',
      transform: {
        filter: {
          code: 'import.meta.glob',
        },
        /** 在 JS/TS/JSX 输入中预先展开 glob，使其依赖进入 scanner 图。 */
        async handler(code, id) {
          if (JS_TYPES_RE.test(id)) {
            let ext = path.extname(id).slice(1)
            if (ext === 'mjs') ext = 'js'
            const loader = ext as 'js' | 'ts' | 'jsx' | 'tsx'
            return {
              moduleType: 'js',
              code: await doTransformGlobImport(code, id, loader),
            }
          }
        },
      },
    },
  ]
}

/**
 * Vue script setup/Svelte 的 TS import 可能只在模板使用，被转译器当未使用删除。为每个静态来源附加
 * `import 'x'`，利用潜在副作用强制 scanner 继续 crawl；注释先清空避免假匹配。
 */
function extractImportPaths(code: string) {
  // 清空单双行注释，避免匹配其中示例 import。
  code = code
    .replace(multilineCommentsRE, '/* */')
    .replace(singlelineCommentsRE, '')

  let js = ''
  let m
  importsRE.lastIndex = 0
  while ((m = importsRE.exec(code)) != null) {
    js += `\nimport ${m[1]}`
  }
  return js
}

/** 非绝对路径、未真正解析或 null-byte ID 不是可 crawl 磁盘依赖。 */
function shouldExternalizeDep(resolvedId: string, rawId: string): boolean {
  // 非有效绝对文件路径。
  if (!path.isAbsolute(resolvedId)) {
    return true
  }
  // 原样返回/含 null byte 表示虚拟 ID。
  if (resolvedId === rawId || resolvedId.includes('\0')) {
    return true
  }
  return false
}

/** JS、HTML/SFC 与用户声明扩展名可由 scanner 继续解析。 */
function isScannable(id: string, extensions: string[] | undefined): boolean {
  return (
    JS_TYPES_RE.test(id) ||
    htmlTypesRE.test(id) ||
    extensions?.includes(path.extname(id)) ||
    false
  )
}
