import { defineConfig } from 'vite'
import workerPluginTestPlugin from './worker-plugin-test-plugin.js'

export default defineConfig(({ isPreview }) => ({
  base: !isPreview ? './' : '/relative-base-iife/',
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
        assetFileNames: 'worker-assets/worker_asset-[name]-[hash].[ext]',
        chunkFileNames: 'worker-chunks/worker_chunk-[name]-[hash].js',
        entryFileNames: 'worker-entries/worker_entry-[name]-[hash].js',
      },
    },
  },
  build: {
    outDir: 'dist/relative-base-iife',
    /** SVG返回false以强制发射资产，其他类型返回undefined沿用默认大小规则。
     * @param filePath 资产路径。
     * @returns SVG禁止内联，其他类型无覆盖值。 */
    assetsInlineLimit: (filePath) =>
      filePath.endsWith('.svg') ? false : undefined,
    rolldownOptions: {
      output: {
        assetFileNames: 'other-assets/[name]-[hash].[ext]',
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: 'entries/[name]-[hash].js',
      },
    },
  },
  plugins: [workerPluginTestPlugin()],
  cacheDir: 'node_modules/.vite-relative-base-iife',
}))
