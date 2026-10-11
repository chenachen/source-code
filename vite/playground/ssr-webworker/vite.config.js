import { defaultClientConditions, defineConfig } from 'vite'

export default defineConfig({
  build: {
    minify: false,
  },
  resolve: {
    dedupe: ['react'],
  },
  ssr: {
    target: 'webworker',
    noExternal: ['this-should-be-replaced-by-the-boolean'],
    // 此 worker 运行时开启 Node 兼容，构建把 node:assert 保留为外部导入交给运行时。
    external: ['node:assert'],
    resolve: {
      conditions: [...defaultClientConditions, 'worker'],
    },
  },
  plugins: [
    {
      name: '@vitejs/test-ssr-webworker/no-external',
      /** 先返回 ssr.noExternal=true，要求 worker SSR 构建转换全部依赖；下一插件返回数组时，配置合并仍须保留布尔 true 的含义。 */
      config() {
        return {
          ssr: {
            noExternal: true,
          },
        }
      },
    },
    {
      name: '@vitejs/test-ssr-webworker/no-external-array',
      /** 再返回 ssr.noExternal 数组，与上一插件的 true 形成合并样例；最终配置应仍按全部依赖不外部化处理。 */
      config() {
        return {
          ssr: {
            noExternal: ['this-should-not-replace-the-boolean'],
          },
        }
      },
    },
  ],
})
