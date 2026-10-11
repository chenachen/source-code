import express from 'express'

/** 读取 Vitest 标记；测试由 harness 启动服务，手动运行时才在文件末尾监听默认端口。 */
const isTest = process.env.VITEST
/** 区分生产构建与开发 SSR；生产加载 dist/server，开发通过 Vite middleware 转换和加载源码。 */
const isProduction = process.env.NODE_ENV === 'production'

/** 创建 Wasm SSR 服务并按开发/生产分支加载 render；把路由结果填入模板。测试环境遇错重新抛出，让 harness 观察失败；手动运行时返回 500 堆栈。 */
export async function createServer(root = process.cwd(), hmrPort) {
  const app = express()

  /** @type {import('vite').ViteDevServer} */
  let vite
  if (!isProduction) {
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
    // 把 Vite 的 Connect 实例接入 Express 中间件链。
    app.use(vite.middlewares)
  }

  app.use('*all', async (req, res, next) => {
    try {
      const url = req.originalUrl
      const render = isProduction
        ? (await import('./dist/app.js')).render
        : (await vite.ssrLoadModule('/src/app.js')).render
      const html = await render(url)
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html)
    } catch (e) {
      vite?.ssrFixStacktrace(e)
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
