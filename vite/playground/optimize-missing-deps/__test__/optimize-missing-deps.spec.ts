import { expect, test } from 'vitest'
import { port } from './serve'
import { isBuild, page } from '~utils'

/** custom serve端口对应的SSR页面地址。 */
const url = `http://localhost:${port}/`

/** 场景：仅非构建执行：访问custom服务后reload获取补优化依赖，核对浏览器显示Client；另用fetch读取初始HTTP文本含Server，覆盖SSR与客户端渲染差异。 */
test.runIf(!isBuild)('optimize', async () => {
  await page.goto(url)
  // reload取得补优化后的客户端依赖。
  await page.reload()
  await expect.poll(() => page.textContent('div')).toMatch('Client')

  // 直接HTTP请求读取服务端渲染文本。
  const aboutHtml = await (await fetch(url)).text()
  expect(aboutHtml).toContain('Server')
})
