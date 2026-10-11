import { expect, test } from 'vitest'
import { isBuild, isBundledDev, page } from '~utils'

/** 由构建/开发矩阵选择的默认模式，供 env 与模式文件覆盖断言比较。 */
const mode = isBuild ? `production` : `development`

/** 场景：夹具配置 base=/env/；读取 .base，核对 import.meta.env.BASE_URL 展示该路径。 */
test('base', async () => {
  expect(await page.textContent('.base')).toBe('/env/')
})

/** 场景：读取夹具 MODE 展示值，核对构建 production、开发 development。 */
test('mode', async () => {
  expect(await page.textContent('.mode')).toBe(mode)
})

/** 场景：读取 DEV 展示值，核对等于当前 !isBuild 的布尔文本。 */
test('dev', async () => {
  expect(await page.textContent('.dev')).toBe(String(!isBuild))
})

/** 场景：读取 PROD 展示值，核对等于当前 isBuild 的布尔文本。 */
test('prod', async () => {
  expect(await page.textContent('.prod')).toBe(String(isBuild))
})

/** 场景：环境文件提供 VITE_CUSTOM_ENV_VARIABLE；读取 .custom，核对字符串1。 */
test('custom', async () => {
  expect(await page.textContent('.custom')).toBe('1')
})

/** 场景：模板插值读取自定义环境值；核对 .custom-template-literal-exp 展示1。 */
test('custom in template literal expression', async () => {
  expect(await page.textContent('.custom-template-literal-exp')).toBe('1')
})

/** 场景：配置自定义 envPrefix；读取 .custom-prefix，核对额外前缀变量值1。 */
test('custom-prefix', async () => {
  expect(await page.textContent('.custom-prefix')).toBe('1')
})

/** 场景：模式级.env覆盖通用文件；读取.mode-file，核对.env.production/development对应当前矩阵。 */
test('mode file override', async () => {
  expect(await page.textContent('.mode-file')).toBe(`.env.${mode}`)
})

/** 场景：测试启动时注入环境变量；读取.inline，核对构建inline-build、开发inline-serve。 */
test('inline variables', async () => {
  expect(await page.textContent('.inline')).toBe(
    isBuild ? `inline-build` : `inline-serve`,
  )
})

/** 场景：配置define提供布尔/数值/字符串/对象环境值；读取四个typeof结果，核对boolean/number/string/object。 */
test('define', async () => {
  expect(await page.textContent('.bool')).toBe('boolean')
  expect(await page.textContent('.number')).toBe('number')
  expect(await page.textContent('.string')).toBe('string')
  expect(await page.textContent('.stringify-object')).toBe('object')
})

/** 场景：三种process/global/globalThis访问NODE_ENV；读取页面，核对均等于测试进程当前NODE_ENV。 */
test('NODE_ENV', async () => {
  expect(await page.textContent('.node-env')).toBe(process.env.NODE_ENV)
  expect(await page.textContent('.global-node-env')).toBe(process.env.NODE_ENV)
  expect(await page.textContent('.global-this-node-env')).toBe(
    process.env.NODE_ENV,
  )
})

/** 场景：环境变量引用其他变量展开；读取.expand-a/.expand-b，核对expand与depend。 */
test('expand', async () => {
  expect(await page.textContent('.expand-a')).toBe('expand')
  expect(await page.textContent('.expand-b')).toBe('depend')
})

/** 场景：客户端入口读取SSR标志；核对页面文本false。 */
test('ssr', async () => {
  expect(await page.textContent('.ssr')).toBe('false')
})

/** 场景：非bundledDev时执行：解析页面整体env对象，核对模式/自定义/展开/转义/base/typed define等字段；not.toHaveProperty的数组是三段嵌套路径，未分别检查三个顶层键。bundledDev skip。 */
test.skipIf(isBundledDev)('env object', async () => {
  const env = JSON.parse(await page.textContent('.env-object'))
  expect(env).not.toHaveProperty([
    'DEPEND_ENV',
    'IRRELEVANT_ENV',
    'IRRELEVANT_ESCAPE_ENV',
  ])
  expect(env).toMatchObject({
    VITE_EFFECTIVE_MODE_FILE_NAME: `.env.${mode}`,
    CUSTOM_PREFIX_ENV_VARIABLE: '1',
    VITE_CUSTOM_ENV_VARIABLE: '1',
    VITE_EXPAND_A: 'expand',
    VITE_EXPAND_B: 'depend',
    VITE_ESCAPE_A: 'escape$',
    VITE_ESCAPE_B: 'escape$',
    BASE_URL: '/env/',
    VITE_BOOL: true,
    SSR: false,
    MODE: mode,
    DEV: !isBuild,
    PROD: isBuild,
    VITE_NUMBER: 123,
    VITE_STRING: '{"123",}',
    VITE_STRINGIFY_OBJECT: {
      a: '1',
      b: '2',
    },
  })
})

/** 场景：模板插值序列化整个env；解析后核对模式文件、两个自定义前缀、BASE_URL与DEV/PROD字段。 */
test('env object in template literal expression', async () => {
  const envText = await page.textContent('.env-object-in-template-literal-exp')
  expect(JSON.parse(envText)).toMatchObject({
    VITE_EFFECTIVE_MODE_FILE_NAME: `.env.${mode}`,
    CUSTOM_PREFIX_ENV_VARIABLE: '1',
    VITE_CUSTOM_ENV_VARIABLE: '1',
    BASE_URL: '/env/',
    MODE: mode,
    DEV: !isBuild,
    PROD: isBuild,
  })
})

if (!isBuild) {
  /** 场景：仅非构建分支：相对导入脚本展示import.meta.url；bundledDev核对入口chunk路径，普通dev核对/env/index.js。 */
  test('relative url import script return import.meta.url', async () => {
    // bundled dev 的 index.js 合入入口chunk，import.meta.url 展示chunk URL。
    expect(await page.textContent('.url')).toMatch(
      isBundledDev ? '/env/assets/index.js' : '/env/index.js',
    )
  })
}

/** 场景：字符串字面量包含 import.meta.env 与其点号前缀；读取两个DOM，核对静态文本保持原样。 */
test('ignores import' + '.meta.env in string literals', async () => {
  expect(await page.textContent('.ignores-literal-import-meta-env-dot')).toBe(
    'import' + '.meta.env.',
  )
  expect(await page.textContent('.ignores-literal-import-meta-env')).toBe(
    'import' + '.meta.env',
  )
})
