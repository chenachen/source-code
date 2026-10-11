// @ts-check
import path from 'node:path'
import pug from 'pug'
import express from 'express'

/** 读取 Vitest 标记；测试由 harness 启动服务，手动运行时才在文件末尾监听默认端口。 */
const isTest = process.env.VITEST

/** 插入 Pug 生成 HTML 的两个模块脚本：内联段落和 src/app.js 外部模块，供页面测试确认都经过 Vite HTML 处理。 */
const DYNAMIC_SCRIPTS = `
  <script type="module">
    const p = document.createElement('p');
    p.innerHTML = '✅ Dynamically injected inline script';
    document.body.appendChild(p);
  </script>
  <script type="module" src="/src/app.js"></script>
`

/** 创建 Pug 模板服务：将请求的 HTML 路径映射为 Pug，目录 URL 补 index，再插入模块脚本并 transformIndexHtml；模板或转换错误修正堆栈后返回 500。 */
export async function createServer(root = process.cwd(), hmrPort) {
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
  })
  // 把 Vite 的 Connect 实例接入 Express 中间件链。
  app.use(vite.middlewares)

  app.use('*all', async (req, res) => {
    try {
      let [url] = req.originalUrl.split('?')
      url = url.replace(/\.html$/, '.pug')
      if (url.endsWith('/')) url += 'index.pug'

      const htmlLoc = resolve(`.${url}`)
      let html = pug.renderFile(htmlLoc)
      html = html.replace('</body>', `${DYNAMIC_SCRIPTS}</body>`)
      html = await vite.transformIndexHtml(url, html)

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
