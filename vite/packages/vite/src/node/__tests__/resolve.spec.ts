import { join } from 'node:path'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { createServer } from '../server'
import { createServerModuleRunner } from '../ssr/runtime/serverModuleRunner'
import type { EnvironmentOptions, InlineConfig } from '../config'
import { build } from '../build'

describe('import and resolveId', () => {
  /** 创建关闭依赖发现的 middleware Server，并返回默认 SSR ModuleRunner。 */
  async function createTestServer() {
    const server = await createServer({
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'error',
      // 否则 scanner 会遍历 __tests__ 下所有 HTML fixture，给解析顺序测试引入无关工作。
      optimizeDeps: {
        noDiscovery: true,
        include: [],
      },
      server: {
        middlewareMode: true,
        ws: false,
      },
    })
    onTestFinished(() => server.close())
    const runner = createServerModuleRunner(server.environments.ssr, {
      hmr: {
        logger: false,
      },
      sourcemapInterceptor: false,
    })
    return { server, runner }
  }

  /**
   * 场景：先由 SSR Runner 按 externalConditions 执行包，再用插件容器按普通 conditions 解析。
   * 验证目标：Runner 命中 default，内部 resolve 命中 module；两组结果不能因共享 PackageCache 而
   * 互相污染，且调用顺序不改变语义（#18302、#18332）。
   */
  test('import first', async () => {
    const { server, runner } = await createTestServer()
    const mod = await runner.import(
      '/fixtures/test-dep-conditions-app/entry-with-module',
    )
    const resolved = await server.environments.ssr.pluginContainer.resolveId(
      '@vitejs/test-dep-conditions/with-module',
    )
    expect([mod.default, resolved?.id]).toEqual([
      'dir/index.default.js',
      expect.stringContaining('dir/index.module.js'),
    ])
  })

  /**
   * 场景：与上例相同，但先执行内部 resolve，再由 Runner import。
   * 验证目标：反向顺序仍分别命中 module/default，证明入口缓存键包含 conditions 等解析选项。
   */
  test('resolveId first', async () => {
    const { server, runner } = await createTestServer()
    const resolved = await server.environments.ssr.pluginContainer.resolveId(
      '@vitejs/test-dep-conditions/with-module',
    )
    const mod = await runner.import(
      '/fixtures/test-dep-conditions-app/entry-with-module',
    )
    expect([mod.default, resolved?.id]).toEqual([
      'dir/index.default.js',
      expect.stringContaining('dir/index.module.js'),
    ])
  })
})

describe('file url', () => {
  /** 指向真实 fixture 的标准 file: URL。 */
  const fileUrl = new URL('./fixtures/file-url/entry.js', import.meta.url)

  /**
   * 创建四个虚拟模块，覆盖静态/动态 file URL import 及带 query 的同构场景。
   * resolveId 保留 `\0` 虚拟模块协议，load 返回的源码再进入正常解析管线。
   */
  function getConfig(): InlineConfig {
    return {
      configFile: false,
      root: join(import.meta.dirname, 'fixtures/file-url'),
      logLevel: 'error',
      server: {
        middlewareMode: true,
      },
      plugins: [
        {
          name: 'virtual-file-url',
          /** 把四种 file URL 导入入口解析为内部虚拟模块。 */
          resolveId(source) {
            if (source.startsWith('virtual:test-dep/')) {
              return '\0' + source
            }
          },
          /** 为静态/动态及带 query 的 file URL 场景生成对应导入源码。 */
          load(id) {
            if (id === '\0virtual:test-dep/static') {
              return `
                import * as dep from ${JSON.stringify(fileUrl.href)};
                export default dep;
              `
            }
            if (id === '\0virtual:test-dep/static-postfix') {
              return `
                import * as dep from ${JSON.stringify(fileUrl.href + '?query=test')};
                export default dep;
              `
            }
            if (id === '\0virtual:test-dep/non-static') {
              return `
                const dep = await import(/* @vite-ignore */ String(${JSON.stringify(fileUrl.href)}));
                export default dep;
              `
            }
            if (id === '\0virtual:test-dep/non-static-postfix') {
              return `
                const dep = await import(/* @vite-ignore */ String(${JSON.stringify(fileUrl.href + '?query=test')}));
                export default dep;
              `
            }
          },
        },
      ],
    }
  }

  /**
   * 场景：开发态从入口、直接 file URL、虚拟静态 import、动态 import 加载同一文件，并重复
   * 一组带 query 的请求。
   * 验证目标：无 query 的不同入口共享同一模块实例；相同 query 共享另一实例；query 与基础模块
   * 身份隔离，同时静态/动态解析结果一致（#18422、#19300）。
   */
  test('dev', async () => {
    const server = await createServer(getConfig())
    onTestFinished(() => server.close())

    const runner = createServerModuleRunner(server.environments.ssr, {
      hmr: {
        logger: false,
      },
      sourcemapInterceptor: false,
    })

    const mod = await runner.import('/entry.js')
    expect(mod.default).toEqual('ok')

    const mod2 = await runner.import(fileUrl.href)
    expect(mod2).toBe(mod)

    const mod3 = await runner.import('virtual:test-dep/static')
    expect(mod3.default).toBe(mod)

    const mod4 = await runner.import('virtual:test-dep/non-static')
    expect(mod4.default).toBe(mod)

    const mod5 = await runner.import(fileUrl.href + '?query=test')
    expect(mod5).toEqual(mod)
    expect(mod5).not.toBe(mod)

    const mod6 = await runner.import('virtual:test-dep/static-postfix')
    expect(mod6.default).toEqual(mod)
    expect(mod6.default).not.toBe(mod)
    expect(mod6.default).toBe(mod5)

    const mod7 = await runner.import('virtual:test-dep/non-static-postfix')
    expect(mod7.default).toEqual(mod)
    expect(mod7.default).not.toBe(mod)
    expect(mod7.default).toBe(mod5)
  })

  describe('environment builtins', () => {
    /** 只为目标 Environment 覆盖 builtin 列表。 */
    function getConfig(
      targetEnv: 'client' | 'ssr' | string,
      builtins: NonNullable<EnvironmentOptions['resolve']>['builtins'],
    ): InlineConfig {
      return {
        configFile: false,
        root: join(import.meta.dirname, 'fixtures/file-url'),
        logLevel: 'error',
        server: {
          middlewareMode: true,
        },
        environments: {
          [targetEnv]: {
            resolve: {
              builtins,
            },
          },
        },
      }
    }

    /** 创建 Server，并把 resolver warning 转为可断言错误，再解析指定 Environment 中的 id。 */
    async function run({
      builtins,
      targetEnv = 'custom',
      testEnv = 'custom',
      idToResolve,
    }: {
      /** 配置目标 Environment 认可的 builtin 列表。 */
      builtins?: NonNullable<EnvironmentOptions['resolve']>['builtins']
      /** 接收 builtin 覆盖配置的 Environment 名称。 */
      targetEnv?: 'client' | 'ssr' | string
      /** 实际执行 resolveId 的 Environment 名称，用于验证配置隔离。 */
      testEnv?: 'client' | 'ssr' | string
      /** 交给目标插件容器解析的模块 ID。 */
      idToResolve: string
    }) {
      const server = await createServer(getConfig(targetEnv, builtins))
      vi.spyOn(server.config.logger, 'warn').mockImplementationOnce(
        (message) => {
          throw new Error(message)
        },
      )
      onTestFinished(() => server.close())

      return server.environments[testEnv]?.pluginContainer.resolveId(
        idToResolve,
      )
    }

    /** 场景：目标 Environment 的 builtins 精确列出自定义协议 ID；验证目标：该 ID 直接解析为 external。 */
    test('declared builtin string', async () => {
      const resolved = await run({
        builtins: ['my-env:custom-builtin'],
        idToResolve: 'my-env:custom-builtin',
      })
      expect(resolved?.external).toBe(true)
    })

    /** 场景：目标 Environment 的 builtins 正则命中自定义协议；验证目标：该 ID 直接解析为 external。 */
    test('declared builtin regexp', async () => {
      const resolved = await run({
        builtins: [/^my-env:\w/],
        idToResolve: 'my-env:custom-builtin',
      })
      expect(resolved?.external).toBe(true)
    })

    /** 场景：目标 Environment 显式清空 builtins 并解析未知自定义协议；验证目标：resolver 不擅自接管，返回未解析结果。 */
    test('non declared builtin', async () => {
      const resolved = await run({
        builtins: [/* empty */],
        idToResolve: 'my-env:custom-builtin',
      })
      expect(resolved).toBeNull()
    })

    /** 场景：server Environment 清空 builtins 却导入 node:fs；验证目标：自动 external 并告警配置与实际 Node 能力不一致（#19312）。 */
    test('non declared node builtin', async () => {
      await expect(
        run({
          builtins: [/* empty */],
          idToResolve: 'node:fs',
        }),
      ).rejects.toThrowError(
        /warning: Automatically externalized node built-in module "node:fs"/,
      )
    })

    /** 场景：自定义 server consumer 没有覆盖 builtins；验证目标：继承 Node-like 默认值，node:fs 直接 external。 */
    test('default to node-like builtins', async () => {
      const resolved = await run({
        idToResolve: 'node:fs',
      })
      expect(resolved?.external).toBe(true)
    })

    /** 场景：默认 SSR Environment 解析 node:fs；验证目标：采用 Node-like builtin 默认值并直接 external。 */
    test('default to node-like builtins for ssr environment', async () => {
      const resolved = await run({
        idToResolve: 'node:fs',
        testEnv: 'ssr',
      })
      expect(resolved?.external).toBe(true)
    })

    /** 场景：client Environment 解析 Node builtin；验证目标：映射为浏览器 external 虚拟模块，而非运行时 external。 */
    test('no default to node-like builtins for client environment', async () => {
      const resolved = await run({
        idToResolve: 'node:fs',
        testEnv: 'client',
      })
      expect(resolved?.id).toEqual('__vite-browser-external:node:fs')
    })

    /** 场景：builtin 配置目标就是 client 且解析 node:fs；验证目标：仍映射浏览器 external，不被 server 默认值覆盖。 */
    test('no builtins overriding for client environment', async () => {
      const resolved = await run({
        idToResolve: 'node:fs',
        testEnv: 'client',
        targetEnv: 'client',
      })
      expect(resolved?.id).toEqual('__vite-browser-external:node:fs')
    })

    /** 场景：server Environment 显式声明 /^node:/ builtin；验证目标：node:fs 无告警地解析为 external。 */
    test('declared node builtin', async () => {
      const resolved = await run({
        builtins: [/^node:/],
        idToResolve: 'node:fs',
      })
      expect(resolved?.external).toBe(true)
    })

    /** 场景：只为一个 Environment 覆盖 builtin；验证目标：该配置不泄漏到另一个 SSR Environment。 */
    test('declared builtin string in different environment', async () => {
      const resolved = await run({
        builtins: ['my-env:custom-builtin'],
        idToResolve: 'my-env:custom-builtin',
        targetEnv: 'custom',
        testEnv: 'ssr',
      })
      expect(resolved).toBe(null)
    })
  })

  /**
   * 场景：SSR build 分别以真实 file URL 与包含该 URL 的虚拟模块为入口。
   * 验证目标：构建 resolver 与开发 resolver 同样支持 file:，并正确生成可执行产物。
   */
  test('build', async () => {
    await build({
      ...getConfig(),
      build: {
        ssr: true,
        outDir: 'dist/basic',
        rolldownOptions: {
          input: { index: fileUrl.href },
        },
      },
    })
    const mod1 = await import(
      join(import.meta.dirname, 'fixtures/file-url/dist/basic/index.js')
    )
    expect(mod1.default).toBe('ok')

    await build({
      ...getConfig(),
      build: {
        ssr: true,
        outDir: 'dist/virtual',
        rolldownOptions: {
          input: { index: 'virtual:test-dep/static' },
        },
      },
    })
    const mod2 = await import(
      join(import.meta.dirname, 'fixtures/file-url/dist/virtual/index.js')
    )
    expect(mod2.default.default).toBe('ok')
  })
})
