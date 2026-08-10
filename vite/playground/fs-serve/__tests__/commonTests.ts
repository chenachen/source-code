import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest'
import type { Page } from 'playwright-chromium'
import WebSocket from 'ws'
import testJSON from '../safe.json'
import { getWindows83ShortNameForDotEnv as getWindows83ShortNameForDotEnv } from '../root/windows83Filename'
import { browser, isServe, page, viteServer, viteTestUrl } from '~utils'

/** 延迟读取测试服务器 URL，并补齐指向 `src/` 页面入口所需的单个斜杠。 */
const getViteTestIndexHtmlUrl = () => {
  const srcPrefix = viteTestUrl.endsWith('/') ? '' : '/'
  // viteTestUrl 由 playground 启动流程惰性赋值，不能在模块求值时提前缓存完整 URL。
  return viteTestUrl + srcPrefix + 'src/'
}

/** 作为安全读取期望值的磁盘原文，避免 JSON import 转换影响比较。 */
const safeJsonContent = fs.readFileSync(
  path.resolve(import.meta.dirname, '../safe.json'),
  'utf-8',
)
/** safe.json 的稳定序列化结果，用于默认导入 DOM 比较。 */
const stringified = JSON.stringify(testJSON)

beforeAll(async () => {
  await page.goto(getViteTestIndexHtmlUrl())
})

describe.runIf(isServe)('normal', () => {
  /**
   * 这组场景先证明正常模块能力仍成立：JSON 默认/命名导出、嵌套入口与虚拟模块不会被
   * fs 安全层误拦。安全测试必须同时证明“该放行的仍能工作”，不能只覆盖拒绝路径。
   */
  /**
   * 场景：在 “'normal'” 中，加载用例 fixture 并观察 “page.textContent('.full')”。
   * 验证目标：“page.textContent('.full')” 应等于 “stringified”，从而确认静态文件响应的状态、内容、header 与 SPA fallback 符合配置。
   */
  test('default import', async () => {
    await expect.poll(() => page.textContent('.full')).toBe(stringified)
  })

  /**
   * 场景：在 “'normal'” 中，加载用例 fixture 并观察 “page.textContent('.named')”。
   * 验证目标：“page.textContent('.named')” 应等于 “testJSON.msg”，从而确认静态文件响应的状态、内容、header 与 SPA fallback 符合配置。
   */
  test('named import', async () => {
    await expect.poll(() => page.textContent('.named')).toBe(testJSON.msg)
  })

  /**
   * 场景：在 “'normal'” 中，加载用例 fixture 并观察 “page.textContent('.nested-entry')”。
   * 验证目标：“page.textContent('.nested-entry')” 应等于 “'foobar'”，从而确认静态文件响应的状态、内容、header 与 SPA fallback 符合配置。
   */
  test('nested entry', async () => {
    await expect.poll(() => page.textContent('.nested-entry')).toBe('foobar')
  })

  /**
   * 场景：在 “'normal'” 中，加载用例 fixture 并观察 “page.textContent('.virtual-svg')”。
   * 验证目标：“page.textContent('.virtual-svg')” 应匹配 “'<svg'”，从而确认静态文件响应的状态、内容、header 与 SPA fallback 符合配置。
   */
  test('virtual svg module', async () => {
    await expect.poll(() => page.textContent('.virtual-svg')).toMatch('<svg')
  })
})

describe.runIf(isServe)('matrix', () => {
  /** Windows 开启 8.3 文件名时，用真实短名验证 deny 不能被别名绕过。 */
  const dotEnvWindows83ShortName = getWindows83ShortNameForDotEnv()

  /** 同一访问场景分别走 root 静态路径与 `/@fs/` 绝对路径协议。 */
  const variants = [
    { variantId: '', variantName: 'normal' },
    { variantId: '-fs', variantName: '/@fs/' },
  ] as const
  /** 安全矩阵 DOM id 使用的普通路径与 `/@fs/` 后缀联合。 */
  type VariantId = (typeof variants)[number]['variantId']
  /**
   * 文件访问安全矩阵。
   * 场景覆盖 allow、root 外文件、查询组合、deny glob、特殊字符、NTFS ADS 与 Windows 8.3
   * 路径；目标是两条静态服务入口使用同一安全判定，真实受限文件返回 403，不存在/不可解析
   * 路径按 404 或 SPA fallback 处理。
   */
  const cases: Array<{
    /** 用例标题中描述的访问或攻击场景。 */
    name: string
    /** 页面为该请求写入 status/content 的 DOM id 片段。 */
    testId: string
    /** 响应正文应等于或匹配的安全结果。 */
    content: string | RegExp
    /** 允许的平台相关 HTTP 状态集合。 */
    status: string | string[]
    /** 不适用于该路径协议的 variant。 */
    disableVariants?: VariantId[]
    /** 当前平台无法构造真实攻击路径时跳过。 */
    skip?: boolean
    /** 普通 URL 未命中时是否应进入 index.html SPA fallback。 */
    isSPAFallback?: boolean
  }> = [
    {
      name: 'safe fetch',
      testId: 'safe',
      content: /KEY=safe/,
      status: '200',
    },
    {
      name: 'safe fetch with query',
      testId: 'safe-query',
      content: /KEY=safe/,
      status: '200',
    },
    {
      name: 'safe fetch in subdir',
      testId: 'safe-subdir',
      content: /KEY=safe/,
      status: '200',
    },
    {
      name: 'safe fetch with special characters',
      testId: 'safe-subdir-special-characters',
      content: /KEY=safe/,
      status: '200',
    },
    {
      name: 'safe fetch with special characters 2',
      testId: 'safe-subdir-special-characters2',
      content: safeJsonContent,
      status: '200',
    },
    {
      name: 'safe fetch imported',
      testId: 'safe-imported',
      content: safeJsonContent,
      status: '200',
      disableVariants: [''],
    },
    {
      name: 'safe fetch imported with query',
      testId: 'safe-imported-query',
      content: safeJsonContent,
      status: '200',
      disableVariants: [''],
    },

    {
      name: 'unsafe fetch',
      testId: 'unsafe',
      content: /403 Restricted/,
      status: '403',
    },
    {
      name: 'unsafe JSON fetch',
      testId: 'unsafe-json',
      content: /403 Restricted/,
      status: '403',
      disableVariants: [''],
    },
    {
      name: 'unsafe HTML fetch',
      testId: 'unsafe-html',
      content: /403 Restricted/,
      status: '403',
    },
    {
      name: 'unsafe HTML fetch outside root',
      testId: 'unsafe-html-outside-root',
      content: /403 Restricted/,
      status: '403',
      disableVariants: [''],
    },
    {
      name: 'unsafe fetch with special characters (#8498)',
      testId: 'unsafe-8498',
      content: '',
      status: '404',
    },
    {
      name: 'unsafe fetch with special characters 2 (#8498)',
      testId: 'unsafe-8498-2',
      content: '',
      status: '404',
    },
    {
      name: 'unsafe fetch import inline',
      testId: 'unsafe-import-inline',
      content: /403 Restricted/,
      status: '403',
    },
    {
      name: 'unsafe fetch raw query import',
      testId: 'unsafe-raw-query-import',
      content: /403 Restricted/,
      status: '403',
    },
    {
      name: 'unsafe fetch raw import raw outside root',
      testId: 'unsafe-raw-import-raw-outside-root',
      content: /403 Restricted/,
      status: '403',
      disableVariants: [''],
    },
    {
      name: 'unsafe fetch raw import raw outside root 1',
      testId: 'unsafe-raw-import-raw-outside-root1',
      content: /403 Restricted/,
      status: '403',
      disableVariants: [''],
    },
    {
      name: 'unsafe fetch raw import raw outside root 2',
      testId: 'unsafe-raw-import-raw-outside-root2',
      content: /403 Restricted/,
      status: '403',
      disableVariants: [''],
    },
    {
      name: 'unsafe fetch with ?url query',
      testId: 'unsafe-url',
      content: /403 Restricted/,
      status: '403',
    },
    {
      name: 'unsafe fetch ?.svg?import',
      testId: 'unsafe-query-dot-svg-import',
      content: /403 Restricted/,
      status: '403',
    },
    {
      name: 'unsafe fetch .svg?import',
      testId: 'unsafe-svg',
      content: /403 Restricted/,
      status: '403',
    },
    {
      name: 'unsafe fetch import inline wasm init',
      testId: 'unsafe-import-inline-wasm-init',
      content: /403 Restricted/,
      status: '403',
    },
    // base 变体会先被 SPA fallback 接管为 200；根变体的对应 `/@fs/` 请求仍是 403。
    {
      name: 'unsafe fetch with relative path after query',
      testId: 'unsafe-relative-path-after-query',
      content: /403 Restricted|^$/,
      status: ['403', '404'],
      isSPAFallback: true,
    },
    {
      name: 'denied .env',
      testId: 'unsafe-dotenv',
      content: /403 Restricted/,
      status: '403',
    },
    // 大小写不敏感文件系统会实际命中受限文件返回 403；其他系统找不到该文件，返回 404。
    {
      name: 'denied env casing',
      testId: 'unsafe-dotenv-casing',
      content: /403 Restricted|^$/,
      status: ['403', '404'],
    },
    {
      name: 'denied .env with raw query',
      testId: 'unsafe-dotenv-raw',
      content: /403 Restricted/,
      status: '403',
    },
    {
      name: 'denied .env with url query',
      testId: 'unsafe-dotenv-url',
      content: /403 Restricted/,
      status: '403',
    },
    {
      name: 'denied .env with inline query',
      testId: 'unsafe-dotenv-inline',
      content: /403 Restricted/,
      status: '403',
    },
    {
      name: 'denied env with ?.svg?.wasm?init',
      testId: 'unsafe-dotenv-query-dot-svg-wasm-init',
      content: /403 Restricted/,
      status: '403',
    },
    {
      name: 'denied .env with import and raw query',
      testId: 'unsafe-dotenv-import-raw',
      content: /403 Restricted/,
      status: '403',
    },
    // NTFS 的 `::$DATA` 可暴露文件默认数据流，使 `.env::$DATA` 等同 `.env`；非 NTFS 为 404。
    {
      name: 'denied .env with NTFS ADS suffix',
      testId: 'unsafe-dotenv-ntfs-ads',
      content: /403 Restricted|^$/,
      status: ['403', '404'],
    },
    // Windows 开启 8.3 名称时，可用 `ENV~1` 一类短名访问 `.env`，因此 strict 模式拒绝 `~`。
    {
      name: 'denied .env with 8.3 short name',
      testId: 'unsafe-dotenv-83-short-name',
      content: /403 Restricted/,
      status: '403',
      // 系统未启用 8.3 短名时无法构造真实攻击路径。
      skip: dotEnvWindows83ShortName === undefined,
    },
  ]

  for (const {
    name,
    testId,
    content,
    status,
    disableVariants,
    skip,
    isSPAFallback,
  } of cases) {
    for (const { variantId, variantName } of variants) {
      if (disableVariants?.includes(variantId)) {
        continue
      }

      /**
       * 场景：把每个安全/拒绝案例分别通过普通 URL、`/@fs/`、`?raw` 等 variant 请求，并轮询对应 `status`、`content` DOM 槽位。
       * 验证目标：普通 SPA fallback 场景返回 200 与矩阵摘要，其余组合必须匹配案例声明的 `status` 和 `content`，确认 allow/deny 对所有加载入口采用同一安全边界。
       */
      test.concurrent(
        `${name} (${variantName})`,
        { skip },
        async ({ expect }) => {
          const baseSelector = `.fetch${variantId}-${testId}`
          const actualStatus = expect.poll(() =>
            page.textContent(`${baseSelector}-status`),
          )
          const actualContent = expect.poll(() =>
            page.textContent(`${baseSelector}-content`),
          )

          if (variantName === 'normal' && isSPAFallback) {
            // 浏览器普通路径在静态层未命中时会进入 SPA fallback，不能按 `/@fs/` 的 403 断言。
            await actualStatus.toBe('200')
            await actualContent.toContain(
              '<h1>FS Serve Matrix Test Summary</h1>',
            )
            return
          }

          if (typeof status === 'string') {
            await actualStatus.toBe(status)
          } else {
            await actualStatus.toBeOneOf(status)
          }

          if (typeof content === 'string') {
            await actualContent.toBe(content)
          } else {
            await actualContent.toMatch(content)
          }
        },
      )
    }
  }
})

describe('fetch', () => {
  /** 场景/目标：直接静态响应也必须附加用户配置的 server.headers。 */
  /**
   * 场景：在 “'fetch'” 中，请求 “fetch(viteTestUrl + '/src/')”。
   * 验证目标：“res.headers.get('x-served-by')” 应等于 “'vite'”，从而确认静态文件响应的状态、内容、header 与 SPA fallback 符合配置。
   */
  test('serve with configured headers', async () => {
    const res = await fetch(viteTestUrl + '/src/')
    expect(res.headers.get('x-served-by')).toBe('vite')
  })
})

describe('cross origin', () => {
  /** 在指定页面 origin 内发起 Fetch，网络/CORS 拒绝统一映射为 -1。 */
  const fetchStatusFromPage = async (page: Page, url: string) => {
    return await page.evaluate(async (url: string) => {
      try {
        const res = await globalThis.fetch(url)
        return res.status
      } catch {
        return -1
      }
    }, url)
  }

  /** 从浏览器页面创建 Vite HMR WebSocket，返回握手是否成功。 */
  const connectWebSocketFromPage = async (page: Page, url: string) => {
    return await page.evaluate(async (url: string) => {
      try {
        const ws = new globalThis.WebSocket(url, ['vite-hmr'])
        await new Promise<void>((resolve, reject) => {
          ws.addEventListener('open', () => {
            resolve()
            ws.close()
          })
          ws.addEventListener('error', () => {
            reject()
          })
        })
        return true
      } catch {
        return false
      }
    }, url)
  }

  /** 从 Node 客户端显式控制 Host/Origin，覆盖浏览器不允许伪造的安全边界。 */
  const connectWebSocketFromServer = async (
    url: string,
    host: string,
    origin: string | undefined,
  ) => {
    try {
      const ws = new WebSocket(url, ['vite-hmr'], {
        headers: {
          Host: host,
          ...(origin ? { Origin: origin } : undefined),
        },
      })
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => {
          resolve()
          ws.close()
        })
        ws.addEventListener('error', () => {
          reject()
        })
      })
      return true
    } catch {
      return false
    }
  }

  describe('allowed for same origin', () => {
    // 同源 HTTP、允许 Host、有效 token 和无 Origin 的非浏览器 WS 都应保持可用。
    beforeEach(async () => {
      await page.goto(getViteTestIndexHtmlUrl())
    })

    /**
     * 场景：在 “'cross origin'” / “'allowed for same origin'” 中，加载用例 fixture 并观察 “status”。
     * 验证目标：“status” 应等于 “200”，从而确认静态文件响应的状态、内容、header 与 SPA fallback 符合配置。
     */
    test('fetch HTML file', async () => {
      const status = await fetchStatusFromPage(page, viteTestUrl + '/src/')
      expect(status).toBe(200)
    })

    /**
     * 场景：在 “'cross origin'” / “'allowed for same origin'” 中，加载用例 fixture 并观察 “status”。
     * 验证目标：“status” 应等于 “200”，从而确认静态文件响应的状态、内容、header 与 SPA fallback 符合配置。
     */
    test.runIf(isServe)('fetch JS file', async () => {
      const status = await fetchStatusFromPage(
        page,
        viteTestUrl + '/src/code.js',
      )
      expect(status).toBe(200)
    })

    /**
     * 场景：在 “'cross origin'” / “'allowed for same origin'” 中，加载用例 fixture 并观察 “result”。
     * 验证目标：“result” 应等于 “true”，从而确认Host/Origin/token 校验在 WebSocket 升级前执行。
     */
    test.runIf(isServe)('connect WebSocket with valid token', async () => {
      const token = viteServer.config.webSocketToken
      const result = await connectWebSocketFromPage(
        page,
        `${viteTestUrl}?token=${token}`,
      )
      expect(result).toBe(true)
    })

    /**
     * 场景：在 “'cross origin'” / “'allowed for same origin'” 中，请求 “fetch(viteTestUrl + '/src/index.html', { headers: { Host: viteTestUrlUrl.host }, })”。
     * 验证目标：“res.status” 应等于 “200”，从而确认Host allowlist 拦截 DNS rebinding 而不影响显式允许主机。
     */
    test('fetch with allowed hosts', async () => {
      const viteTestUrlUrl = new URL(viteTestUrl)
      const res = await fetch(viteTestUrl + '/src/index.html', {
        headers: { Host: viteTestUrlUrl.host },
      })
      expect(res.status).toBe(200)
    })

    /**
     * 场景：在 “'cross origin'” / “'allowed for same origin'” 中，加载用例 fixture 并观察 “result”。
     * 验证目标：“result” 应等于 “true”，从而确认Host/Origin/token 校验在 WebSocket 升级前执行。
     */
    test.runIf(isServe)(
      'connect WebSocket with valid token with allowed hosts',
      async () => {
        const viteTestUrlUrl = new URL(viteTestUrl)
        const token = viteServer.config.webSocketToken
        const result = await connectWebSocketFromServer(
          `${viteTestUrl}?token=${token}`,
          viteTestUrlUrl.host,
          viteTestUrlUrl.origin,
        )
        expect(result).toBe(true)
      },
    )

    /**
     * 场景：在 “'cross origin'” / “'allowed for same origin'” 中，加载用例 fixture 并观察 “result”。
     * 验证目标：“result” 应等于 “true”，从而确认Host/Origin/token 校验在 WebSocket 升级前执行。
     */
    test.runIf(isServe)(
      'connect WebSocket without a token without the origin header',
      async () => {
        const viteTestUrlUrl = new URL(viteTestUrl)
        const result = await connectWebSocketFromServer(
          viteTestUrl,
          viteTestUrlUrl.host,
          undefined,
        )
        expect(result).toBe(true)
      },
    )
  })

  describe('denied for different origin', async () => {
    // 跨源 HTTP 受 CORS 限制；错误 Host 受 host validation 限制；WS 还需正确 token/origin。
    let page2: Page
    beforeEach(async () => {
      page2 = await browser.newPage()
      // 本地伪造 vite.dev 页面 origin，避免测试依赖公共站点网络稳定性。
      await page2.route('http://vite.dev/**', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>404</title>',
        }),
      )
      await page2.goto('http://vite.dev/404')
    })
    afterEach(async () => {
      await page2.close()
    })

    /**
     * 场景：在 “'cross origin'” / “'denied for different origin'” 中，加载用例 fixture 并观察 “status”。
     * 验证目标：“status” 不应等于 “200”，从而确认静态文件响应的状态、内容、header 与 SPA fallback 符合配置。
     */
    test('fetch HTML file', async () => {
      const status = await fetchStatusFromPage(page2, viteTestUrl + '/src/')
      expect(status).not.toBe(200)
    })

    /**
     * 场景：在 “'cross origin'” / “'denied for different origin'” 中，加载用例 fixture 并观察 “status”。
     * 验证目标：“status” 不应等于 “200”，从而确认静态文件响应的状态、内容、header 与 SPA fallback 符合配置。
     */
    test.runIf(isServe)('fetch JS file', async () => {
      const status = await fetchStatusFromPage(
        page2,
        viteTestUrl + '/src/code.js',
      )
      expect(status).not.toBe(200)
    })

    /**
     * 场景：在 “'cross origin'” / “'denied for different origin'” 中，加载用例 fixture 并观察 “result”。
     * 验证目标：“result” 应等于 “false”；“result2” 应等于 “false”，从而确认Host/Origin/token 校验在 WebSocket 升级前执行。
     */
    test.runIf(isServe)('connect WebSocket without token', async () => {
      const result = await connectWebSocketFromPage(page, viteTestUrl)
      expect(result).toBe(false)

      const result2 = await connectWebSocketFromPage(
        page,
        `${viteTestUrl}?token=`,
      )
      expect(result2).toBe(false)
    })

    /**
     * 场景：在 “'cross origin'” / “'denied for different origin'” 中，加载用例 fixture 并观察 “result”。
     * 验证目标：“result” 应等于 “false”；“result2” 应等于 “false”，从而确认Host/Origin/token 校验在 WebSocket 升级前执行。
     */
    test.runIf(isServe)('connect WebSocket with invalid token', async () => {
      const token = viteServer.config.webSocketToken
      const result = await connectWebSocketFromPage(
        page,
        `${viteTestUrl}?token=${'t'.repeat(token.length)}`,
      )
      expect(result).toBe(false)

      const result2 = await connectWebSocketFromPage(
        page,
        // 长度不同也必须走常量时间 token 比较的失败路径。
        `${viteTestUrl}?token=${'t'.repeat(token.length)}t`,
      )
      expect(result2).toBe(false)
    })

    /**
     * 场景：在 “'cross origin'” / “'denied for different origin'” 中，加载用例 fixture 并观察 “res.statusCode”。
     * 验证目标：“res.statusCode” 应等于 “403”，从而确认Host allowlist 拦截 DNS rebinding 而不影响显式允许主机。
     */
    test('fetch with non-allowed hosts', async () => {
      // fetch 会自动写入正确 Host，必须用 Node http 手工构造恶意 Host header。
      const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
        http
          .get(
            viteTestUrl + '/src/index.html',
            {
              headers: {
                Host: 'vite.dev',
              },
            },
            (res) => {
              resolve(res)
            },
          )
          .on('error', (e) => {
            reject(e)
          })
      })
      expect(res.statusCode).toBe(403)
    })

    /**
     * 场景：在 “'cross origin'” / “'denied for different origin'” 中，加载用例 fixture 并观察 “result”。
     * 验证目标：“result” 应等于 “false”；“result2” 应等于 “false”，从而确认Host/Origin/token 校验在 WebSocket 升级前执行。
     */
    test.runIf(isServe)(
      'connect WebSocket with valid token with non-allowed hosts',
      async () => {
        const token = viteServer.config.webSocketToken
        const result = await connectWebSocketFromServer(
          `${viteTestUrl}?token=${token}`,
          'vite.dev',
          'http://vite.dev',
        )
        expect(result).toBe(false)

        const result2 = await connectWebSocketFromServer(
          `${viteTestUrl}?token=${token}`,
          'vite.dev',
          undefined,
        )
        expect(result2).toBe(false)
      },
    )
  })
})

describe.runIf(isServe)('fetchModule via WebSocket', () => {
  /**
   * 场景：浏览器 client WebSocket 手工发送 `vite:invoke/fetchModule`。
   * 目标：即使文件位于 fs.allow 内也必须拒绝，因为 client Environment 明确禁用服务端
   * fetchModule；root 外文件同样不得借 transport 绕过访问控制（#22159）。
   */
  const root = path.resolve(
    import.meta.dirname.replace('playground', 'playground-temp'),
    '..',
  )

  /** 通过真实 HMR 协议发送 fetchModule invoke，并等待匹配 response id。 */
  const fetchModuleViaWebSocket = async (filePath: string) => {
    const resolvedPath = path.resolve(root, filePath)
    const token = viteServer.config.webSocketToken
    const wsUrl = viteTestUrl.replace('http', 'ws')
    const ws = new WebSocket(`${wsUrl}?token=${token}`, ['vite-hmr'])

    try {
      return await Promise.race([
        new Promise<any>((resolve, reject) => {
          ws.on('open', () => {
            ws.send(
              JSON.stringify({
                type: 'custom',
                event: 'vite:invoke',
                data: {
                  name: 'fetchModule',
                  id: 'send:1',
                  data: [pathToFileURL(resolvedPath).href],
                },
              }),
            )
          })

          ws.on('message', (raw: Buffer) => {
            const parsed = JSON.parse(raw.toString())
            if (
              parsed.type === 'custom' &&
              parsed.event === 'vite:invoke' &&
              parsed.data?.id === 'response:1'
            ) {
              resolve(parsed.data.data)
            }
          })

          ws.on('error', (err) => {
            reject(err)
          })
        }),
        setTimeout(10_000).then(() =>
          Promise.reject(new Error('WebSocket response timed out')),
        ),
      ])
    } finally {
      ws.close()
    }
  }

  /**
   * 场景：在 “'fetchModule via WebSocket'” 中，加载用例 fixture 并观察 “result.result”。
   * 验证目标：“result.result” 应为 undefined；“result.error” 应为真，从而确认Host/Origin/token 校验在 WebSocket 升级前执行。
   */
  test('should not read files inside allowed directories as fetchModule is disabled', async () => {
    const result = await fetchModuleViaWebSocket('root/src/safe.txt?raw')
    expect(result.result).toBeUndefined()
    expect(result.error).toBeTruthy()
  })

  /**
   * 场景：在 “'fetchModule via WebSocket'” 中，加载用例 fixture 并观察 “result.result”。
   * 验证目标：“result.result” 应为 undefined；“result.error” 应为真，从而确认Host/Origin/token 校验在 WebSocket 升级前执行。
   */
  test('should not read files outside allowed directories', async () => {
    const result = await fetchModuleViaWebSocket('root/unsafe.txt?raw')
    expect(result.result).toBeUndefined()
    expect(result.error).toBeTruthy()
  })
})

describe.runIf(!isServe)('preview HTML', () => {
  /** 场景/目标：preview 不应像 dev transform 一样向 root 外 HTML 返回带详情的 403 页面。 */
  /**
   * 场景：在 “'preview HTML'” 中，加载用例 fixture 并观察 “page.textContent('.fetch-unsafe-html-status')”。
   * 验证目标：“page.textContent('.fetch-unsafe-html-status')” 应等于 “'404'”；“page.textContent('.fetch-unsafe-html-content')” 应等于 “''”，从而确认server.fs allow/deny 与 fetchModule 边界防止越权文件读取。
   */
  test('unsafe HTML fetch', async () => {
    await expect
      .poll(() => page.textContent('.fetch-unsafe-html-status'))
      .toBe('404')
    await expect
      .poll(() => page.textContent('.fetch-unsafe-html-content'))
      .toBe('')
  })
})
