import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  browserLogs,
  editFile,
  findAssetFile,
  getBg,
  getColor,
  isBuild,
  isBundled,
  isBundledDev,
  isServe,
  listAssets,
  notifyRebuildComplete,
  page,
  readFile,
  readManifest,
  serverLogs,
  viteTestUrl,
  watcher,
} from '~utils'

/**
 * Asset 集成用例矩阵。
 *
 * 场景横跨 JS 导入、HTML/CSS URL、public、查询参数、内联阈值、SVG 片段与
 * `new URL(..., import.meta.url)`；同一断言会在 dev、bundled-dev 和 build 下
 * 运行，以确认它们虽然产物形态不同，但浏览器最终观察到的 URL 与内容一致。
 */
const assetMatch = isBundled
  ? /\/foo\/bar\/assets\/asset-[-\w]{8}\.png/
  : '/foo/bar/nested/asset.png'

/** 含方括号文件名在 build 中编码/哈希后的 URL，开发态则保留源路径。 */
const encodedAssetMatch = isBundled
  ? /\/foo\/bar\/assets\/asset_small_-[-\w]{8}\.png/
  : '/foo/bar/nested/asset[small].png'

/** publicDir 图标经 base 拼接后的稳定公开 URL。 */
const iconMatch = `/foo/bar/icon.png`

/** 以 HTML 导航 Accept 请求 base 内路径，供状态码与 fallback 用例复用。 */
const fetchPath = (p: string) => {
  return fetch(path.posix.join(viteTestUrl, p), {
    headers: { Accept: 'text/html,*/*' },
  })
}

// bundled-dev 会把 `?url` CSS 导入变成 data URI，并跳过 CSS 流水线；其中的
// `url()` 因而保留失效的原相对路径并产生 404（#22863）。缺陷修复后该用例无需
// 改断言即可恢复，所以这里只针对 bundled-dev 临时跳过。
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “msg”。
 * 验证目标：“msg” 不应匹配 “'404'”，从而确认静态命中、SPA fallback 与 MIME 分支按 Accept/路径语义工作。
 */
test.skipIf(isBundledDev)('should have no 404s', () => {
  browserLogs.forEach((msg) => {
    expect(msg).not.toMatch('404')
  })
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “serverLogs”。
 * 验证目标：“serverLogs” 应严格深度等于 “expect.not.arrayContaining([ expect.stringMatching(/VITE_ASSET__.*?didn't resolve at build time/), ])”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
 */
test.runIf(isBuild)(
  'should not warn about VITE_ASSET tokens in image-set',
  async () => {
    expect(serverLogs).toStrictEqual(
      expect.not.arrayContaining([
        expect.stringMatching(/VITE_ASSET__.*?didn't resolve at build time/),
      ]),
    )
  },
)

/**
 * 场景：在当前 playground 中，请求 “fetchPath('icon.png')”，然后请求 “fetchPath('ICON.png')”。
 * 验证目标：“(await fetchPath('icon.png')).headers.get('Content-Type')” 应等于 “'image/png'”；“iconPngResult.headers.get('Content-Type')” 应等于 “'text/html'”，从而确认静态命中、SPA fallback 与 MIME 分支按 Accept/路径语义工作。
 */
test('should get a 404 when using incorrect case', async () => {
  expect((await fetchPath('icon.png')).headers.get('Content-Type')).toBe(
    'image/png',
  )
  // 大小写不匹配时静态文件未命中，HTML 导航请求回退到 index.html。
  const iconPngResult = await fetchPath('ICON.png')
  expect(iconPngResult.headers.get('Content-Type')).toBe('text/html')
  expect(iconPngResult.status).toBe(200)

  expect((await fetchPath('bar')).headers.get('Content-Type')).toBe('')
  // 无扩展路径同样遵循 SPA fallback。
  const barResult = await fetchPath('BAR')
  expect(barResult.headers.get('Content-Type')).toContain('text/html')
  expect(barResult.status).toBe(200)
})

/**
 * 场景：在当前 playground 中，请求 “fetchPath('doesnt-exist.html')”。
 * 验证目标：“(await fetchPath('doesnt-exist.html')).status” 应等于 “200”，从而确认静态命中、SPA fallback 与 MIME 分支按 Accept/路径语义工作。
 */
test('should fallback to index.html when accessing non-existent html file', async () => {
  expect((await fetchPath('doesnt-exist.html')).status).toBe(200)
})

describe.runIf(isServe)('outside base', () => {
  /**
   * 场景：在 “'outside base'” 中，请求 “fetch(new URL('/baz', viteTestUrl), { headers: { Accept: 'text/html,* /*' }, })”。
   * 验证目标：“res.status” 应等于 “404”；“res.headers.get('Content-Type')” 应等于 “'text/html'”，从而确认静态命中、SPA fallback 与 MIME 分支按 Accept/路径语义工作。
   */
  test('should get a 404 with html', async () => {
    const res = await fetch(new URL('/baz', viteTestUrl), {
      headers: { Accept: 'text/html,*/*' },
    })
    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toBe('text/html')
  })

  /**
   * 场景：在 “'outside base'” 中，请求 “fetch(new URL('/baz', viteTestUrl))”。
   * 验证目标：“res.status” 应等于 “404”；“res.headers.get('Content-Type')” 应等于 “'text/plain'”，从而确认静态命中、SPA fallback 与 MIME 分支按 Accept/路径语义工作。
   */
  test('should get a 404 with text', async () => {
    const res = await fetch(new URL('/baz', viteTestUrl))
    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toBe('text/plain')
  })
})

describe('injected scripts', () => {
  /**
   * 场景：在 “'injected scripts'” 中，加载用例 fixture 并观察 “hasClient”。
   * 验证目标：“hasClient” 应为假；“hasClient” 应为真，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('@vite/client', async () => {
    const hasClient = await page.$(
      'script[type="module"][src="/foo/bar/@vite/client"]',
    )
    if (isBundled) {
      expect(hasClient).toBeFalsy()
    } else {
      expect(hasClient).toBeTruthy()
    }
  })

  /**
   * 场景：在 “'injected scripts'” 中，加载用例 fixture 并观察 “hasHtmlProxy”。
   * 验证目标：“hasHtmlProxy” 应为假；“hasHtmlProxy” 应为真，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('html-proxy', async () => {
    const hasHtmlProxy = await page.$(
      'script[type="module"][src^="/foo/bar/index.html?html-proxy"]',
    )
    if (isBundled) {
      expect(hasHtmlProxy).toBeFalsy()
    } else {
      expect(hasHtmlProxy).toBeTruthy()
    }
  })
})

describe('raw references from /public', () => {
  /**
   * 场景：在 “'raw references from /public'” 中，加载用例 fixture 并观察 “await page.textContent('.raw-js')”。
   * 验证目标：“await page.textContent('.raw-js')” 应匹配 “'[success]'”，从而确认publicDir 资源绕过转换后仍保留正确 base 和内容。
   */
  test('load raw js from /public', async () => {
    expect(await page.textContent('.raw-js')).toMatch('[success]')
  })

  /**
   * 场景：在 “'raw references from /public'” 中，加载用例 fixture 并观察 “await getColor('.raw-css')”。
   * 验证目标：“await getColor('.raw-css')” 应等于 “'red'”，从而确认publicDir 资源绕过转换后仍保留正确 base 和内容。
   */
  test('load raw css from /public', async () => {
    expect(await getColor('.raw-css')).toBe('red')
  })
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.import-expression')”。
 * 验证目标：“await page.textContent('.import-expression')” 应匹配 “'[success][success]'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
 */
test('import-expression from simple script', async () => {
  expect(await page.textContent('.import-expression')).toMatch(
    '[success][success]',
  )
})

describe('asset imports from js', () => {
  // 验证相对、根绝对与 public 资产最终都导出浏览器可访问的 URL。
  /**
   * 场景：在 “'asset imports from js'” 中，加载用例 fixture 并观察 “await page.textContent('.asset-import-relative')”。
   * 验证目标：“await page.textContent('.asset-import-relative')” 应匹配 “assetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('relative', async () => {
    expect(await page.textContent('.asset-import-relative')).toMatch(assetMatch)
  })

  /**
   * 场景：在 “'asset imports from js'” 中，加载用例 fixture 并观察 “await page.textContent('.asset-import-absolute')”。
   * 验证目标：“await page.textContent('.asset-import-absolute')” 应匹配 “assetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('absolute', async () => {
    expect(await page.textContent('.asset-import-absolute')).toMatch(assetMatch)
  })

  /**
   * 场景：在 “'asset imports from js'” 中，加载用例 fixture 并观察 “await page.textContent('.public-import')”。
   * 验证目标：“await page.textContent('.public-import')” 应匹配 “iconMatch”，从而确认publicDir 资源绕过转换后仍保留正确 base 和内容。
   */
  test('from /public', async () => {
    expect(await page.textContent('.public-import')).toMatch(iconMatch)
  })

  /**
   * 场景：在 “'asset imports from js'” 中，加载用例 fixture 并观察 “await page.textContent('.public-json-import')”。
   * 验证目标：导出 URL 必须为 `/foo/bar/foo.json`，fetch 到的原文仍是包含 `"foo": "bar"` 的格式化 JSON，确认 publicDir JSON 未经过模块转换。
   */
  test('from /public (json)', async () => {
    expect(await page.textContent('.public-json-import')).toMatch(
      '/foo/bar/foo.json',
    )
    expect(await page.textContent('.public-json-import-content'))
      .toMatchInlineSnapshot(`
        "{
          "foo": "bar"
        }
        "
      `)
  })

  /**
   * 场景：在 “'asset imports from js'” 中，加载用例 fixture 并观察 “await page.textContent('.public-js-import')”。
   * 验证目标：导出 URL 为 `/foo/bar/raw.js`，响应保留给 `.raw-js` 写入 success 文本的原始脚本且 MIME 为 `text/javascript`，确认 public JS 原样服务。
   */
  test('from /public (js)', async () => {
    expect(await page.textContent('.public-js-import')).toMatch(
      '/foo/bar/raw.js',
    )
    expect(await page.textContent('.public-js-import-content'))
      .toMatchInlineSnapshot(`
        "document.querySelector('.raw-js').textContent =
          '[success] Raw js from /public loaded'
        "
      `)
    expect(await page.textContent('.public-js-import-content-type')).toMatch(
      'text/javascript',
    )
  })

  /**
   * 场景：在 “'asset imports from js'” 中，加载用例 fixture 并观察 “await page.textContent('.public-ts-import')”。
   * 验证目标：导出 URL 为 `/foo/bar/raw.ts`，响应仍含返回 `1 + 2` 的 TypeScript 原文；dev 还应使用 JavaScript MIME，确认 public TS 未被编译。
   */
  test('from /public (ts)', async () => {
    expect(await page.textContent('.public-ts-import')).toMatch(
      '/foo/bar/raw.ts',
    )
    expect(await page.textContent('.public-ts-import-content'))
      .toMatchInlineSnapshot(`
      "export default function other() {
        return 1 + 2
      }
      "
    `)
    // preview server 使用者应自行配置 `.ts` 文件的 MIME 类型。
    if (isServe) {
      expect(await page.textContent('.public-ts-import-content-type')).toMatch(
        'text/javascript',
      )
    }
  })

  /**
   * 场景：在 “'asset imports from js'” 中，加载用例 fixture 并观察 “await page.textContent('.public-mts-import')”。
   * 验证目标：导出 URL 为 `/foo/bar/raw.mts`，响应仍含 `foobar` 与 `1 + 2` 的原文；dev 使用 JavaScript MIME，确认 `.mts` 也按 public 原样提供。
   */
  test('from /public (mts)', async () => {
    expect(await page.textContent('.public-mts-import')).toMatch(
      '/foo/bar/raw.mts',
    )
    expect(await page.textContent('.public-mts-import-content'))
      .toMatchInlineSnapshot(`
      "export default function foobar() {
        return 1 + 2
      }
      "
    `)
    // preview server 使用者应自行配置 `.ts` 文件的 MIME 类型。
    if (isServe) {
      expect(await page.textContent('.public-mts-import-content-type')).toMatch(
        'text/javascript',
      )
    }
  })
})

describe('css url() references', () => {
  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “await page.evaluate(() => { return (document as any).fonts.check('700 32px Inter') })”。
   * 验证目标：“await page.evaluate(() => { return (document as any).fonts.check('700 32px Inter') })” 应等于 “true”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('fonts', async () => {
    expect(
      await page.evaluate(() => {
        return (document as any).fonts.check('700 32px Inter')
      }),
    ).toBe(true)
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “await getBg('.css-url-relative')”。
   * 验证目标：“await getBg('.css-url-relative')” 应匹配 “assetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('relative', async () => {
    expect(await getBg('.css-url-relative')).toMatch(assetMatch)
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “await getBg('.css-url-encoded')”。
   * 验证目标：“await getBg('.css-url-encoded')” 应匹配 “encodedAssetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('encoded', async () => {
    expect(await getBg('.css-url-encoded')).toMatch(encodedAssetMatch)
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “s”。
   * 验证目标：“s” 应匹配 “assetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('image-set relative', async () => {
    const imageSet = await getBg('.css-image-set-relative')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(assetMatch)
    })
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “s”。
   * 验证目标：“s” 应匹配 “assetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('image-set without the url() call', async () => {
    const imageSet = await getBg('.css-image-set-without-url-call')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(assetMatch)
    })
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “s”。
   * 验证目标：“s” 应匹配 “assetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('image-set with var', async () => {
    const imageSet = await getBg('.css-image-set-with-var')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(assetMatch)
    })
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “s”。
   * 验证目标：“s” 应匹配 “assetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('image-set with mix', async () => {
    const imageSet = await getBg('.css-image-set-mix-url-var')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(assetMatch)
    })
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “imageSet”。
   * 验证目标：“imageSet” 应包含 “'image-set(url("data:image/png;base64,'”，从而确认资源内联阈值与 data URI 编码分支正确。
   */
  test('image-set with base64', async () => {
    const imageSet = await getBg('.css-image-set-base64')
    expect(imageSet).toContain('image-set(url("data:image/png;base64,')
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “imageSet”。
   * 验证目标：“imageSet” 应包含 “'image-set(url("data:image/png;base64,'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('image-set with gradient', async () => {
    const imageSet = await getBg('.css-image-set-gradient')
    expect(imageSet).toContain('image-set(url("data:image/png;base64,')
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “s”。
   * 验证目标：“s” 应匹配 “assetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('image-set with multiple descriptor', async () => {
    const imageSet = await getBg('.css-image-set-multiple-descriptor')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(assetMatch)
    })
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “s”。
   * 验证目标：“s” 应匹配 “assetMatch”，从而确认资源内联阈值与 data URI 编码分支正确。
   */
  test('image-set with multiple descriptor as inline style', async () => {
    const imageSet = await getBg(
      '.css-image-set-multiple-descriptor-inline-style',
    )
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(assetMatch)
    })
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “imageSet”。
   * 验证目标：“imageSet” 应匹配 “assetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('image-set and url exist at the same time.', async () => {
    const imageSet = await getBg('.image-set-and-url-exsiting-at-same-time')
    expect(imageSet).toMatch(assetMatch)
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “await getBg('.css-url-relative-at-imported')”。
   * 验证目标：“await getBg('.css-url-relative-at-imported')” 应匹配 “assetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('relative in @import', async () => {
    expect(await getBg('.css-url-relative-at-imported')).toMatch(assetMatch)
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “await getBg('.css-url-absolute')”。
   * 验证目标：“await getBg('.css-url-absolute')” 应匹配 “assetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('absolute', async () => {
    expect(await getBg('.css-url-absolute')).toMatch(assetMatch)
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “await getBg('.css-url-public')”。
   * 验证目标：“await getBg('.css-url-public')” 应匹配 “iconMatch”，从而确认publicDir 资源绕过转换后仍保留正确 base 和内容。
   */
  test('from /public', async () => {
    expect(await getBg('.css-url-public')).toMatch(iconMatch)
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “await getBg('.css-url-base64-inline')”。
   * 验证目标：“await getBg('.css-url-base64-inline')” 应匹配 “match”；“await getBg('.css-url-quotes-base64-inline')” 应匹配 “match”，从而确认资源内联阈值与 data URI 编码分支正确。
   */
  test('base64 inline', async () => {
    const match = isBundled
      ? `data:image/png;base64`
      : `/foo/bar/nested/icon.png`
    expect(await getBg('.css-url-base64-inline')).toMatch(match)
    expect(await getBg('.css-url-quotes-base64-inline')).toMatch(match)
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “href”。
   * 验证目标：“href” 应匹配 “isBundled ? /\/foo\/bar\/assets\/favicon-[-\w]{8}\.ico/ : 'favicon.ico'”；“manifestHref” 应匹配 “isBundled ? /\/foo\/bar\/assets\/manifest-[-\w]{8}\.json/ : 'manifest.json'”，从而确认资源内联阈值与 data URI 编码分支正确。
   */
  test('no base64 inline for icon and manifest links', async () => {
    const iconEl = await page.$(`link.ico`)
    const href = await iconEl.getAttribute('href')
    expect(href).toMatch(
      isBundled ? /\/foo\/bar\/assets\/favicon-[-\w]{8}\.ico/ : 'favicon.ico',
    )

    const manifestEl = await page.$(`link[rel="manifest"]`)
    const manifestHref = await manifestEl.getAttribute('href')
    expect(manifestHref).toMatch(
      isBundled
        ? /\/foo\/bar\/assets\/manifest-[-\w]{8}\.json/
        : 'manifest.json',
    )
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “bg”。
   * 验证目标：“bg” 应匹配 “assetMatch”；“bg” 应匹配 “iconMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('multiple urls on the same line', async () => {
    const bg = await getBg('.css-url-same-line')
    expect(bg).toMatch(assetMatch)
    expect(bg).toMatch(iconMatch)
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “bg”。
   * 验证目标：“bg” 应匹配 “assetMatch”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('aliased', async () => {
    const bg = await getBg('.css-url-aliased')
    expect(bg).toMatch(assetMatch)
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “await getBg('.css-url-preinlined-svg')”。
   * 验证目标：“await getBg('.css-url-preinlined-svg')” 应匹配 “/data:image\/svg\+xml,.+/”，从而确认资源内联阈值与 data URI 编码分支正确。
   */
  test('preinlined SVG', async () => {
    expect(await getBg('.css-url-preinlined-svg')).toMatch(
      /data:image\/svg\+xml,.+/,
    )
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “css”。
   * 验证目标：“css” 应匹配 “'woff2?#iefix'”；“css” 不应匹配 “'../icon.png'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test.runIf(isBuild)('generated paths in CSS', () => {
    const css = findAssetFile(/index-[-\w]{8}\.css$/, 'foo')

    // 资产改写后仍须保留原查询串与 hash 后缀。
    expect(css).toMatch(`woff2?#iefix`)

    // CSS 中的 public 路径应使用非相对 base。
    expect(css).not.toMatch(`../icon.png`)
  })

  /**
   * 场景：在 “'css url() references'” 中，修改 “editFile('nested/fragment-bg-hmr.svg', (code) => code.replace('fill="blue"', 'fill="red"'), )”。
   * 验证目标：“bg” 应匹配 “/data:image\/svg\+xml,.+/”；“bg” 应包含 “'blue'”，从而确认SVG 编码、fragment 与 query/hash 后缀在 URL 重写中不丢失。
   */
  test('url() with svg', async () => {
    const bg = await getBg('.css-url-svg')
    expect(bg).toMatch(/data:image\/svg\+xml,.+/)
    expect(bg).toContain('blue')
    expect(bg).not.toContain('red')

    if (isServe) {
      editFile('nested/fragment-bg-hmr.svg', (code) =>
        code.replace('fill="blue"', 'fill="red"'),
      )
      await expect.poll(() => getBg('.css-url-svg')).toMatch('red')
    }
  })

  /**
   * 场景：在 “'css url() references'” 中，加载用例 fixture 并观察 “await getBg('.css-image-set-svg')”。
   * 验证目标：“await getBg('.css-image-set-svg')” 应匹配 “/data:image\/svg\+xml,.+/”，从而确认SVG 编码、fragment 与 query/hash 后缀在 URL 重写中不丢失。
   */
  test('image-set() with svg', async () => {
    expect(await getBg('.css-image-set-svg')).toMatch(/data:image\/svg\+xml,.+/)
  })

  // bundled-dev 把 `?url` CSS 变成 data URI，而 build 始终输出 CSS 文件；
  // 因此 CSS 内的 SVG 从未进入处理流水线，既不会内联，也不会添加 base。
  // 根因同下方 `?url import on css`：`?url` 导入跳过 CSS 流水线（#22863）。
  /**
   * 场景：在 “'css url() references'” 中，修改 “editFile('nested/fragment-bg-hmr2.svg', (code) => code.replace('fill="blue"', 'fill="red"'), )”。
   * 验证目标：“bg” 应匹配 “/data:image\/svg\+xml,.+/”；“bg” 应包含 “'blue'”，从而确认SVG 编码、fragment 与 query/hash 后缀在 URL 重写中不丢失。
   */
  test.skipIf(isBundledDev)('url() with svg in .css?url', async () => {
    const bg = await getBg('.css-url-svg-in-url')
    expect(bg).toMatch(/data:image\/svg\+xml,.+/)
    expect(bg).toContain('blue')
    expect(bg).not.toContain('red')

    if (isServe) {
      editFile('nested/fragment-bg-hmr2.svg', (code) =>
        code.replace('fill="blue"', 'fill="red"'),
      )
      await expect.poll(() => getBg('.css-url-svg')).toMatch('red')
    }
  })

  /**
   * 场景：在 “'css url() references'” 中，修改 “editFile('nested/donuts-large.svg', (code) => code.replace('fill="blue"', 'fill="red"'), )”。
   * 验证目标：“getBg('.css-url-non-inline-hmr')” 不应等于 “bg”，从而确认资源内联阈值与 data URI 编码分支正确。
   */
  test.runIf(isServe)('non inlined url() HMR', async () => {
    const bg = await getBg('.css-url-non-inline-hmr')
    editFile('nested/donuts-large.svg', (code) =>
      code.replace('fill="blue"', 'fill="red"'),
    )
    await expect.poll(() => getBg('.css-url-non-inline-hmr')).not.toBe(bg)
  })
})

describe('image', () => {
  /**
   * 场景：在 “'image'” 中，加载用例 fixture 并观察 “src”。
   * 验证目标：“src” 应匹配 “isBundled ? /\/foo\/bar\/assets\/html-only-asset-[-\w]{8}\.jpg/ : /\/foo\/bar\/nested\/html-only-asset.j…”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('src', async () => {
    const img = await page.$('.img-src')
    const src = await img.getAttribute('src')
    expect(src).toMatch(
      isBundled
        ? /\/foo\/bar\/assets\/html-only-asset-[-\w]{8}\.jpg/
        : /\/foo\/bar\/nested\/html-only-asset.jpg/,
    )
  })

  /**
   * 场景：在 “'image'” 中，加载用例 fixture 并观察 “src”。
   * 验证目标：“src” 应匹配 “isBundled ? /^data:image\/svg\+xml,%3csvg/ : /\/foo\/bar\/nested\/inlined.svg/”，从而确认资源内联阈值与 data URI 编码分支正确。
   */
  test('src inline', async () => {
    const img = await page.$('.img-src-inline')
    const src = await img.getAttribute('src')
    expect(src).toMatch(
      isBundled
        ? /^data:image\/svg\+xml,%3csvg/
        : /\/foo\/bar\/nested\/inlined.svg/,
    )
  })

  /**
   * 场景：在 “'image'” 中，加载用例 fixture 并观察 “s”。
   * 验证目标：“s” 应匹配 “isBundled ? /\/foo\/bar\/assets\/asset-[-\w]{8}\.png \dx/ : /\/foo\/bar\/nested\/asset.png \dx/”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('srcset', async () => {
    const img = await page.$('.img-src-set')
    const srcset = await img.getAttribute('srcset')
    srcset.split(', ').forEach((s) => {
      expect(s).toMatch(
        isBundled
          ? /\/foo\/bar\/assets\/asset-[-\w]{8}\.png \dx/
          : /\/foo\/bar\/nested\/asset.png \dx/,
      )
    })
  })

  /**
   * 场景：在 “'image'” 中，加载用例 fixture 并观察 “s”。
   * 验证目标：“s” 应匹配 “/\/foo\/bar\/icon\.png \dx/”，从而确认publicDir 资源绕过转换后仍保留正确 base 和内容。
   */
  test('srcset (public)', async () => {
    const img = await page.$('.img-src-set-public')
    const srcset = await img.getAttribute('srcset')
    srcset.split(', ').forEach((s) => {
      expect(s).toMatch(/\/foo\/bar\/icon\.png \dx/)
    })
  })

  /**
   * 场景：在 “'image'” 中，加载用例 fixture 并观察 “srcs[1]”。
   * 验证目标：“srcs[1]” 应匹配 “isBundled ? /\/foo\/bar\/assets\/asset-[-\w]{8}\.png \dx/ : /\/foo\/bar\/nested\/asset.png \dx/”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('srcset (mixed)', async () => {
    const img = await page.$('.img-src-set-mixed')
    const srcset = await img.getAttribute('srcset')
    const srcs = srcset.split(', ')
    expect(srcs[1]).toMatch(
      isBundled
        ? /\/foo\/bar\/assets\/asset-[-\w]{8}\.png \dx/
        : /\/foo\/bar\/nested\/asset.png \dx/,
    )
  })
})

describe('meta', () => {
  /**
   * 场景：在 “'meta'” 中，加载用例 fixture 并观察 “content”。
   * 验证目标：“content” 应匹配 “isBundled ? /\/foo\/bar\/assets\/asset-\w{8}\.png/ : /\/foo\/bar\/nested\/asset.png/”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('og image', async () => {
    const meta = await page.$('.meta-og-image')
    const content = await meta.getAttribute('content')
    expect(content).toMatch(
      isBundled
        ? /\/foo\/bar\/assets\/asset-\w{8}\.png/
        : /\/foo\/bar\/nested\/asset.png/,
    )
  })
})

describe('svg fragments', () => {
  // 404 已由总用例检查，这里只确认 URL 尾部保留 #fragment；bundled-dev 当前会
  // 从哈希资产 URL 丢失该后缀（#23028）。
  /**
   * 场景：在 “'svg fragments'” 中，加载用例 fixture 并观察 “await img.getAttribute('src')”。
   * 验证目标：“await img.getAttribute('src')” 应匹配 “/svg#icon-clock-view$/”，从而确认SVG 编码、fragment 与 query/hash 后缀在 URL 重写中不丢失。
   */
  test.skipIf(isBundledDev)('img url', async () => {
    const img = await page.$('.svg-frag-img')
    expect(await img.getAttribute('src')).toMatch(/svg#icon-clock-view$/)
  })

  // bundled-dev：#fragment 丢失，原因同 `img url`。
  /**
   * 场景：在 “'svg fragments'” 中，加载用例 fixture 并观察 “await getBg('.icon')”。
   * 验证目标：“await getBg('.icon')” 应匹配 “/svg#icon-clock-view"\)$/”，从而确认SVG 编码、fragment 与 query/hash 后缀在 URL 重写中不丢失。
   */
  test.skipIf(isBundledDev)('via css url()', async () => {
    expect(await getBg('.icon')).toMatch(/svg#icon-clock-view"\)$/)
  })

  /**
   * 场景：在 “'svg fragments'” 中，加载用例 fixture 并观察 “await img.getAttribute('src')”。
   * 验证目标：“await img.getAttribute('src')” 应匹配 “/^data:image\/svg\+xml,%3c.*%3e#icon-heart-view$/”，从而确认SVG 编码、fragment 与 query/hash 后缀在 URL 重写中不丢失。
   */
  test('from js import', async () => {
    const img = await page.$('.svg-frag-import')
    expect(await img.getAttribute('src')).toMatch(
      // 同时验证 SVG data URI 已裁去外围空白：编码内容以 `<` 开始、以 `>` 结束。
      /^data:image\/svg\+xml,%3c.*%3e#icon-heart-view$/,
    )
  })

  // bundled-dev：#fragment 丢失，原因同 `img url`。
  /**
   * 场景：在 “'svg fragments'” 中，加载用例 fixture 并观察 “await getBg('.icon-clock-alias')”。
   * 验证目标：“await getBg('.icon-clock-alias')” 应匹配 “/\.svg#icon-clock-view"\)$/”，从而确认SVG 编码、fragment 与 query/hash 后缀在 URL 重写中不丢失。
   */
  test.skipIf(isBundledDev)('url with an alias', async () => {
    expect(await getBg('.icon-clock-alias')).toMatch(
      /\.svg#icon-clock-view"\)$/,
    )
  })
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.unknown-ext')”。
 * 验证目标：“await page.textContent('.unknown-ext')” 应匹配 “isBundled ? 'data:application/octet-stream;' : '/nested/foo.unknown'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
 */
test('Unknown extension assets import', async () => {
  expect(await page.textContent('.unknown-ext')).toMatch(
    isBundled ? 'data:application/octet-stream;' : '/nested/foo.unknown',
  )
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.unknown-ext-inline')”。
 * 验证目标：“await page.textContent('.unknown-ext-inline')” 应匹配 “'data:application/octet-stream;'”，从而确认资源内联阈值与 data URI 编码分支正确。
 */
test('Unknown extension assets import with ?inline', async () => {
  expect(await page.textContent('.unknown-ext-inline')).toMatch(
    'data:application/octet-stream;',
  )
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.relative-path-assets-include')”。
 * 验证目标：“await page.textContent('.relative-path-assets-include')” 应匹配 “isBundled ? 'data:application/octet-stream;' : '/nested/relative-path.custom'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
 */
test('Asset matched by a relative path in assetsInclude import', async () => {
  expect(await page.textContent('.relative-path-assets-include')).toMatch(
    isBundled
      ? 'data:application/octet-stream;'
      : '/nested/relative-path.custom',
  )
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.relative-path-assets-include-inline')”。
 * 验证目标：“await page.textContent('.relative-path-assets-include-inline')” 应匹配 “'data:application/octet-stream;'”，从而确认资源内联阈值与 data URI 编码分支正确。
 */
test('Asset matched by a relative path in assetsInclude import with ?inline', async () => {
  expect(
    await page.textContent('.relative-path-assets-include-inline'),
  ).toMatch('data:application/octet-stream;')
})

/**
 * 场景：在当前 playground 中，修改 “editFile('nested/partial.html', (code) => code.replace('<div>partial</div>', '<div>partial updated</div>…”。
 * 验证目标：“await page.textContent('.raw')” 应匹配 “'SVG'”；“await page.textContent('.raw-html')” 应等于 “'<div>partial</div>\n'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
 */
test('?raw import', async () => {
  // `?raw` 导出文件文本；开发模式还应把原文件纳入模块图并触发 HMR。
  expect(await page.textContent('.raw')).toMatch('SVG')
  expect(await page.textContent('.raw-html')).toBe('<div>partial</div>\n')

  if (isBuild) return
  editFile('nested/partial.html', (code) =>
    code.replace('<div>partial</div>', '<div>partial updated</div>'),
  )
  await expect
    .poll(() => page.textContent('.raw-html'))
    .toBe('<div>partial updated</div>\n')

  // bundled-dev 记录 `playground-temp/assets/nested/...`，而普通 dev 记录 URL
  // `/nested/...`，这是 Vite 侧差异而非 Rolldown 行为（#23028）：server 未把
  // cwd 传给 Rolldown，bundledDevHmrClient 又直接输出磁盘模块 id。两处修复后
  // 可移除此守卫，让 bundled-dev 也验证相同日志。
  if (!isBundled) {
    expect(browserLogs).toStrictEqual(
      expect.arrayContaining([
        expect.stringContaining('hot updated: /nested/partial.html?raw via'),
      ]),
    )
  }
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.no-inline-svg')”。
 * 验证目标：“await page.textContent('.no-inline-svg')” 应匹配 “isBundled ? /\/foo\/bar\/assets\/fragment-[-\w]{8}\.svg/ : '/foo/bar/nested/fragment.svg?no-inline'”，从而确认资源内联阈值与 data URI 编码分支正确。
 */
test('?no-inline svg import', async () => {
  expect(await page.textContent('.no-inline-svg')).toMatch(
    isBundled
      ? /\/foo\/bar\/assets\/fragment-[-\w]{8}\.svg/
      : '/foo/bar/nested/fragment.svg?no-inline',
  )
})

// bundled-dev 当前会丢失哈希资产 URL 的查询后缀，而 build 会保留 `?foo=bar`（#23028）。
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.no-inline-svg-mp')”。
 * 验证目标：“await page.textContent('.no-inline-svg-mp')” 应匹配 “isBundled ? /\/foo\/bar\/assets\/fragment-[-\w]{8}\.svg\?foo=bar/ : '/foo/bar/nested/fragment.svg?no-inl…”，从而确认资源内联阈值与 data URI 编码分支正确。
 */
test.skipIf(isBundledDev)(
  '?no-inline svg import -- multiple postfix',
  async () => {
    expect(await page.textContent('.no-inline-svg-mp')).toMatch(
      isBundled
        ? /\/foo\/bar\/assets\/fragment-[-\w]{8}\.svg\?foo=bar/
        : '/foo/bar/nested/fragment.svg?no-inline&foo=bar',
    )
  },
)

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.inline-png')”。
 * 验证目标：“await page.textContent('.inline-png')” 应匹配 “/^data:image\/png;base64,/”，从而确认资源内联阈值与 data URI 编码分支正确。
 */
test('?inline png import', async () => {
  expect(await page.textContent('.inline-png')).toMatch(
    /^data:image\/png;base64,/,
  )
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.inline-public-png')”。
 * 验证目标：“await page.textContent('.inline-public-png')” 应匹配 “/^data:image\/png;base64,/”，从而确认publicDir 资源绕过转换后仍保留正确 base 和内容。
 */
test('?inline public png import', async () => {
  expect(await page.textContent('.inline-public-png')).toMatch(
    /^data:image\/png;base64,/,
  )
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.inline-public-json')”。
 * 验证目标：“await page.textContent('.inline-public-json')” 应匹配 “/^data:application\/json;base64,/”，从而确认publicDir 资源绕过转换后仍保留正确 base 和内容。
 */
test('?inline public json import', async () => {
  expect(await page.textContent('.inline-public-json')).toMatch(
    /^data:application\/json;base64,/,
  )
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.url')”。
 * 验证目标：“await page.textContent('.url')” 应匹配 “isBundled ? 'data:text/javascript;base64,${Buffer.from(src).toString('base64')}' : '/foo/bar/foo.js'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
 */
test('?url import', async () => {
  // `?url` 强制按资产 URL 导入；小文件在构建中仍可受内联策略影响。
  const src = readFile('foo.js')
  expect(await page.textContent('.url')).toMatch(
    isBundled
      ? `data:text/javascript;base64,${Buffer.from(src).toString('base64')}`
      : `/foo/bar/foo.js`,
  )
})

// bundled-dev 当前把 `?url` CSS 变成 data URI，build 则始终输出 CSS 文件
//（#22863）。修复后应与 build 采用相同 URL 形态，届时移除 skip，并把下面的
// `isBuild` 改为 `isBundled`。
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “txt”。
 * 验证目标：“txt” 应匹配 “isBuild ? /\/foo\/bar\/assets\/icons-[-\w]{8}\.css/ : '/foo/bar/css/icons.css'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
 */
test.skipIf(isBundledDev)('?url import on css', async () => {
  const txt = await page.textContent('.url-css')
  expect(txt).toMatch(
    isBuild
      ? /\/foo\/bar\/assets\/icons-[-\w]{8}\.css/
      : '/foo/bar/css/icons.css',
  )
})

describe('unicode url', () => {
  /**
   * 场景：在 “'unicode url'” 中，加载用例 fixture 并观察 “await page.textContent('.unicode-url')”。
   * 验证目标：“await page.textContent('.unicode-url')” 应匹配 “isBundled ? 'data:text/javascript;base64,${Buffer.from(src).toString('base64')}' : encodeURI('/foo/bar/テ…”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('from js import', async () => {
    const src = readFile('テスト-測試-white space.js')
    expect(await page.textContent('.unicode-url')).toMatch(
      isBundled
        ? `data:text/javascript;base64,${Buffer.from(src).toString('base64')}`
        : encodeURI(`/foo/bar/テスト-測試-white space.js`),
    )
  })
})

describe.runIf(isBuild)('encodeURI', () => {
  /**
   * 场景：在 “'encodeURI'” 中，加载用例 fixture 并观察 “await img.getAttribute('src')”。
   * 验证目标：“await img.getAttribute('src')” 应匹配 “/^data:image\/png;base64,/”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('img src with encodeURI', async () => {
    const img = await page.$('.encodeURI')
    expect(await img.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  })
})

/**
 * 场景：在当前 playground 中，修改 “editFile('import-meta-url/img.png', null, (_oldContent) => { oldContent = _oldContent return newContent …”，然后修改 “editFile('import-meta-url/img.png', null, (_) => oldContent)”。
 * 验证目标：“await page.textContent('.import-meta-url')” 应匹配 “imgMatch”；“page.textContent('.import-meta-url')” 应匹配 “imgMatch”，从而确认new URL(..., import.meta.url) 的静态分析与运行时回退正确。
 */
test('new URL(..., import.meta.url)', async () => {
  // 静态 URL 在构建中进入资产图；开发时源文件变化应使页面重载并重新解析 URL。
  const imgMatch = isBundled
    ? /\/foo\/bar\/assets\/img-[-\w]{8}\.png/
    : '/foo/bar/import-meta-url/img.png'

  expect(await page.textContent('.import-meta-url')).toMatch(imgMatch)
  if (isServe) {
    const loadPromise = page.waitForEvent('load')
    const newContent = readFile('import-meta-url/img-update.png', null)
    let oldContent: Buffer
    editFile('import-meta-url/img.png', null, (_oldContent) => {
      oldContent = _oldContent
      return newContent
    })
    await loadPromise // expect reload
    await expect
      .poll(() => page.textContent('.import-meta-url'))
      .toMatch(imgMatch)

    const loadPromise2 = page.waitForEvent('load')
    editFile('import-meta-url/img.png', null, (_) => oldContent)
    await loadPromise2 // expect reload
    await expect
      .poll(() => page.textContent('.import-meta-url'))
      .toMatch(imgMatch)
  }
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.import-meta-url-dep')”。
 * 验证目标：“await page.textContent('.import-meta-url-dep')” 应匹配 “assetMatch”，从而确认new URL(..., import.meta.url) 的静态分析与运行时回退正确。
 */
test('new URL("@/...", import.meta.url)', async () => {
  expect(await page.textContent('.import-meta-url-dep')).toMatch(assetMatch)
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.import-meta-url-base-path')”。
 * 验证目标：“await page.textContent('.import-meta-url-base-path')” 应匹配 “iconMatch”，从而确认new URL(..., import.meta.url) 的静态分析与运行时回退正确。
 */
test('new URL("/...", import.meta.url)', async () => {
  expect(await page.textContent('.import-meta-url-base-path')).toMatch(
    iconMatch,
  )
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await img.getAttribute('src')”。
 * 验证目标：“await img.getAttribute('src')” 应匹配 “/^data:image\/png;base64,/”；“await page.textContent('.import-meta-url-data-uri')” 应匹配 “/^data:image\/png;base64,/”，从而确认new URL(..., import.meta.url) 的静态分析与运行时回退正确。
 */
test('new URL("data:...", import.meta.url)', async () => {
  const img = await page.$('.import-meta-url-data-uri-img')
  expect(await img.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  expect(await page.textContent('.import-meta-url-data-uri')).toMatch(
    /^data:image\/png;base64,/,
  )
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.import-meta-url-without-extension')”。
 * 验证目标：“await page.textContent('.import-meta-url-without-extension')” 应匹配 “isBundled ? 'data:text/javascript' : 'nested/test.js'”；“await page.textContent('.import-meta-url-content-without-extension')” 应包含 “'export default class'”，从而确认new URL(..., import.meta.url) 的静态分析与运行时回退正确。
 */
test('new URL(..., import.meta.url) without extension', async () => {
  expect(await page.textContent('.import-meta-url-without-extension')).toMatch(
    isBundled ? 'data:text/javascript' : 'nested/test.js',
  )
  expect(
    await page.textContent('.import-meta-url-content-without-extension'),
  ).toContain('export default class')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.dynamic-import-meta-url-1')”。
 * 验证目标：“await page.textContent('.dynamic-import-meta-url-1')” 应匹配 “isBundled ? 'data:image/png;base64' : '/foo/bar/nested/icon.png'”；“await page.textContent('.dynamic-import-meta-url-2')” 应匹配 “assetMatch”，从而确认new URL(..., import.meta.url) 的静态分析与运行时回退正确。
 */
test('new URL(`${dynamic}`, import.meta.url)', async () => {
  // 动态模板被改写成 eager glob，分别覆盖内联图片、外置图片与 JS 资产。
  expect(await page.textContent('.dynamic-import-meta-url-1')).toMatch(
    isBundled ? 'data:image/png;base64' : '/foo/bar/nested/icon.png',
  )
  expect(await page.textContent('.dynamic-import-meta-url-2')).toMatch(
    assetMatch,
  )
  expect(await page.textContent('.dynamic-import-meta-url-js')).toMatch(
    isBundled ? 'data:text/javascript;base64' : '/foo/bar/nested/test.js',
  )
})

// bundled-dev：`?abc` 后缀丢失，原因同 `?no-inline svg import -- multiple postfix`。
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.dynamic-import-meta-url-1-query')”。
 * 验证目标：“await page.textContent('.dynamic-import-meta-url-1-query')” 应匹配 “isBundled ? 'data:image/png;base64' : '/foo/bar/nested/icon.png?abc'”；“await page.textContent('.dynamic-import-meta-url-2-query')” 应匹配 “isBundled ? /\/foo\/bar\/assets\/asset-[-\w]{8}\.png\?abc/ : '/foo/bar/nested/asset.png?abc'”，从而确认new URL(..., import.meta.url) 的静态分析与运行时回退正确。
 */
test.skipIf(isBundledDev)(
  'new URL(`./${dynamic}?abc`, import.meta.url)',
  async () => {
    expect(await page.textContent('.dynamic-import-meta-url-1-query')).toMatch(
      isBundled ? 'data:image/png;base64' : '/foo/bar/nested/icon.png?abc',
    )
    expect(await page.textContent('.dynamic-import-meta-url-2-query')).toMatch(
      isBundled
        ? /\/foo\/bar\/assets\/asset-[-\w]{8}\.png\?abc/
        : '/foo/bar/nested/asset.png?abc',
    )
  },
)

// bundled-dev：`?abc` 后缀丢失，原因同 `?no-inline svg import -- multiple postfix`。
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.dynamic-import-meta-url-1-ternary')”。
 * 验证目标：“await page.textContent('.dynamic-import-meta-url-1-ternary')” 应匹配 “isBundled ? 'data:image/png;base64' : '/foo/bar/nested/icon.png?abc'”；“await page.textContent('.dynamic-import-meta-url-2-ternary')” 应匹配 “isBundled ? /\/foo\/bar\/assets\/asset-[-\w]{8}\.png\?abc/ : '/foo/bar/nested/asset.png?abc'”，从而确认new URL(..., import.meta.url) 的静态分析与运行时回退正确。
 */
test.skipIf(isBundledDev)(
  'new URL(`./${1 === 0 ? static : dynamic}?abc`, import.meta.url)',
  async () => {
    expect(
      await page.textContent('.dynamic-import-meta-url-1-ternary'),
    ).toMatch(
      isBundled ? 'data:image/png;base64' : '/foo/bar/nested/icon.png?abc',
    )
    expect(
      await page.textContent('.dynamic-import-meta-url-2-ternary'),
    ).toMatch(
      isBundled
        ? /\/foo\/bar\/assets\/asset-[-\w]{8}\.png\?abc/
        : '/foo/bar/nested/asset.png?abc',
    )
  },
)

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.non-existent-import-meta-url')”。
 * 验证目标：忽略标记后的 URL 必须按当前脚本基址在浏览器运行时解析，serverLogs 不得出现 `doesn't exist at build time`，确认插件没有尝试静态解析不存在文件。
 */
test("new URL(/* @vite-ignore */ 'non-existent', import.meta.url)", async () => {
  // 内联 script 会先抽成独立模块，因此基准 URL 是生成的脚本文件而非 HTML 源码。
  const importMetaUrl = new URL(
    isBundled ? '/foo/bar/assets/index.js' : '/foo/bar/index.html',
    page.url(),
  )
  expect(await page.textContent('.non-existent-import-meta-url')).toMatch(
    new URL('non-existent', importMetaUrl).pathname,
  )
  expect(serverLogs).not.toContainEqual(
    expect.stringContaining("doesn't exist at build time"),
  )
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.import-meta-url-multiline')”。
 * 验证目标：“await page.textContent('.import-meta-url-multiline')” 应匹配 “assetMatch”，从而确认new URL(..., import.meta.url) 的静态分析与运行时回退正确。
 */
test('new URL(..., import.meta.url) (multiline)', async () => {
  const assetMatch = isBundled
    ? /\/foo\/bar\/assets\/asset-[-\w]{8}\.png/
    : '/foo/bar/nested/asset.png'

  expect(await page.textContent('.import-meta-url-multiline')).toMatch(
    assetMatch,
  )
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “entry.css”。
 * 验证目标：“entry.css” 应包含 “'assets/${file}'”；“entry.assets” 应包含 “'assets/${file}'”，从而确认构建资产图和 manifest 文件映射完整。
 */
test.runIf(isBuild)('manifest', async () => {
  const manifest = readManifest('foo')
  const entry = manifest['index.html']

  for (const file of listAssets('foo')) {
    if (file.endsWith('.css')) {
      // icons-*.css 与 css-url-url-*.css 通过 `?url` 导入，不属于入口 CSS 清单。
      if (file.includes('icons-') || file.includes('css-url-url-')) continue
      expect(entry.css).toContain(`assets/${file}`)
    } else if (!file.endsWith('.js')) {
      expect(entry.assets).toContain(`assets/${file}`)
    }
  }
})

describe.runIf(isBuild)('css and assets in css in build watch', () => {
  /**
   * 场景：在 “'css and assets in css in build watch'” 中，修改 “editFile('index.html', (code) => code.replace('Assets', 'assets2'))”，然后等待重建 “notifyRebuildComplete(watcher)”。
   * 验证目标：“cssFile” 不应等于 “''”；“cssFile” 不应匹配 “/undefined/”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('css will not be lost and css does not contain undefined', async () => {
    editFile('index.html', (code) => code.replace('Assets', 'assets2'))
    await notifyRebuildComplete(watcher)
    const cssFile = findAssetFile(/index-[-\w]+\.css$/, 'foo')
    expect(cssFile).not.toBe('')
    expect(cssFile).not.toMatch(/undefined/)
  })

  /**
   * 场景：在 “'css and assets in css in build watch'” 中，修改 “editFile('asset/update.js', (code) => code.replace('hello', 'world2'))”，然后等待重建 “notifyRebuildComplete(watcher)”。
   * 验证目标：“page.textContent('.update-content')” 应等于 “'hello'”；“oldMainJsFiles.length” 应等于 “1”，从而确认资源变更会使旧产物失效并传播到浏览器。
   */
  test('old file is removed when the content changes', async () => {
    await expect.poll(() => page.textContent('.update-content')).toBe('hello')

    const oldMainJsFiles = listAssets('foo').filter((f) =>
      /index-[-\w]+\.js$/.test(f),
    )
    expect(oldMainJsFiles.length).toBe(1)
    const oldMainJsFile = oldMainJsFiles[0]

    editFile('asset/update.js', (code) => code.replace('hello', 'world2'))
    await notifyRebuildComplete(watcher)
    await page.reload()
    await expect.poll(() => page.textContent('.update-content')).toBe('world2')

    const newMainJsFiles = listAssets('foo').filter((f) =>
      /index-[-\w]+\.js$/.test(f),
    )
    expect(newMainJsFiles).not.toContain(oldMainJsFile)
    expect(newMainJsFiles.length).toBe(1)
  })

  /**
   * 场景：在 “'css and assets in css in build watch'” 中，修改 “editFile('css/foo.module.css', (code) => code.replace('red', 'blue'))”，然后等待重建 “notifyRebuildComplete(watcher)”。
   * 验证目标：“await getColor('#foo')” 应等于 “'red'”；“await getColor('#foo')” 应等于 “'blue'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('import module.css', async () => {
    expect(await getColor('#foo')).toBe('red')
    editFile('css/foo.module.css', (code) => code.replace('red', 'blue'))
    await notifyRebuildComplete(watcher)
    await page.reload()
    expect(await getColor('#foo')).toBe('blue')
  })

  /**
   * 场景：在 “'css and assets in css in build watch'” 中，修改 “editFile('static/foo.txt', (code) => code.replace('foo', 'zoo2'))”，然后等待重建 “notifyRebuildComplete(watcher)”。
   * 验证目标：“await page.textContent('.raw-query')” 应等于 “'foo'”；“await page.textContent('.raw-query')” 应等于 “'zoo2'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
   */
  test('import with raw query', async () => {
    expect(await page.textContent('.raw-query')).toBe('foo')
    editFile('static/foo.txt', (code) => code.replace('foo', 'zoo2'))
    await notifyRebuildComplete(watcher)
    await page.reload()
    expect(await page.textContent('.raw-query')).toBe('zoo2')
  })
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getBg('.inline-style')”。
 * 验证目标：“await getBg('.inline-style')” 应匹配 “assetMatch”；“await getBg('.style-url-assets')” 应匹配 “assetMatch”，从而确认资源内联阈值与 data URI 编码分支正确。
 */
test('inline style test', async () => {
  expect(await getBg('.inline-style')).toMatch(assetMatch)
  expect(await getBg('.style-url-assets')).toMatch(assetMatch)
})

if (!isBuild) {
  // bundled-dev：修改内联 `<style>` 通过 @import 引入的 CSS 不会触发更新或重载（#23028）。
  /**
   * 场景：在当前 playground 中，修改 “editFile('./css/import.css', (code) => code.replace('#0088ff', '#00ff88 '))”。
   * 验证目标：“getColor('.import-css')” 应等于 “'rgb(0, 136, 255)'”；“getColor('.import-css')” 应等于 “'rgb(0, 255, 136)'”，从而确认资源变更会使旧产物失效并传播到浏览器。
   */
  test.skipIf(isBundledDev)('@import in html style tag hmr', async () => {
    await expect.poll(() => getColor('.import-css')).toBe('rgb(0, 136, 255)')
    const loadPromise = page.waitForEvent('load')
    editFile('./css/import.css', (code) => code.replace('#0088ff', '#00ff88 '))
    await loadPromise
    await expect.poll(() => getColor('.import-css')).toBe('rgb(0, 255, 136)')
  })
}

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.obj-import-express')”。
 * 验证目标：“await page.textContent('.obj-import-express')” 应匹配 “'ignore object import prop'”；“await page.textContent('.string-import-express')” 应匹配 “'no load'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
 */
test('html import word boundary', async () => {
  expect(await page.textContent('.obj-import-express')).toMatch(
    'ignore object import prop',
  )
  expect(await page.textContent('.string-import-express')).toMatch('no load')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.relative-js')”。
 * 验证目标：“await page.textContent('.relative-js')” 应匹配 “'hello'”；“await getColor('.relative-css')” 应匹配 “'red'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
 */
test('relative path in html asset', async () => {
  expect(await page.textContent('.relative-js')).toMatch('hello')
  expect(await getColor('.relative-css')).toMatch('red')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getBg('.style-public-assets')”。
 * 验证目标：“await getBg('.style-public-assets')” 应包含 “iconMatch”，从而确认publicDir 资源绕过转换后仍保留正确 base 和内容。
 */
test('url() contains file in publicDir, in <style> tag', async () => {
  expect(await getBg('.style-public-assets')).toContain(iconMatch)
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await getBg('.inline-style-public')”。
 * 验证目标：“await getBg('.inline-style-public')” 应包含 “iconMatch”，从而确认publicDir 资源绕过转换后仍保留正确 base 和内容。
 */
test('url() contains file in publicDir, as inline style', async () => {
  expect(await getBg('.inline-style-public')).toContain(iconMatch)
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await link.getAttribute('href')”。
 * 验证目标：“await link.getAttribute('href')” 应等于 “'data:,'”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
 */
test('should not rewrite non-relative urls in html', async () => {
  const link = page.locator('.data-href')
  expect(await link.getAttribute('href')).toBe('data:,')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “indexHtml”。
 * 验证目标：“indexHtml” 应匹配 “/<img class="noscript" src="\/foo\/bar\/assets\/asset-[-\w]+\.png" \/>/”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
 */
test.runIf(isBuild)('assets inside <noscript> is rewrote', async () => {
  const indexHtml = readFile('./dist/foo/index.html')
  expect(indexHtml).toMatch(
    /<img class="noscript" src="\/foo\/bar\/assets\/asset-[-\w]+\.png" \/>/,
  )
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “indexHtml”。
 * 验证目标：“indexHtml” 应匹配 “/<img class="template" src="\/foo\/bar\/assets\/asset-[-\w]+\.png" \/>/”，从而确认JS/CSS/HTML 资产入口在 dev 与 build 中保持一致的公开 URL 语义。
 */
test.runIf(isBuild)('assets inside <template> is rewrote', async () => {
  const indexHtml = readFile('./dist/foo/index.html')
  expect(indexHtml).toMatch(
    /<img class="template" src="\/foo\/bar\/assets\/asset-[-\w]+\.png" \/>/,
  )
})
