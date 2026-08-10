import type { Mock } from 'vitest'
import { describe, expect, test, vi } from 'vitest'
import { createServer } from '../server'
import { preview } from '../preview'
import { bindCLIShortcuts } from '../shortcuts'

describe('bindCLIShortcuts', () => {
  /**
   * 场景：开发服务器或预览服务器已经绑定一组快捷键，随后再次绑定另一组快捷键。
   * 验证目标：确认同名快捷键使用最新 action，未被覆盖的旧快捷键继续存在，新快捷键也能追加。
   * 这是 `bindCLIShortcuts` 按 key 合并而非整组替换的行为契约。
   */
  test.each([
    ['dev server', () => createServer()],
    ['preview server', () => preview()],
  ])('binding custom shortcuts with the %s', async (_, startServer) => {
    const server = await startServer()

    try {
      const xAction = vi.fn()
      const yAction = vi.fn()

      bindCLIShortcuts(
        server,
        {
          customShortcuts: [
            { key: 'x', description: 'test x', action: xAction },
            { key: 'y', description: 'test y', action: yAction },
          ],
        },
        true,
      )

      expect.assert(
        server._shortcutsState?.rl,
        'The readline interface should be defined after binding shortcuts.',
      )
      expect(xAction).not.toHaveBeenCalled()

      server._shortcutsState.rl.emit('line', 'x')
      await vi.waitFor(() => expect(xAction).toHaveBeenCalledOnce())

      const xUpdatedAction = vi.fn()
      const zAction = vi.fn()

      bindCLIShortcuts(
        server,
        {
          customShortcuts: [
            { key: 'x', description: 'test x updated', action: xUpdatedAction },
            { key: 'z', description: 'test z', action: zAction },
          ],
        },
        true,
      )

      expect(xUpdatedAction).not.toHaveBeenCalled()
      server._shortcutsState.rl.emit('line', 'x')
      await vi.waitFor(() => expect(xUpdatedAction).toHaveBeenCalledOnce())

      // 同名的 x 已被新定义覆盖，旧 action 不应再次触发。
      expect(xAction).toHaveBeenCalledOnce()

      expect(yAction).not.toHaveBeenCalled()
      server._shortcutsState.rl.emit('line', 'y')
      await vi.waitFor(() => expect(yAction).toHaveBeenCalledOnce())

      expect(zAction).not.toHaveBeenCalled()
      server._shortcutsState.rl.emit('line', 'z')
      await vi.waitFor(() => expect(zAction).toHaveBeenCalledOnce())
    } finally {
      await server.close()
    }
  })

  /**
   * 场景：插件在 `configureServer` 中绑定快捷键，用户又在服务器对象上手工绑定快捷键，
   * 随后服务器执行原地重启。
   * 验证目标：确认重启复用同一个 readline，保留快捷键顺序和用户绑定；插件钩子重新执行后，
   * 插件快捷键的 action 应切换到新服务器实例创建的版本，而不是继续引用已关闭的旧实例。
   * 回归背景：#21166 修复了重启后快捷键仍绑定旧服务器闭包的问题。
   */
  test('rebinds shortcuts after server restart', async () => {
    const manualShortcutAction = vi.fn()
    const pluginShortcutActions: Array<Mock<any>> = []

    const server = await createServer({
      plugins: [
        {
          name: 'custom-shortcut-plugin',
          /** 每次服务器初始化都绑定一份新插件快捷键 action，供重启前后引用比较。 */
          configureServer(viteDevServer) {
            const action = vi.fn()

            // 记录插件每次初始化生成的 action，验证重启时旧定义会被新定义覆盖。
            pluginShortcutActions.push(action)

            // 模拟插件在 configureServer 阶段注册快捷键。
            bindCLIShortcuts(
              viteDevServer,
              {
                customShortcuts: [
                  {
                    key: 'y',
                    description: 'plugin shortcut',
                    action,
                  },
                ],
              },
              true,
            )
          },
        },
      ],
    })

    try {
      const readline = server._shortcutsState?.rl

      expect.assert(
        readline,
        'The readline interface should be defined after binding shortcuts.',
      )

      readline.emit('line', 'y')
      await vi.waitFor(() => {
        expect(pluginShortcutActions).toHaveLength(1)
        expect(pluginShortcutActions[0]).toHaveBeenCalledOnce()
      })

      // 模拟用户在服务器创建完成后手工追加快捷键。
      bindCLIShortcuts(
        server,
        {
          customShortcuts: [
            {
              key: 'x',
              description: 'manual shortcut',
              action: manualShortcutAction,
            },
          ],
        },
        true,
      )

      readline.emit('line', 'x')
      await vi.waitFor(() =>
        expect(manualShortcutAction).toHaveBeenCalledOnce(),
      )

      // key 冲突采用“后注册覆盖值但保持原位置”的合并规则。
      expect(
        server._shortcutsState?.options.customShortcuts?.map((s) => s.key),
      ).toEqual(['x', 'y'])

      // restart 会创建内部新服务器，再把其状态迁回当前公开对象。
      await server.restart()

      // 手工注册的 x 与插件重新注册的 y 顺序均应保留。
      expect(
        server._shortcutsState?.options.customShortcuts?.map((s) => s.key),
      ).toEqual(['x', 'y'])

      expect.assert(
        server._shortcutsState?.rl === readline,
        'The readline interface should be preserved.',
      )

      // x 仍调用用户 action；y 则必须调用插件重启后新建的 action。
      readline.emit('line', 'x')
      await vi.waitFor(() =>
        expect(manualShortcutAction).toHaveBeenCalledTimes(2),
      )

      readline.emit('line', 'y')
      await vi.waitFor(() => {
        expect(pluginShortcutActions).toHaveLength(2)
        expect(pluginShortcutActions[1]).toHaveBeenCalledOnce()
        expect(pluginShortcutActions[0]).toHaveBeenCalledOnce()
      })
    } finally {
      await server.close()
    }
  })
})
