import { stuckModuleExport } from './stuck-module'

/** 模块 C：调用 X 的导出，把 A 分支接入 X→Y→A 的依赖回环。 */
export function fuseStuckBridgeModuleExport() {
  stuckModuleExport()
}
