// vitestSetup.ts 发现此入口后，使用本服务替代默认 playground 服务。
import path from 'node:path'
import { ports, rootDir } from '~utils'

/** 本 fixture 的固定测试端口，供服务启动与浏览器用例共同使用。 */
export const port = ports['legacy/ssr']

/** 构建 SSR 入口，再用 Express 导入 render 并返回 HTML；监听成功后交出关闭句柄。
 * @returns 测试 teardown 使用的 HTTP 服务关闭接口。
 */
export async function serve(): Promise<{
  /** 等待 HTTP 服务关闭，供 harness 清理监听端口。 */
  close(): Promise<void>
}> {
  const { build } = await import('vite')
  await build({
    root: rootDir,
    logLevel: 'silent',
    build: {
      target: 'esnext',
      ssr: 'entry-server.js',
      outDir: 'dist/server',
    },
  })

  const { default: express } = await import('express')
  const app = express()

  app.use('/', async (_req, res) => {
    const { render } = await import(
      path.resolve(rootDir, './dist/server/entry-server.js')
    )
    const html = await render()
    res.status(200).set({ 'Content-Type': 'text/html' }).end(html)
  })

  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(port, () => {
        resolve({
          /** 关闭当前 Express HTTP 服务；Promise 在 server.close 回调后完成。 */
          async close() {
            await new Promise((resolve) => {
              server.close(resolve)
            })
          },
        })
      })
    } catch (e) {
      reject(e)
    }
  })
}
