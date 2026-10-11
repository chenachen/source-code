import { expect, test } from 'vitest'
import { port } from './serve'
import { page } from '~utils'

/** 场景：自定义 serve 启动 type:module 包中的真实 CLI；手动订阅 console 后访问端口，核对 DOM 与日志均显示入口成功消息，并在 finally 移除监听。 */
test('cli should work in "type":"module" package', async () => {
  // 自定义 serve 没有接入常规 browserLogs/goto helper，手动收集浏览器日志。
  const logs = []
  /** 保存浏览器 console 文本，供入口执行消息断言使用。 */
  const onConsole = (msg) => {
    logs.push(msg.text())
  }
  try {
    page.on('console', onConsole)
    await page.goto(`http://localhost:${port}/`)
    expect(await page.textContent('.app')).toBe(
      'vite cli in "type":"module" package works!',
    )
    expect(
      logs.some((msg) =>
        msg.match('vite cli in "type":"module" package works!'),
      ),
    ).toBe(true)
  } finally {
    page.off('console', onConsole)
  }
})
