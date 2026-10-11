import type * as Rolldown from 'rolldown'

// Vite 转向 Rolldown 后保留的 Rollup 命名兼容层；所有别名都指向 Rolldown 当前
// 类型；这些别名描述当前 Rolldown API，新代码可直接使用 Rolldown 名称。
export * from 'rolldown'

/** @deprecated 请改用 RolldownBuild。 */
export type RollupBuild = Rolldown.RolldownBuild

/** @deprecated 请改用 RolldownOptions。 */
export type RollupOptions = Rolldown.RolldownOptions

/** @deprecated 请改用 RolldownOutput。 */
export type RollupOutput = Rolldown.RolldownOutput

/** @deprecated 请改用 RolldownPlugin。 */
export type RollupPlugin = Rolldown.RolldownPlugin

/** @deprecated 请改用 RolldownPluginOption。 */
export type RollupPluginOption = Rolldown.RolldownPluginOption

/** @deprecated 请改用 RolldownWatcher。 */
export type RollupWatcher = Rolldown.RolldownWatcher

/** @deprecated 请改用 RolldownWatcherEvent。 */
export type RollupWatcherEvent = Rolldown.RolldownWatcherEvent
