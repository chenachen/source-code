/**
 * 组件生命周期阶段在内部实例上的存储键。
 *
 * 值使用短字符串是因为它们会作为 `ComponentInternalInstance` 的高频字段存在，
 * 同时编译产物和调度器也会直接引用这些键。公开 API 不应依赖这些缩写。
 */
export enum LifecycleHooks {
  /** Options API 的组件创建前钩子 `beforeCreate`。 */
  BEFORE_CREATE = 'bc',
  /** Options API 的组件创建完成钩子 `created`。 */
  CREATED = 'c',
  /** 首次把组件子树挂载到宿主环境之前。 */
  BEFORE_MOUNT = 'bm',
  /** 首次挂载完成之后。 */
  MOUNTED = 'm',
  /** 已挂载组件重新渲染之前。 */
  BEFORE_UPDATE = 'bu',
  /** 组件更新及宿主节点提交完成之后。 */
  UPDATED = 'u',
  /** 组件子树与副作用被停止之前。 */
  BEFORE_UNMOUNT = 'bum',
  /** 组件完成卸载之后。 */
  UNMOUNTED = 'um',
  /** 被 `KeepAlive` 移出活动树之后。 */
  DEACTIVATED = 'da',
  /** KeepAlive 子树首次挂载完成，或从缓存重新进入活动树之后。 */
  ACTIVATED = 'a',
  /** 渲染 effect 被依赖触发时的开发调试钩子。 */
  RENDER_TRIGGERED = 'rtg',
  /** 渲染 effect 追踪到依赖时的开发调试钩子。 */
  RENDER_TRACKED = 'rtc',
  /** 捕获后代渲染、钩子或异步流程错误。 */
  ERROR_CAPTURED = 'ec',
  /** SSR 输出前需要等待的数据预取。 */
  SERVER_PREFETCH = 'sp',
}
