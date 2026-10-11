import { fileURLToPath } from 'node:url'
import assert from 'node:assert'
import { createServer, createServerModuleRunner } from 'vite'

// 与 server-source-maps.spec.ts 的嵌套错误位置场景对应；独立 e2e 脚本还覆盖构建后的包入口。

/** 场景：创建静默且不启用 WebSocket 的 middleware 服务，供 ModuleRunner 导入固定行号的抛错 fixture；finally 中关闭服务。 */
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    middlewareMode: true,
    ws: false,
  },
})

/** 连接该服务的 ModuleRunner；导入时建立源码映射，供随后同步调用产生原文件堆栈。 */
const runner = await createServerModuleRunner(server.environments.ssr, {
  sourcemapInterceptor: 'prepareStackTrace',
})

/** 导入 has-error-deep.ts 的模块命名空间；调用 main 后捕获错误，并断言堆栈含该源码的 6:3 调用帧。 */
const mod = await runner.import('/src/has-error-deep.ts')
let error
try {
  mod.main()
} catch (e) {
  error = e
} finally {
  await server.close()
}
assert.match(error?.stack, /has-error-deep.ts:6:3/)
