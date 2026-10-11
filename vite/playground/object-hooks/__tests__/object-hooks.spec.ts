import { expect, test } from 'vitest'
import { page } from '~utils'

/** 场景：插件使用对象形式transform钩子；读取#transform，核对处理后文本含ok。 */
test('object hooks', async () => {
  expect(await page.textContent('#transform')).toMatch('ok')
})
