import path from 'node:path'
import url from 'node:url'
import { defineConfig } from 'vitest/config'

/** 当前配置目录，用于将 vite/module-runner 精确指向工作区源码而不是已构建入口。 */
const _dirname = path.dirname(url.fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    include: ['**/__tests__/**/*.spec.[tj]s'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      './playground/**/*.*',
      './playground-temp/**/*.*',
    ],
    deps: {
      // 把工作区 packages 视为模块目录，避免 Vitest 将其内联进测试转换运行时。
      moduleDirectories: ['node_modules', 'packages'],
    },
    testTimeout: 20000,
    isolate: false,
  },
  oxc: {
    target: 'node20',
  },
  publicDir: false,
  resolve: {
    alias: {
      'vite/module-runner': path.resolve(
        _dirname,
        './packages/vite/src/module-runner/index.ts',
      ),
    },
  },
})
