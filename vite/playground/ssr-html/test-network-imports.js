import assert from 'node:assert'
import { fileURLToPath } from 'node:url'
import { createServer, createServerModuleRunner } from 'vite'

/** 场景：以固定端口提供 slash 的本地 HTTP 模块，再按参数选择 ModuleRunner 或 ssrLoadModule 导入 network-imports.js；断言反斜线转成正斜线并关闭服务。旧 network-imports 实验能力的执行条件由外层测试控制。 */
async function runTest(userRunner) {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('.', import.meta.url)),
    server: {
      middlewareMode: true,
      ws: false,
    },
  })
  let mod
  if (userRunner) {
    const runner = await createServerModuleRunner(server.environments.ssr, {
      hmr: false,
    })
    mod = await runner.import('/src/network-imports.js')
  } else {
    mod = await server.ssrLoadModule('/src/network-imports.js')
  }
  assert.equal(mod.slash('foo\\bar'), 'foo/bar')
  await server.close()
}

runTest(process.argv.includes('--module-runner'))
