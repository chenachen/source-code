// harness自动发现此custom serve，使用夹具后端应用替换默认服务器。

import path from 'node:path'
import kill from 'kill-port'
import { hmrPorts, ports, rootDir } from '~utils'

/** 当前SSR app的独占HTTP端口，由全局分配表提供。 */
export const port = ports['ssr-deps']

/** 从fixture server.js启动SSR app并传root/HMRport；该custom启动器不做构建。 监听完成后交回close。 */
export async function serve(): Promise<{
  /** 供 harness teardown 调用，Promise 在后端 HTTP 关闭、可用的 middleware Vite 实例关闭后完成。 */
  close(): Promise<void>
}> {
  await kill(port)

  const { createServer } = await import(path.resolve(rootDir, 'server.js'))
  const { app, vite } = await createServer(rootDir, hmrPorts['ssr-deps'])

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
