import { stripVTControlCharacters } from 'node:util'
import { beforeAll, describe, expect, it, test } from 'vitest'
import type { Page } from 'playwright-chromium'
import {
  addFile,
  browser,
  browserLogs,
  editFile,
  getBg,
  getColor,
  isBuild,
  page,
  readFile,
  removeFile,
  serverLogs,
  untilBrowserLogAfter,
  viteTestUrl,
} from '~utils'

/**
 * 浏览器端 HMR 集成矩阵。场景从 self/dependency accept 和 data/dispose 开始，逐步覆盖 invalidate、
 * acceptExports、CSS/HTML、虚拟模块、文件增删/prune 与循环依赖。断言重点不是 watcher 本身，而是：
 * 服务端选中了正确传播边界，客户端按序重新导入并执行了对应生命周期。
 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “await page.textContent('.app')”。
 * 验证目标：“await page.textContent('.app')” 应等于 “'1'”；“await page.textContent('.dep')” 应等于 “'1'”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
 */
test('should render', async () => {
  expect(await page.textContent('.app')).toBe('1')
  expect(await page.textContent('.dep')).toBe('1')
  expect(await page.textContent('.nested')).toBe('1')
})

// HMR runtime 只存在于开发服务器；构建态仍保留首个静态渲染断言。
if (!isBuild) {
  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “browserLogs.length”。
   * 验证目标：“browserLogs.length” 应等于 “5”；“browserLogs.some((msg) => msg.includes('connected'))” 应等于 “true”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('should connect', async () => {
    expect(browserLogs.length).toBe(5)
    expect(browserLogs.some((msg) => msg.includes('connected'))).toBe(true)
    browserLogs.length = 0
  })

  /** 从测试插件端点读取当前 HMR 客户端连接/断开累计次数。 */
  const fetchHotEvents = async (): Promise<{
    /** 已触发的 `vite:client:connect` 次数。 */
    connectCount: number
    /** 已触发的 `vite:client:disconnect` 次数。 */
    disconnectCount: number
  }> => {
    const res = await fetch(viteTestUrl + '/hot-events-counts')
    return res.json()
  }
  /**
   * 场景：在当前 playground 中，重载 “page.reload()”。
   * 验证目标：“await fetchHotEvents()” 应严格深度等于 “{ connectCount: 1, disconnectCount: 0, }”；“await fetchHotEvents()” 应严格深度等于 “{ connectCount: 2, disconnectCount: 1, }”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('hot events', async () => {
    expect(await fetchHotEvents()).toStrictEqual({
      connectCount: 1,
      disconnectCount: 0,
    })
    await untilBrowserLogAfter(() => page.reload(), [/connected/])
    expect(await fetchHotEvents()).toStrictEqual({
      connectCount: 2,
      disconnectCount: 1,
    })
  })

  /** 自接受模块应先 dispose 旧实例，再重新导入，并调用当前一代的所有 accept 回调。 */
  /**
   * 场景：在当前 playground 中，修改 “editFile('hmr.ts', (code) => code.replace('const foo = 1', 'const foo = 2 '), )”，然后修改 “editFile('hmr.ts', (code) => code.replace('const foo = 2', 'const foo = 3 '), )”。
   * 验证目标：“el.textContent()” 应匹配 “'2'”；“el.textContent()” 应匹配 “'3'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
   */
  test('self accept', async () => {
    const el = await page.$('.app')
    await untilBrowserLogAfter(
      () =>
        editFile('hmr.ts', (code) =>
          code.replace('const foo = 1', 'const foo = 2 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        'foo was: 1',
        '(self-accepting 1) foo is now: 2',
        '(self-accepting 2) foo is now: 2',
        '[vite] hot updated: /hmr.ts',
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el.textContent()).toMatch('2')

    await untilBrowserLogAfter(
      () =>
        editFile('hmr.ts', (code) =>
          code.replace('const foo = 2', 'const foo = 3 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        'foo was: 2',
        '(self-accepting 1) foo is now: 3',
        '(self-accepting 2) foo is now: 3',
        '[vite] hot updated: /hmr.ts',
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el.textContent()).toMatch('3')
  })

  /** hot.data 跨模块实例复用，dispose 写入的状态应成为下一代执行时的输入。 */
  /**
   * 场景：连续把 `hotData.js` 的值从 1 改为 2、再从 2 改为 3，并记录每轮执行、dispose 与 HMR 生命周期日志。
   * 验证目标：第一轮新实例读取/释放值 1，第二轮读取/释放值 2，且两轮都只产生 `/hotData.js` 局部更新，确认 `import.meta.hot.data` 由旧实例传给下一实例而未触发整页刷新。
   */
  test('hot data persists across module instances', async () => {
    await untilBrowserLogAfter(
      () =>
        editFile('hotData.js', (code) =>
          code.replace('const value = 1', 'const value = 2 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '(hot data) value from execution: 1',
        '(hot data) value from dispose: 1',
        '[vite] hot updated: /hotData.js',
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )

    await untilBrowserLogAfter(
      () =>
        editFile('hotData.js', (code) =>
          code.replace('const value = 2', 'const value = 3  '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '(hot data) value from execution: 2',
        '(hot data) value from dispose: 2',
        '[vite] hot updated: /hotData.js',
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
  })

  /** importer 接受直接依赖时，服务端发送 path=importer、acceptedPath=dep，回调只替换对应槽位。 */
  /**
   * 场景：在当前 playground 中，修改 “editFile('hmrDep.js', (code) => code.replace('const foo = 1', 'const foo = 2 '), )”，然后修改 “editFile('hmrDep.js', (code) => code.replace('const foo = 2', 'const foo = 3 '), )”。
   * 验证目标：“el.textContent()” 应匹配 “'2'”；“el.textContent()” 应匹配 “'3'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
   */
  test('accept dep', async () => {
    const el = await page.$('.dep')
    await untilBrowserLogAfter(
      () =>
        editFile('hmrDep.js', (code) =>
          code.replace('const foo = 1', 'const foo = 2 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '(dep) foo was: 1',
        '(dep) foo from dispose: 1',
        '(single dep) foo is now: 2',
        '(single dep) nested foo is now: 1',
        '(multi deps) foo is now: 2',
        '(multi deps) nested foo is now: 1',
        '[vite] hot updated: /hmrDep.js via /hmr.ts',
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el.textContent()).toMatch('2')

    await untilBrowserLogAfter(
      () =>
        editFile('hmrDep.js', (code) =>
          code.replace('const foo = 2', 'const foo = 3 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '(dep) foo was: 2',
        '(dep) foo from dispose: 2',
        '(single dep) foo is now: 3',
        '(single dep) nested foo is now: 1',
        '(multi deps) foo is now: 3',
        '(multi deps) nested foo is now: 1',
        '[vite] hot updated: /hmrDep.js via /hmr.ts',
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el.textContent()).toMatch('3')
  })

  /**
   * 场景：在当前 playground 中，修改 “editFile('hmrNestedDep.js', (code) => code.replace('const foo = 1', 'const foo = 2 '), )”，然后修改 “editFile('hmrNestedDep.js', (code) => code.replace('const foo = 2', 'const foo = 3 '), )”。
   * 验证目标：“el.textContent()” 应匹配 “'2'”；“el.textContent()” 应匹配 “'3'”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('nested dep propagation', async () => {
    const el = await page.$('.nested')
    await untilBrowserLogAfter(
      () =>
        editFile('hmrNestedDep.js', (code) =>
          code.replace('const foo = 1', 'const foo = 2 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '(dep) foo was: 3',
        '(dep) foo from dispose: 3',
        '(single dep) foo is now: 3',
        '(single dep) nested foo is now: 2',
        '(multi deps) foo is now: 3',
        '(multi deps) nested foo is now: 2',
        '[vite] hot updated: /hmrDep.js via /hmr.ts',
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el.textContent()).toMatch('2')

    await untilBrowserLogAfter(
      () =>
        editFile('hmrNestedDep.js', (code) =>
          code.replace('const foo = 2', 'const foo = 3 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '(dep) foo was: 3',
        '(dep) foo from dispose: 3',
        '(single dep) foo is now: 3',
        '(single dep) nested foo is now: 3',
        '(multi deps) foo is now: 3',
        '(multi deps) nested foo is now: 3',
        '[vite] hot updated: /hmrDep.js via /hmr.ts',
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el.textContent()).toMatch('3')
  })

  /** 子模块主动 invalidate 后，下一轮从其 importer 继续传播，而非重复执行当前 self accept。 */
  /**
   * 场景：在当前 playground 中，修改 “editFile('invalidation/child.js', (code) => code.replace('child', 'child updated'), )”。
   * 验证目标：“el.textContent()” 应匹配 “'child updated'”，从而确认invalidate 从当前模块继续向 importer 传播且不会循环。
   */
  test('invalidate', async () => {
    const el = await page.$('.invalidation-parent')
    await untilBrowserLogAfter(
      () =>
        editFile('invalidation/child.js', (code) =>
          code.replace('child', 'child updated'),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '>>> vite:invalidate -- /invalidation/child.js',
        '[vite] invalidate /invalidation/child.js',
        '[vite] hot updated: /invalidation/child.js',
        '>>> vite:afterUpdate -- update',
        '>>> vite:beforeUpdate -- update',
        '(invalidation) parent is executing',
        '[vite] hot updated: /invalidation/parent.js',
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el.textContent()).toMatch('child updated')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page2.goto(viteTestUrl)”，然后修改 “editFile('invalidation/child.js', (code) => code.replace('child', 'child updated'), )”。
   * 验证目标：“el.textContent()” 应匹配 “'child updated'”，从而确认invalidate 从当前模块继续向 importer 传播且不会循环。
   */
  test('invalidate works with multiple tabs', async () => {
    let page2: Page
    try {
      page2 = await browser.newPage()
      await page2.goto(viteTestUrl)

      const el = await page.$('.invalidation-parent')
      await untilBrowserLogAfter(
        () =>
          editFile('invalidation/child.js', (code) =>
            code.replace('child', 'child updated'),
          ),
        [
          '>>> vite:beforeUpdate -- update',
          '>>> vite:invalidate -- /invalidation/child.js',
          '[vite] invalidate /invalidation/child.js',
          '[vite] hot updated: /invalidation/child.js',
          '>>> vite:afterUpdate -- update',
          // invalidate 若未正确去重，下面这次 beforeUpdate 会出现两次。
          '>>> vite:beforeUpdate -- update',
          '(invalidation) parent is executing',
          '[vite] hot updated: /invalidation/parent.js',
          '>>> vite:afterUpdate -- update',
        ],
        true,
      )
      await expect.poll(() => el.textContent()).toMatch('child updated')
    } finally {
      await page2.close()
    }
  })

  /**
   * 场景：在当前 playground 中，修改 “editFile('invalidation/root.js', (code) => code.replace('Init', 'Updated'))”。
   * 验证目标：“(await page.$('.invalidation-root')).textContent()” 应匹配 “'Updated'”，从而确认invalidate 从当前模块继续向 importer 传播且不会循环。
   */
  test('invalidate on root triggers page reload', async () => {
    editFile('invalidation/root.js', (code) => code.replace('Init', 'Updated'))
    await page.waitForEvent('load')
    await expect
      .poll(async () => (await page.$('.invalidation-root')).textContent())
      .toMatch('Updated')
  })

  /**
   * 场景：在当前 playground 中，修改 “editFile('soft-invalidation/child.js', (code) => code.replace('bar', 'updated'), )”，然后修改 “editFile('soft-invalidation/index.js', (code) => code.replace('child is', 'child is now'), )”。
   * 验证目标：“await el.textContent()” 应等于 “'soft-invalidation/index.js is transformed 1 times. child is bar'”；“el.textContent()” 应等于 “'soft-invalidation/index.js is transformed 1 times. child is updated'”，从而确认invalidate 从当前模块继续向 importer 传播且不会循环。
   */
  test('soft invalidate', async () => {
    const el = await page.$('.soft-invalidation')
    expect(await el.textContent()).toBe(
      'soft-invalidation/index.js is transformed 1 times. child is bar',
    )
    editFile('soft-invalidation/child.js', (code) =>
      code.replace('bar', 'updated'),
    )
    await expect
      .poll(() => el.textContent())
      .toBe(
        'soft-invalidation/index.js is transformed 1 times. child is updated',
      )

    editFile('soft-invalidation/index.js', (code) =>
      code.replace('child is', 'child is now'),
    )
    editFile('soft-invalidation/child.js', (code) =>
      code.replace('updated', 'updated?'),
    )
    await expect
      .poll(() => el.textContent())
      .toBe(
        'soft-invalidation/index.js is transformed 2 times. child is now updated?',
      )
  })

  /** invalidate 闭合到同一传播链时必须 full reload，不能无限生成后续 HMR 事务。 */
  /**
   * 场景：在当前 playground 中，修改 “editFile( 'invalidation-circular-deps/circular-invalidate/child.js', (code) => code.replace('child', 'ch…”。
   * 验证目标：“el.textContent()” 应匹配 “'child'”；“page.textContent('.invalidation-circular-deps')” 应匹配 “'child updated'”，从而确认invalidate 从当前模块继续向 importer 传播且不会循环。
   */
  test('invalidate in circular dep should not trigger infinite HMR', async () => {
    const el = await page.$('.invalidation-circular-deps')
    await expect.poll(() => el.textContent()).toMatch('child')
    editFile(
      'invalidation-circular-deps/circular-invalidate/child.js',
      (code) => code.replace('child', 'child updated'),
    )
    await page.waitForEvent('load')
    await expect
      .poll(() => page.textContent('.invalidation-circular-deps'))
      .toMatch('child updated')
  })

  /**
   * 场景：在当前 playground 中，修改 “editFile( 'invalidation-circular-deps/invalidate-handled-in-circle/child.js', (code) => code.replace('ch…”。
   * 验证目标：“el.textContent()” 应匹配 “'child'”；“el.textContent()” 应匹配 “'child updated'”，从而确认invalidate 从当前模块继续向 importer 传播且不会循环。
   */
  test('invalidate in circular dep should be hot updated if possible', async () => {
    const el = await page.$('.invalidation-circular-deps-handled')
    await expect.poll(() => el.textContent()).toMatch('child')
    editFile(
      'invalidation-circular-deps/invalidate-handled-in-circle/child.js',
      (code) => code.replace('child', 'child updated'),
    )
    await expect.poll(() => el.textContent()).toMatch('child updated')
  })

  /**
   * 场景：在当前 playground 中，修改 “editFile('customFile.js', (code) => code.replace('custom', 'edited2'))”。
   * 验证目标：“el.textContent()” 应匹配 “'edited2'”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('plugin hmr handler + custom event', async () => {
    const el = await page.$('.custom')
    editFile('customFile.js', (code) => code.replace('custom', 'edited2'))
    await expect.poll(() => el.textContent()).toMatch('edited2')
  })

  /**
   * 场景：在当前 playground 中，修改 “editFile('customFile.js', (code) => code.replace('edited2', 'custom33'))”。
   * 验证目标：“el.textContent()” 应匹配 “'edited2'”；“el.textContent()” 应匹配 “'edited2'”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('plugin hmr remove custom events', async () => {
    const el = await page.$('.toRemove')
    await expect.poll(() => el.textContent()).toMatch('edited2')
    editFile('customFile.js', (code) => code.replace('edited2', 'custom33'))
    await expect.poll(() => el.textContent()).toMatch('edited2')
  })

  /**
   * 场景：在当前 playground 中，加载用例 fixture 并观察 “el.textContent()”。
   * 验证目标：“el.textContent()” 应匹配 “'3'”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('plugin client-server communication', async () => {
    const el = await page.$('.custom-communication')
    await expect.poll(() => el.textContent()).toMatch('3')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto( viteTestUrl + '/unicode-path/中文-にほんご-한글-🌕🌖🌗/index.html', )”，然后修改 “editFile('unicode-path/中文-にほんご-한글-🌕🌖🌗/index.html', (code) => code.replace('title', 'title2'), )”。
   * 验证目标：“await el.textContent()” 应等于 “'title'”；“(await page.$('#app')).textContent()” 应等于 “'title2'”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('full-reload encodeURI path', async () => {
    await page.goto(
      viteTestUrl + '/unicode-path/中文-にほんご-한글-🌕🌖🌗/index.html',
    )
    const el = await page.$('#app')
    expect(await el.textContent()).toBe('title')
    editFile('unicode-path/中文-にほんご-한글-🌕🌖🌗/index.html', (code) =>
      code.replace('title', 'title2'),
    )
    await page.waitForEvent('load')
    await expect
      .poll(async () => (await page.$('#app')).textContent())
      .toBe('title2')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后修改 “editFile('global.css', (code) => code.replace('white', 'tomato'))”。
   * 验证目标：“elprev.textContent()” 应匹配 “'param=required'”；“elpost.textContent()” 应匹配 “'param=required'”，从而确认CSS HMR 替换正确 link/style 且去重。
   */
  test('CSS update preserves query params', async () => {
    await page.goto(viteTestUrl)

    editFile('global.css', (code) => code.replace('white', 'tomato'))

    const elprev = await page.$('.css-prev')
    const elpost = await page.$('.css-post')
    await expect.poll(() => elprev.textContent()).toMatch('param=required')
    await expect.poll(() => elpost.textContent()).toMatch('param=required')
    const textprev = await elprev.textContent()
    const textpost = await elpost.textContent()
    expect(textprev).not.toBe(textpost)
    expect(textprev).not.toMatch('direct')
    expect(textpost).not.toMatch('direct')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后修改 “editFile('global.css', (code) => code.replace('tomato', 'white'))”。
   * 验证目标：“el.textContent()” 应匹配 “'yes'”；“el.textContent()” 应匹配 “'yes'”，从而确认CSS HMR 替换正确 link/style 且去重。
   */
  test('it swaps out link tags', async () => {
    await page.goto(viteTestUrl)

    editFile('global.css', (code) => code.replace('tomato', 'white'))

    let el = await page.$('.link-tag-added')
    await expect.poll(() => el.textContent()).toMatch('yes')

    el = await page.$('.link-tag-removed')
    await expect.poll(() => el.textContent()).toMatch('yes')

    await expect.poll(async () => (await page.$$('link')).length).toBe(1)
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl + '/counter/index.html', { waitUntil: 'load' })”，然后点击 “btn.click()”。
   * 验证目标：“await btn.textContent()” 应等于 “'Counter 0'”；“await btn.textContent()” 应等于 “'Counter 1'”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('not loaded dynamic import', async () => {
    await page.goto(viteTestUrl + '/counter/index.html', { waitUntil: 'load' })

    let btn = await page.$('button')
    expect(await btn.textContent()).toBe('Counter 0')
    await btn.click()
    expect(await btn.textContent()).toBe('Counter 1')

    // 已加载的入口没有接受边界，修改 index.ts 按预期整页刷新。
    const indexTsLoadPromise = page.waitForEvent('load')
    editFile('counter/index.ts', (code) => code + '\n')
    await indexTsLoadPromise
    btn = await page.$('button')
    expect(await btn.textContent()).toBe('Counter 0')

    await btn.click()
    expect(await btn.textContent()).toBe('Counter 1')

    // #7561：dep.ts 声明 accept 但动态分支尚未加载，模块图的 HMR 分析状态仍是 undefined；修改它应
    // 停止传播且不 reload。未加载且没有 accept 声明的动态模块仍可能被误判为 full reload，见该讨论。
    const depTsLoadPromise = page.waitForEvent('load', { timeout: 1000 })
    editFile('counter/dep.ts', (code) => code + ' ')
    await expect(depTsLoadPromise).rejects.toThrow(
      /page\.waitForEvent: Timeout \d+ms exceeded while waiting for event "load"/,
    )

    btn = await page.$('button')
    expect(await btn.textContent()).toBe('Counter 1')
  })

  // #2255：更新 importer 时不能把已更新依赖重复执行一次。
  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后修改 “editFile('importing-updated/a.js', (code) => code.replace("'a0'", "'a1' "))”。
   * 验证目标：“getOutput” 应匹配 “['a.js: a0', 'b.js: b0,a0'].join('<br>')”；“getOutput” 应匹配 “['a.js: a0', 'b.js: b0,a0', 'a.js: a1'].join('<br>')”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('importing reloaded', async () => {
    await page.goto(viteTestUrl)
    const outputEle = await page.$('.importing-reloaded')
    /** 读取 importer/dep 执行顺序累积到测试节点的 HTML。 */
    const getOutput = () => {
      return outputEle.innerHTML()
    }

    await expect
      .poll(getOutput)
      .toMatch(['a.js: a0', 'b.js: b0,a0'].join('<br>'))

    editFile('importing-updated/a.js', (code) => code.replace("'a0'", "'a1' "))
    await expect
      .poll(getOutput)
      .toMatch(['a.js: a0', 'b.js: b0,a0', 'a.js: a1'].join('<br>'))

    editFile('importing-updated/b.js', (code) =>
      code.replace('`b0,${a}`', '`b1,${a}` '),
    )
    // 更新 b 后不应再次出现第二条 “a.js: a1”，否则说明依赖被重复导入执行。
    await expect
      .poll(getOutput)
      .toMatch(
        ['a.js: a0', 'b.js: b0,a0', 'a.js: a1', 'b.js: b1,a1'].join('<br>'),
      )
  })

  /**
   * acceptExports 传播规则：服务端比较 importer.importedBindings 与 acceptedHmrExports。所有实际使用
   * binding 都被接受时停止冒泡；任一未接受、namespace/dynamic import 不可精确证明时继续到上层。
   */
  describe('acceptExports', () => {
    const HOT_UPDATED = /hot updated/
    const CONNECTED = /connected/

    const baseDir = 'accept-exports'

    describe('when all used exports are accepted', () => {
      const testDir = baseDir + '/main-accepted'

      const fileName = 'target.ts'
      const file = `${testDir}/${fileName}`
      const url = '/' + file

      let dep = 'dep0'

      beforeAll(async () => {
        await untilBrowserLogAfter(
          () => page.goto(`${viteTestUrl}/${testDir}/`),
          [CONNECTED, />>>>>>/],
          (logs) => {
            expect(logs).toContain(`<<<<<< A0 B0 D0 ; ${dep}`)
            expect(logs).toContain('>>>>>> A0 D0')
          },
        )
      })

      /**
       * 场景：在 “'acceptExports'” / “'when all used exports are accepted'” 中，修改 “editFile(callbackFile, (code) => code .replace("x = 'X'", "x = 'Y'") .replace('reloaded >>>', 'reloaded …”，然后修改 “editFile(callbackFile, (code) => code.replace("x = 'Y'", "x = 'Z' "), )”。
       * 验证目标：“logs” 应深度等于 “[ 'reloaded >>> Y', '[vite] hot updated: ${callbackUrl}', ]”；“logs” 应深度等于 “[ 'reloaded (2) >>> Z', '[vite] hot updated: ${callbackUrl}', ]”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
       */
      it('the callback is called with the new version the module', async () => {
        const callbackFile = `${testDir}/callback.ts`
        const callbackUrl = '/' + callbackFile

        await untilBrowserLogAfter(
          () => {
            editFile(callbackFile, (code) =>
              code
                .replace("x = 'X'", "x = 'Y'")
                .replace('reloaded >>>', 'reloaded (2) >>>'),
            )
          },
          HOT_UPDATED,
          (logs) => {
            expect(logs).toEqual([
              'reloaded >>> Y',
              `[vite] hot updated: ${callbackUrl}`,
            ])
          },
        )

        await untilBrowserLogAfter(
          () => {
            editFile(callbackFile, (code) =>
              code.replace("x = 'Y'", "x = 'Z' "),
            )
          },
          HOT_UPDATED,
          (logs) => {
            expect(logs).toEqual([
              'reloaded (2) >>> Z',
              `[vite] hot updated: ${callbackUrl}`,
            ])
          },
        )
      })

      /**
       * 场景：在 “'acceptExports'” / “'when all used exports are accepted'” 中，修改 “editFile( depFile, (code) => code.replace('dep0', (dep = 'dep1')) + '\n', )”。
       * 验证目标：“logs” 应深度等于 “[ '<<<<<< A0 B0 D0 ; ${dep}', '[vite] hot updated: ${url}', ]”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
       */
      it('stops HMR bubble on dependency change', async () => {
        const depFileName = 'dep.ts'
        const depFile = `${testDir}/${depFileName}`

        await untilBrowserLogAfter(
          () => {
            editFile(
              depFile,
              (code) => code.replace('dep0', (dep = 'dep1')) + '\n',
            )
          },
          HOT_UPDATED,
          (logs) => {
            expect(logs).toEqual([
              `<<<<<< A0 B0 D0 ; ${dep}`,
              `[vite] hot updated: ${url}`,
            ])
          },
        )
      })

      /**
       * 场景：在 “'acceptExports'” / “'when all used exports are accepted'” 中，修改 “editFile(file, (code) => code.replace(/(\b[A-Z])0/g, '$11') + '\n')”。
       * 验证目标：“logs” 应深度等于 “[ '<<<<<< A1 B1 D1 ; ${dep}', '[vite] hot updated: ${url}', ]”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
       */
      it('accepts itself and refreshes on change', async () => {
        await untilBrowserLogAfter(
          () => {
            editFile(file, (code) => code.replace(/(\b[A-Z])0/g, '$11') + '\n')
          },
          HOT_UPDATED,
          (logs) => {
            expect(logs).toEqual([
              `<<<<<< A1 B1 D1 ; ${dep}`,
              `[vite] hot updated: ${url}`,
            ])
          },
        )
      })

      /**
       * 场景：在 “'acceptExports'” / “'when all used exports are accepted'” 中，修改 “editFile( file, (code) => code .replace(/(\b[A-Z])1/g, '$12') .replace( "acceptExports(['a', 'default']"…”。
       * 验证目标：“logs” 应深度等于 “[ '<<<<<< A2 B2 D2 ; ${dep}', '[vite] hot updated: ${url}', ]”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
       */
      it('accepts itself and refreshes on 2nd change', async () => {
        await untilBrowserLogAfter(
          () => {
            editFile(
              file,
              (code) =>
                code
                  .replace(/(\b[A-Z])1/g, '$12')
                  .replace(
                    "acceptExports(['a', 'default']",
                    "acceptExports(['b', 'default']",
                  ) + '\n',
            )
          },
          HOT_UPDATED,
          (logs) => {
            expect(logs).toEqual([
              `<<<<<< A2 B2 D2 ; ${dep}`,
              `[vite] hot updated: ${url}`,
            ])
          },
        )
      })

      /**
       * 场景：在 “'acceptExports'” / “'when all used exports are accepted'” 中，修改 “editFile(file, (code) => code.replace(/(\b[A-Z])2/g, '$13') + '\n')”。
       * 验证目标：“logs” 应包含 “'<<<<<< A3 B3 D3 ; ${dep}'”；“logs” 应包含 “'>>>>>> A3 D3'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
       */
      it('does not accept itself anymore after acceptedExports change', async () => {
        await untilBrowserLogAfter(
          async () => {
            editFile(file, (code) => code.replace(/(\b[A-Z])2/g, '$13') + '\n')
            await page.waitForEvent('load')
          },
          [CONNECTED, />>>>>>/],
          (logs) => {
            expect(logs).toContain(`<<<<<< A3 B3 D3 ; ${dep}`)
            expect(logs).toContain('>>>>>> A3 D3')
          },
        )
      })
    })

    describe('when some used exports are not accepted', () => {
      const testDir = baseDir + '/main-non-accepted'

      const namedFileName = 'named.ts'
      const namedFile = `${testDir}/${namedFileName}`
      const defaultFileName = 'default.ts'
      const defaultFile = `${testDir}/${defaultFileName}`
      const depFileName = 'dep.ts'
      const depFile = `${testDir}/${depFileName}`

      const a = 'A0'
      let dep = 'dep0'

      beforeAll(async () => {
        await untilBrowserLogAfter(
          () => page.goto(`${viteTestUrl}/${testDir}/`),
          [CONNECTED, />>>>>>/],
          (logs) => {
            expect(logs).toContain(`<<< named: ${a} ; ${dep}`)
            expect(logs).toContain(`<<< default: def0`)
            expect(logs).toContain(`>>>>>> ${a} def0`)
          },
        )
      })

      /**
       * 场景：在 “'acceptExports'” / “'when some used exports are not accepted'” 中，修改 “editFile( depFile, (code) => code.replace('dep0', (dep = 'dep1')) + '\n', )”。
       * 验证目标：“logs” 应包含 “'<<< named: ${a} ; ${dep}'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
       */
      it('does not stop the HMR bubble on change to dep', async () => {
        await untilBrowserLogAfter(
          async () => {
            editFile(
              depFile,
              (code) => code.replace('dep0', (dep = 'dep1')) + '\n',
            )
            await page.waitForEvent('load')
          },
          [CONNECTED, />>>>>>/],
          (logs) => {
            expect(logs).toContain(`<<< named: ${a} ; ${dep}`)
          },
        )
      })

      describe('does not stop the HMR bubble on change to self', () => {
        /**
         * 场景：在 “'acceptExports'” / “'when some used exports are not accepted'” / “'does not stop the HMR bubble on change to self'” 中，修改 “editFile(namedFile, (code) => code.replace(a, 'A1') + '\n')”。
         * 验证目标：“logs” 应包含 “'<<< named: A1 ; ${dep}'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
         */
        it('with named exports', async () => {
          await untilBrowserLogAfter(
            async () => {
              editFile(namedFile, (code) => code.replace(a, 'A1') + '\n')
              await page.waitForEvent('load')
            },
            [CONNECTED, />>>>>>/],
            (logs) => {
              expect(logs).toContain(`<<< named: A1 ; ${dep}`)
            },
          )
        })

        /**
         * 场景：在 “'acceptExports'” / “'when some used exports are not accepted'” / “'does not stop the HMR bubble on change to self'” 中，修改 “editFile( defaultFile, (code) => code.replace('def0', 'def1') + '\n', )”。
         * 验证目标：“logs” 应包含 “'<<< default: def1'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
         */
        it('with default export', async () => {
          await untilBrowserLogAfter(
            async () => {
              editFile(
                defaultFile,
                (code) => code.replace('def0', 'def1') + '\n',
              )
              await page.waitForEvent('load')
            },
            [CONNECTED, />>>>>>/],
            (logs) => {
              expect(logs).toContain(`<<< default: def1`)
            },
          )
        })
      })
    })

    /**
     * 场景：在 “'acceptExports'” 中，导航到 “page.goto('${viteTestUrl}/${testDir}/')”，然后修改 “editFile('${testDir}/${file}', (code) => code.replace('>>> side FX', '>>> side FX !!'), )”。
     * 验证目标：“logs” 应包含 “'>>> side FX'”；“logs” 应深度等于 “[ '>>> side FX !!', '[vite] hot updated: /${testDir}/${file}', ]”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
     */
    test('accepts itself when imported for side effects only (no bindings imported)', async () => {
      const testDir = baseDir + '/side-effects'
      const file = 'side-effects.ts'

      await untilBrowserLogAfter(
        () => page.goto(`${viteTestUrl}/${testDir}/`),
        [CONNECTED, />>>/],
        (logs) => {
          expect(logs).toContain('>>> side FX')
        },
      )

      await untilBrowserLogAfter(
        () => {
          editFile(`${testDir}/${file}`, (code) =>
            code.replace('>>> side FX', '>>> side FX !!'),
          )
        },
        HOT_UPDATED,
        (logs) => {
          expect(logs).toEqual([
            '>>> side FX !!',
            `[vite] hot updated: /${testDir}/${file}`,
          ])
        },
      )
    })

    describe('acceptExports([])', () => {
      const testDir = baseDir + '/unused-exports'

      /**
       * 场景：在 “'acceptExports'” / “'acceptExports([])'” 中，导航到 “page.goto('${viteTestUrl}/${testDir}/')”，然后修改 “editFile( file, (code) => code.replace('-- unused --', '-> unused <-') + '\n', )”。
       * 验证目标：“logs” 应包含 “'-- unused --'”；“logs” 应深度等于 “['-> unused <-', '[vite] hot updated: ${url}']”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
       */
      test('accepts itself if no exports are imported', async () => {
        const fileName = 'unused.ts'
        const file = `${testDir}/${fileName}`
        const url = '/' + file

        await untilBrowserLogAfter(
          () => page.goto(`${viteTestUrl}/${testDir}/`),
          [CONNECTED, '-- unused --'],
          (logs) => {
            expect(logs).toContain('-- unused --')
          },
        )

        await untilBrowserLogAfter(
          () => {
            editFile(
              file,
              (code) => code.replace('-- unused --', '-> unused <-') + '\n',
            )
          },
          HOT_UPDATED,
          (logs) => {
            expect(logs).toEqual(['-> unused <-', `[vite] hot updated: ${url}`])
          },
        )
      })

      /**
       * 场景：在 “'acceptExports'” / “'acceptExports([])'” 中，导航到 “page.goto('${viteTestUrl}/${testDir}/')”，然后修改 “editFile( file, (code) => code .replace('foo0', 'foo1') .replace('-- used --', '-> used <-') + '\n', )”。
       * 验证目标：“logs” 应包含 “'-- used --'”；“logs” 应包含 “'used:foo0'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
       */
      test("doesn't accept itself if any of its exports is imported", async () => {
        const fileName = 'used.ts'
        const file = `${testDir}/${fileName}`

        await untilBrowserLogAfter(
          () => page.goto(`${viteTestUrl}/${testDir}/`),
          [CONNECTED, '-- used --'],
          (logs) => {
            expect(logs).toContain('-- used --')
            expect(logs).toContain('used:foo0')
          },
        )

        await untilBrowserLogAfter(
          async () => {
            editFile(
              file,
              (code) =>
                code
                  .replace('foo0', 'foo1')
                  .replace('-- used --', '-> used <-') + '\n',
            )
            await page.waitForEvent('load')
          },
          [CONNECTED, /used:foo/],
          (logs) => {
            expect(logs).toContain('-> used <-')
            expect(logs).toContain('used:foo1')
          },
        )
      })
    })

    describe('indiscriminate imports: import *', () => {
      /** 为不同 `import *` fixture 注册同一套 acceptExports 传播断言。 */
      const testStarExports = (testDirName: string) => {
        const testDir = `${baseDir}/${testDirName}`

        /**
         * 场景：在 “'acceptExports'” / “'indiscriminate imports: import *'” 中，导航到 “page.goto('${viteTestUrl}/${testDir}/')”，然后修改 “editFile(file, (code) => code.replace(/([abc])0/g, '$11') + '\n')”。
         * 验证目标：“logs” 应包含 “'loaded:all:a0b0c0default0'”；“logs” 应包含 “'all >>>>>> a0, b0, c0'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
         */
        it('accepts itself if all its exports are accepted', async () => {
          const fileName = 'deps-all-accepted.ts'
          const file = `${testDir}/${fileName}`
          const url = '/' + file

          await untilBrowserLogAfter(
            () => page.goto(`${viteTestUrl}/${testDir}/`),
            [CONNECTED, '>>> ready <<<'],
            (logs) => {
              expect(logs).toContain('loaded:all:a0b0c0default0')
              expect(logs).toContain('all >>>>>> a0, b0, c0')
            },
          )

          await untilBrowserLogAfter(
            () => {
              editFile(file, (code) => code.replace(/([abc])0/g, '$11') + '\n')
            },
            HOT_UPDATED,
            (logs) => {
              expect(logs).toEqual([
                'all >>>>>> a1, b1, c1',
                `[vite] hot updated: ${url}`,
              ])
            },
          )

          await untilBrowserLogAfter(
            () => {
              editFile(file, (code) => code.replace(/([abc])1/g, '$12') + '\n')
            },
            HOT_UPDATED,
            (logs) => {
              expect(logs).toEqual([
                'all >>>>>> a2, b2, c2',
                `[vite] hot updated: ${url}`,
              ])
            },
          )
        })

        /**
         * 场景：在 “'acceptExports'” / “'indiscriminate imports: import *'” 中，导航到 “page.goto('${viteTestUrl}/${testDir}/')”，然后修改 “editFile(file, (code) => code.replace(/([abc])0/g, '$11') + '\n')”。
         * 验证目标：“logs” 应包含 “'loaded:some:a0b0c0default0'”；“logs” 应包含 “'some >>>>>> a0, b0, c0'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
         */
        it("doesn't accept itself if one export is not accepted", async () => {
          const fileName = 'deps-some-accepted.ts'
          const file = `${testDir}/${fileName}`

          await untilBrowserLogAfter(
            () => page.goto(`${viteTestUrl}/${testDir}/`),
            [CONNECTED, '>>> ready <<<'],
            (logs) => {
              expect(logs).toContain('loaded:some:a0b0c0default0')
              expect(logs).toContain('some >>>>>> a0, b0, c0')
            },
          )

          await untilBrowserLogAfter(
            async () => {
              const loadPromise = page.waitForEvent('load')
              editFile(file, (code) => code.replace(/([abc])0/g, '$11') + '\n')
              await loadPromise
            },
            [CONNECTED, '>>> ready <<<'],
            (logs) => {
              expect(logs).toContain('loaded:some:a1b1c1default0')
              expect(logs).toContain('some >>>>>> a1, b1, c1')
            },
          )
        })
      }

      describe('import * from ...', () => testStarExports('star-imports'))

      describe('dynamic import(...)', () => testStarExports('dynamic-imports'))
    })
  })

  /** HTML 是文档边界，内联 CSS/资源变化通过定向页面 reload 获取新模板。 */
  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后导航到 “page.goto(viteTestUrl + '/foo/', { waitUntil: 'load' })”。
   * 验证目标：“await getBg('.import-image')” 应匹配 “'icon'”；“await getBg('.import-image')” 应匹配 “'icon'”，从而确认CSS HMR 替换正确 link/style 且去重。
   */
  test('css in html hmr', async () => {
    await page.goto(viteTestUrl)
    expect(await getBg('.import-image')).toMatch('icon')
    await page.goto(viteTestUrl + '/foo/', { waitUntil: 'load' })
    expect(await getBg('.import-image')).toMatch('icon')

    const loadPromise = page.waitForEvent('load')
    editFile('index.html', (code) => code.replace("url('./icon.png')", ''))
    await loadPromise
    expect(await getBg('.import-image')).toMatch('')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl + '/counter/index.html')”，然后修改 “editFile('counter/index.html', (code) => code.replace('Counter', 'Compteur'), )”。
   * 验证目标：“await btn.textContent()” 应等于 “'Counter 0'”；“await btn.textContent()” 应等于 “'Compteur 0'”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('HTML', async () => {
    await page.goto(viteTestUrl + '/counter/index.html')
    let btn = await page.$('button')
    expect(await btn.textContent()).toBe('Counter 0')

    const loadPromise = page.waitForEvent('load')
    editFile('counter/index.html', (code) =>
      code.replace('Counter', 'Compteur'),
    )
    await loadPromise
    btn = await page.$('button')
    expect(await btn.textContent()).toBe('Compteur 0')
  })

  /** 虚拟模块没有 watcher 文件身份；插件从真实 watch file 映射并返回虚拟 ModuleNode 参与传播。 */
  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后修改 “editFile('importedVirtual.js', (code) => code.replace('[success]', '[wow]'))”。
   * 验证目标：“await el.textContent()” 应等于 “'[success]0'”；“{ const el = await page.$('.virtual') return await el.textContent() }” 应等于 “'[wow]0'”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('handle virtual module updates', async () => {
    await page.goto(viteTestUrl)
    const el = await page.$('.virtual')
    expect(await el.textContent()).toBe('[success]0')
    editFile('importedVirtual.js', (code) => code.replace('[success]', '[wow]'))
    await expect
      .poll(async () => {
        const el = await page.$('.virtual')
        return await el.textContent()
      })
      .toBe('[wow]0')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后点击 “btn.click()”。
   * 验证目标：“await el.textContent()” 应等于 “'[wow]0'”；“{ const el = await page.$('.virtual') return await el.textContent() }” 应等于 “'[wow]1'”，从而确认invalidate 从当前模块继续向 importer 传播且不会循环。
   */
  test('invalidate virtual module', async () => {
    await page.goto(viteTestUrl)
    const el = await page.$('.virtual')
    expect(await el.textContent()).toBe('[wow]0')
    const btn = await page.$('.virtual-update')
    btn.click()
    await expect
      .poll(async () => {
        const el = await page.$('.virtual')
        return await el.textContent()
      })
      .toBe('[wow]1')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后修改 “editFile('importedVirtual.js', (code) => code.replace('[wow]', '[wow2]'))”。
   * 验证目标：“await el.textContent()” 应等于 “'0'”；“{ const el = await page.$('.virtual-dep') return await el.textContent() }” 应等于 “'[wow2]0'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
   */
  test('handle virtual module accept updates', async () => {
    await page.goto(viteTestUrl)
    const el = await page.$('.virtual-dep')
    expect(await el.textContent()).toBe('0')
    editFile('importedVirtual.js', (code) => code.replace('[wow]', '[wow2]'))
    await expect
      .poll(async () => {
        const el = await page.$('.virtual-dep')
        return await el.textContent()
      })
      .toBe('[wow2]0')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后点击 “btn.click()”。
   * 验证目标：“await el.textContent()” 应等于 “'0'”；“{ const el = await page.$('.virtual-dep') return await el.textContent() }” 应等于 “'[wow2]2'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
   */
  test('invalidate virtual module and accept', async () => {
    await page.goto(viteTestUrl)
    const el = await page.$('.virtual-dep')
    expect(await el.textContent()).toBe('0')
    const btn = await page.$('.virtual-update-dep')
    btn.click()
    await expect
      .poll(async () => {
        const el = await page.$('.virtual-dep')
        return await el.textContent()
      })
      .toBe('[wow2]2')
  })

  /**
   * 场景：入口启动时导入缺失包；HMR 连接后先注释该 import 使页面恢复，再重新启用它制造第二次加载失败。
   * 验证目标：日志顺序依次出现 connected、`missing test` 与再次 connected，恢复 import 后出现 500 与重新连接，确认启动期 missing import 不会破坏后续 full-reload/HMR 恢复链。
   */
  test('keep hmr reload after missing import on server startup', async () => {
    const file = 'missing-import/a.js'
    const importCode = "import 'missing-modules'"
    const unImportCode = `// ${importCode}`

    await untilBrowserLogAfter(
      () =>
        page.goto(viteTestUrl + '/missing-import/index.html', {
          waitUntil: 'load',
        }),
      /connected/, // 先确认 HMR 已连接，再制造启动期 missing import。
    )

    await untilBrowserLogAfter(async () => {
      const loadPromise = page.waitForEvent('load')
      editFile(file, (code) => code.replace(importCode, unImportCode))
      await loadPromise
    }, ['missing test', /connected/])

    await untilBrowserLogAfter(async () => {
      const loadPromise = page.waitForEvent('load')
      editFile(file, (code) => code.replace(unImportCode, importCode))
      await loadPromise
    }, [/500/, /connected/])
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后修改 “editFile(childFile, (code) => code.replace("value = 'child'", "value = 'child1'"), )”。
   * 验证目标：“page.textContent('.file-delete-restore')” 应匹配 “'parent:child'”；“page.textContent('.file-delete-restore')” 应匹配 “'parent:child1'”，从而确认文件增删正确触发 dispose/prune 并能恢复更新。
   */
  test('should hmr when file is deleted and restored', async () => {
    await page.goto(viteTestUrl)

    const parentFile = 'file-delete-restore/parent.js'
    const childFile = 'file-delete-restore/child.js'

    await expect
      .poll(() => page.textContent('.file-delete-restore'))
      .toMatch('parent:child')

    editFile(childFile, (code) =>
      code.replace("value = 'child'", "value = 'child1'"),
    )
    await expect
      .poll(() => page.textContent('.file-delete-restore'))
      .toMatch('parent:child1')

    // 先让 parent 不再引用 child，再删除 child。
    editFile(parentFile, (code) =>
      code.replace(
        "export { value as childValue } from './child'",
        "export const childValue = 'not-child'",
      ),
    )
    const originalChildFileCode = readFile(childFile)
    await Promise.all([
      untilBrowserLogAfter(
        () => removeFile(childFile),
        `${childFile} is disposed`,
      ),
      expect
        .poll(() => page.textContent('.file-delete-restore'))
        .toMatch('parent:not-child'),
    ])

    await untilBrowserLogAfter(async () => {
      const loadPromise = page.waitForEvent('load')
      addFile(childFile, originalChildFileCode)
      editFile(parentFile, (code) =>
        code.replace(
          "export const childValue = 'not-child'",
          "export { value as childValue } from './child'",
        ),
      )
      await loadPromise
    }, [/connected/])
    await expect
      .poll(() => page.textContent('.file-delete-restore'))
      .toMatch('parent:child')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后点击 “page.click('.intermediate-file-delete-increment')”。
   * 验证目标：“page.textContent('.intermediate-file-delete-display')” 应匹配 “'count is 1'”；“page.textContent('.intermediate-file-delete-display')” 应匹配 “'count is 2'”，从而确认文件增删正确触发 dispose/prune 并能恢复更新。
   */
  test('delete file should not break hmr', async () => {
    await page.goto(viteTestUrl)

    await expect
      .poll(() => page.textContent('.intermediate-file-delete-display'))
      .toMatch('count is 1')

    // 先累加运行时状态，后续用它判断是否发生 reload。
    await page.click('.intermediate-file-delete-increment')
    await expect
      .poll(() => page.textContent('.intermediate-file-delete-display'))
      .toMatch('count is 2')

    // 改写 import 后仍能热更新，并保留状态。
    editFile('intermediate-file-delete/index.js', (code) =>
      code.replace("from './re-export.js'", "from './display.js'"),
    )
    editFile('intermediate-file-delete/display.js', (code) =>
      code.replace('count is ${count}', 'count is ${count}!'),
    )
    await expect
      .poll(() => page.textContent('.intermediate-file-delete-display'))
      .toMatch('count is 2!')

    // re-export 已无 importer，此刻被视为图根；删除它会退化为页面 reload，状态重置。
    removeFile('intermediate-file-delete/re-export.js')
    await expect
      .poll(() => page.textContent('.intermediate-file-delete-display'))
      .toMatch('count is 1!')

    // reload 后重新累加状态。
    await page.click('.intermediate-file-delete-increment')
    await expect
      .poll(() => page.textContent('.intermediate-file-delete-display'))
      .toMatch('count is 2!')

    // 文件删除事务结束后，后续普通 HMR 仍可用且保留新状态。
    editFile('intermediate-file-delete/display.js', (code) =>
      code.replace('count is ${count}!', 'count is ${count}'),
    )
    await expect
      .poll(() => page.textContent('.intermediate-file-delete-display'))
      .toMatch('count is 2')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后修改 “editFile(parentFile, (code) => code.replace( "export { value as childValue } from './child'", "export co…”。
   * 验证目标：“page.textContent('.file-delete-restore')” 应匹配 “'parent:not-child'”；“page.textContent('.file-delete-restore')” 应匹配 “'parent:child'”，从而确认文件增删正确触发 dispose/prune 并能恢复更新。
   */
  test('deleted file should trigger dispose and prune callbacks', async () => {
    await page.goto(viteTestUrl)

    const parentFile = 'file-delete-restore/parent.js'
    const childFile = 'file-delete-restore/child.js'
    const originalChildFileCode = readFile(childFile)

    await untilBrowserLogAfter(
      () => {
        // 同一事务中取消引用并删除文件。
        editFile(parentFile, (code) =>
          code.replace(
            "export { value as childValue } from './child'",
            "export const childValue = 'not-child'",
          ),
        )
        removeFile(childFile)
      },
      [
        'file-delete-restore/child.js is disposed',
        'file-delete-restore/child.js is pruned',
      ],
      false,
    )
    await expect
      .poll(() => page.textContent('.file-delete-restore'))
      .toMatch('parent:not-child')

    // 恢复文件后旧 prune data 应已删除，不能泄漏到新模块实例。
    await untilBrowserLogAfter(() => {
      addFile(childFile, originalChildFileCode)
      editFile(parentFile, (code) =>
        code.replace(
          "export const childValue = 'not-child'",
          "export { value as childValue } from './child'",
        ),
      )
    }, 'file-delete-restore/child.js hot data after prune: undefined')
    await expect
      .poll(() => page.textContent('.file-delete-restore'))
      .toMatch('parent:child')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后修改 “editFile('prune/dep1.js', (code) => code.replace('import './dep2.js'', '// import './dep2.js''), )”。
   * 验证目标：“page.textContent('.prune')” 应匹配 “'prune-init'”；“page.textContent('.prune')” 应匹配 “'prune-init|dep2-disposed|dep2-pruned'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
   */
  test('deleting import from non-self-accepting module can trigger prune event', async () => {
    await page.goto(viteTestUrl)
    await expect.poll(() => page.textContent('.prune')).toMatch('prune-init')
    editFile('prune/dep1.js', (code) =>
      code.replace(`import './dep2.js'`, `// import './dep2.js'`),
    )
    // 即使模块仍有其他依赖，被移除的边也会触发 prune。
    await expect
      .poll(() => page.textContent('.prune'))
      .toMatch('prune-init|dep2-disposed|dep2-pruned')
    editFile('prune/dep1.js', (code) =>
      code.replace(`import './dep3.js'`, `// import './dep3.js'`),
    )
    // 删除最后一条依赖边时同样触发 prune。
    await expect
      .poll(() => page.textContent('.prune'))
      .toMatch('prune-init|dep2-disposed|dep2-pruned|dep3-disposed|dep3-pruned')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后修改 “editFile( 'optional-chaining/child.js', (code) => code.replace('const foo = 1', 'const foo = 2') + '\n',…”。
   * 验证目标：“el.textContent()” 应匹配 “'2'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
   */
  test('import.meta.hot?.accept', async () => {
    await page.goto(viteTestUrl)

    const el = await page.$('.optional-chaining')
    await untilBrowserLogAfter(
      () =>
        editFile(
          'optional-chaining/child.js',
          (code) => code.replace('const foo = 1', 'const foo = 2') + '\n',
        ),
      '(optional-chaining) child update',
    )
    await expect.poll(() => el.textContent()).toMatch('2')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl + '/self-accept-within-circular/index.html')”，然后修改 “editFile('self-accept-within-circular/c.js', (code) => code.replace('export const c = 'c'', 'export cons…”。
   * 验证目标：“await el.textContent()” 应等于 “'c'”；“page.textContent('.self-accept-within-circular')” 应等于 “'cc'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
   */
  test('hmr works for self-accepted module within circular imported files', async () => {
    await page.goto(viteTestUrl + '/self-accept-within-circular/index.html')
    const el = await page.$('.self-accept-within-circular')
    expect(await el.textContent()).toBe('c')
    const lastServerLogIndex = serverLogs.length
    editFile('self-accept-within-circular/c.js', (code) =>
      code.replace(`export const c = 'c'`, `export const c = 'cc'`),
    )
    await expect
      .poll(() => page.textContent('.self-accept-within-circular'))
      .toBe('cc')
    // 服务端仍发送精确 update；循环导致浏览器重新导入失败时，client 自行 reload 恢复执行顺序。
    expect(
      serverLogs.slice(lastServerLogIndex).map(stripVTControlCharacters),
    ).toContain('hmr update /self-accept-within-circular/c.js')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl + '/circular/index.html')”，然后修改 “editFile('circular/mod-b.js', (code) => code.replace('mod-b ->', 'mod-b (edited) ->'), )”。
   * 验证目标：“await el.textContent()” 应等于 “'mod-a -> mod-b -> mod-c -> mod-a (expected error)'”；“el.textContent()” 应等于 “'mod-a -> mod-b (edited) -> mod-c -> mod-a (expected error)'”，从而确认HMR accept 边界只截断已接受的导出/依赖传播。
   */
  test('hmr should not reload if no accepted within circular imported files', async () => {
    await page.goto(viteTestUrl + '/circular/index.html')
    const el = await page.$('.circular')
    expect(await el.textContent()).toBe(
      'mod-a -> mod-b -> mod-c -> mod-a (expected error)',
    )
    editFile('circular/mod-b.js', (code) =>
      code.replace(`mod-b ->`, `mod-b (edited) ->`),
    )
    await expect
      .poll(() => el.textContent())
      .toBe('mod-a -> mod-b (edited) -> mod-c -> mod-a (expected error)')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后修改 “editFile('logo-no-inline.svg', (code) => code.replace('height="30px"', 'height="40px" '), )”。
   * 验证目标：“el.evaluate((it) => '${it.clientHeight}')” 应匹配 “'40'”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('not inlined assets HMR', async () => {
    await page.goto(viteTestUrl)
    const el = await page.$('#logo-no-inline')
    await untilBrowserLogAfter(
      () =>
        editFile('logo-no-inline.svg', (code) =>
          code.replace('height="30px"', 'height="40px" '),
        ),
      /Logo-no-inline updated/,
    )
    await expect
      .poll(() => el.evaluate((it) => `${it.clientHeight}`))
      .toMatch('40')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”，然后修改 “editFile('logo.svg', (code) => code.replace('height="30px"', 'height="40px" '), )”。
   * 验证目标：“el.evaluate((it) => '${it.clientHeight}')” 应匹配 “'40'”，从而确认模块图更新只传播到正确边界，不发生多余整页刷新。
   */
  test('inlined assets HMR', async () => {
    await page.goto(viteTestUrl)
    const el = await page.$('#logo')
    await untilBrowserLogAfter(
      () =>
        editFile('logo.svg', (code) =>
          code.replace('height="30px"', 'height="40px" '),
        ),
      /Logo updated/,
    )
    await expect
      .poll(() => el.evaluate((it) => `${it.clientHeight}`))
      .toMatch('40')
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl + '/css-deps/index.html')”，然后修改 “editFile('css-deps/dep.js', (code) => code.replace('red', 'green'))”。
   * 验证目标：“await getColor('.css-deps')” 应等于 “'red'”；“getColor('.css-deps')” 应等于 “'green'”，从而确认CSS HMR 替换正确 link/style 且去重。
   */
  test('CSS HMR with this.addWatchFile', async () => {
    await page.goto(viteTestUrl + '/css-deps/index.html')
    expect(await getColor('.css-deps')).toBe('red')
    editFile('css-deps/dep.js', (code) => code.replace(`red`, `green`))
    await expect.poll(() => getColor('.css-deps')).toBe('green')
  })

  /**
   * 场景：页面先引用不存在的 `missing-file/a.js`，待 HMR connected 后在磁盘创建该文件并等待导航 load。
   * 验证目标：新增事件使页面重新连接且浏览器执行新文件、输出 `a.js`，确认 watcher 的 create 事件能修复此前缺失的模块图边并触发重载。
   */
  test('hmr should happen after missing file is created', async () => {
    const file = 'missing-file/a.js'
    const code = 'console.log("a.js")'

    await untilBrowserLogAfter(
      () =>
        page.goto(viteTestUrl + '/missing-file/index.html', {
          waitUntil: 'load',
        }),
      /connected/, // 先确认 HMR 已连接，再创建此前缺失的文件。
    )

    await untilBrowserLogAfter(async () => {
      const loadPromise = page.waitForEvent('load')
      addFile(file, code)
      await loadPromise
    }, [/connected/, 'a.js'])
  })

  /**
   * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl + '/css-link/index.html')”，然后修改 “editFile('css-link/styles.css', (code) => code.replace('color: orange;', '/* removed * /'), )”。
   * 验证目标：“getColor('.test-css-link')” 应等于 “'orange'”；“getColor('.test-css-link')” 应等于 “'black'”，从而确认CSS HMR 替换正确 link/style 且去重。
   */
  test('deduplicate server rendered link stylesheet', async () => {
    await page.goto(viteTestUrl + '/css-link/index.html')
    await expect.poll(() => getColor('.test-css-link')).toBe('orange')

    // 移除颜色声明时复用/更新 SSR link，不能残留旧样式。
    editFile('css-link/styles.css', (code) =>
      code.replace('color: orange;', '/* removed */'),
    )
    await expect.poll(() => getColor('.test-css-link')).toBe('black')

    // 再添加颜色，验证同一节点可持续更新。
    editFile('css-link/styles.css', (code) =>
      code.replace('/* removed */', 'color: blue;'),
    )
    await expect.poll(() => getColor('.test-css-link')).toBe('blue')

    // 从 JS 删除 CSS import 后应 prune 对应样式节点。
    editFile('css-link/main.js', (code) =>
      code.replace(`import './styles.css'`, ``),
    )
    await expect.poll(() => getColor('.test-css-link')).toBe('black')
  })
}
