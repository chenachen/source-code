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
 * `new URL(..., import.meta.url)`；按 dev、bundled-dev 和 build 的条件分别检查
 * 源路径、带 hash 的产物或 data URI，以及浏览器最终内容。
 */
/** 非内联 PNG 的匹配模式：bundled 取 base+assets 哈希名，普通 dev 取 nested 源路径。 */
const assetMatch = isBundled
  ? /\/foo\/bar\/assets\/asset-[-\w]{8}\.png/
  : '/foo/bar/nested/asset.png'

/** 含方括号文件名在 bundled 模式使用带 hash 的 URL，unbundled dev 保留源路径。 */
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
/** 浏览器日志不含 404；bundled dev 的 CSS?url 缺陷使该模式跳过。 */
test.skipIf(isBundledDev)('should have no 404s', () => {
  browserLogs.forEach((msg) => {
    expect(msg).not.toMatch('404')
  })
})

/** build 日志不出现 image-set 中资产占位符未解析的警告。 */
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

/** 错误大小写未命中静态文件；这里带 HTML Accept，因此返回 SPA fallback 的 200 HTML。 */
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

/** 不存在的 HTML 导航路径回退到 index.html，状态码为 200。 */
test('should fallback to index.html when accessing non-existent html file', async () => {
  expect((await fetchPath('doesnt-exist.html')).status).toBe(200)
})

describe.runIf(isServe)('outside base', () => {
  /** dev 请求 base 外路径并接受 HTML 时，返回 404 HTML 提示。 */
  test('should get a 404 with html', async () => {
    const res = await fetch(new URL('/baz', viteTestUrl), {
      headers: { Accept: 'text/html,*/*' },
    })
    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toBe('text/html')
  })

  /** dev 请求 base 外路径且不声明 HTML Accept 时，返回 404 纯文本提示。 */
  test('should get a 404 with text', async () => {
    const res = await fetch(new URL('/baz', viteTestUrl))
    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toBe('text/plain')
  })
})

describe('injected scripts', () => {
  /** unbundled dev HTML 显式注入 @vite/client script；bundled 模式没有这条标签。 */
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

  /** unbundled dev 的内联模块使用 html-proxy script URL；bundled 模式没有这条标签。 */
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
  /** public 目录的原始脚本加载后写入 success 文本。 */
  test('load raw js from /public', async () => {
    expect(await page.textContent('.raw-js')).toMatch('[success]')
  })

  /** public 目录的原始 CSS 链接加载后呈现 red。 */
  test('load raw css from /public', async () => {
    expect(await getColor('.raw-css')).toBe('red')
  })
})

/** 普通 script 中的两个动态 import 都执行并写入 success 文本。 */
test('import-expression from simple script', async () => {
  expect(await page.textContent('.import-expression')).toMatch(
    '[success][success]',
  )
})

describe('asset imports from js', () => {
  // 验证相对、根绝对与 public 资产最终都导出浏览器可访问的 URL。
  /** 相对路径引用的 PNG 在 bundled 模式使用带 hash 的资产 URL，unbundled dev 使用源路径。 */
  test('relative', async () => {
    expect(await page.textContent('.asset-import-relative')).toMatch(assetMatch)
  })

  /** 根绝对路径引用的 PNG 与相对引用解析到相同资产 URL。 */
  test('absolute', async () => {
    expect(await page.textContent('.asset-import-absolute')).toMatch(assetMatch)
  })

  /** public PNG 的 URL 拼接 base，保持稳定文件名。 */
  test('from /public', async () => {
    expect(await page.textContent('.public-import')).toMatch(iconMatch)
  })

  /** public JSON 的 ?url 导入使用稳定 URL；fetch 结果保持原始格式化文本。 */
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

  /** public JS 的 ?url 导入使用稳定 URL；fetch 结果保持原脚本与 JavaScript MIME。 */
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

  /** public TS 的 ?url 导入返回源文本；只在 serve 模式断言 JavaScript MIME。 */
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
    // 此处只在 serve 下断言 MIME；preview 不承诺与 dev 相同的 TypeScript MIME。
    if (isServe) {
      expect(await page.textContent('.public-ts-import-content-type')).toMatch(
        'text/javascript',
      )
    }
  })

  /** public MTS 的 ?url 导入返回源文本；只在 serve 模式断言 JavaScript MIME。 */
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
    // 此处只在 serve 下断言 MIME；preview 不承诺与 dev 相同的 MTS MIME。
    if (isServe) {
      expect(await page.textContent('.public-mts-import-content-type')).toMatch(
        'text/javascript',
      )
    }
  })
})

describe('css url() references', () => {
  /** 场景：CSS 使用 Inter 字体；浏览器调用 fonts.check(700 32px Inter)，核对结果为 true。 */
  test('fonts', async () => {
    expect(
      await page.evaluate(() => {
        return (document as any).fonts.check('700 32px Inter')
      }),
    ).toBe(true)
  })

  /** 相对路径引用的 PNG 在 bundled 模式使用带 hash 的资产 URL，unbundled dev 使用源路径。 */
  test('relative', async () => {
    expect(await getBg('.css-url-relative')).toMatch(assetMatch)
  })

  /** 含方括号的 PNG 路径在 bundled 模式转为带 hash 文件名，unbundled dev 保留源路径。 */
  test('encoded', async () => {
    expect(await getBg('.css-url-encoded')).toMatch(encodedAssetMatch)
  })

  /** image-set 的相对 PNG 候选都解析到预期资产 URL。 */
  test('image-set relative', async () => {
    const imageSet = await getBg('.css-image-set-relative')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(assetMatch)
    })
  })

  /** image-set 直接字符串候选也经过资产 URL 改写。 */
  test('image-set without the url() call', async () => {
    const imageSet = await getBg('.css-image-set-without-url-call')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(assetMatch)
    })
  })

  /** image-set 中 CSS 变量最终指向处理后的 PNG URL。 */
  test('image-set with var', async () => {
    const imageSet = await getBg('.css-image-set-with-var')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(assetMatch)
    })
  })

  /** image-set 混用 url() 与 var() 时，各候选都指向处理后的 PNG URL。 */
  test('image-set with mix', async () => {
    const imageSet = await getBg('.css-image-set-mix-url-var')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(assetMatch)
    })
  })

  /** 已有 PNG data URI 在 image-set 中保持。 */
  test('image-set with base64', async () => {
    const imageSet = await getBg('.css-image-set-base64')
    expect(imageSet).toContain('image-set(url("data:image/png;base64,')
  })

  /** image-set 混用渐变与 data URI 时，已有 PNG data URI 保持。 */
  test('image-set with gradient', async () => {
    const imageSet = await getBg('.css-image-set-gradient')
    expect(imageSet).toContain('image-set(url("data:image/png;base64,')
  })

  /** image-set 同时含类型与密度描述符时，各图片候选仍解析为资产 URL。 */
  test('image-set with multiple descriptor', async () => {
    const imageSet = await getBg('.css-image-set-multiple-descriptor')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(assetMatch)
    })
  })

  /** style 属性中的多描述符 image-set 同样经过资产 URL 改写。 */
  test('image-set with multiple descriptor as inline style', async () => {
    const imageSet = await getBg(
      '.css-image-set-multiple-descriptor-inline-style',
    )
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(assetMatch)
    })
  })

  /** 同一声明混用 image-set 与 url() 时，背景中含预期 PNG 资产 URL。 */
  test('image-set and url exist at the same time.', async () => {
    const imageSet = await getBg('.image-set-and-url-exsiting-at-same-time')
    expect(imageSet).toMatch(assetMatch)
  })

  /** 导入 CSS 内的相对 URL 按被导入文件位置解析。 */
  test('relative in @import', async () => {
    expect(await getBg('.css-url-relative-at-imported')).toMatch(assetMatch)
  })

  /** 根绝对路径引用的 PNG 与相对引用解析到相同资产 URL。 */
  test('absolute', async () => {
    expect(await getBg('.css-url-absolute')).toMatch(assetMatch)
  })

  /** public PNG 的 URL 拼接 base，保持稳定文件名。 */
  test('from /public', async () => {
    expect(await getBg('.css-url-public')).toMatch(iconMatch)
  })

  /** 小 PNG 在 bundled 模式内联；unbundled dev 返回源路径，带/不带引号结果一致。 */
  test('base64 inline', async () => {
    const match = isBundled
      ? `data:image/png;base64`
      : `/foo/bar/nested/icon.png`
    expect(await getBg('.css-url-base64-inline')).toMatch(match)
    expect(await getBg('.css-url-quotes-base64-inline')).toMatch(match)
  })

  /** favicon 与 manifest 链接在 bundled 模式输出文件 URL，保持浏览器可请求的链接。 */
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

  /** 同一 CSS 声明内的普通资产和 public 资产 URL 都被正确改写。 */
  test('multiple urls on the same line', async () => {
    const bg = await getBg('.css-url-same-line')
    expect(bg).toMatch(assetMatch)
    expect(bg).toMatch(iconMatch)
  })

  /** CSS URL 的 alias 解析到与相对引用相同的 PNG。 */
  test('aliased', async () => {
    const bg = await getBg('.css-url-aliased')
    expect(bg).toMatch(assetMatch)
  })

  /** 已有 SVG data URI 保持内联形式。 */
  test('preinlined SVG', async () => {
    expect(await getBg('.css-url-preinlined-svg')).toMatch(
      /data:image\/svg\+xml,.+/,
    )
  })

  /** build CSS 保留字体 query/hash，并把 public 路径改为带 base 的 URL。 */
  test.runIf(isBuild)('generated paths in CSS', () => {
    const css = findAssetFile(/index-[-\w]{8}\.css$/, 'foo')

    // 资产改写后仍须保留原查询串与 hash 后缀。
    expect(css).toMatch(`woff2?#iefix`)

    // CSS 中的 public 路径应使用非相对 base。
    expect(css).not.toMatch(`../icon.png`)
  })

  /** 小 SVG 的 CSS 背景使用 data URI；serve 编辑 SVG 后检查背景内容更新。 */
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

  /** image-set 中的小 SVG 同样使用 data URI。 */
  test('image-set() with svg', async () => {
    expect(await getBg('.css-image-set-svg')).toMatch(/data:image\/svg\+xml,.+/)
  })

  // bundled-dev 把 `?url` CSS 变成 data URI，而 build 始终输出 CSS 文件；
  // 因此 CSS 内的 SVG 从未进入处理流水线，既不会内联，也不会添加 base。
  // 根因同下方 `?url import on css`：`?url` 导入跳过 CSS 流水线（#22863）。
  /** 场景：CSS?url 链接中的小 SVG 背景初始 data URI 为蓝；bundledDev skip。serve 编辑第二 SVG 后仅轮询另一 .css-url-svg 元素为红，没有验证 .css-url-svg-in-url 本身更新。 */
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

  /** serve 修改外置 SVG 后，CSS 背景 URL 发生变化。 */
  test.runIf(isServe)('non inlined url() HMR', async () => {
    const bg = await getBg('.css-url-non-inline-hmr')
    editFile('nested/donuts-large.svg', (code) =>
      code.replace('fill="blue"', 'fill="red"'),
    )
    await expect.poll(() => getBg('.css-url-non-inline-hmr')).not.toBe(bg)
  })
})

describe('image', () => {
  /** HTML 独占图片在 bundled 模式生成带 hash URL，unbundled dev 使用源路径。 */
  test('src', async () => {
    const img = await page.$('.img-src')
    const src = await img.getAttribute('src')
    expect(src).toMatch(
      isBundled
        ? /\/foo\/bar\/assets\/html-only-asset-[-\w]{8}\.jpg/
        : /\/foo\/bar\/nested\/html-only-asset.jpg/,
    )
  })

  /** HTML 小 SVG 在 bundled 模式内联为 data URI，unbundled dev 使用源路径。 */
  test('src inline', async () => {
    const img = await page.$('.img-src-inline')
    const src = await img.getAttribute('src')
    expect(src).toMatch(
      isBundled
        ? /^data:image\/svg\+xml,%3csvg/
        : /\/foo\/bar\/nested\/inlined.svg/,
    )
  })

  /** srcset 的每个本地候选都改写 URL，同时保留密度描述符。 */
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

  /** public srcset 候选拼接 base，同时保留密度描述符。 */
  test('srcset (public)', async () => {
    const img = await page.$('.img-src-set-public')
    const srcset = await img.getAttribute('srcset')
    srcset.split(', ').forEach((s) => {
      expect(s).toMatch(/\/foo\/bar\/icon\.png \dx/)
    })
  })

  /** 混合远程与本地 srcset 时，本地候选仍按资产规则改写。 */
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
  /** og:image 的 content 属性按 HTML 资产规则改写 PNG URL。 */
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
  /** HTML SVG 引用保留 #icon-clock-view 片段；bundled dev 因后缀丢失跳过。 */
  test.skipIf(isBundledDev)('img url', async () => {
    const img = await page.$('.svg-frag-img')
    expect(await img.getAttribute('src')).toMatch(/svg#icon-clock-view$/)
  })

  // bundled-dev：#fragment 丢失，原因同 `img url`。
  /** CSS SVG 引用保留 #icon-clock-view 片段；bundled dev 因后缀丢失跳过。 */
  test.skipIf(isBundledDev)('via css url()', async () => {
    expect(await getBg('.icon')).toMatch(/svg#icon-clock-view"\)$/)
  })

  /** JS 导入 SVG 后手动追加片段，检查 data URI 两端编码与 #icon-heart-view。 */
  test('from js import', async () => {
    const img = await page.$('.svg-frag-import')
    expect(await img.getAttribute('src')).toMatch(
      // 同时验证 SVG data URI 已裁去外围空白：编码内容以 `<` 开始、以 `>` 结束。
      /^data:image\/svg\+xml,%3c.*%3e#icon-heart-view$/,
    )
  })

  // bundled-dev：#fragment 丢失，原因同 `img url`。
  /** 别名 SVG URL 改写后保留片段；bundled dev 因后缀丢失跳过。 */
  test.skipIf(isBundledDev)('url with an alias', async () => {
    expect(await getBg('.icon-clock-alias')).toMatch(
      /\.svg#icon-clock-view"\)$/,
    )
  })
})

/** assetsInclude 纳入未知扩展名：bundled 模式使用 octet-stream data URI，unbundled dev 返回路径。 */
test('Unknown extension assets import', async () => {
  expect(await page.textContent('.unknown-ext')).toMatch(
    isBundled ? 'data:application/octet-stream;' : '/nested/foo.unknown',
  )
})

/** 未知扩展名配合 ?inline 显式生成 octet-stream data URI。 */
test('Unknown extension assets import with ?inline', async () => {
  expect(await page.textContent('.unknown-ext-inline')).toMatch(
    'data:application/octet-stream;',
  )
})

/** 相对路径 assetsInclude 规则命中自定义扩展名，按对应模式返回 data URI 或路径。 */
test('Asset matched by a relative path in assetsInclude import', async () => {
  expect(await page.textContent('.relative-path-assets-include')).toMatch(
    isBundled
      ? 'data:application/octet-stream;'
      : '/nested/relative-path.custom',
  )
})

/** 相对路径 assetsInclude 命中的文件配合 ?inline 显式内联。 */
test('Asset matched by a relative path in assetsInclude import with ?inline', async () => {
  expect(
    await page.textContent('.relative-path-assets-include-inline'),
  ).toMatch('data:application/octet-stream;')
})

/** ?raw 导出原文本；dev 编辑 HTML 文本后，接受回调更新页面内容。 */
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

/** ?no-inline 禁止 SVG 内联，bundled 模式导出外置资产 URL。 */
test('?no-inline svg import', async () => {
  expect(await page.textContent('.no-inline-svg')).toMatch(
    isBundled
      ? /\/foo\/bar\/assets\/fragment-[-\w]{8}\.svg/
      : '/foo/bar/nested/fragment.svg?no-inline',
  )
})

// bundled-dev 当前会丢失哈希资产 URL 的查询后缀，而 build 会保留 `?foo=bar`（#23028）。
/** ?no-inline 被消费后，build 外置 SVG URL 保留自定义 ?foo=bar 后缀。 */
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

/** ?inline 显式将 PNG 导出为 base64 data URI。 */
test('?inline png import', async () => {
  expect(await page.textContent('.inline-png')).toMatch(
    /^data:image\/png;base64,/,
  )
})

/** public PNG 配合 ?inline 读取文件内容并导出 data URI。 */
test('?inline public png import', async () => {
  expect(await page.textContent('.inline-public-png')).toMatch(
    /^data:image\/png;base64,/,
  )
})

/** public JSON 配合 ?url&inline 导出 JSON MIME 的 base64 data URI。 */
test('?inline public json import', async () => {
  expect(await page.textContent('.inline-public-json')).toMatch(
    /^data:application\/json;base64,/,
  )
})

/** JS 配合 ?url 作为资产处理：bundled 小文件内联原文，unbundled dev 返回路径。 */
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
/** build 的 CSS?url 返回抽取后的 CSS 文件 URL，unbundled dev 返回源路径；bundled dev 跳过。 */
test.skipIf(isBundledDev)('?url import on css', async () => {
  const txt = await page.textContent('.url-css')
  expect(txt).toMatch(
    isBuild
      ? /\/foo\/bar\/assets\/icons-[-\w]{8}\.css/
      : '/foo/bar/css/icons.css',
  )
})

describe('unicode url', () => {
  /** Unicode/空格文件名的 ?url 导入：unbundled dev 编码源路径，bundled 模式内联原文本。 */
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
  /** build 能识别 HTML 中预编码的 Unicode/空格图片路径，并内联 PNG。 */
  test('img src with encodeURI', async () => {
    const img = await page.$('.encodeURI')
    expect(await img.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  })
})

/** 静态 new URL 引用进入资产处理；serve 替换/恢复图片后检查页面重载及 URL。 */
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
    await loadPromise // 预期样式变更引发整页重载。
    await expect
      .poll(() => page.textContent('.import-meta-url'))
      .toMatch(imgMatch)

    const loadPromise2 = page.waitForEvent('load')
    editFile('import-meta-url/img.png', null, (_) => oldContent)
    await loadPromise2 // 预期样式变更引发整页重载。
    await expect
      .poll(() => page.textContent('.import-meta-url'))
      .toMatch(imgMatch)
  }
})

/** new URL 中的 alias 解析到对应 PNG 资产。 */
test('new URL("@/...", import.meta.url)', async () => {
  expect(await page.textContent('.import-meta-url-dep')).toMatch(assetMatch)
})

/** new URL 中的 public 根路径经处理后拼接 base。 */
test('new URL("/...", import.meta.url)', async () => {
  expect(await page.textContent('.import-meta-url-base-path')).toMatch(
    iconMatch,
  )
})

/** 已有 data URI 的 new URL 保持内联形式。 */
test('new URL("data:...", import.meta.url)', async () => {
  const img = await page.$('.import-meta-url-data-uri-img')
  expect(await img.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  expect(await page.textContent('.import-meta-url-data-uri')).toMatch(
    /^data:image\/png;base64,/,
  )
})

/** new URL 省略扩展名时解析到 test.js；fetch 到的文本仍含原 class 声明。 */
test('new URL(..., import.meta.url) without extension', async () => {
  expect(await page.textContent('.import-meta-url-without-extension')).toMatch(
    isBundled ? 'data:text/javascript' : 'nested/test.js',
  )
  expect(
    await page.textContent('.import-meta-url-content-without-extension'),
  ).toContain('export default class')
})

/** 带静态相对前缀的动态模板生成 eager glob，分别取得小 PNG、大 PNG 与 JS 资产 URL。 */
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
/** 动态模板的外置 PNG URL 保留 ?abc；小 PNG 仍可内联。 */
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
/** 模板插值含条件表达式时，仍按运行时选择取得资产 URL，外置 PNG 保留 query。 */
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

/** 忽略的不存在 URL 由浏览器按脚本基址求值；日志不出现构建时文件不存在警告。 */
test("new URL(/* @vite-ignore */ 'non-existent', import.meta.url)", async () => {
  // bundled 模式以生成脚本为基址；unbundled dev 的 html-proxy 仍处于 HTML 所在目录。
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

/** 跨行 new URL 表达式同样解析到 PNG 资产。 */
test('new URL(..., import.meta.url) (multiline)', async () => {
  const assetMatch = isBundled
    ? /\/foo\/bar\/assets\/asset-[-\w]{8}\.png/
    : '/foo/bar/nested/asset.png'

  expect(await page.textContent('.import-meta-url-multiline')).toMatch(
    assetMatch,
  )
})

/** build manifest 的入口记录包含输出 CSS 和非 JS 资产；CSS?url 文件单独排除。 */
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
  /** build watch 编辑 HTML 后，入口 CSS 仍存在且不含 undefined。 */
  test('css will not be lost and css does not contain undefined', async () => {
    editFile('index.html', (code) => code.replace('Assets', 'assets2'))
    await notifyRebuildComplete(watcher)
    const cssFile = findAssetFile(/index-[-\w]+\.css$/, 'foo')
    expect(cssFile).not.toBe('')
    expect(cssFile).not.toMatch(/undefined/)
  })

  /** build watch 改变入口依赖后，页面重载看到新文本，旧 hash 文件消失且新入口仍只有一份。 */
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

  /** build watch 修改 CSS Modules 后，重载页面呈现新颜色。 */
  test('import module.css', async () => {
    expect(await getColor('#foo')).toBe('red')
    editFile('css/foo.module.css', (code) => code.replace('red', 'blue'))
    await notifyRebuildComplete(watcher)
    await page.reload()
    expect(await getColor('#foo')).toBe('blue')
  })

  /** build watch 修改 ?raw 来源后，重载页面呈现新文本。 */
  test('import with raw query', async () => {
    expect(await page.textContent('.raw-query')).toBe('foo')
    editFile('static/foo.txt', (code) => code.replace('foo', 'zoo2'))
    await notifyRebuildComplete(watcher)
    await page.reload()
    expect(await page.textContent('.raw-query')).toBe('zoo2')
  })
})

/** HTML style 属性与 style 标签中的普通资产 URL 都经过改写。 */
test('inline style test', async () => {
  expect(await getBg('.inline-style')).toMatch(assetMatch)
  expect(await getBg('.style-url-assets')).toMatch(assetMatch)
})

if (!isBuild) {
  // bundled-dev：修改内联 `<style>` 通过 @import 引入的 CSS 不会触发更新或重载（#23028）。
  /** unbundled dev 编辑 HTML style 的 @import 依赖后，等待页面 load 并检查新颜色。 */
  test.skipIf(isBundledDev)('@import in html style tag hmr', async () => {
    await expect.poll(() => getColor('.import-css')).toBe('rgb(0, 136, 255)')
    const loadPromise = page.waitForEvent('load')
    editFile('./css/import.css', (code) => code.replace('#0088ff', '#00ff88 '))
    await loadPromise
    await expect.poll(() => getColor('.import-css')).toBe('rgb(0, 255, 136)')
  })
}

/** 对象 import 方法和含 import 文本的字符串不会被当成动态导入执行。 */
test('html import word boundary', async () => {
  expect(await page.textContent('.obj-import-express')).toMatch(
    'ignore object import prop',
  )
  expect(await page.textContent('.string-import-express')).toMatch('no load')
})

/** HTML 中相对 script/link 路径都能加载并产生预期文本/颜色。 */
test('relative path in html asset', async () => {
  expect(await page.textContent('.relative-js')).toMatch('hello')
  expect(await getColor('.relative-css')).toMatch('red')
})

/** style 标签中的 public URL 拼接 base。 */
test('url() contains file in publicDir, in <style> tag', async () => {
  expect(await getBg('.style-public-assets')).toContain(iconMatch)
})

/** style 属性中的 public URL 拼接 base。 */
test('url() contains file in publicDir, as inline style', async () => {
  expect(await getBg('.inline-style-public')).toContain(iconMatch)
})

/** HTML 中已有的 data:, 链接保持原值。 */
test('should not rewrite non-relative urls in html', async () => {
  const link = page.locator('.data-href')
  expect(await link.getAttribute('href')).toBe('data:,')
})

/** build 直接检查 HTML，noscript 内图片也改写为带 hash 的资产 URL。 */
test.runIf(isBuild)('assets inside <noscript> is rewrote', async () => {
  const indexHtml = readFile('./dist/foo/index.html')
  expect(indexHtml).toMatch(
    /<img class="noscript" src="\/foo\/bar\/assets\/asset-[-\w]+\.png" \/>/,
  )
})

/** build 直接检查 HTML，template 内图片也改写为带 hash 的资产 URL。 */
test.runIf(isBuild)('assets inside <template> is rewrote', async () => {
  const indexHtml = readFile('./dist/foo/index.html')
  expect(indexHtml).toMatch(
    /<img class="template" src="\/foo\/bar\/assets\/asset-[-\w]+\.png" \/>/,
  )
})
