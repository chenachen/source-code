import { describe, expect, test, vi } from 'vitest'
import {
  browserErrors,
  browserLogs,
  editFile,
  getColor,
  getCssRuleBg,
  isBuild,
  isServe,
  listAssets,
  page,
  ports,
  readManifest,
  serverLogs,
  untilBrowserLogAfter,
} from '~utils'

/** 场景：后端集成夹具已加载；遍历浏览器日志，核对没有文本包含 404 的资源请求错误。 */
test('should have no 404s', () => {
  browserLogs.forEach((msg) => {
    expect(msg).not.toMatch('404')
  })
})

describe('asset imports from js', () => {
  /** 场景：JS 导入 root 外 logo，先等待图片 naturalWidth>0；构建核对 /dev/assets 哈希 URL，开发核对 server.origin + /dev/@fs/ 绝对路径。 */
  test('file outside root', async () => {
    // 等待图片实际解码，参见 https://github.com/microsoft/playwright/issues/6046#issuecomment-1799585719
    await vi.waitUntil(() =>
      page
        .locator('.asset-reference.outside-root .asset-preview')
        .evaluate((el: HTMLImageElement) => el.naturalWidth > 0),
    )

    const text = await page.textContent(
      '.asset-reference.outside-root .asset-url',
    )
    if (isBuild) {
      expect(text).toMatch(/\/dev\/assets\/logo-[-\w]{8}\.png/)
    } else {
      // 开发资产 URL 以前端配置的 server.origin 开头。
      expect(text).toMatch(
        `http://localhost:${ports['backend-integration']}/dev/@fs/`,
      )
      expect(text).toMatch(/\/dev\/@fs\/.+?\/images\/logo\.png/)
    }
  })
})

describe.runIf(isBuild)('build', () => {
  /** 场景：仅构建执行：读取 dev 输出清单；核对 HTML 的 CSS/资产数量、JS 的 url CSS 资产、CSS 独立入口标记、root 外键与自定义 entry 名及图片/SVG产物。 */
  test('manifest', async () => {
    const manifest = readManifest('dev')
    const htmlEntry = manifest['index.html']
    const mainTsEntry = manifest['main.ts']
    const cssAssetEntry = manifest['global.css']
    const pcssAssetEntry = manifest['foo.pcss']
    const scssAssetEntry = manifest['nested/blue.scss']
    const imgAssetEntry = manifest['../images/logo.png']
    const dirFooAssetEntry = manifest['../../dir/foo.css']
    const customNameAssetEntry = manifest['../../dir/custom.css']
    const iconEntrypointEntry = manifest['icon.png']
    const waterContainerEntry = manifest['water-container.svg']
    expect(htmlEntry.css.length).toEqual(1)
    expect(htmlEntry.assets.length).toEqual(1)
    expect(mainTsEntry.assets?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(mainTsEntry.assets).toContainEqual(
      expect.stringMatching(/assets\/url-[-\w]{8}\.css/),
    )
    expect(cssAssetEntry?.file).not.toBeUndefined()
    expect(cssAssetEntry?.isEntry).toEqual(true)
    expect(pcssAssetEntry?.file).not.toBeUndefined()
    expect(pcssAssetEntry?.isEntry).toEqual(true)
    expect(scssAssetEntry?.file).not.toBeUndefined()
    expect(scssAssetEntry?.src).toEqual('nested/blue.scss')
    expect(scssAssetEntry?.isEntry).toEqual(true)
    expect(imgAssetEntry?.file).not.toBeUndefined()
    expect(imgAssetEntry?.isEntry).toBeUndefined()
    expect(dirFooAssetEntry).not.toBeUndefined() // Windows 下清单键也使用正斜杠，不使用反斜杠。
    // 产物使用配置中的 entry 名称。
    expect(dirFooAssetEntry.file).toMatch('assets/bar-')
    expect(dirFooAssetEntry.name).toStrictEqual('bar.css')
    expect(dirFooAssetEntry.assets.length).toEqual(1)
    expect(customNameAssetEntry.name).toStrictEqual('bar.custom')
    expect(iconEntrypointEntry?.file).not.toBeUndefined()
    expect(waterContainerEntry?.file).not.toBeUndefined()
  })

  /** 场景：仅构建执行：读取 nested/sub.ts 的 manifest CSS 列表；核对只有一项且去除 assets/ 后文件名没有目录层级。 */
  test('CSS imported from JS entry should have a non-nested chunk name', () => {
    const manifest = readManifest('dev')
    const mainTsEntryCss = manifest['nested/sub.ts'].css
    expect(mainTsEntryCss.length).toBe(1)
    expect(mainTsEntryCss[0].replace('assets/', '')).not.toContain('/')
  })

  /** 场景：仅构建执行：检查 serverLogs 与输出列表；核对 icon.png 入口没有生成空 chunk 警告或 icon.png-哈希.js。 */
  test('entrypoint assets should not generate empty JS file', () => {
    expect(serverLogs).not.toContainEqual(
      'Generated an empty chunk: "icon.png".',
    )

    const assets = listAssets('dev')
    expect(assets).not.toContainEqual(
      expect.stringMatching(/icon.png-[-\w]{8}\.js$/),
    )
  })
})

describe.runIf(isServe)('serve', () => {
  /** 场景：仅开发执行：遍历浏览器错误，核对后端集成入口加载后没有 ReferenceError。 */
  test('No ReferenceError', async () => {
    browserErrors.forEach((error) => {
      expect(error.name).not.toBe('ReferenceError')
    })
  })

  /** 场景：仅开发执行：body 初始黑色，将入口 CSS 改红并等待更新；核对最新 stylesheet href 仍含 /dev/global.css?t=，base 在更新请求中保留。 */
  test('preserve the base in CSS HMR', async () => {
    await expect.poll(() => getColor('body')).toBe('black') // 确认编辑前的颜色。
    editFile('frontend/entrypoints/global.css', (code) =>
      code.replace('black', 'red'),
    )
    await expect.poll(() => getColor('body')).toBe('red') // 确认 HMR 已应用新颜色。

    // CSS 更新请求的 URL 仍带 /dev/ base。
    const link = await page.$('link[rel="stylesheet"]:last-of-type')
    expect(await link.getAttribute('href')).toContain('/dev/global.css?t=')
  })

  /** 场景：仅开发执行：读取别名 root 外资产的 CSS 规则背景；核对非 public URL 带 server.origin 与 /dev/ 前缀。 */
  test('server.origin is applied to non-public CSS url()', async () => {
    const bg = await getCssRuleBg('.outside-root--aliased')
    expect(bg).toContain(
      `http://localhost:${ports['backend-integration']}/dev/`,
    )
  })

  /** 场景：仅开发执行：读取 public 资产背景规则；核对 URL 为 server.origin + /dev/icon.png。 */
  test('server.origin is applied to public CSS url()', async () => {
    const bg = await getCssRuleBg('.public-asset')
    expect(bg).toContain(
      `http://localhost:${ports['backend-integration']}/dev/icon.png`,
    )
  })

  /** 场景：仅开发执行：把 main.ts 的 text-black 改为指定 RGB class，等待 global.css 的 hot-update 日志；核对 h1 颜色为 rgb(204,0,0)。 */
  test('CSS dependencies are tracked for HMR', async () => {
    const el = await page.$('h1')
    await untilBrowserLogAfter(
      () =>
        editFile('frontend/entrypoints/main.ts', (code) =>
          code.replace('text-black', 'text-[rgb(204,0,0)]'),
        ),
      '[vite] css hot updated: /global.css',
    )
    await expect.poll(() => getColor(el)).toBe('rgb(204, 0, 0)')
  })
})
