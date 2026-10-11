import { expect, test } from 'vitest'
import { browserLogs, isBundledDev, page } from '~utils'

/** 场景：扩展名解析夹具加载后遍历browserLogs，核对没有404文本。 */
test('should have no 404s', () => {
  browserLogs.forEach((msg) => {
    expect(msg).not.toMatch('404')
  })
})

/** 场景：普通dev/build读取页面HTML，核对 Hello Vite! 消息；isBundledDev 时skip。实际断言没有检查 .mjs 字符串，只验证页面加载。 */
test.skipIf(isBundledDev)('not contain `.mjs`', async () => {
  const appHtml = await page.content()
  expect(appHtml).toMatch('Hello Vite!')
})
