import { beforeAll, describe, expect, test } from 'vitest'
import {
  browserLogs,
  findAssetFile,
  getBg,
  getColor,
  isBuild,
  page,
} from '~utils'

/** 运行时 base 变体：本文件以 isBuild 区分 other-assets 哈希路径和开发源路径，部分 new URL 求值另核对绝对 http URL。 */
const absoluteAssetMatch = isBuild
  ? /\/other-assets\/asset-[-\w]{8}\.png/
  : '/nested/asset.png'

/** 计算背景与普通资产使用同一匹配模式；浏览器已经将相对 CSS URL 绝对化。 */
const cssBgAssetMatch = absoluteAssetMatch

/** CSS public 图标匹配稳定的 /icon.png 路径。 */
const iconMatch = `/icon.png`

/** 动态 new URL 中小图标的预期 URL 模式，按当前构建/开发条件选择哈希路径或源路径。 */
const absoluteIconMatch = isBuild
  ? /\/other-assets\/icon-[-\w]{8}\.png/
  : '/nested/icon.png'

/** JS public 图标导出的预期路径，构建带对应 base，开发保留 /icon.png。 */
const absolutePublicIconMatch = isBuild ? /\/icon\.png/ : '/icon.png'

/** 场景：此 base 变体页面已加载；遍历浏览器日志，核对没有 404 文本。 */
test('should have no 404s', () => {
  browserLogs.forEach((msg) => {
    expect(msg).not.toMatch('404')
  })
})

describe('raw references from /public', () => {
  /** 场景：public 原始脚本已加载；读取 .raw-js，核对含 [success] 执行消息。 */
  test('load raw js from /public', async () => {
    expect(await page.textContent('.raw-js')).toMatch('[success]')
  })

  /** 场景：public 原始 CSS 由 link 加载；读取 .raw-css 计算颜色，核对红色。 */
  test('load raw css from /public', async () => {
    expect(await getColor('.raw-css')).toBe('red')
  })
})

/** 场景：普通 script 内含两个动态导入；读取 .import-expression，核对两个 [success] 均写入。 */
test('import-expression from simple script', async () => {
  expect(await page.textContent('.import-expression')).toMatch(
    '[success][success]',
  )
})

describe('asset imports from js', () => {
  /** 场景：JS 相对路径导入 PNG；读取 .asset-import-relative，核对匹配本变体常量定义的源路径或哈希资产 URL。 */
  test('relative', async () => {
    expect(await page.textContent('.asset-import-relative')).toMatch(
      cssBgAssetMatch,
    )
  })

  /** 场景：JS 根绝对路径导入同一 PNG；读取 .asset-import-absolute，核对与相对导入的预期 URL 一致。 */
  test('absolute', async () => {
    expect(await page.textContent('.asset-import-absolute')).toMatch(
      cssBgAssetMatch,
    )
  })

  /** 场景：JS 导入 public 图标；读取 .public-import，核对 absolutePublicIconMatch 的构建 base URL/开发根路径分支。 */
  test('from /public', async () => {
    expect(await page.textContent('.public-import')).toMatch(
      absolutePublicIconMatch,
    )
  })
})

describe('css url() references', () => {
  /** 场景：CSS 字体声明位于此 base 变体；在浏览器调用 document.fonts.check(700 32px Inter)，核对返回 true。 */
  test('fonts', async () => {
    expect(
      await page.evaluate(() => {
        return (document as any).fonts.check('700 32px Inter')
      }),
    ).toBe(true)
  })

  /** 场景：CSS 相对 url 引用 PNG；读取 .css-url-relative 背景，核对与本变体 PNG URL 模式一致。 */
  test('relative', async () => {
    const bg = await getBg('.css-url-relative')
    expect(bg).toMatch(cssBgAssetMatch)
  })

  /** 场景：image-set 使用相对 url 候选；读取背景并按逗号拆候选，逐项核对 PNG URL 模式。 */
  test('image-set relative', async () => {
    const imageSet = await getBg('.css-image-set-relative')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(cssBgAssetMatch)
    })
  })

  /** 场景：image-set 用字符串候选而非 url()；读取并拆分背景，逐项核对解析后的 PNG URL。 */
  test('image-set without the url() call', async () => {
    const imageSet = await getBg('.css-image-set-without-url-call')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(cssBgAssetMatch)
    })
  })

  /** 场景：image-set 候选来自 CSS 变量；读取并拆分计算背景，核对各候选使用预期 PNG URL。 */
  test('image-set with var', async () => {
    const imageSet = await getBg('.css-image-set-with-var')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(cssBgAssetMatch)
    })
  })

  /** 场景：image-set 混合 url 与变量候选；读取并拆分计算背景，核对两类均匹配 PNG URL。 */
  test('image-set with mix', async () => {
    const imageSet = await getBg('.css-image-set-mix-url-var')
    imageSet.split(', ').forEach((s) => {
      expect(s).toMatch(cssBgAssetMatch)
    })
  })

  /** 场景：被 @import 的 CSS 使用相对资源；读取对应背景，核对资源仍按被导入文件解析。 */
  test('relative in @import', async () => {
    expect(await getBg('.css-url-relative-at-imported')).toMatch(
      cssBgAssetMatch,
    )
  })

  /** 场景：CSS 根绝对 url 引用同一 PNG；读取 .css-url-absolute 背景，核对与相对 CSS 引用预期一致。 */
  test('absolute', async () => {
    expect(await getBg('.css-url-absolute')).toMatch(cssBgAssetMatch)
  })

  /** 场景：CSS 引用 public 图标；读取 .css-url-public 背景，核对稳定 /icon.png 路径。 */
  test('from /public', async () => {
    expect(await getBg('.css-url-public')).toMatch(iconMatch)
  })

  /** 场景：同一声明含普通 PNG 和 public 图标；读取背景，核对同时含本变体 PNG 模式与 /icon.png。 */
  test('multiple urls on the same line', async () => {
    const bg = await getBg('.css-url-same-line')
    expect(bg).toMatch(cssBgAssetMatch)
    expect(bg).toMatch(iconMatch)
  })

  /** 场景：CSS url 使用别名指向 PNG；读取背景，核对与相对资源的预期 URL 一致。 */
  test('aliased', async () => {
    const bg = await getBg('.css-url-aliased')
    expect(bg).toMatch(cssBgAssetMatch)
  })
})

describe.runIf(isBuild)('index.css URLs', () => {
  let css: string
  beforeAll(() => {
    css = findAssetFile(/index-[-\w]{8}\.css$/, 'runtime-base', 'other-assets')
  })

  /** 场景：仅构建执行：beforeAll 读取 other-assets 的入口 CSS；核对资产引用为 ./asset- 相对 URL。 */
  test('relative asset URL', () => {
    expect(css).toMatch(`./asset-`)
  })

  /** 场景：仅构建执行：读取入口 CSS 文本，核对字体 URL 仍保留 woff2?#iefix 后缀。 */
  test('preserve postfix query/hash', () => {
    expect(css).toMatch(`woff2?#iefix`)
  })
})

describe('image', () => {
  /** 场景：HTML srcset 含多个本地 PNG 候选；读取属性并逐项核对对应模式的路径/哈希及密度描述符，未比较浏览器 src 绝对化结果。 */
  test('srcset', async () => {
    const img = await page.$('.img-src-set')
    const srcset = await img.getAttribute('srcset')
    srcset.split(', ').forEach((s) => {
      expect(s).toMatch(
        isBuild
          ? /other-assets\/asset-[-\w]{8}\.png \dx/
          : /\.\/nested\/asset\.png \dx/,
      )
    })
  })
})

describe('svg fragments', () => {
  // 此组只检查片段后缀；404 日志在独立用例检查。
  /** 场景：HTML SVG 引用带片段；读取 src，核对末尾 #icon-clock-view。 */
  test('img url', async () => {
    const img = await page.$('.svg-frag-img')
    expect(await img.getAttribute('src')).toMatch(/svg#icon-clock-view$/)
  })

  /** 场景：CSS SVG 背景带片段；读取计算背景，核对 URL 末尾 #icon-clock-view。 */
  test('via css url()', async () => {
    expect(await getBg('.icon')).toMatch(/svg#icon-clock-view"\)$/)
  })

  /** 场景：JS SVG 资产导入后追加片段；读取图片 src，核对末尾 #icon-heart-view。 */
  test('from js import', async () => {
    const img = await page.$('.svg-frag-import')
    expect(await img.getAttribute('src')).toMatch(/svg#icon-heart-view$/)
  })
})

/** 场景：SVG 通过 ?raw 导入；读取 .raw，核对导出文本包含 SVG。 */
test('?raw import', async () => {
  expect(await page.textContent('.raw')).toMatch('SVG')
})

/** 场景：JS 文件通过 ?url 作为资产导入；读取 .url，核对本文件 isBuild 的构建/开发分支对应的哈希输出或 /foo.js。 */
test('?url import', async () => {
  expect(await page.textContent('.url')).toMatch(
    isBuild ? /\/other-assets\/foo-[-\w]{8}\.js/ : `/foo.js`,
  )
})

/** 场景：CSS 文件通过 ?url 导入；读取 .url-css，核对本文件构建/开发分支的 icons-哈希.css 或 /css/icons.css。 */
test('?url import on css', async () => {
  const txt = await page.textContent('.url-css')
  expect(txt).toMatch(
    isBuild ? /\/other-assets\/icons-[-\w]{8}\.css/ : '/css/icons.css',
  )
})

/** 场景：静态 new URL 引用 img.png；读取 .import-meta-url，核对本文件模式分支的资产 URL，不检查 URL 对象身份。 */
test('new URL(..., import.meta.url)', async () => {
  const absoluteImgMatch = isBuild
    ? /http.*\/other-assets\/img-[-\w]{8}\.png/
    : '/import-meta-url/img.png'
  expect(await page.textContent('.import-meta-url')).toMatch(absoluteImgMatch)
})

/** 场景：动态模板分别选择小图标与较大 PNG；读取两 DOM 文本，核对 absoluteIconMatch 与普通资产 URL 模式。 */
test('new URL(`${dynamic}`, import.meta.url)', async () => {
  const dynamic1 = await page.textContent('.dynamic-import-meta-url-1')
  expect(dynamic1).toMatch(absoluteIconMatch)
  const dynamic2 = await page.textContent('.dynamic-import-meta-url-2')
  expect(dynamic2).toMatch(absoluteAssetMatch)
})

/** 场景：new URL 指向不存在的路径；读取求值结果文本，核对仍包含 /non-existent，不发出实际资源请求断言。 */
test('new URL(`non-existent`, import.meta.url)', async () => {
  expect(await page.textContent('.non-existent-import-meta-url')).toMatch(
    '/non-existent',
  )
})

/** 场景：HTML style 属性与 style 标签分别引用 PNG；读取两背景，核对均符合本变体资产 URL 模式。 */
test('inline style test', async () => {
  expect(await getBg('.inline-style')).toMatch(cssBgAssetMatch)
  expect(await getBg('.style-url-assets')).toMatch(cssBgAssetMatch)
})

/** 场景：普通脚本含对象 import 方法和含 import 的字符串；读取两 DOM，核对 object import prop 消息与 no load 文本，避免误提取为动态导入。 */
test('html import word boundary', async () => {
  expect(await page.textContent('.obj-import-express')).toMatch(
    'ignore object import prop',
  )
  expect(await page.textContent('.string-import-express')).toMatch('no load')
})

/** 场景：HTML 相对 script/link 路径加载；读取文本和颜色，核对 hello 与红色样式。 */
test('relative path in html asset', async () => {
  expect(await page.textContent('.relative-js')).toMatch('hello')
  expect(await getColor('.relative-css')).toMatch('red')
})
