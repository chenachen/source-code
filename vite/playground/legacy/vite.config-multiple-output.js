import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  plugins: [legacy({ modernPolyfills: true })],
  build: {
    manifest: true,
    minify: false,
    rolldownOptions: {
      output: [
        {
          /** 第一份输出将资产写入 assets/subdir，验证 legacy 插件支持函数形式的资产命名。 */
          assetFileNames() {
            return 'assets/subdir/[name]-[hash][extname]'
          },
          entryFileNames: `assets/subdir/[name].js`,
          chunkFileNames: `assets/subdir/[name].js`,
        },
        {
          /** 第二份输出仍共用 assets/subdir 的资产路径，JS 放 anotherSubdir；检查多输出的相对资源引用。 */
          assetFileNames() {
            return 'assets/subdir/[name]-[hash][extname]'
          },
          entryFileNames: `assets/anotherSubdir/[name].js`,
          chunkFileNames: `assets/anotherSubdir/[name].js`,
        },
      ],
    },
  },
})
