import { expect, test } from 'vitest'
import { findAssetFile, isBuild } from '~utils'

/** 场景：仅构建执行：modern Sass compiler 同时处理 entry1/entry2；分别读取产物并快照核对红色与蓝色 CSS。 */
test.runIf(isBuild)('sass modern compiler build multiple entries', () => {
  expect(findAssetFile(/entry1/, 'sass-modern-compiler-build'))
    .toMatchInlineSnapshot(`
    ".entry1{color:red}
    "
  `)
  expect(findAssetFile(/entry2/, 'sass-modern-compiler-build'))
    .toMatchInlineSnapshot(`
    ".entry2{color:#00f}
    "
  `)
})
