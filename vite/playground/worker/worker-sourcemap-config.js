import { defineConfig } from 'vite'
import workerPluginTestPlugin from './worker-plugin-test-plugin.js'

/** 生成三种worker映射模式配置；WORKER_MODE可覆盖入参，sourcemap字符串归一成true，输出目录与base按模式区分。
 * @param {boolean | 'inline' | 'hidden' | 'sourcemap'} sourcemap 调用方默认模式。
 * @returns 当前模式的IIFE worker配置。
 */
export default (sourcemap) => {
  sourcemap =
    /** @type {'inline' | 'hidden' | 'sourcemap'} */ (
      process.env.WORKER_MODE
    ) || sourcemap

  if (sourcemap === 'sourcemap') {
    sourcemap = true
  }

  const typeName =
    typeof sourcemap === 'boolean' ? 'sourcemap' : 'sourcemap-' + sourcemap

  return defineConfig({
    base: `/iife-${typeName}/`,
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
          assetFileNames: 'assets/[name]-worker_asset[hash].[ext]',
          chunkFileNames: 'assets/[name]-worker_chunk[hash].js',
          entryFileNames: 'assets/[name]-worker_entry[hash].js',
        },
      },
    },
    build: {
      outDir: `dist/iife-${typeName}/`,
      /** SVG返回false以强制发射资产，其他类型返回undefined沿用默认大小规则。
       * @param filePath 资产路径。
       * @returns SVG禁止内联，其他类型无覆盖值。 */
      assetsInlineLimit: (filePath) =>
        filePath.endsWith('.svg') ? false : undefined,
      sourcemap: sourcemap,
      rolldownOptions: {
        output: {
          assetFileNames: 'assets/[name]-[hash].[ext]',
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
        },
      },
    },
    plugins: [workerPluginTestPlugin()],
    cacheDir: `node_modules/.vite-sourcemap-${typeName}`,
  })
}
