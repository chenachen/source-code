import { expect, test } from 'vitest'
import { findAssetFile, isBuild } from '~utils'

/** 场景：仅构建执行，Sass @use名称与Node builtin冲突；读取入口CSS，核对cursor:pointer已生成且构建未panic。 */
test.runIf(isBuild)('sass @use with node builtin name does not panic', () => {
  const css = findAssetFile(/entry/, 'sass-node-builtin-clash')
  expect(css).toContain('cursor:pointer')
})
