import type { ForwardConsolePayload } from '#types/customEvent'
import {
  type NormalizedModuleRunnerTransport,
  SendBeforeConnectError,
} from './moduleRunnerTransport'

/** 可由客户端 console 转发到开发服务器的日志级别；开放字符串允许自定义 console 方法。 */
export type ForwardConsoleLogLevel =
  | 'error'
  | 'warn'
  | 'info'
  | 'log'
  | 'debug'
  | (string & {})

/** 用户侧 forward-console 开关与可选日志级别。 */
export interface ForwardConsoleOptions {
  /** 是否转发 window error 与 unhandledrejection。 */
  unhandledErrors?: boolean
  /** 要包装的 console 方法名。 */
  logLevels?: ForwardConsoleLogLevel[]
}

/** 合并布尔简写与默认值后的 forward-console 配置。 */
export interface ResolvedForwardConsoleOptions {
  /** 是否安装任何 console/error handler。 */
  enabled: boolean
  /** 是否监听未处理错误。 */
  unhandledErrors: boolean
  /** 实际要包装的 console 方法。 */
  logLevels: ForwardConsoleLogLevel[]
}

/**
 * 在客户端包装指定 console 方法并监听未处理错误，通过 ModuleRunner transport 转发给
 * Vite server。原 console 始终先执行，所以网络失败不能吞掉浏览器本地日志。
 * console 调用不等待发送完成，各次发送可重叠；此函数只负责安装，不返回卸载器。
 * 不存在的 console 方法会跳过，window 事件则仅在浏览器中安装。
 *
 * @param transport - 已归一化的发送通道；连接尚未建立时的专用错误会被转发层忽略。
 * @param options - 已合并默认值的开关与方法集合，disabled 时不改动 console 或监听器。
 * @param console - 要包装的输出对象；保存其原 error 方法，供双重发送失败时回退。
 */
export function setupForwardConsoleHandler(
  transport: NormalizedModuleRunnerTransport,
  options: ResolvedForwardConsoleOptions,
  console: Console = globalThis.console,
): void {
  if (!options.enabled) {
    return
  }

  /**
   * 将 window 错误或拒绝原因缩为 name/message/stack 数据包。
   * 不在这里吞掉发送异常，让事件入口或 sendLog 决定是否回落原 console.error。
   */
  async function sendError(type: 'error' | 'unhandled-rejection', error: any) {
    await transport.send({
      type: 'custom',
      event: 'vite:forward-console',
      data: {
        type,
        data: {
          name: error?.name || 'Unknown Error',
          message: error?.message || String(error),
          stack: error?.stack,
        },
      } satisfies ForwardConsolePayload,
    })
  }

  /**
   * 格式化并发送一次 console 调用；格式化或发送失败后，再发送错误包。
   * 错误包也失败时仅记录最后一次失败，且避开包装后的 error，防止转发递归。
   */
  async function sendLog(level: ForwardConsoleLogLevel, args: unknown[]) {
    try {
      await transport.send({
        type: 'custom',
        event: 'vite:forward-console',
        data: {
          type: 'log',
          data: {
            level,
            message: formatConsoleArgs(args),
          },
        } satisfies ForwardConsolePayload,
      })
    } catch (err) {
      try {
        await sendError('unhandled-rejection', err)
      } catch (err) {
        // client 启动早期尚未 connect 是正常竞态；其他双重发送失败才回落原 console.error（#22450）。
        if (!(err instanceof SendBeforeConnectError)) {
          originalConsoleError('Failed to send error to Vite server:', err)
        }
      }
    }
  }

  // 保存未包装的 error，防止报告发送失败时递归进入刚安装的 forward handler。
  const originalConsoleError = console.error

  for (const level of options.logLevels) {
    const original = (console as any)[level]
    if (typeof original !== 'function') {
      continue
    }
    /** 同步调用保存的本地方法，再启动无需调用方等待的日志转发。 */
    ;(console as any)[level] = (...args: unknown[]) => {
      // 本地输出优先且不 await transport，保持 console 的同步调用体验。
      original(...args)
      sendLog(level, args)
    }
  }

  if (options.unhandledErrors && typeof window !== 'undefined') {
    window.addEventListener('error', async (event) => {
      // ErrorEvent 不保证含 error（如 ResizeObserver observation error），用 message 构造 Error 回退。
      // https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent/error
      // https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver#observation_errors
      const error =
        event.error ?? (event.message ? new Error(event.message) : event)
      try {
        await sendError('error', error)
      } catch (err) {
        if (!(err instanceof SendBeforeConnectError)) {
          originalConsoleError('Failed to send error to Vite server:', err)
        }
      }
    })

    window.addEventListener('unhandledrejection', async (event) => {
      try {
        await sendError('unhandled-rejection', event.reason)
      } catch (err) {
        if (!(err instanceof SendBeforeConnectError)) {
          originalConsoleError('Failed to send error to Vite server:', err)
        }
      }
    })
  }
}

// Vitest console formatter 的零额外依赖版本：
// https://github.com/vitest-dev/vitest/blob/a2d650e00dbd8220397c5c25aef05c850100e446/packages/utils/src/display.ts#L129
/**
 * 近似浏览器/Node console 的 `%s/%d/%i/%f/%j/%o/%O/%c/%%` 格式规则，并把剩余参数
 * 追加成文本。`%j` 的 JSON 序列化失败统一显示 `[Circular]`，其中也包括 BigInt 或 toJSON 抛错。
 * 第一个参数不是字符串时不解析占位符；参数不足时保留原占位符，`%%` 不消耗参数。
 * `%c` 消耗样式参数但不把它写入服务端文本，其余对象格式由 stringifyConsoleArg 处理。
 *
 * @returns 供 console 转发 payload 使用的单行参数文本；这里不写 console 或发送消息。
 */
export function formatConsoleArgs(args: unknown[]): string {
  if (args.length === 0) {
    return ''
  }

  if (typeof args[0] !== 'string') {
    return args.map((arg) => stringifyConsoleArg(arg)).join(' ')
  }

  const len = args.length
  let i = 1
  let message = args[0].replace(/%[sdjifoOc%]/g, (specifier) => {
    if (specifier === '%%') {
      return '%'
    }
    if (i >= len) {
      return specifier
    }

    const arg = args[i++]
    switch (specifier) {
      case '%s':
        if (typeof arg === 'bigint') {
          return `${arg.toString()}n`
        }
        return typeof arg === 'object' && arg != null
          ? stringifyConsoleArg(arg)
          : String(arg)
      case '%d':
        if (typeof arg === 'bigint') {
          return `${arg.toString()}n`
        }
        if (typeof arg === 'symbol') {
          return 'NaN'
        }
        return Number(arg).toString()
      case '%i':
        if (typeof arg === 'bigint') {
          return `${arg.toString()}n`
        }
        return Number.parseInt(String(arg), 10).toString()
      case '%f':
        return Number.parseFloat(String(arg)).toString()
      case '%o':
      case '%O':
        return stringifyConsoleArg(arg)
      case '%j':
        try {
          const serialized = JSON.stringify(arg)
          return serialized ?? 'undefined'
        } catch {
          return '[Circular]'
        }
      case '%c':
        return ''
      default:
        return specifier
    }
  })

  for (let arg = args[i]; i < len; arg = args[++i]) {
    if (arg == null || typeof arg !== 'object') {
      message += ` ${typeof arg === 'symbol' ? arg.toString() : String(arg)}`
    } else {
      message += ` ${stringifyConsoleArg(arg)}`
    }
  }

  return message
}

/**
 * 把单个 console 参数转成可跨 transport 的文本：保留 Error stack、函数名、BigInt 后缀，
 * 并用 WeakSet 标记已见对象（环或重复引用均显示 `[Circular]`）；JSON 失败时退回 String(value)。
 */
function stringifyConsoleArg(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return String(value)
  }
  if (typeof value === 'symbol') {
    return value.toString()
  }
  if (typeof value === 'function') {
    return value.name ? `[Function: ${value.name}]` : '[Function]'
  }
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`
  }
  if (typeof value === 'bigint') {
    return `${value}n`
  }

  const seen = new WeakSet<object>()
  try {
    const serialized = JSON.stringify(value, (_, nested) => {
      if (typeof nested === 'bigint') {
        return `${nested}n`
      }
      if (nested instanceof Error) {
        return {
          name: nested.name,
          message: nested.message,
          stack: nested.stack,
        }
      }
      if (nested && typeof nested === 'object') {
        if (seen.has(nested)) {
          return '[Circular]'
        }
        seen.add(nested)
      }
      return nested
    })
    return serialized ?? String(value)
  } catch {
    return String(value)
  }
}
