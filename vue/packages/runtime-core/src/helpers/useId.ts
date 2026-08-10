import {
  type ComponentInternalInstance,
  getCurrentInstance,
} from '../component'
import { warn } from '../warning'

/**
 * 为当前组件生成 SSR 与客户端水合一致的稳定 ID。
 *
 * ID 由应用前缀、组件异步边界路径和组件内递增序号组成。它不依赖全局执行顺序，
 * 所以即使多个异步组件完成顺序在服务端与客户端不同，也不会引发属性水合不匹配。
 */
export function useId(): string {
  const i = getCurrentInstance()
  if (i) {
    return (i.appContext.config.idPrefix || 'v') + '-' + i.ids[0] + i.ids[1]++
  } else if (__DEV__) {
    warn(
      `useId() is called when there is no active component ` +
        `instance to be associated with.`,
    )
  }
  return ''
}

/**
 * 把组件 ID 计数器推进到新的异步边界命名空间。
 *
 * 异步边界有三类：异步组件、使用 `async setup()` 的组件、包含 `serverPrefetch` 的
 * 组件。边界后的后代 ID 追加当前分支序号并重置局部计数，避免异步恢复顺序改变 ID。
 */
export function markAsyncBoundary(instance: ComponentInternalInstance): void {
  instance.ids = [instance.ids[0] + instance.ids[2]++ + '-', 0, 0]
}
