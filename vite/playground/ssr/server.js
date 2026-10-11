import fs from 'node:fs'
import path from 'node:path'
import express from 'express'

/** 读取 Vitest 标记；测试由 harness 启动服务，手动运行时才在文件末尾监听默认端口。 */
const isTest = process.env.VITEST

/** 创建循环依赖 SSR 示例的 Express 服务；Vite 转换模板并加载 src/app.js，把请求 URL 和 fixture 目录传给 render。错误先修正堆栈；测试时重抛使 harness 失败，手动运行时返回 500。 */
export async function createServer(
  root = process.cwd(),
  hmrPort,
  customLogger,
) {
  /** 以当前服务脚本的目录为基准解析模板路径；不随调用者传入的 Vite root 改变。 */
  const resolve = (p) => path.resolve(import.meta.dirname, p)

  const app = express()

  /**
   * @type {import('vite').ViteDevServer}
   */
  const vite = await (
    await import('vite')
  ).createServer({
    root,
    logLevel: isTest ? 'error' : 'info',
    server: {
      middlewareMode: true,
      watch: {
        // 测试快速修改文件时 chokidar 可能漏掉变化，改用轮询检测。
        usePolling: true,
        interval: 100,
      },
      hmr: {
        port: hmrPort,
      },
    },
    appType: 'custom',
    customLogger,
  })
  // 把 Vite 的 Connect 实例接入 Express 中间件链。
  app.use(vite.middlewares)

  app.use('*all', async (req, res, next) => {
    try {
      const url = req.originalUrl

      let template
      template = fs.readFileSync(resolve('index.html'), 'utf-8')
      template = await vite.transformIndexHtml(url, template)
      const render = (await vite.ssrLoadModule('/src/app.js')).render

      const appHtml = await render(url, import.meta.dirname)

      const html = template.replace(`<!--app-html-->`, appHtml)

      res.status(200).set({ 'Content-Type': 'text/html' }).end(html)
    } catch (e) {
      vite && vite.ssrFixStacktrace(e)
      if (isTest) throw e
      console.log(e.stack)
      res.status(500).end(e.stack)
    }
  })

  return { app, vite }
}

if (!isTest) {
  createServer().then(({ app }) =>
    app.listen(5173, () => {
      console.log('http://localhost:5173')
    }),
  )
}
