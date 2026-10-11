import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import type { OutputChunk, RolldownOutput } from 'rolldown'
import { build } from '../../build'

/** 定位 worker URL 客户端/SSR 共用的测试夹具目录。 */
const fixturesDir = resolve(import.meta.dirname, 'fixtures')

/**
 * 场景：同一 `?worker&url` 分别进入客户端和 SSR 构建。
 * 机制：从两个入口 chunk 提取 worker 资产 URL，比较由内容决定的文件名。
 * 验证目标：两种入口代码引用的 worker 文件名（含 hash）一致。
 */
test('?worker&url should produce the same hash in client and SSR builds', async () => {
  const root = resolve(fixturesDir, 'worker-url')

  const clientResult = (await build({
    root,
    logLevel: 'silent',
    build: {
      write: false,
      rolldownOptions: {
        input: resolve(root, 'entry.js'),
      },
    },
  })) as RolldownOutput

  const ssrResult = (await build({
    root,
    logLevel: 'silent',
    build: {
      write: false,
      ssr: resolve(root, 'entry.js'),
    },
  })) as RolldownOutput

  // 两个入口 chunk 都会把 worker 资产 URL 写成字符串，从代码中提取后直接比较。
  const clientEntry = clientResult.output.find(
    (o): o is OutputChunk => o.type === 'chunk' && o.isEntry,
  )!
  const ssrEntry = ssrResult.output.find(
    (o): o is OutputChunk => o.type === 'chunk' && o.isEntry,
  )!

  const workerUrlPattern = /assets\/worker-[\w-]+\.js/g
  const clientWorkerUrls = clientEntry.code.match(workerUrlPattern) ?? []
  const ssrWorkerUrls = ssrEntry.code.match(workerUrlPattern) ?? []

  expect(clientWorkerUrls.length).toBeGreaterThan(0)
  expect(ssrWorkerUrls.length).toBeGreaterThan(0)
  expect(ssrWorkerUrls).toEqual(clientWorkerUrls)
})
