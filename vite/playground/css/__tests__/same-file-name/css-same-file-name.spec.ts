import { beforeEach, describe, expect, test } from 'vitest'
import { findAssetFile, isBuild, startDefaultServe } from '~utils'

beforeEach(async () => {
  await startDefaultServe()
})

for (let i = 0; i < 5; i++) {
  describe.runIf(isBuild)('css files has same basename', () => {
    /** 场景：for i=0..4 注册同名文件构建例，beforeEach 重新构建；仅 isBuild 执行，核对 sub.css 与 sub2.css 各包含对应 .sub1-sub/.sub2-sub，避免同 basename 输出身份混乱。 */
    test('emit file name should consistent', () => {
      expect(findAssetFile('sub.css', 'same-file-name', '.')).toMatch(
        '.sub1-sub',
      )
      expect(findAssetFile('sub2.css', 'same-file-name', '.')).toMatch(
        '.sub2-sub',
      )
    })
  })
}
