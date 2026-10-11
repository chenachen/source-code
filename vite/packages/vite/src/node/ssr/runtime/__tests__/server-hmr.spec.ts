import { describe, expect, onTestFinished } from 'vitest'
import { createModuleRunnerTester } from './utils'

/**
 * 阅读目标：Runner HMR 不刷新页面，而是在已求值模块图上更新或重跑入口。
 * 本文件重点验证 client 状态登记，以及“模块失效后两个入口并发重求值”时不能把
 * 尚未完成的 re-export 暴露给另一条导入链。
 */
describe(
  'module runner hmr works as expected',
  async () => {
    const it = await createModuleRunnerTester({
      server: {
        // 测试工具默认关闭监听；这里覆盖配置以启用 HMR 通道。
        watch: {},
      },
    })

    /**
     * 场景：启用 watcher 的 Module Runner 首次导入调用 `import.meta.hot.accept()` 的模块。
     * 验证目标：runner 创建 HMR client，模块收到可调用 accept 的 hot context。
     */
    it('hmr options are defined', async ({ runner }) => {
      expect(runner.hmrClient).toBeDefined()

      const mod = await runner.import('/fixtures/hmr.js')
      expect(mod).toHaveProperty('hmr')
      expect(mod.hmr).toHaveProperty('accept')
    })

    /**
     * 场景：入口 d 导入依赖 c，两个模块都建立 HMR context 与监听器。
     * 验证目标：hotModules、data、context listeners 三张表各含两个对应模块 URL。
     */
    it('correctly populates hmr client', async ({ runner }) => {
      const mod = await runner.import('/fixtures/d')
      expect(mod.d).toBe('a')

      const fixtureC = '/fixtures/c.ts'
      const fixtureD = '/fixtures/d.ts'

      expect(runner.hmrClient!.hotModulesMap.size).toBe(2)
      expect(runner.hmrClient!.dataMap.size).toBe(2)
      expect(runner.hmrClient!.ctxToListenersMap.size).toBe(2)

      for (const fixture of [fixtureC, fixtureD]) {
        expect(runner.hmrClient!.hotModulesMap.has(fixture)).toBe(true)
        expect(runner.hmrClient!.dataMap.has(fixture)).toBe(true)
        expect(runner.hmrClient!.ctxToListenersMap.has(fixture)).toBe(true)
      }
    })

    /**
     * 场景：两个入口并发重新导入同一失效 re-export 模块，第一条求值链在核心模块中暂停。
     * 验证目标：两条导入都完成并分别得到 a、b，且入口 HMR 监听器仍登记完整。
     * 机制：等待 entry-b 建立本轮 imports 边后释放 entry-a，确定触发 evaluated module 并发分支。
     */
    it('does not expose partial exports during concurrent updates', async ({
      runner,
    }) => {
      const testGlobal = globalThis as any

      testGlobal.__vite_ssr_hmr_reexport_race__ = {
        /** 首次求值立即放行，先建立两条入口及共享依赖的已求值图。 */
        wait: () => Promise.resolve(),
      }
      onTestFinished(() => {
        delete testGlobal.__vite_ssr_hmr_reexport_race__
      })

      await runner.import('/fixtures/hmr-reexport-race/entry-a.js')
      await runner.import('/fixtures/hmr-reexport-race/entry-b.js')

      const sharedModule = runner.evaluatedModules.getModuleByUrl(
        '/fixtures/hmr-reexport-race/shared.js',
      )
      const coreModule = runner.evaluatedModules.getModuleByUrl(
        '/fixtures/hmr-reexport-race/core.js',
      )
      const entryAModule = runner.evaluatedModules.getModuleByUrl(
        '/fixtures/hmr-reexport-race/entry-a.js',
      )
      const entryBModule = runner.evaluatedModules.getModuleByUrl(
        '/fixtures/hmr-reexport-race/entry-b.js',
      )
      expect(sharedModule).toBeDefined()
      expect(coreModule).toBeDefined()
      expect(entryAModule).toBeDefined()
      expect(entryBModule).toBeDefined()

      let waitStarted!: () => void
      const waitStartedPromise = new Promise<void>((resolve) => {
        waitStarted = resolve
      })
      let releaseWait!: () => void
      const waitPromise = new Promise<void>((resolve) => {
        releaseWait = resolve
      })

      testGlobal.__vite_ssr_hmr_reexport_race__ = {
        /** 标记重求值已进入 core，再停在可由本例显式解除的 Promise 上。 */
        wait: () => {
          waitStarted()
          return waitPromise
        },
      }

      for (const module of [
        entryAModule!,
        entryBModule!,
        sharedModule!,
        coreModule!,
      ]) {
        runner.evaluatedModules.invalidateModule(module)
      }

      const importA = runner.import('/fixtures/hmr-reexport-race/entry-a.js')
      await waitStartedPromise

      const importB = runner.import('/fixtures/hmr-reexport-race/entry-b.js')
      // 确定性等待 entry-b 观察到 shared 正在求值。request() 中的
      // `mod.imports.add(depMod.id)` 紧挨 cachedRequest() 的循环检测同步执行，因此看到
      // 这条边就说明目标竞态分支已执行或将在同一 microtask 执行。invalidateModule()
      // 会清空 imports，所以这是本轮重求值的新鲜信号；importers 则会保留，不能用于同步。
      const entryBNode = runner.evaluatedModules.getModuleByUrl(
        '/fixtures/hmr-reexport-race/entry-b.js',
      )!
      while (!entryBNode.imports.has(sharedModule!.id)) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      releaseWait()
      const results = await Promise.allSettled([importA, importB] as const)

      expect(results).toEqual([
        {
          status: 'fulfilled',
          value: expect.objectContaining({ result: 'a' }),
        },
        {
          status: 'fulfilled',
          value: expect.objectContaining({ result: 'b' }),
        },
      ])

      const hmrListeners = runner.hmrClient!.hotModulesMap
      expect(hmrListeners.has('/fixtures/hmr-reexport-race/entry-a.js')).toBe(
        true,
      )
      expect(hmrListeners.has('/fixtures/hmr-reexport-race/entry-b.js')).toBe(
        true,
      )
    })
  },
  process.env.CI ? 50_00 : 5_000,
)
