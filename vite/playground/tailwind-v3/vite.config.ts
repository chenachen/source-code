import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

/** 创建 pre 插件，让 index.css 加载等待其他模块请求空闲，覆盖 Tailwind 扫描与模块转换并发的更新顺序。 */
function delayIndexCssPlugin(): Plugin {
  let server
  return {
    name: 'delay-index-css',
    enforce: 'pre',
    /** 保存当前 dev server，供 load 在开发请求中等待其他转换完成。 */
    configureServer(_server) {
      server = _server
    },
    /** 仅开发服务器中命中 index.css 时等待请求空闲；传入当前 ID 避免等待该 CSS 请求本身。 */
    async load(id) {
      if (server && id.includes('index.css')) {
        await server.waitForRequestsIdle(id)
      }
    },
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '/@': import.meta.dirname,
    },
  },
  build: {
    // 此夹具验证扫描/HMR，关闭压缩以缩短构建。
    minify: false,
  },
  plugins: [
    {
      name: 'delay view',
      enforce: 'pre',
      /** 为 view 转换加入短延迟，使 CSS 扫描与模块请求存在可观察的并发窗口。 */
      async transform(_code, id) {
        if (id.includes('views/view1.js')) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      },
    },
    delayIndexCssPlugin(),
  ],
})
