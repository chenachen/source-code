import { expect, test } from 'vitest'
import { getColor, page } from '~utils'

/** 场景：CSP nonce 配置下 HTML link 加载样式；读取 .linked 计算颜色，核对蓝色。 */
test('linked css', async () => {
  expect(await getColor('.linked')).toBe('blue')
})

/** 场景：CSP nonce 配置下内联 style 生效；读取 .inline，核对绿色。 */
test('inline style tag', async () => {
  expect(await getColor('.inline')).toBe('green')
})

/** 场景：入口 JS 导入样式；读取 .from-js，核对 CSP 下仍为蓝色。 */
test('imported css', async () => {
  expect(await getColor('.from-js')).toBe('blue')
})

/** 场景：动态导入样式；读取 .dynamic，核对 CSP 下仍为红色。 */
test('dynamic css', async () => {
  expect(await getColor('.dynamic')).toBe('red')
})

/** 场景：nonce 脚本执行后更新 DOM；轮询 .js，核对 js: ok。 */
test('script tag', async () => {
  await expect.poll(() => page.textContent('.js')).toBe('js: ok')
})

/** 场景：nonce 环境动态 JS 已加载；轮询 .dynamic-js，核对 dynamic-js: ok。 */
test('dynamic js', async () => {
  await expect
    .poll(() => page.textContent('.dynamic-js'))
    .toBe('dynamic-js: ok')
})

/** 场景：nonce 内联脚本执行；轮询 .inline-js，核对 inline-js: ok。 */
test('inline js', async () => {
  await expect.poll(() => page.textContent('.inline-js')).toBe('inline-js: ok')
})

/** 场景：夹具已有 nonce 的脚本经过 HTML 转换；检查 HTML 不含重复空 nonce，并核对 double-nonce-js 脚本执行消息。 */
test('nonce attributes are not repeated', async () => {
  const htmlSource = await page.content()
  expect(htmlSource).not.toContain(/nonce=""[^>]*nonce=""/)
  await expect
    .poll(() => page.textContent('.double-nonce-js'))
    .toBe('double-nonce-js: ok')
})

/** 场景：读取自动注入的 csp-nonce meta；通过 DOM nonce 属性核对其值非空。 */
test('meta[property=csp-nonce] is injected', async () => {
  const meta = await page.$('meta[property=csp-nonce]')
  expect(await (await meta.getProperty('nonce')).jsonValue()).not.toBe('')
})
