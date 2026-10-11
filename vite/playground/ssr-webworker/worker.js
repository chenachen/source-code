import path from 'node:path'
import { Miniflare } from 'miniflare'

/** 读取 TEST 标记；测试 harness 显式创建 Miniflare，手动运行时才自动启动。 */
const isTest = !!process.env.TEST

/** 在指定端口启动 dist/worker.js 的 Miniflare 模块 worker，启用 Node 兼容 flags 并等待 ready；返回 mf 给 harness 管理关闭。 */
export async function createServer(port) {
  const mf = new Miniflare({
    scriptPath: path.resolve(
      import.meta.dirname,
      'dist/worker/entry-worker.js',
    ),
    port,
    modules: true,
    compatibilityFlags: ['nodejs_compat'],
  })
  await mf.ready
  return { mf }
}

if (!isTest) {
  createServer(5173).then(() => console.log('http://localhost:5173'))
}
