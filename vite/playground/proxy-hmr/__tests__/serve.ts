// harness选用此custom serve，同时启动主应用与子应用服务器。

import path from 'node:path'
import { rootDir, setViteUrl } from '~utils'

/** 启动root与other-app两Vite服务器，设置主应用测试URL，返回并行关闭两实例的清理对象。 */
export async function serve(): Promise<{
  /** 供 harness teardown 调用，Promise 在主应用与代理目标的两台 Vite 服务器均关闭后完成。 */
  close(): Promise<void>
}> {
  const vite = await import('vite')
  const rootServer = await vite.createServer({
    root: rootDir,
    logLevel: 'silent',
  })
  const otherServer = await vite.createServer({
    root: path.join(rootDir, 'other-app'),
    logLevel: 'silent',
  })

  await Promise.all([rootServer.listen(), otherServer.listen()])
  const viteUrl = rootServer.resolvedUrls.local[0]
  setViteUrl(viteUrl)

  return {
    /** 等待两个HTTP/HMR服务器关闭，供harness teardown使用。 */
    async close() {
      await Promise.all([rootServer.close(), otherServer.close()])
    },
  }
}
