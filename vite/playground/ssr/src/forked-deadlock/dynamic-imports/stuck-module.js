import { middleModuleExport } from './middle-module'

/** 模块 X：调用 Y 的导出；它既由 H 直接依赖，也由 A 经 C 依赖，是两条加载路径的共享节点。 */
export function stuckModuleExport() {
  middleModuleExport()
}
