import type { HMRLogger } from '../shared/hmr'

/** 禁用日志时复用的空函数，避免在热路径反复创建闭包。 */
const noop = (): void => {}

/** `hmr.logger=false` 对应的静默 HMRLogger。 */
export const silentConsole: HMRLogger = {
  debug: noop,
  error: noop,
}

/** Module Runner 默认 HMRLogger，为宿主控制台添加统一 `[vite]` 前缀。 */
export const hmrLogger: HMRLogger = {
  debug: (...msg) => console.log('[vite]', ...msg),
  error: (error) => console.log('[vite]', error),
}
