// 用例自行启动不同 root 的服务器，此 custom serve 阻止默认 harness 重复启动。
/** 返回空生命周期对象，服务器由唯一测试的 try/finally 关闭。 */
export async function serve(): Promise<{
  /** 供 harness teardown 调用；此启动器未持有服务器，Promise 立即完成。 */
  close(): Promise<void>
}> {
  return {
    /** 当前启动器没有实际服务器，清理立即完成。 */
    close: () => Promise.resolve(),
  }
}
