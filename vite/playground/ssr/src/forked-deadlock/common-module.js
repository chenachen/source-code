import { stuckModuleExport } from './stuck-module'
import { deadlockfuseModuleExport } from './deadlock-fuse-module'

/** 模块 H：先调用 X 导出，再调用 A 导出；A 经 C 回到 X，X 经 Y 回到 A，构成交叉依赖图。 */
export function commonModuleExport() {
  stuckModuleExport()
  deadlockfuseModuleExport()
}
