import { BroadcastChannel, Worker } from 'node:worker_threads'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { HotChannel, HotChannelListener, HotPayload } from 'vite'
import { DevEnvironment } from '../../..'
import { createServer } from '../../../server'

/** 把 Worker postMessage/事件适配为 DevEnvironment 使用的 HotChannel。 */
const createWorkerTransport = (worker: Worker): HotChannel => {
  const handlerToWorkerListener = new WeakMap<
    HotChannelListener,
    (value: HotPayload) => void
  >()
  const client = {
    /** 从服务端事件回调向 worker 客户端发送 HotPayload。 */
    send(payload: HotPayload) {
      worker.postMessage(payload)
    },
  }

  return {
    /** 从服务端向 worker 发送完整 HotPayload。 */
    send: (data) => worker.postMessage(data),
    /** 将 custom 或 disconnect 监听转换为 worker message/exit 监听，并保留反向移除映射。 */
    on: (event: string, handler: HotChannelListener) => {
      // worker 已在创建环境前发出就绪信号，不再合成 connect 事件。
      if (event === 'vite:client:connect') return
      if (event === 'vite:client:disconnect') {
        /** worker 退出时合成 HotChannel 的 client disconnect 事件。 */
        const listener = () => {
          handler(undefined, client)
        }
        handlerToWorkerListener.set(handler, listener)
        worker.on('exit', listener)
        return
      }

      /** 只把 event 名匹配的 custom payload 分派给该监听器。 */
      const listener = (value: HotPayload) => {
        if (value.type === 'custom' && value.event === event) {
          handler(value.data, client)
        }
      }
      handlerToWorkerListener.set(handler, listener)
      worker.on('message', listener)
    },
    /** 用原 handler 找回对应 worker listener，移除 message/exit 订阅并删除映射。 */
    off: (event, handler: HotChannelListener) => {
      if (event === 'vite:client:connect') return
      if (event === 'vite:client:disconnect') {
        const listener = handlerToWorkerListener.get(handler)
        if (listener) {
          worker.off('exit', listener)
          handlerToWorkerListener.delete(handler)
        }
        return
      }

      const listener = handlerToWorkerListener.get(handler)
      if (listener) {
        worker.off('message', listener)
        handlerToWorkerListener.delete(handler)
      }
    },
  }
}

describe('running module runner inside a worker', () => {
  /**
   * 场景：真实 Worker 内的 ModuleRunner 通过 custom transport 导入 `default-string.ts`。
   * 验证目标：BroadcastChannel 收到 `{ result: 'hello world' }`；测试结束时 server 与 worker 都关闭。
   */
  it('correctly runs ssr code', async () => {
    expect.assertions(1)
    const worker = new Worker(
      new URL('./fixtures/worker.mjs', import.meta.url),
      {
        stdout: true,
      },
    )
    await new Promise<void>((resolve, reject) => {
      worker.on('message', () => resolve())
      worker.on('error', reject)
    })
    const server = await createServer({
      root: import.meta.dirname,
      logLevel: 'error',
      server: {
        middlewareMode: true,
        watch: null,
        hmr: {
          port: 9609,
        },
      },
      environments: {
        worker: {
          dev: {
            /** 构造接入 worker 消息通道的 DevEnvironment，供 worker ModuleRunner 拉取模块。 */
            createEnvironment: (name, config) => {
              return new DevEnvironment(name, config, {
                hot: false,
                transport: createWorkerTransport(worker),
              })
            },
          },
        },
      },
    })
    onTestFinished(async () => {
      await Promise.allSettled([server.close(), worker.terminate()])
    })
    const channel = new BroadcastChannel('vite-worker')
    return new Promise<void>((resolve, reject) => {
      /** 在主线程核对 worker 导出结果，并兑现或拒绝本例等待。 */
      channel.onmessage = (event) => {
        try {
          expect(event.data).toEqual({
            result: 'hello world',
          })
        } catch (e) {
          reject(e)
        } finally {
          resolve()
        }
      }
      channel.postMessage({ id: './fixtures/default-string.ts' })
    })
  })

  /**
   * 场景：worker Environment 只允许 fixtures 目录，却请求同级 `fixture-outside.js`。
   * 验证目标：`transformRequest()` 以 `Failed to load url` 拒绝，证明 custom transport 未绕过 fs.allow。
   */
  it('server.fs check is applied to the custom transport by default', async () => {
    const worker = new Worker(
      new URL('./fixtures/worker.mjs', import.meta.url),
      { stdout: true },
    )
    await new Promise<void>((resolve, reject) => {
      worker.on('message', () => resolve())
      worker.on('error', reject)
    })
    const server = await createServer({
      root: import.meta.dirname,
      logLevel: 'error',
      server: {
        middlewareMode: true,
        watch: null,
        hmr: {
          port: 9609,
        },
        fs: {
          allow: [path.resolve(import.meta.dirname, './fixtures')],
        },
      },
      environments: {
        worker: {
          dev: {
            /** 构造接入 worker 消息通道的 DevEnvironment，供 worker ModuleRunner 拉取模块。 */
            createEnvironment: (name, config) => {
              return new DevEnvironment(name, config, {
                hot: false,
                transport: createWorkerTransport(worker),
              })
            },
          },
        },
      },
    })
    onTestFinished(async () => {
      await Promise.allSettled([server.close(), worker.terminate()])
    })

    await expect(
      server.environments.worker.transformRequest('./fixture-outside.js'),
    ).rejects.toThrow('Failed to load url')
  })
})
