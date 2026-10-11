import fs from 'node:fs'
import path from 'node:path'
import legacy from '@vitejs/plugin-legacy'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [legacy()],

  build: {
    outDir: 'dist/chunk-importmap',
    chunkImportMap: true,
  },

  // 测试在构建后改写 HTML，强制当前浏览器执行 legacy 分支。
  /** 构建完成后改写 HTML：移除现代模块脚本并去掉 nomodule，使测试浏览器执行 legacy 分支及 chunk import map 产物。 */
  __test__() {
    const indexPath = path.resolve(
      import.meta.dirname,
      './dist/chunk-importmap/index.html',
    )
    let index = fs.readFileSync(indexPath, 'utf-8')
    index = index
      .replace(/<script type="module".*?<\/script>/g, '')
      .replace(/<script nomodule/g, '<script')
    fs.writeFileSync(indexPath, index)
  },
})
