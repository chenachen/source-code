/**
 * 仅用于开发期的插件类型测试，不会进入 Vite 运行时代码。
 */
import type { Plugin as RolldownPlugin } from 'rolldown'
import type { Equal, ExpectExtends, ExpectTrue } from '@type-challenges/utils'
import type { Plugin as RollupPlugin } from 'rollup'
import type { Plugin, PluginContextExtension, PluginOption } from '../plugin'
import type { ROLLUP_HOOKS } from '../constants'
import type {
  GetHookContextMap,
  NonNeverKeys,
  RollupPluginHooks,
} from '../typeUtils'

/** 提取每个插件钩子的 this 类型，用于检查 Vite Environment 上下文扩展。 */
type EnvironmentPluginHooksContext = GetHookContextMap<Plugin>
/** 把未继承 PluginContextExtension 的钩子标成 false，其余钩子归一为 never。 */
type EnvironmentPluginHooksContextMatched = {
  [K in keyof EnvironmentPluginHooksContext]: EnvironmentPluginHooksContext[K] extends PluginContextExtension
    ? never
    : false
}

/** 收集未获得 Vite 上下文扩展的钩子键；正确结果必须是 never。 */
type HooksMissingExtension = NonNeverKeys<EnvironmentPluginHooksContextMatched>
/** 收集类型层存在但运行时 ROLLUP_HOOKS 清单遗漏的钩子。 */
type HooksMissingInConstants = Exclude<
  RollupPluginHooks,
  (typeof ROLLUP_HOOKS)[number]
>

/** 验证上下文扩展、运行时钩子清单和三类插件兼容关系的类型断言组。 */
export type cases = [
  // Vite 环境插件必须是 Rolldown 插件的超集。
  ExpectTrue<ExpectExtends<RolldownPlugin, Plugin>>,

  // 每个底层钩子的 this 都必须带 Vite PluginContextExtension。
  ExpectTrue<Equal<HooksMissingExtension, never>>,

  // 运行时 ROLLUP_HOOKS 清单必须覆盖全部可调度钩子。
  ExpectTrue<Equal<HooksMissingInConstants, never>>,

  // plugins 配置同时接纳 Vite、Rolldown 与兼容 Rollup 插件。
  ExpectTrue<ExpectExtends<PluginOption, RolldownPlugin>>,
  ExpectTrue<ExpectExtends<PluginOption, RollupPlugin>>,
  ExpectTrue<ExpectExtends<PluginOption, Plugin>>,
]

export {}
