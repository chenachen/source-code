import { expect, test } from 'vitest'
import { getColor, page } from '~utils'

/** 场景：多入口夹具初始显示Initial，点击b发起第二次动态导入；等待Reference文本并核对元素为红色，检查依赖样式已加载。 */
test('should have css applied on second dynamic import', async () => {
  await expect.poll(() => page.textContent('.content')).toMatch('Initial')
  await page.click('.b')

  await expect.poll(() => page.textContent('.content')).toMatch('Reference')
  expect(await getColor('.content')).toBe('red')
})
