import { defineConfig } from 'vite'
import workerPluginTestPlugin from './worker-plugin-test-plugin.js'

export default defineConfig({
  base: '/iife/',
  resolve: {
    alias: {
      '@': import.meta.dirname,
    },
  },
  worker: {
    format: 'iife',
    /** 每次worker子构建新建测试插件实例，避免父构建/并发worker共享插件状态。
     * @returns 独立worker插件数组。 */
    plugins: () => [workerPluginTestPlugin()],
    rolldownOptions: {
      output: {
        assetFileNames: 'assets/worker_asset-[name]-[hash].[ext]',
        chunkFileNames: 'assets/worker_chunk-[name]-[hash].js',
        // config-test 插件应覆盖为 worker_entry-[name] 的入口命名。
        entryFileNames: 'assets/worker_-[name].js',
      },
    },
  },
  build: {
    outDir: 'dist/iife',
    /** SVG返回false以强制发射资产，其他类型返回undefined沿用默认大小规则。
     * @param filePath 资产路径。
     * @returns SVG禁止内联，其他类型无覆盖值。 */
    assetsInlineLimit: (filePath) =>
      filePath.endsWith('.svg') ? false : undefined,
    manifest: true,
    rolldownOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash].[ext]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name].js',
      },
    },
  },
  plugins: [
    workerPluginTestPlugin(),
    {
      name: 'config-test',
      /** 在配置钩子覆盖worker入口命名模板，测试验证用户初始命名可被插件配置合并覆盖。
       * @returns worker输出配置片段。 */
      config() {
        return {
          worker: {
            rolldownOptions: {
              output: {
                entryFileNames: 'assets/worker_entry-[name].js',
              },
            },
          },
        }
      },
    },
  ],
  cacheDir: 'node_modules/.vite-iife',
  optimizeDeps: {
    exclude: ['@vitejs/test-dep-self-reference-url-worker'],
  },
})
