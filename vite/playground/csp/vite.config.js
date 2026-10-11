import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { defineConfig } from 'vite'

/** Vite HTML 转换阶段使用的占位 nonce；响应 middleware 再替换为每次请求的随机值。 */
const noncePlaceholder = '#$NONCE$#'
/** 为单次 HTML 响应生成随机 nonce，供 CSP 头和全部注入标签共用。 */
const createNonce = () => crypto.randomBytes(16).toString('base64')

/**
 * 设置与 HTML nonce 一致的 CSP；连接请求仍允许访问同源 Vite 服务。
 * @param {import('node:http').ServerResponse} res
 * @param {string} nonce
 */
const setNonceHeader = (res, nonce) => {
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'nonce-${nonce}'; connect-src 'self'`,
  )
}

/**
 * 读取指定 HTML、执行传入转换，再用本次随机 nonce 同步替换 HTML 占位值并结束响应。
 * dev 传入 transformIndexHtml，preview 读取构建产物并使用恒等转换。
 * @param {string} file
 * @param {(input: string, originalUrl: string) => Promise<string>} transform
 * @returns {import('vite').Connect.NextHandleFunction}
 */
const createMiddleware = (file, transform) => async (req, res) => {
  const nonce = createNonce()
  setNonceHeader(res, nonce)
  const content = await fs.readFile(
    path.join(import.meta.dirname, file),
    'utf-8',
  )
  const transformedContent = await transform(content, req.originalUrl)
  res.setHeader('Content-Type', 'text/html')
  res.end(transformedContent.replaceAll(noncePlaceholder, nonce))
}

export default defineConfig({
  plugins: [
    {
      name: 'nonce-inject',
      /** 使用 custom appType 接管 HTML 响应，并将占位 nonce 交给 Vite 注入脚本、样式和 meta。 */
      config() {
        return {
          appType: 'custom',
          html: {
            cspNonce: noncePlaceholder,
          },
        }
      },
      /** 返回后置 hook，挂载读取源码 HTML 并调用 transformIndexHtml 的 nonce 响应 middleware。 */
      configureServer({ transformIndexHtml, middlewares }) {
        return () => {
          middlewares.use(
            createMiddleware('./index.html', (input, originalUrl) =>
              transformIndexHtml(originalUrl, input),
            ),
          )
        }
      },
      /** 返回后置 hook，读取 dist HTML 并替换构建时留下的 nonce 占位值。 */
      configurePreviewServer({ middlewares }) {
        return () => {
          middlewares.use(
            createMiddleware('./dist/index.html', async (input) => input),
          )
        }
      },
    },
  ],
})
