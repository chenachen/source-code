import { expect, test } from 'vitest'
import { port } from './serve'
import { findAssetFile, isBuild, page } from '~utils'

/** custom serve后端应用地址。 */
const url = `http://localhost:${port}`

/** 场景：访问Miniflare后端根路由，核对webworker问候、root上层链接依赖消息与external导出typeof object。 */
test('/', async () => {
  await page.goto(url + '/')
  expect(await page.textContent('h1')).toMatch('hello from webworker')
  expect(await page.textContent('.linked')).toMatch('dep from upper directory')
  expect(await page.textContent('.external')).toMatch('object')
})

/** 场景：worker环境配置exports条件；访问页面读取.worker-exports，核对选到worker分支成功消息。 */
test('supports resolve.conditions', async () => {
  await page.goto(url)
  expect(await page.textContent('.worker-exports')).toMatch('[success] worker')
})

/** 场景：worker环境尊重browser exports；读取.browser-exports，核对browser分支成功消息。 */
test('respects browser export', async () => {
  await page.goto(url)
  expect(await page.textContent('.browser-exports')).toMatch(
    '[success] browser',
  )
})

/** 场景：worker启用nodejs_compat；访问页面读取.nodejs-compat，核对兼容模块成功消息。 */
test('supports nodejs_compat', async () => {
  await page.goto(url)
  expect(await page.textContent('.nodejs-compat')).toMatch(
    '[success] nodejs compat',
  )
})

/** 场景：仅构建执行：读取worker入口产物，核对文件存在且没有createRequire。 */
test.runIf(isBuild)('build output does not contain createRequire', async () => {
  const workerContent = findAssetFile(/entry-worker/, 'worker', '')
  expect(workerContent).toBeDefined()
  expect(workerContent).not.toContain('createRequire')
})

/** 场景：仅构建执行：关闭codeSplitting，核对没有单独dynamic-哈希.js产物。 */
test.runIf(isBuild)('codeSplitting: false', () => {
  const dynamicJsContent = findAssetFile(/dynamic-[-\w]+\.js/, 'worker')
  expect(dynamicJsContent).toBeUndefined()
})
