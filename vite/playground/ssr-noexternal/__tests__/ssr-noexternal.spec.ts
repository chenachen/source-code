import { expect, test } from 'vitest'
import { port } from './serve'
import { isBuild, page } from '~utils'

/** custom serve后端app地址。 */
const url = `http://localhost:${port}`

/** 场景：仅非构建执行，导航SSR页面并消费require external CommonJS包；核对对应文本foo。 */
test.runIf(!isBuild)('message from require-external-cjs', async () => {
  await page.goto(url)
  expect(await page.textContent('.require-external-cjs')).toMatch('foo')
})
