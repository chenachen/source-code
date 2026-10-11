import { expect, test } from 'vitest'
import { tests } from './tests'
import { page } from '~utils'

/** 页面展示真实与虚拟 JSON 模块在前后 transform hook 的 moduleType，检查 pre 为 json、post 为 js，验证解析转换阶段的类型传递。 */
test('module type should be supported', async () => {
  expect(await page.textContent('#module-type-json-pre')).toBe('json')
  expect(await page.textContent('#module-type-json-post')).toBe('js')
  expect(await page.textContent('#module-type-json-virtual-pre')).toBe('json')
  expect(await page.textContent('#module-type-json-virtual-post')).toBe('js')
})

/** 页面运行带惰性 filter 的 transform hook，检查结果为 success，验证 filter 初始化后命中目标模块。 */
test('lazy hook filter should be applied', async () => {
  expect(await page.textContent('#lazy-hook-filter')).toBe('success')
})

tests()
