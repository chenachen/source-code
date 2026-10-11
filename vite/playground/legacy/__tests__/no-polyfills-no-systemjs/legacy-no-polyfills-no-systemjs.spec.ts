import { expect, test } from 'vitest'
import { isBuild, page, viteTestUrl } from '~utils'

/** 仅构建模式访问同时关闭 polyfills 与 SystemJS 的页面，检查 legacy 入口 data-src 指向产物且脚本总数为一，没有 polyfill 脚本。 */
test.runIf(isBuild)('includes only a single script tag', async () => {
  await page.goto(viteTestUrl + '/no-polyfills-no-systemjs.html')

  await expect
    .poll(() => page.getAttribute('#vite-legacy-entry', 'data-src'))
    .toMatch(/.\/assets\/index-legacy-(.+)\.js/)

  expect(await page.locator('script').count()).toBe(1)
  expect(await page.locator('#vite-legacy-polyfill').count()).toBe(0)
  expect(await page.locator('#vite-legacy-entry').count()).toBe(1)
})
