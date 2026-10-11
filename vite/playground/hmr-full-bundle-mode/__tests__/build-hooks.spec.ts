import path from 'node:path'
import { type Plugin, type ViteDevServer, createServer } from 'vite'
import { afterEach, describe, expect, test } from 'vitest'
import { isServe } from '~utils'

let server: ViteDevServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

// Rolldown dev engine 驱动bundledDev构建钩子；关闭时pluginContainer不应再次触发buildEnd（回归）。
describe.runIf(isServe)('full bundle mode build hooks', () => {
  /** 场景：仅开发执行：显式启用bundledDev并插入计数插件；listen后等待buildEnd=1且buildStart=1，再close，核对两计数都保持1，覆盖close重复触发buildEnd回归。 */
  test('buildStart and buildEnd are each called only once', async () => {
    let buildStartCount = 0
    let buildEndCount = 0
    const countPlugin: Plugin = {
      name: 'count-build-hooks',
      /** 记录bundledDev初始构建进入次数，供close前后比较。 */
      buildStart() {
        buildStartCount++
      },
      /** 记录初始构建结束次数，检查服务器关闭没有重复调用。 */
      buildEnd() {
        buildEndCount++
      },
    }

    server = await createServer({
      root: path.resolve(import.meta.dirname, '..'),
      configFile: false,
      logLevel: 'silent',
      experimental: { bundledDev: true },
      plugins: [countPlugin],
    })
    await server.listen()

    // listen触发初始full-bundle构建，等待buildEnd完成。
    await expect.poll(() => buildEndCount, { timeout: 10000 }).toBe(1)
    expect(buildStartCount).toBe(1)

    await server.close()
    server = undefined

    // close后两钩子计数仍应为1。
    expect(buildStartCount).toBe(1)
    expect(buildEndCount).toBe(1)
  })
})
