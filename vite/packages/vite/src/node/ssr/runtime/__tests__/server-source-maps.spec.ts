import { runInThisContext } from 'node:vm'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import type { ViteDevServer } from '../../..'
import type { ModuleRunnerContext } from '../../../../module-runner'
import { ESModulesEvaluator } from '../../../../module-runner'
import { SOURCEMAPPING_URL } from '../../../../shared/constants'
import {
  createFixtureEditor,
  createModuleRunnerTester,
  resolvePath,
} from './utils'

/**
 * 阅读目标：Runner 生成代码中的错误必须稳定映射回用户源码。
 *
 * 用例覆盖普通/深层/首行堆栈、HMR 后的新 map、import 调用列号、虚拟 sources、
 * 自定义 evaluator、恶意或特殊全局环境，以及不在 Runner 图中的内联 data map。
 */
describe('module runner initialization', async () => {
  const it = await createModuleRunnerTester(
    {},
    {
      sourcemapInterceptor: 'prepareStackTrace',
    },
  )

  /** 执行预期失败的操作并返回捕获的 Error。 */
  const getError = async (cb: () => void): Promise<Error> => {
    try {
      await cb()
      expect.unreachable()
    } catch (err) {
      return err
    }
  }
  /** 规范化首个堆栈帧中的机器相关项目根路径。 */
  const serializeStack = (server: ViteDevServer, err: Error) => {
    return err.stack!.split('\n')[1].replace(server.config.root, '<root>')
  }
  /** 规范化整条堆栈中的项目根路径，便于逐帧断言。 */
  const serializeStackDeep = (server: ViteDevServer, err: Error) => {
    return err
      .stack!.split('\n')
      .map((s) => s.replace(server.config.root, '<root>'))
  }

  /**
   * 场景：顶层与方法错误经 Runner 转换后抛出，随后编辑夹具增加五行并清除两侧缓存。
   * 验证目标：堆栈先映射到原始 2:7、6:9；重新加载新 map 后方法位置更新为 11:9。
   */
  it('source maps are correctly applied to stack traces', async ({
    runner,
    server,
  }) => {
    expect.assertions(3)
    const topLevelError = await getError(() =>
      runner.import('/fixtures/has-error.js'),
    )
    expect(serializeStack(server, topLevelError)).toBe(
      '    at <root>/fixtures/has-error.js:2:7',
    )

    const methodError = await getError(async () => {
      const mod = await runner.import('/fixtures/throws-error-method.ts')
      mod.throwError()
    })
    expect(serializeStack(server, methodError)).toBe(
      '    at Module.throwError (<root>/fixtures/throws-error-method.ts:6:9)',
    )

    const fixtureEditor = createFixtureEditor()

    // 模拟 HMR 后源码行数变化，并清除两侧缓存以取得新 map。
    fixtureEditor.editFile(
      resolvePath(import.meta.url, './fixtures/throws-error-method.ts'),
      (code) => '\n\n\n\n\n' + code + '\n',
    )
    runner.evaluatedModules.clear()
    server.environments.ssr.moduleGraph.invalidateAll()

    const methodErrorNew = await getError(async () => {
      const mod = await runner.import('/fixtures/throws-error-method.ts')
      mod.throwError()
    })

    expect(serializeStack(server, methodErrorNew)).toBe(
      '    at Module.throwError (<root>/fixtures/throws-error-method.ts:11:9)',
    )
  })

  /**
   * 场景：错误分别位于 JS 首行和带首行注释的 TS 第二行。
   * 验证目标：首帧保留准确行列 1:7 与 2:7，不因生成代码前缀产生偏移。
   */
  it('stacktrace column on first line', async ({ runner, server }) => {
    const topLevelError = await getError(() =>
      runner.import('/fixtures/has-error-first.js'),
    )
    expect(serializeStack(server, topLevelError)).toBe(
      '    at <root>/fixtures/has-error-first.js:1:7',
    )

    const topLevelErrorTs = await getError(() =>
      runner.import('/fixtures/has-error-first-comment.ts'),
    )
    expect(serializeStack(server, topLevelErrorTs)).toBe(
      '    at <root>/fixtures/has-error-first-comment.ts:2:7',
    )
  })

  /**
   * 场景：读取延迟生成的 error.stack 时，Object.prototype.constructor 拒绝赋值以模拟冻结原型。
   * 验证目标：CallSite 克隆不写继承属性，堆栈仍映射到 throws-error-method.ts:6:9。
   */
  it('stack traces work when Object.prototype is frozen', async ({
    runner,
    server,
  }) => {
    const methodError = await getError(async () => {
      const mod = await runner.import('/fixtures/throws-error-method.ts')
      mod.throwError()
    })

    // 模拟用户执行 `Object.freeze(Object.prototype)`，但不永久冻结当前 worker：让继承的
    // constructor 赋值抛错，即可复现冻结对象时 cloneCallSite 曾触发的失败。
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'constructor',
    )!
    Object.defineProperty(Object.prototype, 'constructor', {
      configurable: true,
      /** 保持 constructor 读取值不变，仅模拟继承属性不能写入的状态。 */
      get: () => original.value,
      /** 在 CallSite 克隆尝试写入 constructor 时抛错，模拟冻结 Object.prototype。 */
      set: () => {
        throw new TypeError(
          `Cannot assign to read only property 'constructor' of object '#<Object>'`,
        )
      },
    })
    try {
      // 首次读取 `.stack` 才会触发 prepareStackTrace，故断言必须位于 mock 生效期间。
      expect(serializeStack(server, methodError)).toBe(
        '    at Module.throwError (<root>/fixtures/throws-error-method.ts:6:9)',
      )
    } finally {
      Object.defineProperty(Object.prototype, 'constructor', original)
    }
  })

  /**
   * 场景：模块 main 调用内部 crash，形成两层用户源码调用链。
   * 验证目标：堆栈前三行依次保留错误消息、crash 位置与 main 调用位置。
   */
  it('deep stacktrace', async ({ runner, server }) => {
    const methodError = await getError(async () => {
      const mod = await runner.import('/fixtures/has-error-deep.ts')
      mod.main()
    })
    expect(serializeStackDeep(server, methodError).slice(0, 3)).toEqual([
      'Error: crash',
      '    at crash (<root>/fixtures/has-error-deep.ts:2:9)',
      '    at Module.main (<root>/fixtures/has-error-deep.ts:6:3)',
    ])
  })

  /**
   * 场景：顶层模块调用从依赖导入、经 `(0, ...)` 包装的 crash 函数。
   * 验证目标：依赖帧映射到 2:9，调用者帧与 Node 一致映射到 callee 起点 3:1。
   */
  it('call site of an imported binding matches Node column', async ({
    runner,
    server,
  }) => {
    // import 调用会包成 `(0, ...)` 以避免绑定 `this`。V8 把这种帧锚在实参列表 `(`，
    // 但映射结果应与 Node 一致，指向 callee 起点：此处为第 1 列，而非 `(`。见 #19625。
    const error = await getError(() =>
      runner.import('/fixtures/has-error-toplevel.js'),
    )
    expect(serializeStackDeep(server, error).slice(0, 3)).toEqual([
      'Error: crash',
      '    at crash (<root>/fixtures/has-error-toplevel-dep.js:2:9)',
      '    at <root>/fixtures/has-error-toplevel.js:3:1',
    ])
  })

  /**
   * 场景：模块字符串字面量包含伪造且无效的 sourceMappingURL 文本，随后模块函数抛错。
   * 验证目标：字符串原样返回；文件尾的最终 Vite map 覆盖此前伪标记，堆栈仍映射到 11:9。
   */
  it('should not crash when sourceMappingURL pattern appears in string literals', async ({
    runner,
    server,
  }) => {
    const mod = await runner.import('/fixtures/string-literal-sourcemap.ts')
    expect(mod.getMessage()).toBe(
      '//# sourceMappingURL=data:application/json;base64,invalidbase64',
    )
    const error = await getError(() => mod.throwError())
    expect(error.message).toBe('Test error for stacktrace')
    expect(serializeStackDeep(server, error).slice(0, 2)).toEqual([
      'Error: Test error for stacktrace',
      '    at Module.throwError (<root>/fixtures/string-literal-sourcemap.ts:11:9)',
    ])
  })

  /**
   * 场景：预映射 JS 的 sources 指向磁盘上不存在的 transpiled-inline.ts。
   * 验证目标：堆栈尊重 map 中虚拟 source，并映射 innerTestStack 与 testStack 两个 TS 帧。
   */
  it('should correctly pickup the url from sources', async ({
    server,
    runner,
  }) => {
    const mod = await runner.import('/fixtures/pre-source-mapped-file.js')
    const error = await getError(() => mod.default())
    // map 的 sources 指向并不存在于磁盘的 transpiled-inline.ts，堆栈仍应尊重该虚拟源；
    // 若退回 transpiled-inline.js，就说明 sourcemap 处理失效。
    expect(serializeStackDeep(server, error).slice(0, 3))
      .toMatchInlineSnapshot(`
      [
        "Error: __TEST_STACK_TRANSPILED_INLINE__",
        "    at innerTestStack (<root>/fixtures/transpiled-inline.ts:22:9)",
        "    at Module.testStack (<root>/fixtures/transpiled-inline.ts:12:3)",
      ]
    `)
  })

  /**
   * 场景：模块已抛错后删除 globalThis.Buffer，再首次读取延迟生成的 stack。
   * 验证目标：内联 map 解码不依赖全局 Buffer，方法帧仍映射到原 TS 位置。
   */
  it('should not crash when preparing a stack trace while globalThis.Buffer is absent', async ({
    runner,
    server,
  }) => {
    const mod = await runner.import('/fixtures/throws-error-method.ts')
    const methodError = await getError(() => mod.throwError())

    // realm 可能在模块加载后合法删除 Buffer（如浏览器对齐测试）；这段窗口中的堆栈
    // 准备不能依赖全局绑定仍然存在。
    const bufferBackup = globalThis.Buffer
    Reflect.deleteProperty(globalThis, 'Buffer')
    try {
      // 读取 `.stack` 会延迟触发 prepareStackTrace，并解码 Runner 模块的内联 map。
      expect(serializeStack(server, methodError)).toBe(
        '    at Module.throwError (<root>/fixtures/throws-error-method.ts:6:9)',
      )
    } finally {
      globalThis.Buffer = bufferBackup
    }
  })
})

describe('module runner with node:vm executor', async () => {
  /** 使用 node:vm 和负 columnOffset 模拟 Vitest evaluator 的执行行为。 */
  class Evaluator extends ESModulesEvaluator {
    /** 在带负列偏移的 VM 脚本中抛错，验证堆栈拦截器的边界处理。 */
    async runInlinedModule(_: ModuleRunnerContext, __: string) {
      // 模拟 VitestModuleEvaluator 提供带负 columnOffset 的 node:vm 执行器。
      const initModule = runInThisContext(
        '() => { throw new Error("example")}',
        {
          lineOffset: 0,
          columnOffset: -100,
          filename: resolve(import.meta.dirname, 'fixtures/a.ts'),
        },
      )

      initModule()
    }
  }

  const it = await createModuleRunnerTester(
    {},
    {
      sourcemapInterceptor: 'prepareStackTrace',
      evaluator: new Evaluator(),
    },
  )

  /**
   * 场景：node:vm evaluator 以 -100 columnOffset 抛错，生成含负列号的堆栈。
   * 验证目标：访问 error.stack 不抛异常，拦截器安全处理无效负列。
   */
  it('should not crash when error stacktrace contains negative column', async ({
    runner,
  }) => {
    const error = await runner.import('/fixtures/a.ts').catch((err) => err)

    expect(() =>
      error.stack.includes('.stack access triggers the bug'),
    ).not.toThrow()
  })
})

describe('module runner interceptor with inline data: source map', async () => {
  const syntheticFile = '/virtual-bufferless/inline-map.js'
  // 最小 map：把全部生成位置指向 inline-map-original.ts 的第 1 行第 0 列。
  const syntheticSourceMap = {
    version: 3,
    sources: ['inline-map-original.ts'],
    names: [],
    mappings: 'AAAA',
  }
  // 用 SOURCEMAPPING_URL 拼出注释标记，避免本测试文件自身出现完整标记并被工具误识别。
  const syntheticFileContent =
    `throw new Error('example')\n` +
    `//# ${SOURCEMAPPING_URL}=data:application/json;base64,${btoa(
      JSON.stringify(syntheticSourceMap),
    )}\n`

  /** 让异常堆栈指向模块图外 syntheticFile 的测试 evaluator。 */
  class Evaluator extends ESModulesEvaluator {
    /** 在 VM 中用 syntheticFile 作为文件名抛错，触发 retrieveFile 回退。 */
    async runInlinedModule(_: ModuleRunnerContext, __: string) {
      const initModule = runInThisContext(
        '() => { throw new Error("example") }',
        { filename: syntheticFile },
      )

      initModule()
    }
  }

  const it = await createModuleRunnerTester(
    {},
    {
      sourcemapInterceptor: {
        // 返回一个不属于 Runner 模块图、但携带内联 base64 map 的文件，迫使映射走
        // retrieveSourceMap 路径，而不是从模块图直接取 map。
        /** 为 syntheticFile 提供携带内联 base64 Source Map 的源码。 */
        retrieveFile(id) {
          if (id === syntheticFile) {
            return syntheticFileContent
          }
        },
      },
      evaluator: new Evaluator(),
    },
  )

  /**
   * 场景：模块图外文件携带 base64 data Source Map，错误产生后删除 globalThis.Buffer。
   * 验证目标：retrieveFile 回退仍解码 map，并把堆栈指向 inline-map-original.ts:1:1。
   */
  it('should not crash when decoding an inline source map while globalThis.Buffer is absent', async ({
    runner,
  }) => {
    const error: Error = await runner
      .import('/fixtures/a.ts')
      .catch((err) => err)

    const bufferBackup = globalThis.Buffer
    Reflect.deleteProperty(globalThis, 'Buffer')
    try {
      expect(error.stack).toContain(
        '/virtual-bufferless/inline-map-original.ts:1:1',
      )
    } finally {
      globalThis.Buffer = bufferBackup
    }
  })
})
