import fs from 'node:fs'
import { posix, resolve } from 'node:path'
import EventEmitter from 'node:events'
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from 'vitest'
import type {
  InlineConfig,
  Plugin,
  RunnableDevEnvironment,
  ViteDevServer,
} from 'vite'
import { createRunnableDevEnvironment, createServer } from 'vite'
import type { ModuleRunner } from 'vite/module-runner'
import {
  addFile,
  createInMemoryLogger,
  editFile,
  isBuild,
  promiseWithResolvers,
  readFile,
  removeFile,
  slash,
  testDir,
} from '~utils'

let server: ViteDevServer
/** runner 与 fixture 输出的日志累积；setup 重建 runner 时清空，供事件时序断言读取。 */
const clientLogs: string[] = []
/** Vite 自定义 logger 的服务器日志累积；setup 重建时清空，与 client 日志分开断言。 */
const serverLogs: string[] = []
let runner: ModuleRunner

/** 把 mock logger 的日志转发给 untilConsoleLog 监听者，连接操作与异步匹配等待。 */
const logsEmitter = new EventEmitter()

afterAll(async () => {
  await server?.close()
})

/** 读取当前共享 __HMR__ 槽位；不存在或假值按现有逻辑返回空串。
 * @param key fixture 写入的状态键。
 * @returns 当前共享值（类型断言为字符串）或空串。 */
const hmr = (key: string) => (globalThis.__HMR__[key] as string) || ''

/** 生成 runner HMR logger 的更新文本，可带传播边界 via。
 * @param file 发生更新的文件 URL。
 * @param via 可选接受边界 URL。
 * @returns 对应的 hot updated 文本。 */
const updated = (file: string, via?: string) => {
  if (via) {
    return `[vite] hot updated: ${file} via ${via}`
  }
  return `[vite] hot updated: ${file}`
}

describe.skipIf(isBuild)('hmr works correctly', () => {
  const hotEventCounts = { connect: 0, disconnect: 0 }

  beforeAll(async () => {
    /** 注册 SSR hot channel 的 connect/disconnect 监听，把事件次数写入共享计数器。
     * @returns 用于本组 setup 的测试插件。 */
    function hotEventsPlugin(): Plugin {
      return {
        name: 'hot-events',
        /** 在服务器配置阶段订阅 SSR 通道连接事件；监听回调只更新本组计数。
         * @param server 当前开发服务器。 */
        configureServer(server) {
          server.environments.ssr.hot.on(
            'vite:client:connect',
            () => hotEventCounts.connect++,
          )
          server.environments.ssr.hot.on(
            'vite:client:disconnect',
            () => hotEventCounts.disconnect++,
          )
        },
      }
    }

    await setupModuleRunner('/hmr.ts', { plugins: [hotEventsPlugin()] })
  })

  /** 首组在 build 跳过；dev setup 已导入 hmr.ts，检查 connected 日志和一次 connect、零次 disconnect，验证 runner HMR 通道建立。 */
  test('should connect', async () => {
    expect(clientLogs).toContain('[vite] connected.')
    expect(hotEventCounts).toStrictEqual({ connect: 1, disconnect: 0 })
  })

  /** 首组仅 dev：hmr.ts 的 foo 从一改二再改三，逐轮按顺序核对 beforeUpdate、dispose 旧值、两个 self-accept 回调及 afterUpdate，最后读取共享 app 状态。 */
  test('self accept', async () => {
    /** 每次调用都读取当前 __HMR__ 的 '.app' 槽位，供轮询观察新模块写入的状态。
     * @returns 此刻共享槽位值。 */
    const el = () => hmr('.app')
    await untilConsoleLogAfter(
      () =>
        editFile('hmr.ts', (code) =>
          code.replace('const foo = 1', 'const foo = 2 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        'foo was: 1',
        '(self-accepting 1) foo is now: 2',
        '(self-accepting 2) foo is now: 2',
        updated('/hmr.ts'),
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el()).toMatch('2')

    await untilConsoleLogAfter(
      () =>
        editFile('hmr.ts', (code) =>
          code.replace('const foo = 2', 'const foo = 3 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        'foo was: 2',
        '(self-accepting 1) foo is now: 3',
        '(self-accepting 2) foo is now: 3',
        updated('/hmr.ts'),
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el()).toMatch('3')
  })

  /** 首组仅 dev：hotData.js 连续从一改二再改三，按顺序核对上次 execution 与 dispose 写入的数据，验证 hot.data 跨实例保存。 */
  test('hot data persists across module instances', async () => {
    await untilConsoleLogAfter(
      () =>
        editFile('hotData.js', (code) =>
          code.replace('const value = 1', 'const value = 2 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '(hot data) value from execution: 1',
        '(hot data) value from dispose: 1',
        updated('/hotData.js'),
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )

    await untilConsoleLogAfter(
      () =>
        editFile('hotData.js', (code) =>
          code.replace('const value = 2', 'const value = 3  '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '(hot data) value from execution: 2',
        '(hot data) value from dispose: 2',
        updated('/hotData.js'),
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
  })

  /** 首组仅 dev：依赖 foo 连续一改二改三，核对单/多依赖 accept 回调和 dispose 数据，同时嵌套依赖保持一，共享 dep 槽位更新。 */
  test('accept dep', async () => {
    /** 每次调用都读取当前 __HMR__ 的 '.dep' 槽位，供轮询观察新模块写入的状态。
     * @returns 此刻共享槽位值。 */
    const el = () => hmr('.dep')
    await untilConsoleLogAfter(
      () =>
        editFile('hmrDep.js', (code) =>
          code.replace('const foo = 1', 'const foo = 2 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '(dep) foo was: 1',
        '(dep) foo from dispose: 1',
        '(single dep) foo is now: 2',
        '(single dep) nested foo is now: 1',
        '(multi deps) foo is now: 2',
        '(multi deps) nested foo is now: 1',
        updated('/hmrDep.js', '/hmr.ts'),
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el()).toMatch('2')

    await untilConsoleLogAfter(
      () =>
        editFile('hmrDep.js', (code) =>
          code.replace('const foo = 2', 'const foo = 3 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '(dep) foo was: 2',
        '(dep) foo from dispose: 2',
        '(single dep) foo is now: 3',
        '(single dep) nested foo is now: 1',
        '(multi deps) foo is now: 3',
        '(multi deps) nested foo is now: 1',
        updated('/hmrDep.js', '/hmr.ts'),
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el()).toMatch('3')
  })

  /** 首组仅 dev 且沿用上一用例依赖值三：嵌套依赖连续一改二改三，核对更新传播到 hmrDep 边界、回调保留直接依赖值且 nested 槽位变动。 */
  test('nested dep propagation', async () => {
    /** 每次调用都读取当前 __HMR__ 的 '.nested' 槽位，供轮询观察新模块写入的状态。
     * @returns 此刻共享槽位值。 */
    const el = () => hmr('.nested')
    await untilConsoleLogAfter(
      () =>
        editFile('hmrNestedDep.js', (code) =>
          code.replace('const foo = 1', 'const foo = 2 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '(dep) foo was: 3',
        '(dep) foo from dispose: 3',
        '(single dep) foo is now: 3',
        '(single dep) nested foo is now: 2',
        '(multi deps) foo is now: 3',
        '(multi deps) nested foo is now: 2',
        updated('/hmrDep.js', '/hmr.ts'),
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el()).toMatch('2')

    await untilConsoleLogAfter(
      () =>
        editFile('hmrNestedDep.js', (code) =>
          code.replace('const foo = 2', 'const foo = 3 '),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        '(dep) foo was: 3',
        '(dep) foo from dispose: 3',
        '(single dep) foo is now: 3',
        '(single dep) nested foo is now: 3',
        '(multi deps) foo is now: 3',
        '(multi deps) nested foo is now: 3',
        updated('/hmrDep.js', '/hmr.ts'),
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el()).toMatch('3')
  })

  /** 首组仅 dev：修改 child 文本触发 hot.invalidate，按顺序检查子模块第一轮与 parent 第二轮事件日志，最终共享值为 child updated。 */
  test('invalidate', async () => {
    /** 每次调用都读取当前 __HMR__ 的 '.invalidation' 槽位，供轮询观察新模块写入的状态。
     * @returns 此刻共享槽位值。 */
    const el = () => hmr('.invalidation')
    await untilConsoleLogAfter(
      () =>
        editFile('invalidation/child.js', (code) =>
          code.replace('child', 'child updated'),
        ),
      [
        '>>> vite:beforeUpdate -- update',
        `>>> vite:invalidate -- /invalidation/child.js`,
        '[vite] invalidate /invalidation/child.js',
        updated('/invalidation/child.js'),
        '>>> vite:afterUpdate -- update',
        '>>> vite:beforeUpdate -- update',
        '(invalidation) parent is executing',
        updated('/invalidation/parent.js'),
        '>>> vite:afterUpdate -- update',
      ],
      true,
    )
    await expect.poll(() => el()).toMatch('child updated')
  })

  /** 首组仅 dev：先确认 index transform 次数一与 child=bar，修改 child 后要求新值 updated 但 transform 次数仍一，覆盖软失效复用。 */
  test('soft invalidate', async () => {
    /** 每次调用都读取当前 __HMR__ 的 '.soft-invalidation' 槽位，供轮询观察新模块写入的状态。
     * @returns 此刻共享槽位值。 */
    const el = () => hmr('.soft-invalidation')
    expect(el()).toBe(
      'soft-invalidation/index.js is transformed 1 times. child is bar',
    )
    editFile('soft-invalidation/child.js', (code) =>
      code.replace('bar', 'updated'),
    )
    await expect
      .poll(() => el())
      .toBe(
        'soft-invalidation/index.js is transformed 1 times. child is updated',
      )
  })

  /** 首组仅 dev：先检查环形失效场景为 child，再修改 child 并轮询 child updated；本断言检查收敛结果，未持续计数全部 HMR 次数。 */
  test('invalidate in circular dep should not trigger infinite HMR', async () => {
    /** 每次调用都读取当前 __HMR__ 的 '.invalidation-circular-deps' 槽位，供轮询观察新模块写入的状态。
     * @returns 此刻共享槽位值。 */
    const el = () => hmr('.invalidation-circular-deps')
    await expect.poll(() => el()).toMatch('child')
    editFile(
      'invalidation-circular-deps/circular-invalidate/child.js',
      (code) => code.replace('child', 'child updated'),
    )
    await expect.poll(() => el()).toMatch('child updated')
  })

  /** 首组仅 dev：修改存在处理边界的环中 child，轮询 child updated，覆盖环内 invalidate 的可接管更新结果。 */
  test('invalidate in circular dep should be hot updated if possible', async () => {
    /** 每次调用都读取当前 __HMR__ 的 '.invalidation-circular-deps-handled' 槽位，供轮询观察新模块写入的状态。
     * @returns 此刻共享槽位值。 */
    const el = () => hmr('.invalidation-circular-deps-handled')
    await expect.poll(() => el()).toMatch('child')
    editFile(
      'invalidation-circular-deps/invalidate-handled-in-circle/child.js',
      (code) => code.replace('child', 'child updated'),
    )
    await expect.poll(() => el()).toMatch('child updated')
  })

  /** 首组仅 dev：修改插件监听的 customFile 文本，轮询 custom 槽位 edited2，验证自定义 HMR 事件传到 runner。 */
  test('plugin hmr handler + custom event', async () => {
    /** 每次调用都读取当前 __HMR__ 的 '.custom' 槽位，供轮询观察新模块写入的状态。
     * @returns 此刻共享槽位值。 */
    const el = () => hmr('.custom')
    editFile('customFile.js', (code) => code.replace('custom', 'edited2'))
    await expect.poll(() => el()).toMatch('edited2')
  })

  /** 首组仅 dev 且沿用 edited2：修改 customFile 到 custom33，toRemove 槽位仍为 edited2，验证被移除的事件订阅不再更新该槽位。 */
  test('plugin hmr remove custom events', async () => {
    /** 每次调用都读取当前 __HMR__ 的 '.toRemove' 槽位，供轮询观察新模块写入的状态。
     * @returns 此刻共享槽位值。 */
    const el = () => hmr('.toRemove')
    await expect.poll(() => el()).toMatch('edited2')
    editFile('customFile.js', (code) => code.replace('edited2', 'custom33'))
    await expect.poll(() => el()).toMatch('edited2')
  })

  /** 首组仅 dev：读取插件与 runner 互发事件累计结果，轮询 custom-communication 为三，覆盖双向消息应用结果。 */
  test('plugin client-server communication', async () => {
    /** 每次调用都读取当前 __HMR__ 的 '.custom-communication' 槽位，供轮询观察新模块写入的状态。
     * @returns 此刻共享槽位值。 */
    const el = () => hmr('.custom-communication')
    await expect.poll(() => el()).toMatch('3')
  })

  /** 首组仅 dev：先确认两查询模块各为 query1/query2，再给共用文件添加注释，要求两槽位分别带新注释前缀，验证 query 实例分别失效。 */
  test('queries are correctly resolved', async () => {
    /** 每次调用都读取当前 __HMR__ 的 'query1' 槽位，供轮询观察新模块写入的状态。
     * @returns 此刻共享槽位值。 */
    const query1 = () => hmr('query1')
    /** 每次调用都读取当前 __HMR__ 的 'query2' 槽位，供轮询观察新模块写入的状态。
     * @returns 此刻共享槽位值。 */
    const query2 = () => hmr('query2')

    expect(query1()).toBe('query1')
    expect(query2()).toBe('query2')

    editFile('queries/multi-query.js', (code) => code + '//comment')
    await expect.poll(() => query1()).toBe('//commentquery1')
    await expect.poll(() => query2()).toBe('//commentquery2')
  })
})

describe('self accept with different entry point formats', () => {
  /** each 定义以 ./unresolved.ts、./unresolved、/unresolved 三种入口创建 runner，等待同一文件被 watch；依次修改 foo 一到二到三，核对各入口格式的更新日志并在结束时恢复原字节。 */
  test.each(['./unresolved.ts', './unresolved', '/unresolved'])(
    'accepts if entry point is relative to root %s',
    async (entrypoint) => {
      await setupModuleRunner(entrypoint, {}, '/unresolved.ts')

      const originalUnresolvedFile = readFile('unresolved.ts')
      onTestFinished(() => {
        const filepath = resolve(testDir, 'unresolved.ts')
        fs.writeFileSync(filepath, originalUnresolvedFile, 'utf-8')
      })

      /** 每次调用都读取当前 __HMR__ 的 '.app' 槽位，供轮询观察新模块写入的状态。
       * @returns 此刻共享槽位值。 */
      const el = () => hmr('.app')
      await untilConsoleLogAfter(
        () =>
          editFile('unresolved.ts', (code) =>
            code.replace('const foo = 1', 'const foo = 2 '),
          ),
        [
          'foo was: 1',
          '(self-accepting 1) foo is now: 2',
          '(self-accepting 2) foo is now: 2',
          updated(entrypoint),
        ],
        true,
      )
      await expect.poll(() => el()).toMatch('2')

      await untilConsoleLogAfter(
        () =>
          editFile('unresolved.ts', (code) =>
            code.replace('const foo = 2', 'const foo = 3 '),
          ),
        [
          'foo was: 2',
          '(self-accepting 1) foo is now: 3',
          '(self-accepting 2) foo is now: 3',
          updated(entrypoint),
        ],
        true,
      )
      await expect.poll(() => el()).toMatch('3')
    },
  )
})

describe('acceptExports', () => {
  const HOT_UPDATED = /hot updated/
  const CONNECTED = /connected/
  const PROGRAM_RELOAD = /program reload/

  const baseDir = 'accept-exports'

  describe('when all used exports are accepted', () => {
    const testDir = baseDir + '/main-accepted'

    const fileName = 'target.ts'
    const file = `${testDir}/${fileName}`
    const url = `/${file}`

    let dep = 'dep0'

    beforeAll(async () => {
      await untilConsoleLogAfter(
        () => setupModuleRunner(`/${testDir}/index`),
        [CONNECTED, />>>>>>/],
        (logs) => {
          expect(logs).toContain(`<<<<<< A0 B0 D0 ; ${dep}`)
          expect(logs).toContain('>>>>>> A0 D0')
        },
      )
    })

    /** setup 已导入接受全部使用导出的入口：连续修改 callback 模块 X→Y→Z，核对第一次执行旧注册回调、第二次执行上轮新回调且都接收新导出。 */
    test('the callback is called with the new version the module', async () => {
      const callbackFile = `${testDir}/callback.ts`
      const callbackUrl = `/${callbackFile}`

      await untilConsoleLogAfter(
        () => {
          editFile(callbackFile, (code) =>
            code
              .replace("x = 'X'", "x = 'Y'")
              .replace('reloaded >>>', 'reloaded (2) >>>'),
          )
        },
        HOT_UPDATED,
        (logs) => {
          expect(logs).toEqual([
            'reloaded >>> Y',
            `[vite] hot updated: ${callbackUrl}`,
          ])
        },
      )

      await untilConsoleLogAfter(
        () => {
          editFile(callbackFile, (code) => code.replace("x = 'Y'", "x = 'Z' "))
        },
        HOT_UPDATED,
        (logs) => {
          expect(logs).toEqual([
            'reloaded (2) >>> Z',
            `[vite] hot updated: ${callbackUrl}`,
          ])
        },
      )
    })

    /** 接受全部使用导出的 target 已加载；把其 dep0 改为 dep1，要求日志仅 target 执行与 target hot updated，验证依赖变化在该边界停止。 */
    test('stops HMR bubble on dependency change', async () => {
      const depFileName = 'dep.ts'
      const depFile = `${testDir}/${depFileName}`

      await untilConsoleLogAfter(
        () => {
          editFile(
            depFile,
            (code) => code.replace('dep0', (dep = 'dep1')) + '\n',
          )
        },
        HOT_UPDATED,
        (logs) => {
          expect(logs).toEqual([
            `<<<<<< A0 B0 D0 ; ${dep}`,
            `[vite] hot updated: ${url}`,
          ])
        },
      )
    })

    /** 沿用 dep1，将 target 的 A/B/D 从零改一，要求只执行 target 与其更新日志，验证自身导出更新被接管。 */
    test('accepts itself and refreshes on change', async () => {
      await untilConsoleLogAfter(
        () => {
          editFile(file, (code) => code.replace(/(\b[A-Z])0/g, '$11') + '\n')
        },
        HOT_UPDATED,
        (logs) => {
          expect(logs).toEqual([
            `<<<<<< A1 B1 D1 ; ${dep}`,
            `[vite] hot updated: ${url}`,
          ])
        },
      )
    })

    /** 将 target 的一改二同时将接受列表 a 改为 b，本轮仍由旧边界接管并显示 A2/B2/D2，为下一轮传播建立新接受列表。 */
    test('accepts itself and refreshes on 2nd change', async () => {
      await untilConsoleLogAfter(
        () => {
          editFile(
            file,
            (code) =>
              code
                .replace(/(\b[A-Z])1/g, '$12')
                .replace(
                  "acceptExports(['a', 'default']",
                  "acceptExports(['b', 'default']",
                ) + '\n',
          )
        },
        HOT_UPDATED,
        (logs) => {
          expect(logs).toEqual([
            `<<<<<< A2 B2 D2 ; ${dep}`,
            `[vite] hot updated: ${url}`,
          ])
        },
      )
    })

    /** 沿用已改为接受 b/default 的 target，再将二改三；等待 program reload 与入口日志，验证原使用 a 的 importer 不能由新接受列表接管。 */
    test('does not accept itself anymore after acceptedExports change', async () => {
      await untilConsoleLogAfter(
        async () => {
          editFile(file, (code) => code.replace(/(\b[A-Z])2/g, '$13') + '\n')
        },
        [PROGRAM_RELOAD, />>>>>>/],
        (logs) => {
          expect(logs).toContain(`<<<<<< A3 B3 D3 ; ${dep}`)
          expect(logs).toContain('>>>>>> A3 D3')
        },
      )
    })
  })

  describe('when some used exports are not accepted', () => {
    const testDir = baseDir + '/main-non-accepted'

    const namedFileName = 'named.ts'
    const namedFile = `${testDir}/${namedFileName}`
    const defaultFileName = 'default.ts'
    const defaultFile = `${testDir}/${defaultFileName}`
    const depFileName = 'dep.ts'
    const depFile = `${testDir}/${depFileName}`

    const a = 'A0'
    let dep = 'dep0'

    beforeAll(async () => {
      await untilConsoleLogAfter(
        () => setupModuleRunner(`/${testDir}/index`),
        [CONNECTED, />>>>>>/],
        (logs) => {
          expect(logs).toContain(`<<< named: ${a} ; ${dep}`)
          expect(logs).toContain(`<<< default: def0`)
          expect(logs).toContain(`>>>>>> ${a} def0`)
        },
      )
    })

    /** 部分使用导出未接受的 fixture 已加载；修改 dep0→dep1，等待 program reload 并检查 named 模块的新依赖文本，验证更新继续冒泡。 */
    test('does not stop the HMR bubble on change to dep', async () => {
      await untilConsoleLogAfter(
        async () => {
          editFile(
            depFile,
            (code) => code.replace('dep0', (dep = 'dep1')) + '\n',
          )
        },
        [PROGRAM_RELOAD, />>>>>>/],
        (logs) => {
          expect(logs).toContain(`<<< named: ${a} ; ${dep}`)
        },
      )
    })

    describe('does not stop the HMR bubble on change to self', () => {
      /** 部分导出未接受时修改 named 模块 A0→A1，等待 program reload 与入口完成日志，确认执行结果含新命名导出。 */
      test('with named exports', async () => {
        await untilConsoleLogAfter(
          async () => {
            editFile(namedFile, (code) => code.replace(a, 'A1') + '\n')
          },
          [PROGRAM_RELOAD, />>>>>>/],
          (logs) => {
            expect(logs).toContain(`<<< named: A1 ; ${dep}`)
          },
        )
      })

      /** 部分导出未接受时修改 default 模块 def0→def1，等待 program reload 与入口日志，确认执行结果含新默认导出。 */
      test('with default export', async () => {
        await untilConsoleLogAfter(
          async () => {
            editFile(defaultFile, (code) => code.replace('def0', 'def1') + '\n')
          },
          [PROGRAM_RELOAD, />>>>>>/],
          (logs) => {
            expect(logs).toContain(`<<< default: def1`)
          },
        )
      })
    })

    describe("doesn't reload if files not in the entrypoint importers chain is changed", async () => {
      const testFile = 'non-tested/index.js'

      beforeAll(async () => {
        clientLogs.length = 0
        // 先导入，使该文件进入模块图。
        const ssrEnvironment = server.environments.ssr
        await ssrEnvironment.transformRequest(testFile)
        await ssrEnvironment.transformRequest('non-tested/dep.js')
      })

      /** setup 只 transform 两个 non-tested 文件使其入图、未导入入口链；修改 index 增加 query5，连续两秒每100ms检查无 program reload 或该文件日志。 */
      test('does not full reload', async () => {
        editFile(
          testFile,
          (code) => code + '\n\nexport const query5 = "query5"',
        )
        const start = Date.now()
        // 持续两秒确认没有重载该文件的日志。
        while (Date.now() - start < 2000) {
          if (
            clientLogs.some(
              (log) =>
                log.match(PROGRAM_RELOAD) ||
                log.includes('non-tested/index.js'),
            )
          ) {
            throw new Error('File was reloaded')
          }
          await new Promise((r) => setTimeout(r, 100))
        }
      }, 5_000)

      /** 沿用只入图而未进入 runner 执行链的 non-tested 依赖，追加注释后连续两秒检查无 program reload 或该依赖更新日志。 */
      test('does not update', async () => {
        editFile('non-tested/dep.js', (code) => code + '//comment')
        const start = Date.now()
        // 持续两秒确认没有重载该文件的日志。
        while (Date.now() - start < 2000) {
          if (
            clientLogs.some(
              (log) =>
                log.match(PROGRAM_RELOAD) || log.includes('non-tested/dep.js'),
            )
          ) {
            throw new Error('File was updated')
          }
          await new Promise((r) => setTimeout(r, 100))
        }
      }, 5_000)
    })
  })

  /** 先导入只有副作用引用的 fixture，再修改副作用消息；要求日志精确为新消息与该模块 hot updated，验证没有导入绑定时可自接管。 */
  test('accepts itself when imported for side effects only (no bindings imported)', async () => {
    const testDir = baseDir + '/side-effects'
    const file = 'side-effects.ts'

    await untilConsoleLogAfter(
      () => setupModuleRunner(`/${testDir}/index`),
      [CONNECTED, />>>/],
      (logs) => {
        expect(logs).toContain('>>> side FX')
      },
    )

    await untilConsoleLogAfter(
      () => {
        editFile(`${testDir}/${file}`, (code) =>
          code.replace('>>> side FX', '>>> side FX !!'),
        )
      },
      HOT_UPDATED,
      (logs) => {
        expect(logs).toEqual(['>>> side FX !!', updated(`/${testDir}/${file}`)])
      },
    )
  })

  describe('acceptExports([])', () => {
    const testDir = baseDir + '/unused-exports'

    /** 先导入 acceptExports 空列表且无人使用导出的 unused 模块，修改执行消息；日志仅新消息和该模块 hot updated，验证空列表边界仍成立。 */
    test('accepts itself if no exports are imported', async () => {
      const fileName = 'unused.ts'
      const file = `${testDir}/${fileName}`
      const url = '/' + file

      await untilConsoleLogAfter(
        () => setupModuleRunner(`/${testDir}/index`),
        [CONNECTED, '-- unused --'],
        (logs) => {
          expect(logs).toContain('-- unused --')
        },
      )

      await untilConsoleLogAfter(
        () => {
          editFile(
            file,
            (code) => code.replace('-- unused --', '-> unused <-') + '\n',
          )
        },
        HOT_UPDATED,
        (logs) => {
          expect(logs).toEqual(['-> unused <-', updated(url)])
        },
      )
    })

    /** 先导入 acceptExports 空列表但有 foo 使用者的模块，再修改 foo 与执行消息；等待 program reload，要求入口消费到 foo1。 */
    test("doesn't accept itself if any of its exports is imported", async () => {
      const fileName = 'used.ts'
      const file = `${testDir}/${fileName}`

      await untilConsoleLogAfter(
        () => setupModuleRunner(`/${testDir}/index`),
        [CONNECTED, '-- used --', 'used:foo0'],
        (logs) => {
          expect(logs).toContain('-- used --')
          expect(logs).toContain('used:foo0')
        },
      )

      await untilConsoleLogAfter(
        async () => {
          editFile(
            file,
            (code) =>
              code.replace('foo0', 'foo1').replace('-- used --', '-> used <-') +
              '\n',
          )
        },
        [PROGRAM_RELOAD, /used:foo/],
        (logs) => {
          expect(logs).toContain('-> used <-')
          expect(logs).toContain('used:foo1')
        },
      )
    })
  })

  describe('indiscriminate imports: import *', () => {
    /** 为静态星号或动态 import 两种 fixture 注册相同全接受/部分接受场景。
     * @param testDirName 选用的 fixture 子目录，不在此处启动 runner。 */
    const testStarExports = (testDirName: string) => {
      const testDir = `${baseDir}/${testDirName}`

      /** 共享注册器分别用于静态星号与动态导入两个目录；全部导出含 default 已接受时连续改 a/b/c，两轮日志均只含依赖新值和其 hot updated。 */
      test('accepts itself if all its exports are accepted', async () => {
        const fileName = 'deps-all-accepted.ts'
        const file = `${testDir}/${fileName}`
        const url = '/' + file

        await untilConsoleLogAfter(
          () => setupModuleRunner(`/${testDir}/index`),
          [CONNECTED, '>>> ready <<<'],
          (logs) => {
            expect(logs).toContain('loaded:all:a0b0c0default0')
            expect(logs).toContain('all >>>>>> a0, b0, c0')
          },
        )

        await untilConsoleLogAfter(
          () => {
            editFile(file, (code) => code.replace(/([abc])0/g, '$11') + '\n')
          },
          HOT_UPDATED,
          (logs) => {
            expect(logs).toEqual(['all >>>>>> a1, b1, c1', updated(url)])
          },
        )

        await untilConsoleLogAfter(
          () => {
            editFile(file, (code) => code.replace(/([abc])1/g, '$12') + '\n')
          },
          HOT_UPDATED,
          (logs) => {
            expect(logs).toEqual(['all >>>>>> a2, b2, c2', updated(url)])
          },
        )
      })

      /** 共享注册器分别用于静态星号与动态导入两个目录；有一个使用的导出未接受时改 a/b/c，等待 program reload 并核对入口与依赖均执行新值。 */
      test("doesn't accept itself if one export is not accepted", async () => {
        const fileName = 'deps-some-accepted.ts'
        const file = `${testDir}/${fileName}`

        await untilConsoleLogAfter(
          () => setupModuleRunner(`/${testDir}/index`),
          [CONNECTED, '>>> ready <<<'],
          (logs) => {
            expect(logs).toContain('loaded:some:a0b0c0default0')
            expect(logs).toContain('some >>>>>> a0, b0, c0')
          },
        )

        await untilConsoleLogAfter(
          async () => {
            editFile(file, (code) => code.replace(/([abc])0/g, '$11') + '\n')
          },
          [PROGRAM_RELOAD, '>>> ready <<<'],
          (logs) => {
            expect(logs).toContain('loaded:some:a1b1c1default0')
            expect(logs).toContain('some >>>>>> a1, b1, c1')
          },
        )
      })
    }

    describe('import * from ...', () => testStarExports('star-imports'))

    describe('dynamic import(...)', () => testStarExports('dynamic-imports'))
  })
})

/** 新建 runner 导入 hmr.ts，先检查 virtual 为 success0；修改被虚拟模块消费的文件后轮询 wow0，覆盖插件虚拟图依赖更新。 */
test('handle virtual module updates', async () => {
  await setupModuleRunner('/hmr.ts')
  /** 每次调用都读取当前 __HMR__ 的 '.virtual' 槽位，供轮询观察新模块写入的状态。
   * @returns 此刻共享槽位值。 */
  const el = () => hmr('.virtual')
  expect(el()).toBe('[success]0')
  editFile('importedVirtual.js', (code) => code.replace('[success]', '[wow]'))
  await expect.poll(el).toBe('[wow]0')
})

/** 重新建 runner 并沿用上轮文件 wow，先检查 wow0；调用共享 virtual:increment 函数后轮询 wow1，覆盖插件主动失效虚拟模块。 */
test('invalidate virtual module', async () => {
  await setupModuleRunner('/hmr.ts')
  /** 每次调用都读取当前 __HMR__ 的 '.virtual' 槽位，供轮询观察新模块写入的状态。
   * @returns 此刻共享槽位值。 */
  const el = () => hmr('.virtual')
  expect(el()).toBe('[wow]0')
  globalThis.__HMR__['virtual:increment']()
  await expect.poll(el).toBe('[wow]1')
})

/** 先导入 parent:child，修改 child 显示 child1；移除 parent 导入并删除 child 后显示 not-child，再恢复文件与导入，检查 prune 后 hot.data 已清空且显示初始 child。 */
test('should hmr when file is deleted and restored', async () => {
  await setupModuleRunner('/hmr.ts')

  const parentFile = 'file-delete-restore/parent.js'
  const childFile = 'file-delete-restore/child.js'

  await expect.poll(() => hmr('.file-delete-restore')).toMatch('parent:child')

  editFile(childFile, (code) =>
    code.replace("value = 'child'", "value = 'child1'"),
  )
  await expect.poll(() => hmr('.file-delete-restore')).toMatch('parent:child1')

  // 删除文件，触发依赖丢失。
  editFile(parentFile, (code) =>
    code.replace(
      "export { value as childValue } from './child'",
      "export const childValue = 'not-child'",
    ),
  )
  const originalChildFileCode = readFile(childFile)
  removeFile(childFile)
  await expect
    .poll(() => hmr('.file-delete-restore'))
    .toMatch('parent:not-child')

  // 恢复文件，触发重新加载。
  await untilConsoleLogAfter(() => {
    addFile(childFile, originalChildFileCode)
    editFile(parentFile, (code) =>
      code.replace(
        "export const childValue = 'not-child'",
        "export { value as childValue } from './child'",
      ),
    )
  }, 'file-delete-restore/child.js hot data after prune: undefined')
  await expect.poll(() => hmr('.file-delete-restore')).toMatch('parent:child')
})

/** 以计数一初始化 runner 并增至二，改入口绕过中间 re-export 后验证 display HMR；删除无用中间文件并重置/再增计数，继续修改 display 仍显示二，覆盖删除后更新链。 */
test('delete file should not break hmr', async () => {
  await setupModuleRunner('/hmr.ts', undefined, undefined, {
    '.intermediate-file-delete-increment': '1',
  })

  await expect
    .poll(() => hmr('.intermediate-file-delete-display'))
    .toMatch('count is 1')

  // 增加状态依赖。
  globalThis.__HMR__['.delete-intermediate-file']()
  await expect
    .poll(() => hmr('.intermediate-file-delete-display'))
    .toMatch('count is 2')

  // 改写导入后确认 HMR 仍可更新。
  editFile('intermediate-file-delete/index.js', (code) =>
    code.replace("from './re-export.js'", "from './display.js'"),
  )
  editFile('intermediate-file-delete/display.js', (code) =>
    code.replace('count is ${count}', 'count is ${count}!'),
  )
  await expect
    .poll(() => hmr('.intermediate-file-delete-display'))
    .toMatch('count is 2!')

  // 删除已不再使用的文件。
  removeFile('intermediate-file-delete/re-export.js')
  __HMR__['.intermediate-file-delete-increment'] = '1' // 重置共享状态。
  await expect
    .poll(() => hmr('.intermediate-file-delete-display'))
    .toMatch('count is 1!')

  // 重新增加状态依赖。
  globalThis.__HMR__['.delete-intermediate-file']()
  await expect
    .poll(() => hmr('.intermediate-file-delete-display'))
    .toMatch('count is 2!')

  // 确认文件删除再恢复后 HMR 仍可更新。
  editFile('intermediate-file-delete/display.js', (code) =>
    code.replace('count is ${count}!', 'count is ${count}'),
  )
  await expect
    .poll(() => hmr('.intermediate-file-delete-display'))
    .toMatch('count is 2')
})

/** 先保存 child 原文并导入 parent，再去掉引用且删除 child；等待 dispose 与 prune 日志、检查 not-child，恢复文件与导入后要求 parent:child。 */
test('deleted file should trigger dispose and prune callbacks', async () => {
  await setupModuleRunner('/hmr.ts')

  const parentFile = 'file-delete-restore/parent.js'
  const childFile = 'file-delete-restore/child.js'
  const originalChildFileCode = readFile(childFile)

  await untilConsoleLogAfter(
    () => {
      // 删除文件，触发依赖丢失。
      editFile(parentFile, (code) =>
        code.replace(
          "export { value as childValue } from './child'",
          "export const childValue = 'not-child'",
        ),
      )
      removeFile(childFile)
    },
    [
      'file-delete-restore/child.js is disposed',
      'file-delete-restore/child.js is pruned',
    ],
    false,
  )

  await expect
    .poll(() => hmr('.file-delete-restore'))
    .toMatch('parent:not-child')

  // 恢复文件，触发重新加载。
  addFile(childFile, originalChildFileCode)
  editFile(parentFile, (code) =>
    code.replace(
      "export const childValue = 'not-child'",
      "export { value as childValue } from './child'",
    ),
  )
  await expect.poll(() => hmr('.file-delete-restore')).toMatch('parent:child')
})

/** 新建 runner 后修改使用可选链 hot.accept 的 child 一到二，等待 child update 日志并读取共享状态为二，验证该接受语法被识别。 */
test('import.meta.hot?.accept', async () => {
  await setupModuleRunner('/hmr.ts')
  await untilConsoleLogAfter(
    () =>
      editFile('optional-chaining/child.js', (code) =>
        code.replace('const foo = 1', 'const foo = 2 '),
      ),
    '(optional-chaining) child update',
  )
  await expect.poll(() => hmr('.optional-chaining')?.toString()).toMatch('2')
})

/** 先导入环内自接受模块并检查 c，修改到 cc 后手动 invalidateAll 再 runner.import；当前仅验证手工重导入结果，注释不能声称自动 HMR 恢复。 */
test('hmr works for self-accepted module within circular imported files', async () => {
  await setupModuleRunner('/self-accept-within-circular/index')
  /** 每次调用都读取当前 __HMR__ 的 '.self-accept-within-circular' 槽位，供轮询观察新模块写入的状态。
   * @returns 此刻共享槽位值。 */
  const el = () => hmr('.self-accept-within-circular')
  expect(el()).toBe('c')
  editFile('self-accept-within-circular/c.js', (code) =>
    code.replace(`export const c = 'c'`, `export const c = 'cc'`),
  )
  // 与浏览器场景一样会抛错；SSR runner 不自动重载，
  // 此时 accept 回调收到的 nextExports 为 undefined。

  // 当前用例通过手工失效与重导入检查更新后的结果。
  server.moduleGraph.invalidateAll() // TODO：继续查明为何只调用 runner.clearCache() 无法恢复该循环图。
  await runner.import('/self-accept-within-circular/index')
  await expect.poll(() => el()).toBe('cc')
})

/** 先导入没有 accept 的循环图，运行时返回含 undefined 的链；修改 mod-b 后轮询链中 edited 文本，覆盖 runner 循环导出求值的更新结果。 */
test('hmr should not reload if no accepted within circular imported files', async () => {
  await setupModuleRunner('/circular/index')
  /** 每次调用都读取当前 __HMR__ 的 '.circular' 槽位，供轮询观察新模块写入的状态。
   * @returns 此刻共享槽位值。 */
  const el = () => hmr('.circular')
  expect(el()).toBe(
    // 浏览器套件期待错误；这里的 runner 对该循环导出返回 undefined。
    'mod-a -> mod-b -> mod-c -> undefined (expected no error)',
  )
  editFile('circular/mod-b.js', (code) =>
    code.replace(`mod-b ->`, `mod-b (edited) ->`),
  )
  await expect
    .poll(() => el())
    .toBe('mod-a -> mod-b (edited) -> mod-c -> undefined (expected no error)')
})

/** 新建 runner 后修改非内联 SVG 高度，等待资源更新日志并要求共享 URL 带 ?t=，验证以时间戳更新 URL。 */
test('not inlined assets HMR', async () => {
  await setupModuleRunner('/hmr.ts')
  /** 每次调用都读取当前 __HMR__ 的 '#logo-no-inline' 槽位，供轮询观察新模块写入的状态。
   * @returns 此刻共享槽位值。 */
  const el = () => hmr('#logo-no-inline')
  await untilConsoleLogAfter(
    () =>
      editFile('logo-no-inline.svg', (code) =>
        code.replace('height="30px"', 'height="40px" '),
      ),
    /Logo-no-inline updated/,
  )
  await vi.waitUntil(() => el().includes('logo-no-inline.svg?t='))
})

/** 新建 runner 后先确认内联 SVG 为 data URL，修改高度并等待更新日志，要求新值仍为 data URL 且不同于旧值，验证内联内容重生成。 */
test('inlined assets HMR', async () => {
  await setupModuleRunner('/hmr.ts')
  /** 每次调用都读取当前 __HMR__ 的 '#logo' 槽位，供轮询观察新模块写入的状态。
   * @returns 此刻共享槽位值。 */
  const el = () => hmr('#logo')
  const initialLogoUrl = el()
  expect(initialLogoUrl).toMatch(/^data:image\/svg\+xml/)
  await untilConsoleLogAfter(
    () =>
      editFile('logo.svg', (code) =>
        code.replace('height="30px"', 'height="40px" '),
      ),
    /Logo updated/,
  )
  // 新内联内容应生成新的 data URL。
  const updatedLogoUrl = el()
  expect(updatedLogoUrl).toMatch(/^data:image\/svg\+xml/)
  expect(updatedLogoUrl).not.toEqual(initialLogoUrl)
})

/** 日志匹配完成后执行的检查回调，可同步断言或返回 Promise。 */
type UntilBrowserLogAfterCallback = (logs: string[]) => PromiseLike<void> | void

/** 先注册日志等待再执行操作，匹配完成后等待可选回调并返回收集文本。
 * @param operation 会触发日志的编辑或 runner 初始化。
 * @param target 单项或多项日志匹配目标。
 * @param expectOrder 数组目标是否严格逐条按顺序匹配。
 * @param callback 日志完成后的断言回调。
 * @returns 等待期间收集的日志。 */
export async function untilConsoleLogAfter(
  operation: () => any,
  target: string | RegExp | Array<string | RegExp>,
  expectOrder?: boolean,
  callback?: UntilBrowserLogAfterCallback,
): Promise<string[]>
/** 省略顺序参数的重载：数组目标默认不要求顺序，第三参直接作为完成回调。
 * @param operation 触发日志的操作。
 * @param target 匹配目标。
 * @param callback 日志完成后的回调。
 * @returns 等待期间收集的日志。 */
export async function untilConsoleLogAfter(
  operation: () => any,
  target: string | RegExp | Array<string | RegExp>,
  callback?: UntilBrowserLogAfterCallback,
): Promise<string[]>
/** 根据第三参数类型选择顺序开关和回调，先监听后操作，再等待日志及回调。
 * @param operation 触发日志的操作。
 * @param target 匹配目标。
 * @param arg3 布尔顺序开关或完成回调；默认无序。
 * @param arg4 第三参为布尔时的完成回调。
 * @returns 等待期间收集的日志。 */
export async function untilConsoleLogAfter(
  operation: () => any,
  target: string | RegExp | Array<string | RegExp>,
  arg3?: boolean | UntilBrowserLogAfterCallback,
  arg4?: UntilBrowserLogAfterCallback,
): Promise<string[]> {
  const expectOrder = typeof arg3 === 'boolean' ? arg3 : false
  const callback = typeof arg3 === 'boolean' ? arg4 : arg3

  const promise = untilConsoleLog(target, expectOrder)
  await operation()
  const logs = await promise
  if (callback) {
    await callback(logs)
  }
  return logs
}

/** 监听 mock logger，单目标精确/正则匹配，数组可严格按序或消费任意匹配项；五秒超时拒绝并移除监听。
 * @param target 未传时首条日志即可完成。
 * @param expectOrder 数组目标是否对每条到达日志断言下一项。
 * @returns 完成前累积的日志；成功后清定时器，拒绝时现有流程不会执行末尾 clearTimeout。 */
async function untilConsoleLog(
  target?: string | RegExp | Array<string | RegExp>,
  expectOrder = true,
): Promise<string[]> {
  const { promise, resolve, reject } = promiseWithResolvers<void>()
  let timeoutId: ReturnType<typeof setTimeout>

  const logsMessages = []

  try {
    /** 为单个日志目标生成匹配函数。
     * @param matcher 字符串使用全等，正则使用 test。
     * @returns 接收日志文本的谓词。 */
    const isMatch = (matcher: string | RegExp) => (text: string) =>
      typeof matcher === 'string' ? text === matcher : matcher.test(text)

    let processMsg: (text: string) => boolean

    if (!target) {
      processMsg = () => true
    } else if (Array.isArray(target)) {
      if (expectOrder) {
        const remainingTargets = [...target]
        processMsg = (text: string) => {
          const nextTarget = remainingTargets.shift()
          expect(text).toMatch(nextTarget)
          return remainingTargets.length === 0
        }
      } else {
        const remainingMatchers = target.map(isMatch)
        processMsg = (text: string) => {
          const nextIndex = remainingMatchers.findIndex((matcher) =>
            matcher(text),
          )
          if (nextIndex >= 0) {
            remainingMatchers.splice(nextIndex, 1)
          }
          return remainingMatchers.length === 0
        }
      }
    } else {
      processMsg = isMatch(target)
    }

    /** 去掉单个尾部换行后累积日志；匹配完成 resolve、匹配断言失败 reject，两者都移除监听。
     * @param text 新到达的 logger 文本。 */
    const handleMsg = (text: string) => {
      try {
        text = text.replace(/\n$/, '')
        logsMessages.push(text)
        const done = processMsg(text)
        if (done) {
          resolve()
          logsEmitter.off('log', handleMsg)
        }
      } catch (err) {
        reject(err)
        logsEmitter.off('log', handleMsg)
      }
    }

    timeoutId = setTimeout(() => {
      const nextTarget = Array.isArray(target)
        ? expectOrder
          ? target[0]
          : target.join(', ')
        : target
      reject(
        new Error(
          `Timeout waiting for console logs. Waiting for: ${nextTarget}`,
        ),
      )
      logsEmitter.off('log', handleMsg)
    }, 5000)

    logsEmitter.on('log', handleMsg)
  } catch (err) {
    reject(err)
  }

  await promise
  clearTimeout(timeoutId)

  return logsMessages
}

/** 遍历 watcher 的目录/文件表并统一路径分隔符，用 includes 判断目标片段是否已进入监听列表。
 * @param server 当前服务。
 * @param watchedFile 待查路径片段。
 * @returns 是否发现匹配路径。 */
function isWatched(server: ViteDevServer, watchedFile: string) {
  const watched = server.watcher.getWatched()
  for (const [dir, files] of Object.entries(watched)) {
    const unixDir = slash(dir)
    for (const file of files) {
      const filePath = posix.join(unixDir, file)
      if (filePath.includes(watchedFile)) {
        return true
      }
    }
  }
  return false
}

/** 轮询 watcher 列表直到目标出现；每20ms重试，现有辅助函数没有独立超时。
 * @param server 当前服务。
 * @param watched 待查路径片段。
 * @returns 文件被监听后完成的 Promise。 */
function waitForWatcher(server: ViteDevServer, watched: string) {
  return new Promise<void>((resolve) => {
    /** 检查一次 watcher 列表；命中完成 Promise，否则20ms后调度下一次检查。 */
    function checkWatched() {
      if (isWatched(server, watched)) {
        resolve()
      } else {
        setTimeout(checkWatched, 20)
      }
    }
    checkWatched()
  })
}

/** 关闭上轮服务、清日志和 runner 缓存，初始化共享状态；创建可运行 SSR environment，等 watch 后导入入口。
 * @param entrypoint runner 入口请求。
 * @param serverOptions 最后展开的内联配置，可覆盖默认项。
 * @param waitForFile 默认以入口为待监听路径片段。
 * @param initHmrState 初始共享 __HMR__ 状态。
 * @returns 当前 runner 与 server；fixture 的全局 log 转发到 mock logger。 */
async function setupModuleRunner(
  entrypoint: string,
  serverOptions: InlineConfig = {},
  waitForFile: string = entrypoint,
  initHmrState: Record<string, string> = {},
) {
  if (server) {
    await server.close()
    clientLogs.length = 0
    serverLogs.length = 0
    runner.clearCache()
  }

  globalThis.__HMR__ = initHmrState as any

  const logger = new HMRMockLogger()
  /** 将 fixture 调用的全局 log 转发给本轮 HMRMockLogger；setup 创建新 logger 后替换此函数。
   * @param msg 任意日志参数。 */
  // @ts-expect-error not typed for HMR
  globalThis.log = (...msg) => logger.log(...msg)

  server = await createServer({
    configFile: resolve(testDir, 'vite.config.ts'),
    root: testDir,
    customLogger: createInMemoryLogger(serverLogs),
    server: {
      middlewareMode: true,
      watch: {
        // 测试编辑文件很快，chokidar 有时会漏掉变化事件；
        // 此处使用轮询，提高这些连续编辑场景的事件可观测性。
        usePolling: true,
        interval: 100,
      },
      hmr: {
        port: 9609,
      },
      preTransformRequests: false,
    },
    environments: {
      ssr: {
        dev: {
          /** 为 SSR 创建带本轮 mock HMR logger 的 RunnableDevEnvironment。
           * @param name environment 名称。
           * @param config 已解析配置。
           * @returns 可用 ModuleRunner 的 environment。 */
          createEnvironment(name, config) {
            return createRunnableDevEnvironment(name, config, {
              runnerOptions: { hmr: { logger } },
            })
          },
        },
      },
    },
    optimizeDeps: {
      disabled: true,
      noDiscovery: true,
      include: [],
    },
    ...serverOptions,
  })

  runner = (server.environments.ssr as RunnableDevEnvironment).runner

  await waitForWatcher(server, waitForFile)

  await runner.import(entrypoint)

  return {
    runtime: runner,
    server,
  }
}

/** 收集 runner 与 fixture 的日志并发出 log 事件，驱动有序/无序日志等待辅助函数。 */
class HMRMockLogger {
  /** 空格连接普通日志参数，写 clientLogs 并触发 emitter。
   * @param msg 待记录参数。 */
  log(...msg: unknown[]) {
    const log = msg.join(' ')
    clientLogs.push(log)
    logsEmitter.emit('log', log)
  }

  /** 在参数前加 [vite]，写 clientLogs 并触发 emitter。
   * @param msg 待记录参数。 */
  debug(...msg: unknown[]) {
    const log = ['[vite]', ...msg].join(' ')
    clientLogs.push(log)
    logsEmitter.emit('log', log)
  }
  /** 在错误消息前加 [vite]，写 clientLogs 并触发 emitter。
   * @param msg 错误文本。 */
  error(msg: string) {
    const log = ['[vite]', msg].join(' ')
    clientLogs.push(log)
    logsEmitter.emit('log', log)
  }
}
