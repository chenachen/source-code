import path from 'node:path'
import { defineConfig } from 'vite'

/** 测试使用 playground-temp/lib 的输出根，手工运行使用当前目录，使两个 output.dir 都写入实际测试项目。 */
const root = process.env.VITEST
  ? path.resolve(import.meta.dirname, '../../playground-temp/lib')
  : import.meta.dirname

export default defineConfig({
  build: {
    lib: {
      // 多入口共同导入 CSS，制造分包和共享资产。
      entry: {
        main: path.resolve(import.meta.dirname, 'src/main-multiple-output.js'),
        sub: path.resolve(import.meta.dirname, 'src/sub-multiple-output.js'),
      },
      name: 'MyLib',
    },
    outDir: 'dist/multiple-output',
    rolldownOptions: {
      // output.dir 以实际复制后的 root 为基准，避免写回原 playground。
      output: [
        {
          dir: path.resolve(root, 'dist/multiple-output/es'),
          format: 'es',
          entryFileNames: 'index.mjs',
          assetFileNames: 'assets/mylib.css',
        },
        {
          dir: path.resolve(root, 'dist/multiple-output/cjs'),
          format: 'cjs',
          entryFileNames: 'index.cjs',
          assetFileNames: 'assets/mylib.css',
        },
      ],
    },
    cssCodeSplit: true,
  },
  cacheDir: 'node_modules/.vite-multiple-output',
})
