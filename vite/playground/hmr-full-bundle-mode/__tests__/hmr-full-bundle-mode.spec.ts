import { setTimeout } from 'node:timers/promises'
import type { Response } from 'playwright-chromium'
import { expect, test, onTestFinished } from 'vitest'
import {
  addFile,
  browserLogs,
  editFile,
  isBuild,
  page,
  readFile,
  serverLogs,
} from '~utils'

/**
 * 场景：实验性 bundled-dev 用 Rolldown 维护整包 runtime，并由浏览器侧计算 HMR 边界。
 * 验证目标：覆盖首次 bundle、patch 串行化、错误恢复、资源/worker 产物、hot.data、
 * invalidate 与必须 full reload 的退化路径，同时确认页面不会加载中间 fallback。
 */
const assetUrl = /asset-[\w-]+\.png/

if (isBuild) {
  /** 构建模式基线：完整 bundle 应正常渲染，dev 专用协议不能污染生产输出。 */
  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('h1')”。
   * 验证目标：“await page.textContent('h1')” 应包含 “'HMR Full Bundle Mode'”；“page.textContent('.app')” 应等于 “'hello'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('should render', async () => {
    expect(await page.textContent('h1')).toContain('HMR Full Bundle Mode')
    await expect.poll(() => page.textContent('.app')).toBe('hello')
    await expect.poll(() => page.textContent('.hmr')).toBe('hello')
  })
} else {
  /** 状态：INITIAL → BUNDLING → BUNDLED；首屏显示进度页，bundle 就绪后只 reload 一次。 */
  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('body')”。
   * 验证目标：“page.textContent('body')” 应包含 “'Bundling in progress'”；“page.textContent('h1')” 应等于 “'HMR Full Bundle Mode'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('show bundling in progress', async () => {
    const reloadPromise = page.waitForEvent('load')
    await expect
      .poll(() => page.textContent('body'))
      .toContain('Bundling in progress')
    await reloadPromise // page shown after reload
    await expect.poll(() => page.textContent('h1')).toBe('HMR Full Bundle Mode')
    await expect.poll(() => page.textContent('.app')).toBe('hello')
    await expect.poll(() => page.textContent('.asset')).toMatch(assetUrl)
    await expect
      .poll(() => page.textContent('.worker-query'))
      .toBe('worker-query')
    await expect.poll(() => page.textContent('.worker-url')).toBe('worker-url')
  })

  /** 状态：BUNDLED → patch/rebundle 报错 → 修复；验证 overlay 出现、消失及页面恢复。 */
  /**
   * 场景：在当前 playground 中，修改 “editFile('main.js', (code) => code.replace("text('.app', 'hello')", "text('.app', 'hello'); text("), )”，然后修改 “editFile('main.js', (code) => code.replace("text('.app', 'hello'); text(", "text('.app', 'hello')"), )”。
   * 验证目标：“page.isVisible('vite-error-overlay')” 应等于 “true”；“page.isVisible('vite-error-overlay')” 应等于 “false”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('handle bundle error', async () => {
    editFile('main.js', (code) =>
      code.replace("text('.app', 'hello')", "text('.app', 'hello'); text("),
    )
    await expect.poll(() => page.isVisible('vite-error-overlay')).toBe(true)
    editFile('main.js', (code) =>
      code.replace("text('.app', 'hello'); text(", "text('.app', 'hello')"),
    )
    await expect.poll(() => page.isVisible('vite-error-overlay')).toBe(false)
    await expect.poll(() => page.textContent('.app')).toBe('hello')
  })

  /** 普通入口改动需要重建 bundle，并把新内容和 asset URL 一起切换。 */
  /**
   * 场景：在当前 playground 中，修改 “editFile('main.js', (code) => code.replace("text('.app', 'hello')", "text('.app', 'hello1')"), )”，然后修改 “editFile('main.js', (code) => code.replace("text('.app', 'hello1')", "text('.app', 'hello')"), )”。
   * 验证目标：“page.textContent('.app')” 应等于 “'hello1'”；“page.textContent('.app')” 应等于 “'hello'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('update bundle', async () => {
    editFile('main.js', (code) =>
      code.replace("text('.app', 'hello')", "text('.app', 'hello1')"),
    )
    await expect.poll(() => page.textContent('.app')).toBe('hello1')

    editFile('main.js', (code) =>
      code.replace("text('.app', 'hello1')", "text('.app', 'hello')"),
    )
    await expect.poll(() => page.textContent('.app')).toBe('hello')
    await expect.poll(() => page.textContent('.asset')).toMatch(assetUrl)
  })

  /** 连续入口改动应 debounce，只展示最后一次内容，不能让较慢的旧构建覆盖新构建。 */
  /**
   * 场景：在当前 playground 中，修改 “editFile('main.js', (code) => code.replace( "text('.app', 'hello')", "text('.app', 'hello1')\n" + '// @d…”，然后修改 “editFile('main.js', (code) => code.replace("text('.app', 'hello1')", "text('.app', 'hello2') "), )”。
   * 验证目标：“page.textContent('.app')” 应等于 “'hello2'”；“page.textContent('.app')” 应等于 “'hello'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('debounce bundle', async () => {
    editFile('main.js', (code) =>
      code.replace(
        "text('.app', 'hello')",
        "text('.app', 'hello1')\n" + '// @delay-transform',
      ),
    )
    await setTimeout(100)
    editFile('main.js', (code) =>
      code.replace("text('.app', 'hello1')", "text('.app', 'hello2') "),
    )
    await expect.poll(() => page.textContent('.app')).toBe('hello2')

    editFile('main.js', (code) =>
      code.replace(
        "text('.app', 'hello2') \n" + '// @delay-transform',
        "text('.app', 'hello')",
      ),
    )
    await expect.poll(() => page.textContent('.app')).toBe('hello')
  })

  /** patch 生成失败展示 overlay；修复后仍回到现有 bundle，而不是永久卡死。 */
  /**
   * 场景：在当前 playground 中，修改 “editFile('hmr.js', (code) => code.replace("const foo = 'hello'", "const foo = 'hello"), )”，然后修改 “editFile('hmr.js', (code) => code.replace("const foo = 'hello", "const foo = 'hello'"), )”。
   * 验证目标：“page.textContent('.hmr')” 应等于 “'hello'”；“page.isVisible('vite-error-overlay')” 应等于 “true”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('handle generate hmr patch error', async () => {
    await expect.poll(() => page.textContent('.hmr')).toBe('hello')
    const lastServerLogIndex = serverLogs.length
    editFile('hmr.js', (code) =>
      code.replace("const foo = 'hello'", "const foo = 'hello"),
    )
    await expect.poll(() => page.isVisible('vite-error-overlay')).toBe(true)
    await expect
      .poll(() => serverLogs.slice(lastServerLogIndex).join('\n'))
      .toContain('Build error')

    editFile('hmr.js', (code) =>
      code.replace("const foo = 'hello", "const foo = 'hello'"),
    )
    await expect.poll(() => page.isVisible('vite-error-overlay')).toBe(false)
    await expect.poll(() => page.textContent('.hmr')).toContain('hello')
  })

  /** self-accept 模块走 ESM HMR patch；验证局部更新、安全语法与资源继续可用。 */
  /**
   * 场景：在当前 playground 中，修改 “editFile('hmr.js', (code) => code.replace("const foo = 'hello'", "const foo = 'hello1'"), )”，然后修改 “editFile('hmr.js', (code) => code.replace("const foo = 'hello1'", "const foo = 'hello'"), )”。
   * 验证目标：“page.textContent('.hmr')” 应等于 “'hello'”；“page.textContent('.hmr')” 应等于 “'hello1'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('generate hmr patch', async () => {
    await expect.poll(() => page.textContent('.hmr')).toBe('hello')
    const hmrPatchFileRes = page.waitForResponse(/\/hmr_patch_\d\.js$/)
    editFile('hmr.js', (code) =>
      code.replace("const foo = 'hello'", "const foo = 'hello1'"),
    )
    try {
      await expect.poll(() => page.textContent('.hmr')).toBe('hello1')

      // patch 必须含 ESM 语法，禁止跨源页面用普通 `<script>` 读取其内容，守住同源边界。
      expect(await (await hmrPatchFileRes).text()).toMatch(/export\s*\{\}/)
    } finally {
      editFile('hmr.js', (code) =>
        code.replace("const foo = 'hello1'", "const foo = 'hello'"),
      )
    }
    await expect.poll(() => page.textContent('.hmr')).toContain('hello')
    await expect.poll(() => page.textContent('.asset')).toMatch(assetUrl)
  })

  /** 连续 patch 也要按序落地，最终内容必须来自最后一次编辑。 */
  /**
   * 场景：在当前 playground 中，修改 “editFile('hmr.js', (code) => code.replace( "const foo = 'hello'", "const foo = 'hello1'\n" + '// @delay-…”，然后修改 “editFile('hmr.js', (code) => code.replace("const foo = 'hello1'", "const foo = 'hello2' "), )”。
   * 验证目标：“page.textContent('.hmr')” 应等于 “'hello2'”；“page.textContent('.hmr')” 应等于 “'hello'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('continuous generate hmr patch', async () => {
    editFile('hmr.js', (code) =>
      code.replace(
        "const foo = 'hello'",
        "const foo = 'hello1'\n" + '// @delay-transform',
      ),
    )
    await setTimeout(100)
    editFile('hmr.js', (code) =>
      code.replace("const foo = 'hello1'", "const foo = 'hello2' "),
    )
    await expect.poll(() => page.textContent('.hmr')).toBe('hello2')

    editFile('hmr.js', (code) =>
      code.replace(
        "const foo = 'hello2' \n" + '// @delay-transform',
        "const foo = 'hello'",
      ),
    )
    await expect.poll(() => page.textContent('.hmr')).toBe('hello')
  })

  /**
   * HMR patch 新增的 asset 不经过 onOutput，必须由 onAdditionalAssets 暴露。
   * Source: https://github.com/vitejs/vite/issues/22596
   */
  /**
   * 场景：在当前 playground 中，修改 “editFile( 'hmr-asset.js', (code) => 'import imageUrl from './hmr-asset.png'\n' + code.replace('/* @asset…”，然后新增 “addFile('hmr-asset.js', original)”。
   * 验证目标：“page.getAttribute('#hmr-asset-image', 'alt')” 应等于 “'hmr-asset'”；“page .$eval( '#hmr-asset-image', (img: HTMLImageElement) => img.complete && img.naturalWidth > 0, ) .cat…” 应等于 “true”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('hmr patch serves a newly emitted asset', async () => {
    const original = readFile('hmr-asset.js')
    await expect
      .poll(() => page.getAttribute('#hmr-asset-image', 'alt'))
      .toBe('hmr-asset')

    const assetResponse = page.waitForResponse(/hmr-asset-[\w-]+\.png/)
    editFile(
      'hmr-asset.js',
      (code) =>
        `import imageUrl from './hmr-asset.png'\n` +
        code.replace('/* @asset-src */', 'img.src = imageUrl'),
    )
    onTestFinished(() => {
      addFile('hmr-asset.js', original)
    })

    // 只有资源确实被服务、不是 404 时，浏览器才能完成图片解码。
    await expect
      .poll(() =>
        page
          .$eval(
            '#hmr-asset-image',
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          )
          .catch(() => false),
      )
      .toBe(true)
    const src = await page.getAttribute('#hmr-asset-image', 'src')
    expect(src).toMatch(/\/assets\/hmr-asset-[\w-]+\.png/)
    expect((await assetResponse).status()).toBe(200)
  })

  /** `?worker` 入口参与 bundled-dev 重建，更新后 worker 消息应变化且能恢复。 */
  /**
   * 场景：在当前 playground 中，修改 “editFile('worker-query.js', (code) => code.replace( "const msg = 'worker-query'", "const msg = 'worker-q…”，然后修改 “editFile('worker-query.js', (code) => code.replace( "const msg = 'worker-query-updated'", "const msg = '…”。
   * 验证目标：“page.textContent('.worker-query')” 应等于 “'worker-query'”；“page.textContent('.worker-query')” 应等于 “'worker-query-updated'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('worker with ?worker query', async () => {
    await expect
      .poll(() => page.textContent('.worker-query'))
      .toBe('worker-query')
    editFile('worker-query.js', (code) =>
      code.replace(
        "const msg = 'worker-query'",
        "const msg = 'worker-query-updated'",
      ),
    )
    await expect
      .poll(() => page.textContent('.worker-query'))
      .toBe('worker-query-updated')

    editFile('worker-query.js', (code) =>
      code.replace(
        "const msg = 'worker-query-updated'",
        "const msg = 'worker-query'",
      ),
    )
    await expect
      .poll(() => page.textContent('.worker-query'))
      .toBe('worker-query')
  })

  /** `new Worker(new URL(...))` 解析出的入口也应被监听、重建并继续服务。 */
  /**
   * 场景：在当前 playground 中，修改 “editFile('worker-url.js', (code) => code.replace( "const msg = 'worker-url'", "const msg = 'worker-url-u…”，然后修改 “editFile('worker-url.js', (code) => code.replace( "const msg = 'worker-url-updated'", "const msg = 'work…”。
   * 验证目标：“page.textContent('.worker-url')” 应等于 “'worker-url'”；“page.textContent('.worker-url')” 应等于 “'worker-url-updated'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('worker with new URL', async () => {
    await expect.poll(() => page.textContent('.worker-url')).toBe('worker-url')
    editFile('worker-url.js', (code) =>
      code.replace(
        "const msg = 'worker-url'",
        "const msg = 'worker-url-updated'",
      ),
    )
    await expect
      .poll(() => page.textContent('.worker-url'))
      .toBe('worker-url-updated')

    editFile('worker-url.js', (code) =>
      code.replace(
        "const msg = 'worker-url-updated'",
        "const msg = 'worker-url'",
      ),
    )
    await expect.poll(() => page.textContent('.worker-url')).toBe('worker-url')
  })

  /**
   * importer 自接受使更新只生成 patch；验证跳过 generate 后 worker 文件仍已提前输出，
   * 且全局标记证明页面没有 reload。
   */
  /**
   * 场景：在当前 playground 中，新增 “addFile('worker-accept-src.js', original)”，然后修改 “editFile('worker-accept-src.js', (code) => code.replace("'worker-accept'", "'worker-accept-updated'"), )”。
   * 验证目标：“page.textContent('.worker-accept')” 应等于 “'worker-accept'”；“page.textContent('.worker-accept')” 应等于 “'worker-accept'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('worker updated through an HMR patch is served', async () => {
    const original = readFile('worker-accept-src.js')
    onTestFinished(async () => {
      addFile('worker-accept-src.js', original)
      await expect
        .poll(() => page.textContent('.worker-accept'))
        .toBe('worker-accept')
    })

    await expect
      .poll(() => page.textContent('.worker-accept'))
      .toBe('worker-accept')

    // 该全局标记能穿过 patch，但整页 reload 会丢失，用它区分两种更新路径。
    await page.evaluate(() => {
      ;(window as any).__workerAcceptKeptAlive = true
    })

    editFile('worker-accept-src.js', (code) =>
      code.replace("'worker-accept'", "'worker-accept-updated'"),
    )
    await expect
      .poll(() => page.textContent('.worker-accept'))
      .toBe('worker-accept-updated')

    expect(
      await page.evaluate(() => (window as any).__workerAcceptKeptAlive),
    ).toBe(true)
  })

  /** 嵌套 worker 各自打包；验证 patch 后内外两份产物都能从内存文件系统访问。 */
  /**
   * 场景：在当前 playground 中，新增 “addFile('worker-nested-inner.js', original)”，然后修改 “editFile('worker-nested-inner.js', (code) => code.replace("'nested-inner'", "'nested-inner-updated'"), )”。
   * 验证目标：“page.textContent('.worker-nested')” 应等于 “'nested-outer+nested-inner'”；“page.textContent('.worker-nested')” 应等于 “'nested-outer+nested-inner'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('nested worker updated through an HMR patch is served', async () => {
    const original = readFile('worker-nested-inner.js')
    onTestFinished(async () => {
      addFile('worker-nested-inner.js', original)
      await expect
        .poll(() => page.textContent('.worker-nested'))
        .toBe('nested-outer+nested-inner')
    })

    await expect
      .poll(() => page.textContent('.worker-nested'))
      .toBe('nested-outer+nested-inner')

    // 该标记用于证明嵌套 worker 也通过 patch 更新，而非整页刷新。
    await page.evaluate(() => {
      ;(window as any).__workerNestedKeptAlive = true
    })

    editFile('worker-nested-inner.js', (code) =>
      code.replace("'nested-inner'", "'nested-inner-updated'"),
    )
    await expect
      .poll(() => page.textContent('.worker-nested'))
      .toBe('nested-outer+nested-inner-updated')

    expect(
      await page.evaluate(() => (window as any).__workerNestedKeptAlive),
    ).toBe(true)
  })

  /** 首次点击才触发动态入口 lazy bundle；验证按需产物生成后模块能执行。 */
  /**
   * 场景：在当前 playground 中，点击 “page.click('#load-dynamic')”。
   * 验证目标：“page.textContent('.dynamic')” 应等于 “'loaded'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('lazy bundling', async () => {
    await page.click('#load-dynamic')
    await expect.poll(() => page.textContent('.dynamic')).toBe('loaded')
  })

  /** 连续两次局部更新应复用 hot.data，并在每轮删除缓存前各执行一次 dispose。 */
  // 故意放在 invalidate 用例前：后者清理会触发 full reload，清掉这里依赖的 hot.data。
  /**
   * 场景：在当前 playground 中，修改 “editFile('data.js', (code) => code.replace( "globalThis.__hmrBump = 'initial'", "globalThis.__hmrBump = …”，然后修改 “editFile('data.js', (code) => code.replace( "globalThis.__hmrBump = 'first-update'", "globalThis.__hmrBu…”。
   * 验证目标：“page.textContent('.data-count')” 应等于 “'1'”；“page.textContent('.data-disposed')” 应等于 “'0'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('preserves import.meta.hot.data across updates', async () => {
    await expect.poll(() => page.textContent('.data-count')).toBe('1')
    await expect.poll(() => page.textContent('.data-disposed')).toBe('0')

    editFile('data.js', (code) =>
      code.replace(
        "globalThis.__hmrBump = 'initial'",
        "globalThis.__hmrBump = 'first-update'",
      ),
    )
    await expect.poll(() => page.textContent('.data-count')).toBe('2')
    await expect.poll(() => page.textContent('.data-disposed')).toBe('1')

    editFile('data.js', (code) =>
      code.replace(
        "globalThis.__hmrBump = 'first-update'",
        "globalThis.__hmrBump = 'second-update2'",
      ),
    )
    await expect.poll(() => page.textContent('.data-count')).toBe('3')
    await expect.poll(() => page.textContent('.data-disposed')).toBe('2')
  })

  /** 子模块主动 invalidate 后，客户端应向已执行 parent 冒泡并更新，而不是等待服务端 patch。 */
  /**
   * 场景：在当前 playground 中，新增 “addFile('invalidation-child.js', original)”，然后修改 “editFile('invalidation-child.js', (code) => code.replace("'child'", "'child updated'"), )”。
   * 验证目标：“page.textContent('.invalidation-parent')” 应等于 “'child'”；“page.textContent('.invalidation-parent')” 应等于 “'child updated'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('invalidate', async () => {
    const original = readFile('invalidation-child.js')
    onTestFinished(() => addFile('invalidation-child.js', original))

    await expect
      .poll(() => page.textContent('.invalidation-parent'))
      .toBe('child')
    const logIndex = browserLogs.length
    editFile('invalidation-child.js', (code) =>
      code.replace("'child'", "'child updated'"),
    )
    // hot.invalidate() 完全在客户端图上传播到 parent；有 factory 时原地重跑，否则 full reload。
    await expect
      .poll(() => page.textContent('.invalidation-parent'))
      .toBe('child updated')
    expect(
      browserLogs
        .slice(logIndex)
        .some(
          (l) => l.includes('invalidate') && l.includes('invalidation-child'),
        ),
    ).toBe(true)
  })

  /** accept 边界从未执行、没有 callback/factory 时，局部更新不安全，应退化为 full reload。 */
  /**
   * 场景：在当前 playground 中，新增 “addFile('dead-accept.js', original)”，然后修改 “editFile('dead-accept.js', (code) => code.replace("'dead-accept'", "'dead-accept-updated'"), )”。
   * 验证目标：“page.textContent('.invalidation-parent')” 应等于 “'child'”；“page.textContent('.dead-accept')” 应等于 “'dead-accept'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('never-executed accept falls back to a full reload', async () => {
    await expect
      .poll(() => page.textContent('.invalidation-parent'))
      .toBe('child')

    const original = readFile('dead-accept.js')
    onTestFinished(async () => {
      addFile('dead-accept.js', original)
      await expect
        .poll(() => page.textContent('.dead-accept'))
        .toBe('dead-accept')
    })

    await expect
      .poll(() => page.textContent('.dead-accept'))
      .toBe('dead-accept')
    editFile('dead-accept.js', (code) =>
      code.replace("'dead-accept'", "'dead-accept-updated'"),
    )
    await expect
      .poll(() => page.textContent('.dead-accept'))
      .toBe('dead-accept-updated')
  })

  /** 客户端请求 reload 后必须等服务端新 bundle 就绪，只导航一次且不经过 fallback 页（#23106）。 */
  /**
   * 场景：在当前 playground 中，新增 “addFile('dead-accept.js', original)”，然后修改 “editFile('dead-accept.js', (code) => code.replace("'dead-accept'", "'dead-accept-reloaded'"), )”。
   * 验证目标：“page.textContent('.dead-accept')” 应等于 “'dead-accept'”；“page.textContent('.dead-accept')” 应等于 “'dead-accept-reloaded'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('a full reload navigates once, onto the rebuilt bundle', async () => {
    const original = readFile('dead-accept.js')

    // 客户端不能自行导航：先发 reload-needed，服务端等新 bundle 可访问后才回 full-reload。
    // 因此页面不会经过 bundling fallback，document 也只加载一次（#23106）。
    let documentLoads = 0
    let sawFallbackPage = false
    /** 统计 document 响应，并侦测 reload 是否短暂经过 bundled-dev fallback 页面。 */
    const onResponse = async (response: Response) => {
      if (response.request().resourceType() !== 'document') return
      documentLoads++
      if ((await response.text()).includes('__vite_is_fallback_page__')) {
        sawFallbackPage = true
      }
    }
    page.on('response', onResponse)
    onTestFinished(async () => {
      page.off('response', onResponse)
      addFile('dead-accept.js', original)
      await expect
        .poll(() => page.textContent('.dead-accept'))
        .toBe('dead-accept')
    })

    const serverLogIndex = serverLogs.length
    editFile('dead-accept.js', (code) =>
      code.replace("'dead-accept'", "'dead-accept-reloaded'"),
    )
    await expect
      .poll(() => page.textContent('.dead-accept'))
      .toBe('dead-accept-reloaded')

    await expect
      .poll(() =>
        serverLogs
          .slice(serverLogIndex)
          .some((l) => l.includes('bundling for page reload')),
      )
      .toBe(true)

    // 留出潜在第二次导航发生的时间，再断言确实只有一次 document load。
    await setTimeout(300)
    expect(documentLoads).toBe(1)
    expect(sawFallbackPage).toBe(false)
  })

  /** 只被 worker 使用且没有 accept 边界的模块不能局部接管，必须整页重载并得到新 worker。 */
  /**
   * 场景：在当前 playground 中，新增 “addFile('worker-plain-dep.js', original)”，然后修改 “editFile('worker-plain-dep.js', (code) => code.replace("'worker-plain'", "'worker-plain-updated'"), )”。
   * 验证目标：“page.textContent('.worker-plain')” 应等于 “'worker-plain'”；“page.textContent('.worker-plain')” 应等于 “'worker-plain'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test('editing a worker-only module without accept reloads the page', async () => {
    const original = readFile('worker-plain-dep.js')
    onTestFinished(async () => {
      // 恢复文件本身会让客户端 reload；手工 page.reload() 会与 rebuild 竞态并丢掉更新。
      addFile('worker-plain-dep.js', original)
      await expect
        .poll(() => page.textContent('.worker-plain'))
        .toBe('worker-plain')
    })

    await expect
      .poll(() => page.textContent('.worker-plain'))
      .toBe('worker-plain')
    editFile('worker-plain-dep.js', (code) =>
      code.replace("'worker-plain'", "'worker-plain-updated'"),
    )
    await expect
      .poll(() => page.textContent('.worker-plain'))
      .toBe('worker-plain-updated')
  })

  /**
   * import 环中的链式 invalidate 最终应停止自触发；当前受上游问题阻塞。
   * Source: https://github.com/rolldown/rolldown/issues/10340
   */
  /**
   * 场景：在当前 playground 中，新增 “addFile('cycle-a.js', original)”，然后重载 “page.reload()”。
   * 验证目标：“page.textContent('.cycle')” 应等于 “'cycle'”；“page.textContent('.cycle')” 应等于 “'cycle'”，从而确认Rolldown dev engine 的增量输出、payload 交付与 reload 门闩保持一致。
   */
  test.skip('chained invalidate in an import cycle settles', async () => {
    const original = readFile('cycle-a.js')
    onTestFinished(async () => {
      addFile('cycle-a.js', original)
      await page.reload()
      await expect.poll(() => page.textContent('.cycle')).toBe('cycle')
    })

    /** 统计 cycle-b 打印的 invalidate 日志，用于判断链式失效是否已经稳定。 */
    const invalidateCount = () =>
      browserLogs.filter(
        (l) => l.includes('invalidate') && l.includes('cycle-b'),
      ).length

    await expect.poll(() => page.textContent('.cycle')).toBe('cycle')
    editFile('cycle-a.js', (code) => code.replace("'cycle'", "'cycle-updated'"))
    await expect.poll(() => page.textContent('.cycle')).toBe('cycle-updated')

    // 更新稳定后 invalidate 次数必须停止增长，防止客户端无限自触发。
    await setTimeout(1000)
    const settled = invalidateCount()
    await setTimeout(1000)
    expect(invalidateCount()).toBe(settled)
    expect(settled).toBeLessThanOrEqual(2)
  })
}
