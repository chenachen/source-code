import { beforeEach, describe, expect, test } from 'vitest'
import { findAssetFile, isBuild, startDefaultServe } from '~utils'

beforeEach(async () => {
  await startDefaultServe()
})

for (let i = 0; i < 5; i++) {
  describe.runIf(isBuild)('css-codesplit build', () => {
    /** 场景：循环 i=0..4 注册相同内容的构建用例，beforeEach 每次重新启动默认构建；仅 isBuild 执行，核对去重后无 style CSS、style2 CSS 为蓝色压缩规则。 */
    test('should be consistent with same content', () => {
      expect(findAssetFile(/style-.+\.css/)).toBeUndefined()
      expect(findAssetFile(/style2-.+\.css/)).toMatch('h2{color:#00f}')
    })
  })
}
