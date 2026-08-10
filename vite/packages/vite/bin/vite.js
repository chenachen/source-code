#!/usr/bin/env node
import { performance } from 'node:perf_hooks'
import module from 'node:module'

/**
 * Vite 命令行的 Node.js 入口。
 *
 * `package.json#bin` 指向本文件。这里先完成源码映射、调试日志、CPU 性能分析和
 * Node.js 编译缓存等必须早于 CLI 主模块执行的初始化，最后才动态导入构建后的
 * `dist/node/cli.js`。因此，阅读启动链时应把本文件看成“前置引导层”，而
 * `src/node/cli.ts` 才是命令注册与任务分发层。
 */

// 直接在 Vite 仓库中开发时才启用这些诊断能力；用户从 node_modules 执行 Vite
// 时不需要它们，也应避免改变用户进程的全局错误处理行为。
if (!import.meta.url.includes('node_modules')) {
  if (!process.env.DEBUG_DISABLE_SOURCE_MAP) {
    // 仅用于开发 Vite；最低支持版本之外的 Node.js 内置 API 由该条件保护。
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    process.setSourceMapsEnabled(true)
  }

  // 将未处理的 Promise 拒绝提升为带 cause 的异常，避免开发 Vite 时第三方配置
  // 加载错误被静默吞掉。该场景曾影响 PostCSS 配置错误的定位（#18886）。
  process.on('unhandledRejection', (err) => {
    throw new Error('UNHANDLED PROMISE REJECTION', { cause: err })
  })
}

/** CLI 入口开始执行的高精度时间，用于主模块打印 `ready in ... ms`。 */
global.__vite_start_time = performance.now()

// 必须在导入 CLI 主模块前解析调试参数，因为后续模块会在模块求值阶段创建调试器，
// 若稍后才设置 DEBUG，相应命名空间不会被启用。
/** `-d/--debug` 在 argv 中的位置；不存在时为 -1。 */
const debugIndex = process.argv.findIndex((arg) => /^(?:-d|--debug)$/.test(arg))
/** `-f/--filter` 在 argv 中的位置，用于进一步过滤调试日志。 */
const filterIndex = process.argv.findIndex((arg) =>
  /^(?:-f|--filter)$/.test(arg),
)
/** 隐藏的 `--profile` 参数位置，用于在加载 CLI 前启动 V8 CPU Profiler。 */
const profileIndex = process.argv.indexOf('--profile')

if (debugIndex > 0) {
  let value = process.argv[debugIndex + 1]
  if (!value || value[0] === '-') {
    value = 'vite:*'
  } else {
    // 支持 `--debug hmr,resolve`：补齐 Vite 调试命名空间后交给 debug 库解析。
    value = value
      .split(',')
      .map((v) => `vite:${v}`)
      .join(',')
  }
  // 合并而非覆盖调用方已有的 DEBUG，否则在同一进程中开启的其他库日志会消失。
  // 该行为对应 #6504。
  process.env.DEBUG = `${
    process.env.DEBUG ? process.env.DEBUG + ',' : ''
  }${value}`

  if (filterIndex > 0) {
    const filter = process.argv[filterIndex + 1]
    if (filter && filter[0] !== '-') {
      process.env.VITE_DEBUG_FILTER = filter
    }
  }
}

/**
 * 开启可用的 Node.js 编译缓存并加载 CLI 主模块。
 *
 * 编译缓存不是 Vite 的模块转换缓存；它缓存 Node.js 编译 Vite 自身模块的结果，
 * 用于缩短后续 CLI 启动时间。所有 API 都使用可选调用并包在 `try` 中，旧版
 * Node.js 或缓存目录不可写时仍可正常启动。
 *
 * @returns CLI 主模块的动态导入 Promise。
 * @see https://github.com/vitejs/vite/pull/18323
 * @see https://github.com/vitejs/vite/pull/19537
 */
function start() {
  try {
    // Node 22.8+ 才提供；API 不存在时可选调用直接跳过。
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    module.enableCompileCache?.()
    // Node 默认仅在进程结束时写出编译缓存。开发服务器通常长期运行，并可能由
    // `process.exit` 直接结束；若不主动写出，本次编译结果无法惠及下一次启动。
    // 不能放在 SIGINT 处理器中同步等待：实践中该方式可能令退出过程挂起。
    // 因此启动 10 秒后尽力写出一次，并用 unref() 防止定时器阻止短命令退出。
    setTimeout(() => {
      try {
        // Node 22.12+ 才提供；API 不存在或写缓存失败都不应中断 Vite。
        // eslint-disable-next-line n/no-unsupported-features/node-builtins
        module.flushCompileCache?.()
      } catch {}
    }, 10 * 1000).unref()
  } catch {}
  return import('../dist/node/cli.js')
}

if (profileIndex > 0) {
  // `--profile` 只属于入口引导层，必须从 argv 删除，避免 cac 将它当成未知选项。
  // Profiler.start 完成后才调用 start，确保 CLI 模块加载成本也进入采样结果。
  process.argv.splice(profileIndex, 1)
  const next = process.argv[profileIndex]
  if (next && next[0] !== '-') {
    process.argv.splice(profileIndex, 1)
  }
  const inspector = await import('node:inspector').then((r) => r.default)
  const session = (global.__vite_profile_session = new inspector.Session())
  session.connect()
  session.post('Profiler.enable', () => {
    session.post('Profiler.start', start)
  })
} else {
  start()
}
