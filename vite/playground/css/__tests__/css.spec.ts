import { expect, test } from 'vitest'
import { getBg, isBundled, page, viteTestUrl } from '~utils'
import './tests'

// 此例仅注册在默认 PostCSS 变体。
/** 场景：默认 PostCSS pipeline 的插件在 OnceExit 注入 url；导航后读取背景，bundled 核对内联 base64，普通 dev 核对相对 injected-source 重新定位的图片路径。LightningCSS 变体不注册此例。 */
test('postcss plugin that injects url() at OnceExit', async () => {
  await page.goto(viteTestUrl)
  const imported = await page.waitForSelector('.inject-url-once-exit')
  // URL 应按插件注入规则的 source 文件重新定位。
  expect(await getBg(imported)).toMatch(
    isBundled ? /base64/ : '/injected-source/injected-bg.png',
  )
})
