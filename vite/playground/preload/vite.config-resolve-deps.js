import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist/resolve-deps',
    minify: 'terser',
    terserOptions: {
      format: {
        beautify: true,
      },
      compress: {
        passes: 3,
      },
    },
    rolldownOptions: {
      output: {
        // manualChunks(id) {
        //   if (id.includes('chunk.js')) {
        //     return 'chunk'
        //   }
        // },
      },
    },
    modulePreload: {
      /** hello 分包的预加载列表额外追加 public preloaded.js，其余分包保持传入依赖列表。 */
      resolveDependencies(filename, deps, { hostId, hostType }) {
        if (filename.includes('hello')) {
          return [...deps, 'preloaded.js']
        }
        return deps
      },
    },
  },
  experimental: {
    /** 对额外 public 预加载文件生成根路径运行时字符串表达式，其余引用要求相对 URL。 */
    renderBuiltUrl(filename, { hostId, hostType }) {
      if (filename.includes('preloaded')) {
        return { runtime: `""+${JSON.stringify('/' + filename)}` }
      }
      return { relative: true }
    },
  },
  cacheDir: 'node_modules/.vite-resolve-deps',
})
