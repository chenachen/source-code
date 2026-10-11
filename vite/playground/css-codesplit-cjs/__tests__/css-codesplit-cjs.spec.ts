import { describe, expect, test } from 'vitest'
import { findAssetFile, getColor, isBuild, readManifest } from '~utils'

/** 场景：CommonJS CSS 拆分夹具预期 h1 红、h2 蓝；读取计算颜色进行核对。当前 test.skip，未执行此验证。 */
test.skip('should load both stylesheets', async () => {
  expect(await getColor('h1')).toBe('red')
  expect(await getColor('h2')).toBe('blue')
})

describe.runIf(isBuild).skip('build', () => {
  /** 场景：构建矩阵中的整个 describe 仍为 skip；预期 style JS 被移除，main/other JS 含空 CSS 标记，当前未执行断言。 */
  test('should remove empty chunk', async () => {
    expect(findAssetFile(/style.*\.js$/)).toBeUndefined()
    expect(findAssetFile('main.*.js$')).toMatch(`/* empty css`)
    expect(findAssetFile('other.*.js$')).toMatch(`/* empty css`)
  })

  /** 场景：构建 describe.skip 内读取 manifest，预期 HTML 两项 CSS、other.js 一项 CSS；当前未执行此验证。 */
  test('should generate correct manifest', async () => {
    const manifest = readManifest()
    expect(manifest['index.html'].css.length).toBe(2)
    expect(manifest['other.js'].css.length).toBe(1)
  })
})
