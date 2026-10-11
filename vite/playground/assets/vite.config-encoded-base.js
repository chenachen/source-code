import { defineConfig } from 'vite'
import baseConfig from './vite.config.js'

/** 编码 base 变体的独占端口；与 playground/test-utils.ts 的 ports 分配一致。 */
const port = 9524

export default defineConfig({
  ...baseConfig,
  // 内部 URL 应将空格编码为 /foo%20bar/。
  base: '/foo bar/',
  server: {
    port,
    strictPort: true,
  },
  build: {
    ...baseConfig.build,
    outDir: 'dist/encoded-base',
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
  preview: {
    port,
    strictPort: true,
  },
  cacheDir: 'node_modules/.vite-encoded-base',
})
