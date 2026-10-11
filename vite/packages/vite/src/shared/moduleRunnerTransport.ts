import { nanoid } from 'nanoid/non-secure'
import type { CustomPayload, HotPayload } from '#types/hmrPayload'
import { promiseWithResolvers } from './utils'
import type {
  InvokeMethods,
  InvokeResponseData,
  InvokeSendData,
} from './invokeMethods'

/** transport 建连后向 Module Runner 回调的消息与断连事件。 */
export type ModuleRunnerTransportHandlers = {
  /** 把 HMR/custom payload 交给 Runner。 */
  onMessage: (data: HotPayload) => void
  /** 底层连接意外断开时重置上层连接状态。 */
  onDisconnection: () => void
}

/**
 * Module Runner 与 Vite environment 之间的最小通信接口。
 *
 * 实现方必须提供原生 `invoke`，或同时提供 `send + connect`，后者会被包装成带 ID、
 * 超时和错误恢复的 RPC。`send/connect` 同时也是 HMR 消息通道。
 */
export interface ModuleRunnerTransport {
  /** 建立底层连接并登记消息/断连处理器。 */
  connect?(handlers: ModuleRunnerTransportHandlers): Promise<void> | void
  /** 关闭底层连接并释放资源。 */
  disconnect?(): Promise<void> | void
  /** 发送 HMR 或 custom payload。 */
  send?(data: HotPayload): Promise<void> | void
  /** 可选原生 RPC；存在时无需在 custom payload 上模拟关联 ID。 */
  invoke?(data: HotPayload): Promise<
    | {
        /** 原生 RPC 成功结果。 */
        result: any
      }
    | {
        /** 原生 RPC 失败数据。 */
        error: any
      }
  >
  /** RPC 超时毫秒数；`0` 表示不启用计时器，默认 60 秒。 */
  timeout?: number
}

/** 归一化的内部 transport：无论底层实现哪种形态，都暴露类型安全的 invoke。 */
type InvokeableModuleRunnerTransport = Omit<ModuleRunnerTransport, 'invoke'> & {
  /** 以方法名和参数元组调用类型安全 RPC。 */
  invoke<T extends keyof InvokeMethods>(
    name: T,
    data: Parameters<InvokeMethods[T]>,
  ): Promise<ReturnType<Awaited<InvokeMethods[T]>>>
}

/**
 * 把跨进程/跨 realm 传来的普通错误数据恢复成 Error。
 * `runnerError` 记录 Runner 本地调用边界，让 console 输出同时保留远端细节和本地来源。
 */
function reviveInvokeError(e: any) {
  const error = new Error(e.message || 'Unknown invoke error')
  Object.assign(error, e, {
    // 传完整 Error 而不只是 stack 字符串，使 console.log 使用正常的错误格式。
    runnerError: new Error('RunnerError'),
  })
  return error
}

/**
 * 将 transport 统一成 `invoke(name, args)`：已有原生 invoke 时只适配包结构；否则
 * 在 custom HMR payload 上实现 request/response RPC、超时、主动 disconnect 时拒绝和发送失败传播。
 * RPC Map 属于本包装实例，原生 invoke 分支直接使用宿主返回的 result/error，不建立关联表。
 */
const createInvokeableTransport = (
  transport: ModuleRunnerTransport,
): InvokeableModuleRunnerTransport => {
  if (transport.invoke) {
    return {
      ...transport,
      /** 把类型安全调用包装为原生 transport 所需的 custom payload。 */
      async invoke(name, data) {
        const result = await transport.invoke!({
          type: 'custom',
          event: 'vite:invoke',
          data: {
            id: 'send',
            name,
            data,
          } satisfies InvokeSendData,
        } satisfies CustomPayload)
        if ('error' in result) {
          throw reviveInvokeError(result.error)
        }
        return result.result
      },
    }
  }

  if (!transport.send || !transport.connect) {
    throw new Error(
      'transport must implement send and connect when invoke is not implemented',
    )
  }

  const rpcPromises = new Map<
    string,
    {
      /** 完成等待中的 invoke。 */
      resolve: (data: any) => void
      /** 拒绝等待中的 invoke。 */
      reject: (data: any) => void
      /** 用于断连/超时错误文本的方法名。 */
      name: string
      /** 启用超时时对应的计时器句柄。 */
      timeoutId?: ReturnType<typeof setTimeout>
    }
  >()

  return {
    ...transport,
    /** 包装底层连接，使 RPC 响应先被关联表消费。 */
    connect({ onMessage, onDisconnection }) {
      return transport.connect!({
        /** 分流 invoke 响应与普通 HMR/custom 消息。 */
        onMessage(payload) {
          // 只有 response:<id> 由 RPC 层消费，其余 HMR/custom 消息继续交给 Runner。
          if (payload.type === 'custom' && payload.event === 'vite:invoke') {
            const data = payload.data as InvokeResponseData
            if (data.id.startsWith('response:')) {
              const invokeId = data.id.slice('response:'.length)
              const promise = rpcPromises.get(invokeId)
              if (!promise) return

              if (promise.timeoutId) clearTimeout(promise.timeoutId)

              rpcPromises.delete(invokeId)

              const { error, result } = data.data
              if (error) {
                promise.reject(error)
              } else {
                promise.resolve(result)
              }
              return
            }
          }
          onMessage(payload)
        },
        onDisconnection,
      })
    },
    /**
     * 拒绝并移除全部 pending RPC，再交给底层断连；不是意外 close 的自动处理器。
     * 此处不逐项取消超时计时器，已拒绝 Promise 的后续 timeout reject 不再改变结果。
     */
    disconnect() {
      // 主动调用此包装层的 disconnect 时拒绝 pending RPC；意外断连回调本身不清理这张表。
      rpcPromises.forEach((promise) => {
        promise.reject(
          new Error(
            `transport was disconnected, cannot call ${JSON.stringify(promise.name)}`,
          ),
        )
      })
      rpcPromises.clear()
      return transport.disconnect?.()
    },
    /** 原样转发无需关联响应的 payload。 */
    send(data) {
      return transport.send!(data)
    },
    /**
     * 发送带随机 ID 的请求，随后登记响应 Promise 与可选超时；底层响应需异步回到 onMessage。
     * 同步 send 抛错发生在关联表建立前；异步发送拒绝、超时及远端错误进入等待 Promise 的失败出口。
     * 等待失败恢复为附有 Runner 本地边界的 Error，正常响应则清计时器并删除表项。
     */
    async invoke<T extends keyof InvokeMethods>(
      name: T,
      data: Parameters<InvokeMethods[T]>,
    ) {
      // 每个请求用随机 ID 与响应配对；`send` 本身仍可能同步或异步失败。
      const promiseId = nanoid()
      const wrappedData: CustomPayload = {
        type: 'custom',
        event: 'vite:invoke',
        data: {
          name,
          id: `send:${promiseId}`,
          data,
        } satisfies InvokeSendData,
      }
      const sendPromise = transport.send!(wrappedData)

      const { promise, resolve, reject } =
        promiseWithResolvers<ReturnType<Awaited<InvokeMethods[T]>>>()
      const timeout = transport.timeout ?? 60000
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          rpcPromises.delete(promiseId)
          reject(
            new Error(
              `transport invoke timed out after ${timeout}ms (data: ${JSON.stringify(wrappedData)})`,
            ),
          )
        }, timeout)
        timeoutId?.unref?.()
      }
      rpcPromises.set(promiseId, { resolve, reject, name, timeoutId })

      if (sendPromise) {
        // 发送阶段失败与远端返回错误走同一个 Promise 拒绝出口（#22450）。
        sendPromise.catch((err) => {
          clearTimeout(timeoutId)
          rpcPromises.delete(promiseId)
          reject(err)
        })
      }

      try {
        return await promise
      } catch (err) {
        throw reviveInvokeError(err)
      }
    },
  }
}

/** Runner 实际消费的 transport 形状：连接幂等，send/invoke 始终返回 Promise。 */
export interface NormalizedModuleRunnerTransport {
  /** 幂等建立连接；无 handler 时只完成底层握手。 */
  connect?(onMessage?: (data: HotPayload) => void): Promise<void> | void
  /** 幂等断开连接。 */
  disconnect?(): Promise<void> | void
  /** 保证 Promise 形态的 payload 发送。 */
  send(data: HotPayload): Promise<void>
  /** 类型安全调用服务端白名单方法。 */
  invoke<T extends keyof InvokeMethods>(
    name: T,
    data: Parameters<InvokeMethods[T]>,
  ): Promise<ReturnType<Awaited<InvokeMethods[T]>>>
}

/**
 * 归一化 transport 生命周期，并禁止连接建立前发送消息。
 *
 * 并发 connect 共享同一个 connectingPromise；send/invoke 可等待正在建立的连接。
 * disconnect 在 isConnected=false 时直接返回，首次 connect 尚未完成时不会等待或取消它。
 * connectingPromise 仅在成功 await 后清空；连接拒绝时它仍指向同一失败结果，后续调用继续等待该结果。
 * 意外断连只复位 isConnected，既不拒绝 pending RPC，也不使后续显式 disconnect 越过未连接检查。
 */
export const normalizeModuleRunnerTransport = (
  transport: ModuleRunnerTransport,
): NormalizedModuleRunnerTransport => {
  const invokeableTransport = createInvokeableTransport(transport)

  let isConnected = !invokeableTransport.connect
  let connectingPromise: Promise<void> | undefined

  return {
    ...(transport as Omit<ModuleRunnerTransport, 'connect'>),
    ...(invokeableTransport.connect
      ? {
          /** 合并并发连接并在断连时重置状态。 */
          async connect(onMessage) {
            if (isConnected) return
            // 第二个调用者等待首个连接，不再重复创建底层连接。
            if (connectingPromise) {
              await connectingPromise
              return
            }

            const maybePromise = invokeableTransport.connect!({
              /** 使用调用方的消息处理器；未提供时安装空回调，仍满足 transport 的连接接口。 */
              onMessage: onMessage ?? (() => {}),
              /** 允许下次 connect 重连；此回调只复位连接状态，不清理 pending RPC。 */
              onDisconnection() {
                isConnected = false
              },
            })
            if (maybePromise) {
              connectingPromise = maybePromise
              await connectingPromise
              connectingPromise = undefined
            }
            isConnected = true
          },
        }
      : {}),
    ...(invokeableTransport.disconnect
      ? {
          /** 已连接时关闭 transport；尚未连接或正在首次连接时直接返回。 */
          async disconnect() {
            if (!isConnected) return
            if (connectingPromise) {
              await connectingPromise
            }
            isConnected = false
            await invokeableTransport.disconnect!()
          },
        }
      : {}),
    /** 连接建立后发送；未调用 connect 时报告明确生命周期错误。 */
    async send(data) {
      if (!invokeableTransport.send) return

      if (!isConnected) {
        // 连接正在建立可以等待；从未 connect 则把调用顺序错误显式暴露给集成方。
        if (connectingPromise) {
          await connectingPromise
        } else {
          throw new SendBeforeConnectError('send was called before connect')
        }
      }
      await invokeableTransport.send(data)
    },
    /** 连接建立后执行 RPC，并复用同一生命周期检查。 */
    async invoke(name, data) {
      if (!isConnected) {
        if (connectingPromise) {
          await connectingPromise
        } else {
          throw new SendBeforeConnectError('invoke was called before connect')
        }
      }
      return invokeableTransport.invoke(name, data)
    },
  }
}

/** transport 的 send/invoke 早于 connect 时抛出的专用生命周期错误。 */
export class SendBeforeConnectError extends Error {
  /** 创建可由启动竞态处理逻辑精确识别的错误。 */
  constructor(message: string) {
    super(message)
    this.name = 'SendBeforeConnectError'
  }
}

/**
 * 创建基于标准 WebSocket 的 Runner transport。
 * 连接成功会合成 Vite custom 事件；等待 open 的分支同时注册后续 close 通知。定时 ping
 * 维持空闲 HMR WebSocket 的活动，避免代理因闲置超时回收它。
 * factory 若直接返回已 OPEN 的 socket，会跳过等待 open/注册 close 的分支；消息监听仍安装。
 * disconnect 只清保活计时器并关闭最近保存的 socket，RPC 与上层连接标志由归一化层处理。
 */
export const createWebSocketModuleRunnerTransport = (options: {
  /** 每次 connect 创建新的 WebSocket，便于宿主决定 URL、认证与实现。 */
  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- 由宿主提供实现
  createConnection: () => WebSocket
  /** 保活间隔，默认 30 秒。 */
  pingInterval?: number
}): Required<
  Pick<ModuleRunnerTransport, 'connect' | 'disconnect' | 'send'>
> => {
  const pingInterval = options.pingInterval ?? 30000

  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- 由宿主提供实现
  let ws: WebSocket | undefined
  let pingIntervalId: ReturnType<typeof setInterval> | undefined
  return {
    /** 建立 WebSocket、转发消息并启动定时 ping。 */
    async connect({ onMessage, onDisconnection }) {
      const socket = options.createConnection()
      socket.addEventListener('message', ({ data }) => {
        onMessage(JSON.parse(data))
      })

      let isOpened = socket.readyState === socket.OPEN
      if (!isOpened) {
        // open 前 close 表示连接失败；open 后 close 才是一次正常的断连通知。
        await new Promise<void>((resolve, reject) => {
          socket.addEventListener(
            'open',
            () => {
              isOpened = true
              resolve()
            },
            { once: true },
          )
          socket.addEventListener('close', () => {
            if (!isOpened) {
              reject(new Error('WebSocket closed without opened.'))
              return
            }

            onMessage({
              type: 'custom',
              event: 'vite:ws:disconnect',
              data: { webSocket: socket },
            })
            onDisconnection()
          })
        })
      }

      onMessage({
        type: 'custom',
        event: 'vite:ws:connect',
        data: { webSocket: socket },
      })
      ws = socket

      // nginx、Docker 等代理可能让空闲 HMR socket 超时，定期发送协议 ping 保活。
      pingIntervalId = setInterval(() => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }))
        }
      }, pingInterval)
    },
    /** 停止 ping 并关闭最近建立的 WebSocket。 */
    disconnect() {
      clearInterval(pingIntervalId)
      ws?.close()
    },
    /** 把 payload 序列化后写入已连接 WebSocket。 */
    send(data) {
      ws!.send(JSON.stringify(data))
    },
  }
}
