import { expect, test } from 'vitest'
import { page } from '~utils'

/** 场景：夹具同时引用顶层/嵌套多个版本、ES入口/副作用、绝对路径与包自引用；逐DOM核对A2/A1、B1、C ES一致、D嵌套、E数值、F2及自引用true。 */
test('handle nested package', async () => {
  expect(await page.textContent('.a')).toBe('A@2.0.0')
  expect(await page.textContent('.b')).toBe('B@1.0.0')
  expect(await page.textContent('.nested-a')).toBe('A@1.0.0')
  const c = await page.textContent('.c')
  expect(c).toBe('es-C@1.0.0')
  expect(await page.textContent('.side-c')).toBe(c)
  expect(await page.textContent('.d')).toBe('D@1.0.0')
  expect(await page.textContent('.nested-d')).toBe('D-nested@1.0.0')
  expect(await page.textContent('.nested-e')).toBe('1')

  expect(await page.textContent('.absolute-f')).toBe('F@2.0.0')
  expect(await page.textContent('.self-referencing')).toBe('true')
})
