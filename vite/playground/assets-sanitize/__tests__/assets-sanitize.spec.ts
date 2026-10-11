import { expect, test } from 'vitest'
import {
  getBg,
  isBuild,
  isBundled,
  isBundledDev,
  page,
  readManifest,
} from '~utils'

if (isBuild) {
  /** 场景：仅构建分支：+circle.svg 与 _circle.svg 同时导入并用于背景；对照 manifest 与页面，核对二者清理后均以 _circle 开头、哈希区分且清单只有两 SVG 与一个 JS。 */
  test('importing asset with special char in filename works in build', async () => {
    const manifest = readManifest()
    const plusCircleAsset = manifest['+circle.svg'].file
    const underscoreCircleAsset = manifest['_circle.svg'].file
    expect(await getBg('.plus-circle')).toMatch(plusCircleAsset)
    expect(await page.textContent('.plus-circle')).toMatch(plusCircleAsset)
    expect(await getBg('.underscore-circle')).toMatch(underscoreCircleAsset)
    expect(await page.textContent('.underscore-circle')).toMatch(
      underscoreCircleAsset,
    )
    expect(plusCircleAsset).toMatch('/_circle')
    expect(underscoreCircleAsset).toMatch('/_circle')
    expect(plusCircleAsset).not.toEqual(underscoreCircleAsset)
    expect(Object.keys(manifest).length).toBe(3) // 输出两份 SVG 与一个 index.js。
  })
} else if (isBundledDev) {
  // bundled dev 也会清理文件名并加哈希，直接从 DOM 读取 URL。
  /** 场景：仅 bundled dev 分支：读取两个特殊文件名的 URL 与背景；核对均输出清理后的 _circle-哈希.svg、哈希不同并与背景一致。此模式没有磁盘 manifest。 */
  test('importing asset with special char in filename works in bundled dev', async () => {
    const plusCircleAsset = await page.textContent('.plus-circle')
    const underscoreCircleAsset = await page.textContent('.underscore-circle')
    expect(plusCircleAsset).toMatch(/\/assets\/_circle-[-\w]{8}\.svg/)
    expect(underscoreCircleAsset).toMatch(/\/assets\/_circle-[-\w]{8}\.svg/)
    // 两个文件清理后同名，用哈希区分。
    expect(plusCircleAsset).not.toEqual(underscoreCircleAsset)
    expect(await getBg('.plus-circle')).toContain(plusCircleAsset)
    expect(await getBg('.underscore-circle')).toContain(underscoreCircleAsset)
  })
} else {
  /** 场景：普通开发分支：两个 SVG 经 JS 与 CSS 引用；核对 URL 和背景保留各自 +circle.svg/_circle.svg 原文件名。 */
  test('importing asset with special char in filename works in dev', async () => {
    expect(await getBg('.plus-circle')).toContain('+circle.svg')
    expect(await page.textContent('.plus-circle')).toMatch('+circle.svg')
    expect(await getBg('.underscore-circle')).toContain('_circle.svg')
    expect(await page.textContent('.underscore-circle')).toMatch('_circle.svg')
  })
}

// 此分支检查普通开发服务器对项目 .env 的访问限制。
/** 场景：仅 !isBundled 时执行：页面请求 .env 与双斜杠路径；核对普通请求返回 403，而双斜杠路径落入 SPA fallback 返回 200。构建与 bundled dev 跳过此源码访问检查。 */
test.runIf(!isBundled)('denied .env', async () => {
  expect(await page.textContent('.unsafe-dotenv')).toBe('403')
  expect(await page.textContent('.unsafe-dotenv-double-slash')).toBe('200') // SPA 回退
})
