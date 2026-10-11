// harness自动发现此custom serve，使用夹具后端应用替换默认服务器。

import path from 'node:path'
import kill from 'kill-port'
import { hmrPorts, isBuild, ports, rootDir } from '~utils'

/** 当前SSR app的独占HTTP端口，由全局分配表提供。 */
export const port = ports['ssr-noexternal']

/** build先生成entry-server.js的SSR产物，再传isBuild启动fixture app；dev直接创建middleware Vite。 监听完成后交回close。 */
export async function serve(): Promise<{
  /** 供 harness teardown 调用，Promise 在后端 HTTP 关闭、可用的 middleware Vite 实例关闭后完成。 */
  close(): Promise<void>
}> {
  if (isBuild) {
    // 构建矩阵先生成服务端或双端产物。
    const { build } = await import('vite')
    // 服务端入口按SSR模式构建。
    await build({
      root: rootDir,
      logLevel: 'silent',
      build: {
        ssr: 'src/entry-server.js',
      },
    })
  }

  await kill(port)

  const { createServer } = await import(path.resolve(rootDir, 'server.js'))
  const { app, vite } = await createServer(
    rootDir,
    isBuild,
    hmrPorts['ssr-noexternal'],
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
