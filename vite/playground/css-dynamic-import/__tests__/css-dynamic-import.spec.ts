import type { InlineConfig } from 'vite'
import { build, createServer, preview } from 'vite'
import { expect, test } from 'vitest'
import { getColor, isBuild, isServe, page, ports, rootDir } from '~utils'

/** 两行矩阵：空 base 生成相对构建 URL，斜杠 base 生成绝对 URL；各自覆盖 dev/build。 */
const baseOptions = [
  { base: '', label: 'relative' },
  { base: '/', label: 'absolute' },
]

/** 为当前 base 配置独占 HTTP/preview 端口，并关闭资产内联以观察实际请求。 */
const getConfig = (base: string): InlineConfig => ({
  base,
  root: rootDir,
  logLevel: 'silent',
  server: { port: ports['css/dynamic-import'] },
  preview: { port: ports['css/dynamic-import'] },
  build: { assetsInlineLimit: 0 },
})

/** 构建当前 base 后预览，导航并执行断言，finally 关闭预览 HTTP Server。 */
async function withBuild(base: string, fn: () => Promise<void>) {
  const config = getConfig(base)
  await build(config)
  const server = await preview(config)

  try {
    await page.goto(server.resolvedUrls.local[0])
    await fn()
  } finally {
    server.httpServer.close()
  }
}

/** 启动当前 base 的开发服务器，导航并执行断言，最后跳到空白页并关闭服务器。 */
async function withServe(base: string, fn: () => Promise<void>) {
  const config = getConfig(base)
  const server = await createServer(config)
  await server.listen()

  try {
    await page.goto(server.resolvedUrls.local[0])
    await fn()
  } finally {
    await page.goto('about:blank') // 离开页面，避免后续服务器启动触发自动刷新
    await server.close()
  }
}

/** 提取页面全部 link 的 URL pathname/rel/as，检测重复引用与显式 preload。 */
async function getLinks() {
  const links = await page.$$('link')
  return await Promise.all(
    links.map((handle) => {
      return handle.evaluate((link) => ({
        pathname: new URL(link.href).pathname,
        rel: link.rel,
        as: link.as,
      }))
    }),
  )
}

baseOptions.forEach(({ base, label }) => {
  /** 场景：baseOptions 两行分别使用空/斜杠 base，构建并预览后等待 .loaded；仅 isBuild 执行，核对样式为绿且所有 link pathname 不重复。 */
  test.runIf(isBuild)(
    `doesn't duplicate dynamically imported css files when built with ${label} base`,
    async () => {
      await withBuild(base, async () => {
        await page.waitForSelector('.loaded', { state: 'attached' })

        expect(await getColor('.css-dynamic-import')).toBe('green')
        const linkUrls = (await getLinks()).map((link) => link.pathname)
        const uniqueLinkUrls = [...new Set(linkUrls)]
        expect(linkUrls).toStrictEqual(uniqueLinkUrls)
      })
    },
  )

  /** 场景：空/斜杠 base 分别启动 dev 后等待 .loaded；仅 isServe 执行，核对样式为绿且页面只有显式 /dynamic.css preload(style) link。 */
  test.runIf(isServe)(
    `doesn't duplicate dynamically imported css files when served with ${label} base`,
    async () => {
      await withServe(base, async () => {
        await page.waitForSelector('.loaded', { state: 'attached' })

        expect(await getColor('.css-dynamic-import')).toBe('green')
        // 开发模式保留夹具显式的样式 preload，没有构建注入的额外 link。
        expect(await getLinks()).toEqual([
          {
            pathname: '/dynamic.css',
            rel: 'preload',
            as: 'style',
          },
        ])
      })
    },
  )
})
