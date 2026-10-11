import { expect, test } from 'vitest'
import viteConfig from '../vite.config'
import { isBundledDev, page } from '~utils'

/** 根 Environment 最终参与源码替换的 define 表。 */
const defines = viteConfig.define
/** client Environment 额外覆盖的 define 表。 */
const envDefines = viteConfig.environments.client.define

/** 覆盖表达式、字符串/数值/对象、process.env、特殊标识符及 per-environment define。 */
test('string', async () => {
  expect(await page.textContent('.exp')).toBe(
    String(typeof eval(defines.__EXP__)),
  )
  expect(await page.textContent('.string')).toBe(JSON.parse(defines.__STRING__))
  expect(await page.textContent('.number')).toBe(String(defines.__NUMBER__))
  expect(await page.textContent('.boolean')).toBe(String(defines.__BOOLEAN__))
  expect(await page.textContent('.undefined')).toBe('')

  expect(await page.textContent('.object')).toBe(
    JSON.stringify(defines.__OBJ__, null, 2),
  )
  expect(await page.textContent('.process-node-env')).toBe(
    JSON.parse(defines['process.env.NODE_ENV']),
  )
  expect(await page.textContent('.process-env')).toBe(
    JSON.stringify(defines['process.env'], null, 2),
  )
  expect(await page.textContent('.env-var')).toBe(
    JSON.parse(defines['process.env.SOMEVAR']),
  )
  expect(await page.textContent('.process-as-property')).toBe(
    defines.__OBJ__.process.env.SOMEVAR,
  )
  expect(await page.textContent('.spread-object')).toBe(
    JSON.stringify({ SOMEVAR: defines['process.env.SOMEVAR'] }),
  )
  expect(await page.textContent('.spread-array')).toBe(
    JSON.stringify([...defines.__STRING__]),
  )
  expect(await page.textContent('.dollar-identifier')).toBe(
    String(defines.$DOLLAR),
  )
  expect(await page.textContent('.unicode-identifier')).toBe(
    String(defines.ÖUNICODE_LETTERɵ),
  )
  expect(await page.textContent('.no-identifier-substring')).toBe(String(true))
  expect(await page.textContent('.no-property')).toBe(String(true))
  // HTML 文本与 JSON 文件内容不属于 JS define transform，必须保持原字符串。
  expect(await page.textContent('.exp-define')).toBe('__EXP__')
  expect(await page.textContent('.import-json')).toBe('__EXP__')
  expect(await page.textContent('.define-in-dep')).toBe(
    defines.__STRINGIFIED_OBJ__,
  )
  expect(await page.textContent('.define-in-environment')).toBe(
    envDefines.__DEFINE_IN_ENVIRONMENT__,
  )
})

/** 字符串中的同名文本和拆开的 import.meta.hot 不应被 define 改写。 */
test('ignores constants in string literals', async () => {
  expect(
    await page.textContent('.ignores-string-literals .process-env-dot'),
  ).toBe('process.env.')
  expect(
    await page.textContent('.ignores-string-literals .global-process-env-dot'),
  ).toBe('global.process.env.')
  expect(
    await page.textContent(
      '.ignores-string-literals .globalThis-process-env-dot',
    ),
  ).toBe('globalThis.process.env.')
  expect(
    await page.textContent('.ignores-string-literals .process-env-NODE_ENV'),
  ).toBe('process.env.NODE_ENV')
  expect(
    await page.textContent(
      '.ignores-string-literals .global-process-env-NODE_ENV',
    ),
  ).toBe('global.process.env.NODE_ENV')
  expect(
    await page.textContent(
      '.ignores-string-literals .globalThis-process-env-NODE_ENV',
    ),
  ).toBe('globalThis.process.env.NODE_ENV')
  expect(
    await page.textContent('.ignores-string-literals .import-meta-hot'),
  ).toBe('import' + '.meta.hot')
})

/** 模板字面量静态文本保持不变，但 `${...}` 表达式内部仍要替换。 */
test('replaces constants in template literal expressions', async () => {
  expect(
    await page.textContent(
      '.replaces-constants-in-template-literal-expressions .process-env-dot',
    ),
  ).toBe(JSON.parse(defines['process.env.SOMEVAR']))
  expect(
    await page.textContent(
      '.replaces-constants-in-template-literal-expressions .process-env-NODE_ENV',
    ),
  ).toBe('dev')
})

/** import.meta.env define 可引用 undefined 或其他源码标识符，不要求自身是 JSON。 */
test('replace constants on import.meta.env when it is a invalid json', async () => {
  expect(
    await page.textContent(
      '.replace-undefined-constants-on-import-meta-env .import-meta-env-UNDEFINED',
    ),
  ).toBe('undefined')
  expect(
    await page.textContent(
      '.replace-undefined-constants-on-import-meta-env .import-meta-env-SOME_IDENTIFIER',
    ),
  ).toBe('true')
})

/** 普通属性与 `process?.env` 可选链读取相同的用户 define 值。 */
test('optional values are detected by pattern properly', async () => {
  expect(await page.textContent('.optional-env')).toBe(
    JSON.parse(defines['process.env.SOMEVAR']),
  )
})

/** 场景：入口导入带 query 的 @vite/env，读取页面success；非bundledDev矩阵执行，bundledDev skip（#20998）。 */
test.skipIf(isBundledDev)(
  'env import with query parameters works correctly',
  async () => {
    expect(await page.textContent('.env-with-query')).toBe('success')
  },
)
