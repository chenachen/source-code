import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { searchForWorkspaceRoot } from '../searchRoot'

/** 搜索 workspace 测试夹具时使用的当前测试目录。 */
const dirname = import.meta.dirname

/**
 * 从不同 monorepo 标记的嵌套目录开始向上搜索，验证 workspace 根识别优先于最近
 * package 根；无 workspace 标记时应稳定退回 Vite 仓库根。
 */
describe('searchForWorkspaceRoot', () => {
  /**
   * 场景：从带 `lerna.json` 的 monorepo 子目录开始搜索。
   * 验证目标：返回 Lerna workspace 根，而不是嵌套目录。
   */
  test('lerna', () => {
    const resolved = searchForWorkspaceRoot(
      resolve(dirname, 'fixtures/lerna/nested'),
    )
    expect(resolved).toBe(resolve(dirname, 'fixtures/lerna'))
  })

  /**
   * 场景：从带 `pnpm-workspace.yaml` 的 workspace 子目录开始搜索。
   * 验证目标：返回 pnpm workspace 根目录。
   */
  test('pnpm', () => {
    const resolved = searchForWorkspaceRoot(
      resolve(dirname, 'fixtures/pnpm/nested'),
    )
    expect(resolved).toBe(resolve(dirname, 'fixtures/pnpm'))
  })

  /**
   * 场景：父目录 package.json 通过 `workspaces` 声明 Yarn/npm workspace。
   * 验证目标：向上命中该 package.json 所在目录。
   */
  test('yarn', () => {
    const resolved = searchForWorkspaceRoot(
      resolve(dirname, 'fixtures/yarn/nested'),
    )
    expect(resolved).toBe(resolve(dirname, 'fixtures/yarn'))
  })

  /**
   * 场景：搜索起点本身就是 package.json workspaces 根。
   * 验证目标：立即返回起点，不继续越过当前 workspace。
   */
  test('yarn at root', () => {
    const resolved = searchForWorkspaceRoot(resolve(dirname, 'fixtures/yarn'))
    expect(resolved).toBe(resolve(dirname, 'fixtures/yarn'))
  })

  /**
   * 场景：从 Deno workspace 的嵌套目录开始搜索。
   * 验证目标：通过父目录 Deno 配置返回 workspace 根。
   */
  test('deno', () => {
    const resolved = searchForWorkspaceRoot(
      resolve(dirname, 'fixtures/deno/nested'),
    )
    expect(resolved).toBe(resolve(dirname, 'fixtures/deno'))
  })

  /**
   * 场景：搜索起点本身含 Deno workspace 配置。
   * 验证目标：直接返回当前目录而非继续向父级搜索。
   */
  test('deno at root', () => {
    const resolved = searchForWorkspaceRoot(resolve(dirname, 'fixtures/deno'))
    expect(resolved).toBe(resolve(dirname, 'fixtures/deno'))
  })

  /**
   * 场景：嵌套夹具路径沿途没有 workspace 标记。
   * 验证目标：回退到最近可用的包根，即当前 Vite 仓库根。
   */
  test('none', () => {
    const resolved = searchForWorkspaceRoot(
      resolve(dirname, 'fixtures/none/nested'),
    )
    // 当前夹具位于 Vite 包内部，所以最近的兜底包根就是仓库根。
    expect(resolved).toBe(resolve(dirname, '../../../../../..'))
  })
})
