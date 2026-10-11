import { expect, test } from 'vitest'
import { getBg, isBundled, page, viteTestUrl } from '~utils'

/** 场景：LightningCSS root 夹具通过 CSS 引用 ok.png；读取背景，bundled 模式核对哈希文件名，普通 dev 核对服务器根 URL。 */
test('url dependency', async () => {
  const css = await page.$('.url-dep')
  expect(await getBg(css)).toMatch(
    isBundled ? /ok-[-\w]+\.png/ : `${viteTestUrl}/ok.png`,
  )
})
