import path from 'node:path'
import legacy from '@vitejs/plugin-legacy'
import { defineConfig } from 'vite'

export default defineConfig(({ isPreview }) => ({
  input: {
    index: path.resolve(import.meta.dirname, 'no-polyfills-no-systemjs.html'),
  },
  base: !isPreview ? './' : '/no-polyfills-no-systemjs/',
  plugins: [
    legacy({
      renderModernChunks: false,
      polyfills: false,
      externalSystemJS: true,
    }),
    {
      name: 'remove crossorigin attribute',
      /** post 阶段移除 crossorigin 属性，与页面自带的外部 SystemJS 配合执行仅 legacy、无插件 polyfill 输出。 */
      transformIndexHtml: (html) => html.replaceAll('crossorigin', ''),
      enforce: 'post',
    },
  ],
  build: {
    outDir: 'dist/no-polyfills-no-systemjs',
  },
}))
