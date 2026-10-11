import { beforeAll, describe, expect, test } from 'vitest'
import {
  browserLogs,
  editFile,
  getColor,
  isBuild,
  isBundled,
  isServe,
  page,
  serverLogs,
  untilBrowserLogAfter,
  viteServer,
  viteTestUrl,
} from '~utils'

/**
 * 本 playground 同时在 unbundled dev、bundled dev 与 build 运行：浏览器断言验证最终 DOM/执行顺序，
 * serverLogs 与模块图断言补充验证 HTML transform 的服务端协议。
 */

/** 用 HTML Accept 请求路径，覆盖 fallback 对真实文件、目录与 SPA 入口的选择。 */
function fetchHtml(p: string) {
  return fetch(viteTestUrl + p, {
    headers: { Accept: 'text/html,*/*' },
  })
}

/**
 * 复用根页/嵌套页契约：验证 pre/normal/post hook 串行结果、四种标签注入位置、CSS 与相对资源。
 */
function testPage(isNested: boolean) {
  /** pre hook 为片段 HTML 补 head/viewport；检查最终 DOM 中该 meta，钩子若在 client 注入后运行会由 fixture 主动报错。 */
  test('pre transform', async () => {
    expect(await page.$('head meta[name=viewport]')).toBeTruthy()
  })

  /** normal hook 将根页 Hello 改成 Transformed；嵌套页原有 Nested 不匹配替换规则，保持原文。 */
  test('string transform', async () => {
    expect(await page.textContent('h1')).toBe(
      isNested ? 'Nested' : 'Transformed',
    )
  })

  /** tags-only 返回值分别使用默认 head-prepend 与显式 head；两份 meta 都应带上声明的 content。 */
  test('tags transform', async () => {
    const el = await page.$('head meta[name=description]')
    expect(await el.getAttribute('content')).toBe('a vite app')

    const kw = await page.$('head meta[name=keywords]')
    expect(await kw.getAttribute('content')).toBe('es modules')
  })

  /** combined hook 同时替换标题占位符并注入 body 段落；两项断言核对 html 与 tags 都被应用。 */
  test('combined transform', async () => {
    expect(await page.title()).toBe('Test HTML transforms')
    // 组合返回值中的 p 应按 injectTo 注入 body，而不只是修改字符串。
    expect(await page.textContent('body p.inject')).toBe('This is injected')
  })

  /** ctx.server 仅在 unbundled HTML transform 中提供；对应段落在该模式出现，在 bundled 模式缺席。 */
  test('server only transform', async () => {
    if (!isBundled) {
      expect(await page.textContent('body p.server')).toMatch(
        'injected only when unbundled',
      )
    } else {
      expect(await page.innerHTML('body')).not.toMatch('p class="server"')
    }
  })

  /** ctx.bundle 在 bundled HTML 的 generateBundle 钩子中提供，故 build 与 bundled dev 都注入对应段落。 */
  test('build only transform', async () => {
    if (isBundled) {
      expect(await page.textContent('body p.build')).toMatch(
        'injected only when bundled',
      )
    } else {
      expect(await page.innerHTML('body')).not.toMatch('p class="build"')
    }
  })

  /** 同一钩子按 ctx.path 中是否含 nested 决定注入；根入口缺少该段落，嵌套入口存在。 */
  test('conditional transform', async () => {
    if (isNested) {
      expect(await page.textContent('body p.conditional')).toMatch(
        'injected only for /nested/',
      )
    } else {
      expect(await page.innerHTML('body')).not.toMatch('p class="conditional"')
    }
  })

  /** body-prepend 和 body 分别插到正文前后；检查序列化后的 noscript 注释顺序，不能颠倒两个位置。 */
  test('body prepend/append transform', async () => {
    expect(await page.innerHTML('body')).toMatch(
      /prepended to body(.*)appended to body/s,
    )
  })

  /** 根页与嵌套页加载各自 CSS，标题分别为蓝/红；共同样式把段落设为灰色。 */
  test('css', async () => {
    await expect.poll(() => getColor('h1')).toBe(isNested ? 'red' : 'blue')
    await expect.poll(() => getColor('p')).toBe('grey')
  })

  if (isNested) {
    /** 嵌套 HTML 使用相对 JS/CSS URL；脚本写入 hello、样式变红，验证资源基准仍是该 HTML 所在目录。 */
    test('relative path in html asset', async () => {
      expect(await page.textContent('.relative-js')).toMatch('hello')
      expect(await getColor('.relative-css')).toMatch('red')
    })
  }
}

describe('main', () => {
  /** 根入口额外验证 HTML 注释保留、vite-ignore 消费与 external 脚本不被错误打包。 */
  testPage(false)

  /** HTML 转换只改脚本和资源等目标范围；正文中的两条普通注释应保持在最终 DOM。 */
  test('preserve comments', async () => {
    const html = await page.innerHTML('body')
    expect(html).toMatch(`<!-- comment one -->`)
    expect(html).toMatch(`<!-- comment two -->`)
  })

  /** vite-ignore 让自定义中间件提供的 JS/CSS 保持运行时 URL，控制属性被删除；脚本、样式都生效且没有转换失败警告。 */
  test('external paths works with vite-ignore attribute', async () => {
    expect(await page.textContent('.external-path')).toBe('works')
    expect(await page.getAttribute('.external-path', 'vite-ignore')).toBe(null)
    expect(await getColor('.external-path')).toBe('red')
    if (isServe) {
      expect(serverLogs).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching('Failed to load url /external-path.js'),
        ]),
      )
    } else {
      expect(serverLogs).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /"\/external-path\.js".*can't be bundled without type="module" attribute/,
          ),
        ]),
      )
    }
  })

  /** build pre hook 注入被 rolldownOptions.external 排除的模块脚本；产物保留运行时 URL，自定义 preview 中间件提供脚本。 */
  test.runIf(isBuild)(
    'external paths by rolldownOptions.external works',
    async () => {
      expect(await page.textContent('.external-path-by-rollup-options')).toBe(
        'works',
      )
      expect(serverLogs).not.toEqual(
        expect.arrayContaining([expect.stringContaining('Could not load')]),
      )
    },
  )
})

describe('nested', () => {
  /** 嵌套目录验证相对 JS/CSS 以 HTML 所在目录为基准。 */
  beforeAll(async () => {
    await page.goto(viteTestUrl + '/nested/')
  })

  testPage(true)
})

describe('nested w/ query', () => {
  /** HTML 自身 query 不应污染相对资源解析基准。 */
  beforeAll(async () => {
    await page.goto(viteTestUrl + '/nested/index.html?v=1')
  })

  testPage(true)
})

describe.runIf(isBuild)('build', () => {
  /** 构建专属：模块脚本 async/defer 合并、零 JS 与入口 chunk 消去策略。 */
  describe('scriptAsync', () => {
    beforeAll(async () => {
      await page.goto(viteTestUrl + '/scriptAsync.html')
    })

    /** 所有 module script 都带 async，构建生成的脚本继续带 async，不出现普通 defer module 标签。 */
    test('script is async', async () => {
      expect(await page.$('head script[type=module][async]')).toBeTruthy()
      expect(await page.$('head script[type=module]:not([async])')).toBeNull()
    })
  })

  describe('scriptMixed', () => {
    beforeAll(async () => {
      await page.goto(viteTestUrl + '/scriptMixed.html')
    })

    /** 入口混合 async 与普通 module script；合并后的输出统一采用默认 defer 语义，不带 async。 */
    test('script is mixed', async () => {
      expect(await page.$('head script[type=module][async]')).toBeNull()
      expect(await page.$('head script[type=module]:not([async])')).toBeTruthy()
    })
  })

  describe('zeroJS', () => {
    // 没有任何业务 JS 时，modulePreload polyfill 也应随空入口一起消失。

    beforeAll(async () => {
      await page.goto(viteTestUrl + '/zeroJS.html')
    })

    /** 页面只含 CSS，没有业务模块脚本；构建不注入 modulepreload polyfill，也不保留空入口 script。 */
    test('zeroJS', async () => {
      expect(await page.$('head script[type=module]')).toBeNull()
    })
  })

  describe('inline entry', () => {
    // 纯 import 入口可消去为后序 script 列表；含实际代码的入口保留，并 preload 静态依赖。
    /** 统计当前 HTML 中匹配选择器的 script 或 modulepreload 标签数量。 */
    const _countTags = (selector) => page.$$eval(selector, (t) => t.length)
    const countScriptTags = _countTags.bind(this, 'script[type=module]')
    const countPreloadTags = _countTags.bind(this, 'link[rel=modulepreload]')

    /** 共享脚本的入口只剩 side-effect imports，ES 输出可消去入口空壳，改为多个 module script 且不额外 preload。 */
    test('is inlined', async () => {
      await page.goto(viteTestUrl + '/inline/shared-2.html?v=1')
      expect(await countScriptTags()).toBeGreaterThan(1)
      expect(await countPreloadTags()).toBe(0)
    })

    /** unique 入口保留实际代码，输出一个入口 script，并为静态依赖生成 modulepreload。 */
    test('is not inlined', async () => {
      await page.goto(viteTestUrl + '/inline/unique.html?v=1')
      expect(await countScriptTags()).toBe(1)
      expect(await countPreloadTags()).toBeGreaterThan(0)
    })

    /** 两个被消去的入口都应按依赖后序执行，页面记录 dep1、common、dep2、dep3、shared 的顺序。 */
    test('execution order when inlined', async () => {
      await page.goto(viteTestUrl + '/inline/shared-1.html?v=1')
      expect((await page.textContent('#output')).trim()).toBe(
        'dep1 common dep2 dep3 shared',
      )
      await page.goto(viteTestUrl + '/inline/shared-2.html?v=1')
      expect((await page.textContent('#output')).trim()).toBe(
        'dep1 common dep2 dep3 shared',
      )
    })

    /** 保留入口 chunk 时，模块系统仍先执行依赖；页面记录 dep1、common、dep2、unique 的顺序。 */
    test('execution order when not inlined', async () => {
      await page.goto(viteTestUrl + '/inline/unique.html?v=1')
      expect((await page.textContent('#output')).trim()).toBe(
        'dep1 common dep2 unique',
      )
    })
  })
})

describe('noHead', () => {
  /** 缺少 head 时验证 head/head-prepend 标签走 html/doctype 回退，而不是丢失。 */
  beforeAll(async () => {
    await page.goto(viteTestUrl + '/noHead.html')
  })

  /** 输入没有 head，head/head-prepend 标签按各自回退规则注入；浏览器 DOM 中仍能找到两份 meta 及正确值。 */
  test('noHead tags injection', async () => {
    const el = await page.$('html meta[name=description]')
    expect(await el.getAttribute('content')).toBe('a vite app')

    const kw = await page.$('html meta[name=keywords]')
    expect(await kw.getAttribute('content')).toBe('es modules')
  })
})

describe('noBody', () => {
  /** 缺少 body 时验证 body-prepend/body 的降级注入位置与顺序。 */
  beforeAll(async () => {
    await page.goto(viteTestUrl + '/noBody.html')
  })

  /** 输入没有 body，body-prepend 回退到 head 后，body 标签追加到文档末端；浏览器构建 DOM 后仍保留前后顺序。 */
  test('noBody tags injection', async () => {
    // 浏览器会为输出片段建立 body；这里检查 body-prepend 注入的首个 noscript。
    const el = await page.$('body noscript')
    expect(await el.innerHTML()).toMatch(`<!-- this is prepended to body -->`)

    const kw = await page.$('html:last-child')
    expect(await kw.innerHTML()).toMatch(`<!-- this is appended to body -->`)
  })
})

describe('Unicode path', () => {
  /** 导航到完整 Unicode 文件名，URL 解码后应选中该 HTML，标题为 Unicode path。 */
  test('direct access', async () => {
    await page.goto(
      viteTestUrl + '/unicode-path/中文-にほんご-한글-🌕🌖🌗/index.html',
    )
    expect(await page.textContent('h1')).toBe('Unicode path')
  })

  /** 导航到 Unicode 目录并带尾斜杠，由 HTML fallback 选中该目录的 index.html。 */
  test('spa fallback', async () => {
    await page.goto(viteTestUrl + '/unicode-path/中文-にほんご-한글-🌕🌖🌗/')
    expect(await page.textContent('h1')).toBe('Unicode path')
  })
})

describe('link with props', () => {
  /** 两个 stylesheet 带不同 media 条件，不能合并成无条件入口 import；浏览器应用当前媒体匹配的规则后标题为红色。 */
  test('separate links with different media props', async () => {
    await page.goto(viteTestUrl + '/link-props/index.html')
    expect(await getColor('h1')).toBe('red')
  })
})

describe.runIf(isServe)('SPA fallback', () => {
  /** 导航 /test 的 Accept 表示页面请求，即使存在 test.js，仍进入 HTML fallback 返回根入口。 */
  test('should serve index.html via page navigation even when path matches file basename', async () => {
    const response = await page.goto(viteTestUrl + '/test')
    expect(response.status()).toBe(200)
    const content = await page.content()
    expect(content).toContain('Transformed')
    expect(content).not.toContain('This is test.js')
  })
})

describe.runIf(!isBundled)('invalid', () => {
  /** 仅在 unbundled dev 请求畸形 HTML；默认测试 harness 的 throwHtmlParseError 将解析 warning 升为异常，响应应为 500 且 overlay 显示解析诊断。 */
  test('should be 500 with overlay', async () => {
    const response = await page.goto(viteTestUrl + '/invalid.html')
    expect(response.status()).toBe(500)

    const errorOverlay = await page.waitForSelector('vite-error-overlay')
    expect(errorOverlay).toBeTruthy()

    const message = await errorOverlay.$$eval('.message-body', (m) => {
      return m[0].innerHTML
    })
    expect(message).toContain('Unable to parse HTML')
  })

  /** 请求 invalidClick.html 后，harness 将解析 warning 升为异常并显示 overlay；点击文档后它应隐藏。 */
  test('should close overlay when clicked away', async () => {
    await page.goto(viteTestUrl + '/invalidClick.html')
    const errorOverlay = await page.waitForSelector('vite-error-overlay')
    expect(errorOverlay).toBeTruthy()

    await page.click('html')
    const isVisibleOverlay = await errorOverlay.isVisible()
    expect(isVisibleOverlay).toBeFalsy()
  })

  /** 请求 invalidEscape.html 由 harness 创建解析错误 overlay；按 Escape 后 overlay 应隐藏。 */
  test('should close overlay when escape key is pressed', async () => {
    await page.goto(viteTestUrl + '/invalidEscape.html')
    const errorOverlay = await page.waitForSelector('vite-error-overlay')
    expect(errorOverlay).toBeTruthy()

    await page.keyboard.press('Escape')
    const isVisibleOverlay = await errorOverlay.isVisible()
    expect(isVisibleOverlay).toBeFalsy()
  })

  /** 先请求畸形 HTML 显示 harness 触发的 overlay 并用 Escape 关闭；再发送新 HMR error，新 overlay 应替换为 someError 的 stack。 */
  test('stack is updated', async () => {
    await page.goto(viteTestUrl + '/invalid.html')

    const errorOverlay = await page.waitForSelector('vite-error-overlay')
    const hiddenPromise = errorOverlay.waitForElementState('hidden')
    await page.keyboard.press('Escape')
    await hiddenPromise

    viteServer.environments.client.hot.send({
      type: 'error',
      err: {
        message: 'someError',
        stack: [
          'Error: someError',
          '    at someMethod (/some/file.ts:1:2)',
        ].join('\n'),
      },
    })
    const newErrorOverlay = await page.waitForSelector('vite-error-overlay')
    const stack = await newErrorOverlay.$$eval('.stack', (m) => m[0].innerHTML)
    expect(stack).toMatch(/^Error: someError/)
  })

  /** 建立 HMR 连接后把畸形标签改成有效 HTML，等待页面重新加载并显示 Good HTML。 */
  test('should reload when fixed', async () => {
    await untilBrowserLogAfter(
      () => page.goto(viteTestUrl + '/invalid.html'),
      /connected/, // 等待 HMR 连接建立。
    )
    editFile('invalid.html', (content) => {
      return content.replace('<div Bad', '<div> Good')
    })
    const content = await page.waitForSelector('text=Good HTML')
    expect(content).toBeTruthy()
  })
})

describe('Valid HTML', () => {
  /** 无引号属性仍可读取；重复属性采用第一项，因此对应元素的有效样式为绿色。 */
  test('valid HTML is parsed', async () => {
    await page.goto(viteTestUrl + '/valid.html')
    expect(await page.textContent('#no-quotes-on-attr')).toBe(
      'No quotes on Attr working',
    )

    expect(await getColor('#duplicated-attrs')).toBe('green')
  })
})

describe('env', () => {
  /** `%ENV%` 同时读取 env 文件、mode 值与 import.meta.env define，并正确改写 public 资源 base。 */
  beforeAll(async () => {
    await page.goto(viteTestUrl + '/env.html')
  })

  /** HTML env hook 替换公开 env、mode 内置值与 define 值，并按 dev/build base 改写 public 图标 URL。 */
  test('env works', async () => {
    expect(await page.textContent('.env')).toBe('bar')
    expect(await page.textContent('.env-define')).toBe('5173')
    expect(await page.textContent('.env-define-string')).toBe('string')
    expect(await page.textContent('.env-define-object-string')).toBe(
      '{ "foo": "bar" }',
    )
    expect(await page.textContent('.env-define-null-string')).toBe('null')
    expect(await page.textContent('.env-bar')).toBeTruthy()
    expect(await page.textContent('.env-prod')).toBe(isBuild + '')
    expect(await page.textContent('.env-dev')).toBe(isServe + '')

    const iconLink = await page.$('link[rel=icon]')
    expect(await iconLink.getAttribute('href')).toBe(
      `${isBuild ? './' : '/'}sprite.svg`,
    )
  })
})

describe('importmap', () => {
  /** import map 必须在任何 module script 触发加载前出现，浏览器日志用于捕获真实顺序警告。 */
  beforeAll(async () => {
    await page.goto(viteTestUrl + '/importmapOrder.html')
  })

  // 放在该页面其他行为完成后检查，确保收集到完整浏览器日志。
  /** 用户 import map 原本晚于模块资源；收尾 hook 前移后，浏览器日志不应出现晚注册 import map 的警告。 */
  test('importmap should be prepended', async () => {
    expect(browserLogs).not.toContain(
      'An import map is added after module script load was triggered.',
    )
  })
})

describe('side-effects', () => {
  /** HTML 明确引用的模块即使 package 标为无副作用也不能被 tree-shake。 */
  beforeAll(async () => {
    await page.goto(viteTestUrl + '/side-effects/')
  })

  /** fixture package 标记 sideEffects:false，但 HTML 直接引用的脚本仍必须执行并输出日志。 */
  test('console.log is not tree-shaken', async () => {
    expect(browserLogs).toContain('message from sideEffects script')
  })
})

describe('special character', () => {
  /** 含空格/非 ASCII 的 HTML 文件名仍须生成与命中一致的 html-proxy key。 */
  beforeAll(async () => {
    await page.goto(viteTestUrl + '/a á.html')
  })

  /** HTML 文件名含空格和非 ASCII 字符；内联 module proxy 正确加载后输出 special character。 */
  test('should fetch html proxy', async () => {
    expect(browserLogs).toContain('special character')
  })
})

describe('relative input', () => {
  /** 构建 input 使用相对路径时，facadeModuleId 仍能回配正确 HTML 入口。 */
  beforeAll(async () => {
    await page.goto(viteTestUrl + '/relative-input.html')
  })

  /** input 使用相对 process.cwd 的路径；解析和 HTML 入口回配成功后，页面脚本写入 OK。 */
  test('passing relative path to rolldownOptions.input works', async () => {
    await expect.poll(() => page.textContent('.relative-input')).toBe('OK')
  })
})

describe.runIf(!isBundled)('warmup', () => {
  /** 配置 server.warmup.clientFiles 后轮询 /warmup/warm.js 的节点，确认启动预热已将其登记入图。 */
  test('should warmup /warmup/warm.js', async () => {
    // 启动预热异步执行，轮询模块图而不是假定固定完成时间。
    await expect
      .poll(() =>
        viteServer.environments.client.moduleGraph.getModuleByUrl(
          '/warmup/warm.js',
        ),
      )
      .toBeTruthy()
  })
})

/** 同时请求无斜杠、尾斜杠和显式 .html URL；按实际文件、目录 index 与 SPA fallback 的优先级核对响应内容。 */
test('html serve behavior', async () => {
  // 场景：同名 `.html` 文件、目录 index 与 SPA fallback 同时存在；目标是固定无斜杠/有斜杠的
  // 选择优先级。并发请求可避免不同导航之间的页面状态干扰结果。
  const [
    file,
    fileSlash,
    fileDotHtml,

    folder,
    folderSlash,
    folderSlashIndexHtml,

    both,
    bothSlash,
    bothDotHtml,
    bothSlashIndexHtml,
  ] = await Promise.all([
    fetchHtml('/serve/file'), // → serve/file.html
    fetchHtml('/serve/file/'), // → SPA fallback 的 index.html（MPA 中为 404）。
    fetchHtml('/serve/file.html'), // → serve/file.html

    fetchHtml('/serve/folder'), // → SPA fallback 的 index.html（MPA 中为 404）。
    fetchHtml('/serve/folder/'), // → serve/folder/index.html
    fetchHtml('/serve/folder/index.html'), // → serve/folder/index.html

    fetchHtml('/serve/both'), // → serve/both.html
    fetchHtml('/serve/both/'), // → serve/both/index.html
    fetchHtml('/serve/both.html'), // → serve/both.html
    fetchHtml('/serve/both/index.html'), // → serve/both/index.html
  ])

  expect(file.status).toBe(200)
  expect(await file.text()).toContain('file.html')
  expect(fileSlash.status).toBe(200)
  expect(await fileSlash.text()).toContain('index.html (fallback)')
  expect(fileDotHtml.status).toBe(200)
  expect(await fileDotHtml.text()).toContain('file.html')

  expect(folder.status).toBe(200)
  expect(await folder.text()).toContain('index.html (fallback)')
  expect(folderSlash.status).toBe(200)
  expect(await folderSlash.text()).toContain('folder/index.html')
  expect(folderSlashIndexHtml.status).toBe(200)
  expect(await folderSlashIndexHtml.text()).toContain('folder/index.html')

  expect(both.status).toBe(200)
  expect(await both.text()).toContain('both.html')
  expect(bothSlash.status).toBe(200)
  expect(await bothSlash.text()).toContain('both/index.html')
  expect(bothDotHtml.status).toBe(200)
  expect(await bothDotHtml.text()).toContain('both.html')
  expect(bothSlashIndexHtml.status).toBe(200)
  expect(await bothSlashIndexHtml.text()).toContain('both/index.html')
})

/** 空 Accept、fetch 默认的全类型 Accept 与 axios 常见 Accept 都应命中根 SPA HTML，用于 CLI 探活。 */
test('html fallback works non browser accept header', async () => {
  // CLI 探活工具常用 `*/*` 或 axios 默认 Accept；根 SPA 不应只对浏览器式 text/html 工作。
  expect((await fetch(viteTestUrl, { headers: { Accept: '' } })).status).toBe(
    200,
  )
  // fetch 默认发送 `Accept: */*`。
  expect((await fetch(viteTestUrl)).status).toBe(200)
  // wait-on 使用 axios，常见 Accept 如下。
  expect(
    (
      await fetch(viteTestUrl, {
        headers: { Accept: 'application/json, text/plain, */*' },
      })
    ).status,
  ).toBe(200)
})

/** post hook 的 href 含可闭合属性的文本；序列化转义后浏览器不应生成额外 .unescape-div 元素。 */
test('escape html attribute', async () => {
  // 结构化标签属性必须转义，否则恶意值可闭合属性并注入额外元素。
  const el = await page.$('.unescape-div')
  expect(el).toBeNull()
})

/** pre hook 每次为内联脚本生成新的随机 DOM id；连续 reload 必须失效同 URL 的代理节点，脚本才能匹配本轮元素并写入 ok。 */
test('invalidate inline proxy module on reload', async () => {
  // 连续 reload 会重新生成同 URL 的内联代理；每轮都需失效旧 ModuleNode 后读取最新缓存。
  await page.goto(`${viteTestUrl}/transform-inline-js`)
  expect(await page.textContent('.test')).toContain('ok')
  await page.reload()
  expect(await page.textContent('.test')).toContain('ok')
  await page.reload()
  expect(await page.textContent('.test')).toContain('ok')
})

/** src 含无法 decodeURI 的值时只跳过预热，HTML 仍响应并运行状态脚本，服务端不输出 Internal server error: URI malformed。 */
test.runIf(isServe)(
  'malformed URLs in src attributes should show errors',
  async () => {
    // 畸形 src 只能跳过预热，不能让整份 HTML 返回内部 URIError。
    serverLogs.length = 0
    await page.goto(`${viteTestUrl}/malformed-url.html`)
    expect(await page.textContent('.status')).toContain(
      'Page loaded successfully',
    )
    expect(serverLogs).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching('Internal server error: URI malformed'),
      ]),
    )
  },
)
