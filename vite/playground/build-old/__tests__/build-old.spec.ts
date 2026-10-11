import { describe, expect, test } from 'vitest'
import { findAssetFile, isBuild, page } from '~utils'

describe('syntax preserve', () => {
  /** 场景：旧浏览器目标夹具读取 import.meta.url 的类型；轮询页面，核对该语法仍得到 string。 */
  test('import.meta.url', async () => {
    await expect.poll(() => page.textContent('.import-meta-url')).toBe('string')
  })
  /** 场景：旧浏览器目标夹具执行动态导入；轮询 .dynamic-import，核对模块成功加载并显示 success。 */
  test('dynamic import', async () => {
    await expect.poll(() => page.textContent('.dynamic-import')).toBe('success')
  })
})

describe('syntax is lowered', () => {
  /** 场景：夹具创建带私有字段的类；核对运行结果 private，构建时再检查入口 JS 不含 this.#字段语法。 */
  test('private field', async () => {
    await expect.poll(() => page.textContent('.private-field')).toBe('private')

    if (isBuild) {
      const content = findAssetFile(/index-[-\w]{8}\.js/)
      expect(content).not.toMatch(/this\.#\w+/)
    }
  })
})
