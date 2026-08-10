import { existsSync, readdirSync } from 'node:fs'
import { posix, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { isWindows } from '../../../../shared/utils'
import type { ExternalFetchResult } from '../../../../shared/invokeMethods'
import { createServer } from '../../../server'
import {
  createRunnableDevEnvironment,
  isRunnableDevEnvironment,
} from '../../../server/environments/runnableEnvironment'
import type { HMRLogger } from '../../../../../dist/node/module-runner'
import { createModuleRunnerTester } from './utils'

/**
 * 阅读目标：从 `runner.import()` 的黑盒行为理解 Module Runner。
 *
 * 用例覆盖 id 规范化、虚拟/外部模块、缓存身份、导出只读视图、循环依赖、live binding、
 * `import.meta`、优化依赖、HMR full reload 与关闭竞态；快照是其 ESM 兼容边界。
 */
const _URL = URL

describe('module runner initialization', async () => {
  const it = await createModuleRunnerTester({
    resolve: {
      external: ['tinyglobby'],
      noExternal: ['@oxc-project/runtime'],
    },
  })

  /**
   * 场景：同一 SSR 模块分别以根相对 URL、file URL 与绝对文件路径导入。
   * 验证目标：代码正确执行，三种说明符规范化到同一个模块命名空间对象。
   */
  it('correctly runs ssr code', async ({ runner }) => {
    const mod = await runner.import('/fixtures/simple.js')
    expect(mod.test).toEqual('I am initialized')

    // 同一模块改用 file URL 导入，仍应命中同一个求值节点。
    const fileUrl = new _URL('./fixtures/simple.js', import.meta.url)
    const mod2 = await runner.import(fileUrl.toString())
    expect(mod).toBe(mod2)

    // 改用文件系统路径也应归一为同一个节点。
    const filePath = fileURLToPath(fileUrl)
    const mod3 = await runner.import(filePath)
    expect(mod).toBe(mod3)
  })

  /**
   * 场景：以公开虚拟 ID、null-byte ID、转义 `/@id/` ID 与不同 query 形态作为入口。
   * 验证目标：前三种及 HMR 时间戳命中同一解析协议；任意未知 query 明确加载失败。
   */
  it('can load virtual modules as an entry point', async ({ runner }) => {
    const mod = await runner.import('virtual:test')
    expect(mod.msg).toBe('virtual')

    // 已解析的内部 id 与 transformRequest 一样可以直接作为入口。
    expect(await runner.import(`\0virtual:normal`)).toMatchInlineSnapshot(`
      {
        "default": "ok",
      }
    `)

    // 浏览器传输层转义过的虚拟模块 id 也能还原。
    expect(await runner.import(`/@id/__x00__virtual:normal`))
      .toMatchInlineSnapshot(`
      {
        "default": "ok",
      }
    `)

    // HMR 时间戳 query 只用于失效，不制造新的模块身份。
    expect(await runner.import(`virtual:normal?t=${Date.now()}`))
      .toMatchInlineSnapshot(`
      {
        "default": "ok",
      }
    `)

    // 任意 query 没有相同待遇；无法解析时应明确失败。
    await expect(() =>
      runner.import('virtual:normal?abcd=1234'),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        'Failed to load url virtual:normal?abcd=1234',
      ),
    })
  })

  /**
   * 场景：Runner 分别导入普通 CSS 与 CSS Module。
   * 验证目标：普通 CSS 无运行时默认值；CSS Module 同时暴露默认映射和具名 class。
   */
  it('css is loaded correctly', async ({ runner }) => {
    const css = await runner.import('/fixtures/test.css')
    expect(css.default).toBe(undefined)
    const module = await runner.import('/fixtures/test.module.css')
    expect(module).toMatchObject({
      default: {
        test: expect.stringMatching(/^_test_/),
      },
      test: expect.stringMatching(/^_test_/),
    })
  })

  /**
   * 场景：SSR 模块导入 mov、txt、png、webp 四种静态资源。
   * 验证目标：每个导出都是开发服务器对应的公开资源 URL。
   */
  it('assets are loaded correctly', async ({ runner }) => {
    const assets = await runner.import('/fixtures/assets.js')
    expect(assets).toMatchObject({
      mov: '/fixtures/assets/placeholder.mov',
      txt: '/fixtures/assets/placeholder.txt',
      png: '/fixtures/assets/placeholder.png',
      webp: '/fixtures/assets/placeholder.webp',
    })
  })

  /**
   * 场景：Runner 导入带 `?raw`、`?url` 与 CSS `?inline` 的 Vite 请求。
   * 验证目标：分别得到原始源码文本、资源 URL 与内联 CSS 文本。
   */
  it('ids with Vite queries are loaded correctly', async ({ runner }) => {
    const raw = await runner.import('/fixtures/simple.js?raw')
    expect(raw.default).toMatchInlineSnapshot(`
      "export const test = 'I am initialized'

      import.meta.hot?.accept()
      "
    `)
    const url = await runner.import('/fixtures/simple.js?url')
    expect(url.default).toMatchInlineSnapshot(`"/fixtures/simple.js"`)
    const inline = await runner.import('/fixtures/test.css?inline')
    expect(inline.default).toMatchInlineSnapshot(`
      ".test {
        color: red;
      }
      "
    `)
  })

  /**
   * 场景：同一文件分别按普通 JS 与 `?url` 资源查询导入。
   * 验证目标：两种请求拥有不同模块身份，`?url` 命名空间只返回资源 URL。
   */
  it('modules with query strings are treated as different modules', async ({
    runner,
  }) => {
    const modSimple = await runner.import('/fixtures/simple.js')
    const modUrl = await runner.import('/fixtures/simple.js?url')
    expect(modSimple).not.toBe(modUrl)
    expect(modUrl.default).toBe('/fixtures/simple.js')
  })

  /**
   * 场景：对 Runner 返回的 ESM 命名空间执行赋值、删除、重定义与新增属性。
   * 验证目标：命名空间已 sealed，四种写操作均按只读 ESM 语义抛出 TypeError。
   */
  it('exports is not modifiable', async ({ runner }) => {
    const mod = await runner.import('/fixtures/simple.js')
    expect(Object.isSealed(mod)).toBe(true)
    expect(() => {
      mod.test = 'I am modified'
    }).toThrowErrorMatchingInlineSnapshot(
      `[TypeError: Cannot set property test of [object Module] which has only a getter]`,
    )
    expect(() => {
      delete mod.test
    }).toThrowErrorMatchingInlineSnapshot(
      `[TypeError: Cannot delete property 'test' of [object Module]]`,
    )
    expect(() => {
      Object.defineProperty(mod, 'test', { value: 'I am modified' })
    }).toThrowErrorMatchingInlineSnapshot(
      `[TypeError: Cannot redefine property: test]`,
    )
    expect(() => {
      mod.other = 'I am added'
    }).toThrowErrorMatchingInlineSnapshot(
      `[TypeError: Cannot add property other, object is not extensible]`,
    )
  })

  /**
   * 场景：连续两次导入同一求值失败模块，并在第一次 Error 上写入 Symbol 标记。
   * 验证目标：第二次抛出同一缓存错误实例，Symbol 标记仍可见。
   */
  it('throws the same error', async ({ runner }) => {
    expect.assertions(3)
    const s = Symbol()
    try {
      await runner.import('/fixtures/has-error.js')
    } catch (e) {
      expect(e[s]).toBeUndefined()
      e[s] = true
      expect(e[s]).toBe(true)
    }

    try {
      await runner.import('/fixtures/has-error.js')
    } catch (e) {
      expect(e[s]).toBe(true)
    }
  })

  /**
   * 场景：先从外部 CommonJS 包导入不存在的具名导出，再导入实际存在的导出。
   * 验证目标：首个请求给出 CJS 专用诊断；失败不污染缓存，后续合法导入返回 world。
   */
  it('importing external cjs library checks exports', async ({ runner }) => {
    await expect(() => runner.import('/fixtures/cjs-external-non-existing.js'))
      .rejects.toThrowErrorMatchingInlineSnapshot(`
      [SyntaxError: [vite] Named export 'nonExisting' not found. The requested module '@vitejs/cjs-external' is a CommonJS module, which may not support all module.exports as named exports.
      CommonJS modules can always be imported via the default export, for example using:

      import pkg from '@vitejs/cjs-external';
      const {nonExisting} = pkg;
      ]
    `)
    // 首次错误不能污染外部模块缓存；随后导入存在的名称仍应成功。
    await expect(
      runner.import('/fixtures/cjs-external-existing.js'),
    ).resolves.toMatchObject({
      result: 'world',
    })
  })

  /**
   * 场景：先从外部 ESM 包请求不存在的具名导出，再请求存在的导出。
   * 验证目标：首个请求报告缺失导出；后续合法导入不受失败缓存影响。
   */
  it('importing external esm library checks exports', async ({ runner }) => {
    await expect(() =>
      runner.import('/fixtures/esm-external-non-existing.js'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[SyntaxError: [vite] The requested module '@vitejs/esm-external' does not provide an export named 'nonExisting']`,
    )
    // ESM 外部模块也不能因前一次错误的命名导入而永久失败。
    await expect(
      runner.import('/fixtures/esm-external-existing.js'),
    ).resolves.toMatchObject({
      result: 'world',
    })
  })

  /**
   * 场景：同一依赖经静态导入及相对、绝对、扩展名、file URL 等动态写法加载。
   * 验证目标：所有结果通过对象身份比较指向同一模块实例，不发生重复求值。
   */
  it("dynamic import doesn't produce duplicates", async ({ runner }) => {
    const mod = await runner.import('/fixtures/dynamic-import.js')
    const modules = await mod.initialize()
    // 必须用 toBe 验证对象身份：静态与多种动态导入写法应共享同一模块实例；
    // toEqual 只能比较结构，无法发现重复求值。
    expect(modules.static).toBe(modules.dynamicProcessed)
    expect(modules.static).toBe(modules.dynamicRelative)
    expect(modules.static).toBe(modules.dynamicAbsolute)
    expect(modules.static).toBe(modules.dynamicAbsoluteExtension)
    expect(modules.static).toBe(modules.dynamicAbsoluteFull)
    expect(modules.static).toBe(modules.dynamicFileUrl)
  })

  /**
   * 场景：普通夹具模块同时导入两个由插件解析的虚拟模块。
   * 验证目标：两个虚拟导出分别返回 virtual0 与 virtual。
   */
  it('correctly imports a virtual module', async ({ runner }) => {
    const mod = await runner.import('/fixtures/virtual.js')
    expect(mod.msg0).toBe('virtual0')
    expect(mod.msg).toBe('virtual')
  })

  /**
   * 场景：SSR 入口从 node_modules 导入 tinyspy 并调用其函数。
   * 验证目标：外部包命名空间可执行，创建的 spy 正确记录调用。
   */
  it('importing package from node_modules', async ({ runner }) => {
    const mod = (await runner.import(
      '/fixtures/installed.js',
    )) as typeof import('tinyspy')
    const fn = mod.spy()
    fn()
    expect(fn.called).toBe(true)
  })

  /**
   * 场景：SSR 模块从 Node 内置 fs 包导入两个函数。
   * 验证目标：导出身份与测试进程直接导入的原生函数严格相同。
   */
  it('importing native node package', async ({ runner }) => {
    const mod = await runner.import('/fixtures/native.js')
    expect(mod.readdirSync).toBe(readdirSync)
    expect(mod.existsSync).toBe(existsSync)
  })

  /**
   * 场景：模块导出 Runner 注入的 import.meta.url、filename 与 dirname。
   * 验证目标：URL 等于真实 file URL；路径字段按 Windows/POSIX 规则等于夹具绝对路径。
   */
  it('correctly resolves module url', async ({ runner, server }) => {
    const { meta } = await runner.import('/fixtures/basic')
    const basicUrl = new _URL('./fixtures/basic.js', import.meta.url).toString()
    expect(meta.url).toBe(basicUrl)

    const filename = meta.filename!
    const dirname = meta.dirname!

    if (isWindows) {
      const cwd = process.cwd()
      const drive = `${cwd[0].toUpperCase()}:\\`
      const root = server.config.root.replace(/\\/g, '/')

      expect(filename.startsWith(drive)).toBe(true)
      expect(dirname.startsWith(drive)).toBe(true)

      expect(filename).toBe(win32.join(root, '.\\fixtures\\basic.js'))
      expect(dirname).toBe(win32.join(root, '.\\fixtures'))
    } else {
      const root = server.config.root

      expect(posix.join(root, './fixtures/basic.js')).toBe(filename)
      expect(posix.join(root, './fixtures')).toBe(dirname)
    }
  })

  /**
   * 场景：entry 与 entry-cyclic 双向依赖，随后动态导入 action 模块。
   * 验证目标：循环检测终止遍历且 action 成功返回，不发生 maximum call stack 错误。
   */
  it(`no maximum call stack error ModuleRunner.isCircularImport`, async ({
    runner,
  }) => {
    // 图结构：entry.js ⇔ entry-cyclic.js
    //   ⇓
    // action.js
    const mod = await runner.import('/fixtures/cyclic/entry')
    await mod.setupCyclic()
    const action = await mod.importAction('/fixtures/cyclic/action')
    expect(action).toBeDefined()
  })

  /**
   * 场景：导入者调用从另一模块导出的普通函数。
   * 验证目标：函数内 `this` 为 undefined，命名空间成员调用不会意外绑定模块对象。
   */
  it('this of the exported function should be undefined', async ({
    runner,
  }) => {
    const mod = await runner.import('/fixtures/no-this/importer.js')
    expect(mod.result).toBe(undefined)
  })

  /**
   * 场景：四组合法循环依赖夹具以不同 import/re-export 结构互相引用。
   * 验证目标：每组都完成求值，并得到 dep1/dep2 的完整 `{ ok: true }` 导出。
   */
  it.for([
    '/fixtures/cyclic2/test1/index.js',
    '/fixtures/cyclic2/test2/index.js',
    '/fixtures/cyclic2/test3/index.js',
    '/fixtures/cyclic2/test4/index.js',
  ] as const)(`cyclic %s`, async (entry, { runner }) => {
    const mod = await runner.import(entry)
    expect({ ...mod }).toEqual({
      dep1: {
        ok: true,
      },
      dep2: {
        ok: true,
      },
    })
  })

  /**
   * 场景：循环依赖在目标导出初始化前读取其 `ok` 属性。
   * 验证目标：当前 Runner 以读取 undefined 属性的 TypeError 拒绝该导入。
   */
  it(`cyclic invalid 1`, async ({ runner }) => {
    // Node 同样失败，但报错文本不同：
    //   $ node packages/vite/src/node/ssr/runtime/__tests__/fixtures/cyclic2/test5/index.js
    //   ReferenceError: Cannot access 'dep1' before initialization
    await expect(() =>
      runner.import('/fixtures/cyclic2/test5/index.js'),
    ).rejects.toMatchInlineSnapshot(
      `[TypeError: Cannot read properties of undefined (reading 'ok')]`,
    )
  })

  /**
   * 场景：第二组无效循环依赖在初始化前拼接 dep2。
   * 验证目标：记录当前实现回退为 `dep2: undefined` 的已知行为，不扩大为 ESM 保证。
   */
  it(`cyclic invalid 2`, async ({ runner }) => {
    // 理想行为是抛错；当前实现暂时回退为 `undefined`。
    expect(
      await runner.import('/fixtures/cyclic2/test6/index.js'),
    ).toMatchInlineSnapshot(
      `
      {
        "dep1": "dep1: dep2: undefined",
      }
    `,
    )
  })

  /**
   * 场景：循环图混合直接 import 与 re-export，Ion 与 dom 互相提供类型值。
   * 验证目标：最终命名空间同时完整暴露 IonTypes.BLOB 与 dom.Blob。
   */
  it(`cyclic with mixed import and re-export`, async ({ runner }) => {
    const mod = await runner.import('/fixtures/cyclic2/test7/Ion.js')
    expect(mod).toMatchInlineSnapshot(`
      {
        "IonTypes": {
          "BLOB": "Blob",
        },
        "dom": {
          "Blob": "Blob",
        },
      }
    `)
  })

  /**
   * 场景：入口混合 import 与 re-export 两个带 console 副作用的依赖。
   * 验证目标：依赖严格按 dep1、dep2 的模块图顺序执行一次。
   */
  it(`execution order with mixed import and re-export`, async ({
    runner,
    onTestFinished,
  }) => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    onTestFinished(() => spy.mockRestore())

    await runner.import('/fixtures/execution-order-re-export/index.js')
    expect(spy.mock.calls.map((v) => v[0])).toMatchInlineSnapshot(`
      [
        "dep1",
        "dep2",
      ]
    `)
  })

  /**
   * 场景：夹具通过 `export default function f` 暴露会变化的函数绑定。
   * 验证目标：消费者观察到更新后的 2、3 序列，证明默认声明保持 live binding。
   */
  it(`live binding (export default function f)`, async ({ runner }) => {
    const mod = await runner.import('/fixtures/live-binding/test1/index.js')
    expect(mod.default).toMatchInlineSnapshot(`
      [
        2,
        3,
      ]
    `)
  })

  /**
   * 场景：夹具通过 `export default f` 导出当时的表达式值。
   * 验证目标：消费者两次读取均为 1，记录该表达式默认导出的快照语义。
   */
  it(`live binding (export default f)`, async ({ runner }) => {
    const mod = await runner.import('/fixtures/live-binding/test2/index.js')
    expect(mod.default).toMatchInlineSnapshot(`
      [
        1,
        1,
      ]
    `)
  })

  /**
   * 场景：夹具通过 `export { f as default }` 导出可变本地绑定。
   * 验证目标：默认导出随绑定变化呈现 2、3，保持 re-export live binding。
   */
  it(`live binding (export { f as default })`, async ({ runner }) => {
    const mod = await runner.import('/fixtures/live-binding/test3/index.js')
    expect(mod.default).toMatchInlineSnapshot(`
      [
        2,
        3,
      ]
    `)
  })

  /**
   * 场景：夹具以具名类声明形式默认导出并更新相关绑定。
   * 验证目标：消费者观察到夹具定义的 2、3 序列，类默认声明未被复制为陈旧值。
   */
  it(`live binding (export default class C)`, async ({ runner }) => {
    const mod = await runner.import('/fixtures/live-binding/test4/index.js')
    expect(mod.default).toMatchInlineSnapshot(`
      [
        2,
        3,
      ]
    `)
  })

  /**
   * 场景：循环模块在依赖初始化前通过已提升 default getter 读取 dep。
   * 验证目标：记录当前 Runner 返回 default undefined 的已知回退，而非 Node 的 ReferenceError。
   */
  it(`export default getter is hoisted`, async ({ runner }) => {
    // Node 会报 `ReferenceError: Cannot access 'dep' before initialization`；
    // 当前实现暂时回退为 `undefined`，快照记录这一已知差异。
    expect(
      await runner.import('/fixtures/cyclic2/test9/index.js'),
    ).toMatchInlineSnapshot(
      `
      {
        "default": undefined,
      }
    `,
    )
  })

  /**
   * 场景：TypeScript 夹具经 Oxc 转换后引用 `@oxc-project/runtime` helper。
   * 验证目标：noExternal 配置让 helper 可由 Runner 加载，导出值保留含 `<script>` 与换行的快照。
   */
  it('oxc runtime helpers are loadable', async ({ runner }) => {
    const mod = await runner.import('/fixtures/oxc-runtime-helper.ts')
    expect(mod.result).toMatchInlineSnapshot(`
      "<script>
        console.log('hi')
      </script>"
    `)
  })

  /**
   * 场景：模块在顶层声明并导出名为 `Object` 的局部变量。
   * 验证目标：该名称解析为模块绑定 `my-object`，不被全局 Object 构造器覆盖。
   */
  it(`handle Object variable`, async ({ runner }) => {
    const mod = await runner.import('/fixtures/top-level-object.js')
    expect(mod).toMatchInlineSnapshot(`
      {
        "Object": "my-object",
      }
    `)
  })
})

describe('optimize-deps', async () => {
  const it = await createModuleRunnerTester({
    cacheDir: 'node_modules/.vite-test',
    ssr: {
      noExternal: true,
      optimizeDeps: {
        include: ['@vitejs/cjs-external'],
      },
    },
  })

  /**
   * 场景：被 SSR optimizeDeps 预构建的 CommonJS 包直接作为 Runner 入口导入。
   * 验证目标：优化产物正确暴露默认命名空间，调用 hello 返回 world。
   */
  it('optimized dep as entry', async ({ runner }) => {
    const mod = await runner.import('@vitejs/cjs-external')
    expect(mod.default.hello()).toMatchInlineSnapshot(`"world"`)
  })
})

describe('resolveId absolute path entry', async () => {
  const it = await createModuleRunnerTester({
    plugins: [
      {
        name: 'test-resolevId',
        enforce: 'pre',
        /** 将 basic.js 的绝对入口重定向为虚拟模块。 */
        resolveId(source) {
          if (
            source ===
            posix.join(this.environment.config.root, 'fixtures/basic.js')
          ) {
            return '\0virtual:basic'
          }
        },
        /** 为绝对入口重定向后的虚拟 ID 返回可识别导出。 */
        load(id) {
          if (id === '\0virtual:basic') {
            return `export const name = "virtual:basic"`
          }
        },
      },
    ],
  })

  /**
   * 场景：旧版 `server.ssrLoadModule` 以 basic.js 绝对路径作为入口，插件把它重定向为虚拟 ID。
   * 验证目标：解析钩子仍参与绝对入口加载，返回虚拟模块导出。
   */
  it('ssrLoadModule', async ({ server }) => {
    const mod = await server.ssrLoadModule(
      posix.join(server.config.root, 'fixtures/basic.js'),
    )
    expect(mod.name).toMatchInlineSnapshot(`"virtual:basic"`)
  })

  /**
   * 场景：`runner.import` 以 basic.js 绝对路径作为入口，插件把它重定向为虚拟 ID。
   * 验证目标：Runner 入口同样经过 resolveId，并返回 virtual:basic。
   */
  it('runner', async ({ server, runner }) => {
    const mod = await runner.import(
      posix.join(server.config.root, 'fixtures/basic.js'),
    )
    expect(mod.name).toMatchInlineSnapshot(`"virtual:basic"`)
  })
})

describe('virtual module hmr', async () => {
  let state = 'init'

  const it = await createModuleRunnerTester({
    plugins: [
      {
        name: 'test-resolevId',
        enforce: 'pre',
        /** 解析 HMR 测试使用的可变虚拟模块。 */
        resolveId(source) {
          if (source === 'virtual:test') {
            return '\0' + source
          }
        },
        /** 每次加载时把当前 state 序列化到默认导出，供 full reload 重新求值。 */
        load(id) {
          if (id === '\0virtual:test') {
            return `export default ${JSON.stringify(state)}`
          }
        },
      },
    ],
  })

  /**
   * 场景：虚拟模块初始导出 init，修改插件闭包状态后失效整图并发送 full-reload。
   * 验证目标：HMR 重新导入入口，evaluated module 最终导出 reloaded。
   */
  it('full reload', async ({ server, runner }) => {
    const mod = await runner.import('virtual:test')
    expect(mod.default).toBe('init')
    state = 'reloaded'
    server.environments.ssr.moduleGraph.invalidateAll()
    server.environments.ssr.hot.send({ type: 'full-reload' })
    await vi.waitFor(() => {
      const mod = runner.evaluatedModules.getModuleById('\0virtual:test')
      expect(mod?.exports.default).toBe('reloaded')
    })
  })

  /**
   * 场景：SSR 入口导入 external tinyglobby，并检查 Runner 保存的 fetch 元数据。
   * 验证目标：externalize 为 file URL，模块 id/file 为当前平台绝对路径格式。
   */
  it("the external module's ID and file are resolved correctly", async ({
    server,
    runner,
  }) => {
    await runner.import(
      posix.join(server.config.root, 'fixtures/import-external.ts'),
    )
    const moduleNode = runner.evaluatedModules.getModuleByUrl('tinyglobby')!
    const meta = moduleNode.meta as ExternalFetchResult
    if (process.platform === 'win32') {
      expect(meta.externalize).toMatch(/^file:\/\/\/\w:\//) // file:///C:/
      expect(moduleNode.id).toMatch(/^\w:\//) // C:/
      expect(moduleNode.file).toMatch(/^\w:\//) // C:/
    } else {
      expect(meta.externalize).toMatch(/^file:\/\/\//) // file:///
      expect(moduleNode.id).toMatch(/^\//) // /
      expect(moduleNode.file).toMatch(/^\//) // /
    }
  })
})

describe('invalid package', async () => {
  const it = await createModuleRunnerTester({
    environments: {
      ssr: {
        resolve: {
          noExternal: true,
        },
      },
    },
  })

  /**
   * 场景：运行时动态解析 exports 配置无效的内联包，并由夹具捕获异常。
   * 验证目标：调用返回 `{ ok: false }`，data 保留“无法解析 package entry”的 Error。
   */
  it('can catch resolve error on runtime', async ({ runner }) => {
    const mod = await runner.import('./fixtures/invalid-package/test.js')
    expect(await mod.test()).toMatchInlineSnapshot(`
      {
        "data": [Error: Failed to resolve entry for package "test-dep-invalid-exports". The package may have incorrect main/module/exports specified in its package.json.],
        "ok": false,
      }
    `)
  })
})

describe('full-reload during close', () => {
  /**
   * 场景：full reload 开始重新导入慢速虚拟模块时立即关闭 server 和 transport。
   * 验证目标：HMR logger 不记录 `transport was disconnected`，该关闭竞态被视为正常收尾。
   */
  it('does not error when server closes during full-reload re-import', async () => {
    const errors: (string | Error)[] = []
    const logger: HMRLogger = {
      error: (msg) => errors.push(msg),
      debug: () => {},
    }

    const server = await createServer({
      root: import.meta.dirname,
      logLevel: 'error',
      server: {
        middlewareMode: true,
        watch: null,
        ws: false,
      },
      optimizeDeps: {
        disabled: true,
        noDiscovery: true,
      },
      environments: {
        ssr: {
          dev: {
            /** 创建带测试 HMR logger 的可运行 SSR Environment。 */
            createEnvironment(name, config) {
              return createRunnableDevEnvironment(name, config, {
                runnerOptions: { hmr: { logger } },
              })
            },
          },
        },
      },
      plugins: [
        {
          name: 'test-slow-virtual',
          enforce: 'pre',
          /** 解析用于制造 close/fetch 竞态的慢速虚拟模块。 */
          resolveId(source) {
            if (source === 'virtual:slow') return '\0virtual:slow'
          },
          /** 延迟返回源码，让 full reload 重导入与关闭流程发生重叠。 */
          async load(id) {
            if (id === '\0virtual:slow') {
              await setTimeout(10)
              return `export default "ok"`
            }
          },
        },
      ],
    })

    const env = server.environments.ssr
    if (!isRunnableDevEnvironment(env)) {
      throw new Error('expected RunnableDevEnvironment')
    }

    const mod = await env.runner.import('virtual:slow')
    expect(mod.default).toBe('ok')

    // full reload 的重新导入会在 HMR 队列中异步执行。
    env.moduleGraph.invalidateAll()
    env.hot.send({ type: 'full-reload' })

    // 关闭链为 server → environment → runner → transport.disconnect()，最后一步会拒绝
    // 尚未完成的 fetchModule RPC；HMR handler 应吞掉该正常竞态，而不是记为错误。
    await server.close()
    await setTimeout(100) // 给 HMR handler 留出完成收尾的时间。

    expect(
      errors.some((e) => e.toString().includes('transport was disconnected')),
    ).toBe(false)
  })
})

describe('server.fs check', async () => {
  const it = await createModuleRunnerTester({
    server: {
      fs: {
        allow: [resolve(import.meta.dirname, './fixtures/circular')],
      },
    },
  })

  /**
   * 场景：server.fs.allow 只允许 circular 夹具，Runner 导入列表外的 basic.js。
   * 验证目标：服务端 Module Runner 不套用浏览器静态文件检查，仍得到 basic 导出。
   */
  it('it is not applied to the server module runner', async ({ runner }) => {
    const mod = await runner.import('/fixtures/basic.js')
    expect(mod.name).toBe('basic')
  })
})
