import path from 'node:path'
import { type Plugin, normalizePath } from 'vite'

// 插件模拟服务端渲染的 CSS link。
/** 在目标 HTML 注入模拟 SSR 的样式 link，带真实文件路径的 data-vite-dev-id，供 HMR 去重与 prune 场景消费。
 * @returns HTML link 注入插件。 */
export function TestCssLinkPlugin(): Plugin {
  return {
    name: 'test-css-link',
    transformIndexHtml: {
      /** 只对样式 link fixture 页面返回 stylesheet 标签；其他页面不变。
       * @param _html 输入 HTML，当前不直接修改文本。
       * @param ctx 目标 HTML 文件上下文。
       * @returns 对应样式标签描述数组或 undefined。 */
      handler(_html, ctx) {
        if (!ctx.filename.endsWith('/css-link/index.html')) return
        return [
          {
            tag: 'link',
            attrs: {
              rel: 'stylesheet',
              href: '/css-link/styles.css',
              'data-vite-dev-id': normalizePath(
                path.resolve(import.meta.dirname, 'styles.css'),
              ),
            },
          },
        ]
      },
    },
  }
}
