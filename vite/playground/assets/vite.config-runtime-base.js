import { defineConfig } from 'vite'
import baseConfig from './vite.config.js'

/** 构建 HTML 注入的模块脚本，为 JS 资产和 public URL 的运行时表达式提供两个全局基址。 */
const dynamicBaseAssetsCode = `
globalThis.__toAssetUrl = url => '/' + url
globalThis.__publicBase = '/'
`

export default defineConfig({
  ...baseConfig,
  base: './', // 覆盖基础配置的 /foo/bar。
  build: {
    ...baseConfig.build,
    outDir: 'dist/runtime-base',
    watch: null,
    minify: false,
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        entryFileNames: 'entries/[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'other-assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [
    {
      name: 'dynamic-base-assets-globals',
      /** 只在持有 bundle 的 HTML 输出阶段注入运行时 URL 全局变量；普通开发 HTML 不需要这些构建表达式。 */
      transformIndexHtml(_, ctx) {
        if (ctx.bundle) {
          // ctx.bundle 存在时输出使用运行时 URL 表达式。
          return [
            {
              tag: 'script',
              attrs: { type: 'module' },
              children: dynamicBaseAssetsCode,
            },
          ]
        }
      },
    },
  ],
  experimental: {
    /** 为 JS 宿主的 asset/public 引用分别生成全局函数调用与基址拼接；其他宿主返回 undefined，使用 Vite 默认 URL。 */
    renderBuiltUrl(filename, { hostType, type }) {
      if (type === 'asset') {
        if (hostType === 'js') {
          return {
            runtime: `globalThis.__toAssetUrl(${JSON.stringify(filename)})`,
          }
        }
      } else if (type === 'public') {
        if (hostType === 'js') {
          return {
            runtime: `globalThis.__publicBase+${JSON.stringify(filename)}`,
          }
        }
      }
    },
  },
  cacheDir: 'node_modules/.vite-runtime-base',
})
