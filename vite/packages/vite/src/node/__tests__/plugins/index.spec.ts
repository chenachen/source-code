import { RUNTIME_MODULE_ID } from 'rolldown'
import { exactRegex } from 'rolldown/filter'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { type InlineConfig, type Plugin, build, createServer } from '../..'

/** 创建可同时用于 middleware Dev Server 与内存构建的最小插件测试配置。 */
const getConfigWithPlugin = (
  plugins: Plugin[],
  input?: string[],
): InlineConfig => {
  return {
    configFile: false,
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    build: { rolldownOptions: { input }, write: false },
    plugins,
    logLevel: 'silent',
  }
}

/** 验证 Dev PluginContainer 在调用 handler 前执行声明式 hook filter。 */
describe('hook filter with plugin container', async () => {
  const resolveId = vi.fn()
  const load = vi.fn()
  const transformWithId = vi.fn()
  const transformWithCode = vi.fn()
  // 与 expect.anything() 不同，此 matcher 也接受 undefined/null 的可选参数。
  const any = expect.toSatisfy(() => true)
  const config = getConfigWithPlugin([
    {
      name: 'test',
      resolveId: {
        filter: { id: /\.js$/ },
        handler: resolveId,
      },
      load: {
        filter: { id: '**/*.js' },
        handler: load,
      },
      transform: {
        filter: { id: '**/*.js' },
        handler: transformWithId,
      },
    },
    {
      name: 'test2',
      transform: {
        filter: { code: 'import.meta' },
        handler: transformWithCode,
      },
    },
  ])
  const server = await createServer(config)
  afterAll(async () => {
    await server.close()
  })
  const pluginContainer = server.environments.ssr.pluginContainer

  /**
   * 场景：resolveId 的正则只接受 `.js`。
   * 验证目标：foo.ts 在进入插件 handler 前被跳过，foo.js 的参数保持完整。
   */
  test('resolveId', async () => {
    await pluginContainer.resolveId('foo.js')
    await pluginContainer.resolveId('foo.ts')
    expect(resolveId).toHaveBeenCalledTimes(1)
    expect(resolveId).toHaveBeenCalledWith('foo.js', any, any)
  })

  /**
   * 场景：load 的 glob 只接受 `.js`。
   * 验证目标：Dev Container 与 Rolldown 对对象 hook filter 使用相同语义。
   */
  test('load', async () => {
    await pluginContainer.load('foo.js')
    await pluginContainer.load('foo.ts')
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('foo.js', any)
  })

  /**
   * 场景：两个 transform 分别按 ID 与源码子串过滤。
   * 验证目标：`.js` 只进入 ID 插件，含 import.meta 的 `.ts` 只进入 code 插件。
   */
  test('transform', async () => {
    await server.environments.ssr.moduleGraph.ensureEntryFromUrl('foo.js')
    await server.environments.ssr.moduleGraph.ensureEntryFromUrl('foo.ts')

    await pluginContainer.transform('import_meta', 'foo.js')
    await pluginContainer.transform('import.meta', 'foo.ts')
    expect(transformWithId).toHaveBeenCalledTimes(1)
    expect(transformWithId).toHaveBeenCalledWith(
      expect.stringContaining('import_meta'),
      'foo.js',
      any,
    )
    expect(transformWithCode).toHaveBeenCalledTimes(1)
    expect(transformWithCode).toHaveBeenCalledWith(
      expect.stringContaining('import.meta'),
      'foo.ts',
      any,
    )
  })
})

/** 验证同一份声明式 hook filter 在 Rolldown 生产构建中保持相同行为。 */
describe('hook filter with build', async () => {
  const resolveId = vi.fn()
  const load = vi.fn()
  const transformWithId = vi.fn()
  const transformWithCode = vi.fn()
  const any = expect.anything()
  const config = getConfigWithPlugin(
    [
      {
        name: 'test',
        resolveId: {
          filter: { id: /\.js$/ },
          handler: resolveId,
        },
        load: {
          filter: { id: '**/*.js' },
          handler: load,
        },
        transform: {
          filter: {
            id: {
              include: '**/*.js',
              exclude: exactRegex(RUNTIME_MODULE_ID),
            },
          },
          handler: transformWithId,
        },
      },
      {
        name: 'test2',
        transform: {
          filter: { code: 'import.meta' },
          handler: transformWithCode,
        },
      },
      {
        name: 'resolver',
        /** 为插件过滤集成测试解析 foo.js 与 foo.ts 测试模块。 */
        resolveId(id) {
          return id
        },
        /** 生成同时含普通标记与 import.meta 的源码，以区分 ID/code 过滤命中。 */
        load(id) {
          if (id === 'foo.js') {
            return 'import "foo.ts"\n' + 'import_meta'
          }
          if (id === 'foo.ts') {
            return 'import.meta'
          }
        },
      },
    ],
    ['foo.js', 'foo.ts'],
  )
  await build(config)

  /**
   * 场景：构建解析 foo.js 与 foo.ts。
   * 验证目标：只有符合 `.js` 正则的导入进入被测 resolveId。
   */
  test('resolveId', async () => {
    expect(resolveId).toHaveBeenCalledTimes(1)
    expect(resolveId).toHaveBeenCalledWith('foo.js', undefined, any)
  })

  /**
   * 场景：构建加载两个虚拟入口。
   * 验证目标：load glob 在 Rolldown 原生管线中也只放行 foo.js。
   */
  test('load', async () => {
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('foo.js', any)
  })

  /**
   * 场景：ID filter 还排除 Rolldown runtime 虚拟模块，code filter 匹配 import.meta。
   * 验证目标：目标业务模块各调用一次，内部 runtime 不造成额外 handler 调用（#20076）。
   */
  test('transform', async () => {
    expect(transformWithId).toHaveBeenCalledTimes(1)
    expect(transformWithId).toHaveBeenCalledWith(
      expect.stringContaining('import_meta'),
      'foo.js',
      any,
    )
    expect(transformWithCode).toHaveBeenCalledTimes(1)
    expect(transformWithCode).toHaveBeenCalledWith(
      expect.stringContaining('import.meta'),
      'foo.ts',
      any,
    )
  })
})
