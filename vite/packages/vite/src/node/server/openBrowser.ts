/**
 * The following is modified based on source found in
 * https://github.com/react/create-react-app
 *
 * MIT Licensed
 * Copyright (c) 2015-present, Facebook, Inc.
 * https://github.com/react/create-react-app/blob/main/LICENSE
 *
 */

import { join } from 'node:path'
import { exec } from 'node:child_process'
import type { ExecOptions } from 'node:child_process'
import open from 'open'
import type { Options } from 'open'
import spawn from 'cross-spawn'
import colors from 'picocolors'
import type { Logger } from '../logger'
import { VITE_PACKAGE_DIR } from '../constants'

/**
 * 根据 server.open、`BROWSER` 与 `BROWSER_ARGS` 决定如何打开开发地址。
 *
 * `.js` 值被视为用户脚本，由当前 Node 执行；`none` 明确禁用自动打开；其余值
 * 作为浏览器应用名。显式的 `opt` 字符串优先于环境变量。
 */
export function openBrowser(
  url: string,
  opt: string | true,
  logger: Logger,
): void {
  // browser 的字符串语义与 open 包的 app.name 一致。
  const browser = typeof opt === 'string' ? opt : process.env.BROWSER || ''
  if (browser.toLowerCase().endsWith('.js')) {
    executeNodeScript(browser, url, logger)
  } else if (browser.toLowerCase() !== 'none') {
    const browserArgs = process.env.BROWSER_ARGS
      ? process.env.BROWSER_ARGS.split(' ')
      : []
    startBrowserProcess(browser, browserArgs, url, logger)
  }
}

/** 执行 BROWSER 指定的 Node 脚本，并把 Vite CLI 参数与目标 URL 一并转交。 */
function executeNodeScript(scriptPath: string, url: string, logger: Logger) {
  const extraArgs = process.argv.slice(2)
  const child = spawn(process.execPath, [scriptPath, ...extraArgs, url], {
    stdio: 'inherit',
  })
  child.on('close', (code) => {
    if (code !== 0) {
      logger.error(
        colors.red(
          `\nThe script specified as BROWSER environment variable failed.\n\n${colors.cyan(
            scriptPath,
          )} exited with code ${code}.`,
        ),
        { error: null },
      )
    }
  })
}

/**
 * macOS JXA 脚本可操作、并可复用已有标签页的 Chromium 应用名称。
 * @see https://github.com/sindresorhus/open#app
 */
const supportedChromiumBrowsers = [
  'Google Chrome Canary',
  'Google Chrome Dev',
  'Google Chrome Beta',
  'Google Chrome',
  'Microsoft Edge',
  'Brave Browser',
  'Vivaldi',
  'Chromium',
]

/**
 * 优先在 macOS 复用已运行 Chromium 的标签页，否则交给 `open` 包启动应用。
 *
 * JXA 只是体验优化，进程查询或脚本失败不会阻断服务器启动；回退路径的异步
 * 子进程错误会进入 Vite logger，避免未处理的 Promise rejection。
 */
async function startBrowserProcess(
  browser: string | undefined,
  browserArgs: string[],
  url: string,
  logger: Logger,
) {
  // macOS 且未指定其他浏览器时，尝试通过 JXA 操作已运行的 Chromium，尽量复用
  // 标签页而不是每次启动开发服务器都新建一个。
  const preferredOSXBrowser =
    browser === 'google chrome' ? 'Google Chrome' : browser
  const shouldTryOpenChromeWithJXA =
    process.platform === 'darwin' &&
    (!preferredOSXBrowser ||
      supportedChromiumBrowsers.includes(preferredOSXBrowser))

  if (shouldTryOpenChromeWithJXA) {
    try {
      const ps = await execAsync('ps cax')
      const openedBrowser =
        preferredOSXBrowser && ps.includes(preferredOSXBrowser)
          ? preferredOSXBrowser
          : supportedChromiumBrowsers.find((b) => ps.includes(b))
      if (openedBrowser) {
        // openChrome.js 负责按“同 URL、空白页、新标签”顺序选择目标。
        await execAsync(`osascript openChrome.js "${url}" "${openedBrowser}"`, {
          cwd: join(VITE_PACKAGE_DIR, 'bin'),
        })
        return true
      }
    } catch {
      // JXA 不可用、权限不足或进程查询失败均降级到通用 open 实现。
    }
  }

  // macOS 中 `BROWSER=open` 表示使用系统默认浏览器，并不是名为 open 的 GUI 应用；
  // 清空应用名后由 open 包按系统默认方式处理：
  // https://github.com/react/create-react-app/pull/1690#issuecomment-283518768
  if (process.platform === 'darwin' && browser === 'open') {
    browser = undefined
  }

  // 通用回退会新开标签页。这里不 await 子进程结束，避免自动打开浏览器阻塞启动。
  try {
    const options: Options = browser
      ? { app: { name: browser, arguments: browserArgs } }
      : {}

    new Promise((_, reject) => {
      open(url, options)
        .then((subprocess) => {
          subprocess.on('error', reject)
        })
        .catch(reject)
    }).catch((err) => {
      logger.error(err.stack || err.message)
    })

    return true
  } catch {
    return false
  }
}

/** 将 child_process.exec 包装为只返回 stdout 的 Promise，供 macOS 探测使用。 */
function execAsync(command: string, options?: ExecOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout) => {
      if (error) {
        reject(error)
      } else {
        resolve(stdout.toString())
      }
    })
  })
}
