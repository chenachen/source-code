import path from 'node:path'
import fs from 'node:fs'
import { inspect } from 'node:util'
import { performance } from 'node:perf_hooks'
import { cac } from 'cac'
import colors from 'picocolors'
import { VERSION } from './constants'
import { createBuilder } from './build'
import type { BuildEnvironmentOptions } from './build'
import type { ServerOptions } from './server'
import type { CLIShortcut } from './shortcuts'
import type { LogLevel } from './logger'
import { createLogger } from './logger'
import type { InlineConfig } from './config'

/**
 * 判断当前 Node.js 版本是否满足 Vite 的最低运行要求。
 *
 * Vite 支持 Node.js 20.19+、22.12+ 和更高主版本；不接受已经停止支持的奇数主
 * 版本 21，也不接受缺少所需 ESM 能力的早期 Node.js 20/22 小版本。
 *
 * @param nodeVersion - `process.versions.node` 形式的版本号，例如 `22.12.0`。
 * @returns 满足支持范围时返回 `true`。
 */
function checkNodeVersion(nodeVersion: string): boolean {
  const currentVersion = nodeVersion.split('.')
  const major = parseInt(currentVersion[0], 10)
  const minor = parseInt(currentVersion[1], 10)
  const isSupported =
    (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22
  return isSupported
}

if (!checkNodeVersion(process.versions.node)) {
  // eslint-disable-next-line no-console
  console.warn(
    colors.yellow(
      `You are using Node.js ${process.versions.node}. ` +
        `Vite requires Node.js version 20.19+ or 22.12+. ` +
        `Please upgrade your Node.js version.`,
    ),
  )
}

/**
 * 基于 cac 创建的顶层命令解析器。它负责收集参数并把任务分发给 Vite Node API，
 * 不直接实现开发服务器、构建器或预览服务器。
 */
const cli = cac('vite')

/** 所有子命令共享的 CLI 参数；清理后再把剩余参数传入命令专属配置。 */
interface GlobalCLIOptions {
  /** `--` 分隔符之后、不再由 cac 解析的原始参数。 */
  '--'?: string[]
  /** `--config` 的短参数值。 */
  c?: boolean | string
  /** 指定的 Vite 配置文件路径。 */
  config?: string
  /** 部署时使用的公共基础路径。 */
  base?: string
  /** `--logLevel` 的短参数值。 */
  l?: LogLevel
  /** 日志级别。 */
  logLevel?: LogLevel
  /** 是否允许日志输出前清屏。 */
  clearScreen?: boolean
  /** 配置文件加载策略：打包、Module Runner 或原生运行时。 */
  configLoader?: 'bundle' | 'runner' | 'native'
  /** `--debug` 的短参数值。 */
  d?: boolean | string
  /** 要开启的调试日志命名空间。 */
  debug?: boolean | string
  /** `--filter` 的短参数值。 */
  f?: string
  /** 调试日志内容过滤器。 */
  filter?: string
  /** `--mode` 的短参数值。 */
  m?: string
  /** 当前运行模式，例如 `development` 或 `staging`。 */
  mode?: string
  /** 是否忽略依赖优化缓存并强制重新预构建。 */
  force?: boolean
  /** `--watch` 的短参数值。 */
  w?: boolean
}

/** 开发服务器实验参数。 */
interface ExperimentalDevOptions {
  /** 是否启用仍处于实验阶段的全量打包开发模式。 */
  experimentalBundle?: boolean
}

/** 构建器专属 CLI 参数。 */
interface BuilderCLIOptions {
  /** 是否启用 App 构建模式；会被转换为非空的 `builder` 配置。 */
  app?: boolean
}

/** 入口脚本在 `--profile` 模式下创建的 V8 Inspector 会话。 */
let profileSession = global.__vite_profile_session
/** 当前进程已写出的 CPU Profile 序号，防止多次启停时覆盖文件。 */
let profileCount = 0

/**
 * 停止 CPU 性能采样并把结果写入当前工作目录。
 *
 * 开发服务器支持用快捷键多次启停 Profiler，因此成功写出后会清空当前会话；
 * 下次按键会创建新会话。没有活动会话时直接返回。
 *
 * @param log - 用于通知用户输出文件位置的日志函数。
 * @returns Profiler 活跃时返回写文件 Promise，否则返回 `undefined`。
 */
export const stopProfiler = (
  log: (message: string) => void,
): void | Promise<void> => {
  if (!profileSession) return
  return new Promise((res, rej) => {
    profileSession!.post('Profiler.stop', (err, { profile }) => {
      // 当前实现把 Profile 写到磁盘；调用方也可通过日志获知文件位置并进一步上传。
      if (!err) {
        const outPath = path.resolve(
          `./vite-profile-${profileCount++}.cpuprofile`,
        )
        fs.writeFileSync(outPath, JSON.stringify(profile))
        log(
          colors.yellow(
            `CPU profile written to ${colors.white(colors.dim(outPath))}`,
          ),
        )
        profileSession = undefined
        res()
      } else {
        rej(err)
      }
    })
  })
}

/**
 * 把重复出现的 CLI 选项折叠为最后一次输入的值。
 *
 * cac 会把 `--port 3000 --port 4000` 解析成数组，但 Vite 配置只接受单值。
 * 遵循常见 CLI 的“后者覆盖前者”语义，可避免数组继续传入配置解析阶段。
 *
 * @see https://github.com/vitejs/vite/pull/10474
 */
const filterDuplicateOptions = <T extends object>(options: T) => {
  for (const [key, value] of Object.entries(options)) {
    if (Array.isArray(value)) {
      options[key as keyof T] = value[value.length - 1]
    }
  }
}

/**
 * 移除全局 CLI 参数，并把命令行表示转换成对应 Node API 所需的配置值。
 *
 * CLI 解析结果同时包含全局参数和命令专属参数。例如 `--mode` 应写入
 * `InlineConfig.mode`，不能再次混进 `server` 或 `build` 子配置。这里复制后删除
 * 全局字段，既保留原始 options 给外层使用，也避免污染专属配置。
 *
 * `--watch` 需要从布尔值转换成 Rolldown/Rollup 期望的对象；若直接把 CLI 的
 * `true` 传下去，会覆盖配置文件中更详细的 `build.watch` 选项（#18390）。
 * `--force` 同样属于全局控制项，不能泄漏进命令子配置（#19999）。
 *
 * @param options - cac 解析得到的完整参数对象。
 * @returns 只保留命令专属字段的新对象。
 */
function cleanGlobalCLIOptions<Options extends GlobalCLIOptions>(
  options: Options,
): Omit<Options, keyof GlobalCLIOptions> {
  const ret = { ...options }
  delete ret['--']
  delete ret.c
  delete ret.config
  delete ret.base
  delete ret.l
  delete ret.logLevel
  delete ret.clearScreen
  delete ret.configLoader
  delete ret.d
  delete ret.debug
  delete ret.f
  delete ret.filter
  delete ret.m
  delete ret.mode
  delete ret.force
  delete ret.w

  // 命令行中的 `--sourcemap true/false` 是字符串；Node API 需要真正的布尔值。
  // `inline` 和 `hidden` 是有效模式，必须原样保留。
  if ('sourcemap' in ret) {
    const sourcemap = ret.sourcemap as `${boolean}` | 'inline' | 'hidden'
    ret.sourcemap =
      sourcemap === 'true'
        ? true
        : sourcemap === 'false'
          ? false
          : ret.sourcemap
  }
  if ('watch' in ret) {
    const watch = ret.watch
    ret.watch = watch ? {} : undefined
  }

  return ret
}

/**
 * 从构建环境配置中移除只用于选择构建器模式的 CLI 参数。
 *
 * `--app` 最终映射到顶层 `InlineConfig.builder`，不是
 * `BuildEnvironmentOptions` 的一部分。
 *
 * @param options - 已移除全局参数的构建命令参数。
 * @returns 不含构建器模式开关的新对象。
 */
function cleanBuilderCLIOptions<Options extends BuilderCLIOptions>(
  options: Options,
): Omit<Options, keyof BuilderCLIOptions> {
  const ret = { ...options }
  delete ret.app
  return ret
}

/**
 * 保证 `--host` 的值保持字符串语义。
 *
 * cac 会把纯数字主机名（例如 `--host 0`）解析成 number。如果直接传入服务器，
 * 数值会被当成无效的 host 配置；转回字符串后才能按用户原始输入校验。
 *
 * @see https://github.com/vitejs/vite/pull/14013
 */
const convertHost = (v: any) => {
  if (typeof v === 'number') {
    return String(v)
  }
  return v
}

/**
 * 修正 cac 对特殊 `--base 0` 值的数值推断。
 *
 * 空字符串 base 在命令行中容易被 shell 吞掉，历史上允许用数字 `0` 表示空
 * base。cac 会把它解析成 number，因此在参数类型转换阶段恢复为空字符串。
 *
 * @see https://github.com/vitejs/vite/pull/14283
 */
const convertBase = (v: any) => {
  if (v === 0) {
    return ''
  }
  return v
}

// 注册全局参数。这些参数由各命令 action 组装到 InlineConfig 顶层。
cli
  .option('-c, --config <file>', `[string] use specified config file`)
  .option('--base <path>', `[string] public base path (default: /)`, {
    type: [convertBase],
  })
  .option('-l, --logLevel <level>', `[string] info | warn | error | silent`)
  .option('--clearScreen', `[boolean] allow/disable clear screen when logging`)
  .option(
    '--configLoader <loader>',
    `[string] use 'bundle' to bundle the config with Rolldown, or 'runner' (experimental) to process it on the fly, or 'native' (experimental) to load using the native runtime (default: bundle)`,
  )
  .option('-d, --debug [feat]', `[string | boolean] show debug logs`)
  .option('-f, --filter <filter>', `[string] filter debug logs`)
  .option('-m, --mode <mode>', `[string] set env mode`)

// 开发服务器命令：`vite [root]`、`vite serve [root]` 与 `vite dev [root]`
// 最终都只负责构造 InlineConfig，再把生命周期交给 createServer。
cli
  .command('[root]', 'start dev server') // 未写子命令时执行的默认命令。
  .alias('serve') // 与 Vite Node API 使用的 `serve` 命令名保持一致。
  .alias('dev') // 与项目中常见的 `npm run dev` 脚本名保持一致。
  .option('--host [host]', `[string] specify hostname`, { type: [convertHost] })
  .option('--port <port>', `[number] specify port`)
  .option('--open [path]', `[boolean | string] open browser on startup`)
  .option('--cors', `[boolean] enable CORS`)
  .option('--strictPort', `[boolean] exit if specified port is already in use`)
  .option(
    '--force',
    `[boolean] force the optimizer to ignore the cache and re-bundle`,
  )
  .option(
    '--experimentalBundle',
    `[boolean] use experimental full bundle mode (this is highly experimental)`,
  )
  .action(
    async (
      root: string,
      options: ServerOptions & ExperimentalDevOptions & GlobalCLIOptions,
    ) => {
      filterDuplicateOptions(options)
      // 延迟加载服务器实现，避免 `vite build`、`vite preview` 启动时解析整套 Dev
      // Server 代码。Vite 的打包产物保留该相对模块关系，因此动态导入仍可定位。
      const { createServer } = await import('./server')
      try {
        // CLI 只做参数到 InlineConfig 的映射。配置加载、插件解析、HTTP Server
        // 创建等核心工作全部发生在 createServer 内部。
        const server = await createServer({
          root,
          base: options.base,
          mode: options.mode,
          configFile: options.config,
          configLoader: options.configLoader,
          logLevel: options.logLevel,
          clearScreen: options.clearScreen,
          server: cleanGlobalCLIOptions(options),
          forceOptimizeDeps: options.force,
          experimental: {
            bundledDev: options.experimentalBundle,
          },
        })

        if (!server.httpServer) {
          throw new Error('HTTP server not available')
        }

        await server.listen()

        const info = server.config.logger.info

        // 启动横幅同时展示版本、非默认 mode 和从 bin/vite.js 开始统计的总耗时。
        // 若进程此前已有日志，则不清屏，避免覆盖配置加载阶段的重要提示（#14936）。
        const modeString =
          options.mode && options.mode !== 'development'
            ? `  ${colors.bgGreen(` ${colors.bold(options.mode)} `)}`
            : ''
        const viteStartTime = global.__vite_start_time ?? false
        const startupDurationString = viteStartTime
          ? colors.dim(
              `ready in ${colors.reset(
                colors.bold(Math.ceil(performance.now() - viteStartTime)),
              )} ms`,
            )
          : ''
        const hasExistingLogs =
          process.stdout.bytesWritten > 0 || process.stderr.bytesWritten > 0

        info(
          `\n  ${colors.green(
            `${colors.bold('VITE')} v${VERSION}`,
          )}${modeString}  ${startupDurationString}\n`,
          {
            clear: !hasExistingLogs,
          },
        )

        server.printUrls()
        /** 注入到默认 CLI 快捷键集合中的额外快捷键。 */
        const customShortcuts: CLIShortcut<typeof server>[] = []
        if (profileSession) {
          // `--profile` 启动时提供 `p` 快捷键，使长时间运行的服务器可以分段采样，
          // 而不必把整个进程生命周期写入一个巨大 Profile。
          customShortcuts.push({
            key: 'p',
            description: 'start/stop the profiler',
            /** 在同一 inspector session 上切换 CPU profile 的开始与落盘。 */
            async action(server) {
              if (profileSession) {
                await stopProfiler(server.config.logger.info)
              } else {
                const inspector = await import('node:inspector').then(
                  (r) => r.default,
                )
                await new Promise<void>((res) => {
                  profileSession = new inspector.Session()
                  profileSession.connect()
                  profileSession.post('Profiler.enable', () => {
                    profileSession!.post('Profiler.start', () => {
                      server.config.logger.info('Profiler started')
                      res()
                    })
                  })
                })
              }
            },
          })
        }
        server.bindCLIShortcuts({ print: true, customShortcuts })
      } catch (e) {
        const logger = createLogger(options.logLevel)
        logger.error(
          colors.red(`error when starting dev server:\n${inspect(e)}`),
          {
            error: e,
          },
        )
        await stopProfiler(logger.info)
        process.exit(1)
      }
    },
  )

// 生产构建命令：把 CLI 选项映射为 BuildEnvironmentOptions，并交给 Builder API。
cli
  .command('build [root]', 'build for production')
  .option(
    '--target <target>',
    `[string] transpile target (default: 'baseline-widely-available')`,
  )
  .option('--outDir <dir>', `[string] output directory (default: dist)`)
  .option(
    '--assetsDir <dir>',
    `[string] directory under outDir to place assets in (default: assets)`,
  )
  .option(
    '--assetsInlineLimit <number>',
    `[number] static asset base64 inline threshold in bytes (default: 4096)`,
  )
  .option(
    '--ssr [entry]',
    `[string] build specified entry for server-side rendering`,
  )
  .option(
    '--sourcemap [output]',
    `[boolean | "inline" | "hidden"] output source maps for build (default: false)`,
  )
  .option(
    '--minify [minifier]',
    `[boolean | "oxc" | "terser" | "esbuild"] enable/disable minification, ` +
      `or specify minifier to use (default: oxc)`,
  )
  .option('--manifest [name]', `[boolean | string] emit build manifest json`)
  .option('--ssrManifest [name]', `[boolean | string] emit ssr manifest json`)
  .option(
    '--emptyOutDir',
    `[boolean] force empty outDir when it's outside of root`,
  )
  .option('-w, --watch', `[boolean] rebuilds when modules have changed on disk`)
  .option('--app', `[boolean] same as \`builder: {}\``)
  .action(
    async (
      root: string,
      options: BuildEnvironmentOptions & BuilderCLIOptions & GlobalCLIOptions,
    ) => {
      filterDuplicateOptions(options)

      const buildOptions: BuildEnvironmentOptions = cleanGlobalCLIOptions(
        cleanBuilderCLIOptions(options),
      )

      try {
        // `builder` 位于 InlineConfig 顶层，`build` 才是每个构建环境的选项。
        // `--app` 因而不能直接混入 buildOptions。
        const inlineConfig: InlineConfig = {
          root,
          base: options.base,
          mode: options.mode,
          configFile: options.config,
          configLoader: options.configLoader,
          logLevel: options.logLevel,
          clearScreen: options.clearScreen,
          build: buildOptions,
          ...(options.app ? { builder: {} } : {}),
        }
        const builder = await createBuilder(inlineConfig, null)
        await builder.buildApp()
        await builder.runDevTools()
      } catch (e) {
        createLogger(options.logLevel).error(
          colors.red(`error during build:\n${inspect(e)}`),
          { error: e },
        )
        process.exit(1)
      } finally {
        await stopProfiler((message) =>
          createLogger(options.logLevel).info(message),
        )
      }
    },
  )

// 依赖预构建命令：保留用于排障和显式预热，但正常开发流程会自动执行，已废弃。
cli
  .command(
    'optimize [root]',
    'pre-bundle dependencies (deprecated, the pre-bundle process runs automatically and does not need to be called)',
  )
  .option(
    '--force',
    `[boolean] force the optimizer to ignore the cache and re-bundle`,
  )
  .action(
    async (
      root: string,
      options: {
        /** 忽略依赖优化缓存并强制重新预构建。 */
        force?: boolean
      } & GlobalCLIOptions,
    ) => {
      filterDuplicateOptions(options)
      const { resolveConfig } = await import('./config')
      const { optimizeDeps } = await import('./optimizer')
      try {
        const config = await resolveConfig(
          {
            root,
            base: options.base,
            configFile: options.config,
            configLoader: options.configLoader,
            logLevel: options.logLevel,
            mode: options.mode,
          },
          'serve',
        )
        await optimizeDeps(config, options.force, true)
      } catch (e) {
        createLogger(options.logLevel).error(
          colors.red(`error when optimizing deps:\n${inspect(e)}`),
          { error: e },
        )
        process.exit(1)
      }
    },
  )

// 预览命令：读取生产构建产物并启动独立静态服务器，不会执行 Dev 转换链。
cli
  .command('preview [root]', 'locally preview production build')
  .option('--host [host]', `[string] specify hostname`, { type: [convertHost] })
  .option('--port <port>', `[number] specify port`)
  .option('--strictPort', `[boolean] exit if specified port is already in use`)
  .option('--open [path]', `[boolean | string] open browser on startup`)
  .option('--outDir <dir>', `[string] output directory (default: dist)`)
  .action(
    async (
      root: string,
      options: {
        /** 预览服务器绑定的主机名或启用默认主机的布尔开关。 */
        host?: string | boolean
        /** 预览服务器首选监听端口。 */
        port?: number
        /** 启动后是否打开浏览器及可选路径。 */
        open?: boolean | string
        /** 端口占用时是否立即失败而不自动递增。 */
        strictPort?: boolean
        /** 相对项目根的生产输出目录。 */
        outDir?: string
      } & GlobalCLIOptions,
    ) => {
      filterDuplicateOptions(options)
      const { preview } = await import('./preview')
      try {
        const server = await preview({
          root,
          base: options.base,
          configFile: options.config,
          configLoader: options.configLoader,
          logLevel: options.logLevel,
          mode: options.mode,
          build: {
            outDir: options.outDir,
          },
          preview: {
            port: options.port,
            strictPort: options.strictPort,
            host: options.host,
            open: options.open,
          },
        })
        server.printUrls()
        server.bindCLIShortcuts({ print: true })
      } catch (e) {
        createLogger(options.logLevel).error(
          colors.red(`error when starting preview server:\n${inspect(e)}`),
          { error: e },
        )
        process.exit(1)
      } finally {
        await stopProfiler((message) =>
          createLogger(options.logLevel).info(message),
        )
      }
    },
  )

// 注册帮助、版本信息后立即解析 process.argv。cac 会调用上面匹配命令的 action；
// 因而导入本模块本身就会启动对应任务，不应把它当作无副作用的工具模块导入。
cli.help()
cli.version(VERSION)

cli.parse()
