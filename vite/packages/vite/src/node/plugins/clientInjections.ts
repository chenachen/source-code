import path from 'node:path'
import fs from 'node:fs'
import type { Plugin } from '../plugin'
import type { ResolvedConfig } from '../config'
import { CLIENT_ENTRY, ENV_ENTRY, BUNDLED_DEV_CLIENT_ENTRY } from '../constants'
import { isObject, normalizePath, resolveHostname } from '../utils'
import { cleanUrl } from '../../shared/utils'
import { perEnvironmentState } from '../environment'
import { replaceDefine, serializeDefine } from './define'

// transform 收到的 id 已统一成 POSIX 形式；入口常量也预先规范化，避免 Windows 比较失败。
/** 普通 `/@vite/client` 的规范化磁盘入口。 */
const normalizedClientEntry = normalizePath(CLIENT_ENTRY)
/** bundled-dev HMR 实现的规范化磁盘入口。 */
const normalizedBundledDevClientEntry = normalizePath(BUNDLED_DEV_CLIENT_ENTRY)
/** `@vite/env` define 注入入口。 */
const normalizedEnvEntry = normalizePath(ENV_ENTRY)

/**
 * 把解析后的 mode/base/WebSocket/HMR/define 等服务端配置注入客户端运行时代码。
 *
 * 该插件只用于 unbundled environment；bundled environment 由 Rolldown 原生 define 和
 * `getHmrImplementation()` 处理。每个 Environment 的 define 独立缓存，避免 client/SSR 串值。
 * @server-only
 */
export function clientInjectionsPlugin(config: ResolvedConfig): Plugin {
  let injectConfigValues: (code: string) => string

  const getDefineReplacer = perEnvironmentState((environment) => {
    const userDefine: Record<string, any> = {}
    for (const key in environment.config.define) {
      // import.meta.env.* 由 importAnalysis 按模块环境处理；这里只注入真正的全局 define。
      if (!key.startsWith('import.meta.env.')) {
        userDefine[key] = environment.config.define[key]
      }
    }
    const serializedDefines = serializeDefine(userDefine)
    /** 返回已序列化 define 文本，避免字符串替换把美元符号解释为捕获组。 */
    const definesReplacement = () => serializedDefines
    return (code: string) => code.replace(`__DEFINES__`, definesReplacement)
  })

  return {
    name: 'vite:client-inject',
    /** 只在非 bundled 环境注入客户端常量；bundler 环境由产物侧机制负责。 */
    applyToEnvironment(environment) {
      return !environment.config.isBundled
    },
    /** 等待主机名解析完成，并生成本轮构建稳定复用的客户端配置替换器。 */
    async buildStart() {
      // hostname 解析可能异步，统一在 buildStart 完成后生成稳定替换闭包。
      injectConfigValues = await createClientConfigValueReplacer(config)
    },
    /** 向 client/env 入口注入运行时配置，其他模块仅替换 process.env.NODE_ENV。 */
    transform(code, id) {
      const ssr = this.environment.config.consumer === 'server'
      const cleanId = cleanUrl(id)
      if (cleanId === normalizedClientEntry || cleanId === normalizedEnvEntry) {
        const defineReplacer = getDefineReplacer(this)
        return defineReplacer(injectConfigValues(code))
      } else if (!ssr && code.includes('process.env.NODE_ENV')) {
        // 只替换表达式，不在 dev 伪造全局 process 对象，避免 dev/build 行为不一致。
        const nodeEnv =
          this.environment.config.define?.['process.env.NODE_ENV'] ||
          JSON.stringify(process.env.NODE_ENV || config.mode)
        return replaceDefine(this.environment, code, id, {
          'process.env.NODE_ENV': nodeEnv,
          'global.process.env.NODE_ENV': nodeEnv,
          'globalThis.process.env.NODE_ENV': nodeEnv,
        })
      }
    },
  }
}

/** 把配置值序列化为源码字面量，并返回可安全传给 String.replace 的函数 replacer。 */
function escapeReplacement(value: string | number | boolean | null) {
  const jsonValue = JSON.stringify(value)
  return () => jsonValue
}

/**
 * 解析客户端运行时全部编译期占位符，并返回链式替换函数。
 * WebSocket clientPort/port、middleware 默认端口、direct fallback 与 path/base 的优先级
 * 都在这里固化，client.ts 不再读取服务端配置对象。
 */
async function createClientConfigValueReplacer(
  config: ResolvedConfig,
): Promise<(code: string) => string> {
  const resolvedServerHostname = (await resolveHostname(config.server.host))
    .name
  const resolvedServerPort = config.server.port!
  const devBase = config.base

  const serverHost = `${resolvedServerHostname}:${resolvedServerPort}${devBase}`

  const wsConfig = isObject(config.server.ws) ? config.server.ws : undefined
  const host = wsConfig?.host || null
  const protocol = wsConfig?.protocol || null
  const timeout = wsConfig?.timeout || 30000
  const isWsServerSpecified = !!wsConfig?.server
  const hmrConfigName = path.basename(config.configFile || 'vite.config.js')

  const hmrConfig = isObject(config.server.hmr) ? config.server.hmr : undefined
  const overlay = hmrConfig?.overlay !== false

  // 端口优先级：ws.clientPort → ws.port → middleware 且未指定 WS server 时的 24678 →
  // 客户端运行时 new URL(import.meta.url).port。
  let port = wsConfig?.clientPort || wsConfig?.port || null
  if (config.server.middlewareMode && !isWsServerSpecified) {
    port ||= 24678
  }

  let directTarget = wsConfig?.host || resolvedServerHostname
  directTarget += `:${wsConfig?.port || resolvedServerPort}`
  directTarget += devBase

  let hmrBase = devBase
  if (wsConfig?.path) {
    hmrBase = path.posix.join(hmrBase, wsConfig.path)
  }

  const modeReplacement = escapeReplacement(config.mode)
  const baseReplacement = escapeReplacement(devBase)
  const serverHostReplacement = escapeReplacement(serverHost)
  const hmrProtocolReplacement = escapeReplacement(protocol)
  const hmrHostnameReplacement = escapeReplacement(host)
  const hmrPortReplacement = escapeReplacement(port)
  const hmrDirectTargetReplacement = escapeReplacement(directTarget)
  const hmrBaseReplacement = escapeReplacement(hmrBase)
  const hmrTimeoutReplacement = escapeReplacement(timeout)
  const hmrEnableOverlayReplacement = escapeReplacement(overlay)
  const hmrConfigNameReplacement = escapeReplacement(hmrConfigName)
  const wsTokenReplacement = escapeReplacement(config.webSocketToken)
  const serverForwardConsoleReplacement = escapeReplacement(
    config.server.forwardConsole as any,
  )

  return (code) =>
    code
      .replace(`__MODE__`, modeReplacement)
      .replace(/__BASE__/g, baseReplacement)
      .replace(`__SERVER_HOST__`, serverHostReplacement)
      .replace(`__HMR_PROTOCOL__`, hmrProtocolReplacement)
      .replace(`__HMR_HOSTNAME__`, hmrHostnameReplacement)
      .replace(`__HMR_PORT__`, hmrPortReplacement)
      .replace(`__HMR_DIRECT_TARGET__`, hmrDirectTargetReplacement)
      .replace(`__HMR_BASE__`, hmrBaseReplacement)
      .replace(`__HMR_TIMEOUT__`, hmrTimeoutReplacement)
      .replace(`__HMR_ENABLE_OVERLAY__`, hmrEnableOverlayReplacement)
      .replace(`__HMR_CONFIG_NAME__`, hmrConfigNameReplacement)
      .replace(`__WS_TOKEN__`, wsTokenReplacement)
      .replace(`__SERVER_FORWARD_CONSOLE__`, serverForwardConsoleReplacement)
}

/**
 * 读取并注入 bundled-dev 客户端实现，供服务端作为 Rolldown runtime HMR 代码内联。
 * runtime 不能再动态 import `@vite/env`，因此移除该副作用导入；define 已由 bundle 处理。
 */
export async function getHmrImplementation(
  config: ResolvedConfig,
): Promise<string> {
  const content = fs.readFileSync(normalizedBundledDevClientEntry, 'utf-8')
  const replacer = await createClientConfigValueReplacer(config)
  return (
    replacer(content)
      // Rolldown runtime 的内联实现不能再导入独立模块。
      .replace(/import\s*['"]@vite\/env['"]/, '')
  )
}
