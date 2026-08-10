import { expect, test } from 'vitest'
import viteConfig from '../vite.config'
import { isBundledDev, page } from '~utils'

/** 根 Environment 最终参与源码替换的 define 表。 */
const defines = viteConfig.define
/** client Environment 额外覆盖的 define 表。 */
const envDefines = viteConfig.environments.client.define

/** 覆盖表达式、字符串/数值/对象、process.env、特殊标识符及 per-environment define。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.exp')”。
 * 验证目标：“await page.textContent('.exp')” 应等于 “String(typeof eval(defines.__EXP__))”；“await page.textContent('.string')” 应等于 “JSON.parse(defines.__STRING__)”，从而确认define 只替换语法上的标识符/成员表达式，不破坏字符串与可选链。
 */
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

/** define 只改 AST 表达式，字符串中的同名文本和拆开的 import.meta.hot 不应改变。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.ignores-string-literals .process-env-dot')”。
 * 验证目标：“await page.textContent('.ignores-string-literals .process-env-dot')” 应等于 “'process.env.'”；“await page.textContent('.ignores-string-literals .global-process-env-dot')” 应等于 “'global.process.env.'”，从而确认define 只替换语法上的标识符/成员表达式，不破坏字符串与可选链。
 */
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
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent( '.replaces-constants-in-template-literal-expressions .process-env-dot', )”。
 * 验证目标：“await page.textContent( '.replaces-constants-in-template-literal-expressions .process-env-dot', )” 应等于 “JSON.parse(defines['process.env.SOMEVAR'])”；“await page.textContent( '.replaces-constants-in-template-literal-expressions .process-env-NODE_ENV', )” 应等于 “'dev'”，从而确认define 只替换语法上的标识符/成员表达式，不破坏字符串与可选链。
 */
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
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent( '.replace-undefined-constants-on-import-meta-env .import-meta-env-UNDEFINED', )”。
 * 验证目标：“await page.textContent( '.replace-undefined-constants-on-import-meta-env .import-meta-env-UNDEFINED', )” 应等于 “'undefined'”；“await page.textContent( '.replace-undefined-constants-on-import-meta-env .import-meta-env-SOME_IDENTIFIE…” 应等于 “'true'”，从而确认define 只替换语法上的标识符/成员表达式，不破坏字符串与可选链。
 */
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

/** 快速 pattern 需要识别 `process?.env` 可选链，不能因 `?.` 漏掉 transform。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.optional-env')”。
 * 验证目标：“await page.textContent('.optional-env')” 应等于 “JSON.parse(defines['process.env.SOMEVAR'])”，从而确认define 只替换语法上的标识符/成员表达式，不破坏字符串与可选链。
 */
test('optional values are detected by pattern properly', async () => {
  expect(await page.textContent('.optional-env')).toBe(
    JSON.parse(defines['process.env.SOMEVAR']),
  )
})

// bundled-dev 的 `?query` env 入口当前不注入 __DEFINES__，该模式单独跳过。
/** 普通 dev 中带 query 的 `@vite/env` 仍应识别为同一注入入口（#20998）。 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.env-with-query')”。
 * 验证目标：“await page.textContent('.env-with-query')” 应等于 “'success'”，从而确认define 只替换语法上的标识符/成员表达式，不破坏字符串与可选链。
 */
test.skipIf(isBundledDev)(
  'env import with query parameters works correctly',
  async () => {
    expect(await page.textContent('.env-with-query')).toBe('success')
  },
)
