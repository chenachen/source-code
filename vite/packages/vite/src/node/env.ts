import fs from 'node:fs'
import path from 'node:path'
// Vite 支持的 Node.js 版本已经提供 parseEnv；当前类型仍将它标为实验 API。
// eslint-disable-next-line n/no-unsupported-features/node-builtins
import { parseEnv } from 'node:util'
import { getEnvs } from '@voidzero-dev/vite-task-client'
import { type DotenvPopulateInput, expand } from 'dotenv-expand'
import colors from 'picocolors'
import { arraify, createDebugger, normalizePath, tryStatSync } from './utils'
import type { UserConfig } from './config'

/** `vite:env` 命名空间的调试输出器；未启用该命名空间时为 `undefined`。 */
const debug = createDebugger('vite:env')

/**
 * 计算指定 mode 需要读取和监听的环境文件。
 *
 * 数组顺序也是覆盖优先级：后面的 mode 文件覆盖前面的通用文件。`envDir: false`
 * 表示完全关闭 `.env` 加载，因此返回空数组，Dev Server 也不会监听环境文件变化。
 *
 * @param mode - 当前运行模式，例如 `development` 或 `production`。
 * @param envDir - 环境文件目录；`false` 表示禁用环境文件。
 * @returns 以 `envDir` 为基准并规范化为正斜杠的环境文件路径列表。
 * @see https://github.com/vitejs/vite/pull/19503
 */
export function getEnvFilesForMode(
  mode: string,
  envDir: string | false,
): string[] {
  if (envDir !== false) {
    return [
      /** 所有模式共享的默认环境文件。 */ `.env`,
      /** 所有模式共享、通常不提交版本库的本地覆盖文件。 */ `.env.local`,
      /** 仅当前 mode 使用的环境文件。 */ `.env.${mode}`,
      /** 当前 mode 的本地最高优先级覆盖文件。 */ `.env.${mode}.local`,
    ].map((file) => normalizePath(path.join(envDir, file)))
  }

  return []
}

/**
 * 加载 `envDir` 中当前 mode 对应的 `.env` 文件，并与 `process.env` 合并。
 *
 * 解析过程分三层：四个 `.env` 文件按顺序覆盖；Vite Task 补入远端任务环境变量；
 * 最后用启动 Vite 时已有的 `process.env` 覆盖。返回值只含命中 `prefixes` 的变量，
 * 后续才会暴露为客户端代码中的 `import.meta.env`。
 *
 * 本函数还会把 `.env` 中特殊的 `NODE_ENV`、`BROWSER`、`BROWSER_ARGS` 转存到
 * `process.env`，供 Vite 自身行为使用。`NODE_ENV` 会另存为带默认公开前缀的
 * `VITE_USER_NODE_ENV`，因此它也可能出现在返回结果中。
 *
 * @param mode - 当前运行模式；不能使用保留名称 `local`。
 * @param envDir - 环境文件目录；`false` 时仅合并 Vite Task 与 `process.env`。
 * @param prefixes - 允许暴露给客户端的变量名前缀，默认 `VITE_`。
 * @returns 展开变量引用并完成优先级合并后的客户端环境变量。
 */
export function loadEnv(
  mode: string,
  envDir: string | false,
  prefixes: string | string[] = 'VITE_',
): Record<string, string> {
  /** 环境加载计时起点，仅在 `vite:env` 调试日志中使用。 */
  const start = performance.now()
  /** 返回从加载开始到当前阶段的耗时文本。 */
  const getTime = () => `${(performance.now() - start).toFixed(2)}ms`

  // `.local` 已用于表示机器本地覆盖文件。若 mode 也叫 local，`.env.local` 同时会被
  // 解释成通用本地文件和 mode 文件，覆盖语义无法确定，所以直接拒绝。
  if (mode === 'local') {
    throw new Error(
      `"local" cannot be used as a mode name because it conflicts with ` +
        `the .local postfix for .env files.`,
    )
  }
  prefixes = arraify(prefixes)
  /** 最终允许注入客户端的环境变量集合。 */
  const env: Record<string, string> = {}
  /** 本 mode 按低到高优先级排列的候选环境文件。 */
  const envFiles = getEnvFilesForMode(mode, envDir)

  debug?.(`loading env files: %O`, envFiles)

  // 先把所有文件拍平成键值序列，再由 Object.fromEntries 让后出现的同名键覆盖前者。
  // 这样变量展开只执行一次，后加载文件中的变量也能被通用文件引用（#10113）。
  const parsed = Object.fromEntries(
    envFiles.flatMap((filePath) => {
      const stat = tryStatSync(filePath)
      // 除普通文件外也读取 FIFO。1Password 等密钥工具会把 `.env` 挂载为命名管道，
      // 只接受 isFile() 会误判为文件不存在（#21365）。目录和其他特殊文件仍跳过。
      if (!stat || (!stat.isFile() && !stat.isFIFO())) return []

      const parsedEnv = parseEnv(fs.readFileSync(filePath, 'utf-8'))
      return Object.entries(parsedEnv as Record<string, string>)
    }),
  )

  debug?.(`env files loaded in ${getTime()}`)

  // 必须在 expand 前保存 `.env` 明确声明的 NODE_ENV。展开过程可读取 process.env；
  // 若进程已有 NODE_ENV，它可能覆盖 parsed 中的值，导致构建无法请求开发行为
  //（例如进程为 production、`.env.testing` 声明 development，见 #11309）。
  if (parsed.NODE_ENV && process.env.VITE_USER_NODE_ENV === undefined) {
    process.env.VITE_USER_NODE_ENV = parsed.NODE_ENV
  }
  // 支持在 `.env` 中配置自动打开浏览器及其参数，但显式进程变量拥有更高优先级。
  if (parsed.BROWSER && process.env.BROWSER === undefined) {
    process.env.BROWSER = parsed.BROWSER
  }
  if (parsed.BROWSER_ARGS && process.env.BROWSER_ARGS === undefined) {
    process.env.BROWSER_ARGS = parsed.BROWSER_ARGS
  }

  // 允许 `VITE_URL=$VITE_HOST` 形式的变量引用。必须复制 process.env：dotenv-expand
  // 需要读取其中的外部变量，但不能把展开结果反写到全局进程环境，否则加载一个项目
  // 会污染同进程内后续项目或测试（#11213）。
  const processEnv = { ...process.env } as DotenvPopulateInput
  expand({ parsed, processEnv })

  // 第一层结果：只挑选允许公开的前缀。无前缀的数据库密码等服务端变量不会进入
  // config.env，也不会被 define 插件替换进客户端产物。
  for (const [key, value] of Object.entries(parsed)) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      env[key] = value
    }
  }

  // 第二层结果：Vite Task 可能掌握本地文件中不存在的任务环境变量。逐个查询原始
  // prefix 还能让任务运行器把该查询记录进构建缓存键；不能合并成宽泛查询（#22706）。
  for (const prefix of prefixes) {
    Object.assign(env, getEnvs({ prefix }))
  }

  // 第三层、最高优先级：命令前临时设置的变量（如 `VITE_API=x vite build`）必须覆盖
  // `.env` 和 Vite Task。早期实现仅在 env 中不存在时写入，导致 shell 显式变量无法
  // 覆盖文件配置（#10676 / #10684）。
  for (const key in process.env) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      env[key] = process.env[key]!
    }
  }

  debug?.(`using resolved env: %O`, env)

  return env
}

/**
 * 解析并校验允许暴露到客户端的环境变量前缀。
 *
 * 字符串会统一转换为数组。空前缀会匹配 `process.env` 中所有键，可能把访问令牌、
 * 私钥等敏感值打进客户端代码，因此视为配置错误。包含空白的前缀在 shell 和
 * `.env` 变量名中无法正常工作，但不构成泄密风险，所以只告警。
 *
 * @param config - 用户配置；这里只读取 `envPrefix`。
 * @returns 未配置时返回 `['VITE_']`；显式配置时只返回用户前缀，空数组表示不公开任何键。
 * @see https://github.com/vitejs/vite/pull/21292
 */
export function resolveEnvPrefix({
  envPrefix = 'VITE_',
}: UserConfig): string[] {
  envPrefix = arraify(envPrefix)
  if (envPrefix.includes('')) {
    throw new Error(
      `envPrefix option contains value '', which could lead unexpected exposure of sensitive information.`,
    )
  }
  if (envPrefix.some((prefix) => /\s/.test(prefix))) {
    // eslint-disable-next-line no-console
    console.warn(
      colors.yellow(
        `[vite] Warning: envPrefix option contains values with whitespace, which does not work in practice.`,
      ),
    )
  }
  return envPrefix
}
