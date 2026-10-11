/** 覆盖 playground 默认启动逻辑；实际多个 Vite 服务由测试创建，此处只返回已完成的空清理入口。 */
export async function serve(): Promise<{
  /** playground harness 所需的异步清理契约；该替代启动器自身没有服务资源。 */
  close(): Promise<void>
}> {
  return {
    /** 完成空清理 Promise；真实 Vite 服务由创建它们的测试关闭。 */
    close: () => Promise.resolve(),
  }
}
