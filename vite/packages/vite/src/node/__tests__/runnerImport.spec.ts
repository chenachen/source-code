import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadConfigFromFile } from 'vite'
import { runnerImport } from '../ssr/runnerImport'
import { slash } from '../../shared/utils'

/** Node 原生类型剥离可用性；仅在不支持时断言 bundle loader 无法加载外部 .ts。 */
// eslint-disable-next-line n/no-unsupported-features/node-builtins
const isTypeStrippingSupported = !!process.features.typescript

describe('importing files using inlined environment', () => {
  /** 把夹具名定位到 runner-import 目录，以隔离当前工作目录差异。 */
  const fixture = (name: string) =>
    resolve(import.meta.dirname, './fixtures/runner-import', name)

  /** 导入 basic 夹具到内联 Environment；返回命名导出 test 应保留 field:true 的对象值。 */
  test('importing a basic file works', async () => {
    const { module } = await runnerImport<
      typeof import('./fixtures/runner-import/basic')
    >(fixture('basic'))
    expect(module.test).toEqual({
      field: true,
    })
  })

  /** 导入使用 module.exports 的 CJS 夹具；runner 不提供 CJS 全局，应以 module is not defined 拒绝。 */
  test("cannot import cjs, 'runnerImport' doesn't support CJS syntax at all", async () => {
    await expect(() =>
      runnerImport<typeof import('./fixtures/runner-import/basic')>(
        fixture('cjs.js'),
      ),
    ).rejects.toThrow('module is not defined')
  })

  /** 导入包含本地 plugin.ts 的 Vite 配置；核对 default 配置与唯一规范化依赖路径。 */
  test('can import vite config', async () => {
    const { module, dependencies } = await runnerImport<
      typeof import('./fixtures/runner-import/vite.config')
    >(fixture('vite.config'))
    expect(module.default).toEqual({
      root: './test',
      plugins: [
        {
          name: 'test',
        },
      ],
    })
    expect(dependencies).toEqual([slash(fixture('plugin.ts'))])
  })

  /** 导入引用包边界外部 .ts 的配置；runner 应执行依赖并记录 parent/index.ts，且在 Node 不支持类型剥离时 bundle loader 应因 .ts 扩展名失败。 */
  test('can import vite config that imports a TS external module', async () => {
    const { module, dependencies } = await runnerImport<
      typeof import('./fixtures/runner-import/vite.config.outside-pkg-import.mjs')
    >(fixture('vite.config.outside-pkg-import.mts'))

    expect(module.default.__injected).toBe(true)
    expect(dependencies).toEqual([
      slash(resolve(import.meta.dirname, './packages/parent/index.ts')),
    ])

    // Node 不支持原生类型剥离时，bundle loader 留为外部的 .ts 无法交给 Node 加载。
    if (!isTypeStrippingSupported) {
      await expect(async () => {
        const root = resolve(import.meta.dirname, './fixtures/runner-import')
        await loadConfigFromFile(
          { mode: 'production', command: 'serve' },
          resolve(root, './vite.config.outside-pkg-import.mts'),
          root,
          'silent',
        )
      }).rejects.toThrow('Unknown file extension ".ts"')
    }
  })

  /** 导入含延迟动态 import 的模块后 runner 已关闭；再调用导出函数应拒绝并报告 runner closed，核对返回后生命周期边界。 */
  test('dynamic import', async () => {
    const { module } = await runnerImport<any>(fixture('dynamic-import.ts'))
    await expect(() => module.default()).rejects.toMatchInlineSnapshot(
      `[Error: Vite module runner has been closed.]`,
    )
    // const dep = await module.default();
    // expect(dep.default).toMatchInlineSnapshot(`"ok"`)
  })
})
