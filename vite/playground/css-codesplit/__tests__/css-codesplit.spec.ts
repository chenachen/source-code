import { describe, expect, test } from 'vitest'
import {
  findAssetFile,
  getColor,
  isBuild,
  listAssets,
  page,
  readManifest,
} from '~utils'

/** 场景：静态入口、动态导入、async JS 与共享 chunk 的样式已加载；逐元素核对红/蓝/绿/蓝/品红，覆盖拆分 CSS 的实际页面生效。 */
test('should load all stylesheets', async () => {
  expect(await getColor('h1')).toBe('red')
  expect(await getColor('h2')).toBe('blue')
  expect(await getColor('.dynamic')).toBe('green')
  expect(await getColor('.async-js')).toBe('blue')
  expect(await getColor('.chunk')).toBe('magenta')
})

/** 场景：动态导入 ?inline CSS 返回文本；核对文本含 .inline，但该规则未自动应用为黄色。 */
test('should load dynamic import with inline', async () => {
  const css = await page.textContent('.dynamic-inline')
  expect(css).toMatch('.inline')

  expect(await getColor('.inline')).not.toBe('yellow')
})

/** 场景：动态导入 CSS Module；核对导出文本含 _mod_ 类名且 .mod 元素显示黄色。 */
test('should load dynamic import with module', async () => {
  const css = await page.textContent('.dynamic-module')
  expect(css).toMatch('_mod_')

  expect(await getColor('.mod')).toBe('yellow')
})

/** 场景：JS 插入 style 时初始 .order-bulk 为橙；点击更新按钮后轮询绿色，核对动态插入样式的级联顺序。 */
test('style order should be consistent when style tag is inserted by JS', async () => {
  expect(await getColor('.order-bulk')).toBe('orange')
  await page.click('.order-bulk-update')
  await expect.poll(() => getColor('.order-bulk')).toBe('green')
})

describe.runIf(isBuild)('build', () => {
  /** 场景：仅构建执行：检查 style/async 的纯 CSS JS 被移除、main/other 留空 CSS 标记，assets 中没有 async-js 哈希文件。 */
  test('should remove empty chunk', async () => {
    expect(findAssetFile(/style-.*\.js$/)).toBeUndefined()
    expect(findAssetFile('main.*.js$')).toMatch(`/* empty css`)
    expect(findAssetFile('other.*.js$')).toMatch(`/* empty css`)
    expect(findAssetFile(/async-[-\w]{8}\.js$/)).toBeUndefined()

    const assets = listAssets()
    expect(assets).not.toContainEqual(
      expect.stringMatching(/async-js-[-\w]{8}\.js$/),
    )
  })

  /** 场景：仅构建执行：HTML 无 JS 的共享 CSS 输出保留空 CSS 标记；核对源码中可被摇树移除的函数和普通 import 均不在输出。 */
  test('should remove empty chunk, HTML without JS', async () => {
    const sharedCSSWithJSChunk = findAssetFile('shared-css-with-js.*.js$')
    expect(sharedCSSWithJSChunk).toMatch(`/* empty css`)
    // 原源码中的函数与普通模块引用应被摇树删除。
    expect(sharedCSSWithJSChunk).not.toMatch('function')
    expect(sharedCSSWithJSChunk).not.toMatch(/import(?!\s*".\/modulepreload)/)
  })

  /** 场景：仅构建执行：读取 manifest，核对 index.html 有两项 CSS、other.js 有一项 CSS。 */
  test('should generate correct manifest', async () => {
    const manifest = readManifest()
    expect(manifest['index.html'].css.length).toBe(2)
    expect(manifest['other.js'].css.length).toBe(1)
  })

  /** 场景：仅构建执行：收集全部 manifest CSS 引用并去除 assets/；逐项核对输出目录存在该文件，覆盖相同内容 CSS 去重后引用旧文件名的回归。 */
  test('manifest should not reference a deduplicated css file that does not exist', () => {
    const emitted = new Set(listAssets())
    const referenced = Object.values(readManifest())
      .flatMap((chunk) => chunk.css ?? [])
      .map((file) => file.replace(/^assets\//, ''))
    for (const file of referenced) {
      expect(emitted).toContain(file)
    }
  })

  /** 场景：仅构建执行：同一 CSS 兼作 ?url 与普通导入；核对 chunk JS 仍存在，URL 导出没有因纯 CSS 清理而丢失。 */
  test('should not mark a css chunk with ?url and normal import as pure css chunk', () => {
    expect(findAssetFile(/chunk-.*\.js$/)).toBeTruthy()
  })
})
