import { fuseStuckBridgeModuleExport } from './fuse-stuck-bridge-module'

/** 模块 A：调用桥接 C 的导出，使 H→A→C→X 的分支与 H→X 的分支汇合。 */
export function deadlockfuseModuleExport() {
  fuseStuckBridgeModuleExport()
}
