import { describe, expect, test } from 'vitest'
import { findAssetFile, isBuild } from '~utils'

describe.runIf(isBuild)('no css minify', () => {
  /** 场景：仅构建执行：no-css-minify 变体读取 JS/CSS，核对 polyfill 函数文本已被 JS 压缩，而 CSS 保留完整换行与 rgba 声明。 */
  test('js minified but css not minified', () => {
    expect(findAssetFile(/index-[-\w]+\.js$/, 'no-css-minify')).not.toMatch(
      '(function polyfill() {',
    )
    expect(findAssetFile(/index-[-\w]+\.css$/, 'no-css-minify')).toMatch(`\
.test-minify {
  color: rgba(255, 255, 0, 0.7);
}`)
  })
})
