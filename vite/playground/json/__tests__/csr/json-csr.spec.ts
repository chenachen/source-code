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
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.full')”。
 * 验证目标：“await page.textContent('.full')” 应等于 “stringified”，从而确认JSON 默认/命名/动态导入共享一致的对象语义。
 */
test('default import', async () => {
  expect(await page.textContent('.full')).toBe(stringified)
})

/** 顶层属性可作为命名导出，供 bundler 做属性级 tree-shaking。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.named')”。
 * 验证目标：“await page.textContent('.named')” 应等于 “testJson.hello”，从而确认JSON 默认/命名/动态导入共享一致的对象语义。
 */
test('named import', async () => {
  expect(await page.textContent('.named')).toBe(testJson.hello)
})

/** node_modules 内的深层 package.json 也走相同 JSON 模块转换。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.deep-full')”。
 * 验证目标：“await page.textContent('.deep-full')” 应等于 “deepStringified”，从而确认JSON 默认/命名/动态导入共享一致的对象语义。
 */
test('deep import', async () => {
  expect(await page.textContent('.deep-full')).toBe(deepStringified)
})

/** 深层 JSON 的命名导出语义与项目内 JSON 一致。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.deep-named')”。
 * 验证目标：“await page.textContent('.deep-named')” 应等于 “deepJson.name”，从而确认JSON 默认/命名/动态导入共享一致的对象语义。
 */
test('named deep import', async () => {
  expect(await page.textContent('.deep-named')).toBe(deepJson.name)
})

/** 动态导入返回 namespace，其 default 仍是完整 JSON 对象。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.dynamic')”。
 * 验证目标：“await page.textContent('.dynamic')” 应等于 “stringified”，从而确认JSON 默认/命名/动态导入共享一致的对象语义。
 */
test('dynamic import', async () => {
  expect(await page.textContent('.dynamic')).toBe(stringified)
})

/** 动态 namespace 同时暴露配置允许的命名导出。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.dynamic-named')”。
 * 验证目标：“await page.textContent('.dynamic-named')” 应等于 “testJson.hello”，从而确认JSON 默认/命名/动态导入共享一致的对象语义。
 */
test('dynamic import, named', async () => {
  expect(await page.textContent('.dynamic-named')).toBe(testJson.hello)
})

// bundled-dev 只服务 bundle；原生 fetch('/test.json') 请求未收入 bundle 的项目文件，故跳过。
/** 原生 fetch 应取得原始 JSON HTTP 响应，不经过模块 namespace 包装。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.fetch')”。
 * 验证目标：“await page.textContent('.fetch')” 应等于 “stringified”，从而确认JSON 作为资产 URL/原始 HTTP 资源时不被误转换。
 */
test.skipIf(isBundledDev)('fetch', async () => {
  expect(await page.textContent('.fetch')).toBe(stringified)
})

/** `?url` 切换到资源语义：build 可内联 data URL，dev 返回可访问路径。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.url')”。
 * 验证目标：“await page.textContent('.url')” 应匹配 “isBundled ? 'data:application/json' : '/test.json'”，从而确认JSON 作为资产 URL/原始 HTTP 资源时不被误转换。
 */
test('?url', async () => {
  expect(await page.textContent('.url')).toMatch(
    isBundled ? 'data:application/json' : '/test.json',
  )
})

/** `?raw` 返回未经 JSON 解析/格式化的原文件文本。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.raw')”。
 * 验证目标：“await page.textContent('.raw')” 应等于 “readFileSync(require.resolve('../../test.json'), 'utf-8')”，从而确认?raw 返回未解析文本。
 */
test('?raw', async () => {
  expect(await page.textContent('.raw')).toBe(
    readFileSync(require.resolve('../../test.json'), 'utf-8'),
  )
})

/** CJS require(json) 沿用 Node 对象语义，不能额外套一层 default。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.require')”。
 * 验证目标：“await page.textContent('.require')” 应等于 “JSON.stringify({ 200: 'ok' })”，从而确认JSON 默认/命名/动态导入共享一致的对象语义。
 */
test('require(json) returns object without default export', async () => {
  expect(await page.textContent('.require')).toBe(JSON.stringify({ 200: 'ok' }))
})

/** JSON 没有自接受边界时，文件编辑应触发 full reload 并得到新对象。 */
/**
 * 场景：在当前 playground 中，修改 “editFile('hmr.json', (code) => code.replace('"this is hmr json"', '"this is hmr update json"'), )”。
 * 验证目标：“await page.textContent('.hmr')” 应等于 “hmrStringified”；“page.textContent('.hmr')” 应匹配 “'"this is hmr update json"'”，从而确认JSON 改动会使模块缓存失效并整页刷新。
 */
test.runIf(isServe)('should full reload', async () => {
  expect(await page.textContent('.hmr')).toBe(hmrStringified)

  editFile('hmr.json', (code) =>
    code.replace('"this is hmr json"', '"this is hmr update json"'),
  )
  await expect
    .poll(() => page.textContent('.hmr'))
    .toMatch('"this is hmr update json"')
})
