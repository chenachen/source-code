import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { createServer } from '../../server'

/**
 * 阅读目标：堆栈修正必须可重复调用，并能识别已经由其他工具改写过的堆栈，
 * 避免二次映射产生误导位置或直接抛错。
 */
const root = fileURLToPath(new URL('./', import.meta.url))

/** 创建仅启用 SSR 加载所需能力的最小开发服务器。 */
async function createDevServer() {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    optimizeDeps: {
      noDiscovery: true,
    },
  })
  await server.environments.ssr.pluginContainer.buildStart({})
  return server
}

/**
 * 场景：连续两次加载同一报错模块，并分别调用 `ssrFixStacktrace()`。
 * 验证目标：重复堆栈改写调用均不抛出额外异常。
 */
test('call rewriteStacktrace twice', async () => {
  const server = await createDevServer()
  for (let i = 0; i < 2; i++) {
    try {
      await server.ssrLoadModule('/fixtures/modules/has-error.js')
    } catch (e: any) {
      server.ssrFixStacktrace(e)
    }
  }
})

/**
 * 场景：把错误堆栈位置改成看似已被其他工具映射过的无效行列，再执行修正。
 * 验证目标：错误消息追加“堆栈似乎已改写”诊断，而不是静默生成错误位置。
 */
test('outputs message when stacktrace appears to be already rewritten', async () => {
  const server = await createDevServer()
  try {
    await server.ssrLoadModule('/fixtures/modules/has-error.js')
  } catch (e: any) {
    // 手工构造一个行列无效、但看起来已改写过的堆栈，以触发 alreadyRewritten 分支。
    e.stack = e.stack.replace(
      /fixtures\/modules\/has-error\.js:\d+:\d+/,
      'fixtures/modules/has-error.js:1:1',
    )
    server.ssrFixStacktrace(e)
    expect(e.message).toContain(
      'The stacktrace appears to be already rewritten by something else',
    )
  }
})
