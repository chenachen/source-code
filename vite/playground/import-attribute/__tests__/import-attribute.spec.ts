import { expect, test } from 'vitest'
import { page } from '~utils'

/** 场景：项目源码使用import属性；读取.src，核对处理后的导出bar。 */
test('from source code', async () => {
  expect(await page.textContent('.src')).toBe('bar')
})

/** 场景：依赖内使用import属性；读取.dep，核对依赖处理后的导出world。 */
test('from dependency', async () => {
  expect(await page.textContent('.dep')).toBe('world')
})
