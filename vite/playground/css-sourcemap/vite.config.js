import { defineConfig } from 'vite'
import MagicString from 'magic-string'

export default defineConfig({
  resolve: {
    alias: {
      '@': import.meta.dirname,
    },
  },
  css: {
    devSourcemap: true,
    preprocessorOptions: {
      less: {
        additionalData: '@color: red;',
      },
      styl: {
        /** 替换 Stylus 颜色标记并返回对应 MagicString map，供 CSS sourcemap 测试验证预处理输入映射链。 */
        additionalData: (content, filename) => {
          const ms = new MagicString(content, { filename })

          const willBeReplaced = 'blue-red-mixed'
          const start = content.indexOf(willBeReplaced)
          ms.overwrite(start, start + willBeReplaced.length, 'purple')

          const map = ms.generateMap({ hires: 'boundary' })
          map.file = filename
          map.sources = [filename]

          return {
            content: ms.toString(),
            map,
          }
        },
      },
    },
  },
  build: {
    sourcemap: true,
  },
  plugins: [
    {
      name: 'virtual-html',
      /** 为 /virtual.html 提供含内联 style 的虚拟 HTML，先走 transformIndexHtml 再响应，覆盖 CSS 代理 map。 */
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === '/virtual.html') {
            const t = await server.transformIndexHtml(
              '/virtual.html',
              '<style> .foo { color: red; } </style> <p class="foo">virtual html</p>',
            )
            res.setHeader('Content-Type', 'text/html')
            res.statusCode = 200
            res.end(t)
            return
          }
          next()
        })
      },
    },
  ],
})
