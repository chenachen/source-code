import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

/** fixture 根目录，用于定位待复制文件与 dist 输出。 */
const dirname = import.meta.dirname

export default defineConfig({
  plugins: [
    {
      name: 'copy',
      /** 构建写出后把被 vite-ignore 引用的 qux、mxd JS/JSON 原样复制到 dist，供无法静态改写的运行时 URL 请求。 */
      writeBundle() {
        fs.mkdirSync(path.resolve(dirname, 'dist/views'))
        fs.mkdirSync(path.resolve(dirname, 'dist/files'))
        fs.copyFileSync(
          path.resolve(dirname, 'views/qux.js'),
          path.resolve(dirname, 'dist/views/qux.js'),
        )
        fs.copyFileSync(
          path.resolve(dirname, 'files/mxd.js'),
          path.resolve(dirname, 'dist/files/mxd.js'),
        )
        fs.copyFileSync(
          path.resolve(dirname, 'files/mxd.json'),
          path.resolve(dirname, 'dist/files/mxd.json'),
        )
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(dirname, 'alias'),
    },
  },
  build: {
    sourcemap: true,
  },
})
