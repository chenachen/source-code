import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ResolvedServerUrls } from 'vite'
import { createServer, resolveConfig } from '..'
import type { ViteDevServer } from '..'
import { promiseWithResolvers } from '../../shared/utils'
import { createLogger } from '../logger'
import { normalizePath } from '../utils'

describe('resolveBuildEnvironmentOptions in dev', () => {
  /**
   * 场景：serve 配置带库模式入口。
   * 验证目标：开发态 build.rolldownOptions 不应生成生产打包 input；Environment input
   * 仍由 Dev Server 独立解析。
   */
  test('build.rolldownOptions should not have input in lib', async () => {
    const config = await resolveConfig(
      {
        build: {
          lib: {
            entry: './index.js',
          },
        },
      },
      'serve',
    )

    expect(config.build.rolldownOptions).not.toHaveProperty('input')
  })
})

describe('the dev server', () => {
  let server: ViteDevServer

  afterEach(async () => {
    await server?.close()
  })

  /**
   * 场景：client 与 ssr 使用虚拟 Environment input，且 fs.allow 为空。
   * 验证目标：client buildStart 在 Server 初始化时执行并登记安全路径；ssr 到首次
   * buildStart 才惰性解析并追加自己的入口。
   */
  test('resolves each environment input as a safe module', async () => {
    const root = path.join(import.meta.dirname, 'fixtures', 'input-option')
    const clientEntry = normalizePath(path.join(root, 'client-entry.js'))
    const ssrEntry = normalizePath(path.join(root, 'ssr-entry.js'))

    server = await createServer({
      configFile: false,
      root,
      input: 'virtual:client-entry',
      environments: {
        ssr: { input: { main: 'virtual:ssr-entry' } },
      },
      optimizeDeps: { noDiscovery: true },
      server: { fs: { allow: [] }, middlewareMode: true, ws: false },
      plugins: [
        {
          name: 'resolve-environment-entries',
          /** 按当前 Environment 名称解析虚拟入口，并返回各自真实入口路径。 */
          resolveId(id) {
            if (id === `virtual:${this.environment.name}-entry`) {
              return this.environment.name === 'client' ? clientEntry : ssrEntry
            }
          },
        },
      ],
    })

    expect(server.config.safeModulePaths).toStrictEqual(new Set([clientEntry]))
    await server.environments.ssr.pluginContainer.buildStart()
    expect(server.config.safeModulePaths).toStrictEqual(
      new Set([clientEntry, ssrEntry]),
    )
  })

  /**
   * 场景：Environment input resolveId 返回 `external: true` 的磁盘路径。
   * 验证目标：外部模块不由 Vite 提供，不能借入口身份绕过 fs.allow 加入 safeModulePaths。
   */
  test('does not mark an external environment input as safe', async () => {
    const root = path.join(import.meta.dirname, 'fixtures', 'input-option')
    const externalEntry = normalizePath(path.join(root, 'external-entry.js'))

    server = await createServer({
      configFile: false,
      root,
      input: 'virtual:external-entry',
      optimizeDeps: { noDiscovery: true },
      server: { fs: { allow: [] }, middlewareMode: true, ws: false },
      plugins: [
        {
          name: 'external-environment-entry',
          /** 把指定虚拟入口标为 external，验证它不能加入安全路径白名单。 */
          resolveId(id) {
            if (id === 'virtual:external-entry') {
              return { id: externalEntry, external: true }
            }
          },
        },
      ],
    })

    expect(server.config.safeModulePaths).not.toContain(externalEntry)
  })

  /**
   * 场景：Environment 未显式配置 input，回退解析 index.html；SSR 环境没有 HTML 入口。
   * 验证目标：client 入口加入安全路径；SSR 的预期解析失败静默忽略，不产生用户告警。
   */
  test('silently resolves index.html as the fallback for every environment', async () => {
    const root = path.join(import.meta.dirname, 'fixtures', 'input-option')
    const clientEntry = normalizePath(path.join(root, 'client-index.html'))
    const resolvedEnvironments = new Set<string>()
    const logger = createLogger('silent')
    logger.warn = vi.fn()

    server = await createServer({
      configFile: false,
      root,
      customLogger: logger,
      optimizeDeps: { noDiscovery: true },
      server: { fs: { allow: [] }, middlewareMode: true, ws: false },
      plugins: [
        {
          name: 'resolve-environment-index',
          /** 记录各 Environment 的 index.html 回退解析，并让 SSR 模拟缺少 HTML 入口。 */
          resolveId(id) {
            if (id !== 'index.html') return
            resolvedEnvironments.add(this.environment.name)
            if (this.environment.name === 'ssr') {
              throw new Error('ssr does not have an HTML entry')
            }
            return clientEntry
          },
        },
      ],
    })

    expect(resolvedEnvironments).toStrictEqual(new Set(['client']))
    await server.environments.ssr.pluginContainer.buildStart()
    expect(resolvedEnvironments).toStrictEqual(new Set(['client', 'ssr']))
    expect(server.config.safeModulePaths).toStrictEqual(new Set([clientEntry]))
    expect(logger.warn).not.toHaveBeenCalled()
  })

  /**
   * 场景：SSR 的 buildStart 钩子自身抛错，同时入口采用 index.html 回退。
   * 验证目标：只能忽略“找不到回退入口”，不能吞掉插件生命周期错误。
   */
  test('does not ignore buildStart errors while resolving fallback inputs', async () => {
    server = await createServer({
      configFile: false,
      root: path.join(import.meta.dirname, 'fixtures', 'input-option'),
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true },
      plugins: [
        {
          name: 'failing-build-start',
          perEnvironmentStartEndDuringDev: true,
          /** 仅在 SSR 生命周期抛出测试错误，验证回退入口容错不会吞掉插件异常。 */
          buildStart() {
            if (this.environment.name === 'ssr') {
              throw new Error('buildStart failed')
            }
          },
        },
      ],
      server: {
        fs: { allow: [] },
        middlewareMode: true,
        watch: null,
        ws: false,
      },
    })

    await expect(
      server.environments.ssr.pluginContainer.buildStart(),
    ).rejects.toThrow('buildStart failed')
  })

  /**
   * 场景：插件在 configureServer 中注册普通 `httpServer.on('listening')` listener。
   * 验证目标：Vite 用 prependListener 先计算 resolvedUrls，插件 listener 触发时即可读取。
   */
  test('resolves the server URLs before the httpServer listening events are called', async () => {
    expect.assertions(1)

    const options = {
      port: 5013, // 使用固定独立端口，避免与其他测试夹具冲突。
    }

    const { promise, resolve } =
      promiseWithResolvers<ResolvedServerUrls | null>()
    server = await createServer({
      root: import.meta.dirname,
      logLevel: 'error',
      // 禁用自动发现，避免 listen 扫描 __tests__ 下全部 HTML 夹具。
      optimizeDeps: {
        noDiscovery: true,
        include: [],
      },
      server: {
        strictPort: true,
        ws: false,
        ...options,
      },
      plugins: [
        {
          name: 'test',
          /** 在普通 listening listener 中读取 resolvedUrls，验证 Vite 的监听顺序。 */
          configureServer(server) {
            server.httpServer?.on('listening', () => {
              resolve(server.resolvedUrls)
            })
          },
        },
      ],
    })

    await server.listen()
    const urls = await promise

    expect(urls).toStrictEqual({
      local: ['http://localhost:5013/'],
      network: [],
      networkInterfaceNames: [],
    })
  })
})
