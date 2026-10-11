// @ts-check

import { BroadcastChannel, parentPort } from 'node:worker_threads'
import {
  ESModulesEvaluator,
  ModuleRunner,
  createNodeImportMeta,
} from 'vite/module-runner'

if (!parentPort) {
  throw new Error('File "worker.js" must be run in a worker thread')
}

/** 已确认存在的父线程 MessagePort，用于 transport 收发 Runner 协议消息。
 * @type {import('worker_threads').MessagePort} */
const pPort = parentPort

/** 以父线程 MessagePort 实现 connect/send 的 transport，供 Runner 自动构造 RPC。
 * @type {import('vite/module-runner').ModuleRunnerTransport} */
const messagePortTransport = {
  /** 在 MessagePort 上登记消息和关闭回调，供 Runner 接收 payload 并更新连接状态。 */
  connect({ onMessage, onDisconnection }) {
    pPort.on('message', onMessage)
    pPort.on('close', onDisconnection)
  },
  /** 将 Runner 的序列化协议 payload 发给父线程。 */
  send(data) {
    pPort.postMessage(data)
  },
}

/** 使用 MessagePort transport、Node import.meta 与 ESM evaluator 的 Worker ModuleRunner。 */
const runner = new ModuleRunner(
  {
    transport: messagePortTransport,
    createImportMeta: createNodeImportMeta,
  },
  new ESModulesEvaluator(),
)

/** 接收测试侧模块 ID 的 BroadcastChannel，和 Runner transport 通道分开。 */
const channel = new BroadcastChannel('vite-worker')
/** 导入请求的模块后广播默认导出；失败时广播错误堆栈，供测试侧断言。 */
channel.onmessage = async (message) => {
  try {
    const mod = await runner.import(message.data.id)
    channel.postMessage({ result: mod.default })
  } catch (e) {
    channel.postMessage({ error: e.stack })
  }
}
parentPort.postMessage('ready')
