import { relative, resolve } from 'node:path'
import { defineConfig } from 'vite'

/** HTML 多入口的绝对路径基准，与测试运行 cwd 分离。 */
const dirname = import.meta.dirname

/** 覆盖嵌套路径、缺 head/body、内联共享入口、Unicode、表单和相对输入等 HTML 构建入口表。 */
const input = {
  main: resolve(dirname, 'index.html'),
  nested: resolve(dirname, 'nested/index.html'),
  scriptAsync: resolve(dirname, 'scriptAsync.html'),
  scriptMixed: resolve(dirname, 'scriptMixed.html'),
  emptyAttr: resolve(dirname, 'emptyAttr.html'),
  link: resolve(dirname, 'link.html'),
  'link/target': resolve(dirname, 'index.html'),
  zeroJS: resolve(dirname, 'zeroJS.html'),
  noHead: resolve(dirname, 'noHead.html'),
  noBody: resolve(dirname, 'noBody.html'),
  inlinea: resolve(dirname, 'inline/shared_a.html'),
  inline1: resolve(dirname, 'inline/shared-1.html'),
  inline2: resolve(dirname, 'inline/shared-2.html'),
  inline3: resolve(dirname, 'inline/unique.html'),
  unicodePath: resolve(
    dirname,
    'unicode-path/中文-にほんご-한글-🌕🌖🌗/index.html',
  ),
  linkProps: resolve(dirname, 'link-props/index.html'),
  valid: resolve(dirname, 'valid.html'),
  importmapOrder: resolve(dirname, 'importmapOrder.html'),
  env: resolve(dirname, 'env.html'),
  sideEffects: resolve(dirname, 'side-effects/index.html'),
  'a á': resolve(dirname, 'a á.html'),
  serveFile: resolve(dirname, 'serve/file.html'),
  serveFolder: resolve(dirname, 'serve/folder/index.html'),
  serveBothFile: resolve(dirname, 'serve/both.html'),
  serveBothFolder: resolve(dirname, 'serve/both/index.html'),
  write: resolve(dirname, 'write.html'),
  'transform-inline-js': resolve(dirname, 'transform-inline-js.html'),
  malformedUrl: resolve(dirname, 'malformed-url.html'),
  // 相对路径先由 Vite 按 root 解析；Rolldown 的路径基准为 process.cwd()。
  relativeInput: relative(
    process.cwd(),
    resolve(dirname, 'relative-input.html'),
  ),
}

export default defineConfig({
  input,

  base: './',
  build: {
    rolldownOptions: {
      external: ['/external-path-by-rollup-options.js'],
    },
  },

  server: {
    warmup: {
      clientFiles: ['./warmup/*'],
    },
  },

  define: {
    'import.meta.env.VITE_NUMBER': 5173,
    'import.meta.env.VITE_STRING': JSON.stringify('string'),
    'import.meta.env.VITE_OBJECT_STRING': '{ "foo": "bar" }',
    'import.meta.env.VITE_NULL_STRING': 'null',
  },

  plugins: [
    {
      name: 'pre-transform',
      transformIndexHtml: {
        order: 'pre',
        /** pre 阶段在 Vite client 注入前补完整 HTML 骨架；已有 doctype 不改，noHead/noBody 变体保留对应缺省结构。 */
        handler(html, { filename }) {
          if (html.includes('/@vite/client')) {
            throw new Error('pre transform applied at wrong time!')
          }

          const doctypeRE = /<!doctype html>/i
          if (doctypeRE.test(html)) return

          const head = `
  <head lang="en">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ title }}</title>
  </head>`
          return `<!DOCTYPE html>
<html lang="en">${filename.includes('noHead') ? '' : head}
${
  filename.includes('noBody')
    ? html
    : `<body>
  ${html}
</body>`
}
</html>
  `
        },
      },
    },
    {
      name: 'string-transform',
      /** 普通 HTML hook 将 Hello 改为 Transformed，供测试验证字符串形式的转换返回值。 */
      transformIndexHtml(html) {
        return html.replace('Hello', 'Transformed')
      },
    },
    {
      name: 'tags-transform',
      /** 返回两个 meta 标签，分别覆盖默认 head-prepend 与显式 head 注入。 */
      transformIndexHtml() {
        return [
          {
            tag: 'meta',
            attrs: { name: 'description', content: 'a vite app' },
            // 未指定 injectTo 时默认为 head-prepend。
          },
          {
            tag: 'meta',
            attrs: { name: 'keywords', content: 'es modules' },
            injectTo: 'head',
          },
        ]
      },
    },
    {
      name: 'combined-transform',
      /** 同时返回修改后的 title 和 body 标签，覆盖对象形式的 HTML 与标签联合结果。 */
      transformIndexHtml(html) {
        return {
          html: html.replace('{{ title }}', 'Test HTML transforms'),
          tags: [
            {
              tag: 'p',
              attrs: { class: 'inject' },
              children: 'This is injected',
              injectTo: 'body',
            },
          ],
        }
      },
    },
    {
      name: 'serve-only-transform',
      /** 仅在 ctx.server 存在的非打包 HTML 路径注入 server 标记。 */
      transformIndexHtml(_, ctx) {
        if (ctx.server) {
          return [
            {
              tag: 'p',
              attrs: { class: 'server' },
              children: 'This is injected only when unbundled',
              injectTo: 'body',
            },
          ]
        }
      },
    },
    {
      name: 'build-only-transform',
      /** 仅在 ctx.bundle 存在的打包 HTML 路径注入 build 标记，包含 bundled dev。 */
      transformIndexHtml(_, ctx) {
        if (ctx.bundle) {
          return [
            {
              tag: 'p',
              attrs: { class: 'build' },
              children: 'This is injected only when bundled',
              injectTo: 'body',
            },
          ]
        }
      },
    },
    {
      name: 'path-conditional-transform',
      /** 按 ctx.path 是否含 nested 决定注入，验证 hook 获得真实 HTML 请求路径。 */
      transformIndexHtml(_, ctx) {
        if (ctx.path.includes('nested')) {
          return [
            {
              tag: 'p',
              attrs: { class: 'conditional' },
              children: 'This is injected only for /nested/index.html',
              injectTo: 'body',
            },
          ]
        }
      },
    },
    {
      name: 'body-prepend-transform',
      /** 分别追加和前置 noscript 标签，供 body 注入顺序测试检查。 */
      transformIndexHtml() {
        return [
          {
            tag: 'noscript',
            children: '<!-- this is appended to body -->',
            injectTo: 'body',
          },
          {
            tag: 'noscript',
            children: '<!-- this is prepended to body -->',
            injectTo: 'body-prepend',
          },
        ]
      },
    },
    {
      name: 'head-prepend-importmap',
      /** 除 importmapOrder 专用页面外注入 Vue import map；测试检查 import map 被放到模块脚本之前。 */
      transformIndexHtml(_, ctx) {
        if (ctx.path.includes('importmapOrder')) return

        return [
          {
            tag: 'script',
            attrs: { type: 'importmap' },
            children: `
              {
                "imports": {
                  "vue": "https://unpkg.com/vue@3.4.38/dist/vue.runtime.esm-browser.js"
                }
              }
            `,
            injectTo: 'head',
          },
        ]
      },
    },
    {
      name: 'escape-html-attribute',
      transformIndexHtml: {
        order: 'post',
        /** post 阶段返回含闭合引号和标签文本的 href；HTML 序列化必须转义为单个属性值。 */
        handler() {
          return [
            {
              tag: 'link',
              attrs: {
                href: `"><div class=unescape-div>extra content</div>`,
              },
              injectTo: 'body',
            },
          ]
        },
      },
    },
    {
      name: 'append-external-path-by-rollup-options',
      apply: 'build', // 此场景依赖构建 external 选项，仅在 build 注册。
      transformIndexHtml: {
        order: 'pre',
        /** 只给根构建 HTML 注入外部模块脚本，与 rolldownOptions.external 配合保留其运行时 URL。 */
        handler(_, ctx) {
          if (!ctx.filename.endsWith('html/index.html')) return
          return [
            {
              tag: 'script',
              attrs: {
                type: 'module',
                src: '/external-path-by-rollup-options.js',
              },
              injectTo: 'body',
            },
          ]
        },
      },
    },
    {
      name: 'transform-inline-js',
      transformIndexHtml: {
        order: 'pre',
        /** 为 inline JS 页面替换随机 ID；重载后代码变化用于验证 HTML 代理模块缓存失效。 */
        handler(html, ctx) {
          if (!ctx.filename.endsWith('html/transform-inline-js.html')) return
          return html.replaceAll(
            '{{ id }}',
            Math.random().toString(36).slice(2),
          )
        },
      },
    },
    serveExternalPathPlugin(),
  ],
})

/**
 * 创建外部脚本/样式响应插件，让未打包的运行时 URL 在 dev 与 preview 中都可请求。
 * @returns {import('vite').Plugin} */
function serveExternalPathPlugin() {
  /** 响应三种外部 JS/CSS 路径并设置对应 MIME；其余请求调用 next 继续静态/HTML 链。 */
  const handler = (req, res, next) => {
    if (req.url === '/external-path.js') {
      res.setHeader('Content-Type', 'application/javascript')
      res.end('document.querySelector(".external-path").textContent = "works"')
    } else if (req.url === '/external-path.css') {
      res.setHeader('Content-Type', 'text/css')
      res.end('.external-path{color:red}')
    } else if (req.url === '/external-path-by-rollup-options.js') {
      res.setHeader('Content-Type', 'application/javascript')
      res.end(
        'document.querySelector(".external-path-by-rollup-options").textContent = "works"',
      )
    } else {
      next()
    }
  }
  return {
    name: 'serve-external-path',
    /** 在开发 middleware 链前部挂载外部资源 handler，供保留运行时 URL 的标签访问。 */
    configureServer(server) {
      server.middlewares.use(handler)
    },
    /** 在 preview 静态资源之前挂载同一 handler，供 external 构建 URL 访问。 */
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
