import { inject } from '../apiInject'
import { warn } from '../warning'

/**
 * SSR 上下文的全局 symbol 键。
 *
 * 使用 `Symbol.for` 可让 runtime-core 与 server-renderer 即使来自不同模块实例，也能
 * 通过同一个 symbol 交换每次请求的渲染上下文。
 */
export const ssrContextKey: unique symbol = Symbol.for('v-scx')

/**
 * 读取当前服务端渲染请求的上下文。
 *
 * 上下文由服务端渲染入口通过依赖注入提供，可用于收集 teleports、模块标识等
 * 请求级数据。全局浏览器构建不支持此能力；调用方应通过构建条件保证只在 SSR 分支
 * 使用，避免客户端误读共享状态。
 */
export const useSSRContext = <T = Record<string, any>>(): T | undefined => {
  if (!__GLOBAL__) {
    const ctx = inject<T>(ssrContextKey)
    if (!ctx) {
      __DEV__ &&
        warn(
          `Server rendering context not provided. Make sure to only call ` +
            `useSSRContext() conditionally in the server build.`,
        )
    }
    return ctx
  } else if (__DEV__) {
    warn(`useSSRContext() is not supported in the global build.`)
  }
}
