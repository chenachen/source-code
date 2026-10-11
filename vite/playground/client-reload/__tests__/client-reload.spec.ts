import path from 'node:path'
import { type ServerOptions, type ViteDevServer, createServer } from 'vite'
import { afterEach, describe, expect, test } from 'vitest'
import { hmrPorts, isServe, page, ports } from '~utils'

let server: ViteDevServer

afterEach(async () => {
  await server?.close()
})

/** 启动给定 HTTP/WS 配置，等连接后填 input，再重启并等重新连接；最后检查 input 的 textContent 为空。 */
async function testClientReload(serverOptions: ServerOptions) {
  // 当前用例创建自己的服务器，afterEach 负责关闭。
  server = await createServer({
    root: path.resolve(import.meta.dirname, '..'),
    logLevel: 'silent',
    server: {
      strictPort: true,
      ...serverOptions,
    },
  })

  await server.listen()
  const serverUrl = server.resolvedUrls.local[0]

  // 先订阅连接日志再打开页面，避免漏掉首次握手信号。
  const connectedPromise = page.waitForEvent('console', {
    /** 以 Vite client 的 connected 日志作为连接完成信号。 */
    predicate: (message) => message.text().includes('[vite] connected.'),
    timeout: 5000,
  })
  await page.goto(serverUrl)
  await connectedPromise

  // 写入 input value，模拟页面状态。
  await page.locator('input').fill('hello')

  // 先订阅重连日志再重启。末尾检查 textContent，没有读取 input.value。
  const reConnectedPromise = page.waitForEvent('console', {
    /** 以 Vite client 的 connected 日志作为连接完成信号。 */
    predicate: (message) => message.text().includes('[vite] connected.'),
    timeout: 5000,
  })
  await server.restart()
  await reConnectedPromise
  expect(await page.textContent('input')).toBe('')
}

describe.runIf(isServe)('client-reload', () => {
  /** 场景：仅 isServe 执行：默认 WS 配置下启动专属端口；调用共享重启流程，等 client 重新连接并核对 input.textContent 为空。 */
  test('default', async () => {
    await testClientReload({
      port: ports['client-reload'],
    })
  })

  /** 场景：仅 isServe 执行：HTTP 与 WS 使用不同分配端口；重启后等待 connected 日志，再核对 input.textContent 为空。 */
  test('custom hmr port', async () => {
    await testClientReload({
      port: ports['client-reload/hmr-port'],
      ws: {
        port: hmrPorts['client-reload/hmr-port'],
      },
    })
  })

  /** 场景：仅 isServe 执行：自定义 WS 端口且设置 COEP=require-corp、COOP=same-origin；运行共享重启流程并核对重连与 input.textContent。 */
  test('custom hmr port and cross origin isolation', async () => {
    await testClientReload({
      port: ports['client-reload/cross-origin'],
      ws: {
        port: hmrPorts['client-reload/cross-origin'],
      },
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    })
  })
})
