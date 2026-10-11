import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    supported: {
      // 保留 esbuild 兼容选项；主构建的 Oxc 降级目标在 build.target。
      'object-rest-spread': false,
      'optional-chain': false,
    },
  },
  build: {
    // Chrome 46 目标触发 Oxc 对象展开与可选链 helper，供 wrapper 输出断言。
    target: 'chrome46',
    rolldownOptions: {
      output: {
        comments: { legal: true },
        banner: `/*!\nMayLib\n*/`,
      },
    },
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/main.js'),
      name: 'MyLib',
      formats: ['es', 'umd', 'iife'],
      fileName: 'my-lib-custom-filename',
    },
  },
  plugins: [
    {
      name: 'emit-index',
      /** 把预制 index.dist.html 作为 index.html 输出，供浏览器加载 ES/UMD/IIFE 库并验证运行结果。 */
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'index.html',
          source: fs.readFileSync(
            path.resolve(import.meta.dirname, 'index.dist.html'),
            'utf-8',
          ),
        })
      },
    },
  ],
})
