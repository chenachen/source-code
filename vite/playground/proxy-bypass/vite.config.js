import { defineConfig } from 'vite'

/** 创建指定毫秒后完成的 Promise，使 bypass 回调覆盖异步等待边界。
 * @param ms 等待毫秒数。
 * @returns 延迟完成的 Promise。 */
const timeout = (ms) => new Promise((r) => setTimeout(r, ms))

export default defineConfig({
  server: {
    port: 9606,
    proxy: {
      '/nonExistentApp': {
        target: 'http://localhost:9607',
        /** 返回 false，让代理中间件以 404 结束请求，避免转发到不存在的应用。 */
        bypass: () => {
          return false
        },
      },
      '/proxyError': {
        target: 'http://foo.invalid',
      },
      '/asyncResponse': {
        /** 等四毫秒后写出200文本并结束响应，再返回当前路径；测试验证已结束的响应不被后续代理覆盖。
         * @param _ 请求，fixture 未读取。
         * @param res 用于手工结束的响应。
         * @returns 当前 /asyncResponse 路径。 */
        bypass: async (_, res) => {
          await timeout(4)
          res.writeHead(200, {
            'Content-Type': 'text/plain',
          })
          res.end('Hello after 4 ms (async timeout)')
          return '/asyncResponse'
        },
      },
      '/asyncThrowingError': {
        /** 等四毫秒后抛 bypass error，覆盖代理中间件 await 回调的错误出口。
         * @returns 拒绝的 Promise。 */
        bypass: async () => {
          await timeout(4)
          throw new Error('bypass error')
        },
      },
    },
  },
  plugins: [
    {
      name: 'handle-error-in-preview',
      /** 返回后置错误中间件，记录 bypass 等错误并以500空响应结束。
       * @param options preview 配置与 Connect 中间件栈。
       * @returns 注册错误 handler 的 post hook。 */
      configurePreviewServer({ config, middlewares }) {
        return () => {
          middlewares.use((err, _req, res, _next) => {
            config.logger.error(err.message, { error: err })
            res.statusCode = 500
            res.end()
          })
        }
      },
    },
  ],
})
