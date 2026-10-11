import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import deepJson from 'vue/package.json'
import testJson from '../../test.json'
import hmrJson from '../../hmr.json'
import { editFile, isBundled, isBundledDev, isServe, page } from '~utils'

/** 顶层 JSON fixture 的稳定默认导入文本。 */
const stringified = JSON.stringify(testJson)
/** node_modules 深层 JSON 包入口的稳定序列化文本。 */
const deepStringified = JSON.stringify(deepJson)
/** HMR 前后用于比较 JSON 模块缓存失效的初始文本。 */
const hmrStringified = JSON.stringify(hmrJson)

/** JSON 默认导入应得到完整对象，而不是仅命名导出集合。 */
test('default import', async () => {
  expect(await page.textContent('.full')).toBe(stringified)
})

/** 场景：源码具名导入 JSON 顶层 hello 属性；读取 .named，核对值等于 fixture 的 hello 字段。 */
test('named import', async () => {
  expect(await page.textContent('.named')).toBe(testJson.hello)
})

/** node_modules 内的深层 package.json 也走相同 JSON 模块转换。 */
test('deep import', async () => {
  expect(await page.textContent('.deep-full')).toBe(deepStringified)
})

/** 深层 JSON 的命名导出语义与项目内 JSON 一致。 */
test('named deep import', async () => {
  expect(await page.textContent('.deep-named')).toBe(deepJson.name)
})

/** 动态导入返回 namespace，其 default 仍是完整 JSON 对象。 */
test('dynamic import', async () => {
  expect(await page.textContent('.dynamic')).toBe(stringified)
})

/** 动态 namespace 同时暴露配置允许的命名导出。 */
test('dynamic import, named', async () => {
  expect(await page.textContent('.dynamic-named')).toBe(testJson.hello)
})

// bundled-dev 只服务 bundle；原生 fetch('/test.json') 请求未收入 bundle 的项目文件，故跳过。
/** 场景：原生 fetch JSON 后页面展示完整序列化对象；核对文本等于 fixture。isBundledDev 因该源文件未在输出中而 skip，当前条件下不执行验证。 */
test.skipIf(isBundledDev)('fetch', async () => {
  expect(await page.textContent('.fetch')).toBe(stringified)
})

/** `?url` 切换到资源语义：bundled 模式可内联 data URL，普通 dev 返回可访问路径。 */
test('?url', async () => {
  expect(await page.textContent('.url')).toMatch(
    isBundled ? 'data:application/json' : '/test.json',
  )
})

/** `?raw` 返回未经 JSON 解析/格式化的原文件文本。 */
test('?raw', async () => {
  expect(await page.textContent('.raw')).toBe(
    readFileSync(require.resolve('../../test.json'), 'utf-8'),
  )
})

/** CJS require(json) 沿用 Node 对象语义，不能额外套一层 default。 */
test('require(json) returns object without default export', async () => {
  expect(await page.textContent('.require')).toBe(JSON.stringify({ 200: 'ok' }))
})

/** 此 HTML 入口及导入链没有 HMR 接受边界；编辑 JSON 后页面重新执行并展示新值。 */
test.runIf(isServe)('should full reload', async () => {
  expect(await page.textContent('.hmr')).toBe(hmrStringified)

  editFile('hmr.json', (code) =>
    code.replace('"this is hmr json"', '"this is hmr update json"'),
  )
  await expect
    .poll(() => page.textContent('.hmr'))
    .toMatch('"this is hmr update json"')
})
