import { expect, test } from 'vitest'
import { isBundled, page, viteServer } from '~utils'

// bundledDev的模块图在Rolldown bundle中，本例只检查普通dev的Environment ModuleGraph。
/** 场景：仅!isBundled执行：页面导入慢速虚拟模块与empty.js成功；读取client图的importedModules顺序，核对虚拟模块先于empty，异步解析速度不改边顺序。 */
test.runIf(!isBundled)('importedUrls order is preserved', async () => {
  const el = page.locator('.imported-urls-order')
  expect(await el.textContent()).toBe('[success]')
  const mod = await viteServer.environments.client.moduleGraph.getModuleByUrl(
    '/imported-urls-order.js',
  )
  const importedModuleIds = [...mod.importedModules].map((m) => m.url)
  expect(importedModuleIds).toEqual(['\x00virtual:slow-module', '/empty.js'])
})
