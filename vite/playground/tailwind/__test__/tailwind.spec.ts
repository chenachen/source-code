import { expect, test } from 'vitest'
import { editFile, getColor, isServe, page, untilBrowserLogAfter } from '~utils'

/** 页面初始化后读取标题为 Page title，验证应用入口正常渲染。 */
test('should render', async () => {
  expect(await page.textContent('#pagetitle')).toBe('Page title')
})

/** 仅开发模式先确认 HTML 节点为蓝色，修改 index.html 中 utility class 并轮询绿色；本断言检查修改后的样式结果，未单独统计 reload 次数。 */
test.runIf(isServe)(
  'full reload happens when the HTML is changed',
  async () => {
    await expect
      .poll(() => getColor('.html'))
      .toBe('oklch(0.623 0.214 259.815)')

    editFile('index.html', (code) =>
      code.replace('"html text-blue-500"', '"html text-green-500"'),
    )
    await expect
      .poll(() => getColor('.html'))
      .toBe('oklch(0.723 0.219 149.579)')
  },
)

/** 仅开发模式先确认 view1 为绿色，修改扫描 glob 内的 JS 文本并等待 JS/CSS HMR 日志，再换成橙色 utility class，验证文本与计算颜色均更新。 */
test.runIf(isServe)('regenerate CSS and HMR (glob pattern)', async () => {
  const el = page.locator('#view1-text')
  expect(await getColor(el)).toBe('oklch(0.627 0.194 149.214)')

  await untilBrowserLogAfter(
    () =>
      editFile('src/views/view1.js', (code) =>
        code.replace('|view1|', '|view1 updated|'),
      ),
    [
      '[vite] css hot updated: /index.css',
      '[vite] hot updated: /src/views/view1.js via /src/main.js',
    ],
    false,
  )
  await expect.poll(() => el.textContent()).toMatch('|view1 updated|')

  await untilBrowserLogAfter(
    () =>
      editFile('src/views/view1.js', (code) =>
        code.replace('text-green-600', 'text-orange-600'),
      ),
    [
      '[vite] css hot updated: /index.css',
      '[vite] hot updated: /src/views/view1.js via /src/main.js',
    ],
    false,
  )
  await expect.poll(() => getColor(el)).toBe('oklch(0.646 0.222 41.116)')
})

/** 仅开发模式先确认 component1 为红色，改成蓝色 utility class 并等待 CSS/JS 更新日志，验证同文件参与扫描与模块图后仍能更新。 */
test.runIf(isServe)(
  'same file duplicated in module graph (#4267)',
  async () => {
    const el = page.locator('#component1')
    expect(await getColor(el)).toBe('oklch(0.577 0.245 27.325)')

    // 同一个源文件也用于 Tailwind 内容扫描，更新应保留正确的模块与 CSS 依赖。
    await untilBrowserLogAfter(
      () =>
        editFile('src/components/component1.js', (code) =>
          code.replace('text-red-600', 'text-blue-600'),
        ),
      [
        '[vite] css hot updated: /index.css',
        '[vite] hot updated: /src/components/component1.js',
      ],
      false,
    )
    await expect.poll(() => getColor(el)).toBe('oklch(0.546 0.245 262.881)')
  },
)

/** 仅开发模式先确认标题为紫色，修改相对路径 main.js 的 utility class 并等待 CSS/JS 日志，验证标题变为青色。 */
test.runIf(isServe)('regenerate CSS and HMR (relative path)', async () => {
  const el = page.locator('#pagetitle')
  expect(await getColor(el)).toBe('oklch(0.541 0.281 293.009)')

  await untilBrowserLogAfter(
    () =>
      editFile('src/main.js', (code) =>
        code.replace('text-violet-600', 'text-cyan-600'),
      ),
    ['[vite] css hot updated: /index.css', '[vite] hot updated: /src/main.js'],
    false,
  )
  await expect.poll(() => getColor(el)).toBe('oklch(0.609 0.126 221.723)')
})
