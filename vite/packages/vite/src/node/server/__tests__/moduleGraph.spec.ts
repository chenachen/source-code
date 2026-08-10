import { describe, expect, it } from 'vitest'
import { EnvironmentModuleGraph } from '../moduleGraph'
import type { ModuleNode } from '../mixedModuleGraph'
import { ModuleGraph } from '../mixedModuleGraph'

describe('moduleGraph', () => {
  describe('invalidateModule', () => {
    /**
     * 场景：SSR 执行失败后，模块节点会暂存错误；文件再次失效时应允许重新执行。
     * 验证目标：失效不仅清空变换结果，也必须清除旧的 ssrError。
     * 机制：先人工写入错误，再经过 invalidateModule 观察节点状态。
     */
    it('removes an ssr error', async () => {
      const moduleGraph = new EnvironmentModuleGraph('ssr', async (url) => ({
        id: url,
      }))
      const entryUrl = '/x.js'

      const entryModule = await moduleGraph.ensureEntryFromUrl(entryUrl, false)
      entryModule.ssrError = new Error(`unable to execute module`)

      expect(entryModule.ssrError).to.be.a('error')
      moduleGraph.invalidateModule(entryModule)
      expect(entryModule.ssrError).toBe(null)
    })

    /**
     * 场景：两个请求 URL 经 resolveId 后指向同一个规范 ID。
     * 验证目标：模块图只保留一个真实节点，并让后来的 URL 复用其 meta 等状态。
     * 机制：解析器把 /xx.js 重定向到 /x.js，再比较两次 ensureEntryFromUrl 的节点数据。
     */
    it('ensureEntryFromUrl should based on resolvedId', async () => {
      const moduleGraph = new EnvironmentModuleGraph('client', async (url) => {
        if (url === '/xx.js') {
          return { id: '/x.js' }
        } else {
          return { id: url }
        }
      })
      const meta = { vite: 'test' }

      const mod1 = await moduleGraph.ensureEntryFromUrl('/x.js', false)
      mod1.meta = meta
      const mod2 = await moduleGraph.ensureEntryFromUrl('/xx.js', false)
      expect(mod2.meta).to.equal(meta)
    })

    /**
     * 场景：Environment API 将 client/ssr 拆成两张图，但旧插件仍通过 ModuleGraph 访问统一节点。
     * 验证目标：兼容层应合并同 ID 的双环境节点，且 importers 的遍历、values、forEach 与失效调用保持旧 API 语义。
     * 机制：分别构造 client/ssr 节点和导入者，再通过包装后的 ModuleNode/Set 核对配对关系与去重结果。
     */
    it('ensure backward compatibility', async () => {
      const clientModuleGraph = new EnvironmentModuleGraph(
        'client',
        async (url) => ({ id: url }),
      )
      const ssrModuleGraph = new EnvironmentModuleGraph('ssr', async (url) => ({
        id: url,
      }))
      const moduleGraph = new ModuleGraph({
        client: () => clientModuleGraph,
        ssr: () => ssrModuleGraph,
      })

      /** 在 client 图中建立模块节点。 */
      const addBrowserModule = (url: string) =>
        clientModuleGraph.ensureEntryFromUrl(url)
      /** 按 ID 读取 client 图节点。 */
      const getBrowserModule = (url: string) =>
        clientModuleGraph.getModuleById(url)

      /** 在 SSR 图中建立模块节点。 */
      const addServerModule = (url: string) =>
        ssrModuleGraph.ensureEntryFromUrl(url)
      /** 按 ID 读取 SSR 图节点。 */
      const getServerModule = (url: string) => ssrModuleGraph.getModuleById(url)

      const clientModule1 = await addBrowserModule('/1.js')
      const ssrModule1 = await addServerModule('/1.js')
      const module1 = moduleGraph.getModuleById('/1.js')!
      expect(module1._clientModule).toBe(clientModule1)
      expect(module1._ssrModule).toBe(ssrModule1)

      const module2b = await moduleGraph.ensureEntryFromUrl('/b/2.js')
      const module2s = await moduleGraph.ensureEntryFromUrl('/s/2.js')
      expect(module2b._clientModule).toBe(getBrowserModule('/b/2.js'))
      expect(module2s._ssrModule).toBe(getServerModule('/s/2.js'))

      const importersUrls = ['/1/a.js', '/1/b.js', '/1/c.js']
      ;(await Promise.all(importersUrls.map(addBrowserModule))).forEach((mod) =>
        clientModule1.importers.add(mod),
      )
      ;(await Promise.all(importersUrls.map(addServerModule))).forEach((mod) =>
        ssrModule1.importers.add(mod),
      )

      expect(module1.importers.size).toBe(importersUrls.length)

      const clientModule1importersValues = [...clientModule1.importers]
      const ssrModule1importersValues = [...ssrModule1.importers]

      const module1importers = module1.importers
      const module1importersValues = [...module1importers.values()]
      expect(module1importersValues.length).toBe(importersUrls.length)
      expect(module1importersValues[1]._clientModule).toBe(
        clientModule1importersValues[1],
      )
      expect(module1importersValues[1]._ssrModule).toBe(
        ssrModule1importersValues[1],
      )

      const module1importersFromForEach: ModuleNode[] = []
      module1.importers.forEach((imp) => {
        moduleGraph.invalidateModule(imp)
        module1importersFromForEach.push(imp)
      })
      expect(module1importersFromForEach.length).toBe(importersUrls.length)
      expect(module1importersFromForEach[1]._clientModule).toBe(
        clientModule1importersValues[1],
      )
      expect(module1importersFromForEach[1]._ssrModule).toBe(
        ssrModule1importersValues[1],
      )
    })
  })
})
