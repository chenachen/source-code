import { expect, test } from 'vitest'

import { editFile, isServe, page } from '~utils'

/** 场景：仅开发执行：root外foo.js初始展示foo，编辑为foobar后等待load并轮询DOM，核对root外导入文件也被监听。 */
test.runIf(isServe)('should watch files outside root', async () => {
  expect(await page.textContent('#foo')).toBe('foo')
  editFile('foo.js', (code) => code.replace("'foo'", "'foobar'"))
  await page.waitForEvent('load')
  await expect.poll(() => page.textContent('#foo')).toBe('foobar')
})
