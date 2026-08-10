import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ViteDevServer, createServer } from '../index'

/** 区分 NoopWatcher 链式空 add 实现与 Chokidar 实际 add 的源码特征。 */
const stubGetWatchedCode = /\(\)\s*\{\s*return this;\s*\}/

describe('watcher configuration', () => {
  let server: ViteDevServer | undefined

  afterEach(async () => {
    if (server) {
      await server.close()
      server = undefined
    }
  })

  /**
   * 场景：server.watch=null 显式关闭监听。
   * 验证目标：仍返回 FSWatcher 形状的 NoopWatcher，调用 add 不需判空。
   */
  it('when watcher is disabled, return noop watcher', async () => {
    server = await createServer({
      server: {
        watch: null,
      },
    })
    expect(server.watcher.add.toString()).toMatch(stubGetWatchedCode)
  })

  /**
   * 场景：server.watch 提供普通选项对象。
   * 验证目标：创建真实 Chokidar watcher，而不是 no-op 兼容层。
   */
  it('when watcher is not disabled, return chokidar watcher', async () => {
    server = await createServer({
      server: {
        watch: {},
      },
    })
    expect(server.watcher.add.toString()).not.toMatch(stubGetWatchedCode)
  })

  /**
   * 场景：嵌套 root 的 config 依赖、envDir、publicDir 都位于 root 外。
   * 验证目标：watcher ready 后的目录表明确包含 root、配置依赖、env 与 public 四类路径。
   */
  it('should watch the root directory, config file dependencies, dotenv files, and the public directory', async () => {
    const root = fileURLToPath(
      new URL('./fixtures/watcher/nested-root', import.meta.url),
    )
    server = await createServer({ root })
    await new Promise((resolve) => server!.watcher.once('ready', resolve))
    // Chokidar ready 后目录表仍可能短暂未齐，使用 waitFor 消除文件系统时序抖动。
    await vi.waitFor(() => {
      const watchedDirs = Object.keys(server!.watcher.getWatched())
      expect(watchedDirs).toEqual(
        expect.arrayContaining([
          root,
          resolve(root, '../config-deps'),
          resolve(root, '../custom-env'),
          resolve(root, '../custom-public'),
        ]),
      )
    })
  })
})
