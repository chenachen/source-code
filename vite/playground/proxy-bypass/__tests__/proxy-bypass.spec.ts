import { expect, test, vi } from 'vitest'
import { browserLogs, isServe, page, serverLogs, viteTestUrl } from '~utils'

/**
 * 场景：同步 bypass 返回 false。
 * 目标：确认 Vite 直接结束请求并返回 404，不再转发到代理目标或进入后续中间件（#14579）。
 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “browserLogs.join('\n')”。
 * 验证目标：“browserLogs.join('\n')” 应包含 “'status of 404 (Not Found)'”，从而确认proxy bypass 的同步/异步返回值或异常被映射到正确 HTTP 响应。
 */
test('proxy-bypass', async () => {
  await vi.waitFor(() => {
    expect(browserLogs.join('\n')).toContain('status of 404 (Not Found)')
  })
})

/**
 * 场景：bypass 异步等待后返回改写路径/自行响应。
 * 目标：确认中间件会 await Promise，并把异步结果作为真实路由决定（#18940）。
 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “content”。
 * 验证目标：“content” 应包含 “'Hello after 4 ms (async timeout)'”，从而确认proxy bypass 的同步/异步返回值或异常被映射到正确 HTTP 响应。
 */
test('async-proxy-bypass', async () => {
  const content = await page.frame('async-response').content()
  expect(content).toContain('Hello after 4 ms (async timeout)')
})

/**
 * 场景：异步 bypass 抛错。
 * 目标：确认错误进入服务器错误日志/Connect 错误链，而不是成为未处理 rejection。
 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “serverLogs.join('\n')”。
 * 验证目标：“serverLogs.join('\n')” 应包含 “'bypass error'”，从而确认proxy bypass 的同步/异步返回值或异常被映射到正确 HTTP 响应。
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
/**
 * 场景：在当前 playground 中，请求 “fetch(viteTestUrl + '/proxyError')”。
 * 验证目标：“res.status” 应等于 “502”，从而确认proxy bypass 的同步/异步返回值或异常被映射到正确 HTTP 响应。
 */
test.runIf(isServe)('proxy error returns 502', async () => {
  const res = await fetch(viteTestUrl + '/proxyError')
  expect(res.status).toBe(502)
})
