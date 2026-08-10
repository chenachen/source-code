import path from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
import { handleHMRUpdate } from '../hmr'
import { type ServerOptions, createServer } from '../index'

/**
 * 场景：hotUpdate hook 在等待期间重启 server，旧 Environment 与模块图随即失效。
 * 机制：handleHMRUpdate 保存 environments 快照，每次 await 后用引用变化检测陈旧事务。
 * 目标：hook 的后续异常不发送 error/update，也不把旧 hmr 回调交给新的 Environment。
 */
async function testRestartDuringHotUpdate(serverOptions: ServerOptions = {}) {
  let hookCalls = 0
  const server = await createServer({
    configFile: false,
    root: import.meta.dirname,
    logLevel: 'silent',
    server: {
      middlewareMode: true,
      ws: false,
      ...serverOptions,
    },
    plugins: [
      {
        name: 'restart-during-hot-update',
        /** 首次热更新时重启服务器并抛错，模拟失效中的旧钩子事务。 */
        async hotUpdate() {
          if (hookCalls++ === 0) {
            await server.restart()
            throw new Error('hot update interrupted by restart')
          }
        },
      },
    ],
  })
  onTestFinished(async () => {
    await server.close()
  })

  await expect(
    handleHMRUpdate(
      'update',
      path.join(import.meta.dirname, 'fixture.js'),
      server,
    ),
  ).resolves.toBeUndefined()
}

/**
 * 场景：默认 Environment 的 hotUpdate hook 等待期间重启服务器并随后抛错。
 * 验证目标：`handleHMRUpdate` 将旧事务视为已取消并正常返回，不传播重启前钩子的异常。
 */
test('cancels HMR when the server restarts during a hot update', async () => {
  await testRestartDuringHotUpdate()
})

/**
 * 场景：hotUpdate hook 重启服务器，同时配置自定义 `hotUpdateEnvironments` 分派器。
 * 验证目标：旧 Environment 失效后不调用自定义分派器，避免执行陈旧 HMR 闭包。
 */
test('does not schedule stale HMR with a custom environment handler', async () => {
  let hotUpdateEnvironmentsCalls = 0
  await testRestartDuringHotUpdate({
    /** 若 HMR 事务仍新鲜，则把更新任务分派给全部 Environment。 */
    async hotUpdateEnvironments(server, hmr) {
      hotUpdateEnvironmentsCalls++
      await Promise.all(Object.values(server.environments).map(hmr))
    },
  })
  expect(hotUpdateEnvironmentsCalls).toBe(0)
})
