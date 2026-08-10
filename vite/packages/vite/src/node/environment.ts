import type { PluginContext } from 'rolldown'
import type { DevEnvironment } from './server/environment'
import type { BuildEnvironment } from './build'
import type { ScanEnvironment } from './optimizer/scan'
import type { UnknownEnvironment } from './baseEnvironment'

/** 插件钩子可能观察到的所有完整 Environment 类型。 */
export type Environment =
  | DevEnvironment
  | BuildEnvironment
  | /** @internal */ ScanEnvironment
  | UnknownEnvironment

/**
 * 创建按 Environment 实例惰性初始化、互相隔离的插件状态读取器。
 *
 * 同一个插件对象会被多个 Environment 复用，也会跨多个 hook 保存状态。调用返回函数时，
 * 它从 `PluginContext.environment` 选择 WeakMap 槽位；实例不再可达后，状态可随之回收。
 * 必须用 `has()` 判断是否初始化，不能用 `get()` 的真值判断，否则 `false`、`0`、空字符串
 * 等合法初始状态会被反复创建（#22715）。
 *
 * @experimental
 */
export function perEnvironmentState<State>(
  initial: (environment: Environment) => State,
): (context: PluginContext) => State {
  const stateMap = new WeakMap<Environment, State>()
  return function (context: PluginContext) {
    const { environment } = context
    if (!stateMap.has(environment)) {
      stateMap.set(environment, initial(environment))
    }
    return stateMap.get(environment)!
  }
}
