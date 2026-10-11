import path from 'node:path'
import { globSync } from 'tinyglobby'
import { defineConfig, normalizePath } from 'vite'
import tailwind from '@tailwindcss/vite'

/**
 * 创建后端集成配置插件：从 frontend/entrypoints 收集入口并生成可由后端消费的 manifest。
 * @returns {import('vite').Plugin}
 */
function BackendIntegrationExample() {
  return {
    name: 'backend-integration',
    /** 收集真实文件入口并补入包入口和 root 外 CSS，返回 root、别名、固定端口及相对 outDir 配置。 */
    config() {
      const projectRoot = import.meta.dirname
      const sourceCodeDir = path.join(projectRoot, 'frontend')
      const root = path.join(sourceCodeDir, 'entrypoints')
      const outDir = path.relative(root, path.join(projectRoot, 'dist/dev'))

      const entrypoints = globSync(`${normalizePath(root)}/**/*`, {
        absolute: true,
        expandDirectories: false,
        onlyFiles: true,
      }).map((filename) => [path.relative(root, filename), filename])

      entrypoints.push(['tailwindcss-colors', 'tailwindcss/colors.js'])
      entrypoints.push(['bar.css', path.resolve(projectRoot, './dir/foo.css')])
      entrypoints.push([
        'bar.custom',
        path.resolve(projectRoot, './dir/custom.css'),
      ])

      return {
        input: Object.fromEntries(entrypoints),
        server: {
          // 与 playground/test-utils.ts 的端口分配一致。
          port: 5009,
          strictPort: true,
          origin: 'http://localhost:5009',
        },
        preview: {
          port: 5009,
        },
        build: {
          manifest: true,
          outDir,
        },
        root,
        resolve: {
          alias: {
            '~': sourceCodeDir,
          },
        },
      }
    },
  }
}

export default defineConfig({
  base: '/dev/',
  plugins: [BackendIntegrationExample(), tailwind()],
})
