import ReactDomServer from 'react-dom/server'
import type { Connect, ViteDevServer } from 'vite'
import Root from './root'

/** 渲染 Root 到字符串，取得当前模式的 HTML 并插入 root 容器，设置 HTML MIME 后结束响应。
 * @param _req 当前请求，fixture 未使用路径。
 * @param res SSR 响应对象。 */
const handler: Connect.NextHandleFunction = async (_req, res) => {
  const ssrHtml = ReactDomServer.renderToString(<Root />)
  let html = await importHtml()
  html = html.replace(/<body>/, `<body><div id="root">${ssrHtml}</div>`)
  res.setHeader('content-type', 'text/html').end(html)
}

export default handler

declare let __globalServer: ViteDevServer

/** dev 读取源 HTML 并调用全局 server 的 transformIndexHtml；production 读取客户端构建 HTML 原文。
 * @returns 当前模式对应的 HTML Promise。 */
async function importHtml() {
  if (import.meta.env.DEV) {
    const mod = await import('/index.html?raw')
    return __globalServer.transformIndexHtml('/', mod.default)
  } else {
    const mod = await import('/dist/client/index.html?raw')
    return mod.default
  }
}
