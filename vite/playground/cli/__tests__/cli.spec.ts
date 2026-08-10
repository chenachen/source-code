import { expect, test } from 'vitest'
import { port, streams } from './serve'
import { editFile, isServe, page } from '~utils'

/**
 * 场景：通过真实 `packages/vite/bin/vite.js` 启动开发或预览服务器，再由浏览器访问。
 *
 * 验证目标：CLI 能正确解析 root/port 参数并分发到对应服务器；返回页面能够运行
 * 入口模块，且模块中的 console 输出可到达浏览器。此用例覆盖完整 CLI 进程，而非
 * 直接调用 `createServer()` 的 Node API 路径。
 */
test('cli should work', async () => {
  // 本 playground 使用自定义 serve 实现，无法使用常规 browserLogs/goto helper，
  // 因此手动监听 page console，并在 finally 中移除监听器，避免污染其他用例。
  const logs = []
  /** 收集 Playwright console 文本，验证真实 CLI 服务出的入口已经执行。 */
  const onConsole = (msg) => {
    logs.push(msg.text())
  }
  try {
    page.on('console', onConsole)
    await page.goto(`http://localhost:${port}/`)

    expect(await page.textContent('.app')).toBe('vite cli works!')
    expect(logs.some((msg) => msg.match('vite cli works!'))).toBe(true)
  } finally {
    page.off('console', onConsole)
  }
})

/**
 * 场景：开发服务器运行期间修改 `vite.config.js`，触发配置文件监听和服务器重启。
 *
 * 验证目标：CLI 子进程继续存活并输出 `server restarted`；端口未变化时不重复打印
 * 访问地址，也不产生错误。Build/preview 模式没有配置热重启能力，所以仅在 serve
 * 测试矩阵中执行。
 */
test.runIf(isServe)('should restart', async () => {
  const logsLengthBeforeEdit = streams.server.out.length
  editFile('./vite.config.js', (content) => content + '\n')
  await expect
    .poll(() => {
      const logs = streams.server.out.slice(logsLengthBeforeEdit)
      expect(logs).toEqual(
        expect.arrayContaining([expect.stringMatching('server restarted')]),
      )
      // 地址没有变化时禁止重复打印，避免每次改配置都向终端堆积相同信息。
      expect(logs).not.toEqual(
        expect.arrayContaining([expect.stringMatching('http://localhost')]),
      )
      expect(logs).not.toEqual(
        expect.arrayContaining([expect.stringMatching('error')]),
      )
    })
    .toSatisfy(() => true)
})
