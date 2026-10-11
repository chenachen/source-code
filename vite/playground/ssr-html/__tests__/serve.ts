// harness自动发现此custom serve，使用夹具后端应用替换默认服务器。

import path from 'node:path'
import kill from 'kill-port'
import { createInMemoryLogger, hmrPorts, ports, rootDir } from '~utils'

/** 当前SSR app的独占HTTP端口，由全局分配表提供。 */
export const port = ports['ssr-html']
/** 内存logger写入的服务端日志，用于预转换错误断言。 */
export const serverLogs: string[] = []

/** 创建内存logger收集预转换错误后，传root/HMRport启动SSR app。 监听完成后交回close。 */
export async function serve(): Promise<{
  /** 供 harness teardown 调用，Promise 在后端 HTTP 关闭、可用的 middleware Vite 实例关闭后完成。 */
  close(): Promise<void>
}> {
  await kill(port)

  const { createServer } = await import(path.resolve(rootDir, 'server.js'))
  const { app, vite } = await createServer(
    rootDir,
    hmrPorts['ssr-html'],
    createInMemoryLogger(serverLogs),
  )

  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(port, () => {
        resolve({
          /** teardown先等后端HTTP关闭，再关闭middleware Vite实例（若存在）。 */
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
