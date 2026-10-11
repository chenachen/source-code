import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/** 多入口 HTML/JS 路径的共同基准，避免受测试进程 cwd 影响。 */
const dirname = import.meta.dirname

export default defineConfig({
  input: {
    main: resolve(dirname, './index.html'),
    other: resolve(dirname, './other.js'),
    style2: resolve(dirname, './style2.js'),
    'shared-css-with-js': resolve(dirname, 'shared-css-with-js.html'),
    'shared-css-no-js': resolve(dirname, 'shared-css-no-js.html'),
  },
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        // manualChunks(id) {
        //   // 把 chunk.css 拆成独立 chunk，便于检查纯 CSS chunk 的移除与引用重写。
        //   if (id.includes('chunk.css')) {
        //     return 'chunk'
        //   }
        // },
        codeSplitting: {
          groups: [
            // 把 chunk.css 拆成独立 chunk，便于检查纯 CSS chunk 的移除与引用重写。
            {
              name: 'chunk',
              test: 'chunk.css',
            },
          ],
        },
      },
    },
  },
})
