import fs from 'node:fs'
import path from 'node:path'
import express from 'express'

/** 读取 Vitest 标记；测试由 harness 启动服务，手动运行时才在文件末尾监听默认端口。 */
const isTest = process.env.VITEST

/** 请求时插入的两个模块脚本：内联脚本添加成功段落，外部脚本加载 src/app.js；两种来源都交给 HTML 转换处理。 */
const DYNAMIC_SCRIPTS = `
  <script type="module">
    const p = document.createElement('p');
    p.innerHTML = '✅ Dynamically injected inline script';
    document.body.appendChild(p);
  </script>
  <script type="module" src="/src/app.js"></script>
`

/** 请求时插入的内联样式，把 h1 背景设为 blue，供 HTML/CSS 转换页面断言检查。 */
const DYNAMIC_STYLES = `
  <style>
  h1 {
    background-color: blue;
  }
  </style>
`

/** 建立自定义 HTML 服务并注入动态脚本、样式和虚拟模块插件；目录入口用其真实 URL 转换，普通页故意传入根 URL 模拟集成方用法；favicon 返回 404，NUL 虚拟 ID 交给后续 middleware。 */
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
    plugins: [
      {
        name: 'virtual-file',
        /** 把 virtual:file 转成带 NUL 前缀的内部 ID；其他导入留给后续解析器。 */
        resolveId(id) {
          if (id === 'virtual:file') {
            return '\0virtual:file'
          }
        },
        /** 为内部虚拟 ID 生成对真实 importedVirtual.js 的导入和转导出，形成虚拟模块继续依赖真实文件的 HMR 样例。 */
        load(id) {
          if (id === '\0virtual:file') {
            return 'import { virtual } from "/src/importedVirtual.js"; export { virtual };'
          }
        },
      },
    ],
  })
  // 把 Vite 的 Connect 实例接入 Express 中间件链。
  app.use(vite.middlewares)

  app.use('*all', async (req, res, next) => {
    try {
      let [url] = req.originalUrl.split('?')

      if (url === '/trailing-slash/dir/') {
        const template = fs.readFileSync(resolve(`.${url}index.html`), 'utf-8')
        const html = await vite.transformIndexHtml(url, template)
        return res.status(200).set({ 'Content-Type': 'text/html' }).end(html)
      }

      if (url.endsWith('/')) url += 'index.html'

      if (url.startsWith('/favicon.ico')) {
        return res.status(404).end('404')
      }
      if (url.startsWith('/@id/__x00__')) {
        return next()
      }

      const htmlLoc = resolve(`.${url}`)
      let template = fs.readFileSync(htmlLoc, 'utf-8')

      template = template.replace(
        '</body>',
        `${DYNAMIC_SCRIPTS}${DYNAMIC_STYLES}</body>`,
      )

      // 故意把普通页面的 transformIndexHtml URL 固定为根路径，模拟集成方的调用方式。
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
