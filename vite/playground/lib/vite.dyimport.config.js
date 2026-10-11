import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/main2.js'),
      formats: ['es', 'iife'],
      name: 'message',
      /** 按输出格式生成库入口 .mjs 文件名；动态消息 chunk 仍使用各自带 hash 的默认命名。 */
      fileName: (format) => `dynamic-import-message.${format}.mjs`,
    },
    outDir: 'dist/lib',
  },
  cacheDir: 'node_modules/.vite-dyimport',
})
