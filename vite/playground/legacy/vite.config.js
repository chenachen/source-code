import fs from 'node:fs'
import path from 'node:path'
import legacy from '@vitejs/plugin-legacy'
import { defineConfig } from 'vite'

export default defineConfig({
  input: {
    index: path.resolve(import.meta.dirname, 'index.html'),
    nested: path.resolve(import.meta.dirname, 'nested/index.html'),
  },
  base: './',
  plugins: [
    legacy({
      targets: 'IE 11',
      modernPolyfills: true,
    }),
  ],

  build: {
    cssCodeSplit: false,
    manifest: true,
    sourcemap: true,
    assetsInlineLimit: 100, // 小内联阈值使 SVG 保持外部资产 URL。
    emptyOutDir: false, // 多个配置共享 dist，保留其他配置产物。
    rolldownOptions: {
      output: {
        /** immutable chunk 保持无 hash 文件名；custom0/1/2 分别用点、横线或无分隔符连接 hash，测试 legacy 后缀插入位置。 */
        chunkFileNames(chunkInfo) {
          if (chunkInfo.name === 'immutable-chunk') {
            return `assets/${chunkInfo.name}.js`
          } else if (/custom\d/.test(chunkInfo.name)) {
            return `assets/chunk-X${
              ['.', '-', ''][/custom(\d)/.exec(chunkInfo.name)[1]]
            }[hash].js`
          }
          return `assets/chunk-[name].[hash].js`
        },
      },
    },
  },

  // 构建后由测试 harness 调用，强制当前浏览器执行 legacy 分支。
  /** 构建后删掉现代 script 并移除 nomodule 限制，让当前浏览器实际执行 legacy 输出进行断言。 */
  __test__() {
    const indexPath = path.resolve(import.meta.dirname, './dist/index.html')
    let index = fs.readFileSync(indexPath, 'utf-8')
    index = index
      .replace(/<script type="module".*?<\/script>/g, '')
      .replace(/<script nomodule/g, '<script')
    fs.writeFileSync(indexPath, index)
  },
})
