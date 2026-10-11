import {
  type Connect,
  type Plugin,
  type PluginOption,
  createServerModuleRunner,
  defineConfig,
} from 'vite'

export default defineConfig((env) => ({
  clearScreen: false,
  appType: 'custom',
  plugins: [
    vitePluginSsrMiddleware({
      entry: '/src/entry-server',
      preview: new URL('./dist/server/index.js', import.meta.url).toString(),
    }),
    {
      name: 'global-server',
      /** 把开发 server 放进全局，供 SSR 入口 transformIndexHtml 调用。
       * @param server 当前开发服务。 */
      configureServer(server) {
        Object.assign(globalThis, { __globalServer: server })
      },
    },
    {
      name: 'build-client',
      /** 插件 buildApp 先构建 client，供后续 builder 钩子检验 isBuilt 并构建 SSR。
       * @param builder 多环境构建器。 */
      async buildApp(builder) {
        await builder.build(builder.environments.client)
      },
    },
  ],
  resolve: {
    noExternal: true,
  },
  environments: {
    client: {
      build: {
        minify: false,
        sourcemap: true,
        outDir: 'dist/client',
      },
      optimizeDeps: {
        rolldownOptions: {
          // 手工复现场景：https://github.com/vitejs/rolldown-vite/issues/416
          transform: {},
        },
      },
    },
    ssr: {
      input: {
        index: '/src/entry-server',
      },
      optimizeDeps: {
        noDiscovery: false,
      },
      build: {
        outDir: 'dist/server',
      },
    },
  },

  builder: {
    /** 检验 client 已被前面的插件钩子构建，否则抛错；通过后构建 SSR environment。
     * @param builder 含 client/ssr 的构建器。 */
    async buildApp(builder) {
      if (!builder.environments.client.isBuilt) {
        throw new Error('Client environment should be built first')
      }
      await builder.build(builder.environments.ssr)
    },
  },
}))

// 采用 vavite 风格的 SSR 中间件插件。
/** 创建 dev ModuleRunner 与 preview 原生 import 两种 SSR 中间件入口。
 * @param options 入口与可选 preview 构建 URL。
 * @returns 包含该插件的数组。 */
export function vitePluginSsrMiddleware({
  entry,
  preview,
}: {
  /** dev runner 动态导入的 SSR 入口请求。 */
  entry: string
  /** preview 原生 import 的可选 SSR 构建产物 URL。 */
  preview?: string
}): PluginOption {
  const plugin: Plugin = {
    name: vitePluginSsrMiddleware.name,

    /** 创建 SSR runner，返回 post hook 挂载请求 handler；每次请求重新 import 以消费 HMR 的最新模块。
     * @param server 当前开发服务。
     * @returns 内建中间件后执行的挂载函数。 */
    configureServer(server) {
      const runner = createServerModuleRunner(server.environments.ssr, {
        hmr: { logger: false },
      })
      /** 导入 entry；仅 ERR_OUTDATED_OPTIMIZED_DEP 清 runner 缓存后递归重试，其他错误继续抛出。
       * @returns 当前 SSR 模块命名空间。 */
      const importWithRetry = async () => {
        try {
          return await runner.import(entry)
        } catch (e) {
          if (
            e instanceof Error &&
            (e as any).code === 'ERR_OUTDATED_OPTIMIZED_DEP'
          ) {
            runner.clearCache()
            return await importWithRetry()
          }
          throw e
        }
      }
      /** 导入并调用 SSR 模块的 default handler，捕获错误后 next(e) 交回 Connect。
       * @param req 当前请求。
       * @param res 当前响应。
       * @param next 中间件错误出口。 */
      const handler: Connect.NextHandleFunction = async (req, res, next) => {
        try {
          const mod = await importWithRetry()
          await mod['default'](req, res, next)
        } catch (e) {
          next(e)
        }
      }
      return () => server.middlewares.use(handler)
    },

    /** 提供 preview URL 时先原生导入构建模块，再返回 post hook 挂载其 default；未提供则返回 undefined。
     * @param server preview 服务。
     * @returns 可选的后置挂载函数。 */
    async configurePreviewServer(server) {
      if (preview) {
        const mod = await import(preview)
        return () => server.middlewares.use(mod.default)
      }
      return
    },
  }
  return [plugin]
}
