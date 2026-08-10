import path from 'node:path'
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import colors from 'picocolors'
import MagicString from 'magic-string'
import type {
  ParseError as EsModuleLexerParseError,
  ExportSpecifier,
  ImportSpecifier,
} from 'es-module-lexer'
import { init, parse as parseImports } from 'es-module-lexer'
import { parseAst } from 'rolldown/parseAst'
import type { StaticImport } from 'mlly'
import { ESM_STATIC_IMPORT_RE, parseStaticImport } from 'mlly'
import { makeLegalIdentifier } from '@rollup/pluginutils'
import type { PartialResolvedId, RollupError } from 'rolldown'
import type { ESTree } from 'rolldown/utils'
import {
  CLIENT_DIR,
  CLIENT_PUBLIC_PATH,
  DEP_VERSION_RE,
  FS_PREFIX,
  SPECIAL_QUERY_RE,
} from '../constants'
import {
  debugHmr,
  handlePrunedModules,
  lexAcceptedHmrDeps,
  lexAcceptedHmrExports,
  normalizeHmrUrl,
} from '../server/hmr'
import {
  createDebugger,
  fsPathFromUrl,
  generateCodeFrame,
  getFileStartIndex,
  getHash,
  injectQuery,
  isBuiltin,
  isCSSRequest,
  isDataUrl,
  isDefined,
  isExternalUrl,
  isFilePathESM,
  isFilePathFormatExplicit,
  isInNodeModules,
  isJSRequest,
  joinUrlSegments,
  moduleListContains,
  normalizePath,
  prettifyUrl,
  removeImportQuery,
  removeTimestampQuery,
  stripBase,
  stripBomTag,
  timeFrom,
  transformStableResult,
  urlRE,
} from '../utils'
import { checkPublicFile } from '../publicDir'
import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
import type { DevEnvironment } from '../server/environment'
import { shouldExternalize } from '../external'
import {
  optimizedDepInfoFromFile,
  optimizedDepNeedsInterop,
} from '../optimizer'
import {
  cleanUrl,
  unwrapId,
  withTrailingSlash,
  wrapId,
} from '../../shared/utils'
import type { TransformPluginContext } from '../server/pluginContainer'
import { throwOutdatedRequest } from './optimizedDeps'
import { isDirectCSSRequest } from './css'
import { browserExternalId } from './resolve'
import { serializeDefine } from './define'
import { WORKER_FILE_ID } from './worker'
import { getAliasPatternMatcher } from './preAlias'

/** `DEBUG=vite:import-analysis` 启用的扫描耗时和重写数量日志。 */
const debug = createDebugger('vite:import-analysis')

/** Vite client 源码目录；该目录自身的动态 import 不产生用户警告。 */
const clientDir = normalizePath(CLIENT_DIR)

/** 识别无需 import 分析的 map 与 JSON 请求。 */
const skipRE = /\.(?:map|json)(?:$|\?)/
/** map/json 与 direct CSS 不含需重写的浏览器 ESM import，可跳过整次分析。 */
export const canSkipImportAnalysis = (id: string): boolean =>
  skipRE.test(id) || isDirectCSSRequest(id)

/** 识别依赖预构建生成的共享 chunk 文件名。 */
const optimizedDepChunkRE = /\/chunk-[A-Z\d]{8}\.js/

/** 检测动态 import 表达式内部用于显式放弃静态分析的 Vite 忽略标记。 */
export const hasViteIgnoreRE: RegExp = /\/\*\s*@vite-ignore\s*\*\//

/** 判断动态 import 参数是否是完整字符串字面量。 */
const urlIsStringRE = /^(?:'.*'|".*"|`.*`)$/

/** 提取不含表达式的模板字面量内容。 */
const templateLiteralRE = /^\s*`(.*)`\s*$/

/** 记录待重写依赖 URL 的源码值与偏移范围。 */
interface UrlPosition {
  /** HMR accept 中用户写的依赖 URL。 */
  url: string
  /** 字面量内容在源码中的范围，用于规范化后覆盖。 */
  start: number
  /** 该片段在原始源码中的结束偏移。 */
  end: number
}

/** 非 JS/CSS 资源需附加 `?import`，明确要求插件管线返回可导入模块而非静态资源响应。 */
export function isExplicitImportRequired(url: string): boolean {
  return !isJSRequest(url) && !isCSSRequest(url)
}

/**
 * 把插件 resolve ID 转成浏览器可请求 URL：root 内缩成根绝对路径，root 外/优化依赖使用 `/@fs/`，
 * 虚拟或非 URL specifier 使用 `/@id/` 包装。
 */
function normalizeResolvedIdToUrl(
  environment: DevEnvironment,
  url: string,
  resolved: PartialResolvedId,
): string {
  const root = environment.config.root
  const depsOptimizer = environment.depsOptimizer

  // 所有 import 都规范化为已解析 URL，例如裸包变成 root 路径或 `/@fs/.../node_modules/...`。
  if (resolved.id.startsWith(withTrailingSlash(root))) {
    // root 内文件缩成短的根绝对 URL。
    url = resolved.id.slice(root.length)
  } else if (
    depsOptimizer?.isOptimizedDepFile(resolved.id) ||
    // vite-plugin-react 的 `/@react-refresh` 未遵守 `\0` 虚拟模块约定；临时排除它，避免 React
    // 应用为这个 ID 做昂贵且无意义的 fs.existsSync。插件修复后可删除该兼容分支。
    (resolved.id !== '/@react-refresh' &&
      path.isAbsolute(resolved.id) &&
      fs.existsSync(cleanUrl(resolved.id)))
  ) {
    // 优化依赖可能尚未落盘；root 外真实文件也必须通过 `/@fs/` 协议请求。
    url = path.posix.join(FS_PREFIX, resolved.id)
  } else {
    url = resolved.id
  }

  // 非 `.`/`/` 开头的 resolved ID 不是浏览器可用 specifier，用 `/@id/` 包装；请求回到 transform
  // 中间件时再 unwrap，恢复插件 ID。
  if (url[0] !== '.' && url[0] !== '/') {
    url = wrapId(resolved.id)
  }

  return url
}

/**
 * 为 experimental.hmrPartialAccept 提取每个依赖实际使用的 export 名。namespace、动态 import 与
 * import.meta 视为 `*`，因为任意 export 变化都可能影响调用方。
 */
function extractImportedBindings(
  id: string,
  source: string,
  importSpec: ImportSpecifier,
  importedBindings: Map<string, Set<string>>,
) {
  let bindings = importedBindings.get(id)
  if (!bindings) {
    bindings = new Set<string>()
    importedBindings.set(id, bindings)
  }

  const isDynamic = importSpec.d > -1
  const isMeta = importSpec.d === -2
  if (isDynamic || isMeta) {
    // 无法静态缩小到单个 binding，依赖任意导出变化都可能影响本模块。
    bindings.add('*')
    return
  }

  const exp = source.slice(importSpec.ss, importSpec.se)
  ESM_STATIC_IMPORT_RE.lastIndex = 0
  const match = ESM_STATIC_IMPORT_RE.exec(exp)
  if (!match) {
    return
  }

  const staticImport: StaticImport = {
    type: 'static',
    code: match[0],
    start: match.index,
    end: match.index + match[0].length,
    imports: match.groups!.imports,
    specifier: match.groups!.specifier,
  }
  const parsed = parseStaticImport(staticImport)
  if (parsed.namespacedImport) {
    bindings.add('*')
  }
  if (parsed.defaultImport) {
    bindings.add('default')
  }
  if (parsed.namedImports) {
    for (const name of Object.keys(parsed.namedImports)) {
      bindings.add(name)
    }
  }
}

/**
 * 仅 unbundled dev 启用的 import 分析插件。
 *
 * 它用 es-module-lexer 找出 import/export/import.meta，解析并重写浏览器 URL；识别 HMR accept、
 * env 与动态 import；处理优化后 CJS 的 ESM 互操作；最后把依赖边和 HMR 边界写回 ModuleGraph。
 *
 * 示例：`import 'foo'` 会先 resolve，再改为 root URL、`/@fs/.../node_modules/foo/...` 或带版本的
 * 优化依赖 URL。非 JS/CSS 资源附加 `?import`，CSS import 本身保留 CSS URL，由 CSS 插件返回 JS
 * 注入模块；`<link>` 直取 CSS 则使用独立的 `?direct` 身份。
 */
export function importAnalysisPlugin(config: ResolvedConfig): Plugin {
  const { root, base } = config
  const clientPublicPath = path.posix.join(base, CLIENT_PUBLIC_PATH)
  const enablePartialAccept = config.experimental.hmrPartialAccept
  const matchAlias = getAliasPatternMatcher(config.resolve.alias)

  let _env: string | undefined
  let _ssrEnv: string | undefined
  /** 惰性生成 client/SSR 两份 import.meta.env 赋值，只让 SSR 布尔值不同。 */
  function getEnv(ssr: boolean) {
    if (!_ssrEnv || !_env) {
      const importMetaEnvKeys: Record<string, any> = {}
      const userDefineEnv: Record<string, any> = {}
      for (const key in config.env) {
        importMetaEnvKeys[key] = JSON.stringify(config.env[key])
      }
      for (const key in config.define) {
        // 非 import.meta.env.* define 由 clientInjection 插件处理。
        if (key.startsWith('import.meta.env.')) {
          userDefineEnv[key.slice(16)] = config.define[key]
        }
      }
      const env = `import.meta.env = ${serializeDefine({
        ...importMetaEnvKeys,
        SSR: '__vite_ssr__',
        ...userDefineEnv,
      })};`
      _ssrEnv = env.replace('__vite_ssr__', 'true')
      _env = env.replace('__vite_ssr__', 'false')
    }
    return ssr ? _ssrEnv : _env
  }

  return {
    name: 'vite:import-analysis',

    /** 开发态 import 分析只在非 bundled 环境启用，避免与 bundler 重复重写。 */
    applyToEnvironment(environment) {
      return !environment.config.isBundled
    },

    /** 解析 ESM import、动态 import 与 HMR 调用，规范化 URL 并更新模块图依赖。 */
    async transform(source, importer) {
      // 同一插件实例按 Environment 执行；consumer 决定浏览器 URL 重写还是保留给 server runtime。
      const environment = this.environment as DevEnvironment
      const ssr = environment.config.consumer === 'server'
      const moduleGraph = environment.moduleGraph

      if (canSkipImportAnalysis(importer)) {
        debug?.(colors.dim(`[skipped] ${prettifyUrl(importer, root)}`))
        return null
      }

      const msAtStart = debug ? performance.now() : 0
      await init
      let imports!: readonly ImportSpecifier[]
      let exports!: readonly ExportSpecifier[]
      source = stripBomTag(source)
      try {
        ;[imports, exports] = parseImports(source)
      } catch (_e: unknown) {
        const e = _e as EsModuleLexerParseError
        const { message, showCodeFrame } = createParseErrorInfo(
          importer,
          source,
        )
        this.error(message, showCodeFrame ? e.idx : undefined)
      }

      const depsOptimizer = environment.depsOptimizer

      // 已进入 importer 的 transform 阶段，loadAndTransform 理应在此之前把它登记入图。
      const importerModule = moduleGraph.getModuleById(importer)
      if (!importerModule) {
        // 优化依赖换代可能让当前请求对应的旧节点消失；抛 outdated 让 HTTP 返回 504，full reload
        // 会按新 hash 重新请求，不能把内部竞态伪装成普通解析错误。
        throwOutdatedRequest(importer)
      }

      if (
        !imports.length &&
        !(this as unknown as TransformPluginContext)._addedImports
      ) {
        const prunedImports = await moduleGraph.updateModuleInfo(
          importerModule,
          new Set(),
          null,
          new Set(),
          null,
          false,
        )
        if (prunedImports) {
          handlePrunedModules(prunedImports, environment)
        }
        debug?.(
          `${timeFrom(msAtStart)} ${colors.dim(
            `[no imports] ${prettifyUrl(importer, root)}`,
          )}`,
        )
        return source
      }

      let hasHMR = false
      let isSelfAccepting = false
      let hasEnv = false
      let needQueryInjectHelper = false
      let s: MagicString | undefined
      /** 惰性创建 MagicString，仅在首次需要改写源码时分配映射状态。 */
      const str = () => s || (s = new MagicString(source))
      let isPartiallySelfAccepting = false
      const importedBindings = enablePartialAccept
        ? new Map<string, Set<string>>()
        : null

      /**
       * 解析单个 specifier，确保依赖节点入图，附加 HMR 时间戳，并返回“浏览器 URL、规范 ID”。
       * forceSkipImportAnalysis 用于插件 addWatchFile 产生的边，避免把非源码依赖再次当 ESM 分析。
       */
      const normalizeUrl = async (
        url: string,
        pos: number,
        forceSkipImportAnalysis: boolean = false,
      ): Promise<[string, string | null]> => {
        let importerFile = importer

        if (
          depsOptimizer &&
          moduleListContains(depsOptimizer.options.exclude, url)
        ) {
          await depsOptimizer.scanProcessing

          // 优化文件遇到明确 exclude 的依赖时，需从原始依赖源码位置解析。若从 node_modules/.vite
          // 出发，未 hoist、位于该包自身 node_modules 下的依赖无法被找到。
          for (const optimizedModule of depsOptimizer.metadata.depInfoList) {
            if (!optimizedModule.src) continue // chunk 没有可作为解析基准的原始入口。
            if (optimizedModule.file === importerModule.file) {
              importerFile = optimizedModule.src
            }
          }
        }

        const resolved = await this.resolve(url, importerFile).catch((e) => {
          if (e instanceof Error) {
            ;(e as RollupError).pos ??= pos
          }
          throw e
        })

        // 开发态通常没有 resolved.meta；alias 插件仍可用内部标记报告“匹配但目标未解析”。
        if (!resolved || resolved.meta?.['vite:alias']?.noResolved) {
          // SSR external/runtime 解析的缺失模块留给 Node/Runner 报错。
          if (ssr) {
            return [url, null]
          }
          // 解析失败的 importer 不能继续保留 self-accept 标记，否则 HMR 更新会在错误边界停止（#9534）。
          importerModule.isSelfAccepting = false
          moduleGraph._hasResolveFailedErrorModules.add(importerModule)
          return this.error(
            `Failed to resolve import "${url}" from "${normalizePath(
              path.relative(process.cwd(), importerFile),
            )}". Does the file exist?`,
            pos,
          )
        }

        if (isExternalUrl(resolved.id)) {
          return [resolved.id, resolved.id]
        }

        url = normalizeResolvedIdToUrl(environment, url, resolved)

        try {
          // 依赖真正被 import 时才确定节点类型/self-accept 状态（#7870）；使用内部入口复用本次
          // resolved 结果，避免再次 resolve。
          const depModule = await moduleGraph._ensureEntryFromUrl(
            unwrapId(url),
            canSkipImportAnalysis(url) || forceSkipImportAnalysis,
            resolved,
          )
          // client 依赖若已经 HMR 更新，给 URL 加最近时间戳，强制浏览器绕过旧模块缓存。
          if (
            environment.config.consumer === 'client' &&
            depModule.lastHMRTimestamp > 0
          ) {
            url = injectQuery(url, `t=${depModule.lastHMRTimestamp}`)
          }
        } catch (e: any) {
          // 依赖入图/解析失败时补上 specifier 位置，让错误 overlay 指向 import 表达式。
          e.pos = pos
          throw e
        }

        // client URL 还需区分显式资源 import、继承 optimizer 版本以及公开 base。
        if (environment.config.consumer === 'client') {
          const isRelative = url[0] === '.'
          const isSelfImport =
            !isRelative && cleanUrl(url) === cleanUrl(importer)

          // 非 JS/CSS 加 `?import`，强制按模块加载而非静态文件语义响应。
          if (isExplicitImportRequired(url)) {
            url = injectQuery(url, 'import')
          } else if (
            (isRelative || isSelfImport) &&
            !DEP_VERSION_RE.test(url)
          ) {
            // 相对 JS/CSS 与同文件虚拟子模块（如 Vue block）继承 importer 的优化版本，保持同一轮
            // 预构建；common chunk 自带版本，未知资源类型则不能附加，以免破坏第三方扩展名检查。
            const versionMatch = DEP_VERSION_RE.exec(importer)
            if (versionMatch) {
              url = injectQuery(url, versionMatch[1])
            }
          }
        }

        // 浏览器请求补公开 base；SSR 保留运行时可解析的 URL。
        if (!ssr) url = joinUrlSegments(base, url)

        return [url, resolved.id]
      }

      // 单个 import 可并行 resolve，但结果按源码 index 落槽，保证 HMR 集合/诊断顺序稳定。
      const orderedImportedUrls = new Array<string | undefined>(imports.length)
      const orderedAcceptedUrls = new Array<Set<UrlPosition> | undefined>(
        imports.length,
      )
      const orderedAcceptedExports = new Array<Set<string> | undefined>(
        imports.length,
      )

      let _isNodeModeResult = config.legacy?.inconsistentCjsInterop
        ? false
        : undefined
      /** 惰性判断当前解析结果是否采用 Node 外部化模式，并缓存本模块结论。 */
      const isNodeMode = () => {
        _isNodeModeResult ??= isFilePathESM(importer, config.packageCache)
        return _isNodeModeResult
      }
      let _isNodeModeForDynamicImportResult = config.legacy
        ?.inconsistentCjsInterop
        ? false
        : undefined
      /** 判断动态导入是否必须保留 Node 运行时语义，避免浏览器 URL 改写。 */
      const isNodeModeForDynamicImport = () => {
        _isNodeModeForDynamicImportResult ??= isFilePathFormatExplicit(
          importer,
          config.packageCache,
        )
        return _isNodeModeForDynamicImportResult
      }

      await Promise.all(
        imports.map(async (importSpecifier, index) => {
          const {
            s: start,
            e: end,
            ss: expStart,
            se: expEnd,
            d: dynamicIndex,
            a: attributeIndex,
          } = importSpecifier

          // 用户可写转义路径（#2083），优先使用 lexer 给出的已解码 `.n`，不能直接切 raw source。
          let specifier = importSpecifier.n

          const rawUrl = source.slice(start, end)

          // import.meta 不是依赖 URL，单独识别 hot/env 协议。
          if (rawUrl === 'import.meta') {
            const prop = source.slice(end, end + 4)
            if (prop === '.hot') {
              hasHMR = true
              const endHot = end + 4 + (source[end + 4] === '?' ? 1 : 0)
              if (source.slice(endHot, endHot + 7) === '.accept') {
                // 继续词法扫描 accept/acceptExports 参数，提取 HMR 边界。
                if (source.slice(endHot, endHot + 14) === '.acceptExports') {
                  const importAcceptedExports = (orderedAcceptedExports[index] =
                    new Set<string>())
                  lexAcceptedHmrExports(
                    source,
                    source.indexOf('(', endHot + 14) + 1,
                    importAcceptedExports,
                  )
                  isPartiallySelfAccepting = true
                } else {
                  const importAcceptedUrls = (orderedAcceptedUrls[index] =
                    new Set<UrlPosition>())
                  if (
                    lexAcceptedHmrDeps(
                      source,
                      source.indexOf('(', endHot + 7) + 1,
                      importAcceptedUrls,
                    )
                  ) {
                    isSelfAccepting = true
                  }
                }
              }
            } else if (prop === '.env') {
              hasEnv = true
            }
            return
          } else if (templateLiteralRE.test(rawUrl)) {
            // glob 插件未处理的反引号 import 可能只是无插值字符串；降级成普通字面量解析，避免
            // 错误提示“无法分析”。真正含 `${}` 的模板仍走动态表达式分支。
            if (!(rawUrl.includes('${') && rawUrl.includes('}'))) {
              specifier = rawUrl.replace(templateLiteralRE, '$1')
            }
          }

          const isDynamicImport = dynamicIndex > -1

          // 静态 import attributes 由 Vite 插件语义自行处理，发给浏览器前移除。
          if (!isDynamicImport && attributeIndex > -1) {
            str().remove(end + 1, expEnd)
          }

          // 静态 import 或可确定字面量的动态 import 都能进入 resolve/URL 重写。
          if (specifier !== undefined) {
            // 未命中 alias 的外部 URL/data URI 由浏览器直接解释。
            if (
              ((isExternalUrl(specifier) && !specifier.startsWith('file://')) ||
                isDataUrl(specifier)) &&
              !matchAlias(specifier)
            ) {
              return
            }
            // SSR external/builtin 交给 server runtime；alias 命中时仍需先解析用户映射。
            if (ssr && !matchAlias(specifier)) {
              if (shouldExternalize(environment, specifier, importer)) {
                return
              }
              if (isBuiltin(environment.config.resolve.builtins, specifier)) {
                return
              }
            }
            // `/@vite/client` 已是最终公开 URL，不能再次 resolve/包装。
            if (specifier === clientPublicPath) {
              return
            }

            // publicDir 的 JS/CSS 原样复制且不经 transform，源码只能通过 HTML 标签引用；明确
            // assetsInclude 或 `?url` 资源仍允许作为 URL 导入。
            if (
              specifier[0] === '/' &&
              !(
                config.assetsInclude(cleanUrl(specifier)) ||
                urlRE.test(specifier)
              ) &&
              checkPublicFile(specifier, config)
            ) {
              throw new Error(
                `Cannot import non-asset file ${specifier} which is inside /public. ` +
                  `JS/CSS files inside /public are copied as-is on build and ` +
                  `can only be referenced via <script src> or <link href> in html. ` +
                  `If you want to get the URL of that file, use ${injectQuery(
                    specifier,
                    'url',
                  )} instead.`,
              )
            }

            // 解析、入图，并生成浏览器 URL/规范 ID 两种身份。
            let [url, resolvedId] = await normalizeUrl(specifier, start)
            resolvedId = resolvedId || url

            // 已由 import 链解析到的文件登记为安全模块；路径必须先去 base，避免访问白名单身份漂移。
            // 背景：https://github.com/vitejs/vite/issues/9438#issuecomment-1465270409
            config.safeModulePaths.add(fsPathFromUrl(stripBase(url, base)))

            if (url !== specifier) {
              let rewriteDone = false
              // optimizer 自己输出的相对 import 指向同目录标准化 chunk，无需再次 interop；插件向
              // 优化产物注入的 import（如 @rollup/plugin-inject）仍可能指向 CJS，必须处理（#23029）。
              const isOptimizerEmittedImport =
                depsOptimizer?.isOptimizedDepFile(importer) &&
                specifier[0] === '.'
              if (
                !isOptimizerEmittedImport &&
                depsOptimizer?.isOptimizedDepFile(resolvedId) &&
                !optimizedDepChunkRE.test(resolvedId)
              ) {
                // 优化后 CJS 的 named import 改写为默认导入后的属性赋值；内部 chunk 已是 optimizer
                // 标准格式，不需要互操作。

                // resolvedId 中 browserHash 可能已经过期；full reload 会换新 URL，此处继续完成旧请求
                // 比提前 404 更安全。
                const file = cleanUrl(resolvedId) // 移除 `?v={hash}`。

                const depInfo = optimizedDepInfoFromFile(
                  depsOptimizer.metadata,
                  file,
                )
                const needsInterop = await optimizedDepNeedsInterop(
                  environment,
                  depsOptimizer.metadata,
                  file,
                )

                if (needsInterop === undefined) {
                  // 依赖内部非入口动态 import 没有优化元数据是正常的，也不需互操作；动态入口若
                  // 声称需要优化却缺元数据才是内部错误。
                  if (depInfo?.isDynamicEntry) {
                    config.logger.error(
                      colors.red(
                        `Vite Error, ${url} optimized info should be defined`,
                      ),
                    )
                  }
                } else if (needsInterop) {
                  debug?.(`${url} needs interop`)
                  interopNamedImports(
                    str(),
                    importSpecifier,
                    url,
                    index,
                    importer,
                    isDynamicImport
                      ? isNodeModeForDynamicImport()
                      : isNodeMode(),
                    config,
                  )
                  rewriteDone = true
                }
              }
              // browser builtin stub 只导出 default；named import 若不改写会先触发浏览器链接错误，
              // 经过 interop 才能执行 stub 并显示 Vite 的 browser-external 说明。
              else if (
                url.startsWith(wrapId(browserExternalId)) &&
                source.slice(expStart, start).includes('{')
              ) {
                interopNamedImports(
                  str(),
                  importSpecifier,
                  url,
                  index,
                  importer,
                  isNodeMode(),
                  config,
                )
                rewriteDone = true
              }
              if (!rewriteDone) {
                const rewrittenUrl = JSON.stringify(url)
                const s = isDynamicImport ? start : start - 1
                const e = isDynamicImport ? end : end + 1
                str().overwrite(s, e, rewrittenUrl, {
                  contentOnly: true,
                })
              }
            }

            // HMR 图使用内部 URL：去公开 base，并解开 `/@id/` 包装。
            const hmrUrl = unwrapId(stripBase(url, base))
            const isLocalImport = !isExternalUrl(hmrUrl) && !isDataUrl(hmrUrl)
            if (isLocalImport) {
              orderedImportedUrls[index] = hmrUrl
            }

            if (enablePartialAccept && importedBindings) {
              extractImportedBindings(
                resolvedId,
                source,
                importSpecifier,
                importedBindings,
              )
            }

            if (
              !isDynamicImport &&
              isLocalImport &&
              environment.config.dev.preTransformRequests
            ) {
              // 已知静态直接 import 可投机预热；transformRequest 也会登记处理 Promise，optimizer
              // 稳定阶段能等待这些请求，不会形成无法追踪的后台工作。
              const url = removeImportQuery(hmrUrl)
              environment.warmupRequest(url)
            }
          } else if (!importer.startsWith(withTrailingSlash(clientDir))) {
            if (!isInNodeModules(importer)) {
              // `@vite-ignore` 表示用户有意保留运行时表达式，抑制静态分析警告。
              const hasViteIgnore = hasViteIgnoreRE.test(
                // 检查 import() 括号内完整表达式，而不只 lexer 的 URL 片段。
                source.slice(dynamicIndex + 1, end),
              )
              if (!hasViteIgnore) {
                this.warn(
                  `\n` +
                    colors.cyan(importerModule.file) +
                    `\n` +
                    colors.reset(generateCodeFrame(source, start, end)) +
                    colors.yellow(
                      `\nThe above dynamic import cannot be analyzed by Vite.\n` +
                        `See ${colors.blue(
                          `https://vite.dev/guide/features#dynamic-import`,
                        )} ` +
                        `for supported dynamic import formats. ` +
                        `If this is intended to be left as-is, you can use the ` +
                        `/* @vite-ignore */ comment inside the import() call to suppress this warning.\n`,
                    ),
                )
              }
            }

            if (!ssr) {
              if (
                !urlIsStringRE.test(rawUrl) ||
                isExplicitImportRequired(rawUrl.slice(1, -1))
              ) {
                needQueryInjectHelper = true
                str().overwrite(
                  start,
                  end,
                  `__vite__injectQuery(${rawUrl}, 'import')`,
                  { contentOnly: true },
                )
              }
            }
          }
        }),
      )

      const _orderedImportedUrls = orderedImportedUrls.filter(isDefined)
      const importedUrls = new Set(_orderedImportedUrls)
      // importedUrls 还会合并插件 addWatchFile 边；staticImportedUrls 只保留源码顶层静态/动态
      // import，并移除 HMR timestamp，供软失效按真实 import URL 查找。
      const staticImportedUrls = new Set(
        _orderedImportedUrls.map((url) => removeTimestampQuery(url)),
      )
      const acceptedUrls = mergeAcceptedUrls(orderedAcceptedUrls)
      const acceptedExports = mergeAcceptedUrls(orderedAcceptedExports)

      // 通常输入均为 ESM；classic worker 是唯一例外，不能注入 import/import.meta 等 ESM 代码。
      const isClassicWorker =
        importer.includes(WORKER_FILE_ID) && importer.includes('type=classic')

      if (hasEnv && !isClassicWorker) {
        // 文件实际访问 env 时才注入，避免每个模块无条件增加代码。
        str().prepend(getEnv(ssr))
      }

      if (hasHMR && !ssr && !isClassicWorker) {
        debugHmr?.(
          `${
            isSelfAccepting
              ? `[self-accepts]`
              : isPartiallySelfAccepting
                ? `[accepts-exports]`
                : acceptedUrls.size
                  ? `[accepts-deps]`
                  : `[detected api usage]`
          } ${prettifyUrl(importer, root)}`,
        )
        // 文件实际访问 import.meta.hot 时才创建绑定到规范 HMR URL 的 HotContext。
        str().prepend(
          `import { createHotContext as __vite__createHotContext } from "${clientPublicPath}";` +
            `import.meta.hot = __vite__createHotContext(${JSON.stringify(
              normalizeHmrUrl(importerModule.url),
            )});`,
        )
      }

      if (needQueryInjectHelper) {
        if (isClassicWorker) {
          str().append('\n' + __vite__injectQuery.toString())
        } else {
          str().prepend(
            `import { injectQuery as __vite__injectQuery } from "${clientPublicPath}";`,
          )
        }
      }

      // accept 依赖必须与 import 使用相同 resolve/URL 身份；再重写为 HMR runtime 的规范 URL。
      const normalizedAcceptedUrls = new Set<string>()
      for (const { url, start, end } of acceptedUrls) {
        let [normalized, resolvedId] = await normalizeUrl(url, start).catch(
          () => [],
        )
        if (resolvedId) {
          const mod = moduleGraph.getModuleById(resolvedId)
          if (!mod) {
            this.error(
              `module was not found for ${JSON.stringify(resolvedId)}`,
              start,
            )
            return
          }
          normalized = mod.url
        } else {
          this.error({
            message: `Failed to resolve ${JSON.stringify(url)} from ${importer}.`,
            pos: start,
          })
        }
        normalizedAcceptedUrls.add(normalized)
        const hmrAccept = normalizeHmrUrl(normalized)
        str().overwrite(start, end, JSON.stringify(hmrAccept), {
          contentOnly: true,
        })
      }

      // 将依赖/HMR 边写回模块图。普通 CSS 由 css-analysis 自行更新；`.css?raw`/`.css?url` 是
      // JS 模块语义，仍由这里处理。
      if (!isCSSRequest(importer) || SPECIAL_QUERY_RE.test(importer)) {
        // 插件通过 addWatchFile 声明的文件也加入依赖图，但标记跳过 import analysis。
        const pluginImports = (this as unknown as TransformPluginContext)
          ._addedImports
        if (pluginImports) {
          ;(
            await Promise.all(
              [...pluginImports].map((id) => normalizeUrl(id, 0, true)),
            )
          ).forEach(([url]) => importedUrls.add(stripBase(url, base)))
        }
        // SSR 不注入 HMR runtime，不能因本轮没检测到注入代码就擦掉节点已有 self-accept 状态。
        if (ssr && importerModule.isSelfAccepting) {
          isSelfAccepting = true
        }
        // acceptExports 覆盖模块全部导出时，实践上等价于 self-accept，可在此停止向 importer 传播。
        if (
          !isSelfAccepting &&
          isPartiallySelfAccepting &&
          acceptedExports.size >= exports.length &&
          exports.every((e) => acceptedExports.has(e.n))
        ) {
          isSelfAccepting = true
        }
        const prunedImports = await moduleGraph.updateModuleInfo(
          importerModule,
          importedUrls,
          importedBindings,
          normalizedAcceptedUrls,
          isPartiallySelfAccepting ? acceptedExports : null,
          isSelfAccepting,
          staticImportedUrls,
        )
        if (prunedImports) {
          handlePrunedModules(prunedImports, environment)
        }
      }

      debug?.(
        `${timeFrom(msAtStart)} ${colors.dim(
          `[${importedUrls.size} imports rewritten] ${prettifyUrl(
            importer,
            root,
          )}`,
        )}`,
      )

      if (s) {
        return transformStableResult(s, importer, config)
      } else {
        return source
      }
    },
  }
}

/** 按 lexer 索引顺序合并并去重并行扫描得到的 HMR accept URL/export。 */
function mergeAcceptedUrls<T>(orderedUrls: Array<Set<T> | undefined>) {
  const acceptedUrls = new Set<T>()
  for (const urls of orderedUrls) {
    if (!urls) continue
    for (const url of urls) acceptedUrls.add(url)
  }
  return acceptedUrls
}

/**
 * 为 import lexer 解析失败选择有针对性的建议：缺 Vue 插件、JSX 扩展名/tsconfig 或 assetsInclude。
 * 疑似二进制内容不显示 code frame，避免把乱码刷进终端/overlay。
 */
export function createParseErrorInfo(
  importer: string,
  source: string,
): {
  /** 针对文件类型与缺失插件生成的用户诊断。 */
  message: string;
  /** 二进制疑似内容为 false，避免在错误中输出乱码代码框。 */
  showCodeFrame: boolean
} {
  const isVue = importer.endsWith('.vue')
  const isJsx = importer.endsWith('.jsx') || importer.endsWith('.tsx')
  const maybeJSX = !isVue && isJSRequest(importer)
  const probablyBinary = source.includes(
    '\ufffd' /* Unicode 替换字符，通常表示二进制被按 UTF-8 解码。 */,
  )

  const msg = isVue
    ? `Install @vitejs/plugin-vue to handle .vue files.`
    : maybeJSX
      ? isJsx
        ? `If you use tsconfig.json, make sure to not set jsx to preserve.`
        : `If you are using JSX, make sure to name the file with the .jsx or .tsx extension.`
      : `You may need to install appropriate plugins to handle the ${path.extname(
          importer,
        )} file format, or if it's an asset, add "**/*${path.extname(
          importer,
        )}" to \`assetsInclude\` in your configuration.`

  return {
    message:
      `Failed to parse source for import analysis because the content ` +
      `contains invalid JS syntax. ` +
      msg,
    showCodeFrame: !probablyBinary,
  }
}

/** 把 CJS default 包装成可按 ESM namespace/default 读取的对象；n 表示 Node 互操作模式。 */
const interopHelper = (m: any, n: boolean) =>
  n || !m?.__esModule
    ? {
        ...((typeof m === 'object' && !Array.isArray(m)) ||
        typeof m === 'function'
          ? m
          : {}),
        default: m,
      }
    : m
/** 保存压平为单行的 CommonJS 互操作辅助函数源码。 */
const interopHelperStr = interopHelper.toString().replaceAll('\n', '')

/**
 * 对已优化 CJS 或 browser external stub 改写静态/动态 import，并用原换行数维持 Source Map 行号。
 */
export function interopNamedImports(
  str: MagicString,
  importSpecifier: ImportSpecifier,
  rewrittenUrl: string,
  importIndex: number,
  importer: string,
  isNodeMode: boolean,
  config: ResolvedConfig,
): void {
  const source = str.original
  const {
    s: start,
    e: end,
    ss: expStart,
    se: expEnd,
    d: dynamicIndex,
  } = importSpecifier
  const exp = source.slice(expStart, expEnd)
  if (dynamicIndex > -1) {
    // 动态 import 的 namespace 通过 default 进入互操作 helper，再暴露一致的 default/named 视图。
    str.overwrite(
      expStart,
      expEnd,
      `import('${rewrittenUrl}').then(m => (${interopHelperStr})(m.default, ${+isNodeMode}))` +
        getLineBreaks(exp),
      { contentOnly: true },
    )
  } else {
    const rawUrl = source.slice(start, end)
    const rewritten = transformCjsImport(
      exp,
      rewrittenUrl,
      rawUrl,
      importIndex,
      importer,
      isNodeMode,
      config,
    )
    if (rewritten) {
      str.overwrite(
        expStart,
        expEnd,
        rewritten.importLine + getLineBreaks(exp),
        { contentOnly: true },
      )
      if (rewritten.hoistedAssignments) {
        str.appendLeft(
          getFileStartIndex(source),
          rewritten.hoistedAssignments + ';',
        )
      }
    } else {
      // `export * from` 无法安全枚举 CJS 导出（#1439），只替换 URL 并保留警告路径。
      str.overwrite(
        start,
        end,
        rewrittenUrl + getLineBreaks(source.slice(start, end)),
        {
          contentOnly: true,
        },
      )
    }
  }
}

/** 返回等量换行，改写整条 import 时保持后续 Source Map 行号。 */
function getLineBreaks(str: string) {
  return str.includes('\n') ? '\n'.repeat(str.split('\n').length - 1) : ''
}

/** 描述 CommonJS 互操作转换中的导入名与本地绑定名。 */
type ImportNameSpecifier = {
  /** 从 CommonJS 包装对象读取的导出名称。 */
  importedName: string;
  /** 改写后的 ESM 模块中创建的本地绑定名。 */
  localName: string
}

/**
 * 把指向已知优化 CJS 的 ESM import/export 改写为默认导入 + `module.exports` 属性读取。
 *
 * named binding 是赋值快照，不跟踪 CJS 后续动态重赋值。es-module-lexer 也把 `export * from` 作为
 * import 返回，但它无法静态枚举 CJS 导出，因此本函数对 ExportAllDeclaration 返回 undefined。
 * 最初方案由 @csr632 在 #837 提供。
 */
export function transformCjsImport(
  importExp: string,
  url: string,
  rawUrl: string,
  importIndex: number,
  importer: string,
  isNodeMode: boolean,
  config: ResolvedConfig,
):
  {
      /** 替换原 import/export 声明的互操作导入代码。 */
      importLine: string;
      /** 需要提升到模块顶部、再在原位置引用的赋值代码。 */
      hoistedAssignments?: string
    }
  | undefined {
  const node = parseAst(importExp).body[0]

  // CJS 的 export * 可能丢导出，开发态给出改用 named export 的明确警告。
  if (
    config.command === 'serve' &&
    node.type === 'ExportAllDeclaration' &&
    !node.exported
  ) {
    config.logger.warn(
      colors.yellow(
        `\nUnable to interop \`${importExp}\` in ${importer}, this may lose module exports. Please export "${rawUrl}" as ESM or use named exports instead, e.g. \`export { A, B } from "${rawUrl}"\``,
      ),
    )
  } else if (
    node.type === 'ImportDeclaration' ||
    node.type === 'ExportNamedDeclaration'
  ) {
    if (!node.specifiers.length) {
      return { importLine: `import "${url}"` }
    }

    const importNames: ImportNameSpecifier[] = []
    const exportNames: string[] = []
    let defaultExports: string = ''
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        const importedName = getIdentifierNameOrLiteralValue(spec.imported)
        const localName = spec.local.name
        importNames.push({ importedName, localName })
      } else if (spec.type === 'ImportDefaultSpecifier') {
        importNames.push({
          importedName: 'default',
          localName: spec.local.name,
        })
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        importNames.push({ importedName: '*', localName: spec.local.name })
      } else if (spec.type === 'ExportSpecifier') {
        // ExportSpecifier 的 local 是被导入名；生成带内部前缀变量，避免与用户局部变量冲突。
        const importedName = getIdentifierNameOrLiteralValue(spec.local)
        // 读取 CJS 属性到内部变量，再以用户声明的 exported name 重导出。
        const exportedName = getIdentifierNameOrLiteralValue(spec.exported)
        if (exportedName === 'default') {
          defaultExports = makeLegalIdentifier(
            `__vite__cjsExportDefault_${importIndex}`,
          )
          importNames.push({ importedName, localName: defaultExports })
        } else {
          const localName = `__vite__cjsExport${
            spec.exported.type === 'Literal'
              ? `L_${getHash(spec.exported.value)}`
              : 'I_' + spec.exported.name
          }`
          importNames.push({ importedName, localName })
          exportNames.push(
            `${localName} as ${spec.exported.type === 'Literal' ? JSON.stringify(exportedName) : exportedName}`,
          )
        }
      }
    }

    // 同文件可多次 import 同一 ID；importIndex 保证生成的 CJS 默认导入变量不重名。
    const cjsModuleName = makeLegalIdentifier(
      `__vite__cjsImport${importIndex}_${rawUrl}`,
    )
    const importLine = `import ${cjsModuleName} from "${url}"`
    const lines: string[] = []
    importNames.forEach(({ importedName, localName }) => {
      if (importedName === '*') {
        lines.push(
          `const ${localName} = (${interopHelperStr})(${cjsModuleName}, ${+isNodeMode})`,
        )
      } else if (importedName === 'default') {
        if (isNodeMode) {
          lines.push(`const ${localName} = ${cjsModuleName}`)
        } else {
          lines.push(
            `const ${localName} = !${cjsModuleName}.__esModule ? ${cjsModuleName} : ${cjsModuleName}.default`,
          )
        }
      } else {
        lines.push(`const ${localName} = ${cjsModuleName}["${importedName}"]`)
      }
    })
    if (defaultExports) {
      lines.push(`export default ${defaultExports}`)
    }
    if (exportNames.length) {
      lines.push(`export { ${exportNames.join(', ')} }`)
    }

    return { importLine, hoistedAssignments: lines.join('; ') }
  }
}

/** 从导出标识符或字符串字面量中取得统一名称。 */
function getIdentifierNameOrLiteralValue(node: ESTree.ModuleExportName) {
  return node.type === 'Identifier' ? node.name : node.value
}

/**
 * client/client.ts 中 injectQuery 的内联副本；classic worker 不能注入 ESM helper import，只能把
 * 函数体直接附到脚本。
 */
function __vite__injectQuery(url: string, queryToInject: string): string {
  // 裸包/协议 URL 不由当前 Vite HTTP 管线处理，不附加 query。
  if (url[0] !== '.' && url[0] !== '/') {
    return url
  }

  // URL 可能是 `../` 相对路径，不能使用会绝对化的 URL.pathname；手工保留相对 pathname。
  const pathname = url.replace(/[?#].*$/, '')
  const { search, hash } = new URL(url, 'http://vite.dev')

  return `${pathname}?${queryToInject}${search ? `&` + search.slice(1) : ''}${
    hash || ''
  }`
}
