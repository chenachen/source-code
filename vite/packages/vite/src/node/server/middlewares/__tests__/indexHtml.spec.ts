import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, onTestFinished, test } from 'vitest'
import { createServer } from '../../../server'
import { FS_PREFIX } from '../../../constants'

/** HTML 中间件测试夹具的根目录。 */
const FIXTURE_DIR = path.resolve(import.meta.dirname, 'fixtures')
/** 包含内联 module script 的磁盘 HTML 路径。 */
const HTML_PATH = path.resolve(FIXTURE_DIR, 'root/index.html')
/** 供 root URL 与 `/@fs/` URL 两种转换路径复用的原始 HTML。 */
const HTML_CONTENT = fs.readFileSync(HTML_PATH, 'utf-8')

/** 创建关闭网络监听和依赖发现的最小 middleware server，并在当前用例结束后回收。 */
async function createTestServer(rootDir?: string) {
  const root = path.resolve(import.meta.dirname, rootDir ?? 'fixtures/root')

  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    server: {
      middlewareMode: true,
      ws: false,
    },
    optimizeDeps: {
      noDiscovery: true,
      include: [],
    },
  })

  onTestFinished(() => server.close())
  return server
}

describe('indexHtml middleware — /@fs/ inline script proxy cache', () => {
  /**
   * 场景：开发态把内联 module script 改写成 `?html-proxy`，缓存 key 同时涉及 HTML URL 与磁盘路径。
   * 验证目标：root URL 和 `/@fs/` URL 都能用改写后的 src 命中同一套代理 load 协议，而不是报 cache miss。
   * 机制：先调用 transformIndexHtml 提取代理 URL，再把该 URL 送进真实 client transformRequest。
   */
  test('inline <script type="module"> in an /@fs/ HTML file is loadable via the html-proxy module', async () => {
    const server = await createTestServer()
    const fsUrl = path.posix.join(FS_PREFIX, HTML_PATH)

    const transformed = await server.transformIndexHtml(fsUrl, HTML_CONTENT)

    expect(transformed).toContain('html-proxy')
    expect(transformed).toContain('index=0')

    const proxyUrlMatch = transformed.match(/src="([^"]*html-proxy[^"]*)"/)
    expect(
      proxyUrlMatch,
      'devHtmlHook should have rewritten the inline <script> to a ?html-proxy src',
    ).toBeTruthy()

    const proxyModuleUrl = proxyUrlMatch![1]

    const result =
      await server.environments.client.transformRequest(proxyModuleUrl)

    expect(
      result,
      'proxy module should resolve without a cache-miss error',
    ).not.toBeNull()
    expect(result!.code).toContain('module loaded')
  })

  /**
   * 场景：从 server root 提供的 HTML 含内联 module script，转换后生成 html-proxy URL。
   * 验证目标：客户端 transformRequest 能按该 URL 取回含原脚本内容的代理模块。
   * 机制：同时断言 HTML 改写参数和代理模块代码，证明缓存键与加载协议一致。
   */
  test('inline <script type="module"> in an HTML file served from root is loadable via the html-proxy module', async () => {
    const server = await createTestServer('fixtures/root')
    const url = '/index.html'

    const htmlPath = path.resolve(
      import.meta.dirname,
      'fixtures/root/index.html',
    )
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8')

    const transformed = await server.transformIndexHtml(url, htmlContent)

    expect(transformed).toContain('html-proxy')
    expect(transformed).toContain('index=0')

    const proxyUrlMatch = transformed.match(/src="([^"]*html-proxy[^"]*)"/)
    expect(
      proxyUrlMatch,
      'devHtmlHook should rewrite the inline <script> to a ?html-proxy src',
    ).toBeTruthy()

    const proxyModuleUrl = proxyUrlMatch![1]
    const result =
      await server.environments.client.transformRequest(proxyModuleUrl)

    expect(result, 'proxy module should resolve without error').not.toBeNull()
    expect(result!.code).toContain('module loaded')
  })
})

describe('indexHtml middleware — HMR timestamp injection with non-root base', () => {
  /**
   * 场景：公开 base 为 `/ui/`，模块图却按 transform 中间件去 base 后的 `/src/main.ts` 登记。
   * 验证目标：HTML 入口查图前也去 base，并把最近 HMR 时间戳加到公开 URL，避免同一入口执行两次。
   * 机制：预先入图并设置 lastHMRTimestamp，再观察 transformIndexHtml 的 src。
   */
  test('entry script URL gets the lastHMRTimestamp query when base is not root', async () => {
    const root = path.resolve(import.meta.dirname, 'fixtures/base-root')
    const server = await createServer({
      configFile: false,
      root,
      base: '/ui/',
      logLevel: 'error',
      server: {
        middlewareMode: true,
        ws: false,
      },
      optimizeDeps: {
        noDiscovery: true,
        include: [],
      },
    })
    onTestFinished(() => server.close())

    // 按 transform 中间件的去 base 身份登记入口，并模拟它刚发生过 HMR 更新。
    await server.environments.client.transformRequest('/src/main.ts')
    const mod =
      server.environments.client.moduleGraph.urlToModuleMap.get('/src/main.ts')
    expect(
      mod,
      'entry module should be registered under the base-stripped URL',
    ).toBeTruthy()
    const timestamp = 1234567890
    mod!.lastHMRTimestamp = timestamp

    const html = `<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>`
    const transformed = await server.transformIndexHtml('/index.html', html)

    // 若查图前不去 base，HTML 仍引用无时间戳的 `/ui/src/main.ts`，模块内部却引用带时间戳版本；
    // 浏览器会把同一入口视为两个 URL 并执行两次（#22932）。
    expect(transformed).toContain(`src="/ui/src/main.ts?t=${timestamp}"`)
  })
})
