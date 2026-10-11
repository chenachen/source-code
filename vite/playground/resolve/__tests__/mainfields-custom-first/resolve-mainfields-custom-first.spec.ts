import { expect, test } from 'vitest'
import { page } from '~utils'

/** 场景：mainFields将自定义字段排在browser前；读取页面，核对resolved custom field，区别browser-first变体。 */
test('resolve.mainFields.custom-first', async () => {
  expect(await page.textContent('.custom-browser-main-field')).toBe(
    'resolved custom field',
  )
})
