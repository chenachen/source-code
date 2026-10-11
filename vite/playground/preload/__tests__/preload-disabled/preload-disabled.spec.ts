import { describe, expect, test } from 'vitest'
import { browserLogs, isBuild, page } from '~utils'

/** 场景：preload夹具加载后遍历browserLogs，核对没有404文本。 */
test('should have no 404s', () => {
  browserLogs.forEach((msg) => {
    expect(msg).not.toMatch('404')
  })
})

describe.runIf(isBuild)('build', () => {
  /** 场景：仅构建执行：入口动态导入后等待#done出现，核对文本ran js。 */
  test('dynamic import', async () => {
    await page.waitForSelector('#done')
    expect(await page.textContent('#done')).toBe('ran js')
  })

  /** 场景：仅构建执行：禁用modulePreload后点击hello load并等output；核对HTML无modulepreload link，但hello哈希CSS stylesheet仍被注入。 */
  test('dynamic import with comments', async () => {
    await page.click('#hello .load')
    await page.waitForSelector('#hello output')

    const html = await page.content()
    expect(html).not.toMatch(/link rel="modulepreload"/)

    expect(html).toMatch(
      /link rel="stylesheet".*?href=".*?\/assets\/hello-[-\w]{8}\.css"/,
    )
  })
})
