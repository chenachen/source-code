import colors from 'picocolors'
import type { Logger } from './logger'
import type { ResolvedConfig, ResolvedEnvironmentOptions } from './config'
import type { Plugin } from './plugin'

/** 按 Environment 名称稳定选择的日志颜色池。 */
const environmentColors = [
  colors.blue,
  colors.magenta,
  colors.green,
  colors.gray,
]

/**
 * 只依赖已解析配置的最小 Environment 视图。
 *
 * 它把顶层 `ResolvedConfig` 与当前 Environment 的覆盖项合成一个只读代理，并为日志附加
 * Environment 标签。配置解析期间插件尚不一定拥有完整运行时，因此 `applyToEnvironment`
 * 等早期 API 也可以只依赖此基类。
 */
export class PartialEnvironment {
  /** 在同一 Vite 实例中唯一的 Environment 名称。 */
  name: string

  /** 返回未叠加 Environment 覆盖项的顶层配置。 */
  getTopLevelConfig(): ResolvedConfig {
    return this._topLevelConfig
  }

  /** Environment 选项优先、顶层配置兜底的合成配置视图。 */
  config: ResolvedConfig & ResolvedEnvironmentOptions

  /** 自动附带 Environment 名称和级别颜色的日志器。 */
  logger: Logger

  /** 当前 Environment 自己的已解析覆盖项。 @internal */
  _options: ResolvedEnvironmentOptions
  /** 所有 Environment 共享的顶层已解析配置。 @internal */
  _topLevelConfig: ResolvedConfig

  /** 创建配置代理和带 Environment 上下文的日志器。 */
  constructor(
    name: string,
    topLevelConfig: ResolvedConfig,
    options: ResolvedEnvironmentOptions = topLevelConfig.environments[name],
  ) {
    // 名称会用于目录片段和 `environments.<name>` 属性访问；限制字符后，两处都无需转义
    // （#18255）。
    if (!/^[\w$]+$/.test(name)) {
      throw new Error(
        `Invalid environment name "${name}". Environment names must only contain alphanumeric characters and "$", "_".`,
      )
    }
    this.name = name
    this._topLevelConfig = topLevelConfig
    this._options = options
    // Environment 选项遮蔽同名顶层项；其余配置仍从共享顶层对象读取。logger 例外，必须
    // 返回下面创建的 Environment 感知版本。
    this.config = new Proxy(
      options as ResolvedConfig & ResolvedEnvironmentOptions,
      {
        get: (target, prop: keyof ResolvedConfig) => {
          if (prop === 'logger') {
            return this.logger
          }
          if (prop in target) {
            return this._options[prop as keyof ResolvedEnvironmentOptions]
          }
          return this._topLevelConfig[prop]
        },
      },
    )
    const environment = colors.dim(`(${this.name})`)
    // 名称字符码哈希保证同名 Environment 跨运行稳定使用同一 info 颜色；warn/error 固定
    // 使用黄/红色以保留日志严重级别。
    const colorIndex =
      [...this.name].reduce((acc, c) => acc + c.charCodeAt(0), 0) %
      environmentColors.length
    const infoColor = environmentColors[colorIndex || 0]
    this.logger = {
      /** 读取顶层 logger 是否已经输出过警告。 */
      get hasWarned() {
        return topLevelConfig.logger.hasWarned
      },
      /** 为普通信息附加稳定的 Environment 颜色标签后转发。 */
      info(msg, opts) {
        return topLevelConfig.logger.info(msg, {
          ...opts,
          environment: infoColor(environment),
        })
      },
      /** 为警告附加黄色 Environment 标签后转发。 */
      warn(msg, opts) {
        return topLevelConfig.logger.warn(msg, {
          ...opts,
          environment: colors.yellow(environment),
        })
      },
      /** 为一次性警告附加 Environment 标签并复用顶层去重状态。 */
      warnOnce(msg, opts) {
        return topLevelConfig.logger.warnOnce(msg, {
          ...opts,
          environment: colors.yellow(environment),
        })
      },
      /** 为错误附加红色 Environment 标签后转发。 */
      error(msg, opts) {
        return topLevelConfig.logger.error(msg, {
          ...opts,
          environment: colors.red(environment),
        })
      },
      /** 复用顶层 logger 的清屏策略。 */
      clearScreen(type) {
        return topLevelConfig.logger.clearScreen(type)
      },
      /** 查询给定错误是否已经由共享 logger 记录。 */
      hasErrorLogged(error) {
        return topLevelConfig.logger.hasErrorLogged(error)
      },
    }
  }
}

/** 具有最终插件列表和初始化状态的完整 Environment 公共基类。 */
export class BaseEnvironment extends PartialEnvironment {
  /** 当前 Environment 在配置阶段筛选/派生出的插件列表。 */
  get plugins(): readonly Plugin[] {
    return this.config.plugins
  }

  /** 是否已经完成该具体 Environment 的一次性初始化。 @internal */
  _initiated: boolean = false

  /** 用顶层配置中同名 Environment 选项创建实例。 */
  constructor(
    name: string,
    config: ResolvedConfig,
    options: ResolvedEnvironmentOptions = config.environments[name],
  ) {
    super(name, config, options)
  }
}

/**
 * 表示具体运行模式尚未知的 Environment。
 *
 * ```js
 * const isDev = environment.mode !== 'build' // 错误：未来可能新增模式
 * const isDev = environment.mode === 'dev'   // 正确：正向收窄
 * ```
 *
 * `unknown` 只是更多潜在模式的占位值，也不应成为业务分支的精确判断目标。
 */
export class UnknownEnvironment extends BaseEnvironment {
  /** 表明调用方必须通过正向比较识别具体运行模式。 */
  mode = 'unknown' as const
}
