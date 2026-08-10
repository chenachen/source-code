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
  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.$('head meta[name=viewport]')”。
   * 验证目标：“await page.$('head meta[name=viewport]')” 应为真，从而确认transformIndexHtml 钩子阶段与 tag 注入位置正确。
   */
  test('pre transform', async () => {
    expect(await page.$('head meta[name=viewport]')).toBeTruthy()
  })

  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('h1')”。
   * 验证目标：“await page.textContent('h1')” 应等于 “isNested ? 'Nested' : 'Transformed'”，从而确认transformIndexHtml 钩子阶段与 tag 注入位置正确。
   */
  test('string transform', async () => {
    expect(await page.textContent('h1')).toBe(
      isNested ? 'Nested' : 'Transformed',
    )
  })

  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “await el.getAttribute('content')”。
   * 验证目标：“await el.getAttribute('content')” 应等于 “'a vite app'”；“await kw.getAttribute('content')” 应等于 “'es modules'”，从而确认transformIndexHtml 钩子阶段与 tag 注入位置正确。
   */
  test('tags transform', async () => {
    const el = await page.$('head meta[name=description]')
    expect(await el.getAttribute('content')).toBe('a vite app')

    const kw = await page.$('head meta[name=keywords]')
    expect(await kw.getAttribute('content')).toBe('es modules')
  })

  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.title()”。
   * 验证目标：“await page.title()” 应等于 “'Test HTML transforms'”；“await page.textContent('body p.inject')” 应等于 “'This is injected'”，从而确认transformIndexHtml 钩子阶段与 tag 注入位置正确。
   */
  test('combined transform', async () => {
    expect(await page.title()).toBe('Test HTML transforms')
    // 组合返回值中的 p 应按 injectTo 注入 body，而不只是修改字符串。
    expect(await page.textContent('body p.inject')).toBe('This is injected')
  })

  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('body p.server')”。
   * 验证目标：“await page.textContent('body p.server')” 应匹配 “'injected only when unbundled'”；“await page.innerHTML('body')” 不应匹配 “'p class="server"'”，从而确认transformIndexHtml 钩子阶段与 tag 注入位置正确。
   */
  test('server only transform', async () => {
    if (!isBundled) {
      expect(await page.textContent('body p.server')).toMatch(
        'injected only when unbundled',
      )
    } else {
      expect(await page.innerHTML('body')).not.toMatch('p class="server"')
    }
  })

  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('body p.build')”。
   * 验证目标：“await page.textContent('body p.build')” 应匹配 “'injected only when bundled'”；“await page.innerHTML('body')” 不应匹配 “'p class="build"'”，从而确认transformIndexHtml 钩子阶段与 tag 注入位置正确。
   */
  test('build only transform', async () => {
    if (isBundled) {
      expect(await page.textContent('body p.build')).toMatch(
        'injected only when bundled',
      )
    } else {
      expect(await page.innerHTML('body')).not.toMatch('p class="build"')
    }
  })

  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('body p.conditional')”。
   * 验证目标：“await page.textContent('body p.conditional')” 应匹配 “'injected only for /nested/'”；“await page.innerHTML('body')” 不应匹配 “'p class="conditional"'”，从而确认transformIndexHtml 钩子阶段与 tag 注入位置正确。
   */
  test('conditional transform', async () => {
    if (isNested) {
      expect(await page.textContent('body p.conditional')).toMatch(
        'injected only for /nested/',
      )
    } else {
      expect(await page.innerHTML('body')).not.toMatch('p class="conditional"')
    }
  })

  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.innerHTML('body')”。
   * 验证目标：“await page.innerHTML('body')” 应匹配 “/prepended to body(.*)appended to body/s”，从而确认transformIndexHtml 钩子阶段与 tag 注入位置正确。
   */
  test('body prepend/append transform', async () => {
    expect(await page.innerHTML('body')).toMatch(
      /prepended to body(.*)appended to body/s,
    )
  })

  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “getColor('h1')”。
   * 验证目标：“getColor('h1')” 应等于 “isNested ? 'red' : 'blue'”；“getColor('p')” 应等于 “'grey'”，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
   */
  test('css', async () => {
    await expect.poll(() => getColor('h1')).toBe(isNested ? 'red' : 'blue')
    await expect.poll(() => getColor('p')).toBe('grey')
  })

  if (isNested) {
    /**
     * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.relative-js')”。
     * 验证目标：“await page.textContent('.relative-js')” 应匹配 “'hello'”；“await getColor('.relative-css')” 应匹配 “'red'”，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
     */
    test('relative path in html asset', async () => {
      expect(await page.textContent('.relative-js')).toMatch('hello')
      expect(await getColor('.relative-css')).toMatch('red')
    })
  }
}

describe('main', () => {
  /** 根入口额外验证 HTML 注释保留、vite-ignore 消费与 external 脚本不被错误打包。 */
  testPage(false)

  /**
   * 场景：在 “'main'” 中，加载用例 fixture 并观察 “html”。
   * 验证目标：“html” 应匹配 “'<!-- comment one -->'”；“html” 应匹配 “'<!-- comment two -->'”，从而确认HTML 静态命中、SPA fallback 和 Accept 分流正确。
   */
  test('preserve comments', async () => {
    const html = await page.innerHTML('body')
    expect(html).toMatch(`<!-- comment one -->`)
    expect(html).toMatch(`<!-- comment two -->`)
  })

  /**
   * 场景：在 “'main'” 中，加载用例 fixture 并观察 “await page.textContent('.external-path')”。
   * 验证目标：“await page.textContent('.external-path')” 应等于 “'works'”；“await page.getAttribute('.external-path', 'vite-ignore')” 应等于 “null”，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
   */
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

  /**
   * 场景：在 “'main'” 中，加载用例 fixture 并观察 “await page.textContent('.external-path-by-rollup-options')”。
   * 验证目标：“await page.textContent('.external-path-by-rollup-options')” 应等于 “'works'”；“serverLogs” 不应深度等于 “expect.arrayContaining([expect.stringContaining('Could not load')])”，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
   */
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

    /**
     * 场景：在 “'build'” / “'scriptAsync'” 中，加载用例 fixture 并观察 “await page.$('head script[type=module][async]')”。
     * 验证目标：“await page.$('head script[type=module][async]')” 应为真；“await page.$('head script[type=module]:not([async])')” 应为 null，从而确认模块预加载内联策略与脚本执行顺序稳定。
     */
    test('script is async', async () => {
      expect(await page.$('head script[type=module][async]')).toBeTruthy()
      expect(await page.$('head script[type=module]:not([async])')).toBeNull()
    })
  })

  describe('scriptMixed', () => {
    beforeAll(async () => {
      await page.goto(viteTestUrl + '/scriptMixed.html')
    })

    /**
     * 场景：在 “'build'” / “'scriptMixed'” 中，加载用例 fixture 并观察 “await page.$('head script[type=module][async]')”。
     * 验证目标：“await page.$('head script[type=module][async]')” 应为 null；“await page.$('head script[type=module]:not([async])')” 应为真，从而确认模块预加载内联策略与脚本执行顺序稳定。
     */
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

    /**
     * 场景：在 “'build'” / “'zeroJS'” 中，加载用例 fixture 并观察 “await page.$('head script[type=module]')”。
     * 验证目标：“await page.$('head script[type=module]')” 应为 null，从而确认模块预加载内联策略与脚本执行顺序稳定。
     */
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

    /**
     * 场景：在 “'build'” / “'inline entry'” 中，导航到 “page.goto(viteTestUrl + '/inline/shared-2.html?v=1')”。
     * 验证目标：“await countScriptTags()” 应大于 “1”；“await countPreloadTags()” 应等于 “0”，从而确认模块预加载内联策略与脚本执行顺序稳定。
     */
    test('is inlined', async () => {
      await page.goto(viteTestUrl + '/inline/shared-2.html?v=1')
      expect(await countScriptTags()).toBeGreaterThan(1)
      expect(await countPreloadTags()).toBe(0)
    })

    /**
     * 场景：在 “'build'” / “'inline entry'” 中，导航到 “page.goto(viteTestUrl + '/inline/unique.html?v=1')”。
     * 验证目标：“await countScriptTags()” 应等于 “1”；“await countPreloadTags()” 应大于 “0”，从而确认模块预加载内联策略与脚本执行顺序稳定。
     */
    test('is not inlined', async () => {
      await page.goto(viteTestUrl + '/inline/unique.html?v=1')
      expect(await countScriptTags()).toBe(1)
      expect(await countPreloadTags()).toBeGreaterThan(0)
    })

    /**
     * 场景：在 “'build'” / “'inline entry'” 中，导航到 “page.goto(viteTestUrl + '/inline/shared-1.html?v=1')”，然后导航到 “page.goto(viteTestUrl + '/inline/shared-2.html?v=1')”。
     * 验证目标：“(await page.textContent('#output')).trim()” 应等于 “'dep1 common dep2 dep3 shared'”；“(await page.textContent('#output')).trim()” 应等于 “'dep1 common dep2 dep3 shared'”，从而确认模块预加载内联策略与脚本执行顺序稳定。
     */
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

    /**
     * 场景：在 “'build'” / “'inline entry'” 中，导航到 “page.goto(viteTestUrl + '/inline/unique.html?v=1')”。
     * 验证目标：“(await page.textContent('#output')).trim()” 应等于 “'dep1 common dep2 unique'”，从而确认模块预加载内联策略与脚本执行顺序稳定。
     */
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

  /**
   * 场景：在 “'noHead'” 中，加载用例 fixture 并观察 “await el.getAttribute('content')”。
   * 验证目标：“await el.getAttribute('content')” 应等于 “'a vite app'”；“await kw.getAttribute('content')” 应等于 “'es modules'”，从而确认transformIndexHtml 钩子阶段与 tag 注入位置正确。
   */
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

  /**
   * 场景：在 “'noBody'” 中，加载用例 fixture 并观察 “await el.innerHTML()”。
   * 验证目标：“await el.innerHTML()” 应匹配 “'<!-- this is prepended to body -->'”；“await kw.innerHTML()” 应匹配 “'<!-- this is appended to body -->'”，从而确认transformIndexHtml 钩子阶段与 tag 注入位置正确。
   */
  test('noBody tags injection', async () => {
    // parse5 会补出 body；该选择器应命中注入后的第一个 noscript。
    const el = await page.$('body noscript')
    expect(await el.innerHTML()).toMatch(`<!-- this is prepended to body -->`)

    const kw = await page.$('html:last-child')
    expect(await kw.innerHTML()).toMatch(`<!-- this is appended to body -->`)
  })
})

describe('Unicode path', () => {
  /** 编码路径的直接访问与 SPA fallback 必须映射到同一 Unicode HTML 文件。 */
  /**
   * 场景：在 “'Unicode path'” 中，导航到 “page.goto( viteTestUrl + '/unicode-path/中文-にほんご-한글-🌕🌖🌗/index.html', )”。
   * 验证目标：“await page.textContent('h1')” 应等于 “'Unicode path'”，从而确认HTML 静态命中、SPA fallback 和 Accept 分流正确。
   */
  test('direct access', async () => {
    await page.goto(
      viteTestUrl + '/unicode-path/中文-にほんご-한글-🌕🌖🌗/index.html',
    )
    expect(await page.textContent('h1')).toBe('Unicode path')
  })

  /**
   * 场景：在 “'Unicode path'” 中，导航到 “page.goto(viteTestUrl + '/unicode-path/中文-にほんご-한글-🌕🌖🌗/')”。
   * 验证目标：“await page.textContent('h1')” 应等于 “'Unicode path'”，从而确认HTML 静态命中、SPA fallback 和 Accept 分流正确。
   */
  test('spa fallback', async () => {
    await page.goto(viteTestUrl + '/unicode-path/中文-にほんご-한글-🌕🌖🌗/')
    expect(await page.textContent('h1')).toBe('Unicode path')
  })
})

describe('link with props', () => {
  /** 带 media 等加载条件的 stylesheet 不可合并成无条件 CSS import。 */
  /**
   * 场景：在 “'link with props'” 中，导航到 “page.goto(viteTestUrl + '/link-props/index.html')”。
   * 验证目标：“await getColor('h1')” 应等于 “'red'”，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
   */
  test('separate links with different media props', async () => {
    await page.goto(viteTestUrl + '/link-props/index.html')
    expect(await getColor('h1')).toBe('red')
  })
})

describe.runIf(isServe)('SPA fallback', () => {
  /** 页面导航优先返回 HTML，即使无扩展路径与真实 JS 文件 basename 冲突。 */
  /**
   * 场景：在 “'SPA fallback'” 中，导航到 “page.goto(viteTestUrl + '/test')”。
   * 验证目标：“response.status()” 应等于 “200”；“content” 应包含 “'Transformed'”，从而确认HTML 静态命中、SPA fallback 和 Accept 分流正确。
   */
  test('should serve index.html via page navigation even when path matches file basename', async () => {
    const response = await page.goto(viteTestUrl + '/test')
    expect(response.status()).toBe(200)
    const content = await page.content()
    expect(content).toContain('Transformed')
    expect(content).not.toContain('This is test.js')
  })
})

describe.runIf(!isBundled)('invalid', () => {
  /** parse5 错误进入 overlay；关闭、替换新错误和修复 HTML 后 reload 都走真实 HMR 链路。 */
  /**
   * 场景：在 “'invalid'” 中，导航到 “page.goto(viteTestUrl + '/invalid.html')”。
   * 验证目标：“response.status()” 应等于 “500”；“errorOverlay” 应为真，从而确认HTML 解析错误能显示、映射并在修复后恢复。
   */
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

  /**
   * 场景：在 “'invalid'” 中，导航到 “page.goto(viteTestUrl + '/invalidClick.html')”，然后点击 “page.click('html')”。
   * 验证目标：“errorOverlay” 应为真；“isVisibleOverlay” 应为假，从而确认HTML 解析错误能显示、映射并在修复后恢复。
   */
  test('should close overlay when clicked away', async () => {
    await page.goto(viteTestUrl + '/invalidClick.html')
    const errorOverlay = await page.waitForSelector('vite-error-overlay')
    expect(errorOverlay).toBeTruthy()

    await page.click('html')
    const isVisibleOverlay = await errorOverlay.isVisible()
    expect(isVisibleOverlay).toBeFalsy()
  })

  /**
   * 场景：在 “'invalid'” 中，导航到 “page.goto(viteTestUrl + '/invalidEscape.html')”。
   * 验证目标：“errorOverlay” 应为真；“isVisibleOverlay” 应为假，从而确认HTML 解析错误能显示、映射并在修复后恢复。
   */
  test('should close overlay when escape key is pressed', async () => {
    await page.goto(viteTestUrl + '/invalidEscape.html')
    const errorOverlay = await page.waitForSelector('vite-error-overlay')
    expect(errorOverlay).toBeTruthy()

    await page.keyboard.press('Escape')
    const isVisibleOverlay = await errorOverlay.isVisible()
    expect(isVisibleOverlay).toBeFalsy()
  })

  /**
   * 场景：在 “'invalid'” 中，导航到 “page.goto(viteTestUrl + '/invalid.html')”。
   * 验证目标：“stack” 应匹配 “/^Error: someError/”，从而确认HTML 解析错误能显示、映射并在修复后恢复。
   */
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

  /**
   * 场景：在 “'invalid'” 中，导航到 “page.goto(viteTestUrl + '/invalid.html')”，然后修改 “editFile('invalid.html', (content) => { return content.replace('<div Bad', '<div> Good') })”。
   * 验证目标：“content” 应为真，从而确认HTML 解析错误能显示、映射并在修复后恢复。
   */
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
  /** 浏览器容忍的无引号/重复属性不会被 Vite 误判为致命解析错误。 */
  /**
   * 场景：在 “'Valid HTML'” 中，导航到 “page.goto(viteTestUrl + '/valid.html')”。
   * 验证目标：“await page.textContent('#no-quotes-on-attr')” 应等于 “'No quotes on Attr working'”；“await getColor('#duplicated-attrs')” 应等于 “'green'”，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
   */
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

  /**
   * 场景：在 “'env'” 中，加载用例 fixture 并观察 “await page.textContent('.env')”。
   * 验证目标：“await page.textContent('.env')” 应等于 “'bar'”；“await page.textContent('.env-define')” 应等于 “'5173'”，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
   */
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
  /**
   * 场景：在 “'importmap'” 中，加载用例 fixture 并观察 “browserLogs”。
   * 验证目标：“browserLogs” 不应包含 “'An import map is added after module script load was triggered.'”，从而确认transformIndexHtml 钩子阶段与 tag 注入位置正确。
   */
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

  /**
   * 场景：在 “'side-effects'” 中，加载用例 fixture 并观察 “browserLogs”。
   * 验证目标：“browserLogs” 应包含 “'message from sideEffects script'”，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
   */
  test('console.log is not tree-shaken', async () => {
    expect(browserLogs).toContain('message from sideEffects script')
  })
})

describe('special character', () => {
  /** 含空格/非 ASCII 的 HTML 文件名仍须生成与命中一致的 html-proxy key。 */
  beforeAll(async () => {
    await page.goto(viteTestUrl + '/a á.html')
  })

  /**
   * 场景：在 “'special character'” 中，加载用例 fixture 并观察 “browserLogs”。
   * 验证目标：“browserLogs” 应包含 “'special character'”，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
   */
  test('should fetch html proxy', async () => {
    expect(browserLogs).toContain('special character')
  })
})

describe('relative input', () => {
  /** 构建 input 使用相对路径时，facadeModuleId 仍能回配正确 HTML 入口。 */
  beforeAll(async () => {
    await page.goto(viteTestUrl + '/relative-input.html')
  })

  /**
   * 场景：在 “'relative input'” 中，加载用例 fixture 并观察 “page.textContent('.relative-input')”。
   * 验证目标：“page.textContent('.relative-input')” 应等于 “'OK'”，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
   */
  test('passing relative path to rolldownOptions.input works', async () => {
    await expect.poll(() => page.textContent('.relative-input')).toBe('OK')
  })
})

describe.runIf(!isBundled)('warmup', () => {
  /** HTML 预热与配置 warmup 都应异步把 client 模块登记入图。 */
  /**
   * 场景：在 “'warmup'” 中，加载用例 fixture 并观察 “viteServer.environments.client.moduleGraph.getModuleByUrl( '/warmup/warm.js', )”。
   * 验证目标：“viteServer.environments.client.moduleGraph.getModuleByUrl( '/warmup/warm.js', )” 应为真，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
   */
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

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “file.status”。
 * 验证目标：“file.status” 应等于 “200”；“await file.text()” 应包含 “'file.html'”，从而确认HTML 静态命中、SPA fallback 和 Accept 分流正确。
 */
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

/**
 * 场景：在当前 playground 中，请求 “fetch(viteTestUrl, { headers: { Accept: '' } })”，然后请求 “fetch(viteTestUrl)”。
 * 验证目标：“(await fetch(viteTestUrl, { headers: { Accept: '' } })).status” 应等于 “200”；“(await fetch(viteTestUrl)).status” 应等于 “200”，从而确认HTML 静态命中、SPA fallback 和 Accept 分流正确。
 */
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

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “el”。
 * 验证目标：“el” 应为 null，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
 */
test('escape html attribute', async () => {
  // 结构化标签属性必须转义，否则恶意值可闭合属性并注入额外元素。
  const el = await page.$('.unescape-div')
  expect(el).toBeNull()
})

/**
 * 场景：在当前 playground 中，导航到 “page.goto('${viteTestUrl}/transform-inline-js')”，然后重载 “page.reload()”。
 * 验证目标：“await page.textContent('.test')” 应包含 “'ok'”；“await page.textContent('.test')” 应包含 “'ok'”，从而确认HTML 解析错误能显示、映射并在修复后恢复。
 */
test('invalidate inline proxy module on reload', async () => {
  // 连续 reload 会重新生成同 URL 的内联代理；每轮都需失效旧 ModuleNode 后读取最新缓存。
  await page.goto(`${viteTestUrl}/transform-inline-js`)
  expect(await page.textContent('.test')).toContain('ok')
  await page.reload()
  expect(await page.textContent('.test')).toContain('ok')
  await page.reload()
  expect(await page.textContent('.test')).toContain('ok')
})

/**
 * 场景：在当前 playground 中，导航到 “page.goto('${viteTestUrl}/malformed-url.html')”。
 * 验证目标：“await page.textContent('.status')” 应包含 “'Page loaded successfully'”；“serverLogs” 不应深度等于 “expect.arrayContaining([ expect.stringMatching('Internal server error: URI malformed'), ])”，从而确认HTML 资源 URL、proxy 模块和预热依赖按开发/构建边界处理。
 */
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
