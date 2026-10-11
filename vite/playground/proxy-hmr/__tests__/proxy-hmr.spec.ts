import { expect, test } from 'vitest'
import {
  editFile,
  isBuild,
  page,
  untilBrowserLogAfter,
  viteTestUrl,
} from '~utils'

/** 场景：仅非构建执行，访问主应用等待主/iframe两个connected日志；修改子应用HTML后轮询iframe文本，核对代理HMR显示other modified app。 */
test.runIf(!isBuild)('proxy-hmr', async () => {
  await untilBrowserLogAfter(
    () => page.goto(viteTestUrl),
    // 等主应用与子应用各自连接HMR。
    [/connected/, /connected/],
  )

  const otherAppTextLocator = page.frameLocator('iframe').locator('.content')
  await expect
    .poll(() => otherAppTextLocator.textContent())
    .toMatch('other app')
  editFile('other-app/index.html', (code) =>
    code.replace('app', 'modified app'),
  )
  await expect
    .poll(() => otherAppTextLocator.textContent())
    .toMatch('other modified app')
})
