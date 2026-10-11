import { expect, test, vi } from 'vitest'
import { browserLogs, isServe, page, serverLogs, viteTestUrl } from '~utils'

/**
 * 场景：同步 bypass 返回 false。
 * 操作与目标：等待浏览器日志，核对该请求报告404 Not Found（#14579）。
 */
test('proxy-bypass', async () => {
  await vi.waitFor(() => {
    expect(browserLogs.join('\n')).toContain('status of 404 (Not Found)')
  })
})

/**
 * 场景：bypass等待4ms后写200纯文本响应，再返回 /asyncResponse。
 * 操作与目标：读取async-response iframe，核对实际响应含 Hello after 4 ms（#18940）。
 */
test('async-proxy-bypass', async () => {
  const content = await page.frame('async-response').content()
  expect(content).toContain('Hello after 4 ms (async timeout)')
})

/**
 * 场景：异步 bypass 抛错。
 * 操作与目标：轮询serverLogs，核对bypass error被记录；本例没有单独监测未处理rejection。
 */
test('async-proxy-bypass-with-error', async () => {
  await vi.waitFor(() => {
    expect(serverLogs.join('\n')).toContain('bypass error')
  })
})

/**
 * 场景：代理目标本身连接失败。
 * 目标：确认响应是表示上游失败的 502 Bad Gateway，而不是 Vite 内部错误 500（#21652）。
 */
test.runIf(isServe)('proxy error returns 502', async () => {
  const res = await fetch(viteTestUrl + '/proxyError')
  expect(res.status).toBe(502)
})
