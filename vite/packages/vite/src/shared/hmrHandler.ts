import type { HotPayload } from '#types/hmrPayload'

/**
 * 把 HMR payload 处理器包装成严格串行队列。一次更新的 invalidate/回调可能同步触发下一次更新；若
 * 并行执行，两轮模块状态和 data/dispose 生命周期会交错。
 * 串行边界是 handler 返回的 Promise；handler 内未等待的异步工作不会延长本轮占用。
 *
 * @param handler - 浏览器或 Runner 的异步消息处理器，调用后须返回 Promise。
 * @returns 为每条 payload 返回独立完成 Promise 的入口；上一条结束后才调用下一条 handler。
 */
export function createHMRHandler(
  handler: (payload: HotPayload) => Promise<void>,
): (payload: HotPayload) => Promise<void> {
  const queue = new Queue()
  return (payload) => queue.enqueue(() => handler(payload))
}

/** 单消费者 Promise 队列：任务返回的 Promise 拒绝后仍清理占用，继续处理后续 payload。 */
class Queue {
  /** 尚未启动的任务及各自 Promise 的完成通道。 */
  private queue: {
    /** 队首执行时才调用的异步任务。 */
    promise: () => Promise<void>
    /** 把任务成功传回对应 enqueue 调用。 */
    resolve: (value?: unknown) => void
    /** 把任务失败传回对应 enqueue 调用。 */
    reject: (err?: unknown) => void
  }[] = []
  /** 当前是否已有队首任务在执行。 */
  private pending = false

  /**
   * 登记尚未执行的任务工厂及其完成通道；空闲时立即尝试出队。
   * 返回的 Promise 只代表该项，不代表整条队列已排空。
   */
  enqueue(promise: () => Promise<void>): Promise<void> {
    return new Promise<any>((resolve, reject) => {
      this.queue.push({
        promise,
        resolve,
        reject,
      })
      this.dequeue()
    })
  }

  /**
   * 空闲时取出队首并先设置 pending，防止执行期间的再次 enqueue 同时启动第二项。
   * 任务 Promise 的成功/拒绝传回所属调用后，finally 才释放 pending 并推进下一项。
   * 工厂须正常返回 Promise；同步抛错发生在这条 Promise 清理链建立之前。
   *
   * @returns 是否启动了一项；已有任务运行或队列为空时返回 false。
   */
  dequeue(): boolean {
    if (this.pending) {
      return false
    }
    const item = this.queue.shift()
    if (!item) {
      return false
    }
    this.pending = true
    item
      .promise()
      .then(item.resolve)
      .catch(item.reject)
      .finally(() => {
        this.pending = false
        this.dequeue()
      })
    return true
  }
}
