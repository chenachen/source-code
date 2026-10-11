import { expect, test } from 'vitest'
import { findAssetFile, isBuild, page } from '~utils'

/** 场景：入口导入文本 data URI 模块；读取 .plain，核对模块值 hi。 */
test('plain', async () => {
  expect(await page.textContent('.plain')).toBe('hi')
})

/** 场景：入口导入 base64 data URI 模块；读取 .base64，核对解码导出 hi。 */
test('base64', async () => {
  expect(await page.textContent('.base64')).toBe('hi')
})

/** 场景：四种单双引号组合的 SVG data URI 背景被处理；读取各 testId 的边界框，核对高度均100，检查浏览器仍可解析。 */
test('svg data uri minify', async () => {
  const sqdqs = await page.getByTestId('sqdqs').boundingBox()
  const sqsdqs = await page.getByTestId('sqsdqs').boundingBox()
  const dqsqs = await page.getByTestId('dqsqs').boundingBox()
  const dqssqs = await page.getByTestId('dqssqs').boundingBox()

  expect(sqdqs.height).toBe(100)
  expect(sqsdqs.height).toBe(100)
  expect(dqsqs.height).toBe(100)
  expect(dqssqs.height).toBe(100)
})

/** 场景：仅构建执行：读取入口输出JS，核对 data URI 模块已编译进产物而没有 import 文本。 */
test.runIf(isBuild)('should compile away the import for build', async () => {
  const file = findAssetFile('index')
  expect(file).not.toMatch('import')
})
