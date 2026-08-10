import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { stripVTControlCharacters } from 'node:util'
import { expect, onTestFinished, test, vi } from 'vitest'
import { createServer } from '../../server'
import { DevEnvironment } from '../../server/environment'
import { normalizePath } from '../../utils'

/**
 * 阅读目标：验证旧版 `server.ssrLoadModule()` 如何复用 RunnableDevEnvironment
 * 与 Module Runner。重点观察错误实例缓存、虚拟模块失效、Node `import.meta` 对齐、
 * re-export 冲突和非 runnable 环境的友好报错。
 */
const root = fileURLToPath(new URL('./', import.meta.url))

/** 创建关闭依赖发现的最小 SSR 开发服务器，使断言只关注加载与求值链。 */
async function createDevServer() {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    optimizeDeps: {
      noDiscovery: true,
    },
  })
  await server.environments.ssr.pluginContainer.buildStart({})
  return server
}

/**
 * 场景：SSR 入口静态导入不存在的相对模块。
 * 验证目标：加载失败消息同时包含请求说明符、解析 ID 与导入者绝对路径。
 */
test('ssrLoad', async () => {
  expect.assertions(1)
  const server = await createDevServer()
  const moduleRelativePath = '/fixtures/modules/has-invalid-import.js'
  const moduleAbsolutePath = normalizePath(path.join(root, moduleRelativePath))
  try {
    await server.ssrLoadModule(moduleRelativePath)
  } catch (e) {
    expect(e.message).toBe(
      `Failed to load url ./non-existent.js (resolved id: ./non-existent.js) in ${moduleAbsolutePath}. Does the file exist?`,
    )
  }
})

/**
 * 场景：同一 SSR 模块连续两次求值都命中缓存的执行错误。
 * 验证目标：第二次抛出与第一次相同的 Error 实例，第一次写入的 Symbol 状态仍存在。
 */
test('error has same instance', async () => {
  expect.assertions(3)
  const s = Symbol()

  const server = await createDevServer()
  try {
    await server.ssrLoadModule('/fixtures/modules/has-error.js')
  } catch (e) {
    expect(e[s]).toBeUndefined()
    e[s] = true
    expect(e[s]).toBe(true)
  }

  try {
    await server.ssrLoadModule('/fixtures/modules/has-error.js')
  } catch (e) {
    expect(e[s]).toBe(true)
  }
})

/**
 * 场景：SSR 模块导出 Vite 注入的 `import.meta.filename` 与 `dirname`。
 * 验证目标：两者分别等于 Node 对该夹具绝对路径及其父目录的计算结果。
 */
test('import.meta.filename/dirname returns same value with Node', async () => {
  const server = await createDevServer()
  const moduleRelativePath = '/fixtures/modules/import-meta.js'
  const filename = path.resolve(root, '.' + moduleRelativePath)

  const viteValue = await server.ssrLoadModule(moduleRelativePath)
  expect(viteValue.dirname).toBe(path.dirname(filename))
  expect(viteValue.filename).toBe(filename)
})

/**
 * 场景：虚拟模块每次执行递增全局计数，先重复加载，再显式失效模块节点。
 * 验证目标：未失效时复用第一次结果；失效后重新执行并把计数增至 2。
 * 对应源码：`ModuleGraph.invalidateModule()` 与 SSR runner 的 evaluated module 缓存。
 */
test('virtual module invalidation simple', async () => {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    optimizeDeps: {
      noDiscovery: true,
    },
    plugins: [
      {
        name: 'virtual-test',
        /** 把公开虚拟 ID 解析为内部 null-byte ID。 */
        resolveId(id) {
          if (id === 'virtual:test') {
            return '\0virtual:test'
          }
        },
        /** 返回每次求值都会递增全局计数的虚拟模块。 */
        load(id) {
          if (id === '\0virtual:test') {
            return `
              globalThis.__virtual_test_state ??= 0;
              globalThis.__virtual_test_state++;
              export default globalThis.__virtual_test_state;
            `
          }
        },
      },
    ],
  })
  await server.environments.ssr.pluginContainer.buildStart({})

  const mod1 = await server.ssrLoadModule('virtual:test')
  expect(mod1.default).toEqual(1)
  const mod2 = await server.ssrLoadModule('virtual:test')
  expect(mod2.default).toEqual(1)

  const modNode = server.moduleGraph.getModuleById('\0virtual:test')
  server.moduleGraph.invalidateModule(modNode!)

  const mod3 = await server.ssrLoadModule('virtual:test')
  expect(mod3.default).toEqual(2)
})

/**
 * 场景：虚拟入口导入另一个带执行计数的虚拟依赖，并同时失效入口与依赖节点。
 * 验证目标：首次重复加载保持缓存值 1，失效后沿依赖链重新求值得到 2。
 */
test('virtual module invalidation nested', async () => {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    optimizeDeps: {
      noDiscovery: true,
    },
    plugins: [
      {
        name: 'test-virtual',
        /** 解析导入嵌套虚拟依赖的入口模块。 */
        resolveId(id) {
          if (id === 'virtual:test') {
            return '\0virtual:test'
          }
        },
        /** 让入口 re-export 嵌套虚拟依赖的计数值。 */
        load(id) {
          if (id === '\0virtual:test') {
            return `
              import testDep from "virtual:test-dep";
              export default testDep;
            `
          }
        },
      },
      {
        name: 'test-virtual-dep',
        /** 解析被入口引用的嵌套虚拟依赖。 */
        resolveId(id) {
          if (id === 'virtual:test-dep') {
            return '\0virtual:test-dep'
          }
        },
        /** 返回每次重新求值都会递增第二个全局计数的依赖。 */
        load(id) {
          if (id === '\0virtual:test-dep') {
            return `
              globalThis.__virtual_test_state2 ??= 0;
              globalThis.__virtual_test_state2++;
              export default globalThis.__virtual_test_state2;
            `
          }
        },
      },
    ],
  })
  await server.environments.ssr.pluginContainer.buildStart({})

  const mod1 = await server.ssrLoadModule('virtual:test')
  expect(mod1.default).toEqual(1)
  const mod2 = await server.ssrLoadModule('virtual:test')
  expect(mod2.default).toEqual(1)

  server.moduleGraph.invalidateModule(
    server.moduleGraph.getModuleById('\0virtual:test')!,
  )
  server.moduleGraph.invalidateModule(
    server.moduleGraph.getModuleById('\0virtual:test-dep')!,
  )

  const mod3 = await server.ssrLoadModule('virtual:test')
  expect(mod3.default).toEqual(2)
})

/**
 * 场景：SSR 模块把名为 `global` 的本地绑定作为具名导出。
 * 验证目标：该导出正常返回 `ok`，不会被运行器的全局对象处理覆盖。
 */
test('can export global', async () => {
  const server = await createDevServer()
  const mod = await server.ssrLoadModule('/fixtures/global/export.js')
  expect(mod.global).toBe('ok')
})

/**
 * 场景：SSR 模块直接读取 Node 的 `global` 绑定。
 * 验证目标：模块观察到的对象与测试进程 `globalThis` 相同。
 */
test('can access nodejs global', async () => {
  const server = await createDevServer()
  const mod = await server.ssrLoadModule('/fixtures/global/test.js')
  expect(mod.default).toBe(globalThis)
})

// 暂时跳过：Rolldown 与 esbuild 的报错文本不同；相关问题：
// https://github.com/oxc-project/oxc/issues/7261
// 当前 Rolldown 没有设置从 Oxc 传入的错误属性。
/**
 * 场景：SSR 加载 TS/JS 入口或其依赖时遇到语法错误。
 * 验证目标：错误实例、消息、代码框、ID 与结构化位置经路径归一化后匹配快照。
 */
test.skip('parse error', async () => {
  const server = await createDevServer()

  /** 把机器相关的仓库绝对路径替换为稳定快照占位符。 */
  function stripRoot(s?: string) {
    return (s || '').replace(server.config.root, '<root>')
  }

  for (const file of [
    '/fixtures/errors/syntax-error.ts',
    '/fixtures/errors/syntax-error.js',
    '/fixtures/errors/syntax-error-dep.ts',
    '/fixtures/errors/syntax-error-dep.js',
  ]) {
    try {
      await server.ssrLoadModule(file)
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect({
        message: stripRoot(e.message),
        frame: stripVTControlCharacters(e.frame || ''),
        id: stripRoot(e.id),
        loc: e.loc && {
          file: stripRoot(e.loc.file),
          column: e.loc.column,
          line: e.loc.line,
        },
      }).toMatchSnapshot()
      continue
    }
    expect.unreachable()
  }
})

/**
 * 场景：SSR 直接加载 JSON，并对等价 `export default` 源码执行 SSR transform。
 * 验证目标：JSON 同时暴露默认值与具名字段，转换结果保持稳定代码形态。
 */
test('json', async () => {
  const server = await createDevServer()
  const mod = await server.ssrLoadModule('/fixtures/json/test.json')
  expect(mod).toMatchInlineSnapshot(`
    {
      "default": {
        "hello": "this is json",
      },
      "hello": "this is json",
    }
  `)

  const source = fs.readFileSync(
    path.join(root, 'fixtures/json/test.json'),
    'utf-8',
  )
  const json = await server.ssrTransform(
    `export default ${source}`,
    null,
    '/test.json',
  )
  expect(json?.code.length).toMatchInlineSnapshot(`165`)
})

/**
 * 场景：以 `file:` URL 加载普通文件名与含空格文件名的 SSR 模块。
 * 验证目标：两种 URL 都正确解码、解析并导出 `works`。
 */
test('file url', async () => {
  const server = await createDevServer()

  const mod = await server.ssrLoadModule(
    new URL('./fixtures/file-url/test.js', import.meta.url).href,
  )
  expect(mod.msg).toBe('works')

  const modWithSpace = await server.ssrLoadModule(
    new URL('./fixtures/file-url/test space.js', import.meta.url).href,
  )
  expect(modWithSpace.msg).toBe('works')
})

/**
 * 场景：插件 load hook 通过 `PluginContext.error()` 拒绝虚拟模块加载。
 * 验证目标：SSR logger 输出求值上下文、原始错误消息与插件名称。
 */
test('plugin error', async () => {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    plugins: [
      {
        name: 'test-plugin',
        /** 把 plugin error 测试 ID 解析为内部虚拟模块。 */
        resolveId(source) {
          if (source === 'virtual:test') {
            return '\0' + source
          }
        },
        /** 在加载虚拟模块时通过 PluginContext.error 主动失败。 */
        load(id) {
          if (id === '\0virtual:test') {
            return this.error('test-error')
          }
        },
      },
    ],
  })
  onTestFinished(() => server.close())

  const spy = vi
    .spyOn(server.config.logger, 'error')
    .mockImplementation(() => {})
  try {
    await server.ssrLoadModule('virtual:test')
    expect.unreachable()
  } catch {}
  expect(
    stripVTControlCharacters(spy.mock.lastCall![0])
      .split('\n')
      .slice(0, 2)
      .join('\n'),
  ).toMatchInlineSnapshot(`
    "Error when evaluating SSR module virtual:test: test-error
      Plugin: test-plugin"
  `)
})

/**
 * 场景：入口同时声明具名导出并从两个依赖执行存在冲突的 `export *`。
 * 验证目标：记录当前惰性 SSR 加载器实际暴露的 a、b、c、d 命名空间结果。
 */
test('named exports overwrite export all', async () => {
  const server = await createDevServer()
  const mod = await server.ssrLoadModule(
    './fixtures/named-overwrite-all/main.js',
  )

  // ESM 规范不允许冲突的 `export *`，重复导出（此处为 `d`）应被移除；但 Vite dev SSR
  // 采用惰性加载，很可能无法完全复现该行为。下面保留 Node 与 Rollup 的参照结果。
  // [Node 参照]
  //   $ node -e 'import("./packages/vite/src/node/ssr/__tests__/fixtures/named-overwrite-all/main.js").then(console.log)'
  //   [Module: null prototype] { a: 'main-a', b: 'dep1-b', c: 'main-c' }
  // [Rollup 参照]
  //   Conflicting namespaces: "main.js" re-exports "d" from one of the modules "dep1.js" and "dep2.js" (will be ignored).
  expect(mod).toMatchInlineSnapshot(`
    {
      "a": "main-a",
      "b": "dep1-b",
      "c": "main-c",
      "d": "dep1-d",
    }
  `)
})

/**
 * 场景：自定义 ssr Environment 仅继承 `DevEnvironment`，未提供模块运行能力。
 * 验证目标：旧版 `server.ssrLoadModule()` 以明确的 runnable 环境要求拒绝调用。
 */
test('throws when ssr environment is not runnable', async () => {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    optimizeDeps: {
      noDiscovery: true,
    },
    environments: {
      ssr: {
        dev: {
          createEnvironment: (name, config) =>
            new DevEnvironment(name, config, { hot: false }),
        },
      },
    },
  })
  onTestFinished(() => server.close())

  await expect(
    server.ssrLoadModule('/fixtures/modules/has-invalid-import.js'),
  ).rejects.toThrow(
    "ssrLoadModule requires the 'ssr' environment to be a runnable environment.",
  )
})

/**
 * 场景：插件 buildStart 异步延迟完成，随后 SSR 加载同一插件解析的虚拟模块。
 * 验证目标：调用顺序严格为 buildStart 完成后再 resolveId、load、transform。
 * 机制：记录每个 hook 的进入/退出顺序并整体匹配快照。
 */
test('buildStart before transform', async () => {
  const fn = vi.fn()
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    plugins: [
      {
        name: 'test-plugin',
        /** 延迟完成 buildStart，记录 transform 管线是否严格等待它。 */
        async buildStart() {
          fn('buildStart:in')
          await new Promise((r) => setTimeout(r, 200))
          fn('buildStart:out')
        },
        /** buildStart 完成后解析待测试虚拟模块。 */
        resolveId(source) {
          if (source === 'virtual:test') {
            fn('resolveId')
            return '\0' + source
          }
        },
        /** 记录 load 顺序并返回可执行模块。 */
        load(id) {
          if (id === '\0virtual:test') {
            fn('load')
            return `export default 'ok'`
          }
        },
        /** 记录 transform 顺序，验证它发生在 load 之后。 */
        transform(code, id) {
          if (id === '\0virtual:test') {
            fn('transform')
            return code
          }
        },
      },
    ],
  })
  onTestFinished(() => server.close())
  await server.pluginContainer.buildStart({})

  const mod = await server.ssrLoadModule('virtual:test')
  expect(mod.default).toBe('ok')
  expect(fn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "buildStart:in",
      ],
      [
        "buildStart:out",
      ],
      [
        "resolveId",
      ],
      [
        "load",
      ],
      [
        "transform",
      ],
    ]
  `)
})

/**
 * 场景：`server.fs.allow` 只包含另一夹具目录，SSR 加载目标位于允许列表之外。
 * 验证目标：服务端模块加载不套用浏览器静态文件访问限制，仍返回目标默认导出。
 */
test('server.fs check is not applied to ssrLoadModule', async () => {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    optimizeDeps: {
      noDiscovery: true,
    },
    server: {
      fs: {
        allow: [
          path.resolve(import.meta.dirname, './fixtures/named-overwrite-all'),
        ],
      },
    },
  })
  onTestFinished(() => server.close())
  await server.environments.ssr.pluginContainer.buildStart({})

  const mod = await server.ssrLoadModule('/fixtures/basic/file.js')
  expect(mod.default).toBe('ok')
})
