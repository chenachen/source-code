import path from 'node:path'
import { createServer } from 'vite'
import { expect, test } from 'vitest'
import { getBgColor, getColor, isServe, page, ports } from '~utils'

// 回归场景：https://github.com/vitejs/vite/issues/4000
/** 场景：仅开发执行：另以 tailwind fixture 为 root 启动专属服务器；导航并核对 PostCSS 插件生成的背景 oklch 与文字 rgb，finally 关闭。 */
test.runIf(isServe)('postcss plugins in different dir', async () => {
  const port = ports['css/postcss-plugins-different-dir']
  const server = await createServer({
    root: path.join(import.meta.dirname, '..', '..', '..', 'tailwind'),
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
  try {
    await page.goto(`http://localhost:${port}`)
    const tailwindStyle = page.locator('#tailwind-style')
    expect(await getBgColor(tailwindStyle)).toBe('oklch(0.936 0.032 17.717)')
    expect(await getColor(tailwindStyle)).toBe('rgb(136, 136, 136)')
  } finally {
    await server.close()
  }
})
