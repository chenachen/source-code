import fs from 'node:fs/promises'
import path from 'node:path'
import { defineConfig } from 'vite'

/** 浏览器 import map 使用的稳定 URL 到已安装 ESM 文件的映射，避免外部 CDN 请求影响测试。 */
const npmDirectServeConfig = {
  '/vue@3.4.38.js': 'vue34/dist/vue.runtime.esm-browser.js',
  '/slash@5.js': 'slash5/index.js',
}
/**
 * 仅响应映射中的原始 URL，按 JavaScript MIME 返回 node_modules 文件；未命中交给后续 middleware。
 * @type {import('vite').Connect.NextHandleFunction} */
const serveNpmCodeDirectlyMiddleware = async (req, res, next) => {
  for (const [url, file] of Object.entries(npmDirectServeConfig)) {
    if (req.originalUrl === url) {
      const code = await fs.readFile(
        new URL(`./node_modules/${file}`, import.meta.url),
      )
      res.setHeader('Content-Type', 'text/javascript')
      res.end(code)
      return
    }
  }
  next()
}

export default defineConfig({
  optimizeDeps: {
    include: ['dep-that-imports', 'dep-that-requires'],
    exclude: ['vue', 'slash5'],
  },
  build: {
    minify: false,
    rolldownOptions: {
      external: ['vue', 'slash3', 'slash5'],
      transform: {
        inject: {
          require: path.resolve(import.meta.dirname, 'src/require-polyfill.js'),
        },
      },
    },
    commonjsOptions: {
      esmExternals: ['vue', 'slash5'],
      dynamicRequireTargets: ['test-no-op-fdir-glob'],
    },
  },
  plugins: [
    {
      name: 'serve-npm-code-directly',
      /** 在开发服务静态处理前提供本地 ESM 依赖 URL，供页面 import map 消费。 */
      configureServer({ middlewares }) {
        middlewares.use(serveNpmCodeDirectlyMiddleware)
      },
      /** 在 preview 静态处理前提供相同 ESM URL，使构建 external 导入使用本地依赖。 */
      configurePreviewServer({ middlewares }) {
        middlewares.use(serveNpmCodeDirectlyMiddleware)
      },
    },
  ],
})
