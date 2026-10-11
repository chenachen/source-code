import { setTimeout } from 'node:timers/promises'
import { expect, test } from 'vitest'
import {
  editFile,
  findAssetFile,
  isBuild,
  notifyRebuildComplete,
  readManifest,
  watcher,
} from '~utils'

/** 仅构建模式先确认样式入口及其 legacy JS 含旧颜色、polyfill 存在且 manifest 有三项；修改 CSS 并等待重建后按新 manifest 文件名读取，验证两份样式内容换色而条目数和 polyfill 保持。 */
test.runIf(isBuild)('rebuilds styles only entry on change', async () => {
  expect(findAssetFile(/style-only-entry-.+\.css/, 'watch')).toContain(
    '#ff69b4',
  )
  expect(findAssetFile(/style-only-entry-legacy-.+\.js/, 'watch')).toContain(
    '#ff69b4',
  )
  expect(findAssetFile(/polyfills-legacy-.+\.js/, 'watch')).toBeTruthy()
  const numberOfManifestEntries = Object.keys(readManifest('watch')).length
  expect(numberOfManifestEntries).toBe(3)

  editFile('style-only-entry.css', (originalContents) =>
    originalContents.replace('#ff69b4', '#ffb6c1 '),
  )
  await notifyRebuildComplete(watcher)
  // 双输出重建可能分两次 END；额外等下一次 END 或 100ms 超时，缓解 rolldown#10613 的时序差异。
  await Promise.race([notifyRebuildComplete(watcher), setTimeout(100)])

  const updatedManifest = readManifest('watch')
  expect(Object.keys(updatedManifest)).toHaveLength(numberOfManifestEntries)

  // 重建会保留不同 hash 的旧文件；用更新后的 manifest 精确选择本轮输出。
  const reRenderedCssFile = findAssetFile(
    updatedManifest['style-only-entry.css']!.file.substring('assets/'.length),
    'watch',
  )
  expect(reRenderedCssFile).toContain('#ffb6c1')
  const reRenderedCssLegacyFile = findAssetFile(
    updatedManifest['style-only-entry-legacy.css']!.file.substring(
      'assets/'.length,
    ),
    'watch',
  )
  expect(reRenderedCssLegacyFile).toContain('#ffb6c1')
  expect(findAssetFile(/polyfills-legacy-.+\.js/, 'watch')).toBeTruthy()
})
