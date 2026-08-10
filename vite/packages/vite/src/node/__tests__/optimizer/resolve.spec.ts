import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { expandGlobIds } from '../../optimizer/resolve'

/** 定位带 exports 与私有子路径的 glob-exports 测试包。 */
const fixtureRoot = path.join(import.meta.dirname, '../fixtures/glob-exports')

/** 构造 expandGlobIds 所需的最小解析配置，并为每次调用隔离 packageCache。 */
function makeConfig(root: string): any {
  return {
    root,
    resolve: { preserveSymlinks: false },
    packageCache: new Map(),
  }
}

describe('expandGlobIds', () => {
  /**
   * 场景：include glob 命中声明 exports 的包。
   * 验证目标：包根与公开子路径可优化，值为 null 的私有/封锁 subpath 绝不能因磁盘 glob 泄露。
   * 机制：用 fixture package exports 对正反路径做集合断言。
   */
  test('skips null-valued exports (private subpath patterns)', () => {
    const result = expandGlobIds('my-pkg/*', makeConfig(fixtureRoot))

    expect(result).toContain('my-pkg')
    expect(result).toContain('my-pkg/utils')
    expect(result).toContain('my-pkg/public')
    expect(result).not.toContain('my-pkg/private')
    expect(result).not.toContain('my-pkg/also-private')
  })
})
