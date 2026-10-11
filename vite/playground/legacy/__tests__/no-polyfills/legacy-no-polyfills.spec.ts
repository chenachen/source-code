import { expect, test } from 'vitest'
import { isBuild, page, viteTestUrl } from '~utils'

/** 访问关闭业务 polyfills 的页面，轮询 main 显示挥手字符，确认 JS 仍可执行。 */
test('should load and execute the JS file', async () => {
  await page.goto(viteTestUrl + '/no-polyfills.html')
  await expect.poll(() => page.textContent('main')).toMatch('👋')
})

/** 仅构建模式检查当前页面：polyfill 脚本 src 与 legacy 入口 data-src 均匹配 assets，验证关闭业务填充仍保留 SystemJS 加载所需脚本。 */
test.runIf(isBuild)('includes a script tag for SystemJS', async () => {
  await expect
    .poll(() => page.getAttribute('#vite-legacy-polyfill', 'src'))
    .toMatch(/.\/assets\/polyfills-legacy-(.+)\.js/)
  await expect
    .poll(() => page.getAttribute('#vite-legacy-entry', 'data-src'))
    .toMatch(/.\/assets\/index-legacy-(.+)\.js/)
})

/** 仅构建模式访问 legacy-only 页面，检查 HTML 不包含 modulepreload，避免为无 modern 输出添加预加载标签。 */
test.runIf(isBuild)(
  'does not emit modulepreload links for legacy-only output',
  async () => {
    await page.goto(viteTestUrl + '/no-polyfills.html')
    expect(await page.content()).not.toContain('modulepreload')
  },
)
