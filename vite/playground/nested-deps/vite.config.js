import path from 'node:path'
import { defineConfig } from 'vite'

/** test-package-f 的磁盘绝对目录，用作 alias 与优化 include 解析的对照输入。 */
const packageFPath = path.resolve(import.meta.dirname, 'test-package-f')

export default defineConfig({
  resolve: {
    alias: {
      __F_ABSOLUTE_PACKAGE_PATH__: packageFPath,
    },
  },
  optimizeDeps: {
    include: [
      '@vitejs/test-package-a',
      '@vitejs/test-package-b',
      '@vitejs/test-package-c',
      '@vitejs/test-package-c/side',
      '@vitejs/test-package-d    > @vitejs/test-package-d-nested',
      '@vitejs/test-package-e > @vitejs/test-package-e-included',
      '@vitejs/test-package-f',
    ],
    exclude: ['@vitejs/test-package-d', '@vitejs/test-package-e-excluded'],
  },
})
