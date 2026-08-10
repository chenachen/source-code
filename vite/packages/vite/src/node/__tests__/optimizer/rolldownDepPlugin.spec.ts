import { describe, expect, test } from 'vitest'
import { rolldownDepPlugin } from '../../optimizer/rolldownDepPlugin'
import { normalizePath } from '../../utils'

/** 提取真实 `vite:dep-pre-bundle` transform handler，隔离测试 new URL 重写。 */
async function createRolldownDepPluginTransform(cacheDir: string) {
  const baseConfig = {
    cacheDir: normalizePath(cacheDir),
    optimizeDeps: { extensions: [] },
    server: { fs: { allow: [] } },
    resolve: { builtins: [] },
    createResolver: () => ({}),
  }

  const mockEnvironment = {
    config: baseConfig,
    getTopLevelConfig: () => baseConfig,
  } as any

  const plugins = rolldownDepPlugin(mockEnvironment, {}, [])
  const plugin = plugins.find(
    (p: any) => p.name === 'vite:dep-pre-bundle',
  ) as any

  if (!plugin || !plugin.transform) {
    throw new Error('Could not find vite:dep-pre-bundle plugin')
  }

  const handler = plugin.transform.handler

  return async (code: string, id: string) => {
    const result = await handler.call({}, code, normalizePath(id))
    return result?.code || result
  }
}

describe('rolldownDepPlugin transform', async () => {
  /**
   * 场景：依赖包内 `new URL(relative, import.meta.url)` 随 bundle 移到 cache dir 后相对基准改变。
   * 目标：静态相对 URL 改写为从 deps 输出目录回到原资源的路径；协议/绝对/data、动态模板和
   * Vite 的忽略标记保留给其他管线。
   * 机制：对 query/hash、深层路径、反引号与非 node_modules ID 做生成代码快照。
   */
  const transform = await createRolldownDepPluginTransform('/root/.vite')

  /** 场景：依赖代码含 png、svg、worker、wasm 四种静态相对 new URL；验证目标：全部改写为从缓存目录指回原资源的相对路径。 */
  test('rewrite various relative asset formats', async () => {
    const code = `
      const img = new URL('./logo.png', import.meta.url).href
      const icon = new URL('./icons/search.svg', import.meta.url)
      const worker = new URL('./worker.js', import.meta.url)
      const wasm = new URL('./module.wasm', import.meta.url)
    `
    expect(await transform(code, '/root/node_modules/my-lib/dist/index.js'))
      .toMatchInlineSnapshot(`
      "
            const img = new URL('' + "../../node_modules/my-lib/dist/logo.png", import.meta.url).href
            const icon = new URL('' + "../../node_modules/my-lib/dist/icons/search.svg", import.meta.url)
            const worker = new URL('' + "../../node_modules/my-lib/dist/worker.js", import.meta.url)
            const wasm = new URL('' + "../../node_modules/my-lib/dist/module.wasm", import.meta.url)
          "
    `)
  })

  /** 场景：new URL 参数带 Vite 的忽略标记；验证目标：依赖预构建 transform 返回 undefined，不改写该表达式。 */
  test('respects /* @vite-ignore */', async () => {
    expect(
      await transform(
        "new URL(/* @vite-ignore */ './worker.js', import.meta.url)",
        '/root/node_modules/my-lib/index.js',
      ),
    ).toBeUndefined()
  })

  /** 场景：new URL 使用根绝对路径、HTTP 或 data 协议；验证目标：这些非相对资源全部跳过。 */
  test('skips non-relative URLs (absolute, data, protocols)', async () => {
    const code = `
      new URL('/absolute/path.png', import.meta.url)
      new URL('https://example.com/worker.js', import.meta.url)
      new URL('data:text/javascript;base64,Y29uc29sZS5sb2coMSk=', import.meta.url)
    `
    expect(
      await transform(code, '/root/node_modules/my-lib/index.js'),
    ).toBeUndefined()
  })

  /** 场景：模板 URL 含运行时变量；验证目标：预构建不尝试静态重定位。 */
  test('skips dynamic template strings', async () => {
    expect(
      await transform(
        'new URL(`./${name}.js`, import.meta.url)',
        '/root/node_modules/my-lib/index.js',
      ),
    ).toBeUndefined()
  })

  /** 场景：静态相对 URL 使用反引号字面量；验证目标：仍改写为缓存目录到源资源的路径。 */
  test('handles backticks for static relative strings', async () => {
    expect(
      await transform(
        'new URL(`./static.js`, import.meta.url)',
        '/root/node_modules/my-lib/index.js',
      ),
    ).toMatchInlineSnapshot(
      `"new URL('' + "../../node_modules/my-lib/static.js", import.meta.url)"`,
    )
  })

  /** 场景：相对资源路径带 query 或 hash；验证目标：重定位只改变路径基准并完整保留后缀。 */
  test('handles assets with query parameters and hashes', async () => {
    const code = `
      const url1 = new URL('./style.css?raw', import.meta.url)
      const url2 = new URL('./data.json#config', import.meta.url)
    `
    expect(await transform(code, '/root/node_modules/my-lib/index.js'))
      .toMatchInlineSnapshot(`
      "
            const url1 = new URL('' + "../../node_modules/my-lib/style.css?raw", import.meta.url)
            const url2 = new URL('' + "../../node_modules/my-lib/data.json#config", import.meta.url)
          "
    `)
  })

  /** 场景：深层依赖文件引用三级上层资源；验证目标：规范化后生成指向包内 assets/file.js 的正确缓存相对路径。 */
  test('handles deeply nested relative paths', async () => {
    expect(
      await transform(
        "new URL('../../../assets/file.js', import.meta.url)",
        '/root/node_modules/my-lib/dist/deep/folder/index.js',
      ),
    ).toMatchInlineSnapshot(
      `"new URL('' + "../../node_modules/my-lib/assets/file.js", import.meta.url)"`,
    )
  })

  /** 场景：模块 ID 位于本地 src 而非 node_modules；验证目标：静态相对 new URL 同样按缓存目录重定位。 */
  test('rewrite relative URLs even if id is not in node_modules', async () => {
    expect(
      await transform(
        "new URL('./asset.js', import.meta.url)",
        '/root/src/local-dep.js',
      ),
    ).toMatchInlineSnapshot(
      `"new URL('' + "../../src/asset.js", import.meta.url)"`,
    )
  })
})
