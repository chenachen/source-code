import path from 'node:path'
import legacy from '@vitejs/plugin-legacy'
import { defineConfig } from 'vite'

export default defineConfig(({ isPreview }) => ({
  input: {
    index: path.resolve(import.meta.dirname, 'no-polyfills.html'),
  },
  base: !isPreview ? './' : '/no-polyfills/',
  plugins: [
    legacy({
      renderModernChunks: false,
      polyfills: false,
    }),
    {
      name: 'remove crossorigin attribute',
      /** post 阶段移除 crossorigin 属性，验证禁用 polyfill 后仍由插件生成的 SystemJS 加载 legacy 脚本。 */
      transformIndexHtml: (html) => html.replaceAll('crossorigin', ''),
      enforce: 'post',
    },
  ],
  build: {
    outDir: 'dist/no-polyfills',
  },
}))
