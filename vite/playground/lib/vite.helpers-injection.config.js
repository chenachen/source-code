import path from 'node:path'
import { defineConfig } from 'vite'

// 独立 IIFE 构建验证 helper 注入不会改写构造器字符串。

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/main-helpers-injection.js'),
      name: 'MyLib',
      formats: ['iife'],
      fileName: 'my-lib-custom-filename',
    },
    minify: false,
    outDir: 'dist/helpers-injection',
  },
  plugins: [],
  cacheDir: 'node_modules/.vite-helpers-injection',
})
