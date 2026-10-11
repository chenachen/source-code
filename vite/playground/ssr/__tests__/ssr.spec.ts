import { expect, test } from 'vitest'
import { port, serverLogs } from './serve'
import { browserLogs, editFile, isServe, page } from '~utils'

/** custom serve后端应用地址。 */
const url = `http://localhost:${port}`

/** 场景：访问circular-dep路由，核对两循环模块初始化消息circ-dep-init-a/b都完成。 */
test(`circular dependencies modules doesn't throw`, async () => {
  await page.goto(`${url}/circular-dep`)

  expect(await page.textContent('.circ-dep-init')).toMatch(
    'circ-dep-init-a circ-dep-init-b',
  )
})

/** 场景：访问第一循环导入结构路由，核对页面A is: __A__快照，不发生导入死锁。 */
test(`circular import doesn't throw (1)`, async () => {
  await page.goto(`${url}/circular-import`)

  expect(await page.textContent('.circ-import')).toMatchInlineSnapshot(
    '"A is: __A__"',
  )
})

/** 场景：访问第二循环导入结构路由，核对相同A is: __A__快照。 */
test(`circular import doesn't throw (2)`, async () => {
  await page.goto(`${url}/circular-import2`)

  expect(await page.textContent('.circ-import')).toMatchInlineSnapshot(
    '"A is: __A__"',
  )
})

/** 场景：访问forked静态导入路由，核对rendered消息，检查并发分叉依赖没有死锁。 */
test(`deadlock doesn't happen for static imports`, async () => {
  await page.goto(`${url}/forked-deadlock-static-imports`)

  expect(await page.textContent('.forked-deadlock-static-imports')).toMatch(
    'rendered',
  )
})

/** 场景：访问forked动态导入路由，核对rendered消息，检查动态分叉依赖没有死锁。 */
test(`deadlock doesn't happen for dynamic imports`, async () => {
  await page.goto(`${url}/forked-deadlock-dynamic-imports`)

  expect(await page.textContent('.forked-deadlock-dynamic-imports')).toMatch(
    'rendered',
  )
})

/** 场景：访问import-meta路由，读取非空meta.url并核对meta.resolve返回相同URL。 */
test(`import.meta.resolve is supported`, async () => {
  await page.goto(`${url}/import-meta`)

  const metaUrl = await page.textContent('.import-meta-url')
  expect(metaUrl).not.toBe('')
  expect(await page.textContent('.import-meta-resolve')).toBe(metaUrl)
})

/** 场景：访问import-meta路由，核对SSR模块import.meta.main为false。 */
test(`import.meta.main is supported`, async () => {
  await page.goto(`${url}/import-meta`)

  expect(await page.textContent('.import-meta-main')).toBe('false')
})

/** 场景：仅serve执行：导航查询含编码script闭合/新script文本，核对browserLogs没有注入的console消息，检查html-proxy编码。 */
test.runIf(isServe)('html proxy is encoded', async () => {
  await page.goto(
    `${url}?%22%3E%3C/script%3E%3Cscript%3Econsole.log(%27html%20proxy%20is%20not%20encoded%27)%3C/script%3E`,
  )

  expect(browserLogs).not.toContain('html proxy is not encoded')
})

// 配置重启放在最后，避免干扰前面的路由与模块加载用例。
/** 场景：仅serve执行且置于文件末尾：给vite.config.ts添加换行，等待server restarted日志并核对日志不含error。 */
test.runIf(isServe)('should restart ssr', async () => {
  editFile('./vite.config.ts', (content) => content + '\n')
  await expect
    .poll(() => {
      expect(serverLogs).toEqual(
        expect.arrayContaining([expect.stringMatching('server restarted')]),
      )
      expect(serverLogs).not.toEqual(
        expect.arrayContaining([expect.stringMatching('error')]),
      )
    })
    .toSatisfy(() => true)
})
