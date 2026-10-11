import { expect, test } from 'vitest'
import { editFile, isBuild, isBundledDev, page } from '~utils'

/** 注册主目录与 base 变体共享的依赖 watch 测试；构建只检查初始转换次数，普通 dev 检查两类依赖触发重转换。 */
export const tests = () => {
  /** bundled dev 跳过此依赖重转换用例；其余模式先检查计数为一，构建模式到此返回，普通 dev 依次修改 transform 与 load 的 watch 依赖并验证计数为二、三。 */
  test.skipIf(isBundledDev)(
    'should re-run transform when dependencies are edited',
    async () => {
      expect(await page.textContent('#transform-count')).toBe('1')

      if (isBuild) return
      editFile('plugin-dep.js', (str) => str + ' ')
      await expect.poll(() => page.textContent('#transform-count')).toBe('2')

      editFile('plugin-dep-load.js', (str) => str + ' ')
      await expect.poll(() => page.textContent('#transform-count')).toBe('3')
    },
  )
}
