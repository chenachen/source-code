import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { OutputOptions, WatcherOptions } from 'rolldown'
import colors from 'picocolors'
import { escapePath } from 'tinyglobby'
import type { FSWatcher, WatchOptions } from '#dep-types/chokidar'
import { withTrailingSlash } from '../shared/utils'
import { arraify, normalizePath } from './utils'
import type { Logger } from './logger'

/** 收集默认 outDir 与每个 Rolldown output.dir 的绝对路径并去重。 */
export function getResolvedOutDirs(
  root: string,
  outDir: string,
  outputOptions: OutputOptions[] | OutputOptions | undefined,
): Set<string> {
  const resolvedOutDir = path.resolve(root, outDir)
  if (!outputOptions) return new Set([resolvedOutDir])

  return new Set(
    arraify(outputOptions).map(({ dir }) =>
      dir ? path.resolve(root, dir) : resolvedOutDir,
    ),
  )
}

/**
 * 决定构建前是否清空输出目录。
 * 用户显式值优先；缺省时只自动清理 root 内目录，root 外目录告警并保留，避免误删用户
 * 其他项目文件。
 */
export function resolveEmptyOutDir(
  emptyOutDir: boolean | null,
  root: string,
  outDirs: Set<string>,
  logger?: Logger,
): boolean {
  if (emptyOutDir != null) return emptyOutDir

  for (const outDir of outDirs) {
    if (!normalizePath(outDir).startsWith(withTrailingSlash(root))) {
      // root 外输出目录不自动清空。
      logger?.warn(
        colors.yellow(
          `\n${colors.bold(`(!)`)} outDir ${colors.white(
            colors.dim(outDir),
          )} is not inside project root and will not be emptied.\n` +
            `Use --emptyOutDir to override.\n`,
        ),
      )
      return false
    }
  }
  return true
}

/**
 * 合并 Chokidar 选项并加入 Vite 必须忽略的目录。
 * cacheDir、Git、node_modules、测试产物始终忽略；会被构建清空的 outDir 也忽略，防止
 * 构建写入触发 Dev Server 自身 HMR/重启。
 */
export function resolveChokidarOptions(
  options: WatchOptions | undefined,
  resolvedOutDirs: Set<string>,
  emptyOutDir: boolean,
  cacheDir: string,
): WatchOptions {
  const { ignored: ignoredList, ...otherOptions } = options ?? {}
  const ignored: WatchOptions['ignored'] = [
    '**/.git/**',
    '**/node_modules/**',
    '**/test-results/**', // Playwright 测试产物。
    escapePath(cacheDir) + '/**',
    ...arraify(ignoredList || []),
  ]
  if (emptyOutDir) {
    ignored.push(
      ...[...resolvedOutDirs].map((outDir) => escapePath(outDir) + '/**'),
    )
  }

  const resolvedWatchOptions: WatchOptions = {
    ignored,
    ignoreInitial: true,
    ignorePermissionErrors: true,
    ...otherOptions,
  }

  return resolvedWatchOptions
}

/** 把 Chokidar polling 选项映射到 Rolldown watcher 字段。 */
export function convertToWatcherOptions(
  options: WatchOptions | undefined,
): WatcherOptions['watcher'] {
  if (!options) return

  return {
    usePolling: options.usePolling,
    pollInterval: options.interval,
  }
}

/**
 * `server.watch: null` 使用的 FSWatcher 兼容空实现。
 * 保留 EventEmitter/链式 API 和 options 形状，使 Server 其他逻辑无需到处判断 null。
 */
class NoopWatcher extends EventEmitter implements FSWatcher {
  /** 保存兼容选项并初始化 EventEmitter，不创建任何文件系统句柄。 */
  constructor(public options: WatchOptions) {
    super()
  }

  /** 忽略新增监听路径并保持链式调用。 */
  add() {
    return this
  }

  /** 忽略取消监听并保持链式调用。 */
  unwatch() {
    return this
  }

  /** 空 watcher 永远没有已监听目录。 */
  getWatched() {
    return {}
  }

  /** no-op 引用计数兼容方法。 */
  ref() {
    return this
  }

  /** no-op 引用计数兼容方法。 */
  unref() {
    return this
  }

  /** 无底层句柄需要关闭。 */
  async close() {
    // 空操作。
  }
}

/** 创建保留配置形状的 no-op FSWatcher。 */
export function createNoopWatcher(options: WatchOptions): FSWatcher {
  return new NoopWatcher(options)
}
