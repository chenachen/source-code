import { defineConfig } from 'vite'
import baseConfig from './vite.config.js'

/** 完整 URL base 变体的独占端口；dev 与 preview 固定使用同一端口。 */
const port = 9525

export default defineConfig({
  ...baseConfig,
  base: `http://localhost:${port}/`,
  server: {
    port,
    strictPort: true,
  },
  build: {
    ...baseConfig.build,
    outDir: 'dist/url-base',
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
  cacheDir: 'node_modules/.vite-url-base',
})
