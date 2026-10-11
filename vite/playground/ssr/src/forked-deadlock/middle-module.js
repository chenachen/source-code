import { deadlockfuseModuleExport } from './deadlock-fuse-module'

/** 模块 Y：只用 void 引用 A 的函数导出而不调用它；保留 Y→A 模块依赖边，同时避免执行时无限递归。 */
export function middleModuleExport() {
  void deadlockfuseModuleExport
}
