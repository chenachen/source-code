// @ts-check
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'

/** 读取 Vitest 标记；测试由 harness 启动服务，手动运行时才在文件末尾监听默认端口。 */
const isTest = process.env.VITEST

/** 强制进入 Vite SSR 转换和优化的四个依赖；创建服务时还加入嵌套 include/exclude 包，并将 entry 子路径显式 external。 */
const noExternal = [
  '@vitejs/test-no-external-cjs',
  '@vitejs/test-import-builtin-cjs',
  '@vitejs/test-no-external-css',
  '@vitejs/test-external-entry',
]

/** 建立 Express 与 Vite middleware 的 SSR 依赖互操作样例：配置 noExternal、external 和嵌套 optimizeDeps include，加载 src/app.js 并传入 fixture 目录读取消息文件；渲染失败修正堆栈后返回 500。 */
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
    ssr: {
      noExternal: [
        ...noExternal,
        '@vitejs/test-nested-exclude',
        '@vitejs/test-nested-include',
      ],
      external: [
        '@vitejs/test-nested-external',
        '@vitejs/test-external-entry/entry',
      ],
      optimizeDeps: {
        include: [
          ...noExternal,
          '@vitejs/test-nested-exclude > @vitejs/test-nested-include',
        ],
      },
    },
    plugins: [
      {
        name: 'dep-virtual',
        enforce: 'pre',
        /** 截获包 exports 中的 virtual 子路径并返回原 ID；让后续 load 提供虚拟内容，绕过真实文件解析。 */
        resolveId(id) {
          if (id === '@vitejs/test-pkg-exports/virtual') {
            return '@vitejs/test-pkg-exports/virtual'
          }
        },
        /** 为包的 virtual 子路径生成成功标记模块；其他 ID 返回 undefined 继续后续插件。 */
        load(id) {
          if (id === '@vitejs/test-pkg-exports/virtual') {
            return 'export default "[success]"'
          }
        },
      },
      {
        name: 'virtual-isomorphic-module',
        /** 把公开的 virtual:isomorphic-module 转成带 NUL 前缀的内部 ID，避免按真实文件路径读取。 */
        resolveId(id) {
          if (id === 'virtual:isomorphic-module') {
            return '\0virtual:isomorphic-module'
          }
        },
        /** 按 load 的 ssr 参数分别转导出服务端或浏览器模块，使同一虚拟 ID 在两个环境取得不同内容。 */
        load(id, { ssr }) {
          if (id === '\0virtual:isomorphic-module') {
            if (ssr) {
              return 'export { default } from "/src/isomorphic-module-server.js";'
            } else {
              return 'export { default } from "/src/isomorphic-module-browser.js";'
            }
          }
        },
      },
    ],
  })
  // 把 Vite 的 Connect 实例接入 Express 中间件链。
  app.use(vite.middlewares)

  app.use('*all', async (req, res) => {
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
