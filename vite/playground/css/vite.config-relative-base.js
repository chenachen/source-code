import { defineConfig } from 'vite'
import baseConfig from './vite.config.js'

export default defineConfig(({ isPreview }) => ({
  ...baseConfig,
  base: !isPreview ? './' : '/relative-base/', // 相对 base 使产物可移动；preview 使用指定挂载前缀。
  build: {
    ...baseConfig.build,
    outDir: 'dist/relative-base',
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
  cacheDir: 'node_modules/.vite-relative-base',
}))
