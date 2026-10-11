// harness使用此custom启动器，运行fixture的SSR后端。

import path from 'node:path'
import kill from 'kill-port'
import { createInMemoryLogger, hmrPorts, ports, rootDir } from '~utils'

/** 当前SSR后端的独占HTTP端口。 */
export const port = ports.ssr

/** fixture Vite内存logger写入的日志，供配置重启断言使用。 */
export const serverLogs = []

/** 传root/HMR端口与内存logger创建fixture后端app，等待HTTP监听。 */
export async function serve(): Promise<{
  /** 供 harness teardown 调用，Promise 在后端 HTTP 关闭、可用的 middleware Vite 实例关闭后完成。 */
  close(): Promise<void>
}> {
  await kill(port)

  const { createServer } = await import(path.resolve(rootDir, 'server.js'))
  const { app, vite } = await createServer(
    rootDir,
    hmrPorts.ssr,
    createInMemoryLogger(serverLogs),
  )

  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(port, () => {
        resolve({
          /** 关闭后端HTTP后再关闭middleware Vite，供harness teardown使用。 */
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
