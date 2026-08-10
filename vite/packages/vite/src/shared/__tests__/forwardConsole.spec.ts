import { setTimeout } from 'node:timers/promises'
import { describe, expect, test, vi } from 'vitest'
import {
  formatConsoleArgs,
  setupForwardConsoleHandler,
} from '../forwardConsole'
import {
  type NormalizedModuleRunnerTransport,
  SendBeforeConnectError,
} from '../moduleRunnerTransport'

describe('formatConsoleArgs', () => {
  /**
   * 场景：格式串混用全部受支持占位符、缺失参数、额外参数、literal `%` 与 Symbol 数字转换。
   * 验证目标：`formatConsoleArgs` 按 Node console 语义消费参数，并生成稳定单行快照。
   */
  test('formats placeholders', () => {
    expect(
      formatConsoleArgs([
        'format: string=%s number=%d int=%i float=%f json=%j object=%o object2=%O sym=%d style=%c literal=%% trailing',
        'hello',
        12.9,
        '42px',
        '3.5',
        { id: 1 },
        { enabled: true },
        { nested: { deep: 1 } },
        Symbol.for('x'),
        'color:red',
        'done',
      ]),
    ).toMatchInlineSnapshot(
      `"format: string=hello number=12.9 int=42 float=3.5 json={"id":1} object={"enabled":true} object2={"nested":{"deep":1}} sym=NaN style= literal=% trailing done"`,
    )

    expect(
      formatConsoleArgs(['num=%d int=%i pct=%% miss=%s sym=%d', 3.14, '42px']),
    ).toMatchInlineSnapshot(`"num=3.14 int=42 pct=% miss=%s sym=%d"`)
  })

  /**
   * 场景：非模板参数包含 BigInt、undefined、Symbol、函数、无 stack Error 与循环对象。
   * 验证目标：格式化结果保留可读类型信息，并以 `[Circular]` 截断对象环。
   */
  test('stringifies diverse non-template arguments', () => {
    const topError = new Error('boom')
    topError.stack = undefined

    const nestedError = new Error('nested')
    nestedError.stack = undefined

    const circular: any = {
      ok: true,
      big: 2n,
      err: nestedError,
    }
    circular.self = circular

    /** 提供具名函数值，验证格式化结果保留函数名称。 */
    function sampleFn() {
      return undefined
    }

    expect(
      formatConsoleArgs([
        1n,
        undefined,
        true,
        Symbol.for('s'),
        sampleFn,
        topError,
        circular,
      ]),
    ).toMatchInlineSnapshot(
      `"1n undefined true Symbol(s) [Function: sampleFn] Error: boom {"ok":true,"big":"2n","err":{"name":"Error","message":"nested"},"self":"[Circular]"}"`,
    )
  })
})

describe('setupForwardConsoleHandler', () => {
  /** 构造可观察原 console 是否被调用的最小替身。 */
  function createMockConsole() {
    return {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      debug: vi.fn(),
    } as unknown as Console
  }

  /** 只替换 send 的规范化 transport，隔离发送失败分支。 */
  function createMockTransport(
    send: (...args: any[]) => Promise<void>,
  ): NormalizedModuleRunnerTransport {
    return {
      connect: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
      send,
      invoke: () => Promise.resolve({ result: undefined } as any),
    }
  }

  /**
   * 场景：client 初始化早于 transport.connect，转发日志时 send 拒绝 `SendBeforeConnectError`。
   * 验证目标：该预期生命周期竞态不回落到原 console.error，避免产生伪错误。
   */
  test('ignore SendBeforeConnectError from transport.send', async () => {
    const transport = createMockTransport(() =>
      Promise.reject(new SendBeforeConnectError('not connected yet')),
    )
    const console = createMockConsole()

    setupForwardConsoleHandler(
      transport,
      {
        enabled: true,
        unhandledErrors: false,
        logLevels: ['log'],
      },
      console,
    )

    console.log('hi')
    await setTimeout(50)

    expect(console.error).not.toHaveBeenCalled()
  })

  /**
   * 场景：日志 transport.send 以普通 Error 拒绝，而非连接前专用错误。
   * 验证目标：handler 调用原始 console.error 并保留失败说明与 Error，不能静默吞掉诊断（#22450）。
   */
  test('log errors from transport.send', async () => {
    const transport = createMockTransport(() =>
      Promise.reject(new Error('other error')),
    )
    const console = createMockConsole()

    setupForwardConsoleHandler(
      transport,
      {
        enabled: true,
        unhandledErrors: false,
        logLevels: ['log'],
      },
      console,
    )

    console.log('hi')
    await setTimeout(50)

    expect(console.error).toHaveBeenCalledWith(
      'Failed to send error to Vite server:',
      new Error('other error'),
    )
  })
})
