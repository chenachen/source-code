import { expect, test } from 'vitest'
import { isBuild, page } from '~utils'

/** 当前矩阵的默认模式，用于页面与环境文件覆盖断言。 */
const mode = isBuild ? `production` : `development`

/** 场景：嵌套root夹具启动默认模式；读取 .mode，开发期望 development、构建期望 production。 */
test('mode', async () => {
  expect(await page.textContent('.mode')).toBe(mode)
})

/** 场景：嵌套root加载模式级环境文件；读取 .mode-file，核对 .env.development 或 .env.production 对应当前矩阵。 */
test('mode file override', async () => {
  expect(await page.textContent('.mode-file')).toBe(`.env.${mode}`)
})

/** 场景：嵌套root的父目录另有.env；读取 .parent-env，核对没有得到父文件的 dont_load_me。 */
test('should not load parent .env file', async () => {
  expect(await page.textContent('.parent-env')).not.toBe('dont_load_me')
})
