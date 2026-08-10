import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { afterEach, expect, test } from 'vitest'
import type { ViteDevServer } from '../..'
import { createLogger, createServer } from '../..'
import { promiseWithResolvers } from '../../../shared/utils'

let server: ViteDevServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

/**
 * 回归问题：https://github.com/vitejs/vite/issues/22847
 * 场景：createServer 与 listen 之间主动 transform，裸依赖在 depsOptimizer.init 前被
 * 发现。旧实现会先启动 debounce run，随后 init 重置 metadata；在途 commit 再读取已消失的依赖，
 * 因 browserHash undefined 崩溃。
 * 验证目标：initialized 前只登记 missing，不得开始 bundle。
 */
test('does not crash when a dep is discovered before the server starts listening', async () => {
  const errors: string[] = []
  const logger = createLogger('error')
  logger.error = (msg) => {
    errors.push(typeof msg === 'string' ? msg : String(msg))
  }

  const bundleStarted = promiseWithResolvers<void>()

  server = await createServer({
    configFile: false,
    customLogger: logger,
    root: path.join(
      import.meta.dirname,
      '../fixtures/optimizer-discover-before-listen',
    ),
    // fixture 无 package.json；显式隔离 cacheDir，避免 force 删除并行 spec 正在读取的共享测试缓存。
    cacheDir: 'node_modules/.vite',
    environments: {
      ssr: {
        resolve: {
          noExternal: true,
        },
        optimizeDeps: {
          // 强制冷缓存，使 init 必然进入 crawl-end 状态机。
          force: true,
          noDiscovery: false,
          rolldownOptions: {
            plugins: [
              {
                name: 'test:signal-pre-bundle',
                /** 以预构建插件 buildStart 作为精确信号，判断 optimizer 是否在 listen 前错误启动。 */
                buildStart() {
                  bundleStarted.resolve()
                },
              },
            ],
          },
        },
      },
    },
  })

  const ssr = server.environments.ssr

  // listen 前 transform，刻意让依赖发现早于延迟到 listen 的 optimizer.init。
  await ssr.transformRequest('/entry.js')

  // 用插件 buildStart 信号精确断言 pre-init 没有任何预构建启动，而不只等待最终“碰巧没崩”。
  const preInitRunStarted = await Promise.race([
    bundleStarted.promise.then(() => true),
    setTimeout(300, false),
  ])
  expect(preInitRunStarted).toBe(false)

  // listen 后才允许 init/后台扫描；等待请求与 scan settle，确保迟发竞态也会进入错误日志断言。
  await server.listen()
  await ssr.waitForRequestsIdle()
  await ssr.depsOptimizer?.scanProcessing
  expect(errors).toStrictEqual([])
})
