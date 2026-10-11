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
  /** 把调试参数原样交给宿主 console.log，并在首项添加 Vite 前缀。 */
  debug: (...msg) => console.log('[vite]', ...msg),
  /** 用同一 console.log 通道输出 HMR 错误；不抛出错误或改变更新流程。 */
  error: (error) => console.log('[vite]', error),
}
