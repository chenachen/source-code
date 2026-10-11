import { describe, expect, test } from 'vitest'
import { findAssetFile, isBuild, page, viteTestUrl } from '~utils'

/** 访问现代 target 的 HTML，轮询 app 为 at: 3，验证页面 JS 与所需 polyfill 能执行。 */
test('should load and execute the JS file', async () => {
  await page.goto(viteTestUrl + '/modern-target.html')
  await expect.poll(() => page.textContent('#app')).toMatch('at: 3')
})

describe.runIf(isBuild)('build', () => {
  /** 仅构建模式读取 modern polyfill，先确认产物存在，再检查 Chrome 64 目标保留 catch 参数而未生成省略参数的 catch。 */
  test('modern polyfill chunk respects modernTargets', () => {
    const polyfill = findAssetFile(/polyfills-[-\w]+\.js$/, 'modern-target')
    expect(polyfill).toBeTruthy()
    // modernTargets 包含不支持省略 catch 参数的 Chrome 64；
    // 压缩器应保留 catch 参数。
    expect(polyfill).toMatch(/catch\s*\(/)
    expect(polyfill).not.toMatch(/catch\s*\{/)
  })
})
