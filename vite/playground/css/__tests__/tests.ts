import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { sassModuleTests, sassOtherTests, sassTest } from './sass-tests'
import {
  editFile,
  findAssetFile,
  getBg,
  getBgColor,
  getColor,
  isBuild,
  isBundled,
  isBundledDev,
  page,
  removeFile,
  serverLogs,
  viteTestUrl,
} from '~utils'

/**
 * CSS 端到端矩阵：同一组 fixture 同时验证开发注入/HMR 与构建抽取/tree-shaking，覆盖 PostCSS、三类
 * 预处理器、CSS Modules、URL、异步 chunk 和输出顺序。用例应在编辑前取得元素并复用，借此确认 CSS
 * HMR 没有偷偷整页 reload。
 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.imported-css-glob')”。
 * 验证目标：“page.textContent('.imported-css-glob')” 应包含 “'.dir-import'”；“page.textContent('.imported-css-globEager')” 应包含 “'.dir-import'”，从而确认CSS @import/url() 依赖经解析、base 重写后仍可访问。
 */
test('imported css', async () => {
  await expect
    .poll(() => page.textContent('.imported-css-glob'))
    .toContain('.dir-import')
  await expect
    .poll(() => page.textContent('.imported-css-globEager'))
    .toContain('.dir-import')
})

/**
 * 场景：在当前 playground 中，修改 “editFile('linked.css', (code) => code.replace('color: blue', 'color: red'))”，然后修改 “editFile('linked-at-import.css', (code) => code.replace('color: red', 'color: blue'), )”。
 * 验证目标：“await getColor(linked)” 应等于 “'blue'”；“await getColor(atImport)” 应等于 “'red'”，从而确认开发态样式注入与构建态 CSS 抽取产生同等视觉结果。
 */
test('linked css', async () => {
  const linked = await page.$('.linked')
  const atImport = await page.$('.linked-at-import')

  expect(await getColor(linked)).toBe('blue')
  expect(await getColor(atImport)).toBe('red')

  // bundled dev 在页面加载中或 client 尚未连接时可能丢失编辑，更新永远到不了页面；并行执行会让下方
  // 编辑步骤不稳定（#23028），因此该模式只验证初始样式。
  if (isBundled) return

  editFile('linked.css', (code) => code.replace('color: blue', 'color: red'))
  await expect.poll(() => getColor(linked)).toBe('red')

  editFile('linked-at-import.css', (code) =>
    code.replace('color: red', 'color: blue'),
  )
  await expect.poll(() => getColor(atImport)).toBe('blue')
})

/**
 * 场景：在当前 playground 中，修改 “editFile('imported.css', (code) => code.replace('color: green', 'color: red'))”，然后修改 “editFile('imported-at-import.css', (code) => code.replace('color: purple', 'color: blue'), )”。
 * 验证目标：“await getColor(imported)” 应等于 “'green'”；“await getColor(atImport)” 应等于 “'purple'”，从而确认CSS @import/url() 依赖经解析、base 重写后仍可访问。
 */
test('css import from js', async () => {
  const imported = await page.$('.imported')
  const atImport = await page.$('.imported-at-import')

  expect(await getColor(imported)).toBe('green')
  expect(await getColor(atImport)).toBe('purple')

  // bundled dev：与 linked css 相同的丢更新问题（#23028）。
  if (isBundled) return

  editFile('imported.css', (code) => code.replace('color: green', 'color: red'))
  await expect.poll(() => getColor(imported)).toBe('red')

  editFile('imported-at-import.css', (code) =>
    code.replace('color: purple', 'color: blue'),
  )
  await expect.poll(() => getColor(atImport)).toBe('blue')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getBg(importedWithSpace)”。
 * 验证目标：“await getBg(importedWithSpace)” 应匹配 “/.*\/ok.*\.png/”，从而确认CSS @import/url() 依赖经解析、base 重写后仍可访问。
 */
test('css import asset with space', async () => {
  const importedWithSpace = await page.$('.import-with-space')

  expect(await getBg(importedWithSpace)).toMatch(/.*\/ok.*\.png/)
})

/**
 * 场景：在当前 playground 中，修改 “editFile('imported.css', (code) => code.replace('color: pink', 'color: red'))”。
 * 验证目标：“await getColor(imported)” 应等于 “'pink'”；“getColor(imported)” 应等于 “'red'”，从而确认预处理器/PostCSS 配置、依赖和 Source 路径被正确传递。
 */
test('postcss config', async () => {
  const imported = await page.$('.postcss .nesting')
  expect(await getColor(imported)).toBe('pink')

  // bundled dev：与 linked css 相同的丢更新问题（#23028）。
  if (isBundled) return

  editFile('imported.css', (code) => code.replace('color: pink', 'color: red'))
  await expect.poll(() => getColor(imported)).toBe('red')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getBg(imported)”。
 * 验证目标：“await getBg(imported)” 应匹配 “/localhost(?::\d+)?\/(?:assets\/)?ok.*\.png/”，从而确认预处理器/PostCSS 配置、依赖和 Source 路径被正确传递。
 */
test('postcss plugin that injects url()', async () => {
  const imported = await page.$('.inject-url')
  // PostCSS 插件后注入的 url() 也必须经过 alias 解析。
  expect(await getBg(imported)).toMatch(
    /localhost(?::\d+)?\/(?:assets\/)?ok.*\.png/,
  )
})

sassTest()

/**
 * 场景：在当前 playground 中，修改 “editFile('less.less', (code) => code.replace('@color: blue', '@color: red'))”，然后修改 “editFile('nested/nested.less', (code) => code.replace('color: darkslateblue', 'color: blue'), )”。
 * 验证目标：“await getColor(imported)” 应等于 “'blue'”；“await getColor(atImport)” 应等于 “'darkslateblue'”，从而确认预处理器/PostCSS 配置、依赖和 Source 路径被正确传递。
 */
test('less', async () => {
  const imported = await page.$('.less')
  const atImport = await page.$('.less-at-import')
  const atImportAlias = await page.$('.less-at-import-alias')
  const atImportUrlOmmer = await page.$('.less-at-import-url-ommer')
  const urlStartsWithVariable = await page.$('.less-url-starts-with-variable')
  const urlStartsWithInterpolation = await page.$(
    '.less-url-starts-with-interpolation',
  )

  expect(await getColor(imported)).toBe('blue')
  expect(await getColor(atImport)).toBe('darkslateblue')
  expect(await getBg(atImport)).toMatch(
    isBundled ? /base64/ : '/nested/icon.png',
  )
  expect(await getColor(atImportAlias)).toBe('darkslateblue')
  expect(await getBg(atImportAlias)).toMatch(
    isBundled ? /base64/ : '/nested/icon.png',
  )
  expect(await getColor(atImportUrlOmmer)).toBe('darkorange')
  expect(await getBg(urlStartsWithVariable)).toMatch(
    isBundled ? /ok-[-\w]+\.png/ : `${viteTestUrl}/ok.png`,
  )
  expect(await getBg(urlStartsWithInterpolation)).toMatch(
    isBundled ? /ok-[-\w]+\.png/ : `${viteTestUrl}/ok.png`,
  )

  if (isBuild) return

  editFile('less.less', (code) => code.replace('@color: blue', '@color: red'))
  await expect.poll(() => getColor(imported)).toBe('red')

  editFile('nested/nested.less', (code) =>
    code.replace('color: darkslateblue', 'color: blue'),
  )
  await expect.poll(() => getColor(atImport)).toBe('blue')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getBg(body)”。
 * 验证目标：“await getBg(body)” 应等于 “'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdj…”，从而确认预处理器/PostCSS 配置、依赖和 Source 路径被正确传递。
 */
test('less-plugin', async () => {
  const body = await page.$('.less-js-plugin')
  expect(await getBg(body)).toBe(
    'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdjYGD4/x8AAwIB/8myre4AAAAASUVORK5CYII=")',
  )
})

/**
 * 场景：在当前 playground 中，修改 “editFile('stylus.styl', (code) => code.replace('$color ?= blue', '$color ?= red'), )”，然后修改 “editFile('nested/nested.styl', (code) => code.replace('color darkslateblue', 'color blue'), )”。
 * 验证目标：“await getColor(imported)” 应等于 “'blue'”；“await getColor(additionalData)” 应等于 “'orange'”，从而确认预处理器/PostCSS 配置、依赖和 Source 路径被正确传递。
 */
test('stylus', async () => {
  const imported = await page.$('.stylus')
  const additionalData = await page.$('.stylus-additional-data')
  const relativeImport = await page.$('.stylus-import')
  const relativeImportAlias = await page.$('.stylus-import-alias')
  const optionsRelativeImport = await page.$('.stylus-options-relative-import')
  const optionsAbsoluteImport = await page.$('.stylus-options-absolute-import')
  const optionsDefineVar = await page.$('.stylus-options-define-var')
  const optionsDefineFunc = await page.$('.stylus-options-define-func')

  expect(await getColor(imported)).toBe('blue')
  expect(await getColor(additionalData)).toBe('orange')
  expect(await getColor(relativeImport)).toBe('darkslateblue')
  expect(await getColor(relativeImportAlias)).toBe('darkslateblue')
  expect(await getBg(relativeImportAlias)).toMatch(
    isBundled ? /base64/ : '/nested/icon.png',
  )
  expect(await getColor(optionsRelativeImport)).toBe('green')
  expect(await getColor(optionsAbsoluteImport)).toBe('red')
  expect(await getColor(optionsDefineVar)).toBe('rgb(51, 197, 255)')
  expect(await getColor(optionsDefineFunc)).toBe('rgb(255, 0, 98)')

  if (isBuild) return

  editFile('stylus.styl', (code) =>
    code.replace('$color ?= blue', '$color ?= red'),
  )
  await expect.poll(() => getColor(imported)).toBe('red')

  editFile('nested/nested.styl', (code) =>
    code.replace('color darkslateblue', 'color blue'),
  )
  await expect.poll(() => getColor(relativeImport)).toBe('blue')
})

/**
 * 场景：在当前 playground 中，修改 “editFile('mod.module.css', (code) => code.replace('color: turquoise', 'color: red'), )”。
 * 验证目标：“await getColor(imported)” 应等于 “'turquoise'”；“await imported.getAttribute('class')” 应匹配 “/.mod-module__apply-color___[\w-]{5}/”，从而确认CSS Modules 映射、composes 解析和 tree-shaking 边界正确。
 */
test('css modules', async () => {
  const imported = await page.$('.modules')
  expect(await getColor(imported)).toBe('turquoise')

  // 生成的 CSS Module class 必须遵循 vite.config.js 的 scoped name 格式。
  expect(await imported.getAttribute('class')).toMatch(
    /.mod-module__apply-color___[\w-]{5}/,
  )

  if (isBuild) return

  editFile('mod.module.css', (code) =>
    code.replace('color: turquoise', 'color: red'),
  )
  await expect.poll(() => getColor(imported)).toBe('red')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor(imported)”。
 * 验证目标：“await getColor(imported)” 应等于 “'turquoise'”；“await imported.getAttribute('class')” 应匹配 “/.composed-module__apply-color___[\w-]{5}/”，从而确认CSS Modules 映射、composes 解析和 tree-shaking 边界正确。
 */
test('css modules composes/from path resolving', async () => {
  const imported = await page.$('.path-resolved-modules-css')
  expect(await getColor(imported)).toBe('turquoise')

  // compose 后的 class 仍使用 vite.config.js 指定的 scoped name 格式。
  expect(await imported.getAttribute('class')).toMatch(
    /.composed-module__apply-color___[\w-]{5}/,
  )

  expect(await imported.getAttribute('class')).toMatch(
    /.composes-path-resolving-module__path-resolving-css___[\w-]{5}/,
  )

  // TODO：当前 compose 来源变化尚不能正确 HMR；保留预期步骤作为能力缺口记录。
  // editFile('composed.module.css', (code) =>
  //   code.replace('color: turquoise', 'color: red')
  // )
  // await expect.poll(() => getColor(imported)).toBe('red')
})

sassModuleTests()

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor(imported)”。
 * 验证目标：“await getColor(imported)” 应等于 “'blue'”；“await imported.getAttribute('class')” 应匹配 “/.composed-module__apply-color___[\w-]{5}/”，从而确认CSS Modules 映射、composes 解析和 tree-shaking 边界正确。
 */
test('less modules composes/from path resolving', async () => {
  const imported = await page.$('.path-resolved-modules-less')
  expect(await getColor(imported)).toBe('blue')

  // Less Modules compose 后的 class 同样遵循配置格式。
  expect(await imported.getAttribute('class')).toMatch(
    /.composed-module__apply-color___[\w-]{5}/,
  )

  expect(await imported.getAttribute('class')).toMatch(
    /.composes-path-resolving-module__path-resolving-less___[\w-]{5}/,
  )

  // TODO：当前预处理器 Modules compose 来源变化尚不能正确 HMR。
  // editFile('composed.module.scss', (code) =>
  //   code.replace('color: orangered', 'color: red')
  // )
  // await expect.poll(() => getColor(imported)).toBe('red')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “css”。
 * 验证目标：“css” 应匹配 “/\.inline-module__apply-color-inline___[\w-]{5}/”，从而确认CSS Modules 映射、composes 解析和 tree-shaking 边界正确。
 */
test('inline css modules', async () => {
  const css = await page.textContent('.modules-inline')
  expect(css).toMatch(/\.inline-module__apply-color-inline___[\w-]{5}/)
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “log”。
 * 验证目标：“log” 不应匹配 “'"@charset" must be the first rule in the file'”，从而确认开发态样式注入与构建态 CSS 抽取产生同等视觉结果。
 */
test.runIf(isBuild)('@charset hoist', async () => {
  serverLogs.forEach((log) => {
    // finalizeCss 已提升 @charset，esbuild CSS minifier 不应再警告位置非法。
    expect(log).not.toMatch('"@charset" must be the first rule in the file')
  })
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor('.layers-blue')”。
 * 验证目标：“await getColor('.layers-blue')” 应匹配 “'blue'”；“await getColor('.layers-green')” 应匹配 “'green'”，从而确认开发态样式注入与构建态 CSS 抽取产生同等视觉结果。
 */
test('layers', async () => {
  expect(await getColor('.layers-blue')).toMatch('blue')
  expect(await getColor('.layers-green')).toMatch('green')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await icon.evaluate((span) => getComputedStyle(span).maskImage)”。
 * 验证目标：“await icon.evaluate((span) => getComputedStyle(span).maskImage)” 应包含 “'data:image/svg+xml,'”，从而确认CSS @import/url() 依赖经解析、base 重写后仍可访问。
 */
test('@import external css', async () => {
  const icon = page.locator('.icon--mdi-light--help-circle')
  expect(
    await icon.evaluate((span) => getComputedStyle(span).maskImage),
  ).toContain('data:image/svg+xml,')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor('.css-dep')”。
 * 验证目标：“await getColor('.css-dep')” 应等于 “'purple'”，从而确认CSS @import/url() 依赖经解析、base 重写后仍可访问。
 */
test('@import dependency w/ style entry', async () => {
  expect(await getColor('.css-dep')).toBe('purple')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor('.css-dep-exports')”。
 * 验证目标：“await getColor('.css-dep-exports')” 应等于 “'purple'”，从而确认CSS @import/url() 依赖经解析、base 重写后仍可访问。
 */
test('@import dependency w/ style export mapping', async () => {
  expect(await getColor('.css-dep-exports')).toBe('purple')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor('.css-proxy-dep')”。
 * 验证目标：“await getColor('.css-proxy-dep')” 应等于 “'purple'”，从而确认CSS @import/url() 依赖经解析、base 重写后仍可访问。
 */
test('@import dependency that @import another dependency', async () => {
  expect(await getColor('.css-proxy-dep')).toBe('purple')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor('.scss-proxy-dep')”。
 * 验证目标：“await getColor('.scss-proxy-dep')” 应等于 “'purple'”，从而确认预处理器/PostCSS 配置、依赖和 Source 路径被正确传递。
 */
test('@import scss dependency that has @import with a css extension pointing to another dependency', async () => {
  expect(await getColor('.scss-proxy-dep')).toBe('purple')
})

sassOtherTests()

/**
 * 场景：在当前 playground 中，修改 “editFile('async.css', (code) => code.replace('color: teal', 'color: blue '))”。
 * 验证目标：“await getColor(el)” 应等于 “'teal'”；“findAssetFile(/index-[-\w]{8}\.css$/)” 不应匹配 “'teal'”，从而确认异步 chunk 的 CSS 抽取、去重与执行顺序稳定。
 */
test('async chunk', async () => {
  const el = await page.$('.async')
  expect(await getColor(el)).toBe('teal')

  if (isBuild) {
    // 异步 chunk CSS 应抽成独立 sidecar，而不是混入入口 CSS。
    expect(findAssetFile(/index-[-\w]{8}\.css$/)).not.toMatch('teal')
    expect(findAssetFile(/async-[-\w]{8}\.css$/)).toMatch('.async{color:teal}')
  } else {
    // 开发态走 CSS 自接受 HMR，并复用原 DOM 元素。
    editFile('async.css', (code) => code.replace('color: teal', 'color: blue '))
    await expect.poll(() => getColor(el)).toBe('blue')
  }
})

/**
 * 场景：在当前 playground 中，修改 “editFile('async-treeshaken.css', (code) => code.replace('color: plum', 'color: blue '), )”。
 * 验证目标：“await page.evaluate(() => { return document.querySelector('.async-treeshaken') })” 应为 null；“findAssetFile(/\.css$/)” 不应匹配 “'plum'”，从而确认异步 chunk 的 CSS 抽取、去重与执行顺序稳定。
 */
test('treeshaken async chunk', async () => {
  if (isBuild) {
    // 生产 tree-shaking 后异步模块 DOM/代码均不存在。
    expect(
      await page.evaluate(() => {
        return document.querySelector('.async-treeshaken')
      }),
    ).toBeNull()
    // 被 tree-shake 的样式不能残留在任何 CSS/JS 输出。
    expect(findAssetFile(/\.css$/)).not.toMatch('plum')
    expect(findAssetFile(/index-[-\w]+\.js$/)).not.toMatch('.async{color:plum}')
    expect(findAssetFile(/async-[-\w]+\.js$/)).not.toMatch('.async{color:plum}')
    // 连异步 chunk 占位文件也不应存在。
    expect(findAssetFile(/async-treeshaken/)).toBeUndefined()
  } else {
    // 开发态不做生产 tree-shaking，样式仍存在并可 HMR。
    const el = await page.$('.async-treeshaken')
    editFile('async-treeshaken.css', (code) =>
      code.replace('color: plum', 'color: blue '),
    )
    await expect.poll(() => getColor(el)).toBe('blue')
  }
})

/**
 * 场景：在当前 playground 中，修改 “editFile('glob-dep/foo.css', (code) => code.replace('color: grey', 'color: blue '), )”，然后修改 “editFile('glob-dep/bar.css', (code) => code.replace('color: grey', 'color: red'), )”。
 * 验证目标：“await getColor(el1)” 应等于 “'grey'”；“await getColor(el2)” 应等于 “'grey'”，从而确认预处理器/PostCSS 配置、依赖和 Source 路径被正确传递。
 */
test('PostCSS dir-dependency', async () => {
  const el1 = await page.$('.dir-dep')
  const el2 = await page.$('.dir-dep-2')
  const el3 = await page.$('.dir-dep-3')

  expect(await getColor(el1)).toBe('grey')
  expect(await getColor(el2)).toBe('grey')
  expect(await getColor(el3)).toBe('grey')

  // 注意：Lightning CSS 不支持插件登记 dir-dependency；此 HMR 部分只验证 PostCSS 模式。
  if (!isBuild) {
    editFile('glob-dep/foo.css', (code) =>
      code.replace('color: grey', 'color: blue '),
    )
    await expect.poll(() => getColor(el1)).toBe('blue')
    expect(await getColor(el2)).toBe('grey')

    editFile('glob-dep/bar.css', (code) =>
      code.replace('color: grey', 'color: red'),
    )
    await expect.poll(() => getColor(el2)).toBe('red')
    expect(await getColor(el1)).toBe('blue')

    editFile('glob-dep/nested (dir)/baz.css', (code) =>
      code.replace('color: grey', 'color: green'),
    )
    await expect.poll(() => getColor(el3)).toBe('green')
    expect(await getColor(el1)).toBe('blue')
    expect(await getColor(el2)).toBe('red')

    // 删除 glob 命中文件也应触发目录依赖更新。
    removeFile('glob-dep/bar.css')
    await expect.poll(() => getColor(el2)).toBe('black')
  }
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor('.css-js-dep')”。
 * 验证目标：“await getColor('.css-js-dep')” 应等于 “'green'”；“await getColor('.css-js-dep-module')” 应等于 “'green'”，从而确认CSS @import/url() 依赖经解析、base 重写后仍可访问。
 */
test('import dependency includes css import', async () => {
  expect(await getColor('.css-js-dep')).toBe('green')
  expect(await getColor('.css-js-dep-module')).toBe('green')
})

/**
 * 场景：在当前 playground 中，修改 “editFile('imported.css', (code) => code.replace(cases[i - 1], c) + '\n')”。
 * 验证目标：“getBg(urlSeparated)” 应匹配 “/^url\(.+\)(?:\s*,\s*url\(.+\))*$/”，从而确认CSS @import/url() 依赖经解析、base 重写后仍可访问。
 */
test('URL separation', async () => {
  const urlSeparated = await page.$('.url-separated')
  const baseUrl = 'url(images/dog.webp)'
  const cases = new Array(5)
    .fill('')
    .flatMap((_, i) =>
      [',', ' ,', ', ', ' , '].map(
        (sep) =>
          `background-image:${new Array(i + 1).fill(baseUrl).join(sep)};`,
      ),
    )

  // 先插入包含两个 URL 的基准 case。
  cases.unshift('background-image:url(images/cat.webp),url(images/dog.webp)')

  for (const [c, i] of cases.map((c, i) => [c, i]) as [string, number][]) {
    // 逐轮替换上一个 case，验证不同逗号空白组合都不会把相邻 URL 粘连。
    if (i > 0)
      editFile('imported.css', (code) => code.replace(cases[i - 1], c) + '\n')

    await expect
      .poll(() => getBg(urlSeparated))
      .toMatch(/^url\(.+\)(?:\s*,\s*url\(.+\))*$/)
  }
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor('.inlined')”。
 * 验证目标：“await getColor('.inlined')” 应等于 “'black'”，从而确认开发态样式注入与构建态 CSS 抽取产生同等视觉结果。
 */
test('inlined', async () => {
  // ?inline 只导出字符串，不应把样式插入页面。
  expect(await getColor('.inlined')).toBe('black')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “code”。
 * 验证目标：“code” 应包含 “'background:'”；“code” 不应包含 “'__VITE_ASSET__'”，从而确认开发态样式注入与构建态 CSS 抽取产生同等视觉结果。
 */
test('inlined-code', async () => {
  const code = await page.textContent('.inlined-code')
  // inline 字符串中的资源仍应解析，不能残留内部占位符。
  expect(code).toContain('background:')
  expect(code).not.toContain('__VITE_ASSET__')

  if (isBuild) {
    expect(code.trim()).not.toContain('\n') // 构建态 inline CSS 已压缩。
  }
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “cssFile”。
 * 验证目标：“cssFile” 应匹配 “'rgba('”；“cssFile” 不应匹配 “'#ffff00b3'”，从而确认开发态样式注入与构建态 CSS 抽取产生同等视觉结果。
 */
test('minify css', async () => {
  if (!isBuild) {
    return
  }

  // cssTarget 要求保留 rgba() 时，minifier 不能改成不兼容的 8 位 hex。
  const cssFile = findAssetFile(/index-[-\w]+\.css$/)
  expect(cssFile).toMatch('rgba(')
  expect(cssFile).not.toMatch('#ffff00b3')
})

// bundled dev 当前把 css?url 直接变成源文件 data URI，没有先运行 PostCSS，因此目标规则根本不会生成。
// 这是 #22863 的真实缺陷；修复后无需修改用例即可重新通过。
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor('.url-imported-css')”。
 * 验证目标：“await getColor('.url-imported-css')” 应等于 “'yellow'”，从而确认CSS @import/url() 依赖经解析、base 重写后仍可访问。
 */
test.skipIf(isBundledDev)('?url', async () => {
  expect(await getColor('.url-imported-css')).toBe('yellow')
})

/**
 * 场景：在当前 playground 中，修改 “editFile('raw-imported.css', (code) => code.replace('color: yellow', 'color: blue'), )”。
 * 验证目标：“await rawImportCss.textContent()” 应等于 “readFileSync(require.resolve('../raw-imported.css'), 'utf-8')”；“page.textContent('.raw-imported-css')” 应匹配 “'color: blue'”，从而确认开发态样式注入与构建态 CSS 抽取产生同等视觉结果。
 */
test('?raw', async () => {
  const rawImportCss = await page.$('.raw-imported-css')

  expect(await rawImportCss.textContent()).toBe(
    readFileSync(require.resolve('../raw-imported.css'), 'utf-8'),
  )

  // bundled dev 编辑 ?raw import 仍无法到达页面（#23028）。
  if (!isBundled) {
    editFile('raw-imported.css', (code) =>
      code.replace('color: yellow', 'color: blue'),
    )
    await expect
      .poll(() => page.textContent('.raw-imported-css'))
      .toMatch('color: blue')
  }
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor('.css-in-less')”。
 * 验证目标：“await getColor('.css-in-less')” 应等于 “'yellow'”；“await getColor('.css-in-less-2')” 应等于 “'blue'”，从而确认预处理器/PostCSS 配置、依赖和 Source 路径被正确传递。
 */
test('import css in less', async () => {
  expect(await getColor('.css-in-less')).toBe('yellow')
  expect(await getColor('.css-in-less-2')).toBe('blue')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getBg('.form-box-data-uri')”。
 * 验证目标：“await getBg('.form-box-data-uri')” 应匹配 “/^url\("data:image\/svg\+xml,%3Csvg/”，从而确认预处理器/PostCSS 配置、依赖和 Source 路径被正确传递。
 */
test("relative path rewritten in Less's data-uri", async () => {
  // 传给 Less data-uri 的相对路径先改写为绝对路径，随后由 Less 内联。
  expect(await getBg('.form-box-data-uri')).toMatch(
    /^url\("data:image\/svg\+xml,%3Csvg/,
  )
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “code”。
 * 验证目标：“code” 应包含 “'/postcss-source-input.css?inline&query=foo'”，从而确认预处理器/PostCSS 配置、依赖和 Source 路径被正确传递。
 */
test('PostCSS source.input.from includes query', async () => {
  const code = await page.textContent('.postcss-source-input')
  // 带 query 的 PostCSS source.input.from 仍能作为资源解析 importer。
  expect(code).toContain('/postcss-source-input.css?inline&query=foo')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor('.aliased')”。
 * 验证目标：“await getColor('.aliased')” 应等于 “'blue'”；“await getColor('.aliased-module')” 应等于 “'blue'”，从而确认开发态样式注入与构建态 CSS 抽取产生同等视觉结果。
 */
test('aliased css has content', async () => {
  expect(await getColor('.aliased')).toBe('blue')
  // 暂不支持 alias CSS 作为文本内容返回，见 #8936。
  // expect(await page.textContent('.aliased-content')).toMatch('.aliased')
  expect(await getColor('.aliased-module')).toBe('blue')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor('.imports-field')”。
 * 验证目标：“await getColor('.imports-field')” 应等于 “'red'”，从而确认CSS @import/url() 依赖经解析、base 重写后仍可访问。
 */
test('resolve imports field in CSS', async () => {
  expect(await getColor('.imports-field')).toBe('red')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “log”。
 * 验证目标：“log” 不应匹配 “'unsupported-css-property'”，从而确认开发态样式注入与构建态 CSS 抽取产生同等视觉结果。
 */
test.runIf(isBuild)('warning can be suppressed by esbuild.logOverride', () => {
  serverLogs.forEach((log) => {
    // 用户 logOverride 应能抑制 esbuild CSS minifier 警告。
    expect(log).not.toMatch('unsupported-css-property')
  })
})

/**
 * 场景：在当前 playground 中，修改 “editFile('sugarss.sss', (code) => code.replace('color: blue', 'color: coral'))”，然后修改 “editFile('nested/nested.sss', (code) => code.replace('color: darkslateblue', 'color: blue'), )”。
 * 验证目标：“await getColor(imported)” 应等于 “'blue'”；“await getColor(atImport)” 应等于 “'darkslateblue'”，从而确认预处理器/PostCSS 配置、依赖和 Source 路径被正确传递。
 */
test('sugarss', async () => {
  const imported = await page.$('.sugarss')
  const atImport = await page.$('.sugarss-at-import')
  const atImportAlias = await page.$('.sugarss-at-import-alias')

  expect(await getColor(imported)).toBe('blue')
  expect(await getColor(atImport)).toBe('darkslateblue')
  expect(await getBg(atImport)).toMatch(
    isBundled ? /base64/ : '/nested/icon.png',
  )
  expect(await getColor(atImportAlias)).toBe('darkslateblue')
  expect(await getBg(atImportAlias)).toMatch(
    isBundled ? /base64/ : '/nested/icon.png',
  )

  if (isBuild) return

  editFile('sugarss.sss', (code) => code.replace('color: blue', 'color: coral'))
  await expect.poll(() => getColor(imported)).toBe('coral')

  editFile('nested/nested.sss', (code) =>
    code.replace('color: darkslateblue', 'color: blue'),
  )
  await expect.poll(() => getColor(atImport)).toBe('blue')
})

// 注意：异步 CSS 顺序的 snapshot/预期应以构建态输出顺序为准。
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “getColor('.async-green')”。
 * 验证目标：“getColor('.async-green')” 应等于 “'green'”；“getColor('.async-blue')” 应等于 “'blue'”，从而确认异步 chunk 的 CSS 抽取、去重与执行顺序稳定。
 */
test('async css order', async () => {
  await expect.poll(() => getColor('.async-green')).toBe('green')
  await expect.poll(() => getColor('.async-blue')).toBe('blue')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “getColor('.modules-pink')”。
 * 验证目标：“getColor('.modules-pink')” 应等于 “'pink'”，从而确认CSS Modules 映射、composes 解析和 tree-shaking 边界正确。
 */
test('async css order with css modules', async () => {
  await expect.poll(() => getColor('.modules-pink')).toBe('pink')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getColor('.at-import-scss')”。
 * 验证目标：“await getColor('.at-import-scss')” 应等于 “'red'”，从而确认预处理器/PostCSS 配置、依赖和 Source 路径被正确传递。
 */
test('@import scss', async () => {
  expect(await getColor('.at-import-scss')).toBe('red')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “findAssetFile(/manual-chunk-[-\w]{8}\.css$/, undefined, 'assets/dir/dir2')”。
 * 验证目标：“findAssetFile(/manual-chunk-[-\w]{8}\.css$/, undefined, 'assets/dir/dir2')” 应不为 undefined，从而确认异步 chunk 的 CSS 抽取、去重与执行顺序稳定。
 */
test.runIf(isBuild)('manual chunk path', async () => {
  // manual chunk CSS 应输出到 manualChunk 指定的嵌套目录（#12072）。
  expect(
    findAssetFile(/manual-chunk-[-\w]{8}\.css$/, undefined, 'assets/dir/dir2'),
  ).not.toBeUndefined()
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “css”。
 * 验证目标：“css” 不应包含 “'treeshake-module-b'”，从而确认CSS Modules 映射、composes 解析和 tree-shaking 边界正确。
 */
test.runIf(isBuild)('CSS modules should be treeshaken if not used', () => {
  const css = findAssetFile(/\.css$/, undefined, undefined, true)
  expect(css).not.toContain('treeshake-module-b')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “css”。
 * 验证目标：“css” 不应匹配 “/\btreeshake-scoped-b\b/”；“css” 不应匹配 “/\btreeshake-scoped-c\b/”，从而确认开发态样式注入与构建态 CSS 抽取产生同等视觉结果。
 */
test.runIf(isBuild)('Scoped CSS via cssScopeTo should be treeshaken', () => {
  const css = findAssetFile(/\.css$/, undefined, undefined, true)
  expect(css).not.toMatch(/\btreeshake-scoped-b\b/)
  expect(css).not.toMatch(/\btreeshake-scoped-c\b/)
})

/**
 * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl + '/treeshake-scoped/')”。
 * 验证目标：“getColor('.treeshake-scoped-order')” 应等于 “'red'”；“getBgColor('.treeshake-scoped-order')” 应等于 “'blue'”，从而确认异步 chunk 的 CSS 抽取、去重与执行顺序稳定。
 */
test('Scoped CSS should have a correct order', async () => {
  await page.goto(viteTestUrl + '/treeshake-scoped/')
  await expect.poll(() => getColor('.treeshake-scoped-order')).toBe('red')
  await expect.poll(() => getBgColor('.treeshake-scoped-order')).toBe('blue')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “findAssetFile(/empty-[-\w]{8}\.css$/)”。
 * 验证目标：“findAssetFile(/empty-[-\w]{8}\.css$/)” 应不为 undefined；“findAssetFile(/empty-[-\w]{8}\.js$/)” 应为 undefined，从而确认CSS @import/url() 依赖经解析、base 重写后仍可访问。
 */
test.runIf(isBuild)(
  'empty CSS files should generate .css assets, not .js assets',
  () => {
    // 空 CSS 入口仍生成 .css asset，并删除纯 CSS 的空 .js 占位 chunk。
    expect(findAssetFile(/empty-[-\w]{8}\.css$/)).not.toBeUndefined()
    expect(findAssetFile(/empty-[-\w]{8}\.js$/)).toBeUndefined()
  },
)
