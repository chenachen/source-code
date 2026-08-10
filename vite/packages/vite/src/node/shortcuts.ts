import readline from 'node:readline'
import colors from 'picocolors'
import { restartServerWithUrls } from './server'
import type { ViteDevServer } from './server'
import { isDevServer } from './utils'
import type { PreviewServer } from './preview'
import { openBrowser } from './server/openBrowser'

/** Server 持有并在重启间复用的 readline 与快捷键配置。 */
export type ShortcutsState<Server = ViteDevServer | PreviewServer> = {
  /** 监听 process.stdin 行输入的 readline 实例。 */
  rl: readline.Interface
  /** 最近一次合并后的快捷键配置。 */
  options: BindCLIShortcutsOptions<Server>
}

/** CLI 快捷键绑定选项。 */
export type BindCLIShortcutsOptions<Server = ViteDevServer | PreviewServer> = {
  /** 是否打印一行 `h + enter` 帮助提示。 */
  print?: boolean
  /**
   * 自定义快捷键。同键时优先于默认项（h 帮助键除外）；同键 action=undefined 可禁用默认项。
   */
  customShortcuts?: CLIShortcut<Server>[]
}

/** 单个回车触发的 CLI 快捷键。 */
export type CLIShortcut<Server = ViteDevServer | PreviewServer> = {
  /** 单字符或字符串键。 */
  key: string
  /** 帮助列表中的动作说明。 */
  description: string
  /** 动作；缺省表示显式禁用同键默认快捷键。 */
  action?(server: Server): void | Promise<void>
}

/**
 * 为 Dev/Preview Server 绑定终端行快捷键。
 *
 * 只在存在 httpServer 且默认 TTY/非 CI 条件满足时启用。重复调用复用 readline、替换 line
 * listener，并按“手动已有顺序优先、插件新键前插”合并自定义项；Server 重启因而不会重复
 * 监听 stdin 或丢失插件快捷键（#21166）。
 */
export function bindCLIShortcuts<Server extends ViteDevServer | PreviewServer>(
  server: Server,
  opts?: BindCLIShortcutsOptions<Server>,
  enabled: boolean = process.stdin.isTTY && !process.env.CI,
): void {
  if (!server.httpServer || !enabled) {
    return
  }

  const isDev = isDevServer(server)

  // 合并快捷键：全新键前插；已有键原位更新，保持手动绑定优先于后续插件调用的顺序。
  const previousShortcuts =
    server._shortcutsState?.options.customShortcuts ?? []
  const newShortcuts = opts?.customShortcuts ?? []
  const previousKeys = new Set(previousShortcuts.map((s) => s.key))
  const customShortcuts: CLIShortcut<ViteDevServer | PreviewServer>[] = [
    ...newShortcuts.filter((s) => !previousKeys.has(s.key)),
    ...previousShortcuts.map(
      (s) => newShortcuts.find((n) => n.key === s.key) ?? s,
    ),
  ]

  const newOptions: BindCLIShortcutsOptions<Server> = {
    ...opts,
    customShortcuts,
  }

  if (opts?.print) {
    server.config.logger.info(
      colors.dim(colors.green('  ➜')) +
        colors.dim('  press ') +
        colors.bold('h + enter') +
        colors.dim(' to show help'),
    )
  }

  const shortcuts = customShortcuts.concat(
    (isDev
      ? BASE_DEV_SHORTCUTS
      : BASE_PREVIEW_SHORTCUTS) as CLIShortcut<Server>[],
  )

  let actionRunning = false

  /** 处理一行输入；同一时刻只运行一个异步 action。 */
  const onInput = async (input: string) => {
    if (actionRunning) return

    input = input.trim().toLocaleLowerCase()
    if (input === 'h') {
      const loggedKeys = new Set<string>()
      server.config.logger.info('\n  Shortcuts')

      for (const shortcut of shortcuts) {
        if (loggedKeys.has(shortcut.key)) continue
        loggedKeys.add(shortcut.key)

        if (shortcut.action == null) continue

        server.config.logger.info(
          colors.dim('  press ') +
            colors.bold(`${shortcut.key} + enter`) +
            colors.dim(` to ${shortcut.description}`),
        )
      }

      return
    }

    const shortcut = shortcuts.find((shortcut) => shortcut.key === input)
    if (!shortcut || shortcut.action == null) return

    actionRunning = true
    await shortcut.action(server)
    actionRunning = false
  }

  if (!server._shortcutsState) {
    ;(server._shortcutsState as unknown as ShortcutsState<Server>) = {
      rl: readline.createInterface({ input: process.stdin }),
      options: newOptions,
    }
    server.httpServer.on('close', () => {
      // 重启会先解除 _shortcutsState 所有权以复用 readline，此时不能关闭 stdin。
      if (server._shortcutsState) server._shortcutsState.rl.close()
    })
  } else {
    server._shortcutsState.rl.removeAllListeners('line')
    ;(server._shortcutsState.options as BindCLIShortcutsOptions<Server>) =
      newOptions
  }

  server._shortcutsState!.rl.on('line', onInput)
}

/** Dev Server 内置 restart、URL、open、clear、quit 快捷键。 */
const BASE_DEV_SHORTCUTS: CLIShortcut<ViteDevServer>[] = [
  {
    key: 'r',
    description: 'restart the server',
    /** 重启 Dev Server，并在地址变化时重新打印 URL。 */
    async action(server) {
      await restartServerWithUrls(server)
    },
  },
  {
    key: 'u',
    description: 'show server url',
    /** 重新打印当前 Dev Server 的监听地址。 */
    action(server) {
      server.config.logger.info('')
      server.printUrls()
    },
  },
  {
    key: 'o',
    description: 'open in browser',
    /** 在浏览器中打开 Dev Server 首选地址。 */
    action(server) {
      server.openBrowser()
    },
  },
  {
    key: 'c',
    description: 'clear console',
    /** 按 logger 规则清理当前终端显示。 */
    action(server) {
      server.config.logger.clearScreen('error')
    },
  },
  {
    key: 'q',
    description: 'quit',
    /** 等待 Dev Server 关闭后退出进程。 */
    async action(server) {
      try {
        await server.close()
      } finally {
        process.exit()
      }
    },
  },
]

/** Preview Server 内置 open、quit 快捷键。 */
const BASE_PREVIEW_SHORTCUTS: CLIShortcut<PreviewServer>[] = [
  {
    key: 'o',
    description: 'open in browser',
    /** 打开预览服务器首个可用的本地或网络地址。 */
    action(server) {
      const url =
        server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0]
      if (url) {
        openBrowser(url, true, server.config.logger)
      } else {
        server.config.logger.warn('No URL available to open in browser')
      }
    },
  },
  {
    key: 'q',
    description: 'quit',
    /** 等待预览服务器关闭后退出进程。 */
    async action(server) {
      try {
        await server.close()
      } finally {
        process.exit()
      }
    },
  },
]
