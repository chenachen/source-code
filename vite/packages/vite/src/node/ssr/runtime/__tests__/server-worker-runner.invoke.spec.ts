import { BroadcastChannel, Worker } from 'node:worker_threads'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BirpcReturn } from 'birpc'
import { createBirpc } from 'birpc'
import { DevEnvironment } from '../../..'
import { type ViteDevServer, createServer } from '../../../server'

describe('running module runner inside a worker and using the ModuleRunnerTransport#invoke API', () => {
  let worker: Worker
  let server: ViteDevServer
  let rpc: BirpcReturn<
    unknown,
    {
      /** 把 worker 的 ModuleRunner invoke 请求转发到服务端 Environment。 */
      invoke: (data: any) => Promise<
        | {
            /** 成功 RPC 的可序列化返回值。 */
            result: any
          }
        | {
            /** 失败 RPC 的错误对象或未知错误值。 */
            error: any
          }
      >
    }
  >
  let handleInvoke: (data: any) => Promise<
    | {
        /** 服务端 invoke handler 的成功结果。 */
        result: any
      }
    | {
        /** 服务端 invoke handler 的失败结果。 */
        error: any
      }
  >

  beforeAll(async () => {
    worker = new Worker(
      new URL('./fixtures/worker.invoke.mjs', import.meta.url),
      {
        stdout: true,
      },
    )
    await new Promise<void>((resolve, reject) => {
      worker.on('message', () => resolve())
      worker.on('error', reject)
    })
    server = await createServer({
      root: import.meta.dirname,
      logLevel: 'error',
      server: {
        middlewareMode: true,
        watch: null,
        hmr: {
          port: 9610,
        },
        fs: {
          allow: [path.resolve(import.meta.dirname, './fixtures')],
        },
      },
      environments: {
        worker: {
          dev: {
            /** 构造无 WebSocket 的 worker 环境，invoke 请求由主线程 RPC 转交它处理。 */
            createEnvironment: (name, config) => {
              return new DevEnvironment(name, config, {
                hot: false,
              })
            },
          },
        },
      },
    })
    handleInvoke = (data: any) =>
      server.environments.worker.hot.handleInvoke(data)
    rpc = createBirpc(
      {
        /** 调用可被各测试替换的 handler，覆盖成功、Error 与未知错误值三种 RPC 结果。 */
        invoke: (data: any) => handleInvoke(data),
      },
      {
        /** 把 birpc 请求发送到真实 worker 的 message 端口。 */
        post: (data) => worker.postMessage(data),
        /** 监听 worker 返回消息，交由 birpc 匹配请求与响应。 */
        on: (data) => worker.on('message', data),
      },
    )
  })

  afterAll(async () => {
    await Promise.allSettled([server.close(), worker.terminate()])
    rpc.$close()
  })

  /** 通过 BroadcastChannel 请求 worker 导入模块，并等待其序列化结果。 */
  async function run(id: string) {
    const channel = new BroadcastChannel('vite-worker:invoke')
    return new Promise<any>((resolve, reject) => {
      /** 收到 worker 导入结果时兑现 run 的等待；由调用用例核对成功值或序列化错误。 */
      channel.onmessage = (event) => {
        try {
          resolve(event.data)
        } catch (e) {
          reject(e)
        }
      }
      channel.postMessage({ id })
    })
  }

  /**
   * 场景：通过 BroadcastChannel 请求 worker 导入 `default-string.ts`。
   * 验证目标：custom invoke transport 把模块导出的 `hello world` 序列化回主线程。
   */
  it('correctly runs ssr code', async () => {
    const output = await run('./fixtures/default-string.ts')
    expect(output).toStrictEqual({
      result: 'hello world',
    })
  })

  /**
   * 场景：服务端 invoke handler 返回一个带明确消息的 Error。
   * 验证目标：worker 响应不含 result，并保留 `This is an Invoke Error` 的错误类型与消息。
   */
  it('triggers an error', async () => {
    handleInvoke = async () => ({ error: new Error('This is an Invoke Error') })
    const output = await run('dummy')
    expect(output).not.toHaveProperty('result')
    expect(output.error).toContain('Error: This is an Invoke Error')
  })

  /**
   * 场景：invoke handler 违反协议，返回字符串而不是 Error。
   * 验证目标：边界层把未知值规范化为 `Error: Unknown invoke error`，且不伪造成功结果。
   */
  it('triggers an unknown error', async () => {
    handleInvoke = async () => ({ error: 'a string instead of an error' })
    const output = await run('dummy')
    expect(output).not.toHaveProperty('result')
    expect(output.error).toContain('Error: Unknown invoke error')
  })

  /**
   * 场景：worker 入口导入 Node builtin，并把非 builtin 请求转给 Environment hot channel。
   * 验证目标：builtin 在 worker 中可用并返回 `baz.txt`，响应无 error。
   * 机制：getModuleInformation 在 builtin 分支跳过 fetchModule RPC，首次请求仍会初始化 builtins 规则。
   */
  it('resolves builtin module without server round-trip', async () => {
    handleInvoke = (data: any) =>
      server.environments.worker.hot.handleInvoke(data)

    const output = await run('./fixtures/builtin-import.ts')
    expect(output).toHaveProperty('result')
    expect(output.result).toBe('baz.txt')
    expect(output.error).toBeUndefined()
  })

  /**
   * 场景：custom transport 请求 root 允许范围外的 `fixture-outside.js`。
   * 验证目标：默认 `server.fs` 边界仍生效，响应包含 `Failed to load url` 而不是模块结果。
   */
  it('server.fs check is applied to the custom transport by default', async () => {
    handleInvoke = (data: any) =>
      server.environments.worker.hot.handleInvoke(data)

    const output = await run('./fixture-outside.js')
    expect(output).toHaveProperty('error')
    expect(output.error).toContain('Failed to load url')
  })
})
