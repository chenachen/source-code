// @ts-check

import { BroadcastChannel, parentPort } from 'node:worker_threads'
import {
  ESModulesEvaluator,
  ModuleRunner,
  createNodeImportMeta,
} from 'vite/module-runner'
import { createBirpc } from 'birpc'

if (!parentPort) {
  throw new Error('File "worker.js" must be run in a worker thread')
}

/** 已确认存在的父线程 MessagePort，用于 Worker 的 RPC 双向消息。
 * @type {import('worker_threads').MessagePort} */
const pPort = parentPort

/** 基于父线程端口的 birpc 客户端，把 Runner invoke 请求转交父线程。
 * @type {import('birpc').BirpcReturn<{ invoke: (data: any) => any }>} */
const rpc = createBirpc(
  {},
  {
    /** 把 birpc 序列化消息发给父线程。 */
    post: (data) => pPort.postMessage(data),
    /** 在父线程端口上登记 birpc 消息处理器。 */
    on: (data) => pPort.on('message', data),
  },
)

/** 禁用 HMR 的 Worker ModuleRunner，使用原生 invoke 与 Node import.meta 构造器。 */
const runner = new ModuleRunner(
  {
    transport: {
      /** 把 Runner 方法请求转给 birpc.invoke，并返回父线程执行结果。 */
      invoke(data) {
        return rpc.invoke(data)
      },
    },
    createImportMeta: createNodeImportMeta,
    hmr: false,
  },
  new ESModulesEvaluator(),
)

/** 接收测试侧模块 ID 的独立 BroadcastChannel，与父线程 RPC 通道分开。 */
const channel = new BroadcastChannel('vite-worker:invoke')
/** 导入请求的模块后广播其默认导出；失败时广播错误堆栈，供主测试线程断言。 */
channel.onmessage = async (message) => {
  try {
    const mod = await runner.import(message.data.id)
    channel.postMessage({ result: mod.default })
  } catch (e) {
    channel.postMessage({ error: e.stack })
  }
}
parentPort.postMessage('ready')
