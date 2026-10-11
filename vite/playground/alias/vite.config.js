import path from 'node:path'
import module from 'node:module'
import { defineConfig } from 'vite'

/** 以当前 ESM 配置为基准解析 @vue/shared 的 CommonJS 文件，供绝对路径别名使用。 */
const require = module.createRequire(import.meta.url)

export default defineConfig({
  resolve: {
    alias: [
      { find: 'fs', replacement: path.resolve(import.meta.dirname, 'test.js') },
      { find: 'fs-dir', replacement: path.resolve(import.meta.dirname, 'dir') },
      { find: 'dep', replacement: '@vitejs/test-resolve-linked' },
      {
        find: /^regex\/(.*)/,
        replacement: `${path.resolve(import.meta.dirname, 'dir')}/$1`,
      },
      { find: '/@', replacement: path.resolve(import.meta.dirname, 'dir') },
      // 双斜杠别名模式与 URL scheme 判定冲突，验证仍能命中别名。
      { find: /^\/\//, replacement: path.join(import.meta.dirname, 'dir/') },
      // 将待优化依赖指向包内的 ESM 入口。
      { find: 'vue', replacement: 'vue/dist/vue.esm-bundler.js' },
      // 将待优化依赖别名到 require.resolve 返回的绝对文件路径。
      {
        find: '@vue/shared',
        replacement: require.resolve('@vue/shared/dist/shared.cjs.prod.js'),
      },
      // 从另一个导入名转向会被优化的 Vue 依赖。
      { find: 'foo', replacement: 'vue' },
      {
        find: 'custom-resolver',
        replacement: path.resolve(import.meta.dirname, 'test.js'),
        /** 将已替换的 test.js 路径改指 customResolver.js，使页面能验证自定义解析器覆盖别名结果。 */
        customResolver(id) {
          return id.replace('test.js', 'customResolver.js')
        },
      },
    ],
  },
  build: {
    minify: false,
  },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: true,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
})
