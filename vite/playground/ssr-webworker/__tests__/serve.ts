// harness使用此custom启动器，运行fixture的SSR后端。

import path from 'node:path'
import kill from 'kill-port'
import { ports, rootDir } from '~utils'

/** 当前SSR后端的独占HTTP端口。 */
export const port = ports['ssr-webworker']

/** 所有矩阵先构建SSR worker入口，再用fixture worker.js创建Miniflare实例。 */
export async function serve(): Promise<{
  /** 供 harness teardown 调用，Promise 在 Miniflare 实例释放后完成。 */
  close(): Promise<void>
}> {
  await kill(port)

  // 此custom后端运行构建好的worker产物，开发矩阵也先构建。
  const { build } = await import('vite')

  // SSR worker输出到dist/worker。
  await build({
    root: rootDir,
    logLevel: 'silent',
    build: {
      target: 'esnext',
      ssr: 'src/entry-worker.jsx',
      outDir: 'dist/worker',
    },
  })

  const { createServer } = await import(path.resolve(rootDir, 'worker.js'))
  const { mf } = await createServer(port)

  return {
    /** 释放Miniflare实例及其模拟worker服务。 */
    async close() {
      await mf.dispose()
    },
  }
}
