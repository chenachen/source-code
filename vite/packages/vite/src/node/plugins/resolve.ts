import fs from 'node:fs'
import path from 'node:path'
import colors from 'picocolors'
import type { PartialResolvedId } from 'rolldown'
import { viteResolvePlugin } from 'rolldown/experimental'
import { exports, imports } from 'resolve.exports'
import type { Plugin } from '../plugin'
import {
  CLIENT_ENTRY,
  DEP_VERSION_RE,
  DEV_PROD_CONDITION,
  ENV_ENTRY,
  FS_PREFIX,
  SPECIAL_QUERY_RE,
} from '../constants'
import {
  bareImportRE,
  createDebugger,
  deepImportRE,
  fsPathFromId,
  getNpmPackageName,
  injectQuery,
  isBuiltin,
  isDataUrl,
  isExternalUrl,
  isInNodeModules,
  isObject,
  isOptimizable,
  normalizePath,
  safeRealpathSync,
  tryStatSync,
} from '../utils'
import {
  isDepOptimizationDisabled,
  optimizedDepInfoFromFile,
  optimizedDepInfoFromId,
} from '../optimizer'
import type { DepsOptimizer } from '../optimizer'
import type { Environment } from '..'
import type { PackageCache, PackageData } from '../packages'
import { canExternalizeFile } from '../external'
import {
  findNearestMainPackageData,
  findNearestPackageData,
  loadPackageData,
  resolvePackageData,
} from '../packages'
import {
  cleanUrl,
  splitFileAndPostfix,
  withTrailingSlash,
} from '../../shared/utils'
import type { ResolvedConfig, ResolvedEnvironmentOptions } from '../config'

/** 依赖版本查询注入时必须排除的 Vite client/env 运行时入口。 */
const normalizedClientEntry = normalizePath(CLIENT_ENTRY)
/** 版本查询注入时排除的规范化 Vite env 运行时入口。 */
const normalizedEnvEntry = normalizePath(ENV_ENTRY)

/** 包入口字段存在但无法落到真实文件时的稳定错误码。 */
const ERR_RESOLVE_PACKAGE_ENTRY_FAIL = 'ERR_RESOLVE_PACKAGE_ENTRY_FAIL'

/**
 * package.json browser:false 映射的虚拟占位模块。
 * @see https://github.com/defunctzombie/package-browser-field-spec#ignore-a-module
 */
export const browserExternalId = '__vite-browser-external'
/** 缺失 optional peer dependency 的虚拟模块前缀，交给加载阶段生成兼容占位或运行时诊断。 */
export const optionalPeerDepId = '__vite-optional-peer-dep'

/** package.json `imports` 子路径映射的保留前缀。 */
const subpathImportsPrefix = '#'

/** imports 映射结果是否已是显式相对路径。 */
const relativePrefixRE = /^\.\.?(?:[/\\]|$)/
/** HTML 等 preferRelative 场景中可能代表相对文件名的裸单词开头。 */
const startsWithWordCharRE = /^\w/

/** `DEBUG=vite:resolve-details` 启用的解析决策日志。 */
const debug = createDebugger('vite:resolve-details', {
  onlyWhenFocused: true,
})

/** 单个 Environment 可覆盖的模块解析策略。 */
export interface EnvironmentResolveOptions {
  /**
   * package.json 入口字段优先级；`exports` 始终优先于这些字段。
   * @default ['browser', 'module', 'jsnext:main', 'jsnext']
   */
  mainFields?: string[]
  /** package exports/imports 的条件列表；特殊 `development|production` 按 isProduction 展开。 */
  conditions?: string[]
  /** 外部化包在目标运行时使用的独立 exports 条件列表。 */
  externalConditions?: string[]
  /**
   * 省略扩展名时依次尝试的文件扩展名。
   * @default ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']
   */
  extensions?: string[]
  /** 总是从项目 root 解析的包名，避免 monorepo 出现多个版本实例。 */
  dedupe?: string[]
  // TODO：抽象成也适用于 client Environment 的通用 bundle 控制。
  /**
   * 阻止匹配依赖外部化，使其由 Vite 加载转换或在 bundled 模式进入 bundle。只对 server 生效，
   * 旧名称为 `ssr.noExternal`。
   * @experimental
   */
  noExternal?: string | RegExp | (string | RegExp)[] | true
  /**
   * 把指定依赖及其可外部化子路径保留为运行时 import。目前只对 server Environment 生效，
   * 旧名称为 `ssr.external`。
   * @experimental
   */
  external?: string[] | true
  /** 当前运行时 builtin 模块的字符串/正则列表。 */
  builtins?: (string | RegExp)[]
}

/** 顶层 resolve 选项，增加跨 Environment 共享的软链接和 tsconfig path 行为。 */
export interface ResolveOptions extends EnvironmentResolveOptions {
  /**
   * 保留符号链接路径，不调用 realpath；会影响包身份、dedupe 与缓存键。
   * @default false
   */
  preserveSymlinks?: boolean
  /**
   * 启用 tsconfig `paths` 解析。
   *
   * @default false
   */
  tsconfigPaths?: boolean
}

/** Vite 内部为不同解析场景附加的运行阶段选项。 */
interface ResolvePluginOptions {
  /** 项目根和裸包解析回退目录。 */
  root: string
  /** 是否处于生产构建。 */
  isBuild: boolean
  /** exports 的 development/production 条件选择。 */
  isProduction: boolean
  /** 复用 package.json 定位/内容/入口结果。 */
  packageCache?: PackageCache
  /**
   * 源码模式额外解析 `/xxx` URL，并优先识别已优化依赖。
   */
  asSrc?: boolean
  /** 目录解析时是否尝试 package entry 与 index。 */
  tryIndex?: boolean
  /** 扩展名失败后尝试的文件名前缀，例如 Sass `_partial`。 */
  tryPrefix?: string
  /** 对无 `./` 的单词 specifier 是否先尝试相对 importer。 */
  preferRelative?: boolean
  /** 按 require 条件而非 import 条件解析 exports/imports。 */
  isRequire?: boolean
  /** 是否处于依赖扫描阶段。 */
  scan?: boolean
  /** 不在 mainFields 尾部补 `main`。 @internal */
  skipMainField?: boolean

  /** 开发态接入依赖优化器；缺省 false。 @internal */
  optimizeDeps?: boolean

  /**
   * server 构建时应用 resolve.external/noExternal；createResolver 缺省 false。
   * @internal
   */
  externalize?: boolean

  /**
   * createResolver 只关心 id 时启用，跳过 moduleSideEffects 等元数据。
   * @internal
   */
  idOnly?: boolean

  /**
   * `nodeResolveWithVite` 启用，关闭 optional peer 虚拟模块特判。
   * @internal
   */
  disableOptionalPeerDepHandling?: boolean

  /**
   * `legacy.inconsistentCjsInterop` 开启时启用，用于保留旧 CJS package 边界行为。
   */
  legacyInconsistentCjsInterop?: boolean
}

/** 所有用户默认值和内部场景开关均已补齐的解析参数。 */
export interface InternalResolveOptions
  extends Required<ResolveOptions>, ResolvePluginOptions {}

/**
 * CSS、扫描等自定义 resolver 的配置：显式 ResolveOptions 覆盖所有 Environment 的对应值。
 */
export interface ResolvePluginOptionsWithOverrides
  extends ResolveOptions, ResolvePluginOptions {}

/**
 * 把 Rolldown 原生 resolve 插件适配成按 Environment 派生的 Vite 插件，并提供取得完整
 * Environment 的延迟闭包。Worker/精简 resolver 可用 overrideEnvConfig 固定单套配置。
 */
const perEnvironmentOrWorkerPlugin = (
  name: string,
  overrideEnvConfig: (ResolvedConfig & ResolvedEnvironmentOptions) | undefined,
  f: (
    env: {
      /** 原生解析插件所服务的环境名称。 */
      name: string
      /** 创建环境时使用的已解析配置与环境选项。 */
      config: ResolvedConfig & ResolvedEnvironmentOptions
    },
    getEnvironment: () => Environment,
  ) => Plugin,
): Plugin[] => {
  const envs: Record<string, Environment> = {}
  // 原生插件创建时只有 PartialEnvironment；buildStart 后记录完整实例，供依赖优化回调读取。
  const getEnvironmentPlugin: Plugin = {
    name: `${name}:get-environment`,
    /** 在原生解析插件可用后保存完整环境实例，供延迟依赖优化回调读取。 */
    buildStart() {
      envs[this.environment.name] = this.environment
    },
    perEnvironmentStartEndDuringDev: true,
  }
  /** 创建延迟读取环境的闭包，使原生解析插件在 buildStart 后取得完整实例。 */
  const createGetEnvironment = (name: string) => () => envs[name]

  if (overrideEnvConfig) {
    return [
      getEnvironmentPlugin,
      f(
        { name: 'client', config: overrideEnvConfig },
        createGetEnvironment('client'),
      ),
    ]
  }
  return [
    getEnvironmentPlugin,
    {
      name,
      /** 为当前 Environment 派生原生 resolver；配置与运行状态按环境分别读取。 */
      applyToEnvironment(environment) {
        return f(environment, createGetEnvironment(environment.name))
      },
    },
  ]
}

/**
 * 创建 Vite 的解析插件组：可选的开发优化依赖快路径，加上按 Environment 配置的 Rolldown
 * 原生 resolver。回调负责补齐 Vite 的版本查询、子路径 imports、日志和依赖优化注册。
 */
export function oxcResolvePlugin(
  resolveOptions: ResolvePluginOptionsWithOverrides,
  overrideEnvConfig: (ResolvedConfig & ResolvedEnvironmentOptions) | undefined,
  isJsPluginContainer = false,
): Plugin[] {
  return [
    ...(resolveOptions.optimizeDeps && !resolveOptions.isBuild
      ? [optimizerResolvePlugin(resolveOptions)]
      : []),
    ...perEnvironmentOrWorkerPlugin(
      'vite:resolve-builtin',
      overrideEnvConfig,
      (partialEnv, getEnv) => {
        // createIdResolver 也复用此插件但不应隐式启动优化器，因此 optimizeDeps 必须显式 opt-in。
        const depsOptimizerEnabled =
          resolveOptions.optimizeDeps &&
          !resolveOptions.isBuild &&
          !partialEnv.config.isBundled &&
          !isDepOptimizationDisabled(partialEnv.config.optimizeDeps)
        /** 在优化器回调执行时取得完整 dev Environment；缺少优化器属于内部配置错误。 */
        const getDepsOptimizer = () => {
          const env = getEnv()
          if (env.mode !== 'dev')
            throw new Error('The environment mode should be dev')
          if (!env.depsOptimizer)
            throw new Error('The environment should have a depsOptimizer')
          return env.depsOptimizer
        }

        const options: InternalResolveOptions = {
          ...partialEnv.config.resolve,
          // 场景参数与显式 resolve 覆盖优先于 Environment 默认值。
          ...resolveOptions,
        }
        const noExternal =
          Array.isArray(options.noExternal) || options.noExternal === true
            ? options.noExternal
            : [options.noExternal]

        const plugin = viteResolvePlugin({
          resolveOptions: {
            isBuild: options.isBuild,
            isProduction: options.isProduction,
            asSrc: options.asSrc ?? false,
            preferRelative: options.preferRelative ?? false,
            isRequire: options.isRequire,
            root: options.root,
            scan: options.scan ?? false,

            mainFields: options.skipMainField
              ? options.mainFields
              : options.mainFields.concat(['main']),
            conditions: options.conditions,
            externalConditions: options.externalConditions,
            extensions: options.extensions,
            tryIndex: options.tryIndex ?? true,
            tryPrefix: options.tryPrefix,
            preserveSymlinks: options.preserveSymlinks,
            tsconfigPaths: options.tsconfigPaths,
          },
          environmentConsumer: partialEnv.config.consumer,
          environmentName: partialEnv.name,
          builtins: partialEnv.config.resolve.builtins,
          external: options.external,
          noExternal: noExternal,
          dedupe: options.dedupe,
          disableCache:
            partialEnv.config.command === 'serve' &&
            // eslint-disable-next-line eqeqeq
            partialEnv.config.server.watch === null,
          legacyInconsistentCjsInterop: options.legacyInconsistentCjsInterop,
          /** 裸包已解析后决定注册优化入口或仅加缓存版本；优化器只在普通开发环境启用。 */
          finalizeBareSpecifier: !depsOptimizerEnabled
            ? undefined
            : (resolvedId, rawId, importer) => {
                const depsOptimizer = getDepsOptimizer()
                // 到达这里表示裸包已解析成功，但尚未映射到优化产物。
                const isJsType = isOptimizable(
                  resolvedId,
                  depsOptimizer.options,
                )
                const exclude = depsOptimizer?.options.exclude

                // deep import（如 my-lib/foo）仍以顶层包名匹配 exclude。
                const deepMatch = deepImportRE.exec(rawId)
                // 包名不含 query/hash；先清理以支持 `normalize.css?inline`。
                const pkgId = deepMatch
                  ? deepMatch[1] || deepMatch[2]
                  : cleanUrl(rawId)

                const skipOptimization =
                  depsOptimizer.options.noDiscovery ||
                  !isJsType ||
                  (importer && isInNodeModules(importer)) ||
                  exclude?.includes(pkgId) ||
                  exclude?.includes(rawId) ||
                  SPECIAL_QUERY_RE.test(resolvedId)

                let newId = resolvedId
                if (skipOptimization) {
                  // 不优化的已知 JS npm 依赖仍注入 browserHash，使浏览器可长期缓存且随优化元数据
                  // 换代失效；未知类型不注入，避免预构建产物引用的外部文件形成重复模块。
                  const versionHash = depsOptimizer!.metadata.browserHash
                  if (versionHash && isJsType) {
                    newId = injectQuery(newId, `v=${versionHash}`)
                  }
                } else {
                  // 新发现依赖登记为 missing import，触发下一轮 optimizeDeps 并立即取得规范产物 id。
                  const optimizedInfo = depsOptimizer!.registerMissingImport(
                    rawId,
                    newId,
                  )
                  newId = depsOptimizer!.getOptimizedDepId(optimizedInfo)
                }
                return newId
              },
          /** 为直接指向 node_modules 的可优化文件补版本；无改动时返回 undefined 保留原生结果。 */
          finalizeOtherSpecifiers: !depsOptimizerEnabled
            ? undefined
            : (resolvedId, rawId) => {
                const depsOptimizer = getDepsOptimizer()
                const newResolvedId = ensureVersionQuery(
                  resolvedId,
                  rawId,
                  options,
                  depsOptimizer,
                )
                return newResolvedId === resolvedId ? undefined : newResolvedId
              },
          /** 按 package imports 规则解析 `#` 子路径，并复用当前解析选项继续定位文件。 */
          resolveSubpathImports(id, importer, isRequire, scan) {
            return resolveSubpathImports(id, importer, {
              ...options,
              isRequire: resolveOptions.isRequire ?? isRequire,
              scan,
            })
          },

          ...(partialEnv.config.command === 'serve' || isJsPluginContainer
            ? {
                /** 把解析器警告按环境日志级别转发，同时保留结构化诊断信息。 */
                async onWarn(msg) {
                  // createIdResolver 的精简容器不运行 buildStart，不能依赖 getEnv()；直接用
                  // PartialEnvironment logger（#22509）。
                  partialEnv.config.logger.warn(`warning: ${msg}`, {
                    clear: true,
                    timestamp: true,
                  })
                },
              }
            : {}),
          ...(debug
            ? {
                /** 把解析器调试消息写入 Vite 调试通道，不污染普通构建输出。 */
                async onDebug(message) {
                  debug(message)
                },
              }
            : {}),
        })
        ;(plugin as Plugin).perEnvironmentWatchChangeDuringDev = true
        return plugin
      },
    ),
  ]
}

/**
 * 开发态依赖优化解析快路径。
 * 在通用 resolver 前识别已优化 URL/文件和裸包 metadata，避免优化重跑期间磁盘文件暂不存在
 * 导致解析失败；未命中时返回空值交给后续原生 resolver。
 */
function optimizerResolvePlugin(
  resolveOptions: ResolvePluginOptionsWithOverrides,
): Plugin {
  const { root, asSrc } = resolveOptions

  return {
    name: 'vite:resolve-dev',
    /** 普通开发打包模型且未禁用优化时启用，实际优化器实例在 resolve 钩子内取得。 */
    applyToEnvironment(environment) {
      return (
        !environment.config.isBundled &&
        !isDepOptimizationDisabled(environment.config.optimizeDeps)
      )
    },
    resolveId: {
      filter: {
        id: {
          exclude: [
            /^\0/,
            /^virtual:/,
            // 排除直接注入 HTML/client 代码的虚拟标识。
            /^\/virtual:/,
            /^__vite-/,
          ],
        },
      },
      /** 从 URL、磁盘 ID 或 metadata 恢复优化路径和当前版本；过期版本在加载阶段检查。 */
      async handler(id, importer, resolveOpts) {
        // createIdResolver 不应隐式使用优化器，所以仍要求调用场景显式开启 optimizeDeps。
        const depsOptimizer =
          resolveOptions.optimizeDeps && this.environment.mode === 'dev'
            ? this.environment.depsOptimizer
            : undefined
        if (!depsOptimizer) {
          return
        }

        const options: InternalResolveOptions = {
          isRequire: resolveOpts.kind === 'require-call',
          ...this.environment.config.resolve,
          ...resolveOptions,
          scan: resolveOpts.scan ?? resolveOptions.scan,
        }
        options.preferRelative ||= importer?.endsWith('.html')

        // 优化依赖重处理期间产物可能尚未落盘，不能依赖普通文件或 /@fs/ 解析；直接从 URL
        // 恢复预期绝对路径。
        if (asSrc && depsOptimizer.isOptimizedDepUrl(id)) {
          const optimizedPath = id.startsWith(FS_PREFIX)
            ? fsPathFromId(id)
            : normalizePath(path.resolve(root, id.slice(1)))
          return optimizedPath
        }

        if (!isDataUrl(id) && !isExternalUrl(id)) {
          if (
            id[0] === '.' ||
            (options.preferRelative && startsWithWordCharRE.test(id))
          ) {
            const basedir = importer ? path.dirname(importer) : root
            const fsPath = path.resolve(basedir, id)
            // 相对路径也可能直接指向优化产物。
            const normalizedFsPath = normalizePath(fsPath)

            if (depsOptimizer.isOptimizedDepFile(normalizedFsPath)) {
              // 文件尚未落盘也返回完整路径；缺版本查询时按 metadata 注入当前 browserHash。
              if (!DEP_VERSION_RE.test(normalizedFsPath)) {
                const browserHash = optimizedDepInfoFromFile(
                  depsOptimizer.metadata,
                  normalizedFsPath,
                )?.browserHash
                if (browserHash) {
                  return injectQuery(normalizedFsPath, `v=${browserHash}`)
                }
              }
              return normalizedFsPath
            }
          }

          // 裸包优先查已优化 metadata；未命中才交给普通 Node 包解析。
          if (bareImportRE.test(id)) {
            let res: string | PartialResolvedId | undefined
            if (
              asSrc &&
              !options.scan &&
              (res = await tryOptimizedResolve(
                depsOptimizer,
                id,
                importer,
                options.preserveSymlinks,
                options.packageCache,
              ))
            ) {
              return res
            }
          }
        }
      },
    },
  }
}

/**
 * 按 importer 最近 package.json 的 `imports` 字段解析 `#alias`，并保留原 query/hash。
 * 相对映射结果要转换成相对 importer 的 specifier，再让主 resolver 继续处理。
 */
function resolveSubpathImports(
  id: string,
  importer: string | undefined,
  options: InternalResolveOptions,
) {
  if (!importer || !id.startsWith(subpathImportsPrefix)) return
  const basedir = path.dirname(importer)
  const pkgData = findNearestPackageData(basedir, options.packageCache)
  if (!pkgData) return

  let { file: idWithoutPostfix, postfix } = splitFileAndPostfix(id.slice(1))
  idWithoutPostfix = '#' + idWithoutPostfix

  let importsPath = resolveExportsOrImports(
    pkgData.data,
    idWithoutPostfix,
    options,
    'imports',
  )

  if (importsPath?.[0] === '.') {
    importsPath = path.relative(basedir, path.join(pkgData.dir, importsPath))

    if (!relativePrefixRE.test(importsPath)) {
      importsPath = `./${importsPath}`
    }
  }

  if (importsPath == null) return
  return importsPath + postfix
}

/**
 * 为直接指向 node_modules 文件的可优化 JS 注入与裸包相同的 browserHash 查询，保证两种导入
 * 形式共享浏览器缓存失效策略。build、scan、Vite 运行时入口不处理。
 */
function ensureVersionQuery(
  resolved: string,
  id: string,
  options: InternalResolveOptions,
  depsOptimizer?: DepsOptimizer,
): string {
  if (
    !options.isBuild &&
    !options.scan &&
    depsOptimizer &&
    !(resolved === normalizedClientEntry || resolved === normalizedEnvEntry)
  ) {
    // resolved 可能经过 realpath 丢失 node_modules 片段，原 id 与结果任一位于 node_modules
    // 都应按依赖处理。
    const isNodeModule = isInNodeModules(id) || isInNodeModules(resolved)

    if (isNodeModule && !DEP_VERSION_RE.test(resolved)) {
      const versionHash = depsOptimizer.metadata.browserHash
      if (versionHash && isOptimizable(resolved, depsOptimizer.options)) {
        resolved = injectQuery(resolved, `v=${versionHash}`)
      }
    }
  }
  return resolved
}

/**
 * 把可能含 query/hash 的文件路径解析为真实文件，保持 postfix 原样拼回。
 * node_modules 允许文件名包含 `#`，需特殊区分文件名 hash 与 URL postfix。
 */
export function tryFsResolve(
  fsPath: string,
  options: InternalResolveOptions,
  tryIndex = true,
  skipPackageJson = false,
): string | undefined {
  // es5-ext 等依赖文件名含 `#`；用户源码不支持这种路径，且 node_modules 文件名不支持 `?`，
  // 因此只在依赖分支判断 `foo#bar?query` 与普通 postfix 的边界。
  const hashIndex = fsPath.indexOf('#')
  if (hashIndex >= 0 && isInNodeModules(fsPath)) {
    const queryIndex = fsPath.indexOf('?')
    // 处理 foo#bar?baz / foo#bar；foo?bar#baz 的 # 明确属于 query 后 postfix。
    if (queryIndex < 0 || queryIndex > hashIndex) {
      const file = queryIndex > hashIndex ? fsPath.slice(0, queryIndex) : fsPath
      const res = tryCleanFsResolve(file, options, tryIndex, skipPackageJson)
      if (res) return res + fsPath.slice(file.length)
    }
  }

  const { file, postfix } = splitFileAndPostfix(fsPath)
  const res = tryCleanFsResolve(file, options, tryIndex, skipPackageJson)
  if (res) return res + postfix
}

/** TypeScript 源码常在 import 中书写的运行时输出扩展名。 */
const knownTsOutputRE = /\.(?:js|mjs|cjs|jsx)$/
/** 判断 specifier 是否可能需要 JS→TS 扩展名回退。 */
const isPossibleTsOutput = (url: string): boolean => knownTsOutputRE.test(url)

/**
 * 在不含 query/hash 的路径上依次尝试：真实文件、JS→TS、配置扩展名、前缀文件、目录
 * package entry、目录 index。所有成功路径按 preserveSymlinks 选择链接路径或 realpath。
 */
function tryCleanFsResolve(
  file: string,
  options: InternalResolveOptions,
  tryIndex = true,
  skipPackageJson = false,
): string | undefined {
  const { tryPrefix, extensions, preserveSymlinks } = options

  // 一次 stat 同时得到“真实文件路径”或“目录”类型，避免重复探测原始路径。
  const fileResult = tryResolveRealFileOrType(file, options.preserveSymlinks)

  if (fileResult?.path) return fileResult.path

  let res: string | undefined

  // 只有父目录真实存在时才组合扩展名/前缀，减少无效 stat。
  const possibleJsToTs = isPossibleTsOutput(file)
  if (possibleJsToTs || options.extensions.length || tryPrefix) {
    const dirPath = path.dirname(file)
    if (isDirectory(dirPath)) {
      if (possibleJsToTs) {
        // 允许源码用运行时扩展名导入 TS：.js→.ts/.tsx，.mjs→.mts，.cjs→.cts，.jsx→.tsx
        // （#18889）。
        const fileExt = path.extname(file)
        const fileName = file.slice(0, -fileExt.length)
        if (
          (res = tryResolveRealFile(
            fileName + fileExt.replace('js', 'ts'),
            preserveSymlinks,
          ))
        )
          return res
        // .js 还可能对应带 JSX 的 .tsx。
        if (
          fileExt === '.js' &&
          (res = tryResolveRealFile(fileName + '.tsx', preserveSymlinks))
        )
          return res
      }

      if (
        (res = tryResolveRealFileWithExtensions(
          file,
          extensions,
          preserveSymlinks,
        ))
      )
        return res

      if (tryPrefix) {
        const prefixed = `${dirPath}/${options.tryPrefix}${path.basename(file)}`

        if ((res = tryResolveRealFile(prefixed, preserveSymlinks))) return res

        if (
          (res = tryResolveRealFileWithExtensions(
            prefixed,
            extensions,
            preserveSymlinks,
          ))
        )
          return res
      }
    }
  }

  if (tryIndex && fileResult?.type === 'directory') {
    // 目录先按 package.json 入口解析，再回退 index；Sass 等场景还可尝试前缀 index。
    const dirPath = file

    if (!skipPackageJson) {
      let pkgPath = `${dirPath}/package.json`
      try {
        if (fs.existsSync(pkgPath)) {
          if (!options.preserveSymlinks) {
            pkgPath = safeRealpathSync(pkgPath)
          }
          // 目录本身是一个 Node package，复用标准 package entry 规则。
          const pkg = loadPackageData(pkgPath)
          return resolvePackageEntry(dirPath, pkg, options)
        }
      } catch (e) {
        // 目录 package entry 探测是尽力行为；入口无效/不存在时继续尝试 index，其他错误上抛。
        if (e.code !== ERR_RESOLVE_PACKAGE_ENTRY_FAIL && e.code !== 'ENOENT')
          throw e
      }
    }

    if (
      (res = tryResolveRealFileWithExtensions(
        `${dirPath}/index`,
        extensions,
        preserveSymlinks,
      ))
    )
      return res

    if (tryPrefix) {
      if (
        (res = tryResolveRealFileWithExtensions(
          `${dirPath}/${options.tryPrefix}index`,
          extensions,
          preserveSymlinks,
        ))
      )
        return res
    }
  }
}

/**
 * 按 Node package 语义解析裸包或 deep import，并叠加 Vite 的 dedupe、自引用、optional peer、
 * external、sideEffects 与开发依赖优化行为。
 */
export function tryNodeResolve(
  id: string,
  importer: string | null | undefined,
  options: InternalResolveOptions,
  depsOptimizer?: DepsOptimizer,
  externalize?: boolean,
): PartialResolvedId | undefined {
  const { root, dedupe, isBuild, preserveSymlinks, packageCache } = options

  // deep import（如 my-lib/foo）先分离顶层包名。
  const deepMatch = deepImportRE.exec(id)
  // 包名不含 query/hash；清理后支持 `normalize.css?inline` 一类裸包资源导入。
  const pkgId = deepMatch ? deepMatch[1] || deepMatch[2] : cleanUrl(id)

  let basedir: string
  if (dedupe.includes(pkgId)) {
    // dedupe 强制从 root 解析，避免 importer 嵌套依赖得到另一份包实例。
    basedir = root
  } else if (
    importer &&
    path.isAbsolute(importer) &&
    // CSS 处理会给 importer 追加 `*` 标记；其余绝对 importer 必须真实存在才作为 basedir。
    (importer.endsWith('*') || fs.existsSync(cleanUrl(importer)))
  ) {
    basedir = path.dirname(importer)
  } else {
    basedir = root
  }

  /** 按当前解析配置判断模块 ID 是否属于应外部化的内建模块。 */
  const isModuleBuiltin = (id: string) => isBuiltin(options.builtins, id)

  let selfPkg = null
  if (!isModuleBuiltin(id) && !id.includes('\0') && bareImportRE.test(id)) {
    // 若最近 package 的 name 与包名相同且声明 exports，优先按 package self-reference 解析
    // （#16068）。
    const selfPackageData = findNearestPackageData(basedir, packageCache)
    selfPkg =
      selfPackageData?.data.exports && selfPackageData.data.name === pkgId
        ? selfPackageData
        : null
  }

  const pkg =
    selfPkg ||
    resolvePackageData(pkgId, basedir, preserveSymlinks, packageCache)
  if (!pkg) {
    // 包缺失时检查 importer 所属主包的 optional peer。返回虚拟 id，让应用只有真正执行该
    // 可选路径时才得到含包名/来源的运行时错误，而不是启动即失败（#20029）。
    if (
      !options.disableOptionalPeerDepHandling &&
      // root 本身没有“上游包的 peer”语义。
      basedir !== root &&
      !isModuleBuiltin(id) &&
      !id.includes('\0') &&
      bareImportRE.test(id)
    ) {
      const mainPkg = findNearestMainPackageData(basedir, packageCache)?.data
      if (mainPkg) {
        const pkgName = getNpmPackageName(id)
        if (
          pkgName != null &&
          mainPkg.peerDependencies?.[pkgName] &&
          mainPkg.peerDependenciesMeta?.[pkgName]?.optional
        ) {
          return {
            id: `${optionalPeerDepId}:${id}:${mainPkg.name}`,
          }
        }
      }
    }
    return
  }

  const resolveId = deepMatch ? resolveDeepImport : resolvePackageEntry
  const unresolvedId = deepMatch ? '.' + id.slice(pkgId.length) : id

  let resolved = resolveId(unresolvedId, pkg, options, externalize)
  if (!resolved) {
    return
  }

  /** build server externalize 时把磁盘结果恢复成运行时可解析 specifier。 */
  const processResult = (resolved: PartialResolvedId) => {
    if (!externalize) {
      return resolved
    }
    if (!canExternalizeFile(resolved.id)) {
      return resolved
    }

    let resolvedId = id
    if (
      deepMatch &&
      !pkg.data.exports &&
      path.extname(id) !== path.extname(resolved.id)
    ) {
      // 例如 id 为 date-fns/locale、磁盘结果为 .../date-fns/esm/locale/index.js；无 exports 的
      // 包需要保留带实际目录映射的包内 specifier，且不能改变扩展名语义。
      const index = resolved.id.indexOf(id)
      if (index > -1) {
        resolvedId = resolved.id.slice(index)
        debug?.(
          `[processResult] ${colors.cyan(id)} -> ${colors.dim(resolvedId)}`,
        )
      }
    }
    return { ...resolved, id: resolvedId, external: true }
  }

  if (!options.idOnly && ((!options.scan && isBuild) || externalize)) {
    // build（或 externalize）补充 sideEffects/packageJsonPath，供 Rolldown tree-shaking 与 CJS
    // 边界判断；idOnly/scan 避免这笔计算。
    return processResult({
      id: resolved,
      moduleSideEffects: pkg.hasSideEffects(resolved),
      packageJsonPath: findNearestPackagePath(
        resolved,
        options.legacyInconsistentCjsInterop,
        options.packageCache,
        isBuild,
      ),
    })
  }

  if (
    // 链接源码不预构建；listen 前还没有 optimizer；初始 scan 只发现依赖，不返回优化产物。
    !isInNodeModules(resolved) ||
    !depsOptimizer ||
    options.scan
  ) {
    return { id: resolved }
  }

  // 到达这里表示 node_modules 依赖已解析，但还需决定直接提供还是登记优化。
  const isJsType = isOptimizable(resolved, depsOptimizer.options)
  const exclude = depsOptimizer.options.exclude

  const skipOptimization =
    depsOptimizer.options.noDiscovery ||
    !isJsType ||
    (importer && isInNodeModules(importer)) ||
    exclude?.includes(pkgId) ||
    exclude?.includes(id) ||
    SPECIAL_QUERY_RE.test(resolved)

  if (skipOptimization) {
    // 不优化的已知 JS 依赖仍加 browserHash 以稳定浏览器缓存；未知类型不加，避免预构建产物
    // 外部文件产生两份模块身份。
    const versionHash = depsOptimizer.metadata.browserHash
    if (versionHash && isJsType) {
      resolved = injectQuery(resolved, `v=${versionHash}`)
    }
  } else {
    // 新发现依赖登记为 missing import，触发 optimizeDeps 重跑并返回其规范产物 id。
    const optimizedInfo = depsOptimizer.registerMissingImport(id, resolved)
    resolved = depsOptimizer.getOptimizedDepId(optimizedInfo)
  }

  return { id: resolved }
}

/**
 * 从 optimizeDeps metadata 解析裸包，包括 `parent > nested` 形式的嵌套依赖。
 * 必须等待首轮 scan，避免 preAlias 在 metadata 未完成时把本应保持裸包的 alias 改成磁盘路径。
 */
export async function tryOptimizedResolve(
  depsOptimizer: DepsOptimizer,
  id: string,
  importer?: string,
  preserveSymlinks?: boolean,
  packageCache?: PackageCache,
): Promise<string | undefined> {
  // TODO：preAlias 仍靠这里判断 alias 后依赖是否已优化；未来若 metadata 可同步可靠查询，
  // 可以移除 scan 等待。
  await depsOptimizer.scanProcessing

  const metadata = depsOptimizer.metadata

  const depInfo = optimizedDepInfoFromId(metadata, id)
  if (depInfo) {
    return depsOptimizer.getOptimizedDepId(depInfo)
  }

  if (!importer) return

  // 顶层 id 未命中时，再检查由嵌套依赖选择器产生的 metadata 项。
  let idPkgDir: string | undefined
  const nestedIdMatch = `> ${id}`

  for (const optimizedData of metadata.depInfoList) {
    // chunk 没有原始包路径，不能用于判断 nested 包归属。
    if (!optimizedData.src) continue

    // 只考虑形如 `my-lib > foo`、后缀为当前 id 的条目。
    if (!optimizedData.id.endsWith(nestedIdMatch)) continue

    // 仅出现候选 nested 条目时才解析 importer 实际依赖的包目录。
    if (idPkgDir == null) {
      const pkgName = getNpmPackageName(id)
      if (!pkgName) break
      idPkgDir = resolvePackageData(
        pkgName,
        importer,
        preserveSymlinks,
        packageCache,
      )?.dir
      // 从 importer 不可解析说明当前 id 不是其依赖，可提前结束。
      if (idPkgDir == null) break
      idPkgDir = normalizePath(idPkgDir)
    }

    // 用真实 src 包目录区分多个父依赖各自嵌套的同名包。
    if (optimizedData.src.startsWith(withTrailingSlash(idPkgDir))) {
      return depsOptimizer.getOptimizedDepId(optimizedData)
    }
  }
}

/**
 * 解析包根入口，优先级为 exports → mainFields → main → Node 默认 index；browser 对象映射在
 * 选定入口后应用。结果按影响选择的 options 缓存，并保留原 query/hash。
 */
export function resolvePackageEntry(
  id: string,
  { dir, data, setResolvedCache, getResolvedCache }: PackageData,
  options: InternalResolveOptions,
  externalize?: boolean,
): string | undefined {
  const { file: idWithoutPostfix, postfix } = splitFileAndPostfix(id)

  const cached = getResolvedCache('.', options)
  if (cached) {
    return cached + postfix
  }

  try {
    let entryPoint: string | undefined

    // exports 是现代包的封装边界，优先级最高；由 resolve.exports 按条件选择：
    // https://github.com/lukeed/resolve.exports
    if (data.exports) {
      entryPoint = resolveExportsOrImports(
        data,
        '.',
        options,
        'exports',
        externalize,
      )
    }

    // exports 未返回入口才查 mainFields；exports 解析抛错会进入外层 catch，不走字段回退。
    if (!entryPoint) {
      for (const field of options.mainFields) {
        if (typeof data[field] === 'string') {
          entryPoint = data[field]
          break
        } else if (field === 'browser') {
          const browser = data[field]
          if (isObject(browser) && browser['.']) {
            entryPoint = browser['.']
            break
          }
        }
      }
    }
    entryPoint ||= data.main

    // 没有任何入口字段时按 Node 默认目录入口尝试。
    // https://nodejs.org/api/modules.html#all-together
    const entryPoints = entryPoint
      ? [entryPoint]
      : ['index.js', 'index.json', 'index.node']

    for (let entry of entryPoints) {
      // Sass resolver 不应在找样式入口时误落到普通 JS package script。
      let skipPackageJson = false
      if (
        options.mainFields[0] === 'sass' &&
        !options.extensions.includes(path.extname(entry))
      ) {
        entry = ''
        skipPackageJson = true
      } else {
        // 根入口这里只采用 browser 字符串映射；false 经 `|| entry` 保留原入口。
        const { browser: browserField } = data
        if (options.mainFields.includes('browser') && isObject(browserField)) {
          entry = mapWithBrowserField(entry, browserField) || entry
        }
      }

      const entryPointPath = path.join(dir, entry)
      const resolvedEntryPoint = tryFsResolve(
        entryPointPath,
        options,
        true,
        skipPackageJson,
      )
      if (resolvedEntryPoint) {
        debug?.(
          `[package entry] ${colors.cyan(idWithoutPostfix)} -> ${colors.dim(
            resolvedEntryPoint,
          )}${postfix !== '' ? ` (postfix: ${postfix})` : ''}`,
        )
        setResolvedCache('.', resolvedEntryPoint, options)
        return resolvedEntryPoint + postfix
      }
    }
  } catch (e) {
    packageEntryFailure(id, e.message)
  }
  packageEntryFailure(id)
}

/** 抛出带稳定 code 的包入口错误，供目录 index 回退逻辑识别。 */
function packageEntryFailure(id: string, details?: string) {
  const err: any = new Error(
    `Failed to resolve entry for package "${id}". ` +
      `The package may have incorrect main/module/exports specified in its package.json` +
      (details ? ': ' + details : '.'),
  )
  err.code = ERR_RESOLVE_PACKAGE_ENTRY_FAIL
  throw err
}

/** 展开 development|production 占位条件，再按本次解析方式追加 import 或 require。 */
function getConditions(
  conditions: string[],
  isProduction: boolean,
  isRequire: boolean | undefined,
) {
  const resolvedConditions = conditions.map((condition) => {
    if (condition === DEV_PROD_CONDITION) {
      return isProduction ? 'production' : 'development'
    }
    return condition
  })

  if (isRequire) {
    resolvedConditions.push('require')
  } else {
    resolvedConditions.push('import')
  }

  return resolvedConditions
}

/** 按内部/外部条件集调用 resolve.exports 的 imports 或 exports 解析。 */
function resolveExportsOrImports(
  pkg: PackageData['data'],
  key: string,
  options: InternalResolveOptions,
  type: 'imports' | 'exports',
  externalize?: boolean,
) {
  const conditions = getConditions(
    externalize ? options.externalConditions : options.conditions,
    options.isProduction,
    options.isRequire,
  )

  const fn = type === 'imports' ? imports : exports
  const result = fn(pkg, key, { conditions, unsafe: true })
  return result ? result[0] : undefined
}

/**
 * 解析 `pkg/subpath`：有 exports 时严格遵守公开子路径；否则可按 browser map 后落到文件系统。
 * exports 存在时禁止隐式目录 index，保持包封装边界。
 */
function resolveDeepImport(
  id: string,
  { setResolvedCache, getResolvedCache, dir, data }: PackageData,
  options: InternalResolveOptions,
  externalize?: boolean,
): string | undefined {
  const cache = getResolvedCache(id, options)
  if (cache) {
    return cache
  }

  let relativeId: string | undefined | void = id
  const { exports: exportsField, browser: browserField } = data

  // exports 存在时必须先映射公开子路径，不能直接拼磁盘路径。
  if (exportsField) {
    if (isObject(exportsField) && !Array.isArray(exportsField)) {
      // query/hash 不参与 exports key 匹配，解析后再拼回（#7098）。
      const { file, postfix } = splitFileAndPostfix(relativeId)
      const exportsId = resolveExportsOrImports(
        data,
        file,
        options,
        'exports',
        externalize,
      )
      if (exportsId !== undefined) {
        relativeId = exportsId + postfix
      } else {
        relativeId = undefined
      }
    } else {
      // 非对象 exports 没有可匹配的 deep subpath。
      relativeId = undefined
    }
    if (!relativeId) {
      throw new Error(
        `Package subpath '${relativeId}' is not defined by "exports" in ` +
          `${path.join(dir, 'package.json')}.`,
      )
    }
  } else if (options.mainFields.includes('browser') && isObject(browserField)) {
    // browser map 同样只匹配文件部分，postfix 最后拼回（#7098）。
    const { file, postfix } = splitFileAndPostfix(relativeId)
    const mapped = mapWithBrowserField(file, browserField)
    if (mapped) {
      relativeId = mapped + postfix
    } else if (mapped === false) {
      setResolvedCache(id, browserExternalId, options)
      return browserExternalId
    }
  }

  if (relativeId) {
    const resolved = tryFsResolve(
      path.join(dir, relativeId),
      options,
      // 有 exports 时不得绕过它隐式尝试目录 index。
      !exportsField,
    )
    if (resolved) {
      debug?.(
        `[node/deep-import] ${colors.cyan(id)} -> ${colors.dim(resolved)}`,
      )
      setResolvedCache(id, resolved, options)
      return resolved
    }
  }
}

/**
 * 用 package.json browser 对象映射包内相对路径。
 *
 * 返回 undefined 表示无匹配；false 表示该模块在浏览器端明确忽略；字符串是替换路径。
 */
function mapWithBrowserField(
  relativePathInPkgDir: string,
  map: Record<string, string | false>,
): string | false | undefined {
  const normalizedPath = path.posix.normalize(relativePathInPkgDir)

  for (const key in map) {
    const normalizedKey = path.posix.normalize(key)
    if (
      normalizedPath === normalizedKey ||
      equalWithoutSuffix(normalizedPath, normalizedKey, '.js') ||
      equalWithoutSuffix(normalizedPath, normalizedKey, '/index.js')
    ) {
      return map[key]
    }
  }
}

/** 允许 browser key 的 `.js` 或 `/index.js` 后缀与省略后缀的请求相等。 */
function equalWithoutSuffix(path: string, key: string, suffix: string) {
  return key.endsWith(suffix) && key.slice(0, -suffix.length) === path
}

/** 确认路径是真实文件，并按 preserveSymlinks 返回链接路径或规范 realpath。 */
function tryResolveRealFile(
  file: string,
  preserveSymlinks?: boolean,
): string | undefined {
  const stat = tryStatSync(file)
  if (stat?.isFile()) return getRealPath(file, preserveSymlinks)
}

/** 按配置顺序给路径追加扩展名，返回首个真实文件。 */
function tryResolveRealFileWithExtensions(
  filePath: string,
  extensions: string[],
  preserveSymlinks?: boolean,
): string | undefined {
  for (const ext of extensions) {
    const res = tryResolveRealFile(filePath + ext, preserveSymlinks)
    if (res) return res
  }
}

/** 一次 stat 区分文件、目录与不存在；文件同时返回最终规范路径。 */
function tryResolveRealFileOrType(
  file: string,
  preserveSymlinks?: boolean,
):
  | {
      /** 目标为文件时返回遵循 preserveSymlinks 配置的规范路径。 */
      path?: string
      /** 区分调用方应继续查找目录入口还是直接使用文件。 */
      type: 'directory' | 'file'
    }
  | undefined {
  const fileStat = tryStatSync(file)
  if (fileStat?.isFile()) {
    return { path: getRealPath(file, preserveSymlinks), type: 'file' }
  }
  if (fileStat?.isDirectory()) {
    return { type: 'directory' }
  }
  return
}

/** 根据 preserveSymlinks 决定是否 realpath，并统一为 POSIX 分隔符。 */
function getRealPath(resolved: string, preserveSymlinks?: boolean): string {
  if (!preserveSymlinks) {
    resolved = safeRealpathSync(resolved)
  }
  return normalizePath(resolved)
}

/** 不抛错判断路径是否为目录。 */
function isDirectory(path: string): boolean {
  const stat = tryStatSync(path)
  return stat?.isDirectory() ?? false
}

/** build 时返回模块所属 package.json，供 Rolldown CJS interop 决策；旧兼容模式跳过。 */
function findNearestPackagePath(
  file: string,
  legacyInconsistentCjsInterop: boolean | undefined,
  packageCache: PackageCache | undefined,
  isBuild: boolean,
) {
  if (!isBuild || legacyInconsistentCjsInterop) return
  const pkgData = findNearestPackageData(file, packageCache)
  return pkgData ? path.join(pkgData.dir, 'package.json') : null
}
