/* eslint no-console: 0 */

import readline from 'node:readline'
import colors from 'picocolors'
import type { RollupError } from 'rolldown'
import type { ResolvedServerUrls } from './server'

/** Vite 可输出的日志类别，以及包含完全静默档位的配置级别。 */
export type LogType = 'error' | 'warn' | 'info'
/** Logger 的最低输出级别；silent 禁止全部输出。 */
export type LogLevel = LogType | 'silent'

/**
 * Vite 内部与插件共享的最小日志接口。
 *
 * `hasWarned` 记录是否调用过警告/错误方法；调用方可先查询 `hasErrorLogged`，
 * 再决定是否打印同一个错误对象。`error()` 本身不会按对象身份跳过输出。
 */
export interface Logger {
  /** 输出普通运行信息。 */
  info(msg: string, options?: LogOptions): void
  /** 输出警告并把 hasWarned 置为 true。 */
  warn(msg: string, options?: LogOptions): void
  /** 同一完整文本只尝试输出一次；被级别过滤的首次调用也会登记。 */
  warnOnce(msg: string, options?: LogOptions): void
  /** 输出错误并按需登记原始错误对象。 */
  error(msg: string, options?: LogErrorOptions): void
  /** 在允许的日志级别与终端环境下清理可见区域。 */
  clearScreen(type: LogType): void
  /** 判断同一错误对象是否已交给 logger 输出。 */
  hasErrorLogged(error: Error | RollupError): boolean
  /** 是否调用过 warn/warnOnce/error；即使级别过滤了输出也会置为 true。 */
  hasWarned: boolean
}

/** 单条普通日志可控制的格式化与显示选项。 */
export interface LogOptions {
  /** 输出前是否清屏；只在可交互 TTY 且非 CI 环境生效。 */
  clear?: boolean
  /** 是否添加时间、Vite 前缀及环境名。 */
  timestamp?: boolean
  /** 多环境模式下标记日志来源的环境名。 */
  environment?: string
}

/** 错误日志在普通格式选项之外携带的去重身份。 */
export interface LogErrorOptions extends LogOptions {
  /** 错误登记使用的对象身份；默认 logger 仅在当前级别允许输出时登记。 */
  error?: Error | RollupError | null
}

/** 日志级别的数值阈值；数值越大，允许输出的类别越多。 */
export const LogLevels: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
}

// 最近一次日志状态由所有默认 logger 共享，用于开发服务器清屏刷新时合并连续
// 相同消息；仅在可清屏 TTY 中使用，不会吞掉 CI 或重定向输出。
let lastType: LogType | undefined
let lastMsg: string | undefined
let sameCount = 0

/** 清空当前终端可见区域，同时兼容终端行数不足的情况。 */
function clearScreen() {
  const repeatCount = process.stdout.rows - 2
  const blank = repeatCount > 0 ? '\n'.repeat(repeatCount) : ''
  console.log(blank)
  readline.cursorTo(process.stdout, 0, 0)
  readline.clearScreenDown(process.stdout)
}

/** 创建 Logger 时固定的输出目标、前缀和清屏策略。 */
export interface LoggerOptions {
  /** 时间戳模式下显示的产品前缀。 */
  prefix?: string
  /** 是否允许 Vite 为刷新式日志清屏。 */
  allowClearScreen?: boolean
  /** 完全接管日志行为的自定义实现；存在时忽略其余选项。 */
  customLogger?: Logger
  /** 注入日志输出目标；清屏仍操作全局 console 与 process.stdout。 */
  console?: Console
}

// 只有首次请求时间戳时才创建 formatter，并在所有 logger 之间复用，避免普通
// 开发请求支付 Intl 初始化成本（#15574 对日志热路径的性能优化场景）。
let timeFormatter: Intl.DateTimeFormat
/** 获取惰性初始化、可复用的本地时间格式器。 */
function getTimeFormatter() {
  timeFormatter ??= new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  return timeFormatter
}

/**
 * 创建带级别过滤、重复消息折叠、一次性警告和错误登记能力的 Vite logger。
 *
 * 可交互终端中，连续相同日志会清屏后更新为 `(xN)`；CI、管道输出或禁用清屏
 * 时采用追加输出。`warnOnce` 仍按文本过滤，错误身份去重由调用方查询后决定。
 * `console` 注入支持嵌入式宿主（#18379）。
 */
export function createLogger(
  level: LogLevel = 'info',
  options: LoggerOptions = {},
): Logger {
  if (options.customLogger) {
    return options.customLogger
  }

  // 登记实际获准输出的错误对象，供 hasErrorLogged 查询；弱引用不延长错误生命周期。
  const loggedErrors = new WeakSet<Error | RollupError>()
  const {
    prefix = '[vite]',
    allowClearScreen = true,
    console = globalThis.console,
  } = options
  const thresh = LogLevels[level]
  const canClearScreen =
    allowClearScreen && process.stdout.isTTY && !process.env.CI
  /** 可交互且获准清屏时委托终端清理，其余输出环境使用空操作。 */
  const clear = canClearScreen ? clearScreen : () => {}

  /** 只负责表现层格式化，不改变级别判断或错误登记。 */
  function format(type: LogType, msg: string, options: LogErrorOptions = {}) {
    if (options.timestamp) {
      let tag = ''
      if (type === 'info') {
        tag = colors.cyan(colors.bold(prefix))
      } else if (type === 'warn') {
        tag = colors.yellow(colors.bold(prefix))
      } else {
        tag = colors.red(colors.bold(prefix))
      }
      const environment = options.environment ? options.environment + ' ' : ''
      return `${colors.dim(getTimeFormatter().format(new Date()))} ${tag} ${environment}${msg}`
    } else {
      return msg
    }
  }

  /** 执行阈值过滤，并根据终端能力选择刷新式或追加式输出。 */
  function output(type: LogType, msg: string, options: LogErrorOptions = {}) {
    if (thresh >= LogLevels[type]) {
      const method = type === 'info' ? 'log' : type

      if (options.error) {
        loggedErrors.add(options.error)
      }
      if (canClearScreen) {
        if (type === lastType && msg === lastMsg) {
          sameCount++
          clear()
          console[method](
            format(type, msg, options),
            colors.yellow(`(x${sameCount + 1})`),
          )
        } else {
          sameCount = 0
          lastMsg = msg
          lastType = type
          if (options.clear) {
            clear()
          }
          console[method](format(type, msg, options))
        }
      } else {
        console[method](format(type, msg, options))
      }
    }
  }

  /** `warnOnce` 已见过的完整消息；按文本而非调用位置去重。 */
  const warnedMessages = new Set<string>()

  const logger: Logger = {
    hasWarned: false,
    /** 输出 info，不改变警告状态。 */
    info(msg, opts) {
      output('info', msg, opts)
    },
    /** 标记已警告后按 warn 阈值输出。 */
    warn(msg, opts) {
      logger.hasWarned = true
      output('warn', msg, opts)
    },
    /** 仅在消息首次出现时输出并登记。 */
    warnOnce(msg, opts) {
      if (warnedMessages.has(msg)) return
      logger.hasWarned = true
      output('warn', msg, opts)
      warnedMessages.add(msg)
    },
    /** 标记已警告后按 error 阈值输出。 */
    error(msg, opts) {
      logger.hasWarned = true
      output('error', msg, opts)
    },
    /** 仅在当前级别允许该类别时执行清屏。 */
    clearScreen(type) {
      if (thresh >= LogLevels[type]) {
        clear()
      }
    },
    /** 查询错误对象是否已被 output 登记。 */
    hasErrorLogged(error) {
      return loggedErrors.has(error)
    },
  }

  return logger
}

/** 网络接口标签的最大显示宽度，避免过长名称破坏 URL 列对齐。 */
const maxNetworkInterfaceNameLength = 20

/**
 * 打印开发/预览服务器地址，并将局域网 URL 与网卡名按列对齐。
 *
 * 同时监听多个接口时，`networkInterfaceNames` 与 `network` 按索引对应；标签会
 * 截断到固定宽度，这是 #22830 增加网卡辨识信息时保留可读性的场景。未传
 * `--host` 且没有网络地址时，额外提示如何将服务暴露到局域网。
 */
export function printServerUrls(
  urls: ResolvedServerUrls,
  optionsHost: string | boolean | undefined,
  info: Logger['info'],
): void {
  /** 高亮 URL 端口，保持其余地址文本可直接复制。 */
  const colorUrl = (url: string) =>
    colors.cyan(url.replace(/:(\d+)\//, (_, port) => `:${colors.bold(port)}/`))
  for (const url of urls.local) {
    info(`  ${colors.green('➜')}  ${colors.bold('Local')}:   ${colorUrl(url)}`)
  }
  const networkUrlMaxLength = Math.max(
    ...urls.network.map((url) => url.length),
    0,
  )
  urls.network.forEach((url, index) => {
    const interfaceName = urls.networkInterfaceNames?.[index]
    let suffix = ''
    if (interfaceName) {
      const label =
        interfaceName.length > maxNetworkInterfaceNameLength
          ? `${interfaceName.slice(0, maxNetworkInterfaceNameLength - 1)}…`
          : interfaceName
      suffix =
        ' '.repeat(networkUrlMaxLength - url.length + 2) + colors.dim(label)
    }
    info(
      `  ${colors.green('➜')}  ${colors.bold('Network')}: ${colorUrl(url)}${suffix}`,
    )
  })
  if (urls.network.length === 0 && optionsHost === undefined) {
    info(
      colors.dim(`  ${colors.green('➜')}  ${colors.bold('Network')}: use `) +
        colors.bold('--host') +
        colors.dim(' to expose'),
    )
  }
}
