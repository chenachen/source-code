// @ts-check
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'

/** Vitest 环境标记；用于日志级别及是否自动启动独立 HTTP 监听器。 */
const isTest = process.env.VITEST

/** 创建 Express 应用并挂载 Vite，SSR 加载 main 后将 client 模块脚本注入响应，构造缺失依赖发现时机。 */
export async function createServer(root = process.cwd(), hmrPort) {
  /** 以本 server.js 所在目录解析模板路径，使启动 cwd 不影响 fixture 的模板读取。 */
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
      hmr: {
        port: hmrPort,
      },
    },
    appType: 'custom',
  })
  app.use(vite.middlewares)

  app.use('*all', async (req, res) => {
    try {
      let template = fs.readFileSync(resolve('index.html'), 'utf-8')
      template = await vite.transformIndexHtml(req.originalUrl, template)

      // main.js 引用尚未被 client 扫描发现的依赖；SSR 加载不应触发 client 优化器发现。
      const { name } = await vite.ssrLoadModule('./main.js')

      // 页面 client 脚本加载 main.js 时，应触发缺失依赖发现与预构建。
      const appHtml = `<div id="app">${name}</div>
<script type='module'>
  import { name } from './main.js'
  document.getElementById('app').innerText = name
</script>`

      const html = template.replace(`<!--app-html-->`, appHtml)

      res.status(200).set({ 'Content-Type': 'text/html' }).end(html)
    } catch (e) {
      vite.ssrFixStacktrace(e)
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
