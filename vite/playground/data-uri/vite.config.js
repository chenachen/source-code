import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    {
      name: 'post-plugin',
      enforce: 'post',
      /** 在 post 阶段接管 comma/foo（忽略 query），让 data URI 夹具覆盖含逗号的导入 ID。 */
      resolveId(id) {
        if (id.replace(/\?.*$/, '') === 'comma/foo') {
          return id
        }
      },
      /** 为接管的 comma/foo 模块返回导出字符串的 JS，带 query 的变体使用相同源码。 */
      load(id) {
        if (id.replace(/\?.*$/, '') === 'comma/foo') {
          return `export const comma = 'hi'`
        }
      },
    },
  ],
})
