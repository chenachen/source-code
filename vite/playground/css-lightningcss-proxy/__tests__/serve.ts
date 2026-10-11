// harness 自动选用此启动器，创建后端代理与 middleware Vite。

import path from 'node:path'
import kill from 'kill-port'
import { hmrPorts, ports, rootDir } from '~utils'

/** 后端代理夹具的独占 HTTP 端口。 */
export const port = ports['css/lightningcss-proxy']

/** 从复制的 fixture 导入 createServer，传入 root 与独占 HMR 端口，等后端 app 监听后返回清理方法。 */
export async function serve(): Promise<{
  /** 供 harness teardown 调用，Promise 在后端 HTTP 关闭、可用的 middleware Vite 实例关闭后完成。 */
  close(): Promise<void>
}> {
  await kill(port)

  const { createServer } = await import(path.resolve(rootDir, 'server.js'))
  const { app, vite } = await createServer(
    rootDir,
    hmrPorts['css/lightningcss-proxy'],
  )

  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(port, () => {
        resolve({
          /** 用例 teardown 先等待后端 HTTP Server 关闭，再关闭 middleware Vite。 */
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
