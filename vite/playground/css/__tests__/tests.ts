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
 * HMR 复用原页面元素。
 */
/** lazy/eager glob 导入的 CSS 文本都包含 .dir-import 规则。 */
test('imported css', async () => {
  await expect
    .poll(() => page.textContent('.imported-css-glob'))
    .toContain('.dir-import')
  await expect
    .poll(() => page.textContent('.imported-css-globEager'))
    .toContain('.dir-import')
})

/** link 样式及其 @import 先呈现 blue/red；unbundled dev 编辑后在原元素上观察 red/blue。 */
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

/** JS 导入的 CSS 与其 @import 先呈现 green/purple；unbundled dev 再检查原元素上的更新。 */
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

/** 带空格的 CSS 资源路径经处理后仍指向 ok PNG。 */
test('css import asset with space', async () => {
  const importedWithSpace = await page.$('.import-with-space')

  expect(await getBg(importedWithSpace)).toMatch(/.*\/ok.*\.png/)
})

/** PostCSS 嵌套规则生效；unbundled dev 编辑后检查颜色更新。 */
test('postcss config', async () => {
  const imported = await page.$('.postcss .nesting')
  expect(await getColor(imported)).toBe('pink')

  // bundled dev：与 linked css 相同的丢更新问题（#23028）。
  if (isBundled) return

  editFile('imported.css', (code) => code.replace('color: pink', 'color: red'))
  await expect.poll(() => getColor(imported)).toBe('red')
})

/** 用户 PostCSS 插件注入的 URL 也经过资源解析，URL 指向 ok PNG。 */
test('postcss plugin that injects url()', async () => {
  const imported = await page.$('.inject-url')
  // PostCSS 插件后注入的 url() 也必须经过 alias 解析。
  expect(await getBg(imported)).toMatch(
    /localhost(?::\d+)?\/(?:assets\/)?ok.*\.png/,
  )
})

sassTest()

/** 覆盖 Less 变量、导入、别名及变量/插值 URL；dev 编辑入口和依赖后更新原元素。 */
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

/** Less 自定义插件生成预期的 PNG data URI 背景。 */
test('less-plugin', async () => {
  const body = await page.$('.less-js-plugin')
  expect(await getBg(body)).toBe(
    'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdjYGD4/x8AAwIB/8myre4AAAAASUVORK5CYII=")',
  )
})

/** 覆盖 Stylus additionalData、导入、define 变量/函数和 URL；dev 再检查入口与依赖更新。 */
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

/** CSS Modules 类名遵循 scoped name 配置；dev 编辑样式后更新原元素颜色。 */
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

/** composes 解析到正确文件，元素同时含来源类名与当前模块类名；HMR 部分仍被注释。 */
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

/** Less Modules 的 composes 保留来源和当前类名，并呈现 blue；此用例没有执行 HMR 步骤。 */
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

/** `?inline` 导出的 CSS 文本包含配置生成的模块类名。 */
test('inline css modules', async () => {
  const css = await page.textContent('.modules-inline')
  expect(css).toMatch(/\.inline-module__apply-color-inline___[\w-]{5}/)
})

/** build 日志不含 @charset 位置警告。 */
test.runIf(isBuild)('@charset hoist', async () => {
  serverLogs.forEach((log) => {
    // hoistAtRules 提升 @charset 后，CSS 压缩器不再报告位置非法。
    expect(log).not.toMatch('"@charset" must be the first rule in the file')
  })
})

/** 层叠规则分别得到 blue/green 的最终颜色。 */
test('layers', async () => {
  expect(await getColor('.layers-blue')).toMatch('blue')
  expect(await getColor('.layers-green')).toMatch('green')
})

/** 外部 CSS 的图标规则生效，maskImage 保留 SVG data URI。 */
test('@import external css', async () => {
  const icon = page.locator('.icon--mdi-light--help-circle')
  expect(
    await icon.evaluate((span) => getComputedStyle(span).maskImage),
  ).toContain('data:image/svg+xml,')
})

/** CSS 包的 style 入口被 @import 解析，规则呈现 purple。 */
test('@import dependency w/ style entry', async () => {
  expect(await getColor('.css-dep')).toBe('purple')
})

/** CSS 包的 style exports 映射被解析，规则呈现 purple。 */
test('@import dependency w/ style export mapping', async () => {
  expect(await getColor('.css-dep-exports')).toBe('purple')
})

/** 依赖中的二次 @import 继续解析到目标样式。 */
test('@import dependency that @import another dependency', async () => {
  expect(await getColor('.css-proxy-dep')).toBe('purple')
})

/** SCSS 依赖中带 .css 后缀的 @import 继续解析另一包的样式。 */
test('@import scss dependency that has @import with a css extension pointing to another dependency', async () => {
  expect(await getColor('.scss-proxy-dep')).toBe('purple')
})

sassOtherTests()

/** build 将异步样式单独输出，入口 CSS 不含 teal；dev 在原元素上检查 teal 到 blue 的更新。 */
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

/** build 删除未使用异步模块及其样式/占位文件；dev 保留该模块并检查 CSS 更新。 */
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

/** 场景：插件登记的 glob 目录依赖含普通与括号目录文件；初始三元素为灰，非构建时逐个编辑蓝/红/绿并删除 bar，核对对应元素更新且其他元素保持原值。 */
test('PostCSS dir-dependency', async () => {
  const el1 = await page.$('.dir-dep')
  const el2 = await page.$('.dir-dep-2')
  const el3 = await page.$('.dir-dep-3')

  expect(await getColor(el1)).toBe('grey')
  expect(await getColor(el2)).toBe('grey')
  expect(await getColor(el3)).toBe('grey')

  // 仅非构建分支编辑源文件并等待目录依赖触发样式更新。
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

/** 依赖 JS 所导入的普通 CSS 与 CSS Modules 都影响页面颜色。 */
test('import dependency includes css import', async () => {
  expect(await getColor('.css-js-dep')).toBe('green')
  expect(await getColor('.css-js-dep-module')).toBe('green')
})

/** 场景：背景列表先含猫/狗两个 URL，再循环 1..5 个相同 URL × 四种逗号空白；逐轮编辑 CSS 后核对计算背景仍为合法 URL 列表。构建模式只检查已加载输出的列表格式，不断言源编辑被重构建。 */
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

/** `?inline` 只导出字符串，因此对应规则不注入页面，元素保持默认 black。 */
test('inlined', async () => {
  // ?inline 只导出字符串，不应把样式插入页面。
  expect(await getColor('.inlined')).toBe('black')
})

/** inline CSS 文本含背景规则且无资产占位符；build 分支还检查文本已压缩。 */
test('inlined-code', async () => {
  const code = await page.textContent('.inlined-code')
  // inline 字符串中的资源仍应解析，不能残留内部占位符。
  expect(code).toContain('background:')
  expect(code).not.toContain('__VITE_ASSET__')

  if (isBuild) {
    expect(code.trim()).not.toContain('\n') // 构建态 inline CSS 已压缩。
  }
})

/** build.cssTarget 限制下保留兼容的 rgba()，不压成八位 hex 颜色。 */
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
/** 将 CSS URL 用作样式链接后规则生效；bundled dev 因 #22863 跳过。 */
test.skipIf(isBundledDev)('?url', async () => {
  expect(await getColor('.url-imported-css')).toBe('yellow')
})

/** 导出的 CSS 文本等于源文件；unbundled dev 编辑后页面文本更新。 */
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

/** Less 导入的两份 CSS 分别呈现 yellow/blue。 */
test('import css in less', async () => {
  expect(await getColor('.css-in-less')).toBe('yellow')
  expect(await getColor('.css-in-less-2')).toBe('blue')
})

/** Less data-uri() 的相对 SVG 路径能读取并内联为 data URI。 */
test("relative path rewritten in Less's data-uri", async () => {
  // 传给 Less data-uri 的相对路径先改写为绝对路径，随后由 Less 内联。
  expect(await getBg('.form-box-data-uri')).toMatch(
    /^url\("data:image\/svg\+xml,%3Csvg/,
  )
})

/** PostCSS 插件输出的 source.input.from 保留 inline 与自定义 query。 */
test('PostCSS source.input.from includes query', async () => {
  const code = await page.textContent('.postcss-source-input')
  // 对照插件输出的 source.input.from，检查完整 query 未被剥离。
  expect(code).toContain('/postcss-source-input.css?inline&query=foo')
})

/** 别名解析的普通 CSS 与 CSS Modules 都产生 blue 样式。 */
test('aliased css has content', async () => {
  expect(await getColor('.aliased')).toBe('blue')
  // 暂不支持 alias CSS 作为文本内容返回，见 #8936。
  // expect(await page.textContent('.aliased-content')).toMatch('.aliased')
  expect(await getColor('.aliased-module')).toBe('blue')
})

/** CSS 中的包 imports 映射解析到规则并呈现 red。 */
test('resolve imports field in CSS', async () => {
  expect(await getColor('.imports-field')).toBe('red')
})

/** build 日志中不出现被 esbuild.logOverride 抑制的 CSS 属性警告。 */
test.runIf(isBuild)('warning can be suppressed by esbuild.logOverride', () => {
  serverLogs.forEach((log) => {
    // 用户 logOverride 应能抑制 esbuild CSS minifier 警告。
    expect(log).not.toMatch('unsupported-css-property')
  })
})

/** SugarSS 入口、导入和别名样式生效；dev 编辑入口与依赖后更新颜色。 */
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

// 从浏览器最终颜色观察异步 CSS 层叠顺序。
/** 异步样式加载后检查最终 green/blue，验证层叠顺序。 */
test('async css order', async () => {
  await expect.poll(() => getColor('.async-green')).toBe('green')
  await expect.poll(() => getColor('.async-blue')).toBe('blue')
})

/** 异步 CSS Modules 加载后的最终颜色为 pink。 */
test('async css order with css modules', async () => {
  await expect.poll(() => getColor('.modules-pink')).toBe('pink')
})

/** CSS @import 的 SCSS 文件经过预处理，规则呈现 red。 */
test('@import scss', async () => {
  expect(await getColor('.at-import-scss')).toBe('red')
})

/** build 的 manual chunk CSS 跟随配置的命名模板，输出到嵌套目录。 */
test.runIf(isBuild)('manual chunk path', async () => {
  // manual chunk CSS 应输出到 manualChunk 指定的嵌套目录（#12072）。
  expect(
    findAssetFile(/manual-chunk-[-\w]{8}\.css$/, undefined, 'assets/dir/dir2'),
  ).not.toBeUndefined()
})

/** 全部输出 CSS 中不含未使用模块的 treeshake-module-b 规则。 */
test.runIf(isBuild)('CSS modules should be treeshaken if not used', () => {
  const css = findAssetFile(/\.css$/, undefined, undefined, true)
  expect(css).not.toContain('treeshake-module-b')
})

/** 全部输出 CSS 中不含绑定到未渲染 importer/export 的 scoped 规则。 */
test.runIf(isBuild)('Scoped CSS via cssScopeTo should be treeshaken', () => {
  const css = findAssetFile(/\.css$/, undefined, undefined, true)
  expect(css).not.toMatch(/\btreeshake-scoped-b\b/)
  expect(css).not.toMatch(/\btreeshake-scoped-c\b/)
})

/** 导航到 scoped fixture，检查最终前景 red、背景 blue。 */
test('Scoped CSS should have a correct order', async () => {
  await page.goto(viteTestUrl + '/treeshake-scoped/')
  await expect.poll(() => getColor('.treeshake-scoped-order')).toBe('red')
  await expect.poll(() => getBgColor('.treeshake-scoped-order')).toBe('blue')
})

/** 空 CSS 入口仍发射 CSS 文件，纯 CSS 的空 JS 占位 chunk 被删除。 */
test.runIf(isBuild)(
  'empty CSS files should generate .css assets, not .js assets',
  () => {
    // 空 CSS 入口仍生成 .css asset，并删除纯 CSS 的空 .js 占位 chunk。
    expect(findAssetFile(/empty-[-\w]{8}\.css$/)).not.toBeUndefined()
    expect(findAssetFile(/empty-[-\w]{8}\.js$/)).toBeUndefined()
  },
)
