import colors from 'picocolors'
import type { FutureOptions, ResolvedConfig } from './config'

/** 所有迁移文档短链共享的官方站点根地址。 */
const docsURL = 'https://vite.dev'

/** future 配置项到对应迁移文档短链的映射。 */
const deprecationCode = {
  removePluginHookSsrArgument: 'this-environment-in-hooks',
  removePluginHookHandleHotUpdate: 'hotupdate-hook',

  removeServerModuleGraph: 'per-environment-apis',
  removeServerReloadModule: 'per-environment-apis',
  removeServerPluginContainer: 'per-environment-apis',
  removeServerHot: 'per-environment-apis',
  removeServerTransformRequest: 'per-environment-apis',
  removeServerWarmupRequest: 'per-environment-apis',

  removeSsrLoadModule: 'ssr-using-modulerunner',
} satisfies Record<keyof FutureOptions, string>

/** 每项 future 开关触发时显示的迁移摘要；键必须与 FutureOptions 对齐。 */
const deprecationMessages = {
  removePluginHookSsrArgument:
    "Plugin hook `options.ssr` is replaced with `this.environment.config.consumer === 'server'`.",
  removePluginHookHandleHotUpdate:
    'Plugin hook `handleHotUpdate()` is replaced with `hotUpdate()`.',

  removeServerModuleGraph:
    'The `server.moduleGraph` is replaced with `this.environment.moduleGraph`.',
  removeServerReloadModule:
    'The `server.reloadModule` is replaced with `environment.reloadModule`.',
  removeServerPluginContainer:
    'The `server.pluginContainer` is replaced with `this.environment.pluginContainer`.',
  removeServerHot: 'The `server.hot` is replaced with `this.environment.hot`.',
  removeServerTransformRequest:
    'The `server.transformRequest` is replaced with `this.environment.transformRequest`.',
  removeServerWarmupRequest:
    'The `server.warmupRequest` is replaced with `this.environment.warmupRequest`.',

  removeSsrLoadModule:
    'The `server.ssrLoadModule` is replaced with Environment Runner.',
} satisfies Record<keyof FutureOptions, string>

/** 同步作用域内的全局静默标记，供内部兼容调用避免重复告警。 */
let _ignoreDeprecationWarnings = false

/** 判断某项未来弃用行为是否已配置为启用（包括 `'warn'` 模式）。 */
export function isFutureDeprecationEnabled(
  config: ResolvedConfig,
  type: keyof FutureOptions,
): boolean {
  return !!config.future?.[type]
}

// 当这些变更正式进入弃用周期后，可再抽象不依赖 future 开关的 warnDeprecation。
/**
 * 按 `future.<type> = 'warn'` 的配置发出未来弃用警告。
 *
 * 消息包含替代 API、迁移文档，以及默认开启的调用栈。调用栈会过滤 Vite
 * 自身 dist 路径，让用户优先看到项目或插件的触发位置。最终通过 `warnOnce`
 * 按完整消息去重；附带调用栈时，不同调用位置仍可能各输出一次。
 *
 * @param extraMessage 当前调用点需要补充的迁移上下文
 * @param stacktrace 是否附带调用栈；已知调用点足够明确时可关闭
 */
export function warnFutureDeprecation(
  config: ResolvedConfig,
  type: keyof FutureOptions,
  extraMessage?: string,
  stacktrace = true,
): void {
  if (
    _ignoreDeprecationWarnings ||
    !config.future ||
    config.future[type] !== 'warn'
  )
    return

  let msg = `[vite future] ${deprecationMessages[type]}`
  if (extraMessage) {
    msg += ` ${extraMessage}`
  }
  msg = colors.yellow(msg)

  const docs = `${docsURL}/changes/${deprecationCode[type].toLowerCase()}`
  msg +=
    colors.gray(`\n  ${stacktrace ? '├' : '└'}─── `) +
    colors.underline(docs) +
    '\n'

  if (stacktrace) {
    const stack = new Error().stack
    if (stack) {
      let stacks = stack
        .split('\n')
        .slice(3)
        .filter((i) => !i.includes('/node_modules/vite/dist/'))
      if (stacks.length === 0) {
        stacks.push('No stack trace found.')
      }
      stacks = stacks.map(
        (i, idx) => `  ${idx === stacks.length - 1 ? '└' : '│'} ${i.trim()}`,
      )
      msg += colors.dim(stacks.join('\n')) + '\n'
    }
  }
  config.logger.warnOnce(msg)
}

/**
 * 在同步回调执行期间临时屏蔽 future 弃用告警，正常返回时恢复进入前的状态。
 *
 * Promise 返回后立即恢复，不等待异步工作；回调同步抛错会跳过恢复语句。
 */
export function ignoreDeprecationWarnings<T>(fn: () => T): T {
  const before = _ignoreDeprecationWarnings
  _ignoreDeprecationWarnings = true
  const ret = fn()
  _ignoreDeprecationWarnings = before
  return ret
}
