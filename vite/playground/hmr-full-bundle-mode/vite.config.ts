import { type Plugin, defineConfig } from 'vite'

export default defineConfig({
  experimental: {
    bundledDev: true,
  },
  build: {
    // 资产产出为文件，供新增资产的 HMR 场景观察 URL。
    assetsInlineLimit: 0,
  },
  plugins: [waitBundleCompleteUntilAccess(), delayTransformComment()],
})

/** 用首个 HTTP 访问释放构建等待，再额外延迟输出，使测试能观察首次 bundle 的进度页面。
 * @returns 仅 serve 启用的等待插件。 */
function waitBundleCompleteUntilAccess(): Plugin {
  let resolvers: PromiseWithResolvers<void>

  return {
    name: 'wait-bundle-complete-until-access',
    apply: 'serve',
    /** 建立可由首请求解决的 Promise，并安装记录访问次数的中间件。
     * @param server 当前开发服务。 */
    configureServer(server) {
      let accessCount = 0
      resolvers = promiseWithResolvers()

      server.middlewares.use((_req, _res, next) => {
        accessCount++
        if (accessCount === 1) {
          resolvers.resolve()
        }
        next()
      })
    },
    /** 等待首个请求到达，再延迟300ms后完成输出阶段。
     * @returns 输出可继续后的 Promise。 */
    async generateBundle() {
      await resolvers.promise
      await new Promise<void>((resolve) => setTimeout(resolve, 300))
    },
  }
}

/** 创建按标记延迟 transform 的插件，供连续编辑覆盖进行中的构建。
 * @returns 延迟测试插件。 */
function delayTransformComment(): Plugin {
  return {
    name: 'delay-transform-comment',
    /** 输入含延迟标记时等待300ms，不返回转换代码；无标记则立即完成。
     * @param code 原模块文本。 */
    async transform(code) {
      if (code.includes('// @delay-transform')) {
        await new Promise<void>((resolve) => setTimeout(resolve, 300))
      }
    },
  }
}

/** 把 Promise 与其完成/拒绝操作组合，供首次请求控制构建等待。 */
interface PromiseWithResolvers<T> {
  /** 等待首请求完成的 Promise。 */
  promise: Promise<T>
  /** 从 HTTP 中间件解决等待；泛型值可为值或 thenable。 */
  resolve: (value: T | PromiseLike<T>) => void
  /** 以给定原因拒绝等待；当前首请求插件未调用它。 */
  reject: (reason?: any) => void
}
/** 同步保存 Promise executor 的 resolve/reject 并一起返回。
 * @returns 可由外部完成的 Promise 与控制函数。 */
function promiseWithResolvers<T>(): PromiseWithResolvers<T> {
  let resolve: any
  let reject: any
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}
