import type * as http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-chromium'
import type {
  ConfigEnv,
  InlineConfig,
  Logger,
  PluginOption,
  ResolvedConfig,
  UserConfig,
  ViteDevServer,
} from 'vite'
import {
  build,
  createBuilder,
  createServer,
  loadConfigFromFile,
  mergeConfig,
  preview,
} from 'vite'
import type { Browser, Page } from 'playwright-chromium'
import type {
  RolldownWatcher,
  RolldownWatcherEvent,
  RollupError,
} from 'rolldown'
import { beforeAll, expect, inject, vi } from 'vitest'

// #region 序列化器

/** 标记经过 test-utils 归一化的 Source Map 快照对象，使自定义 serializer 只接管该类值。 */
export const sourcemapSnapshot = Symbol()

/** 将代码与完整 map 编成可视化站点需要的长度前缀 + Base64 hash，便于定位快照映射问题。 */
const generateVisualizationLink = (code: string, map: string) => {
  /** 转为可由 btoa 编码的 UTF-8 字节字符串，避免源码中的 Unicode 字符触发编码错误。 */
  const utf16ToUTF8 = (x) => unescape(encodeURIComponent(x))
  const convertedCode = utf16ToUTF8(code)
  const convertedMap = utf16ToUTF8(map)
  const hash = `${convertedCode.length}\0${convertedCode}${convertedMap.length}\0${convertedMap}`
  return `https://evanw.github.io/source-map-visualization/#${btoa(hash)}`
}

expect.addSnapshotSerializer({
  /** 输出稳定的 map 快照和可视化链接；withoutContent 只隐藏正文内容，不删链接所用的原 map。 */
  serialize(val, config, indentation, depth, refs, printer) {
    const options = val[sourcemapSnapshot]
    const map = { ...val.map }
    if (options.withoutContent) {
      delete map.sourcesContent
    }

    return `${indentation}SourceMap {
${indentation}${config.indent}content: ${printer(map, config, indentation + config.indent, depth, refs)},
${indentation}${config.indent}visualization: ${JSON.stringify(generateVisualizationLink(val.code, JSON.stringify(val.map)))}
${indentation}}`
  },
  /** 仅匹配含 sourcemapSnapshot 标记的对象，其他快照继续交给 Vitest 默认 serializer。 */
  test(val) {
    return typeof val === 'object' && val && val[sourcemapSnapshot]
  },
})

// #endregion

// #region 环境

/** Vite 工作区根目录；源 playground 与可修改的 playground-temp 都从这里定位。 */
export const workspaceRoot = path.resolve(import.meta.dirname, '../')

/** VITE_TEST_BUILD 非空时执行构建并通过 preview 检查产物。 */
export const isBuild = !!process.env.VITE_TEST_BUILD
/** build 之外的 e2e 运行；既包含普通 dev，也包含强制 bundled-dev。 */
export const isServe = !isBuild
/**
 * serve 下通过 VITE_TEST_BUNDLED_DEV 强制所有 playground 启用 experimental.bundledDev。
 * 此时 isServe 仍为 true；尚不支持的用例需用 skipIf(isBundledDev) 显式跳过，不能视为通过。
 */
export const isBundledDev = isServe && !!process.env.VITE_TEST_BUNDLED_DEV
/** 已打包模块图的两种运行路径：build 产物或 bundled-dev，供断言选择不同输出契约。 */
export const isBundled = isBuild || isBundledDev
/** Windows 路径和进程树清理分支的运行平台标记。 */
export const isWindows = process.platform === 'win32'
/** 工作区真实 CLI 入口；自定义 serve 测试通过该路径启动子进程。 */
export const viteBinPath = path.posix.join(
  workspaceRoot,
  'packages/vite/bin/vite.js',
)

// #endregion

// #region 测试上下文

let server: ViteDevServer | http.Server

/**
 * serve 测试当前使用的 ViteDevServer；自定义 serve 模块可导出自己的实例供测试取得 Environment。
 */
export let viteServer: ViteDevServer
/**
 * 当前 fixture 的 Vite root；优先采用副本中的 root 子目录，专用 variant 副本可覆盖它。
 */
export let rootDir: string
/**
 * 当前原始 spec 的绝对路径，用于识别 playground、variant 和同目录自定义 serve 模块。
 */
export let testPath: string
/**
 * 当前可修改 fixture 目录；通常指 playground-temp，专用 variant 使用单独副本。
 */
export let testDir: string
/**
 * spec 路径中的第一层 playground 名，用于默认服务与特定 setup 例外分支。
 */
export let testName: string

/** 自定义 logger 与 console.warn 收集的服务端文本，供警告、错误和重构建结果断言。 */
export const serverLogs: string[] = []
/** 当前 page 的 console 文本；测试常取末尾或建立新监听区分某次 HMR 的日志。 */
export const browserLogs: string[] = []
/** 当前 page 的未捕获运行时错误，由 pageerror 事件收集。 */
export const browserErrors: Error[] = []

export let page: Page = undefined!
export let browser: Browser = undefined!
export let viteTestUrl: string = ''
export let watcher: RolldownWatcher | undefined = undefined

/** 自定义 serve 模块回写浏览器访问地址，使共用测试仍可按 viteTestUrl 请求当前服务。 */
export function setViteUrl(url: string): void {
  viteTestUrl = url
}

/**
 * 将默认测试配置中的 HTML 解析警告升级为异常，使 invalid HTML 用例能断言 500/overlay。
 * 正常 Vite 的 handleParseError 只报告 warn；此处属于测试 harness 的额外行为。
 */
function throwHtmlParseError() {
  return {
    name: 'vite-plugin-throw-html-parse-error',
    /** 在配置完成后包装 logger.warn，只将指定 HTML 解析警告抛出，其余警告仍交原 logger。 */
    configResolved(config: ResolvedConfig) {
      const warn = config.logger.warn
      /** HTML 解析诊断抛为测试异常，其余消息保持原 warn 的 this 与选项。 */
      config.logger.warn = (msg, opts) => {
        // invalid HTML 的 500/overlay 来自此测试层升级，不能据此推断普通服务器总会抛解析异常。
        if (msg.includes('Unable to parse HTML;')) {
          throw new Error(msg)
        }
        warn.call(config.logger, msg, opts)
      }
    },
  }
}
// #endregion

// 每个 spec 连接全局 Chromium，再按路径选择临时 fixture 和默认/自定义服务；结束后关闭本文件资源。
// eslint-disable-next-line no-empty-pattern
beforeAll(async ({}, suite) => {
  testPath = suite.file.filepath!
  testName = slash(testPath).match(/playground\/([\w-]+)\//)?.[1]
  testDir = path.dirname(testPath)
  if (testName) {
    testDir = path.resolve(workspaceRoot, 'playground-temp', testName)
  }

  // hmr-ssr 直接观察 SSR Runner，不需要浏览器页面和默认 HTTP 服务。
  if (testName === 'hmr-ssr') {
    return
  }

  const wsEndpoint = inject('wsEndpoint')
  if (!wsEndpoint) {
    throw new Error('wsEndpoint not found')
  }

  browser = await chromium.connect(wsEndpoint)
  page = await browser.newPage()

  try {
    page.on('console', (msg) => {
      // 有界面调试时忽略 favicon 的失败提示，不把浏览器探测噪声计入目标 console 日志。
      if (
        process.env.VITE_DEBUG_SERVE &&
        msg.text().includes('Failed to load resource:') &&
        msg.location().url.includes('favicon.ico')
      ) {
        return
      }
      browserLogs.push(msg.text())
    })
    page.on('pageerror', (error) => {
      browserErrors.push(error)
    })

    // 只有 playground 内的测试自动启动 fixture 服务；其他路径只取得浏览器页面。
    if (testName) {
      // root 子目录存在时只将它作为项目 root，仍从外层 testDir 修改 fixture 文件。
      const testCustomRoot = path.resolve(testDir, 'root')
      rootDir = fs.existsSync(testCustomRoot) ? testCustomRoot : testDir

      // 全局 setup 已准备的专用 variant 副本同时替换 rootDir/testDir，避免文件改动互相干扰。
      const variantName = path.basename(path.dirname(testPath))
      if (variantName !== '__tests__') {
        const variantTestDir = testDir + '__' + variantName
        if (fs.existsSync(variantTestDir)) {
          rootDir = testDir = variantTestDir
        }
      }

      const testCustomServe = [
        path.resolve(path.dirname(testPath), 'serve.ts'),
        path.resolve(path.dirname(testPath), 'serve.js'),
      ].find((i) => fs.existsSync(i))

      if (testCustomServe) {
        // 同目录 serve.ts/js 接管服务生命周期；preServe 先完成，再取得服务和导出的 viteServer。
        const mod = await import(testCustomServe)
        const serve = mod.serve || mod.default?.serve
        const preServe = mod.preServe || mod.default?.preServe
        if (preServe) {
          await preServe()
        }
        if (serve) {
          server = await serve()
          viteServer = mod.viteServer
        }
      } else {
        await startDefaultServe()
      }
    }
  } catch (e) {
    // setup 失败时先关闭页面和已启动服务，再抛原错误；避免后续 page.click 超时遮住构建根因。
    await page.close()
    await server?.close()
    throw e
  }

  return async () => {
    serverLogs.length = 0
    await page?.close()
    await server?.close()
    await watcher?.close()
    if (browser) {
      await browser.close()
    }
  }
})

/**
 * 按 variant 配置优先、fixture root 默认配置兜底的顺序加载，并合并测试 logger、polling 与解析错误插件。
 * 最后强制 bundled-dev 标记，避免 fixture 自己的配置关闭本次测试要求的模式。
 */
async function loadConfig(configEnv: ConfigEnv) {
  let config: UserConfig | null = null

  // variant spec 所在目录名对应 vite.config-<variant>.js；文件存在且加载成功才采用它。
  const variantName = path.basename(path.dirname(testPath))
  if (variantName !== '__tests__') {
    const configVariantPath = path.resolve(
      rootDir,
      `vite.config-${variantName}.js`,
    )
    if (fs.existsSync(configVariantPath)) {
      const res = await loadConfigFromFile(configEnv, configVariantPath)
      if (res) {
        config = res.config
      }
    }
  }
  // 没有可用 variant 配置时，按 Vite 默认规则从 fixture root 查配置文件。
  if (!config) {
    const res = await loadConfigFromFile(configEnv, undefined, rootDir)
    if (res) {
      config = res.config
    }
  }

  const options: InlineConfig = {
    root: rootDir,
    logLevel: 'silent',
    configFile: false,
    server: {
      watch: {
        // 测试短时间反复改文件，强制 100ms polling；editFile 同时要求字节长度变化，避免漏报。
        usePolling: true,
        interval: 100,
      },
    },
    build: {
      // 测试使用 esnext 目标，减少降级转换，并保留库输出供 tree-shaking / 注解检查的语法形状。
      target: 'esnext',
    },
    customLogger: createInMemoryLogger(serverLogs),
    plugins: [throwHtmlParseError()],
  }
  let merged = mergeConfig(options, config || {})
  // 放在合并之后，确保 bundled-dev 测试不能被 fixture 的 experimental 配置关闭。
  if (isBundledDev) {
    merged = mergeConfig(merged, { experimental: { bundledDev: true } })
  }
  return merged
}

/**
 * 默认 fixture 启动器：serve 创建并监听 Vite；build 完成打包/首轮 watch 后启动 preview，再导航 page。
 * bundled-dev 额外等待首次 bundle 结果与客户端就绪，使后续修改不会落在占位页或无连接窗口中。
 */
export async function startDefaultServe(): Promise<void> {
  setupConsoleWarnCollector(serverLogs)

  if (!isBuild) {
    process.env.VITE_INLINE = 'inline-serve'
    const config = await loadConfig({ command: 'serve', mode: 'development' })
    viteServer = server = await (await createServer(config)).listen()
    viteTestUrl = stripTrailingSlashIfNeeded(
      server.resolvedUrls.local[0],
      server.config.base,
    )
    await page.goto(viteTestUrl)
    // bundled-dev 首轮产物前是自重载占位页，先等待服务端完成或报错，再开始普通页面断言。
    // 首轮失败时由具体用例处理占位状态；hmr-full-bundle-mode 要测占位页本身，因此跳过这段等待。
    if (isBundledDev && testName !== 'hmr-full-bundle-mode') {
      // harness 读取内部构建标记；这些字段用于测试等待，不属于扩大后的公开 API。
      const bundledDev = server.environments.client.bundledDev as any
      if (bundledDev) {
        await vi.waitUntil(
          () => bundledDev.initialBuildCompleted || bundledDev.lastBuildError,
          { timeout: 40_000 },
        )
      }
      if (bundledDev?.initialBuildCompleted) {
        await page
          .waitForFunction(
            () => !(globalThis as any).__vite_is_fallback_page__,
            undefined,
            { timeout: 15_000 },
          )
          .catch(() => {})
        // TODO：无客户端连接时修改会丢失（vitejs/vite#23028），因此等客户端在服务端注册后才继续。
        // 完成加载但从未注入 runtime 的 SSR 等页面无法注册 client，直接视为就绪。
        await vi.waitUntil(
          async () => {
            const state = await page
              .evaluate(() => ({
                loaded: document.readyState === 'complete',
                hasRuntime: !!(globalThis as any).__rolldown_runtime__,
                clientId: (globalThis as any).__rolldown_runtime__?.clientId,
              }))
              .catch(() => undefined)
            if (!state) return false
            if (state.clientId && bundledDev.clients?.get(state.clientId)) {
              return true
            }
            return state.loaded && !state.hasRuntime
          },
          { timeout: 10_000 },
        )
      }
    }
  } else {
    process.env.VITE_INLINE = 'inline-build'
    let resolvedConfig: ResolvedConfig
    /** 捕获本轮 resolvedConfig，用最终 build.watch 值决定是否等待首轮 END 事件。 */
    const resolvedPlugin: () => PluginOption = () => ({
      name: 'vite-plugin-watcher',
      /** 保存最终配置供 build 返回后检查 watch 模式。 */
      configResolved(config) {
        resolvedConfig = config
      },
    })
    const buildConfig = mergeConfig(
      await loadConfig({ command: 'build', mode: 'production' }),
      {
        plugins: [resolvedPlugin()],
      },
    )
    if (buildConfig.builder) {
      const builder = await createBuilder(buildConfig)
      await builder.buildApp()
    } else {
      const rollupOutput = await build(buildConfig)
      const isWatch = !!resolvedConfig!.build.watch
      // watch 返回的是 watcher，必须等 END 再开始 preview，避免读取尚未生成的输出。
      if (isWatch) {
        watcher = rollupOutput as RolldownWatcher
        await notifyRebuildComplete(watcher)
      }
      if (buildConfig.__test__) {
        buildConfig.__test__()
      }
    }

    const previewConfig = await loadConfig({
      command: 'serve',
      mode: 'development',
      isPreview: true,
    })
    const _nodeEnv = process.env.NODE_ENV
    const previewServer = await preview(previewConfig)
    // preview 内部可能调整 NODE_ENV；测试恢复先前值，使后续用例仍处于当前测试模式。
    process.env.NODE_ENV = _nodeEnv
    viteTestUrl = stripTrailingSlashIfNeeded(
      previewServer.resolvedUrls.local[0],
      previewServer.config.base,
    )
    await page.goto(viteTestUrl)
  }
}

/**
 * 等待 RolldownWatcher 的下一次 END 事件，再卸载本次监听；供首轮 watch 与修改后重构建同步。
 */
export async function notifyRebuildComplete(
  watcher: RolldownWatcher,
): Promise<void> {
  let resolveFn: undefined | (() => void)
  /** 只把 END 视为整轮构建完成，其他 bundle 事件不结束当前等待。 */
  const callback = (event: RolldownWatcherEvent): void => {
    if (event.code === 'END') {
      resolveFn?.()
    }
  }
  watcher.on('event', callback)
  await new Promise<void>((resolve) => {
    resolveFn = resolve
  })

  watcher.off('event', callback)
}

/** 创建可断言 logger：保留消息文本、warnOnce 去重状态，以及以对象身份记录的已报告错误。 */
export function createInMemoryLogger(logs: string[]): Logger {
  const loggedErrors = new WeakSet<Error | RollupError>()
  const warnedMessages = new Set<string>()

  const logger: Logger = {
    hasWarned: false,
    /** 按错误对象身份查询是否已通过 error(msg, { error }) 记录，避免重复报告。 */
    hasErrorLogged: (err) => loggedErrors.has(err),
    /** 测试保留全部日志，不执行终端清屏。 */
    clearScreen: () => {},
    /** 收集 info 文本，不向真实终端输出。 */
    info(msg) {
      logs.push(msg)
    },
    /** 收集警告并设置 hasWarned，供警告分支与日志断言使用。 */
    warn(msg) {
      logs.push(msg)
      logger.hasWarned = true
    },
    /** 同一警告文本只追加一次；首次同时设置 hasWarned。 */
    warnOnce(msg) {
      if (warnedMessages.has(msg)) return
      logs.push(msg)
      logger.hasWarned = true
      warnedMessages.add(msg)
    },
    /** 收集错误文本，并在给出 opts.error 时把错误对象纳入已报告集合。 */
    error(msg, opts) {
      logs.push(msg)
      if (opts?.error) {
        loggedErrors.add(opts.error)
      }
    },
  }

  return logger
}

/** 包装 console.warn，同时收集格式化参数并继续调用原 warn，补获不经 Vite logger 的警告。 */
function setupConsoleWarnCollector(logs: string[]) {
  const warn = console.warn
  /** 将参数以空格拼接加入本例日志，再转发给原 console.warn。 */
  console.warn = (...args) => {
    logs.push(args.join(' '))
    return warn.call(console, ...args)
  }
}

/** 将 Windows 路径分隔符改成 /，用于跨平台匹配 playground 路径。 */
export function slash(p: string): string {
  return p.replace(/\\/g, '/')
}

/** 仅 root base 移除 resolved URL 尾斜杠，让测试直接拼接 /path；非根 base 保留本来路径形式。 */
function stripTrailingSlashIfNeeded(url: string, base: string): string {
  if (base === '/') {
    return url.replace(/\/$/, '')
  }
  return url
}

/** 合并 Vite 用户配置的测试专用钩子类型，使 playground 配置可声明 __test__。 */
declare module 'vite' {
  /** playground 测试配置扩展：允许构建结束后、preview 开始前执行自定义产物检查或准备。 */
  export interface UserConfig {
    /**
     * 默认 build 路径调用的测试专用钩子，在非 builder 分支完成打包/首轮 watch 后、preview 前执行。
     */
    __test__?: () => void
  }
}

/** 扩展 Vitest 注入上下文，使各 spec 可类型安全地取得全局 Chromium endpoint。 */
declare module 'vitest' {
  /** 全局 setup 向各 spec 注入的共享 Chromium Server 连接信息。 */
  export interface ProvidedContext {
    /** chromium.launchServer 的 WebSocket endpoint；每个文件据此创建自己的 browser 连接与 page。 */
    wsEndpoint: string
  }
}
