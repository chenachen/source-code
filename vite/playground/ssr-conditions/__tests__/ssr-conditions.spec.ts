import { expect, test } from 'vitest'
import { port } from './serve'
import { isServe, page } from '~utils'

/** custom serve创建的SSR应用访问地址。 */
const url = `http://localhost:${port}`

/** 场景：访问SSR页面，读取no-external结果，核对ssr.resolve.conditions使内部包选择node.unbundled.js。 */
test('ssr.resolve.conditions affect non-externalized imports during ssr', async () => {
  await page.goto(url)
  expect(await page.textContent('.no-external-react-server')).toMatch(
    'node.unbundled.js',
  )
})

// 此externalConditions用例仅开发矩阵执行。
/** 场景：仅serve执行：访问SSR页面，读取external结果，核对externalConditions选edge.js；其他矩阵不注册验证。 */
test.runIf(isServe)(
  'ssr.resolve.externalConditions affect externalized imports during ssr',
  async () => {
    await page.goto(url)
    expect(await page.textContent('.external-react-server')).toMatch('edge.js')
  },
)

/** 场景：访问SSR页面等待浏览器代码执行，核对两个客户端包均选default.js，SSR条件没有传入client解析。 */
test('ssr.resolve settings do not affect non-ssr imports', async () => {
  await page.goto(url)
  await expect
    .poll(() => page.textContent('.browser-no-external-react-server'))
    .toMatch('default.js')
  await expect
    .poll(() => page.textContent('.browser-external-react-server'))
    .toMatch('default.js')
})
