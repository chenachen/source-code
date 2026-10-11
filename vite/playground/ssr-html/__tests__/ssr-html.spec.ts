import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { describe, expect, test } from 'vitest'
import { port, serverLogs } from './serve'
import { editFile, isServe, page } from '~utils'

/** custom serve创建的SSR应用访问地址。 */
const url = `http://localhost:${port}`

describe.runIf(isServe)('injected inline scripts', () => {
  /** 场景：仅serve执行：访问SSR转换HTML，枚举无src且有文本的script；核对没有残留内联模块脚本。 */
  test('no injected inline scripts are present', async () => {
    await page.goto(url)
    const inlineScripts = await page.$$eval('script', (nodes) =>
      nodes.filter((n) => !n.getAttribute('src') && n.innerHTML),
    )
    expect(inlineScripts).toHaveLength(0)
  })

  /** 场景：仅serve执行：枚举带html-proxy&index的script src，核对至少一项；逐URL fetch并核对代码非空，检查SSR注入脚本代理可取。 */
  test('injected script proxied correctly', async () => {
    await page.goto(url)
    const proxiedScripts = await page.$$eval('script', (nodes) =>
      nodes
        .filter((n) => {
          const src = n.getAttribute('src')
          if (!src) return false
          return src.includes('?html-proxy&index')
        })
        .map((n) => n.getAttribute('src')),
    )

    // 至少有一条被代理的模块脚本。
    expect(proxiedScripts).not.toHaveLength(0)

    const scriptContents = await Promise.all(
      proxiedScripts.map((src) => fetch(url + src).then((res) => res.text())),
    )

    // 每条代理URL均返回非空代码。
    for (const code of scriptContents) {
      expect(code).toBeTruthy()
    }
  })
})

describe.runIf(isServe)('trailing slash html paths', () => {
  /** 场景：仅serve执行：清serverLogs后HTTP访问/trailing-slash/dir/并读取响应，等100ms；核对200且没有Pre-transform error。 */
  test('pre-transforms relative module scripts from the trailing slash directory', async () => {
    serverLogs.length = 0

    const response = await fetch(`${url}/trailing-slash/dir/`)
    expect(response.status).toBe(200)
    await response.text()

    await setTimeout(100) // 给后台预转换留出观察窗口
    expect(serverLogs).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Pre-transform error')]),
    )
  })

  /** 场景：仅serve执行：浏览器导航带尾斜杠目录，轮询同目录/父目录两个模块消息，核对相对URL基址。 */
  test('loads relative module scripts from the trailing slash directory', async () => {
    await page.goto(`${url}/trailing-slash/dir/`)

    await expect
      .poll(() => page.textContent('.relative-script'))
      .toBe('relative module loaded')
    await expect
      .poll(() => page.textContent('.relative-parent-script'))
      .toBe('relative parent module loaded')
  })
})

describe.runIf(isServe)('hmr', () => {
  /** 场景：仅serve执行：虚拟模块初始显示success，编辑其真实来源importedVirtual.js后等待load，再核对页面wow。 */
  test('handle virtual module updates', async () => {
    await page.goto(url)
    const el = await page.$('.virtual')
    expect(await el.textContent()).toBe('[success]')

    const loadPromise = page.waitForEvent('load')
    editFile('src/importedVirtual.js', (code) =>
      code.replace('[success]', '[wow]'),
    )
    await loadPromise

    await expect
      .poll(async () => {
        const el = await page.$('.virtual')
        return await el.textContent()
      })
      .toMatch('[wow]')
  })
})

/** 将execFile转换为Promise，子进程非零退出会直接拒绝测试。 */
const execFileAsync = promisify(execFile)

describe.runIf(isServe)('stacktrace', () => {
  for (const ext of ['js', 'ts']) {
    for (const sourcemapsEnabled of [false, true]) {
      /** 场景：仅serve执行：双循环展开JS/TS × Node sourcemaps开/关四组合，运行测试子进程；筛出Module.error帧逐行核对对应源文件2:9。没有单独断言筛选列表非空。 */
      test(`stacktrace of ${ext} is correct when sourcemaps is${
        sourcemapsEnabled ? '' : ' not'
      } enabled in Node.js`, async () => {
        const testStacktraceFile = path.resolve(
          import.meta.dirname,
          '../test-stacktrace.js',
        )

        const p = await execFileAsync('node', [
          testStacktraceFile,
          '' + sourcemapsEnabled,
          ext,
        ])
        const lines = p.stdout
          .split('\n')
          .filter((line) => line.includes('Module.error'))

        const reg = new RegExp(
          path
            .resolve(import.meta.dirname, '../src', `error-${ext}.${ext}`)
            .replace(/\\/g, '\\\\') + ':2:9',
          'i',
        )

        lines.forEach((line) => {
          expect(line.trim()).toMatch(reg)
        })
      })
    }
  }

  /** 场景：仅serve执行：在fixture目录运行ModuleRunner堆栈子进程，验证进程成功退出；具体堆栈断言在子进程脚本中。 */
  test('with Vite runtime', async () => {
    await execFileAsync('node', ['test-stacktrace-runtime.js'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
    })
  })
})

/** Node>=22不运行旧network-import实验功能用例；条件来自Node主版本（PR53822）。 */
const noNetworkImports = Number(process.version.match(/^v(\d+)\./)[1]) >= 22

describe.runIf(isServe && !noNetworkImports)('network-imports', () => {
  /** 场景：仅serve且Node主版本<22执行：启动带experimental-network-imports的SSR子进程，验证其成功退出；Node>=22不执行。 */
  test('with Vite SSR', async () => {
    await execFileAsync(
      'node',
      ['--experimental-network-imports', 'test-network-imports.js'],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
      },
    )
  })

  /** 场景：仅serve且Node主版本<22执行：同network-import脚本增加--module-runner参数，验证Runner模式成功退出；Node>=22不执行。 */
  test('with Vite runtime', async () => {
    await execFileAsync(
      'node',
      [
        '--experimental-network-imports',
        'test-network-imports.js',
        '--module-runner',
      ],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
      },
    )
  })
})
