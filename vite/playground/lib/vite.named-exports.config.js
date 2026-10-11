import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    supported: {
      // 保留 esbuild 的对象展开兼容选项，用于具名导出库的包装场景。
      'object-rest-spread': false,
    },
  },
  build: {
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/main-named.js'),
      name: 'MyLibNamed',
      formats: ['umd', 'iife'],
      fileName: 'my-lib-named',
    },
    outDir: 'dist/named',
  },
})
