import { describe, expect, test } from 'vitest'
import { assetUrlRE } from '../../plugins/asset'

describe('wasm plugin assetUrlRE usage', () => {
  // 回归场景：assetUrlRE 带 `/g`，`.test()` 会通过 lastIndex 保留状态。Wasm
  // 插件若连续检测两个资产占位符而未重置，第二次匹配会从字符串末尾开始失败，
  // 使第二个同长度占位符漏掉 __VITE_ASSET__ → __VITE_WASM_INIT__ 替换，
  // 最终在运行时读取错误路径并报 ENOENT。
  /** 场景：复用带 global 标志的 assetUrlRE 连续测试两个短占位符且不重置 lastIndex；验证目标：首次成功、第二次失败，复现游标污染。 */
  test('assetUrlRE.test() fails on second call without lastIndex reset', () => {
    const url1 = '__VITE_ASSET__abc123__'
    const url2 = '__VITE_ASSET__def456__'

    // 复现缺陷：连续调用 `.test()`，中间不归零 lastIndex。
    assetUrlRE.lastIndex = 0
    expect(assetUrlRE.test(url1)).toBe(true)
    // 首次成功后游标已经越过当前短字符串。
    expect(assetUrlRE.lastIndex).toBeGreaterThan(0)
    // 第二个字符串同样很短，故从旧游标开始无法匹配。
    expect(assetUrlRE.test(url2)).toBe(false)

    // 清理共享正则状态，避免污染下一用例。
    assetUrlRE.lastIndex = 0
  })

  /** 场景：每次调用 assetUrlRE.test 前都把 lastIndex 归零；验证目标：两个不同占位符连续匹配均成功。 */
  test('assetUrlRE.test() succeeds on consecutive calls with lastIndex reset', () => {
    const url1 = '__VITE_ASSET__abc123__'
    const url2 = '__VITE_ASSET__def456__'

    assetUrlRE.lastIndex = 0
    expect(assetUrlRE.test(url1)).toBe(true)

    // 修复机制：每次 `.test()` 前显式把 lastIndex 归零。
    assetUrlRE.lastIndex = 0
    expect(assetUrlRE.test(url2)).toBe(true)

    // 清理共享正则状态。
    assetUrlRE.lastIndex = 0
  })
})
