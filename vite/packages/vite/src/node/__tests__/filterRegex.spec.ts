import { describe, expect, test } from 'vitest'
import { assetImportMetaUrlRE } from '../plugins/assetImportMetaUrl'
import { workerImportMetaUrlRE } from '../plugins/workerImportMetaUrl'

describe('filter regexes do not cause catastrophic backtracking', () => {
  const largeCode =
    `new URL('https://example.com');\n`.repeat(200) +
    `var a = 1;\n`.repeat(200_000)

  /** 输入大量缺少 import.meta.url 的 new URL 与普通赋值；重置全局正则后应返回 false，固定易触发回溯的长文本场景，本例没有计时断言。 */
  test('assetImportMetaUrlRE completes without backtracking on large files', () => {
    assetImportMetaUrlRE.lastIndex = 0
    expect(assetImportMetaUrlRE.test(largeCode)).toBe(false)
  })

  /** 同一长文本不含 Worker URL 结构；重置 worker 正则后应返回 false，固定回溯回归输入。 */
  test('workerImportMetaUrlRE completes without backtracking on large files', () => {
    workerImportMetaUrlRE.lastIndex = 0
    expect(workerImportMetaUrlRE.test(largeCode)).toBe(false)
  })

  /** 输入合法资源 new URL 且基准为 import.meta.url；重置正则后应匹配，防止长文本修复缩窄正确语法。 */
  test('assetImportMetaUrlRE still matches valid patterns', () => {
    assetImportMetaUrlRE.lastIndex = 0
    expect(
      assetImportMetaUrlRE.test(`new URL('./asset.png', import.meta.url)`),
    ).toBe(true)
  })

  /** 输入 Worker 包裹的相对 new URL；重置正则后应匹配，核对正常 Worker 结构仍被识别。 */
  test('workerImportMetaUrlRE still matches valid patterns', () => {
    workerImportMetaUrlRE.lastIndex = 0
    expect(
      workerImportMetaUrlRE.test(
        `new Worker(new URL('./worker.js', import.meta.url))`,
      ),
    ).toBe(true)
  })
})
