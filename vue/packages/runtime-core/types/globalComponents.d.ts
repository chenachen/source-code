// 构建时自动拼接到打包后的 d.ts 末尾；下列声明只补模板类型，不注册运行时组件。

declare module '@vue/runtime-core' {
  /** 模板类型检查可直接识别的内置组件及其公开 props。 */
  export interface GlobalComponents {
    /** Teleport 的目标与禁用/延迟属性。 */
    Teleport: DefineComponent<TeleportProps>
    /** Suspense 的 default/fallback 边界配置。 */
    Suspense: DefineComponent<SuspenseProps>
    /** KeepAlive 的包含/排除规则与缓存上限。 */
    KeepAlive: DefineComponent<KeepAliveProps>
    /** 不含 DOM CSS 扩展的核心过渡钩子与模式。 */
    BaseTransition: DefineComponent<BaseTransitionProps>
  }
}
