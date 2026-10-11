import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

/** 由 Vitest 环境标识决定日志级别及是否自动启动独立 Express HTTP 服务。 */
const isTest = process.env.VITEST

/** 服务端插入 HTML 占位处的内联样式，用于验证 Lightning CSS 的 HTML style 代理转换。 */
const DYNAMIC_STYLES = `
  <style>
  .ssr-proxy {
    color: coral;
  }
  </style>
`

/** 创建 Express 与 Lightning CSS Vite middleware 服务；读取请求 HTML、插入服务端样式，再故意以 / 调用 HTML 转换。
 * 测试接管返回的 app/vite 并负责关闭；独立运行由文件末尾监听 5173。异常修正 SSR 堆栈后返回 500。 */
export async function createServer(root = process.cwd(), hmrPort) {
  /** 以夹具目录定位请求对应的 HTML 文件，独立于 Vite 配置 root。 */
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
    css: {
      transformer: 'lightningcss',
    },
    server: {
      middlewareMode: true,
      watch: {
        // 测试连续快速编辑文件，以轮询避免原生监听漏掉变化事件。
        usePolling: true,
        interval: 100,
      },
      hmr: {
        port: hmrPort,
      },
    },
    appType: 'custom',
  })
  // 先挂载 Vite 的 Connect middleware，再处理夹具 HTML 响应。
  app.use(vite.middlewares)

  app.use('*all', async (req, res, next) => {
    try {
      let [url] = req.originalUrl.split('?')
      if (url.endsWith('/')) url += 'index.html'

      if (url.startsWith('/favicon.ico')) {
        return res.status(404).end('404')
      }

      const htmlLoc = resolve(`.${url}`)
      let template = fs.readFileSync(htmlLoc, 'utf-8')

      template = template.replace('<!--[inline-css]-->', DYNAMIC_STYLES)

      // 故意以 / 转换实际读取的 HTML，覆盖 HTML 代理 ID 与请求路径不一致的集成场景。
      const html = await vite.transformIndexHtml('/', template)

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
