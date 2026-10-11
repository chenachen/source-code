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
 * acceptExports、CSS/HTML、虚拟模块、文件增删/prune 与循环依赖。DOM、导航和日志断言共同观察
 * 服务端传播边界与客户端的重新导入、回调和清理顺序。
 */
/** 静态首屏的入口、直接依赖和嵌套依赖都显示 1；开发与构建模式共用这组渲染基线。 */
test('should render', async () => {
  expect(await page.textContent('.app')).toBe('1')
  expect(await page.textContent('.dep')).toBe('1')
  expect(await page.textContent('.nested')).toBe('1')
})

// HMR runtime 只存在于开发服务器；构建态仍保留首个静态渲染断言。
if (!isBuild) {
  /** 开发首屏产生预期的五条初始化日志，其中包含 HMR connected；随后清空日志供更新用例观察。 */
  test('should connect', async () => {
    expect(browserLogs.length).toBe(5)
    expect(browserLogs.some((msg) => msg.includes('connected'))).toBe(true)
    browserLogs.length = 0
  })

  /** 请求测试插件的 hot-events-counts 端点，读取当前 HMR 客户端连接/断开累计次数。
   * @returns 插件计数对象；HTTP 请求或 JSON 解析错误继续向用例传播。
   */
  const fetchHotEvents = async (): Promise<{
    /** 已触发的 `vite:client:connect` 次数。 */
    connectCount: number
    /** 已触发的 `vite:client:disconnect` 次数。 */
    disconnectCount: number
  }> => {
    const res = await fetch(viteTestUrl + '/hot-events-counts')
    return res.json()
  }
  /** 主动刷新页面后，服务端 connect 累计次数从 1 到 2，disconnect 从 0 到 1。 */
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

  /** 连续更新自接受模块，检查旧实例 dispose、重新执行及旧实例注册的两个 accept 回调收到新值的日志顺序。 */
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

  /**
   * 场景：连续把 `hotData.js` 的值从 1 改为 2、再从 2 改为 3，并记录每轮执行、dispose 与 HMR 生命周期日志。
   * 验证目标：新实例第一轮读到 execution/dispose 中保存的 1，第二轮读到 2；按序日志包含 `/hotData.js` 更新和前后生命周期，确认 hot.data 由旧实例传入下一实例。
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

  /** 连续更新直接依赖，检查单依赖与多依赖 accept 回调中对应槽位变为新值，未变化的嵌套依赖槽位仍为 1。 */
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

  /** 嵌套依赖更新先使直接依赖重新执行，再由入口的依赖 accept 边界接管；直接依赖自身的导出值保持 3。 */
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

  /** 子模块自接受回调调用 invalidate，第二轮更新到 parent；DOM 和两轮 beforeUpdate/afterUpdate 日志确认传播顺序。 */
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

  /** 创建第二个页面后更新子模块；主页面的严格日志只有一次 parent 更新且显示新值，观察多个客户端 invalidate 的去重。 */
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

  /** 入口的自接受回调主动 invalidate，而入口没有 importer；等待页面 load 并检查新值，确认退回整页刷新。 */
  test('invalidate on root triggers page reload', async () => {
    editFile('invalidation/root.js', (code) => code.replace('Init', 'Updated'))
    await page.waitForEvent('load')
    await expect
      .poll(async () => (await page.$('.invalidation-root')).textContent())
      .toMatch('Updated')
  })

  /** 只更新依赖时 importer 保留转换次数 1；直接修改 importer 后次数变为 2，区分软失效的转换复用与重新转换。 */
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

  /** invalidate 传播回到同一链根时刷新页面；load 后的子模块值变化，证明这条环通过刷新结束。 */
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

  /** 另一条环可以在上游接受边界停止；保留原 DOM 元素句柄并读到新值，确认无需页面刷新。 */
  test('invalidate in circular dep should be hot updated if possible', async () => {
    const el = await page.$('.invalidation-circular-deps-handled')
    await expect.poll(() => el.textContent()).toMatch('child')
    editFile(
      'invalidation-circular-deps/invalidate-handled-in-circle/child.js',
      (code) => code.replace('child', 'child updated'),
    )
    await expect.poll(() => el.textContent()).toMatch('child updated')
  })

  /** mock-custom 的 hotUpdate 读取 customFile.js 新值并发送 custom:foo，页面的事件监听器把它显示出来。 */
  test('plugin hmr handler + custom event', async () => {
    const el = await page.$('.custom')
    editFile('customFile.js', (code) => code.replace('custom', 'edited2'))
    await expect.poll(() => el.textContent()).toMatch('edited2')
  })

  /** 移除 custom:remove 监听器后继续更新文件；原节点保持上一次值，确认已移除的监听器不再运行。 */
  test('plugin hmr remove custom events', async () => {
    const el = await page.$('.toRemove')
    await expect.poll(() => el.textContent()).toMatch('edited2')
    editFile('customFile.js', (code) => code.replace('edited2', 'custom33'))
    await expect.poll(() => el.textContent()).toMatch('edited2')
  })

  /** 客户端发出 custom:remote-add，插件只向请求客户端回复计算结果；页面显示 1 + 2 的结果 3。 */
  test('plugin client-server communication', async () => {
    const el = await page.$('.custom-communication')
    await expect.poll(() => el.textContent()).toMatch('3')
  })

  /** 修改含中文、日文、韩文与 emoji 路径下的 HTML，等待页面刷新并检查新标题，覆盖刷新路径编码。 */
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

  /** 更新外链 CSS 后比较旧链接和替代链接的 href：保留 param=required、移除 direct，且两者 URL 不同。 */
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

  /** CSS 更新时新增替代 link 再移除旧 link；完成后文档中只有一个对应样式链接。 */
  test('it swaps out link tags', async () => {
    await page.goto(viteTestUrl)

    editFile('global.css', (code) => code.replace('tomato', 'white'))

    let el = await page.$('.link-tag-added')
    await expect.poll(() => el.textContent()).toMatch('yes')

    el = await page.$('.link-tag-removed')
    await expect.poll(() => el.textContent()).toMatch('yes')

    await expect.poll(async () => (await page.$$('link')).length).toBe(1)
  })

  /** 入口改动先刷新并重置计数；尚未执行的动态依赖随后改动，页面计数保持 1，确认没有再次刷新。 */
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
    // 停止传播且不 reload；这一用例通过计数保留检查该行为。
    const depTsLoadPromise = page.waitForEvent('load', { timeout: 1000 })
    editFile('counter/dep.ts', (code) => code + ' ')
    await expect(depTsLoadPromise).rejects.toThrow(
      /page\.waitForEvent: Timeout \d+ms exceeded while waiting for event "load"/,
    )

    btn = await page.$('button')
    expect(await btn.textContent()).toBe('Counter 1')
  })

  // #2255：更新 importer 时不能把已更新依赖重复执行一次。
  /** 先更新 a.js，再更新导入它的 b.js；累积执行日志中 a1 只出现一次，确认依赖不会因 importer 更新而重复执行。 */
  test('importing reloaded', async () => {
    await page.goto(viteTestUrl)
    const outputEle = await page.$('.importing-reloaded')
    /** 读取 importer/dep 执行顺序累积到测试节点的 HTML。
     * @returns 当前输出节点的 HTML，供编辑后轮询完整日志串。
     */
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
   * binding 都被接受时停止冒泡；任一未接受时继续到上层。namespace/dynamic import 记录为 `*`，
   * 目标接受全部导出而被标为自接受时仍能在该模块停止。
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

      /** accept 回调的函数体来自旧实例，但参数是新实例的导出；第二次更新再使用上一轮新注册的回调。 */
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

      /** 依赖变化使 acceptExports 模块重新执行；上游使用的 binding 全被接受时，更新在这里停止。 */
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

      /** 模块修改导出值后，由自己的 acceptExports 边界接管；日志只有模块重新执行与 hot updated，上游未重新执行。 */
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

      /** 这一轮仍按旧实例的 a/default 接受列表处理；重新执行后登记的新 b/default 列表供下一轮使用。 */
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

      /** 上一轮已把接受列表改为 b/default；再次修改上游使用但不被接受的 a 后，传播到入口并刷新页面。 */
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

      /** 依赖变化影响 acceptExports 模块，而上游还使用未接受的导出；传播继续到入口并刷新页面。 */
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
        /** 上游具名导入包含未接受的导出，模块改动后必须继续传播，最终刷新页面。 */
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

        /** 上游使用的 default 不在接受列表内，模块改动后传播到入口并刷新页面。 */
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

    /** 上游只做副作用导入，没有 imported binding；空使用集合满足接受列表的子集检查，更新停在模块本身。 */
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

      /** acceptExports([]) 模块只被副作用导入，仍可成为本轮更新边界。 */
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

      /** acceptExports([]) 模块的 foo 被上游使用；接受列表无法覆盖它，更新传播到入口并刷新。 */
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
      /** 为静态星号与动态 import 两个 fixture 注册同一套全接受/部分接受的传播用例。
       * @param testDirName 相对 accept-exports 的目录；各用例导航到其页面并修改对应模块。
       */
      const testStarExports = (testDirName: string) => {
        const testDir = `${baseDir}/${testDirName}`

        /** 两目录各先加载 a0/b0/c0/default0，再连续把 a/b/c 改一、二；接受全部导出时日志精确为依赖的新值和 hot updated，无入口重新执行。 */
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

        /** 两目录各加载部分接受的依赖，再把 a/b/c 从零改一；目标未接受全部导出，等待页面 load/connected 后核对入口与依赖均执行新值。 */
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

  /** 从入口 HTML 删除内联样式并等待页面 load，确认 HTML 改动会触发刷新；空字符串匹配本身不验证样式已消失。 */
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

  /** 修改 counter 文档中的标签文本，等待页面 load 后读到 Compteur，确认 HTML 变化通过刷新取得新模板。 */
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

  /** 虚拟模块导入真实 importedVirtual.js；修改该依赖后沿模块图传播，页面显示虚拟模块的新导出。 */
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

  /** 按钮发送 virtual:increment，插件更新内部计数并调用 reloadModule(virtual ModuleNode)，页面显示拼接后的新值。 */
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

  /** 真实依赖变化经过虚拟模块，再由其 importer 的依赖 accept 回调接管，页面显示新导出。 */
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

  /** 带 suffix 的 custom 事件选择对应虚拟 ModuleNode，reloadModule 更新计数后由 importer 的 accept 边界接管。 */
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
      /connected/, // 启动时已有 missing import；先确认 HMR 已连接，再移除它恢复页面。
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

  /** 先更新 child，再取消 parent 的引用并删除 child；恢复文件和 import 后，页面重新显示 child 的值。 */
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

  /** 修改引用时计数保留；删除已无 importer 的 re-export 模块后计数因刷新重置，随后普通 HMR 又能保留新计数。 */
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

  /** 取消引用并删除 child，检查 dispose/prune 日志；恢复后 hot.data 是 undefined，确认 prune 清除了旧数据。 */
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

  /** 非自接受 importer 先删除一条依赖边，再删除最后一条边；两轮都产生对应模块的 prune 日志。 */
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

  /** 可选链写法也被分析为依赖接受边界；修改 child 后回调显示新值。 */
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

  /** 环中的自接受模块更新产生对应 HMR 日志并显示新值；客户端可在循环导入失败时通过刷新恢复执行顺序。 */
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

  /** 普通循环依赖的传播遇到已走过的节点便停止递归；保留原元素句柄并显示新值，确认此 fixture 无需刷新。 */
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

  /** 修改不内联的 SVG 高度后图片显示 40，并产生该资源的热更新日志。 */
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

  /** 页面加载默认允许内联的 SVG，修改其高度30→40并等待 Logo updated 日志，检查图片 clientHeight 文本包含40；本用例不直接断言URL编码形式。 */
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

  /** CSS 插件从 dep.js 读取颜色并登记 addWatchFile；修改依赖后重新转换 CSS，页面由红色变为绿色。 */
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

  /** SSR 样式链接连续更新颜色、移除声明，再删去 CSS import；检查颜色变化及 prune 后的样式结果。 */
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
