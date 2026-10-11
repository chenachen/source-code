import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import sirv from 'sirv'

/** 读取 Vitest 标记；测试由 harness 启动服务，手动运行时才在文件末尾监听默认端口。 */
const isTest = process.env.VITEST

/** 创建 Express SSR 服务：开发时接入 Vite middleware、转换 HTML 并 ssrLoadModule，生产时读取 dist 模板和服务端入口；把条件导出渲染结果填入占位符，开发错误经 ssrFixStacktrace 后作为 500 响应返回。 */
export async function createServer(
  root = process.cwd(),
  isProd = process.env.NODE_ENV === 'production',
  hmrPort,
) {
  /** 以当前服务脚本的目录为基准解析模板路径；不随调用者传入的 Vite root 改变。 */
  const resolve = (p) => path.resolve(import.meta.dirname, p)

  const indexProd = isProd
    ? fs.readFileSync(resolve('dist/client/index.html'), 'utf-8')
    : ''

  const app = express()

  /**
   * @type {import('vite').ViteDevServer}
   */
  let vite
  if (!isProd) {
    vite = await (
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
    })
    app.use(vite.middlewares)
  } else {
    app.use(sirv(resolve('dist/client'), { extensions: [] }))
  }

  app.use('*all', async (req, res) => {
    try {
      const url = req.originalUrl

      let template, render
      if (!isProd) {
        template = fs.readFileSync(resolve('index.html'), 'utf-8')
        template = await vite.transformIndexHtml(url, template)
        render = (await vite.ssrLoadModule('/src/app.js')).render
      } else {
        template = indexProd
        render = (await import('./dist/server/app.js')).render
      }

      const appHtml = await render(url, import.meta.dirname)

      const html = template.replace(`<!--app-html-->`, appHtml)

      res.status(200).set({ 'Content-Type': 'text/html' }).end(html)
    } catch (e) {
      vite && vite.ssrFixStacktrace(e)
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
