import type {
  ObjectHook,
  MinimalPluginContext as RolldownMinimalPluginContext,
  Plugin as RolldownPlugin,
} from 'rolldown'

/** 从对象类型中筛出值类型不为 `never` 的键。 */
export type NonNeverKeys<T> = {
  [K in keyof T]: T[K] extends never ? never : K
}[keyof T]

/**
 * 将插件的对象式钩子映射为其 handler 的 `this` 上下文；不是对象钩子、没有
 * handler 或上下文不兼容 Rolldown 最小插件上下文的键均收窄为 `never`。
 */
export type GetHookContextMap<Plugin> = {
  [K in keyof Plugin]-?: Plugin[K] extends ObjectHook<infer T, unknown>
    ? T extends (this: infer This, ...args: any[]) => any
      ? This extends RolldownMinimalPluginContext
        ? This
        : never
      : never
    : never
}

/** Rolldown 插件各属性到合法钩子上下文的内部映射。 */
type RollupPluginHooksContext = GetHookContextMap<RolldownPlugin>
/** 具有插件上下文的 Rolldown/Rollup 钩子名联合，用于约束 Vite 调度清单。 */
export type RollupPluginHooks = NonNeverKeys<RollupPluginHooksContext>

/** 将 `K` 指定的字段保留原可选性，其余字段全部改为必填。 */
export type RequiredExceptFor<T, K extends keyof T> = Pick<T, K> &
  Required<Omit<T, K>>
