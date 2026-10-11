// playground/vitestSetup.ts 自动发现此 hook，以它替换默认的 e2e serve 流程。

import path from 'node:path'
import { hmrPorts, ports, rootDir } from '~utils'

/** optimize-missing-deps 场景分配的 HTTP 端口，供自定义 serve hook 启动和浏览器访问。 */
export const port = ports['optimize-missing-deps']

/** 创建 Express 与 Vite middleware server，监听测试端口并返回组合清理接口。 */
export async function serve(): Promise<{
  /** 测试 harness 在 teardown 时等待的异步关闭接口。 */
  close(): Promise<void>
}> {
  const { createServer } = await import(path.resolve(rootDir, 'server.js'))
  const { app, vite } = await createServer(
    rootDir,
    hmrPorts['optimize-missing-deps'],
  )

  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(port, () => {
        resolve({
          // 测试 teardown 等待组合资源关闭。
          /** 先关闭 Express HTTP server，再关闭 Vite，供场景 teardown 释放资源。 */
          async close() {
            await new Promise((resolve) => {
              server.close(resolve)
            })
            if (vite) {
              await vite.close()
            }
          },
        })
      })
    } catch (e) {
      reject(e)
    }
  })
}
