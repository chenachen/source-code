import { describe, expect, test } from 'vitest'
import { port } from './serve'
import { getColor, isServe, page } from '~utils'

/** custom serve 后端代理的访问地址。 */
const url = `http://localhost:${port}`

describe.runIf(isServe)('injected inline style', () => {
  /** 场景：仅开发执行：通过 custom serve 的后端代理端口访问页面；读取 SSR proxy 元素颜色，核对 LightningCSS 处理的注入样式为 coral。 */
  test('injected inline style is present', async () => {
    await page.goto(url)
    const el = await page.$('.ssr-proxy')
    expect(await getColor(el)).toBe('coral')
  })
})
