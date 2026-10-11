// 各用例自行启动服务器；custom serve 阻止 harness 再启动默认服务器。
/** 给 harness 返回空生命周期对象，实际服务器由 withBuild/withServe 控制。 */
export async function serve() {
  return {
    /** 此启动器没有创建服务器，清理立即完成。 */
    close: () => Promise.resolve(),
  }
}
