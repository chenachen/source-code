import path from 'node:path'
import { stripVTControlCharacters as strip } from 'node:util'
import colors from 'picocolors'
import type { RollupError } from 'rolldown'
import type { Connect } from '#dep-types/connect'
import type { ErrorPayload } from '#types/hmrPayload'
import { pad } from '../../utils'
import type { ViteDevServer } from '../..'
import { CLIENT_PUBLIC_PATH } from '../../constants'

/**
 * 把内部 Error/RolldownError 收敛为可发送给浏览器 ErrorOverlay 的安全字段。
 * 同时移除终端控制字符；部分插件（如 PostCSS）会把完整对象挂到错误上，不能直接序列化。
 */
export function prepareError(err: Error | RollupError): ErrorPayload['err'] {
  return {
    message: strip(err.message),
    stack: strip(cleanStack(err.stack || '')),
    id: (err as RollupError).id,
    frame: strip((err as RollupError).frame || ''),
    plugin: (err as RollupError).plugin,
    pluginCode: (err as RollupError).pluginCode?.toString(),
    loc: (err as RollupError).loc,
  }
}

/** 按“插件 → 文件位置 → 代码帧 → stack”组装适合终端显示的多行错误。 */
export function buildErrorMessage(
  err: RollupError,
  args: string[] = [],
  includeStack = true,
): string {
  if (err.plugin) args.push(`  Plugin: ${colors.magenta(err.plugin)}`)
  const loc = err.loc ? `:${err.loc.line}:${err.loc.column}` : ''
  if (err.id) args.push(`  File: ${colors.cyan(err.id)}${loc}`)
  if (err.frame) args.push(colors.yellow(pad(err.frame)))
  if (includeStack && err.stack) args.push(pad(cleanStack(err.stack)))
  return args.join('\n')
}

/** 只保留 stack 的调用帧，去掉与终端主错误信息重复的首行 message。 */
function cleanStack(stack: string) {
  return stack
    .split(/\n/)
    .filter((l) => /^\s*at/.test(l))
    .join('\n')
}

/** 同时把错误写入终端，并通过 client HotChannel 推送到浏览器 Overlay。 */
export function logError(server: ViteDevServer, err: RollupError): void {
  const msg = buildErrorMessage(err, [
    colors.red(`Internal server error: ${err.message}`),
  ])

  server.config.logger.error(msg, {
    clear: true,
    timestamp: true,
    error: err,
  })

  server.environments.client.hot.send({
    type: 'error',
    err: prepareError(err),
  })
}

/**
 * Connect 最末端错误处理器。独立模式返回可自举 ErrorOverlay 的 500 HTML；middleware mode
 * 使用 allowNext，把响应权交给宿主后续中间件；无参数 next() 不继续传递原错误。
 */
export function errorMiddleware(
  server: ViteDevServer,
  allowNext = false,
): Connect.ErrorHandleFunction {
  // 必须保留四个形参，Connect 以函数 arity 区分普通/错误中间件；同时保留命名函数供
  // `DEBUG=connect:dispatcher` 显示。
  /** 先记录并推送错误；allowNext 时不带错误推进宿主栈，否则结束为含 overlay 的 500 页面。 */
  return function viteErrorMiddleware(err: RollupError, _req, res, next) {
    logError(server, err)

    if (allowNext) {
      next()
    } else {
      res.statusCode = 500
      res.end(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <title>Error</title>
            <script type="module">
              const error = ${JSON.stringify(prepareError(err)).replace(
                /</g,
                '\\u003c',
              )}
              try {
                const { ErrorOverlay } = await import(${JSON.stringify(path.posix.join(server.config.base, CLIENT_PUBLIC_PATH))})
                document.body.appendChild(new ErrorOverlay(error))
              } catch {
                const h = (tag, text) => {
                  const el = document.createElement(tag)
                  el.textContent = text
                  return el
                }
                document.body.appendChild(h('h1', 'Internal Server Error'))
                document.body.appendChild(h('h2', error.message))
                document.body.appendChild(h('pre', error.stack))
                document.body.appendChild(h('p', '(Error overlay failed to load)'))
              }
            </script>
          </head>
          <body>
          </body>
        </html>
      `)
    }
  }
}
