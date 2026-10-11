/** 模块 H：用 Promise.all 动态导入 X 与 A 两支，再调用两者导出；两支共享的回环必须完成加载而不能互相等待到死锁。 */
export async function commonModuleExport() {
  const [{ stuckModuleExport }, { deadlockfuseModuleExport }] =
    await Promise.all([
      import('./stuck-module'),
      import('./deadlock-fuse-module'),
    ])

  stuckModuleExport()
  deadlockfuseModuleExport()
}
