// spec 自行创建和关闭服务器；此 custom serve 让默认 harness 不重复启动。
/** 返回空清理对象，实际服务器生命周期由各 client-reload 用例控制。 */
export async function serve(): Promise<{
  /** 供 harness teardown 调用；此启动器未持有服务器，Promise 立即完成。 */
  close(): Promise<void>
}> {
  return {
    /** 满足 harness 清理接口，此处没有需要关闭的额外服务器。 */
    close: () => Promise.resolve(),
  }
}
