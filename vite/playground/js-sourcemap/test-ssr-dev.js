import assert from 'node:assert'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

/** 启动禁用 HMR/WS 的 middleware dev 服务，加载对象 define 模块并修正异常堆栈，断言回到 TS 7:9 后关闭服务。
 * 当前脚本只在正常断言完成后关闭，没有 finally 清理。 */
async function runTest() {
  const server = await createServer({
    root: fileURLToPath(new URL('.', import.meta.url)),
    configFile: false,
    optimizeDeps: {
      noDiscovery: true,
    },
    server: {
      middlewareMode: true,
      hmr: false,
      ws: false,
    },
    define: {
      __testDefineObject: '{ "hello": "test" }',
    },
  })
  const mod = await server.ssrLoadModule('/with-define-object-ssr.ts')
  const error = await getError(() => mod.error())
  server.ssrFixStacktrace(error)
  assert.match(error.stack, /at errorInner (.*with-define-object-ssr.ts:7:9)/)
  await server.close()
}

/** 执行传入回调并捕获其拒绝/抛错，断言确实得到 Error 后返回供 ssrFixStacktrace 检查。 */
async function getError(f) {
  let error
  try {
    await f()
  } catch (e) {
    error = e
  }
  assert.ok(error)
  return error
}

runTest()
