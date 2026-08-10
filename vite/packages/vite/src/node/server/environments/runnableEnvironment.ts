import type { ModuleRunner } from 'vite/module-runner'
import type { ResolvedConfig } from '../../config'
import type { DevEnvironmentContext } from '../environment'
import { DevEnvironment } from '../environment'
import type { ServerModuleRunnerOptions } from '../../ssr/runtime/serverModuleRunner'
import { createServerModuleRunner } from '../../ssr/runtime/serverModuleRunner'
import { createServerHotChannel } from '../hmr'
import type { Environment } from '../../environment'

/**
 * 创建与 Vite Server 同进程执行模块的开发 Environment。
 * 缺省补齐服务器端 HotChannel 并开启 HMR；Runner 仍保持惰性，首次读取 `runner` 才创建。
 */
export function createRunnableDevEnvironment(
  name: string,
  config: ResolvedConfig,
  context: RunnableDevEnvironmentContext = {},
): RunnableDevEnvironment {
  if (context.transport == null) {
    context.transport = createServerHotChannel()
  }
  if (context.hot == null) {
    context.hot = true
  }

  return new RunnableDevEnvironment(name, config, context)
}

/** RunnableDevEnvironment 的运行时与 ModuleRunner 定制项。 */
export interface RunnableDevEnvironmentContext extends Omit<
  DevEnvironmentContext,
  'hot'
> {
  /** 自定义 Runner 工厂；缺省创建 Vite 的 ServerModuleRunner。 */
  runner?: (
    environment: RunnableDevEnvironment,
    options?: ServerModuleRunnerOptions,
  ) => ModuleRunner
  /** 传给 Runner 工厂的模块执行、HMR 与 Source Map 选项。 */
  runnerOptions?: ServerModuleRunnerOptions
  /** 是否启用 HMR；缺省为 true。 */
  hot?: boolean
}

/** 用 instanceof 收窄到可在当前进程直接执行模块的 Environment。 */
export function isRunnableDevEnvironment(
  environment: Environment,
): environment is RunnableDevEnvironment {
  return environment instanceof RunnableDevEnvironment
}

/**
 * 在 Vite Server 所在 JavaScript 运行时中执行模块的 DevEnvironment。
 * 模块导出无需序列化，可以直接返回函数、类实例等活对象；代价是不能代表另一种远端运行时。
 */
class RunnableDevEnvironment extends DevEnvironment {
  /** 首次访问后缓存的唯一 ModuleRunner。 */
  private _runner: ModuleRunner | undefined
  /** 用户工厂或 undefined（届时使用 createServerModuleRunner）。 */
  private _runnerFactory:
    | ((
        environment: RunnableDevEnvironment,
        options?: ServerModuleRunnerOptions,
      ) => ModuleRunner)
    | undefined
  /** 延迟传给 Runner 工厂的选项。 */
  private _runnerOptions: ServerModuleRunnerOptions | undefined

  /** 保存 Runner 配置；此时不创建 Runner，避免提前修改进程 Source Map 行为。 */
  constructor(
    name: string,
    config: ResolvedConfig,
    context: RunnableDevEnvironmentContext,
  ) {
    super(name, config, context as DevEnvironmentContext)
    this._runnerFactory = context.runner
    this._runnerOptions = context.runnerOptions
  }

  /** 惰性创建并永久复用本 Environment 的 ModuleRunner。 */
  get runner(): ModuleRunner {
    if (this._runner) {
      return this._runner
    }
    const factory = this._runnerFactory || createServerModuleRunner
    this._runner = factory(this, this._runnerOptions)
    return this._runner
  }

  /**
   * 先关闭 Environment 的转换/HMR 资源，再关闭已创建的 Runner；未访问过 runner 时不为清理
   * 反向创建它。Runner 必须随 Environment 释放，避免模块缓存和 HMR listener 泄漏（#18282）。
   */
  override async close(): Promise<void> {
    await super.close()
    if (this._runner) {
      await this._runner.close()
    }
  }
}

export type { RunnableDevEnvironment }
