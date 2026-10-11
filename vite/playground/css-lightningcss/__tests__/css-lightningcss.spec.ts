import { expect, test } from 'vitest'
import {
  editFile,
  findAssetFile,
  getBg,
  getColor,
  isBuild,
  isBundled,
  page,
  readFile,
  viteTestUrl,
} from '~utils'

// HMR 用例复用最初取得的 ElementHandle；若整页重载，旧句柄无法继续核对颜色。

/** 场景：LightningCSS 处理 link 与其 @import，初始蓝/红；开发时分别编辑两CSS改红/蓝并用原 ElementHandle 轮询，构建只核对初始颜色。 */
test('linked css', async () => {
  const linked = await page.$('.linked')
  const atImport = await page.$('.linked-at-import')

  expect(await getColor(linked)).toBe('blue')
  expect(await getColor(atImport)).toBe('red')

  if (isBuild) return
  editFile('linked.css', (code) => code.replace('color: blue', 'color: red'))
  await expect.poll(() => getColor(linked)).toBe('red')

  editFile('linked-at-import.css', (code) =>
    code.replace('color: red', 'color: blue'),
  )
  await expect.poll(() => getColor(atImport)).toBe('blue')
})

/** 场景：JS 导入 CSS 及 @import，初始绿/紫；开发分别编辑改红/蓝并复用原元素等待 HMR，构建仅检查初始样式。 */
test('css import from js', async () => {
  const imported = await page.$('.imported')
  const atImport = await page.$('.imported-at-import')

  expect(await getColor(imported)).toBe('green')
  expect(await getColor(atImport)).toBe('purple')

  if (isBuild) return
  editFile('imported.css', (code) => code.replace('color: green', 'color: red'))
  await expect.poll(() => getColor(imported)).toBe('red')

  editFile('imported-at-import.css', (code) =>
    code.replace('color: purple', 'color: blue'),
  )
  await expect.poll(() => getColor(atImport)).toBe('blue')
})

/** 场景：外部 @import 提供图标规则；读取 maskImage，轮询核对内联 SVG data URL。 */
test('@import external css', async () => {
  const icon = page.locator('.icon--mdi-light--help-circle')
  await expect
    .poll(() => icon.evaluate((span) => getComputedStyle(span).maskImage))
    .toContain('data:image/svg+xml,')
})

/** 场景：CSS Module 初始 turquoise 且 class 含六字符作用域前缀；开发修改颜色为红并复用元素等待，构建仅检查初始 class/颜色。 */
test('css modules', async () => {
  const imported = await page.$('.modules')
  expect(await getColor(imported)).toBe('turquoise')

  expect(await imported.getAttribute('class')).toMatch(/\w{6}_apply-color/)

  if (isBuild) return
  editFile('mod.module.css', (code) =>
    code.replace('color: turquoise', 'color: red'),
  )
  await expect.poll(() => getColor(imported)).toBe('red')
})

/** 场景：?inline CSS Module 返回文本；读取 .modules-inline，核对文本中的作用域类名格式。 */
test('inline css modules', async () => {
  const css = await page.textContent('.modules-inline')
  expect(css).toMatch(/\._?\w{6}_apply-color-inline/)
})

/** 场景：仅构建执行：读取入口 CSS，核对保留 rgba() 而没有改成 #ffff00b3，反映 LightningCSS 目标语法选择。 */
test.runIf(isBuild)('minify css', async () => {
  // 目标浏览器配置要求保留 rgba()。
  const cssFile = findAssetFile(/index-[-\w]+\.css$/)
  expect(cssFile).toMatch('rgba(')
  expect(cssFile).not.toMatch('#ffff00b3')
})

/** 场景：仅构建执行：fixture visitor 写出媒体查询访问计数；读取 dist/media-query-visits.txt 为 2，核对压缩阶段没有重复遍历。 */
test.runIf(isBuild)('does not run the visitor again during minify', () => {
  expect(readFile('dist/media-query-visits.txt')).toBe('2')
})

/** 场景：CSS 背景引用 https://vite.dev/logo.svg；读取背景，核对外部 URL 原样保留。 */
test('css with external url', async () => {
  const css = await page.$('.external')
  expect(await getBg(css)).toMatch('url("https://vite.dev/logo.svg")')
})

/** 场景：嵌套 CSS 引用相对 ok.png；读取背景，bundled 核对哈希名，普通 dev 核对服务器根 URL。 */
test('nested css with relative asset', async () => {
  const css = await page.$('.nested-css-relative-asset')
  expect(await getBg(css)).toMatch(
    isBundled ? /ok-[-\w]+\.png/ : `${viteTestUrl}/ok.png`,
  )
})

/** 场景：CSS url 使用别名资产；读取背景，核对被解析并内联为 SVG data URL。 */
test('aliased asset', async () => {
  const bg = await getBg('.css-url-aliased')
  expect(bg).toMatch('data:image/svg+xml,')
})

/** 场景：CSS 已含内联 SVG；读取背景，核对 data:image/svg+xml 后仍有实际内容。 */
test('preinlined SVG', async () => {
  expect(await getBg('.css-url-preinlined-svg')).toMatch(
    /data:image\/svg\+xml,.+/,
  )
})
