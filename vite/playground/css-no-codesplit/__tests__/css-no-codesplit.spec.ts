import { describe, expect, test } from 'vitest'
import { getColor, isBuild, listAssets } from '~utils'

/** 场景：关闭 CSS 拆分的夹具有共享 link 与异步 JS 样式；核对共享元素为蓝，并等待异步样式变蓝。 */
test('should load all stylesheets', async () => {
  expect(await getColor('.shared-linked')).toBe('blue')
  await expect.poll(() => getColor('.async-js')).toBe('blue')
})

describe.runIf(isBuild)('build', () => {
  /** 场景：仅构建执行：列出资产，核对 shared-linked 与 async-js 纯 CSS 依赖没有留下空 JS 文件。 */
  test('should remove empty chunk', async () => {
    const assets = listAssets()
    expect(assets).not.toContainEqual(
      expect.stringMatching(/shared-linked-.*\.js$/),
    )
    expect(assets).not.toContainEqual(expect.stringMatching(/async-js-.*\.js$/))
  })
})
