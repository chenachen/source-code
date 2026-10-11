import { describe, expect, test } from 'vitest'
import { findAssetFile, isBuild } from '~utils'

describe.runIf(isBuild)('css lib entry', () => {
  /** 仅构建模式查找纯 CSS 库入口 linked.js.map，要求不存在，覆盖移除空 JS chunk 时同步清理其 map。 */
  test('remove useless js sourcemap', async () => {
    expect(findAssetFile('linked.js.map', 'lib-entry', './')).toBeUndefined()
  })
})
