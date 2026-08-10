import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import { ignoreInput, ignoreOutput } from '@voidzero-dev/vite-task-client'
import colors from 'picocolors'
import { init, parse } from 'es-module-lexer'
import { isDynamicPattern } from 'tinyglobby'
import {
  type RolldownOptions,
  type RolldownOutput,
  type OutputOptions as RolldownOutputOptions,
  rolldown,
} from 'rolldown'
import type { DepsOptimizerEsbuildOptions } from '#types/internal/esbuildOptions'
import type { ResolvedConfig } from '../config'
import {
  arraify,
  asyncFlatten,
  createDebugger,
  flattenId,
  getHash,
  isOptimizable,
  lookupFile,
  normalizeId,
  normalizePath,
  removeLeadingSlash,
  tryStatSync,
  unique,
} from '../utils'
import {
  ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET,
  METADATA_FILENAME,
} from '../constants'
import { isWindows } from '../../shared/utils'
import type { Environment } from '../environment'
import { transformWithOxc } from '../plugins/oxc'
import { ScanEnvironment, scanImports } from './scan'
import { createOptimizeDepsIncludeResolver, expandGlobIds } from './resolve'
import {
  rolldownCjsExternalPlugin,
  rolldownDepPlugin,
} from './rolldownDepPlugin'

/** `DEBUG=vite:deps` 启用的发现、打包、缓存提交诊断。 */
const debug = createDebugger('vite:deps')

/** 判断优化产物是否使用标准 `.js` 扩展名。 */
const jsExtensionRE = /\.js$/i

/** 依赖入口经 ESM lexer/转换后得到的导出形状。 */
export type ExportsData = {
  /** lexer 是否发现 ESM 语法；false 通常表示 CJS/UMD，需要 interop。 */
  hasModuleSyntax: boolean
  /** 导出名；`export { a as b }` 记录 `b`。 */
  exports: readonly string[]
  /** 入口需用 JSX loader 才能解析的提示。 */
  jsxLoader?: boolean
}

/** 单个 Environment 的依赖优化器公开协议。 */
export interface DepsOptimizer {
  /** 启动缓存读取、扫描与首轮优化。 */
  init: () => Promise<void>

  /** 当前已提交、待处理与内部 chunk 的共享状态快照。 */
  metadata: DepOptimizationMetadata
  /** 首轮 scanner 尚未完成时的等待 Promise。 */
  scanProcessing?: Promise<void>
  /** 运行期发现 scanner 漏掉的依赖，并返回可立即用于 resolve 的待处理元数据。 */
  registerMissingImport: (id: string, resolved: string) => OptimizedDepInfo
  /** 通知首轮模块 crawl 结束，允许提交或重跑。 */
  run: () => void

  /** 判断 resolved ID 是否位于任一 Environment 的优化缓存目录。 */
  isOptimizedDepFile: (id: string) => boolean
  /** 判断浏览器 URL 是否指向当前 Environment 的优化缓存。 */
  isOptimizedDepUrl: (url: string) => boolean
  /** 给优化文件路径附加 browserHash，形成浏览器请求 ID。 */
  getOptimizedDepId: (depInfo: OptimizedDepInfo) => string

  /** 取消 scanner/构建并等待后台任务结束。 */
  close: () => Promise<void>

  /** 当前 Environment 已解析的 optimizeDeps 选项。 */
  options: DepOptimizationOptions
}

/** 用户可配置的依赖发现、预构建、缓存发布与互操作策略。 */
export interface DepOptimizationConfig {
  /**
   * 强制优化列出的依赖；路径必须可解析。Vite 也会展开这里的 glob include。
   */
  include?: string[]
  /**
   * 不优化这些依赖；必须是可解析 import 路径。
   */
  exclude?: string[]
  /**
   * 强制这些依赖使用 ESM 互操作。有些旧包声称是 ESM，内部却使用 require。
   * @experimental
   */
  needsInterop?: string[]
  /**
   * 传给旧 esbuild 扫描/优化兼容层的选项。与 Vite 协议冲突的选项被省略：external 请改用
   * optimizeDeps.exclude，plugins 会与 Vite 依赖插件合并。
   *
   * https://esbuild.github.io/api
   *
   * @deprecated 请改用 `rolldownOptions`。
   */
  esbuildOptions?: DepsOptimizerEsbuildOptions
  /**
   * @deprecated 请改用 `rolldownOptions`。
   */
  rollupOptions?: Omit<RolldownOptions, 'input' | 'logLevel' | 'output'> & {
    /** 旧 Rollup 兼容输出选项；格式、目录与 sourcemap 由优化器掌控。 */
    output?: Omit<
      RolldownOutputOptions,
      'format' | 'sourcemap' | 'dir' | 'banner'
    >
  }
  /**
   * 传给 Rolldown 扫描/优化的选项；与 Vite 协议冲突的选项被省略，plugins 与内置依赖插件合并。
   */
  rolldownOptions?: Omit<RolldownOptions, 'input' | 'logLevel' | 'output'> & {
    /** 优化器允许用户覆写的输出选项子集。 */
    output?: Omit<
      RolldownOutputOptions,
      'format' | 'sourcemap' | 'dir' | 'banner'
    >
  }
  /**
   * 可优化的额外扩展名；必须有相应插件/模块类型把它转换为 JS。默认支持 mjs/js/ts/mts。
   *
   * @experimental
   */
  extensions?: string[]
  /**
   * Vite 5.1 已移除构建态依赖优化，本选项将删除。改用 noDiscovery 且 include 为空来禁用；
   * true/'dev' 禁用开发优化器，false/'build' 仍启用。
   * @default 'build'
   * @deprecated
   * @experimental
   */
  disabled?: boolean | 'build' | 'dev'
  /**
   * 是否关闭自动依赖发现。true 时冷启动不运行 scanner，只优化 include；纯 CJS 依赖必须显式列出。
   * @default false
   */
  noDiscovery?: boolean
  /**
   * 首轮是否等静态 import crawl 结束再提交。可避免漏扫依赖改变 common chunk 后 full reload；若
   * scanner + include 足够完整，关闭可让浏览器更早并行处理优化产物。
   * @default true
   * @experimental
   */
  holdUntilCrawlEnd?: boolean
  /**
   * 是否容忍旧优化产物请求。开启可能让同一逻辑模块出现多个 URL/引用，默认应让浏览器 reload。
   * @default false
   * @experimental
   */
  ignoreOutdatedRequests?: boolean
}

/** 完整依赖优化配置，在公共选项上增加入口覆盖与强制重建控制。 */
export type DepOptimizationOptions = DepOptimizationConfig & {
  /**
   * 自定义 scanner 入口。默认扫描 index.html；若配置 build.rolldownOptions.input 则扫描它。
   * 本项可用相对 root 的 tinyglobby pattern 覆盖默认推断。
   * @see https://github.com/SuperchupuDev/tinyglobby
   */
  entries?: string | string[]
  /**
   * 无论依赖/配置哈希是否变化都强制重新预构建。
   * @experimental
   */
  force?: boolean
}

/** 兼容旧 disabled，并把“noDiscovery + 空 include”视为完整禁用。 */
export function isDepOptimizationDisabled(
  optimizeDeps: DepOptimizationOptions,
): boolean {
  return (
    optimizeDeps.disabled === true ||
    optimizeDeps.disabled === 'dev' ||
    (!!optimizeDeps.noDiscovery && !optimizeDeps.include?.length)
  )
}

/** 一轮写入独立 processing 目录后的可提交或可取消结果。 */
export interface DepOptimizationResult {
  /** 本轮在 processing 目录中生成的新元数据。 */
  metadata: DepOptimizationMetadata
  /**
   * 原子发布临时目录；重跑期间若又发现依赖，可先丢弃本轮而不污染正式缓存。
   */
  commit: () => Promise<void>
  /** 放弃本轮并删除唯一临时目录。 */
  cancel: () => void
}

/** 一个依赖入口或输出 chunk 在发现、处理、提交各阶段共享的状态。 */
export interface OptimizedDepInfo {
  /** 规范依赖 ID，如 react 或嵌套 include 的 `foo > bar`。 */
  id: string
  /** 最终缓存文件路径；discovered 阶段即能提前确定。 */
  file: string
  /** 原始入口文件；非入口 chunk 没有。 */
  src?: string
  /** Import Analysis 是否需补 CJS named/default 互操作。 */
  needsInterop?: boolean
  /** 浏览器 URL 版本，依赖集合/配置变化时换代。 */
  browserHash?: string
  /** 入口 chunk 稳定性 hash，主要包含其 imports 图。 */
  fileHash?: string
  /**
   * 优化未落盘时 ID 已可解析到最终路径；消费者必须等待该 Promise 后再读文件。
   */
  processing?: Promise<void>
  /**
   * 入口导出分析 Promise；发现阶段启动，既用于判断 interop，也用于预构建 loader 选择。
   */
  exportsData?: Promise<ExportsData>
  /** 该非入口 chunk 是否由依赖内部动态 import 产生。 */
  isDynamicEntry?: boolean
}

/** 磁盘 `_metadata.json` 与运行时请求等待协议共享的优化状态。 */
export interface DepOptimizationMetadata {
  /**
   * 配置 + lockfile 主 hash；启动时一致即可复用磁盘缓存。
   */
  hash: string
  /**
   * lockfile/patch 相关 hash，用于给出具体重优化原因。
   */
  lockfileHash: string
  /**
   * 会影响预构建输出的配置 hash。
   */
  configHash: string
  /**
   * 主 hash + 本轮依赖集合 + 可选时间戳；作为 `?v=` 使浏览器旧请求失效。
   */
  browserHash: string
  /**
   * 已成功生成的入口依赖。
   */
  optimized: Record<string, OptimizedDepInfo>
  /**
   * 非入口共享 chunk 与依赖内部动态入口。
   */
  chunks: Record<string, OptimizedDepInfo>
  /**
   * 运行时已发现但尚未提交优化的入口。
   */
  discovered: Record<string, OptimizedDepInfo>
  /**
   * optimized/discovered/chunks 的统一列表，支持按输出 file 反查。
   */
  depInfoList: OptimizedDepInfo[]
}

/**
 * 手动扫描并优化项目依赖，供旧 `vite optimize`/API 使用。
 * @deprecated 开发服务器会自动完成，不应手动调用。
 */
export async function optimizeDeps(
  config: ResolvedConfig,
  force: boolean | undefined = config.optimizeDeps.force,
  asCommand = false,
): Promise<DepOptimizationMetadata> {
  const log = asCommand ? config.logger.info : debug

  config.logger.warn(
    colors.yellow(
      'manually calling optimizeDeps is deprecated. This is done automatically and does not need to be called manually.',
    ),
  )

  const environment = new ScanEnvironment('client', config)
  await environment.init()

  const cachedMetadata = await loadCachedDepOptimizationMetadata(
    environment,
    force,
    asCommand,
  )
  if (cachedMetadata) {
    return cachedMetadata
  }

  const deps = await discoverProjectDependencies(environment).result

  await addManuallyIncludedOptimizeDeps(environment, deps)

  const depsString = depsLogString(Object.keys(deps))
  log?.(colors.green(`Optimizing dependencies:\n  ${depsString}`))

  const depsInfo = toDiscoveredDependencies(environment, deps)

  const result = await runOptimizeDeps(environment, depsInfo).result

  await result.commit()

  return result.metadata
}

/** noDiscovery/显式场景只解析 include，并复用缓存/原子提交协议。 */
export async function optimizeExplicitEnvironmentDeps(
  environment: Environment,
): Promise<DepOptimizationMetadata> {
  const cachedMetadata = await loadCachedDepOptimizationMetadata(
    environment,
    environment.config.optimizeDeps.force ?? false,
    false,
  )
  if (cachedMetadata) {
    return cachedMetadata
  }

  const deps: Record<string, string> = {}

  await addManuallyIncludedOptimizeDeps(environment, deps)

  const depsInfo = toDiscoveredDependencies(environment, deps)

  const result = await runOptimizeDeps(environment, depsInfo).result

  await result.commit()

  return result.metadata
}

/** 按当前 Environment 配置/lockfile 建立空元数据与初始 browserHash。 */
export function initDepsOptimizerMetadata(
  environment: Environment,
  timestamp?: string,
): DepOptimizationMetadata {
  const { lockfileHash, configHash, hash } = getDepHash(environment)
  return {
    hash,
    lockfileHash,
    configHash,
    browserHash: getOptimizedBrowserHash(hash, {}, timestamp),
    optimized: {},
    chunks: {},
    discovered: {},
    depInfoList: [],
  }
}

/** 同时写入分类 record 与统一 depInfoList，保证按 ID/文件两种查找一致。 */
export function addOptimizedDepInfo(
  metadata: DepOptimizationMetadata,
  type: 'optimized' | 'discovered' | 'chunks',
  depInfo: OptimizedDepInfo,
): OptimizedDepInfo {
  metadata[type][depInfo.id] = depInfo
  metadata.depInfoList.push(depInfo)
  return depInfo
}

let firstLoadCachedDepOptimizationMetadata = true

/**
 * 尝试从 deps cache 加载初始元数据。只有 lockfileHash/configHash 均匹配且未 force 才复用；否则
 * 删除旧正式目录，让新一轮从干净状态开始。首次调用还异步清理进程异常遗留的旧临时目录。
 */
export async function loadCachedDepOptimizationMetadata(
  environment: Environment,
  force: boolean = environment.config.optimizeDeps.force ?? false,
  asCommand = false,
): Promise<DepOptimizationMetadata | undefined> {
  const log = asCommand ? environment.logger.info : debug

  if (firstLoadCachedDepOptimizationMetadata) {
    firstLoadCachedDepOptimizationMetadata = false
    // 异步清理旧进程异常退出留下的 processing 目录，不阻塞当前冷启动。
    setTimeout(
      () => cleanupDepsCacheStaleDirs(environment.getTopLevelConfig()),
      0,
    ).unref()
  }

  const depsCacheDir = getDepsCacheDir(environment)

  // Vite Task 中此目录既读又写（元数据 + 预构建产物），但它是进程本地 scratch cache，不是构建
  // 输入/输出；是否重优化已由 metadata 内 lockfile hash 决定。
  ignoreInput(depsCacheDir)
  ignoreOutput(depsCacheDir)

  if (!force) {
    let cachedMetadata: DepOptimizationMetadata | undefined
    try {
      const cachedMetadataPath = path.join(depsCacheDir, METADATA_FILENAME)
      cachedMetadata = parseDepsOptimizerMetadata(
        await fsp.readFile(cachedMetadataPath, 'utf-8'),
        depsCacheDir,
      )
    } catch {}
    // 元数据格式有效后分别比较两类 hash，日志可说明具体失效原因。
    if (cachedMetadata) {
      if (cachedMetadata.lockfileHash !== getLockfileHash(environment)) {
        environment.logger.info(
          'Re-optimizing dependencies because lockfile has changed',
          {
            timestamp: true,
          },
        )
      } else if (cachedMetadata.configHash !== getConfigHash(environment)) {
        environment.logger.info(
          'Re-optimizing dependencies because vite config has changed',
          {
            timestamp: true,
          },
        )
      } else {
        log?.(
          `(${environment.name}) Hash is consistent. Skipping. Use --force to override.`,
        )
        // 复用缓存无需 commit/cancel；调用方只需让请求等待协议进入已完成状态。
        return cachedMetadata
      }
    }
  } else {
    environment.logger.info('Forced re-optimization of dependencies', {
      timestamp: true,
    })
  }

  // hash 不一致或 force：删除正式旧缓存，后续在独立 processing 目录重建。
  debug?.(
    `(${environment.name}) ${colors.green(`removing old cache dir ${depsCacheDir}`)}`,
  )
  await fsp.rm(depsCacheDir, { recursive: true, force: true })
}

/** 冷启动快速扫描入口 imports；统一汇总无法 resolve 的依赖，再返回可优化裸依赖映射。 */
export function discoverProjectDependencies(environment: ScanEnvironment): {
  /** 取消仍在运行的 scanner，并等待其关闭。 */
  cancel: () => Promise<void>
  /** scanner 完成后的可优化依赖映射；缺失依赖会统一拒绝。 */
  result: Promise<Record<string, string>>
} {
  const { cancel, result } = scanImports(environment)

  return {
    cancel,
    result: result.then(({ deps, missing }) => {
      const missingIds = Object.keys(missing)
      if (missingIds.length) {
        throw new Error(
          `The following dependencies are imported but could not be resolved:\n\n  ${missingIds
            .map(
              (id) =>
                `${colors.cyan(id)} ${colors.white(
                  colors.dim(`(imported by ${missing[id]})`),
                )}`,
            )
            .join(`\n  `)}\n\nAre they installed?`,
        )
      }

      return deps
    }),
  }
}

/**
 * 把 `id → src` 发现结果转成待处理 OptimizedDepInfo，并立即启动导出分析 Promise。所有入口共享按
 * 当前完整依赖集合计算的 browserHash。
 */
export function toDiscoveredDependencies(
  environment: Environment,
  deps: Record<string, string>,
  timestamp?: string,
): Record<string, OptimizedDepInfo> {
  const browserHash = getOptimizedBrowserHash(
    getDepHash(environment).hash,
    deps,
    timestamp,
  )
  const discovered: Record<string, OptimizedDepInfo> = {}
  for (const id in deps) {
    const src = deps[id]
    discovered[id] = {
      id,
      file: getOptimizedDepPath(environment, id),
      src,
      browserHash: browserHash,
      exportsData: extractExportsData(environment, src),
    }
  }
  return discovered
}

/** 统一依赖列表日志颜色/格式。 */
export function depsLogString(qualifiedIds: string[]): string {
  return colors.yellow(qualifiedIds.join(`, `))
}

/**
 * 在唯一 processing 目录准备一轮 Rolldown 预构建，并立即返回 cancel/result。服务器可先拿到
 * discovered 元数据启动；真正读取某入口时等待其 processing，最后由调度器决定 commit 或丢弃。
 */
export function runOptimizeDeps(
  environment: Environment,
  depsInfo: Record<string, OptimizedDepInfo>,
): {
  /** 取消 Rolldown context 并删除本轮 processing 目录。 */
  cancel: () => Promise<void>
  /** 本轮可提交结果；构建失败时拒绝。 */
  result: Promise<DepOptimizationResult>
} {
  const optimizerContext = { cancelled: false }

  const depsCacheDir = getDepsCacheDir(environment)
  const processingCacheDir = getProcessingDepsCacheDir(environment)

  // 每轮写唯一临时目录；处理完成前不动正式缓存，失败/取消不会留下半写状态。
  fs.mkdirSync(processingCacheDir, { recursive: true })

  // 用局部 package.json 明确所有预构建 `.js` 产物是 ESM。
  debug?.(colors.green(`creating package.json in ${processingCacheDir}`))
  fs.writeFileSync(
    path.resolve(processingCacheDir, 'package.json'),
    `{\n  "type": "module"\n}\n`,
  )

  const metadata = initDepsOptimizerMetadata(environment)

  metadata.browserHash = getOptimizedBrowserHash(
    metadata.hash,
    depsFromOptimizedDepInfo(depsInfo),
  )

  // 预构建后台执行；需要读缓存文件的请求按 depInfo.processing 等待，不必阻塞整个 server 启动。

  const qualifiedIds = Object.keys(depsInfo)
  let cleaned = false
  let committed = false
  /** 幂等删除尚未提交的 processing 目录。 */
  const cleanUp = () => {
    // commit 一旦开始就忽略迟到 cancel，避免提交途中删除新目录导致正式缓存损坏。
    if (!cleaned && !committed) {
      cleaned = true
      // 临时目录每轮唯一，可后台清理，不与新一轮竞争。
      debug?.(colors.green(`removing cache dir ${processingCacheDir}`))
      try {
        // 进程退出阶段异步 rm 可能来不及执行，使用同步删除尽量收尾。
        fs.rmSync(processingCacheDir, { recursive: true, force: true })
      } catch {
        // 清理失败不覆盖原优化错误；下次启动会清理超过 24 小时的遗留目录。
      }
    }
  }

  const successfulResult: DepOptimizationResult = {
    metadata,
    cancel: cleanUp,
    commit: async () => {
      if (cleaned) {
        throw new Error(
          'Can not commit a Deps Optimization run as it was cancelled',
        )
      }
      // 从此刻屏蔽 cleanup，保证临时目录活到正式换代完成。
      committed = true

      // 元数据中的 file 路径按最终 cache dir 序列化；写完后再发布整个 processing 目录。
      const dataPath = path.join(processingCacheDir, METADATA_FILENAME)
      debug?.(
        colors.green(`creating ${METADATA_FILENAME} in ${processingCacheDir}`),
      )
      fs.writeFileSync(
        dataPath,
        stringifyDepsOptimizerMetadata(metadata, depsCacheDir),
      )

      // 用“旧正式目录 → 备份，新 processing → 正式目录”两次 rename，最小化缓存不可用窗口；比
      // delete+rename 更安全。POSIX 同步 rename 对本线程原子，Windows 用带重试/落地检查的 safeRename。
      const temporaryPath = depsCacheDir + getTempSuffix()
      const depsCacheDirPresent = fs.existsSync(depsCacheDir)
      if (isWindows) {
        if (depsCacheDirPresent) {
          debug?.(colors.green(`renaming ${depsCacheDir} to ${temporaryPath}`))
          await safeRename(depsCacheDir, temporaryPath)
        }
        debug?.(
          colors.green(`renaming ${processingCacheDir} to ${depsCacheDir}`),
        )
        await safeRename(processingCacheDir, depsCacheDir)
      } else {
        if (depsCacheDirPresent) {
          debug?.(colors.green(`renaming ${depsCacheDir} to ${temporaryPath}`))
          fs.renameSync(depsCacheDir, temporaryPath)
        }
        debug?.(
          colors.green(`renaming ${processingCacheDir} to ${depsCacheDir}`),
        )
        fs.renameSync(processingCacheDir, depsCacheDir)
      }

      // 新缓存发布成功后，旧备份可后台删除。
      if (depsCacheDirPresent) {
        debug?.(colors.green(`removing cache temp dir ${temporaryPath}`))
        fsp.rm(temporaryPath, { recursive: true, force: true })
      }
    },
  }

  if (!qualifiedIds.length) {
    // 零依赖也提交空目录/元数据：清掉可能存在的旧产物，并让下次 hash 一致时跳过扫描。
    return {
      cancel: async () => cleanUp(),
      result: Promise.resolve(successfulResult),
    }
  }

  const cancelledResult: DepOptimizationResult = {
    metadata,
    commit: async () => cleanUp(),
    cancel: cleanUp,
  }

  const start = performance.now()

  const bundleTimer = setTimeout(() => {
    environment.logger.info('[optimizer] bundling dependencies...', {
      timestamp: true,
    })
  }, 1000)

  const preparedRun = prepareRolldownOptimizerRun(
    environment,
    depsInfo,
    processingCacheDir,
    optimizerContext,
  )

  const runResult = preparedRun.then(({ context, idToExports }) => {
    if (!context || optimizerContext.cancelled) {
      clearTimeout(bundleTimer)
      return cancelledResult
    }

    return context
      .build()
      .then((result) => {
        const depForEntryFileName: Record<string, OptimizedDepInfo> = {}
        for (const dep of Object.values(depsInfo)) {
          const entryFileName = flattenId(dep.id) + '.js'
          depForEntryFileName[entryFileName] = dep
        }

        for (const chunk of result.output) {
          if (chunk.type !== 'chunk') continue

          if (chunk.isEntry) {
            const { exportsData, file, id, ...info } =
              depForEntryFileName[chunk.fileName]
            addOptimizedDepInfo(metadata, 'optimized', {
              id,
              file,
              ...info,
              // 稳定性主要由 chunk.imports 决定；再混入主 hash 与文件路径，获得可扩展的唯一 fileHash。
              fileHash: getHash(
                metadata.hash + file + JSON.stringify(chunk.imports),
              ),
              browserHash: metadata.browserHash,
              // 打包后可比较输入/输出 exports，识别需手动 needsInterop 的遗留包。
              needsInterop: needsInterop(
                environment,
                id,
                idToExports[id],
                chunk,
              ),
            })
          } else {
            const id = chunk.fileName.replace(jsExtensionRE, '')
            const file = normalizePath(
              path.resolve(getDepsCacheDir(environment), chunk.fileName),
            )
            if (
              !findOptimizedDepInfoInRecord(
                metadata.optimized,
                (depInfo) => depInfo.file === file,
              )
            ) {
              addOptimizedDepInfo(metadata, 'chunks', {
                id,
                file,
                needsInterop: false,
                browserHash: metadata.browserHash,
                isDynamicEntry: chunk.isDynamicEntry,
              })
            }
          }
        }

        clearTimeout(bundleTimer)

        debug?.(
          `Dependencies bundled in ${(performance.now() - start).toFixed(2)}ms`,
        )

        return successfulResult
      })

      .catch((e) => {
        clearTimeout(bundleTimer)
        if (e.errors && e.message.includes('The build was canceled')) {
          // Rolldown cancel 会以 build error 结束；这是正常控制流，转成 cancelledResult。
          return cancelledResult
        }
        const prependMessage = colors.red(
          'Error during dependency optimization:\n\n',
        )
        e.message = prependMessage + e.message
        throw e
      })
  })

  runResult.catch(() => {
    cleanUp()
  })

  return {
    /** 标记取消、停止 Rolldown context，并清理临时目录。 */
    async cancel() {
      optimizerContext.cancelled = true
      const { context } = await preparedRun
      context?.cancel()
      cleanUp()
    },
    result: runResult,
  }
}

/**
 * 分析入口 exports、扁平化输入 ID、合并用户/内置插件，并创建可延后 build 的 Rolldown 上下文。
 */
async function prepareRolldownOptimizerRun(
  environment: Environment,
  depsInfo: Record<string, OptimizedDepInfo>,
  processingCacheDir: string,
  optimizerContext: {
    /** 上游是否已在准备阶段请求取消。 */
    cancelled: boolean
  },
): Promise<{
  /** 可延后执行并可取消的 Rolldown 构建上下文。 */
  context?: {
    /** 写入 processing 目录并返回输出图。 */
    build: () => Promise<RolldownOutput>
    /** 阻止尚未发布的构建结果继续写入。 */
    cancel: () => void
  }
  /** 原始依赖 ID 到入口导出形状的映射。 */
  idToExports: Record<string, ExportsData>
}> {
  // 扁平化所有入口 ID 并由依赖插件以虚拟入口读取，避免打包器按最低共同祖先生成不可预测嵌套目录，
  // 从而保持 `id → [name].js` 映射稳定。
  const flatIdDeps: Record<string, string> = {}
  const idToExports: Record<string, ExportsData> = {}

  const { optimizeDeps } = environment.config

  const { plugins: pluginsFromConfig = [], ...rolldownOptions } =
    optimizeDeps.rolldownOptions ?? {}

  let jsxLoader = false
  await Promise.all(
    Object.keys(depsInfo).map(async (id) => {
      const src = depsInfo[id].src!
      const exportsData = await (depsInfo[id].exportsData ??
        extractExportsData(environment, src))
      if (exportsData.jsxLoader) {
        // 任一入口需 JSX 时把 `.js` 默认 moduleType 改为 jsx，兼容 Gatsby 等包。
        jsxLoader = true
      }
      const flatId = flattenId(id)
      flatIdDeps[flatId] = isWindows ? src.replaceAll('/', '\\') : src
      idToExports[id] = exportsData
    }),
  )

  if (optimizerContext.cancelled) return { context: undefined, idToExports }

  const define = {
    'process.env.NODE_ENV': environment.config.keepProcessEnv
      ? // 即使 keepProcessEnv，也显式保持该表达式，避免 browser platform 自动替换。
        'process.env.NODE_ENV'
      : JSON.stringify(process.env.NODE_ENV || environment.config.mode),
    ...rolldownOptions.transform?.define,
  }

  const platform =
    optimizeDeps.rolldownOptions?.platform ??
    // 不用 neutral：browser/node platform 还有 mainFields/conditions 无法完整模拟的内建处理。
    (environment.config.consumer === 'client' ||
    environment.config.ssr.target === 'webworker'
      ? 'browser'
      : 'node')

  const external = [...(optimizeDeps.exclude ?? [])]

  const plugins = await asyncFlatten(arraify(pluginsFromConfig))
  if (external.length) {
    plugins.push(rolldownCjsExternalPlugin(external, platform))
  }
  plugins.push(...rolldownDepPlugin(environment, flatIdDeps, external))

  let canceled = false
  /** 创建 Rolldown bundle、写入固定 ESM 产物，并始终关闭 context。 */
  async function build() {
    const bundle = await rolldown({
      ...rolldownOptions,
      input: flatIdDeps,
      logLevel: 'silent',
      plugins,
      platform,
      transform: {
        target: ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET,
        ...rolldownOptions.transform,
        define,
      },
      resolve: {
        extensions: ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'],
        ...rolldownOptions.resolve,
      },
      // TODO：Rolldown CSS 支持接入优化器后移除此 JS 占位 moduleType。
      moduleTypes: {
        '.css': 'js',
        ...rolldownOptions.moduleTypes,
        ...(jsxLoader ? { '.js': 'jsx' } : {}),
      },
    })
    if (canceled) {
      await bundle.close()
      throw new Error('The build was canceled')
    }
    try {
      return await bundle.write({
        ...rolldownOptions.output,
        format: 'esm',
        sourcemap: 'hidden',
        dir: processingCacheDir,
        entryFileNames: '[name].js',
      })
    } finally {
      await bundle.close()
    }
  }

  /** 标记本次延迟构建已取消；已创建 bundle 会在写入前关闭。 */
  function cancel() {
    canceled = true
  }

  return { context: { build, cancel }, idToExports }
}

/** 展开/解析 optimizeDeps.include，把可优化入口合并进 scanner 结果，并针对显式项给出失败警告。 */
export async function addManuallyIncludedOptimizeDeps(
  environment: Environment,
  deps: Record<string, string>,
): Promise<void> {
  const { logger } = environment
  const { optimizeDeps } = environment.config
  const optimizeDepsInclude = optimizeDeps.include ?? []
  if (optimizeDepsInclude.length) {
    /** 只为用户显式 include 的条目输出无法优化告警。 */
    const unableToOptimize = (id: string, msg: string) => {
      if (optimizeDepsInclude.includes(id)) {
        logger.warn(
          `${msg}: ${colors.cyan(id)}, present in ${environment.name} 'optimizeDeps.include'`,
        )
      }
    }

    const includes = [...optimizeDepsInclude]
    for (let i = 0; i < includes.length; i++) {
      const id = includes[i]
      if (isDynamicPattern(id)) {
        const globIds = expandGlobIds(id, environment.getTopLevelConfig())
        includes.splice(i, 1, ...globIds)
        i += globIds.length - 1
      }
    }

    const resolve = createOptimizeDepsIncludeResolver(environment)
    for (const id of includes) {
      // 把 `foo   >bar` 规范为 `foo > bar`，避免重复并统一嵌套依赖日志/键。
      const normalizedId = normalizeId(id)
      if (!deps[normalizedId]) {
        const entry = await resolve(id)
        if (entry) {
          if (isOptimizable(entry, optimizeDeps)) {
            deps[normalizedId] = entry
          } else {
            unableToOptimize(id, 'Cannot optimize dependency')
          }
        } else {
          unableToOptimize(id, 'Failed to resolve dependency')
        }
      }
    }
  }
}

/** 从 OptimizedDepInfo record 提取 `id → src`，用于 browserHash 与重新打包输入。 */
export function depsFromOptimizedDepInfo(
  depsInfo: Record<string, OptimizedDepInfo>,
): Record<string, string> {
  const obj: Record<string, string> = {}
  for (const key in depsInfo) {
    obj[key] = depsInfo[key].src!
  }
  return obj
}

/** 按 Environment cache dir 与扁平 ID 预计算入口最终输出路径。 */
export function getOptimizedDepPath(
  environment: Environment,
  id: string,
): string {
  return normalizePath(
    path.resolve(getDepsCacheDir(environment), flattenId(id) + '.js'),
  )
}

/** 返回当前 Environment 的缓存目录后缀；client 保持历史无后缀路径。 */
function getDepsCacheSuffix(environment: Environment): string {
  return environment.name === 'client' ? '' : `_${environment.name}`
}

/** client 使用 `deps`，其他 Environment 用 `deps_<name>` 隔离解析条件与产物。 */
export function getDepsCacheDir(environment: Environment): string {
  return getDepsCacheDirPrefix(environment) + getDepsCacheSuffix(environment)
}

/** 为单轮优化生成不会与正式缓存冲突的 processing 目录。 */
function getProcessingDepsCacheDir(environment: Environment) {
  return (
    getDepsCacheDirPrefix(environment) +
    getDepsCacheSuffix(environment) +
    getTempSuffix()
  )
}

/** 组合进程、时间与随机值生成本轮临时目录后缀。 */
function getTempSuffix() {
  return (
    '_temp_' +
    getHash(
      `${process.pid}:${Date.now().toString()}:${Math.random()
        .toString(16)
        .slice(2)}`,
    )
  )
}

/** 返回所有 Environment 共用的 deps 缓存根前缀。 */
function getDepsCacheDirPrefix(environment: Environment): string {
  return normalizePath(path.resolve(environment.config.cacheDir, 'deps'))
}

/** 创建基于 cache 前缀的磁盘 ID 判定；包含所有 Environment 后缀目录。 */
export function createIsOptimizedDepFile(
  environment: Environment,
): (id: string) => boolean {
  const depsCacheDirPrefix = getDepsCacheDirPrefix(environment)
  return (id) => id.startsWith(depsCacheDirPrefix)
}

/** 创建优化产物 URL 判定；cache 在 root 外时使用 `/@fs/`，root 内使用根绝对 URL。 */
export function createIsOptimizedDepUrl(
  environment: Environment,
): (url: string) => boolean {
  const { root } = environment.config
  const depsCacheDir = getDepsCacheDirPrefix(environment)

  // 把 cache 磁盘目录映射成浏览器可请求前缀。
  const depsCacheDirRelative = normalizePath(path.relative(root, depsCacheDir))
  const depsCacheDirPrefix = depsCacheDirRelative.startsWith('../')
    ? // root 外示例：`/@fs/absolute/path/to/node_modules/.vite`。
      `/@fs/${removeLeadingSlash(normalizePath(depsCacheDir))}`
    : // root 内示例：`/node_modules/.vite`。
      `/${depsCacheDirRelative}`

  return function isOptimizedDepUrl(url: string): boolean {
    return url.startsWith(depsCacheDirPrefix)
  }
}

/** 读取 `_metadata.json`，把相对路径还原为绝对路径，并拒绝缺 chunks/fileHash 的旧格式。 */
function parseDepsOptimizerMetadata(
  jsonMetadata: string,
  depsCacheDir: string,
): DepOptimizationMetadata | undefined {
  const { hash, lockfileHash, configHash, browserHash, optimized, chunks } =
    JSON.parse(jsonMetadata, (key: string, value: string) => {
      // file/src 可为绝对路径或相对 metadata 所在 deps cache dir。
      if (key === 'file' || key === 'src') {
        return normalizePath(path.resolve(depsCacheDir, value))
      }
      return value
    })
  if (
    !chunks ||
    Object.values(optimized).some((depInfo: any) => !depInfo.fileHash)
  ) {
    // 旧元数据协议不足以判断稳定性，整份忽略并重构建。
    return
  }
  const metadata = {
    hash,
    lockfileHash,
    configHash,
    browserHash,
    optimized: {},
    discovered: {},
    chunks: {},
    depInfoList: [],
  }
  for (const id of Object.keys(optimized)) {
    addOptimizedDepInfo(metadata, 'optimized', {
      ...optimized[id],
      id,
      browserHash,
    })
  }
  for (const id of Object.keys(chunks)) {
    addOptimizedDepInfo(metadata, 'chunks', {
      ...chunks[id],
      id,
      browserHash,
      needsInterop: false,
    })
  }
  return metadata
}

/**
 * 序列化可跨进程复用的元数据：移除 Promise 与单项 browserHash，路径相对 cache dir。下次启动统一
 * 使用顶层 browserHash，才能让所有优化产物共享长期缓存版本。
 */
function stringifyDepsOptimizerMetadata(
  metadata: DepOptimizationMetadata,
  depsCacheDir: string,
) {
  const { hash, configHash, lockfileHash, browserHash, optimized, chunks } =
    metadata
  return JSON.stringify(
    {
      hash,
      configHash,
      lockfileHash,
      browserHash,
      optimized: Object.fromEntries(
        Object.values(optimized).map(
          ({ id, src, file, fileHash, needsInterop, isDynamicEntry }) => [
            id,
            {
              src,
              file,
              fileHash,
              needsInterop,
              isDynamicEntry,
            },
          ],
        ),
      ),
      chunks: Object.fromEntries(
        Object.values(chunks).map(({ id, file, isDynamicEntry }) => [
          id,
          { file, isDynamicEntry },
        ]),
      ),
    },
    (key: string, value: string) => {
      // 相对路径使项目/cache 整体移动后仍可读取。
      if (key === 'file' || key === 'src') {
        return normalizePath(path.relative(depsCacheDir, value))
      }
      return value
    },
    2,
  )
}

/**
 * 提取依赖入口的 ESM 语法与导出名。自定义扩展先用 Rolldown 单文件转换；普通文件先 lexer，失败
 * 时按配置 moduleType/Oxc JSX/TS 回退，并记录预构建是否需把 `.js` 当 JSX。
 */
export async function extractExportsData(
  environment: Environment,
  filePath: string,
): Promise<ExportsData> {
  await init

  const { optimizeDeps } = environment.config

  const rolldownOptions = optimizeDeps.rolldownOptions ?? {}
  if (optimizeDeps.extensions?.some((ext) => filePath.endsWith(ext))) {
    // 自定义扩展先只转换入口为 JS，所有依赖 external；无需为导出分析提前 bundle 整张图。
    const { plugins: pluginsFromConfig = [], ...remainingRolldownOptions } =
      rolldownOptions
    const plugins = await asyncFlatten(arraify(pluginsFromConfig))
    plugins.unshift({
      name: 'externalize',
      /** 导出分析只转换入口，所有被入口引用的模块均保持 external。 */
      resolveId(id, importer) {
        if (importer !== undefined) {
          return { id, external: true }
        }
      },
    })
    const build = await rolldown({
      ...remainingRolldownOptions,
      plugins,
      input: [filePath],
      // TODO：优化器启用 Rolldown CSS 支持后移除此兼容 moduleType。
      moduleTypes: {
        '.css': 'js',
        ...remainingRolldownOptions.moduleTypes,
      },
    })
    const result = await build.generate({
      ...rolldownOptions.output,
      format: 'esm',
      sourcemap: false,
    })
    const [, exports, , hasModuleSyntax] = parse(result.output[0].code)
    return {
      hasModuleSyntax,
      exports: exports.map((e) => e.n),
    }
  }

  let parseResult: ReturnType<typeof parse>
  let usedJsxLoader = false

  const entryContent = fs.readFileSync(filePath, 'utf-8')
  try {
    parseResult = parse(entryContent)
  } catch {
    const lang = rolldownOptions.moduleTypes?.[path.extname(filePath)] || 'jsx'
    debug?.(
      `Unable to parse: ${filePath}.\n Trying again with a ${lang} transform.`,
    )
    if (lang !== 'jsx' && lang !== 'tsx' && lang !== 'ts') {
      throw new Error(`Unable to parse: ${filePath}.`)
    }
    const transformed = await transformWithOxc(
      entryContent,
      filePath,
      { lang },
      undefined,
      environment.config,
    )
    parseResult = parse(transformed.code)
    usedJsxLoader = true
  }

  const [, exports, , hasModuleSyntax] = parseResult
  const exportsData: ExportsData = {
    hasModuleSyntax,
    exports: exports.map((e) => e.n),
    jsxLoader: usedJsxLoader,
  }
  return exportsData
}

/** 根据显式配置、入口 ESM 语法和打包前后 export 形状判断是否需 CJS 互操作。 */
function needsInterop(
  environment: Environment,
  id: string,
  exportsData: ExportsData,
  output?: {
    /** Rolldown 为入口 chunk 生成的导出名。 */
    exports: string[]
  },
): boolean {
  if (environment.config.optimizeDeps.needsInterop?.includes(id)) {
    return true
  }
  const { hasModuleSyntax, exports } = exportsData
  // 无 ESM 语法通常是 CJS/UMD。
  if (!hasModuleSyntax) {
    return true
  }

  if (output) {
    // peer 通过 require() 引用 ESM 时，打包器可能把入口压成单 default export；若输入实际有多个
    // exports，则强制 interop 恢复浏览器侧预期形状。
    const generatedExports: string[] = output.exports

    if (
      isSingleDefaultExport(generatedExports) &&
      !isSingleDefaultExport(exports)
    ) {
      return true
    }
  }
  return false
}

/** 判断导出形状是否被压成唯一 default。 */
function isSingleDefaultExport(exports: readonly string[]) {
  return exports.length === 1 && exports[0] === 'default'
}

/** 支持的包管理器锁文件及其额外 patch 目录规则，按当前 user-agent 调整优先级。 */
const lockfileFormats = [
  {
    path: 'node_modules/.pnpm/lock.yaml',
    // patch 信息已包含在该 lockfile。
    checkPatchesDir: false,
    manager: 'pnpm',
  },
  {
    path: 'node_modules/.package-lock.json',
    checkPatchesDir: 'patches',
    manager: 'npm',
  },
  {
    // Yarn 非 PnP。
    path: 'node_modules/.yarn-state.yml',
    checkPatchesDir: false,
    manager: 'yarn',
  },
  {
    path: 'bun.lock',
    checkPatchesDir: 'patches',
    manager: 'bun',
  },
  {
    path: '.rush/temp/shrinkwrap-deps.json',
    // patch 信息已包含在该 lockfile。
    checkPatchesDir: false,
    manager: 'pnpm',
  },
  {
    path: 'aube-lock.yaml',
    checkPatchesDir: false,
    manager: 'aube',
  },
  {
    path: 'nub.lock',
    checkPatchesDir: 'patches',
    manager: 'nub',
  },

  // 不推荐或已废弃的包管理器锁文件，仍为兼容旧项目识别。
  {
    // Yarn v3+ PnP。
    path: '.pnp.cjs',
    checkPatchesDir: '.yarn/patches',
    manager: 'yarn',
  },
  {
    // Yarn v2 PnP。
    path: '.pnp.js',
    checkPatchesDir: '.yarn/patches',
    manager: 'yarn',
  },
  {
    // Yarn 1。
    path: 'node_modules/.yarn-integrity',
    checkPatchesDir: 'patches',
    manager: 'yarn',
  },
  {
    path: 'bun.lockb',
    checkPatchesDir: 'patches',
    manager: 'bun',
  },
].sort((_, { manager }) => {
  return process.env.npm_config_user_agent?.startsWith(manager) ? 1 : -1
})
/** 供向上查找最近锁文件使用的候选相对路径。 */
const lockfilePaths = lockfileFormats.map((l) => l.path)

/** 只序列化会影响依赖优化输出的配置；函数/正则转字符串，插件用名称列表表示。 */
function getConfigHash(environment: Environment): string {
  const { config } = environment
  const { optimizeDeps } = config
  const content = JSON.stringify(
    {
      define: !config.keepProcessEnv
        ? process.env.NODE_ENV || config.mode
        : null,
      root: config.root,
      resolve: config.resolve,
      assetsInclude: config.assetsInclude,
      plugins: config.plugins.map((p) => p.name),
      optimizeDeps: {
        include: optimizeDeps.include
          ? unique(optimizeDeps.include).sort()
          : undefined,
        exclude: optimizeDeps.exclude
          ? unique(optimizeDeps.exclude).sort()
          : undefined,
        rolldownOptions: {
          ...optimizeDeps.rolldownOptions,
          plugins: undefined, // 已包含在 optimizeDepsPluginNames。
          onLog: undefined,
          onwarn: undefined,
          checks: undefined,
          output: {
            ...optimizeDeps.rolldownOptions?.output,
            plugins: undefined, // 已包含在 optimizeDepsPluginNames。
          },
        },
      },
      optimizeDepsPluginNames: config.optimizeDepsPluginNames,
    },
    (_, value) => {
      if (typeof value === 'function' || value instanceof RegExp) {
        return value.toString()
      }
      return value
    },
  )
  return getHash(content)
}

/** 哈希最近 lockfile；patch 目录未包含在 lockfile 时再混入其 mtime。 */
function getLockfileHash(environment: Environment): string {
  const lockfilePath = lookupFile(environment.config.root, lockfilePaths)
  let content = lockfilePath ? fs.readFileSync(lockfilePath, 'utf-8') : ''
  if (lockfilePath) {
    const normalizedLockfilePath = lockfilePath.replaceAll('\\', '/')
    const lockfileFormat = lockfileFormats.find((f) =>
      normalizedLockfilePath.endsWith(f.path),
    )!
    if (lockfileFormat.checkPatchesDir) {
      // `patches` 是 patch-package 默认目录：https://github.com/ds300/patch-package
      const baseDir = lockfilePath.slice(0, -lockfileFormat.path.length)
      const fullPath = path.join(
        baseDir,
        lockfileFormat.checkPatchesDir as string,
      )
      const stat = tryStatSync(fullPath)
      if (stat?.isDirectory()) {
        content += stat.mtimeMs.toString()
      }
    }
  }
  return getHash(content)
}

/** 返回 configHash、lockfileHash 及两者组合的主 hash。 */
function getDepHash(environment: Environment): {
  /** 最近锁文件与必要 patch 目录的指纹。 */
  lockfileHash: string
  /** 会影响优化输出的配置指纹。 */
  configHash: string
  /** lockfileHash 与 configHash 的组合主指纹。 */
  hash: string
} {
  const lockfileHash = getLockfileHash(environment)
  const configHash = getConfigHash(environment)
  const hash = getHash(lockfileHash + configHash)
  return {
    hash,
    lockfileHash,
    configHash,
  }
}

/** 给浏览器优化 URL 生成版本：主 hash + 实际依赖集合 + 可选强制时间戳。 */
function getOptimizedBrowserHash(
  hash: string,
  deps: Record<string, string>,
  timestamp = '',
) {
  return getHash(hash + JSON.stringify(deps) + timestamp)
}

/** 按 ID 依次查询已优化、待处理和内部 chunk。 */
export function optimizedDepInfoFromId(
  metadata: DepOptimizationMetadata,
  id: string,
): OptimizedDepInfo | undefined {
  return (
    metadata.optimized[id] || metadata.discovered[id] || metadata.chunks[id]
  )
}

/** 按最终文件路径从统一列表反查依赖信息。 */
export function optimizedDepInfoFromFile(
  metadata: DepOptimizationMetadata,
  file: string,
): OptimizedDepInfo | undefined {
  return metadata.depInfoList.find((depInfo) => depInfo.file === file)
}

/** 在依赖记录中返回第一个满足谓词的 OptimizedDepInfo。 */
function findOptimizedDepInfoInRecord(
  dependenciesInfo: Record<string, OptimizedDepInfo>,
  callbackFn: (depInfo: OptimizedDepInfo, id: string) => any,
): OptimizedDepInfo | undefined {
  for (const o of Object.keys(dependenciesInfo)) {
    const info = dependenciesInfo[o]
    if (callbackFn(info, o)) {
      return info
    }
  }
}

/** 惰性复用 exportsData 计算某优化文件是否需 CJS interop。 */
export async function optimizedDepNeedsInterop(
  environment: Environment,
  metadata: DepOptimizationMetadata,
  file: string,
): Promise<boolean | undefined> {
  const depInfo = optimizedDepInfoFromFile(metadata, file)
  if (depInfo?.src && depInfo.needsInterop === undefined) {
    depInfo.exportsData ??= extractExportsData(environment, depInfo.src)
    depInfo.needsInterop = needsInterop(
      environment,
      depInfo.id,
      await depInfo.exportsData,
    )
  }
  return depInfo?.needsInterop
}

/** 遗留 processing 目录保留上限：24 小时，避免误删仍可能属于活跃进程的目录。 */
const MAX_TEMP_DIR_AGE_MS = 24 * 60 * 60 * 1000
/** 删除 cacheDir 下超过 24 小时的 `_temp_` 目录；错误记录但不阻塞服务器。 */
export async function cleanupDepsCacheStaleDirs(
  config: ResolvedConfig,
): Promise<void> {
  try {
    const cacheDir = path.resolve(config.cacheDir)
    if (fs.existsSync(cacheDir)) {
      const dirents = await fsp.readdir(cacheDir, { withFileTypes: true })
      for (const dirent of dirents) {
        if (dirent.isDirectory() && dirent.name.includes('_temp_')) {
          const tempDirPath = path.resolve(config.cacheDir, dirent.name)
          const stats = await fsp.stat(tempDirPath).catch(() => null)
          if (
            stats?.mtime &&
            Date.now() - stats.mtime.getTime() > MAX_TEMP_DIR_AGE_MS
          ) {
            debug?.(`removing stale cache temp dir ${tempDirPath}`)
            await fsp.rm(tempDirPath, { recursive: true, force: true })
          }
        }
      }
    }
  } catch (err) {
    config.logger.error(err)
  }
}

// 部分系统 rename 目录不稳定；以下实现只服务优化器提交协议，不是通用文件工具。

// 基于 node-graceful-fs；保留下方 ISC 许可证说明。

// The ISC License
// Copyright (c) 2011-2022 Isaac Z. Schlueter, Ben Noordhuis, and Contributors
// https://github.com/isaacs/node-graceful-fs/blob/main/LICENSE

// Windows 杀毒软件可能锁住刚创建文件的目录，引发 EACCES/EPERM。原实现最多重试 60 秒；开发
// 服务器等待超过 5 秒已应视为错误，因此这里缩短上限。

/** Windows 目录锁冲突的最长重试窗口，单位毫秒。 */
const GRACEFUL_RENAME_TIMEOUT = 5000
/** 带 Windows EACCES/EPERM 退避重试的目录 rename Promise。 */
const safeRename = promisify(function gracefulRename(
  from: string,
  to: string,
  cb: (error: NodeJS.ErrnoException | null) => void,
) {
  const start = Date.now()
  let backoff = 0
  fs.rename(from, to, function CB(er) {
    if (
      er &&
      (er.code === 'EACCES' || er.code === 'EPERM') &&
      Date.now() - start < GRACEFUL_RENAME_TIMEOUT
    ) {
      setTimeout(function () {
        fs.stat(to, function (stater, _st) {
          if (stater && stater.code === 'ENOENT') fs.rename(from, to, CB)
          else CB(er)
        })
      }, backoff)
      if (backoff < 100) backoff += 10
      return
    }
    cb(er)
  })
})
