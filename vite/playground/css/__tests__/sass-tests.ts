import { expect, test } from 'vitest'
import {
  editFile,
  getBg,
  getColor,
  isBuild,
  isBundled,
  page,
  viteTestUrl,
} from '~utils'

/** 注册 Sass 入口/依赖/URL 的浏览器与开发 HMR 场景，复用默认与 LightningCSS 变体。 */
export const sassTest = () => {
  /** 场景：Sass 入口、@import/别名/relative/partial 与变量/插值/函数 URL 同时加载；逐元素核对颜色和开发路径/bundled资产，非构建时编辑入口及两partial，复用原元素核对红/蓝/绿。 */
  test('sass', async () => {
    const imported = await page.$('.sass')
    const atImport = await page.$('.sass-at-import')
    const atImportAlias = await page.$('.sass-at-import-alias')
    const atImportRelative = await page.$('.sass-at-import-relative')
    const atImportReplacementAlias = await page.$(
      '.sass-at-import-replacement-alias',
    )
    const urlStartsWithVariable = await page.$('.sass-url-starts-with-variable')
    const urlStartsWithVariableInterpolation1 = await page.$(
      '.sass-url-starts-with-interpolation1',
    )
    const urlStartsWithVariableInterpolation2 = await page.$(
      '.sass-url-starts-with-interpolation2',
    )
    const urlStartsWithVariableConcat = await page.$(
      '.sass-url-starts-with-variable-concat',
    )
    const urlStartsWithFunctionCall = await page.$(
      '.sass-url-starts-with-function-call',
    )
    const partialImport = await page.$('.sass-partial')

    expect(await getColor(imported)).toBe('orange')
    expect(await getColor(atImport)).toBe('olive')
    expect(await getBg(atImport)).toMatch(
      isBundled ? /base64/ : '/nested/icon.png',
    )
    expect(await getColor(atImportAlias)).toBe('olive')
    expect(await getBg(atImportAlias)).toMatch(
      isBundled ? /base64/ : '/nested/icon.png',
    )
    expect(await getColor(atImportRelative)).toBe('olive')
    expect(await getBg(atImportRelative)).toMatch(
      isBundled ? /base64/ : '/nested/icon.png',
    )
    expect(await getColor(atImportReplacementAlias)).toBe('olive')
    expect(await getBg(urlStartsWithVariable)).toMatch(
      isBundled ? /ok-[-\w]+\.png/ : `${viteTestUrl}/ok.png`,
    )
    expect(await getBg(urlStartsWithVariableInterpolation1)).toMatch(
      isBundled ? /ok-[-\w]+\.png/ : `${viteTestUrl}/ok.png`,
    )
    expect(await getBg(urlStartsWithVariableInterpolation2)).toMatch(
      isBundled ? /ok-[-\w]+\.png/ : `${viteTestUrl}/ok.png`,
    )
    expect(await getBg(urlStartsWithVariableConcat)).toMatch(
      isBundled ? /ok-[-\w]+\.png/ : `${viteTestUrl}/ok.png`,
    )
    expect(await getBg(urlStartsWithFunctionCall)).toMatch(
      isBundled ? /ok-[-\w]+\.png/ : `${viteTestUrl}/ok.png`,
    )
    expect(await getColor(partialImport)).toBe('orchid')
    expect(await getColor(await page.$('.sass-file-absolute'))).toBe('orange')
    expect(await getColor(await page.$('.sass-dir-index'))).toBe('orange')
    expect(await getColor(await page.$('.sass-root-relative'))).toBe('orange')

    if (isBuild) return

    editFile('sass.scss', (code) =>
      code.replace('color: $injectedColor', 'color: red'),
    )
    await expect.poll(() => getColor(imported)).toBe('red')

    editFile('nested/_index.scss', (code) =>
      code.replace('color: olive', 'color: blue'),
    )
    await expect.poll(() => getColor(atImport)).toBe('blue')

    editFile('nested/_partial.scss', (code) =>
      code.replace('color: orchid', 'color: green'),
    )
    await expect.poll(() => getColor(partialImport)).toBe('green')
  })
}

/** 注册 Sass Modules 类名和路径解析场景；enableHmrTests 参数当前未被读取，颜色编辑仅受 isBuild 控制。 */
export const sassModuleTests = (enableHmrTests = false) => {
  /** 场景：Sass Modules composes 来源路径解析；读取元素颜色为 orangered，核对来源/当前模块两种 scoped class 格式。下方 HMR 步骤被注释，未执行。 */
  test('sass modules composes/from path resolving', async () => {
    const imported = await page.$('.path-resolved-modules-sass')
    expect(await getColor(imported)).toBe('orangered')

    // 生成类名应符合 vite.config.js 的 scoped name 模板。
    expect(await imported.getAttribute('class')).toMatch(
      /.composed-module__apply-color___[\w-]{5}/,
    )

    expect(await imported.getAttribute('class')).toMatch(
      /.composes-path-resolving-module__path-resolving-sass___[\w-]{5}/,
    )

    // TODO：此 composes 来源编辑的 HMR 步骤当前未启用。
    // editFile('composed.module.scss', (code) =>
    //   code.replace('color: orangered', 'color: red')
    // )
    // await expect.poll(() => getColor(imported)).toMatch('red')
  })

  /** 场景：Sass Module 初始 orangered 且 class 符合配置格式；非构建时编辑 mod.module.scss 改蓝，轮询原元素颜色。 */
  test('css modules w/ sass', async () => {
    const imported = await page.$('.modules-sass')
    expect(await getColor(imported)).toBe('orangered')
    expect(await imported.getAttribute('class')).toMatch(
      /.mod-module__apply-color___[\w-]{5}/,
    )

    if (isBuild) return

    editFile('mod.module.scss', (code) =>
      code.replace('color: orangered', 'color: blue'),
    )
    await expect.poll(() => getColor(imported)).toBe('blue')
  })
}

/** 注册依赖包 Sass 入口、exports/deep/wildcard partial 与无 scss 字段的解析场景。 */
export const sassOtherTests = () => {
  /** 场景：Sass @import 使用依赖包 sass 入口；读取 .css-dep-sass 计算颜色为橙。 */
  test('@import dependency w/ sass entry', async () => {
    expect(await getColor('.css-dep-sass')).toBe('orange')
  })

  /** 场景：Sass @import 使用包 exports 映射；读取目标元素，核对橙色规则。 */
  test('@import dependency w/ sass export mapping', async () => {
    expect(await getColor('.css-dep-exports-sass')).toBe('orange')
  })

  /** 场景：Sass @import 使用包深层 exports；读取深层目标元素，核对橙色。 */
  test('@import dependency w/ sass export mapping (deep)', async () => {
    expect(await getColor('.css-dep-exports-deep-sass')).toBe('orange')
  })

  /** 场景：Sass @import 通过 exports wildcard 命中 _partial.scss；核对 partial 规则为橙色。 */
  test('@import dependency w/ sass export wildcard to `_partial.scss`', async () => {
    expect(await getColor('.css-dep-exports-partial-sass')).toBe('orange')
  })

  /** 场景：依赖包没有 scss 字段；Sass 解析其入口样式后读取 .sass-dep，核对 lavender。 */
  test('@import dependency w/out package scss', async () => {
    expect(await getColor('.sass-dep')).toBe('lavender')
  })
}
