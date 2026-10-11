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
 * invalidate 与 full reload 路径；专门的 reload 用例统计导航次数并检查不会经过中间 fallback。
 */
/** 匹配 bundled 产物中的 PNG 文件名，轮询页面 asset 文本时共用。 */
const assetUrl = /asset-[\w-]+\.png/

if (isBuild) {
  /** 构建模式基线：完整 bundle 显示页面标题，入口与自接受模块都渲染 hello。 */
  test('should render', async () => {
    expect(await page.textContent('h1')).toContain('HMR Full Bundle Mode')
    await expect.poll(() => page.textContent('.app')).toBe('hello')
    await expect.poll(() => page.textContent('.hmr')).toBe('hello')
  })
} else {
  /** 状态：INITIAL → BUNDLING → BUNDLED；首屏先显示进度页，首次 load 后能执行真实输出。 */
  test('show bundling in progress', async () => {
    const reloadPromise = page.waitForEvent('load')
    await expect
      .poll(() => page.textContent('body'))
      .toContain('Bundling in progress')
    await reloadPromise // 等待重载后的页面重新显示。
    await expect.poll(() => page.textContent('h1')).toBe('HMR Full Bundle Mode')
    await expect.poll(() => page.textContent('.app')).toBe('hello')
    await expect.poll(() => page.textContent('.asset')).toMatch(assetUrl)
    await expect
      .poll(() => page.textContent('.worker-query'))
      .toBe('worker-query')
    await expect.poll(() => page.textContent('.worker-url')).toBe('worker-url')
  })

  /** 状态：BUNDLED → patch/rebundle 报错 → 修复；验证 overlay 出现、消失及页面恢复。 */
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

  /** 普通入口修改后显示 hello1，恢复后显示 hello 且 asset URL 仍符合产物命名。 */
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

  /** 在入口的延迟 transform 期间再次修改它，最终页面显示最后一次编辑的 hello2；恢复后再显示 hello。 */
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

  /** patch 生成失败时检查 overlay 与服务端 Build error；修复后 overlay 消失，模块再次显示 hello。 */
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

  /** self-accept 模块走 ESM HMR patch；验证新值、patch 中的 ESM 语法和资源继续可用。 */
  test('generate hmr patch', async () => {
    await expect.poll(() => page.textContent('.hmr')).toBe('hello')
    const hmrPatchFileRes = page.waitForResponse(/\/hmr_patch_\d\.js$/)
    editFile('hmr.js', (code) =>
      code.replace("const foo = 'hello'", "const foo = 'hello1'"),
    )
    try {
      await expect.poll(() => page.textContent('.hmr')).toBe('hello1')

      // patch 含 ESM export 语法，作为普通 script 执行会报语法错误。
      expect(await (await hmrPatchFileRes).text()).toMatch(/export\s*\{\}/)
    } finally {
      editFile('hmr.js', (code) =>
        code.replace("const foo = 'hello1'", "const foo = 'hello'"),
      )
    }
    await expect.poll(() => page.textContent('.hmr')).toContain('hello')
    await expect.poll(() => page.textContent('.asset')).toMatch(assetUrl)
  })

  /** 带延迟的模块连续修改后，页面最终显示 hello2；恢复后再次显示 hello。 */
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
   * dev 在已加载模块中新增 PNG 导入，再等待图片解码并检查 URL 与 200 响应；onTestFinished 恢复原文件。
   * 覆盖 patch 新发射资产通过 onAdditionalAssets 暴露的路径。
   * Source: https://github.com/vitejs/vite/issues/22596
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
  test('lazy bundling', async () => {
    await page.click('#load-dynamic')
    await expect.poll(() => page.textContent('.dynamic')).toBe('loaded')
  })

  /** 连续两次局部更新应复用 hot.data，并在每轮删除缓存前各执行一次 dispose。 */
  // 故意放在 invalidate 用例前：后者清理会触发 full reload，清掉这里依赖的 hot.data。
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
    // hot.invalidate() 在客户端图上传播到 parent；边界计算和 factory 检查都通过时原地重跑，否则请求 full reload。
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

  /** dev 修改未执行 accept 分支的 dead-accept 模块后，轮询新文本；实现应回退 reload，但本用例未统计导航次数，下一用例另做该验证。 */
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
  test('a full reload navigates once, onto the rebuilt bundle', async () => {
    const original = readFile('dead-accept.js')

    // 客户端不能自行导航：先发 reload-needed，服务端等新 bundle 可访问后才回 full-reload。
    // 因此页面不会经过 bundling fallback，document 也只加载一次（#23106）。
    let documentLoads = 0
    let sawFallbackPage = false
    /** 仅对 document 响应递增计数，并读取正文检测 fallback 标记。
     * @param response Playwright 的每条响应。
     */
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

  /** dev 修改无 accept 的 worker-only 依赖，轮询新 worker 消息；恢复文件后等待旧消息回来。此处检查结果，未单独统计导航。 */
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
   * 当前 skip：修改环中的 cycle-a 后，目标是显示新值，并比较两次间隔一秒的 invalidate 数相同且至多二次；尚未作为通过证据。
   * Source: https://github.com/rolldown/rolldown/issues/10340
   */
  test.skip('chained invalidate in an import cycle settles', async () => {
    const original = readFile('cycle-a.js')
    onTestFinished(async () => {
      addFile('cycle-a.js', original)
      await page.reload()
      await expect.poll(() => page.textContent('.cycle')).toBe('cycle')
    })

    /** 数出 cycle-b 的 invalidate 日志。
     * @returns 当前累计次数，供 skip 场景比较是否停止增长。
     */
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
