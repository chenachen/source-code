import { defineConfig } from 'vite'
import workerPluginTestPlugin from './worker-plugin-test-plugin.js'

export default defineConfig(({ isPreview }) => ({
  base: !isPreview ? './' : '/relative-base/',
  resolve: {
    alias: {
      '@': import.meta.dirname,
    },
  },
  worker: {
    format: 'es',
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
    outDir: 'dist/relative-base',
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
  plugins: [
    workerPluginTestPlugin(),
    {
      name: 'resolve-format-es',
      /** 仅对main.js把标记替换成ES格式专用动态入口，使IIFE场景不加载其拆分子图。
       * @param code 原代码。
       * @param id 解析ID。
       * @returns 命中入口时的替换文本。 */
      transform(code, id) {
        if (id.includes('main.js')) {
          return code.replace(
            `/* flag: will replace in vite config import("./format-es.js") */`,
            `import("./main-format-es")`,
          )
        }
      },
    },
  ],
  cacheDir: 'node_modules/.vite-relative-base',
}))
