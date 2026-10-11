import { describe, expect } from 'vitest'
import { createModuleRunnerTester } from './utils'

describe('module runner hmr works as expected', async () => {
  const it = await createModuleRunnerTester({
    server: {
      // 工厂默认关闭 watcher；此处启用 watcher，但显式关闭 HMR。
      watch: {},
      hmr: false,
    },
  })

  /** 场景：保留文件监听但设置 server.hmr=false，导入读取 import.meta.hot 的模块；验证目标：runner 无 HMR client，模块的 hmr 导出也为 undefined。 */
  it("hmr client is not defined if it's disabled", async ({ runner }) => {
    expect(runner.hmrClient).toBeUndefined()

    const mod = await runner.import('/fixtures/hmr.js')
    expect(mod).toHaveProperty('hmr')
    expect(mod.hmr).toBeUndefined()
  })
})
