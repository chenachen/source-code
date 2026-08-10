import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, test } from 'vitest'
import { createServer } from '../../index'

/** 读取 Node 当前仍存活的底层句柄，用于观察外部 Sass 子进程。 */
const getActiveHandles = (): unknown[] => (process as any)._getActiveHandles()

/** 从活动句柄中筛出仍未退出的 Sass 子进程。 */
const runningSassWorkers = (): ChildProcess[] =>
  getActiveHandles().filter((h): h is ChildProcess => {
    if (!h || (h as object).constructor?.name !== 'ChildProcess') return false
    const cp = h as ChildProcess & {
      /** Node 子进程记录的可执行文件路径，用于只识别 Sass worker。 */
      spawnfile?: string
    }
    return (
      cp.exitCode == null &&
      typeof cp.spawnfile === 'string' &&
      cp.spawnfile.includes('sass')
    )
  })

describe('css preprocessor worker teardown', () => {
  /**
   * 场景：一次 SCSS 转换启动了 sass-embedded 子进程，随后关闭开发服务器。
   * 验证目标：确认 `server.close()` 会等待插件环境的 disposer 完成，返回时不再遗留 Sass worker。
   * 这个用例是服务器关闭链路的端到端证据：server → environment → plugin container → disposer。
   */
  test('awaits sass-embedded worker disposal on server.close()', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-sass-teardown-'))
    const scssPath = path.join(root, 'a.scss')
    fs.writeFileSync(scssPath, '$c: red;\nbody { color: $c; }\n')

    const server = await createServer({
      root,
      logLevel: 'silent',
      configFile: false,
      server: { ws: false },
    })
    await server.listen()

    try {
      await server.pluginContainer.transform(
        fs.readFileSync(scssPath, 'utf8'),
        scssPath,
      )
    } catch {
      // 转换后优化器可能抛出 ERR_OUTDATED_OPTIMIZED_DEP；本用例只要求 SCSS
      // 处理器已经启动，因此该错误与关闭行为无关。
    }

    expect(runningSassWorkers().length).toBeGreaterThan(0)

    await server.close()

    expect(runningSassWorkers().length).toBe(0)
  }, 30_000)
})
