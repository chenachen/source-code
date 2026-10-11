import path from 'node:path'
import { createServer } from 'vite'
import { expect, test } from 'vitest'
import { getColor, isServe, page, ports } from '~utils'

/** 场景：仅开发执行：同端口先启 blue-app，再关闭换 green-app 并等待自动reload；核对前者a蓝/b黑、后者a黑/b绿，检查按root选择PostCSS配置且没有复用旧结果。 */
test.runIf(isServe)('postcss config', async () => {
  const port = ports['css/postcss-caching']
  /** 以指定 app root 使用同一端口启动服务器，分别读取各自 PostCSS 配置。 */
  const startServer = async (root) => {
    const server = await createServer({
      root,
      logLevel: 'silent',
      server: {
        port,
        strictPort: true,
      },
      build: {
        // 目标为 esnext，测试聚焦 PostCSS 配置而无需语法降级。
        target: 'esnext',
      },
    })
    await server.listen()
    return server
  }

  const blueAppDir = path.join(import.meta.dirname, 'blue-app')
  const greenAppDir = path.join(import.meta.dirname, 'green-app')
  let blueApp
  let greenApp
  try {
    const hmrConnectionPromise = page.waitForEvent('console', (msg) =>
      msg.text().includes('connected'),
    )

    blueApp = await startServer(blueAppDir)

    await page.goto(`http://localhost:${port}`, { waitUntil: 'load' })
    const blueA = await page.$('.postcss-a')
    expect(await getColor(blueA)).toBe('blue')
    const blueB = await page.$('.postcss-b')
    expect(await getColor(blueB)).toBe('black')

    // 先等 HMR 连接；已连接的 client 才能在服务器关闭/重启后触发自动 reload。
    await hmrConnectionPromise
    await blueApp.close()
    blueApp = null

    const loadPromise = page.waitForEvent('load') // 等待 client 对新服务器的自动 reload
    greenApp = await startServer(greenAppDir)
    await loadPromise

    const greenA = await page.$('.postcss-a')
    expect(await getColor(greenA)).toBe('black')
    const greenB = await page.$('.postcss-b')
    expect(await getColor(greenB)).toBe('green')
    await greenApp.close()
    greenApp = null
  } finally {
    if (blueApp) {
      await blueApp.close()
    }
    if (greenApp) {
      await greenApp.close()
    }
  }
})
